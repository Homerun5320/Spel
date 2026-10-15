// The structure table (M09 part A): every City, Factory, Port, Silo, SAM and Defense Post of a match, in structure-of-arrays form
// with a deterministic free list. Game state: serialised and hashed (src/sim/serialize.ts). The per-cell index `byCell` and the
// per-owner counts are DERIVED: never hashed or serialised, rebuilt by `rebuildIndex` when a state is deserialised.
//
// Free list: a slot is free when its owner is 0. `highWater` slots have been used at some time; a deleted id goes on the
// `recycled` stack and the next Build takes the top of the stack, else the next never-used slot. That makes the id a pure function
// of the history, and the whole free list is `highWater` plus the stack (both hashed and serialised), so a restored table
// allocates exactly as the straight run does.
import { BUILD_TICKS, DELETE_COOLDOWN_TICKS, MILLI_GOLD_PER_GOLD, STRUCT_CAPACITY } from './rules';
import { foldU32, foldWord } from './hash';
import { REJECT_NONE } from './intents';
import {
  STRUCT_TYPE_SLOTS,
  buildPriceMilli,
  checkBuild,
  checkDelete,
  checkUpgrade,
  upgradePriceGold,
  type BuildSource,
  type StructureView,
} from './structureRules';
import { seatToOwner, type GameState } from './state';

export class StructureTable implements StructureView {
  readonly capacity = STRUCT_CAPACITY;
  highWater = 0;
  liveCount = 0;
  readonly type = new Uint8Array(STRUCT_CAPACITY);
  readonly owner = new Uint16Array(STRUCT_CAPACITY);
  readonly cell = new Int32Array(STRUCT_CAPACITY);
  readonly level = new Uint8Array(STRUCT_CAPACITY);
  readonly buildTick = new Uint32Array(STRUCT_CAPACITY);
  readonly readyTick = new Uint32Array(STRUCT_CAPACITY);
  readonly upgradeReadyTick = new Uint32Array(STRUCT_CAPACITY);
  /** The deleted ids waiting for reuse (a stack: the top is `recycled[recycledCount - 1]`). */
  readonly recycled = new Uint16Array(STRUCT_CAPACITY);
  recycledCount = 0;
  /** Per ownerId: the tick from which that owner may Delete again. Game state. */
  readonly deleteReady: Uint32Array;
  /** Derived: id + 1 of the structure on each cell, 0 = none. */
  readonly byCell: Uint16Array;
  /** Derived: structures per (ownerId, type), index ownerId * STRUCT_TYPE_SLOTS + type. */
  readonly counts: Uint16Array;
  private readonly slots: number;

  constructor(cells: number, ownerSlotCount: number) {
    this.slots = ownerSlotCount;
    this.deleteReady = new Uint32Array(ownerSlotCount);
    this.byCell = new Uint16Array(cells);
    this.counts = new Uint16Array(ownerSlotCount * STRUCT_TYPE_SLOTS);
  }

  idAt(cell: number): number {
    return (this.byCell[cell] as number) - 1;
  }

  ownedCount(ownerId: number, type: number): number {
    if (ownerId < 0 || ownerId >= this.slots || type < 0 || type >= STRUCT_TYPE_SLOTS) return 0;
    return this.counts[ownerId * STRUCT_TYPE_SLOTS + type] as number;
  }

  deleteReadyTick(ownerId: number): number {
    return ownerId >= 0 && ownerId < this.slots ? (this.deleteReady[ownerId] as number) : 0;
  }

  /** Takes a slot (the top of the recycle stack, else the next unused one); -1 when the table is full. */
  allocId(): number {
    if (this.recycledCount > 0) return this.recycled[--this.recycledCount] as number;
    return this.highWater < STRUCT_CAPACITY ? this.highWater++ : -1;
  }

  /** Puts a structure in the table (the caller has checked the rules). Returns its id, -1 when full. */
  add(type: number, ownerId: number, cell: number, tick: number): number {
    const id = this.allocId();
    if (id < 0) return -1;
    this.type[id] = type;
    this.owner[id] = ownerId;
    this.cell[id] = cell;
    this.level[id] = 1;
    this.buildTick[id] = tick;
    this.readyTick[id] = tick + (BUILD_TICKS[type] as number);
    this.upgradeReadyTick[id] = 0;
    this.byCell[cell] = id + 1;
    this.counts[ownerId * STRUCT_TYPE_SLOTS + type] = (this.counts[ownerId * STRUCT_TYPE_SLOTS + type] as number) + 1;
    this.liveCount++;
    return id;
  }

  /** Frees a slot and puts it on the recycle stack. */
  remove(id: number): void {
    const ownerId = this.owner[id] as number;
    const type = this.type[id] as number;
    this.byCell[this.cell[id] as number] = 0;
    this.counts[ownerId * STRUCT_TYPE_SLOTS + type] = (this.counts[ownerId * STRUCT_TYPE_SLOTS + type] as number) - 1;
    this.owner[id] = 0;
    this.type[id] = 0;
    this.level[id] = 0;
    this.cell[id] = 0;
    this.buildTick[id] = 0;
    this.readyTick[id] = 0;
    this.upgradeReadyTick[id] = 0;
    this.recycled[this.recycledCount++] = id;
    this.liveCount--;
  }

  /** Recomputes the derived index and counts from the stored arrays (what deserialize does; tests compare it with the incremental one). */
  rebuildIndex(): void {
    this.byCell.fill(0);
    this.counts.fill(0);
    let live = 0;
    for (let id = 0; id < this.highWater; id++) {
      const o = this.owner[id] as number;
      if (o === 0) continue;
      this.byCell[this.cell[id] as number] = id + 1;
      const k = o * STRUCT_TYPE_SLOTS + (this.type[id] as number);
      this.counts[k] = (this.counts[k] as number) + 1;
      live++;
    }
    this.liveCount = live;
  }
}

/** Folds the stored (non-derived) part of the table into a running hash: the free list, the Delete cooldowns, then the live slots by ascending id. */
export function foldStructures(h: number, t: StructureTable): number {
  let x = foldWord(h, t.highWater);
  x = foldWord(x, t.recycledCount);
  for (let i = 0; i < t.recycledCount; i++) x = foldWord(x, t.recycled[i] as number);
  x = foldU32(x, t.deleteReady);
  x = foldWord(x, t.liveCount);
  for (let id = 0; id < t.highWater; id++) {
    if (t.owner[id] === 0) continue;
    x = foldWord(x, id);
    x = foldWord(x, t.type[id] as number);
    x = foldWord(x, t.owner[id] as number);
    x = foldWord(x, t.cell[id] as number);
    x = foldWord(x, t.level[id] as number);
    x = foldWord(x, t.buildTick[id] as number);
    x = foldWord(x, t.readyTick[id] as number);
    x = foldWord(x, t.upgradeReadyTick[id] as number);
  }
  return x;
}

/** The state seen as a BuildSource, so the sim's own Build validation runs the very function UI and AI call (`checkBuild`). */
class StateBuildSource implements BuildSource {
  constructor(private readonly state: GameState) {}
  get width(): number {
    return this.state.width;
  }
  get height(): number {
    return this.state.height;
  }
  get tick(): number {
    return this.state.tick;
  }
  get owner(): Uint16Array {
    return this.state.owner;
  }
  get terrainClass(): Uint8Array {
    return this.state.terrain;
  }
  get structures(): StructureTable {
    return this.state.structures;
  }
  /** Fallout arrives with M14; until then no cell is ever contaminated. */
  falloutUntilAt(): number {
    return 0;
  }
}

/** Applies a Build: the placement rules (checkBuild), then the price is taken and the structure enters the table. Returns REJECT_NONE or the reason. */
export function applyBuild(state: GameState, seat: number, type: number, cell: number): number {
  const ownerId = seatToOwner(seat);
  const why = checkBuild(new StateBuildSource(state), state.gold[ownerId] as number, seat, type, cell);
  if (why !== REJECT_NONE) return why;
  state.gold[ownerId] = (state.gold[ownerId] as number) - buildPriceMilli(state.structures, ownerId, type);
  state.structures.add(type, ownerId, cell, state.tick);
  return REJECT_NONE;
}

/** Applies an Upgrade: pays base * (level + 1) and starts the upgrade, which finishes after the type's build time. */
export function applyUpgrade(state: GameState, seat: number, id: number): number {
  const t = state.structures;
  const ownerId = seatToOwner(seat);
  const why = checkUpgrade(t, state.tick, state.gold[ownerId] as number, seat, id);
  if (why !== REJECT_NONE) return why;
  const type = t.type[id] as number;
  state.gold[ownerId] = (state.gold[ownerId] as number) - upgradePriceGold(type, (t.level[id] as number) + 1) * MILLI_GOLD_PER_GOLD;
  t.upgradeReadyTick[id] = state.tick + (BUILD_TICKS[type] as number);
  return REJECT_NONE;
}

/** Applies a Delete: the structure goes (no refund) and the seat's cooldown starts. */
export function applyDelete(state: GameState, seat: number, id: number): number {
  const why = checkDelete(state.structures, state.tick, seat, id);
  if (why !== REJECT_NONE) return why;
  state.structures.remove(id);
  state.structures.deleteReady[seatToOwner(seat)] = state.tick + DELETE_COOLDOWN_TICKS;
  return REJECT_NONE;
}

/** Phase of the tick: a running upgrade whose time has come raises the level. O(highWater), and nothing at all without structures. */
export function structuresPhase(state: GameState): void {
  const t = state.structures;
  if (t.liveCount === 0) return;
  const tick = state.tick;
  for (let id = 0; id < t.highWater; id++) {
    const ready = t.upgradeReadyTick[id] as number;
    if (ready !== 0 && tick >= ready) {
      t.level[id] = (t.level[id] as number) + 1;
      t.upgradeReadyTick[id] = 0;
    }
  }
}
