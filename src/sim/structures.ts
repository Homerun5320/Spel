// The structure table (M09 part A): every City, Factory, Port, Silo, SAM and Defense Post of a match, in structure-of-arrays form
// with a deterministic free list. Game state: serialised and hashed (src/sim/serialize.ts). The per-cell index `byCell` and the
// per-owner counts are DERIVED: never hashed or serialised, rebuilt by `rebuildIndex` when a state is deserialised.
//
// Free list: a slot is free when its owner is 0. `highWater` slots have been used at some time; a deleted id goes on the
// `recycled` stack and the next Build takes the top of the stack, else the next never-used slot. That makes the id a pure function
// of the history, and the whole free list is `highWater` plus the stack (both hashed and serialised), so a restored table
// allocates exactly as the straight run does.
import { BUILD_TICKS, DELETE_COOLDOWN_TICKS, DISTRICT_MAX_SLOTS, LEVEL_CONQUEST_KEEP_PCT, MILLI_GOLD_PER_GOLD, STRUCT_CAPACITY } from './rules';
import { DISTRICT_KIND_SLOTS, districtSlotsOf, type DistrictView } from './districtRules';
import { foldBytes, foldU32, foldWord } from './hash';
import { REJECT_NONE, REJECT_PHASE } from './intents';
import { PHASE_SPAWN, phaseAt } from './flow';
import {
  STRUCT_TYPE_SLOTS,
  buildPriceMilli,
  checkBuild,
  checkDelete,
  checkUpgrade,
  upgradePriceGold,
  upgradeTicksOf,
  type BuildSource,
  type StructureView,
} from './structureRules';
import { seatToOwner, type GameState } from './state';
import { STRUCT_CITY, STRUCT_FACTORY, STRUCT_PORT } from './structureRules';
import { scrapFactoryHelis } from './heliPhase';

export class StructureTable implements StructureView, DistrictView {
  readonly capacity = STRUCT_CAPACITY;
  highWater = 0;
  liveCount = 0;
  readonly type = new Uint8Array(STRUCT_CAPACITY);
  readonly owner = new Uint16Array(STRUCT_CAPACITY);
  readonly cell = new Int32Array(STRUCT_CAPACITY);
  readonly level = new Uint16Array(STRUCT_CAPACITY);
  readonly buildTick = new Uint32Array(STRUCT_CAPACITY);
  readonly readyTick = new Uint32Array(STRUCT_CAPACITY);
  readonly upgradeReadyTick = new Uint32Array(STRUCT_CAPACITY);
  /** M12b: the tick from which a SAM site may fire its next salvo (0 = at once). State: serialised and hashed. */
  readonly salvoTick = new Uint32Array(STRUCT_CAPACITY);
  /** The deleted ids waiting for reuse (a stack: the top is `recycled[recycledCount - 1]`). */
  readonly recycled = new Uint16Array(STRUCT_CAPACITY);
  recycledCount = 0;
  /** Per ownerId: the tick from which that owner may Delete again. Game state. */
  readonly deleteReady: Uint32Array;
  /** Game state: embargo flag per (ownerId a, ownerId b), index a * slots + b, kept symmetric by `setEmbargo`. Nothing sets it before the diplomacy milestone; trade reads it. */
  readonly embargo: Uint8Array;
  /** Game state (Districts-1): the district of slot `slot` of structure `id` is at index id * DISTRICT_MAX_SLOTS + slot; kind 0 = an empty slot. Cleared with the structure. */
  readonly districtKind = new Uint8Array(STRUCT_CAPACITY * DISTRICT_MAX_SLOTS);
  readonly districtLevel = new Uint16Array(STRUCT_CAPACITY * DISTRICT_MAX_SLOTS);
  readonly districtReadyTick = new Uint32Array(STRUCT_CAPACITY * DISTRICT_MAX_SLOTS);
  readonly districtUpgradeReadyTick = new Uint32Array(STRUCT_CAPACITY * DISTRICT_MAX_SLOTS);
  /** Derived: districts alive in total, and per (ownerId, kind) at ownerId * DISTRICT_KIND_SLOTS + kind. */
  districtCount = 0;
  readonly districtCounts: Uint16Array;
  /** Derived: the effect cache of the districts per ownerId (src/sim/structureEffects.ts): the Housing troop cap in QT and the Barracks regeneration percent. */
  readonly effHousingQt: Uint32Array;
  readonly effBarracksPct: Uint32Array;
  /** Scratch for the Walls scan of an attack: cell and percent of the target's finished Walls. */
  readonly wallCells = new Int32Array(STRUCT_CAPACITY);
  readonly wallPcts = new Uint16Array(STRUCT_CAPACITY);
  wallCount = 0;
  /** Derived: the effect cache (src/sim/structureEffects.ts). Dirty on every change of the table; also recomputed when `effNextTick` is reached. */
  effDirty = true;
  effNextTick = 0;
  readonly effCityLevels: Uint32Array;
  /** Derived (Sim-Growth): finished Cities per owner, and the troop cap their levels above 1 add in QT. */
  readonly effCityCount: Uint32Array;
  readonly effCityStepQt: Uint32Array;
  readonly effFixedMilli: Uint32Array;
  readonly effPortMilli: Uint32Array;
  /** Scratch for the Defense Post scan of an attack (cells of the target's finished Posts). */
  readonly postCells = new Int32Array(STRUCT_CAPACITY);
  postCount = 0;
  /** Derived: id + 1 of the structure on each cell, 0 = none. */
  readonly byCell: Uint16Array;
  /** Derived: structures per (ownerId, type), index ownerId * STRUCT_TYPE_SLOTS + type. */
  readonly counts: Uint16Array;
  private readonly slots: number;

  constructor(cells: number, ownerSlotCount: number) {
    this.slots = ownerSlotCount;
    this.deleteReady = new Uint32Array(ownerSlotCount);
    this.embargo = new Uint8Array(ownerSlotCount * ownerSlotCount);
    this.effCityLevels = new Uint32Array(ownerSlotCount);
    this.effCityCount = new Uint32Array(ownerSlotCount);
    this.effCityStepQt = new Uint32Array(ownerSlotCount);
    this.effFixedMilli = new Uint32Array(ownerSlotCount);
    this.effPortMilli = new Uint32Array(ownerSlotCount);
    this.byCell = new Uint16Array(cells);
    this.counts = new Uint16Array(ownerSlotCount * STRUCT_TYPE_SLOTS);
    this.districtCounts = new Uint16Array(ownerSlotCount * DISTRICT_KIND_SLOTS);
    this.effHousingQt = new Uint32Array(ownerSlotCount);
    this.effBarracksPct = new Uint32Array(ownerSlotCount);
  }

  districtsOwned(ownerId: number, kind: number): number {
    if (ownerId < 0 || ownerId >= this.slots || kind < 0 || kind >= DISTRICT_KIND_SLOTS) return 0;
    return this.districtCounts[ownerId * DISTRICT_KIND_SLOTS + kind] as number;
  }

  /** Puts a district in a free slot of a live City (the caller has checked the rules). */
  setDistrict(id: number, slot: number, kind: number, level: number, readyTick: number, upgradeReadyTick: number): void {
    const at = id * DISTRICT_MAX_SLOTS + slot;
    const ownerId = this.owner[id] as number;
    if (this.districtKind[at] === 0) {
      this.districtCount++;
      this.districtCounts[ownerId * DISTRICT_KIND_SLOTS + kind] = (this.districtCounts[ownerId * DISTRICT_KIND_SLOTS + kind] as number) + 1;
    }
    this.districtKind[at] = kind;
    this.districtLevel[at] = level;
    this.districtReadyTick[at] = readyTick;
    this.districtUpgradeReadyTick[at] = upgradeReadyTick;
    this.effDirty = true;
  }

  /** Empties one slot (a no-op when it is empty). */
  clearDistrict(id: number, slot: number): void {
    const at = id * DISTRICT_MAX_SLOTS + slot;
    const kind = this.districtKind[at] as number;
    if (kind === 0) return;
    const k = (this.owner[id] as number) * DISTRICT_KIND_SLOTS + kind;
    this.districtCounts[k] = (this.districtCounts[k] as number) - 1;
    this.districtCount--;
    this.districtKind[at] = 0;
    this.districtLevel[at] = 0;
    this.districtReadyTick[at] = 0;
    this.districtUpgradeReadyTick[at] = 0;
    this.effDirty = true;
  }

  /**
   * Conquest of a City (Districts-1): it goes from `from` to `to` at `newLevel`. The districts that fit the new level's slots stay (the highest
   * slot numbers are lost first); one still under construction is lost, a finished one drops one level (at least 1) and loses a running upgrade.
   * Call BEFORE `transfer` (the counts follow the owner that is in the table at that moment).
   */
  conquerDistricts(id: number, to: number, newLevel: number, tick: number): void {
    if (this.districtCount === 0) return;
    const keep = districtSlotsOf(newLevel);
    const from = this.owner[id] as number;
    for (let slot = 0; slot < DISTRICT_MAX_SLOTS; slot++) {
      const at = id * DISTRICT_MAX_SLOTS + slot;
      const kind = this.districtKind[at] as number;
      if (kind === 0) continue;
      if (slot >= keep || tick < (this.districtReadyTick[at] as number)) {
        this.clearDistrict(id, slot);
        continue;
      }
      const level = this.districtLevel[at] as number;
      this.districtLevel[at] = levelAfterConquest(level);
      this.districtUpgradeReadyTick[at] = 0;
      this.districtCounts[from * DISTRICT_KIND_SLOTS + kind] = (this.districtCounts[from * DISTRICT_KIND_SLOTS + kind] as number) - 1;
      this.districtCounts[to * DISTRICT_KIND_SLOTS + kind] = (this.districtCounts[to * DISTRICT_KIND_SLOTS + kind] as number) + 1;
    }
    this.effDirty = true;
  }

  private clearAllDistricts(id: number): void {
    if (this.districtCount === 0) return;
    for (let slot = 0; slot < DISTRICT_MAX_SLOTS; slot++) this.clearDistrict(id, slot);
  }

  idAt(cell: number): number {
    return (this.byCell[cell] as number) - 1;
  }

  ownedCount(ownerId: number, type: number): number {
    if (ownerId < 0 || ownerId >= this.slots || type < 0 || type >= STRUCT_TYPE_SLOTS) return 0;
    return this.counts[ownerId * STRUCT_TYPE_SLOTS + type] as number;
  }

  /** True when trade between the two owners is under embargo. */
  embargoed(a: number, b: number): boolean {
    return a >= 0 && b >= 0 && a < this.slots && b < this.slots && this.embargo[a * this.slots + b] === 1;
  }

  setEmbargo(a: number, b: number, on: boolean): void {
    if (a < 0 || b < 0 || a >= this.slots || b >= this.slots || a === b) return;
    this.embargo[a * this.slots + b] = on ? 1 : 0;
    this.embargo[b * this.slots + a] = on ? 1 : 0;
    this.effDirty = true;
  }

  /** Gives a structure to another owner (conquest): the table keeps its id, cell, build ticks; an upgrade in progress is lost. */
  transfer(id: number, newOwner: number, newLevel: number): void {
    const from = this.owner[id] as number;
    const k = this.type[id] as number;
    this.counts[from * STRUCT_TYPE_SLOTS + k] = (this.counts[from * STRUCT_TYPE_SLOTS + k] as number) - 1;
    this.counts[newOwner * STRUCT_TYPE_SLOTS + k] = (this.counts[newOwner * STRUCT_TYPE_SLOTS + k] as number) + 1;
    this.owner[id] = newOwner;
    this.level[id] = newLevel;
    this.upgradeReadyTick[id] = 0;
    this.effDirty = true;
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
    this.salvoTick[id] = 0;
    this.byCell[cell] = id + 1;
    this.counts[ownerId * STRUCT_TYPE_SLOTS + type] = (this.counts[ownerId * STRUCT_TYPE_SLOTS + type] as number) + 1;
    this.liveCount++;
    this.effDirty = true;
    return id;
  }

  /** Frees a slot and puts it on the recycle stack. */
  remove(id: number): void {
    this.clearAllDistricts(id);
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
    this.salvoTick[id] = 0;
    this.recycled[this.recycledCount++] = id;
    this.liveCount--;
    this.effDirty = true;
  }

  /** Recomputes the derived index and counts from the stored arrays (what deserialize does; tests compare it with the incremental one). */
  rebuildIndex(): void {
    this.byCell.fill(0);
    this.counts.fill(0);
    this.districtCounts.fill(0);
    let districts = 0;
    let live = 0;
    for (let id = 0; id < this.highWater; id++) {
      const o = this.owner[id] as number;
      if (o === 0) continue;
      this.byCell[this.cell[id] as number] = id + 1;
      const k = o * STRUCT_TYPE_SLOTS + (this.type[id] as number);
      this.counts[k] = (this.counts[k] as number) + 1;
      live++;
      for (let slot = 0; slot < DISTRICT_MAX_SLOTS; slot++) {
        const kind = this.districtKind[id * DISTRICT_MAX_SLOTS + slot] as number;
        if (kind === 0) continue;
        this.districtCounts[o * DISTRICT_KIND_SLOTS + kind] = (this.districtCounts[o * DISTRICT_KIND_SLOTS + kind] as number) + 1;
        districts++;
      }
    }
    this.districtCount = districts;
    this.liveCount = live;
    this.effDirty = true;
  }
}

/** Conquest (Sim-Levels2): a conquered structure or district keeps LEVEL_CONQUEST_KEEP_PCT percent of its level, rounded down, at least level 1 (a level 2 drops to 1, 4 to 3, 10 to 7, 100 to 75, 999 to 749). */
export function levelAfterConquest(level: number): number {
  const kept = Math.floor((level * LEVEL_CONQUEST_KEEP_PCT) / 100);
  return kept > 1 ? kept : 1;
}

/** Folds the stored (non-derived) part of the table into a running hash: the free list, the Delete cooldowns, then the live slots by ascending id. */
export function foldStructures(h: number, t: StructureTable): number {
  let x = foldWord(h, t.highWater);
  x = foldWord(x, t.recycledCount);
  for (let i = 0; i < t.recycledCount; i++) x = foldWord(x, t.recycled[i] as number);
  x = foldU32(x, t.deleteReady);
  x = foldBytes(x, t.embargo);
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
    x = foldWord(x, t.salvoTick[id] as number);
  }
  // Districts (Districts-1): the count, then every occupied slot by ascending (id, slot).
  x = foldWord(x, t.districtCount);
  if (t.districtCount > 0) {
    for (let id = 0; id < t.highWater; id++) {
      for (let slot = 0; slot < DISTRICT_MAX_SLOTS; slot++) {
        const at = id * DISTRICT_MAX_SLOTS + slot;
        const kind = t.districtKind[at] as number;
        if (kind === 0) continue;
        x = foldWord(x, at);
        x = foldWord(x, kind);
        x = foldWord(x, t.districtLevel[at] as number);
        x = foldWord(x, t.districtReadyTick[at] as number);
        x = foldWord(x, t.districtUpgradeReadyTick[at] as number);
      }
    }
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

/** Match flow (D92, Fix-Sim): like Attack, Build / Upgrade / Delete are refused with REJECT_PHASE while a match with a spawn phase is in it. */
export function spawnPhaseRefuses(state: GameState): boolean {
  return state.header.config.spawnPhase === true && phaseAt(state.tick) === PHASE_SPAWN;
}

/** Applies a Build: the placement rules (checkBuild), then the price is taken and the structure enters the table. Returns REJECT_NONE or the reason. */
export function applyBuild(state: GameState, seat: number, type: number, cell: number): number {
  if (spawnPhaseRefuses(state)) return REJECT_PHASE;
  const ownerId = seatToOwner(seat);
  const why = checkBuild(new StateBuildSource(state), state.gold[ownerId] as number, seat, type, cell);
  if (why !== REJECT_NONE) return why;
  state.gold[ownerId] = (state.gold[ownerId] as number) - buildPriceMilli(state.structures, ownerId, type);
  state.structures.add(type, ownerId, cell, state.tick);
  state.match.built[ownerId] = ((state.match.built[ownerId] as number) + 1) >>> 0;
  return REJECT_NONE;
}

/** Applies an Upgrade: pays base * (level + 1) and starts the upgrade, which finishes after the type's build time. */
export function applyUpgrade(state: GameState, seat: number, id: number): number {
  if (spawnPhaseRefuses(state)) return REJECT_PHASE;
  const t = state.structures;
  const ownerId = seatToOwner(seat);
  const why = checkUpgrade(t, state.tick, state.gold[ownerId] as number, seat, id);
  if (why !== REJECT_NONE) return why;
  const type = t.type[id] as number;
  state.gold[ownerId] = (state.gold[ownerId] as number) - upgradePriceGold(type, (t.level[id] as number) + 1) * MILLI_GOLD_PER_GOLD;
  t.upgradeReadyTick[id] = state.tick + upgradeTicksOf(type, (t.level[id] as number) + 1);
  return REJECT_NONE;
}

/** Applies a Delete: the structure goes (no refund) and the seat's cooldown starts. */
export function applyDelete(state: GameState, seat: number, id: number): number {
  if (spawnPhaseRefuses(state)) return REJECT_PHASE;
  const why = checkDelete(state.structures, state.tick, seat, id);
  if (why !== REJECT_NONE) return why;
  if (state.structures.type[id] === STRUCT_FACTORY) scrapFactoryHelis(state, id);
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
      t.effDirty = true;
    }
  }
  if (t.districtCount === 0) return;
  for (let at = 0; at < t.highWater * DISTRICT_MAX_SLOTS; at++) {
    const ready = t.districtUpgradeReadyTick[at] as number;
    if (ready !== 0 && tick >= ready) {
      t.districtLevel[at] = (t.districtLevel[at] as number) + 1;
      t.districtUpgradeReadyTick[at] = 0;
      t.effDirty = true;
    }
  }
}

/**
 * Conquest (M09 part B): the cell of a structure has just changed owner to `newOwner` (0 = freed). City, Factory and Port go to the
 * new owner one level lower (at least 1); Silo, SAM and Post are destroyed. Called by changeOwner, so it covers the enclave flip too.
 */
export function structureCellChanged(state: GameState, cell: number, newOwner: number): void {
  const t = state.structures;
  const id = (t.byCell[cell] as number) - 1;
  if (id < 0) return;
  const type = t.type[id] as number;
  // M12a-1 (provisional): a Factory that changes hands or is destroyed scraps the helicopters queued or parked in it, without a refund.
  if (type === STRUCT_FACTORY) scrapFactoryHelis(state, id);
  if (newOwner !== 0 && (type === STRUCT_CITY || type === STRUCT_FACTORY || type === STRUCT_PORT)) {
    const level = t.level[id] as number;
    const newLevel = levelAfterConquest(level);
    if (type === STRUCT_CITY) t.conquerDistricts(id, newOwner, newLevel, state.tick);
    t.transfer(id, newOwner, newLevel);
  } else {
    t.remove(id);
  }
}
