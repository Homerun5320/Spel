// The ship table (M13c-1): transport ships that carry troops over water to a coast. GAME STATE: serialised and hashed (src/sim/serialize.ts).
//
// Structure-of-arrays, SHIP_CAPACITY slots, owner 0 = a free slot. A new ship takes the LOWEST free slot (a scan of 32; the free list is therefore a pure function of the
// live rows and needs no stored word, as the beachhead table). A ship exists from LaunchShip until it has docked again and its Port has cooled down (SHIP_OFF) or it is scrapped.
//
// The route is the string-pulled water route of src/sim/shipRoute.ts: `routeLen` waypoints (sim cells, at most SHIP_ROUTE_CAPACITY) at `route[id * SHIP_ROUTE_CAPACITY ...]`,
// waypoint 0 is the water cell next to the Port. Positions are Q8 fixed point in sim cells (the centre of cell (cx, cy) is (cx * 256 + 128, cy * 256 + 128)), as for helicopters.
// `routeIdx` is the index of the waypoint the ship sails TO while it sails out (SHIP_SAIL) and the index of the waypoint it has just LEFT + 1 while it returns (SHIP_RETURN):
// the next waypoint then is `routeIdx - 1`, and the ship is home when routeIdx is 0.
import { SHIP_CAPACITY, SHIP_ROUTE_CAPACITY } from './rules';
import { foldWord } from './hash';

/** Ship states. 0 is "no ship" (a free slot). Own names; the order is the wire order, append only. */
export const SHIP_NONE = 0;
/** Sailing along the route towards the landing cell. */
export const SHIP_SAIL = 1;
/** At the end of the route, unloading (SHIP_LAND_TICKS); then the cells are taken. */
export const SHIP_LAND = 2;
/** Sailing back along the route to the home Port. */
export const SHIP_RETURN = 3;
/** Docked in the home Port, cooling down (SHIP_COOLDOWN_TICKS): the Port is blocked and the row goes away when the time is up. */
export const SHIP_OFF = 4;
export const SHIP_STATE_MAX = 4;

// The causes of an OUTBOX_SHIP_SCRAPPED event (`b`) and of an OUTBOX_SHIP_RTB event.
/** Scrapped because its owner was eliminated (the load is lost). */
export const SHIP_SCRAP_ELIMINATED = 1;
/** Scrapped because the home Port was lost or deleted and the ship had nowhere to dock (the load is lost). */
export const SHIP_SCRAP_NO_PORT = 2;
/** The ship turned back because a truce or an alliance now binds its owner to the owner of the landing cell. */
export const SHIP_RTB_TREATY = 1;
/** The ship turned back because its mission is over (the landing was made or could not be made). */
export const SHIP_RTB_MISSION = 0;

/** The read-only window onto the ship table (what `SimView.ships` is). Arrays are indexed by ship id; owner 0 = a free slot. */
export interface ShipView {
  readonly capacity: number;
  /** Ships alive (also a docked one that cools down). */
  readonly liveCount: number;
  /** ownerId (0 = free slot). */
  readonly owner: ArrayLike<number>;
  /** SHIP_* state. */
  readonly state: ArrayLike<number>;
  /** The id of the home Port in the structure table. */
  readonly port: ArrayLike<number>;
  /** The tick the current state began. */
  readonly stateTick: ArrayLike<number>;
  /** Position in Q8 cells. */
  readonly x: ArrayLike<number>;
  readonly y: ArrayLike<number>;
  /** Troops carried (whole troops). */
  readonly load: ArrayLike<number>;
  /** The landing cell + 1, 0 = none (the ship is on its way home or docked). */
  readonly target: ArrayLike<number>;
  /** The route: `routeLen[id]` waypoints, `routeCell(id, k)` the k-th. */
  readonly routeLen: ArrayLike<number>;
  readonly routeIdx: ArrayLike<number>;
  routeCell(id: number, k: number): number;
  /** The cell the ship is over now (from its Q8 position and the map width). */
  cellOf(id: number, width: number): number;
  /** Ships of an ownerId, also a docked one that cools down (the fleet count). */
  countOf(ownerId: number): number;
}

export class ShipTable implements ShipView {
  readonly capacity = SHIP_CAPACITY;
  liveCount = 0;
  readonly owner = new Uint16Array(SHIP_CAPACITY);
  readonly state = new Uint8Array(SHIP_CAPACITY);
  readonly port = new Uint16Array(SHIP_CAPACITY);
  /** The cell of the home Port at departure: the ship docks only in a Port of its owner on that cell. */
  readonly portCell = new Int32Array(SHIP_CAPACITY);
  readonly stateTick = new Uint32Array(SHIP_CAPACITY);
  readonly x = new Int32Array(SHIP_CAPACITY);
  readonly y = new Int32Array(SHIP_CAPACITY);
  readonly load = new Uint16Array(SHIP_CAPACITY);
  readonly target = new Uint32Array(SHIP_CAPACITY);
  readonly routeLen = new Uint8Array(SHIP_CAPACITY);
  readonly routeIdx = new Uint8Array(SHIP_CAPACITY);
  readonly route = new Int32Array(SHIP_CAPACITY * SHIP_ROUTE_CAPACITY);
  /** Derived: ships per ownerId. Rebuilt by `rebuildIndex`. */
  private readonly counts: Uint16Array;

  constructor(ownerSlotCount: number) {
    this.counts = new Uint16Array(ownerSlotCount);
  }

  countOf(ownerId: number): number {
    return ownerId >= 0 && ownerId < this.counts.length ? (this.counts[ownerId] as number) : 0;
  }

  routeCell(id: number, k: number): number {
    return this.route[id * SHIP_ROUTE_CAPACITY + k] as number;
  }

  cellOf(id: number, width: number): number {
    return ((this.y[id] as number) >> 8) * width + ((this.x[id] as number) >> 8);
  }

  /** The lowest free slot, or -1 when the table is full. */
  freeSlot(): number {
    for (let i = 0; i < SHIP_CAPACITY; i++) if (this.owner[i] === 0) return i;
    return -1;
  }

  /** The id of the ship of Port `port` (any state), or -1. */
  atPort(port: number): number {
    for (let i = 0; i < SHIP_CAPACITY; i++) if (this.owner[i] !== 0 && this.port[i] === port) return i;
    return -1;
  }

  /** Puts a ship in slot `id` (a free one; the caller has checked the rules and filled the route afterwards). */
  add(id: number, ownerId: number, port: number, portCell: number, tick: number, load: number, target: number): void {
    this.owner[id] = ownerId;
    this.state[id] = SHIP_SAIL;
    this.port[id] = port;
    this.portCell[id] = portCell;
    this.stateTick[id] = tick;
    this.load[id] = load;
    this.target[id] = target;
    this.routeLen[id] = 0;
    this.routeIdx[id] = 0;
    this.counts[ownerId] = (this.counts[ownerId] as number) + 1;
    this.liveCount++;
  }

  /** Frees a slot (its route too). */
  remove(id: number): void {
    const ownerId = this.owner[id] as number;
    if (ownerId === 0) return;
    this.counts[ownerId] = (this.counts[ownerId] as number) - 1;
    this.owner[id] = 0;
    this.state[id] = SHIP_NONE;
    this.port[id] = 0;
    this.portCell[id] = 0;
    this.stateTick[id] = 0;
    this.x[id] = 0;
    this.y[id] = 0;
    this.load[id] = 0;
    this.target[id] = 0;
    this.routeLen[id] = 0;
    this.routeIdx[id] = 0;
    this.route.fill(0, id * SHIP_ROUTE_CAPACITY, (id + 1) * SHIP_ROUTE_CAPACITY);
    this.liveCount--;
  }

  /** Recomputes the derived counts from the stored arrays (what deserialize does). */
  rebuildIndex(): void {
    this.counts.fill(0);
    let live = 0;
    for (let id = 0; id < SHIP_CAPACITY; id++) {
      const o = this.owner[id] as number;
      if (o === 0) continue;
      this.counts[o] = (this.counts[o] as number) + 1;
      live++;
    }
    this.liveCount = live;
  }
}

/** Folds the stored part of the table into a running hash: the live slots by ascending id (the route only up to routeLen). */
export function foldShips(h: number, t: ShipTable): number {
  let x = foldWord(h, t.liveCount);
  for (let id = 0; id < SHIP_CAPACITY; id++) {
    if (t.owner[id] === 0) continue;
    x = foldWord(x, id);
    x = foldWord(x, t.owner[id] as number);
    x = foldWord(x, t.state[id] as number);
    x = foldWord(x, t.port[id] as number);
    x = foldWord(x, t.portCell[id] as number);
    x = foldWord(x, t.stateTick[id] as number);
    x = foldWord(x, t.x[id] as number);
    x = foldWord(x, t.y[id] as number);
    x = foldWord(x, t.load[id] as number);
    x = foldWord(x, t.target[id] as number);
    const len = t.routeLen[id] as number;
    x = foldWord(x, len);
    x = foldWord(x, t.routeIdx[id] as number);
    for (let k = 0; k < len; k++) x = foldWord(x, t.route[id * SHIP_ROUTE_CAPACITY + k] as number);
  }
  return x;
}
