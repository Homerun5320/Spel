// The helicopter table and the beachhead table (M12a-1). Both are GAME STATE: serialised and hashed (src/sim/serialize.ts), designed here for
// all of M12a so that part 2 (LaunchHeli, the flight, the state machine, fuel, recall) and part 3 (landing, beachhead, cut-off clusters) add
// behaviour and no new fields. Part 1 uses only the states HELI_BUILDING (under production) and HELI_PAD.
//
// Helicopter table: structure-of-arrays, HELI_CAPACITY slots, owner 0 = a free slot. Free list exactly as the structure table: `highWater` slots
// have been used, a removed id goes on the `recycled` stack and the next helicopter takes the top of the stack, else the next unused slot, so the
// id is a pure function of the history and the whole free list (highWater + the stack) is hashed and serialised.
// Beachhead table: BEACHHEAD_CAPACITY slots, owner 0 = free; a new landing takes the LOWEST free slot (no stack: a scan of 64 is cheaper than a
// second piece of state). Part 3 owns the meaning of `status`.
//
// Positions are Q8 fixed point in sim-cell units (1 cell = HELI_POS_ONE), the centre of cell (cx, cy) is (cx * 256 + 128, cy * 256 + 128); the
// altitude is whole GAME metres (the unit of the LOS occluder layer). Fuel is in Q8 cells (a full tank is HELI_FUEL_MAX_Q8). hp is in tenths.
import { BEACHHEAD_CAPACITY, HELI_CAPACITY, HELI_ROUTE_CAPACITY } from './rules';
import { foldWord } from './hash';

/** Helicopter states. 0 is "no helicopter" (a free slot). Own names; the order is the wire order, append only. */
export const HELI_NONE = 0;
/** Under production in a Factory (readyTick = the tick it becomes HELI_PAD). */
export const HELI_BUILDING = 1;
/** Parked at its Factory, fuelled, empty, ready for LaunchHeli (part 2). */
export const HELI_PAD = 2;
/** Lifting off (part 2: 20 ticks). */
export const HELI_LIFT = 3;
/** Following its route (part 2). */
export const HELI_CRUISE = 4;
/** On the last leg to the landing zone (part 2). */
export const HELI_APPROACH = 5;
/** Hovering over the landing zone (part 2: 3 s). */
export const HELI_HOVER = 6;
/** Setting down and unloading (part 2/3: 10 ticks). */
export const HELI_UNLOAD = 7;
/** Returning to the nearest own Factory (part 2). */
export const HELI_RETURN = 8;
/** Shot down or out of fuel; removed after 50 ticks (part 2). */
export const HELI_DOWNED = 9;
export const HELI_STATE_MAX = 9;

// The causes of a HELI_DOWNED event (`b` of OUTBOX_HELI_DOWNED).
/** Out of fuel (M12a-2). */
export const HELI_DOWN_FUEL = 1;
/** Hit by a SAM salvo (M12b). */
export const HELI_DOWN_SAM = 2;
/** Worn down by Defense Posts (M12b). */
export const HELI_DOWN_POST = 3;

/** One cell in the Q8 position fixed point. */
export const HELI_POS_ONE = 256;
/** Half a cell: the offset of a cell centre. */
export const HELI_POS_HALF = 128;

/** The Q8 x (or y) of the centre of cell column / row `c`. */
export function cellCentreQ8(c: number): number {
  return c * HELI_POS_ONE + HELI_POS_HALF;
}

/** The read-only window onto the helicopter table (what `SimView.helis` is). Arrays are indexed by helicopter id; owner 0 = a free slot. */
export interface HeliView {
  readonly capacity: number;
  /** Slots 0..highWater-1 have been used; iterate to this. */
  readonly highWater: number;
  /** Helicopters alive (also those under production). */
  readonly liveCount: number;
  /** ownerId (0 = free slot). */
  readonly owner: ArrayLike<number>;
  /** HELI_* state. */
  readonly state: ArrayLike<number>;
  /** The id of the home Factory in the structure table. */
  readonly factory: ArrayLike<number>;
  /** HELI_BUILDING: the tick at which production finishes. Other states: the tick the state began (part 2). */
  readonly readyTick: ArrayLike<number>;
  /** Position in Q8 cells, altitude in game metres. */
  readonly x: ArrayLike<number>;
  readonly y: ArrayLike<number>;
  readonly alt: ArrayLike<number>;
  /** Hit points in tenths, troops carried, fuel in Q8 cells. */
  readonly hp: ArrayLike<number>;
  readonly load: ArrayLike<number>;
  readonly fuel: ArrayLike<number>;
  /** Helicopters of an ownerId, also those under production (the fleet count). */
  countOf(ownerId: number): number;
}

export class HeliTable implements HeliView {
  readonly capacity = HELI_CAPACITY;
  highWater = 0;
  liveCount = 0;
  readonly owner = new Uint16Array(HELI_CAPACITY);
  readonly state = new Uint8Array(HELI_CAPACITY);
  readonly factory = new Uint16Array(HELI_CAPACITY);
  readonly readyTick = new Uint32Array(HELI_CAPACITY);
  /** The tick the current state began (part 2 reads it for the timed states). */
  readonly stateTick = new Uint32Array(HELI_CAPACITY);
  readonly x = new Int32Array(HELI_CAPACITY);
  readonly y = new Int32Array(HELI_CAPACITY);
  readonly alt = new Int32Array(HELI_CAPACITY);
  readonly hp = new Uint16Array(HELI_CAPACITY);
  readonly load = new Uint16Array(HELI_CAPACITY);
  readonly fuel = new Uint32Array(HELI_CAPACITY);
  /** Flight mode (ALT_MODE_LOW / ALT_MODE_HIGH) the route was planned for. */
  readonly mode = new Uint8Array(HELI_CAPACITY);
  /** The landing zone cell + 1, 0 = none. */
  readonly target = new Uint32Array(HELI_CAPACITY);
  /** The route: `routeLen` waypoints (sim cells) at `route[id * HELI_ROUTE_CAPACITY ...]`, `routeIdx` is the next one to fly to. */
  readonly routeLen = new Uint8Array(HELI_CAPACITY);
  readonly routeIdx = new Uint8Array(HELI_CAPACITY);
  readonly route = new Int32Array(HELI_CAPACITY * HELI_ROUTE_CAPACITY);
  /** The deleted ids waiting for reuse (a stack: the top is `recycled[recycledCount - 1]`). */
  readonly recycled = new Uint8Array(HELI_CAPACITY);
  recycledCount = 0;
  /** Derived: helicopters per ownerId (also those under production). Rebuilt by `rebuildIndex`. */
  private readonly counts: Uint16Array;

  constructor(ownerSlotCount: number) {
    this.counts = new Uint16Array(ownerSlotCount);
  }

  countOf(ownerId: number): number {
    return ownerId >= 0 && ownerId < this.counts.length ? (this.counts[ownerId] as number) : 0;
  }

  /** Takes a slot (the top of the recycle stack, else the next unused one); -1 when the table is full. */
  allocId(): number {
    if (this.recycledCount > 0) return this.recycled[--this.recycledCount] as number;
    return this.highWater < HELI_CAPACITY ? this.highWater++ : -1;
  }

  /** Puts a helicopter under production in the table (the caller has checked the rules). Returns its id, -1 when full. */
  addBuilding(ownerId: number, factory: number, tick: number, readyTick: number): number {
    const id = this.allocId();
    if (id < 0) return -1;
    this.owner[id] = ownerId;
    this.state[id] = HELI_BUILDING;
    this.factory[id] = factory;
    this.readyTick[id] = readyTick;
    this.stateTick[id] = tick;
    this.x[id] = 0;
    this.y[id] = 0;
    this.alt[id] = 0;
    this.hp[id] = 0;
    this.load[id] = 0;
    this.fuel[id] = 0;
    this.mode[id] = 0;
    this.target[id] = 0;
    this.routeLen[id] = 0;
    this.routeIdx[id] = 0;
    this.counts[ownerId] = (this.counts[ownerId] as number) + 1;
    this.liveCount++;
    return id;
  }

  /** Frees a slot (its route too) and puts it on the recycle stack. */
  remove(id: number): void {
    const ownerId = this.owner[id] as number;
    this.counts[ownerId] = (this.counts[ownerId] as number) - 1;
    this.owner[id] = 0;
    this.state[id] = HELI_NONE;
    this.factory[id] = 0;
    this.readyTick[id] = 0;
    this.stateTick[id] = 0;
    this.x[id] = 0;
    this.y[id] = 0;
    this.alt[id] = 0;
    this.hp[id] = 0;
    this.load[id] = 0;
    this.fuel[id] = 0;
    this.mode[id] = 0;
    this.target[id] = 0;
    this.routeLen[id] = 0;
    this.routeIdx[id] = 0;
    this.route.fill(0, id * HELI_ROUTE_CAPACITY, (id + 1) * HELI_ROUTE_CAPACITY);
    this.recycled[this.recycledCount++] = id;
    this.liveCount--;
  }

  /** The id of the helicopter under production in Factory `factory`, or -1. */
  buildingAt(factory: number): number {
    for (let id = 0; id < this.highWater; id++) {
      if (this.owner[id] !== 0 && this.state[id] === HELI_BUILDING && this.factory[id] === factory) return id;
    }
    return -1;
  }

  /** Recomputes the derived counts from the stored arrays (what deserialize does). */
  rebuildIndex(): void {
    this.counts.fill(0);
    let live = 0;
    for (let id = 0; id < this.highWater; id++) {
      const o = this.owner[id] as number;
      if (o === 0) continue;
      this.counts[o] = (this.counts[o] as number) + 1;
      live++;
    }
    this.liveCount = live;
  }
}

/** Beachhead status (part 3 owns the meaning; 0 is a free slot). */
export const BEACH_NONE = 0;
/** Landed, the cut-off timer runs. */
export const BEACH_CUT_OFF = 1;
/** Established (80 cells or a City): permanent. */
export const BEACH_ESTABLISHED = 2;
export const BEACH_STATUS_MAX = 2;

export class BeachheadTable {
  readonly capacity = BEACHHEAD_CAPACITY;
  liveCount = 0;
  /** ownerId of the landing seat (0 = free slot). */
  readonly owner = new Uint16Array(BEACHHEAD_CAPACITY);
  /** The seed cell (the landing zone) of the beachhead. */
  readonly seed = new Int32Array(BEACHHEAD_CAPACITY);
  /** The tick of the landing. */
  readonly landTick = new Uint32Array(BEACHHEAD_CAPACITY);
  readonly status = new Uint8Array(BEACHHEAD_CAPACITY);
  /** DERIVED (M12a-3, never hashed or serialised): the cut-off cache below must be recomputed (a cell changed owner, a row came or went, a restore). */
  dirty = true;
  /** DERIVED: per ownerId, the Q15 cos-weighted area of its cut-off clusters, which the economy leaves out (src/sim/beachheadCluster.ts). Allocated at the first refresh. */
  cutWeight: Uint32Array | null = null;

  /** Takes the lowest free slot; -1 when full. */
  add(ownerId: number, seed: number, landTick: number, status: number): number {
    for (let i = 0; i < BEACHHEAD_CAPACITY; i++) {
      if (this.owner[i] !== 0) continue;
      this.owner[i] = ownerId;
      this.seed[i] = seed;
      this.landTick[i] = landTick;
      this.status[i] = status;
      this.liveCount++;
      this.dirty = true;
      return i;
    }
    return -1;
  }

  remove(i: number): void {
    if (this.owner[i] === 0) return;
    this.owner[i] = 0;
    this.seed[i] = 0;
    this.landTick[i] = 0;
    this.status[i] = 0;
    this.liveCount--;
    this.dirty = true;
  }

  rebuildIndex(): void {
    let live = 0;
    for (let i = 0; i < BEACHHEAD_CAPACITY; i++) if (this.owner[i] !== 0) live++;
    this.liveCount = live;
    this.dirty = true;
  }
}

/** Folds the stored part of both tables into a running hash: the free list, then the live slots by ascending id (the route only up to routeLen). */
export function foldHelis(h: number, t: HeliTable, b: BeachheadTable): number {
  let x = foldWord(h, t.highWater);
  x = foldWord(x, t.recycledCount);
  for (let i = 0; i < t.recycledCount; i++) x = foldWord(x, t.recycled[i] as number);
  x = foldWord(x, t.liveCount);
  for (let id = 0; id < t.highWater; id++) {
    if (t.owner[id] === 0) continue;
    x = foldWord(x, id);
    x = foldWord(x, t.owner[id] as number);
    x = foldWord(x, t.state[id] as number);
    x = foldWord(x, t.factory[id] as number);
    x = foldWord(x, t.readyTick[id] as number);
    x = foldWord(x, t.stateTick[id] as number);
    x = foldWord(x, t.x[id] as number);
    x = foldWord(x, t.y[id] as number);
    x = foldWord(x, t.alt[id] as number);
    x = foldWord(x, t.hp[id] as number);
    x = foldWord(x, t.load[id] as number);
    x = foldWord(x, t.fuel[id] as number);
    x = foldWord(x, t.mode[id] as number);
    x = foldWord(x, t.target[id] as number);
    const len = t.routeLen[id] as number;
    x = foldWord(x, len);
    x = foldWord(x, t.routeIdx[id] as number);
    for (let k = 0; k < len; k++) x = foldWord(x, t.route[id * HELI_ROUTE_CAPACITY + k] as number);
  }
  x = foldWord(x, b.liveCount);
  for (let i = 0; i < BEACHHEAD_CAPACITY; i++) {
    if (b.owner[i] === 0) continue;
    x = foldWord(x, i);
    x = foldWord(x, b.owner[i] as number);
    x = foldWord(x, b.seed[i] as number);
    x = foldWord(x, b.landTick[i] as number);
    x = foldWord(x, b.status[i] as number);
  }
  return x;
}
