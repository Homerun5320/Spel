// The district rules that UI and AI may read (Districts-1): the kind numbers, the prices, the effect numbers of one district and the three
// checks. Pure and read-only like structureRules.ts: everything takes a read-only window (`DistrictView`, `StructureView`) and returns numbers.
// The sim's own district intents (src/sim/districts.ts) call `checkBuildDistrict` / `checkUpgradeDistrict` / `checkRemoveDistrict` below, the SAME
// functions `validateBuildDistrict` / `validateUpgradeDistrict` / `validateRemoveDistrict` wrap, so there is one implementation.
import {
  BARRACKS_REGEN_PCT_BY_LEVEL,
  DISTRICT_BASE_GOLD,
  DISTRICT_MAX_LEVEL,
  DISTRICT_MAX_SLOTS,
  DISTRICT_SLOTS_BY_LEVEL,
  HOUSING_TROOPS_PER_LEVEL,
  MARKET_GOLD_MILLI_BY_LEVEL,
  MILLI_GOLD_PER_GOLD,
  PRICE_ESCALATION_MAX_HALVES,
  PRICE_ESCALATION_ONE_HALVES,
  WALLS_COST_PCT_BY_LEVEL,
} from './rules';
import {
  REJECT_BUILD_GOLD,
  REJECT_DELETE_COOLDOWN,
  REJECT_DISTRICT_CITY_BUILDING,
  REJECT_DISTRICT_EMPTY,
  REJECT_DISTRICT_KIND,
  REJECT_DISTRICT_NOT_CITY,
  REJECT_DISTRICT_OCCUPIED,
  REJECT_DISTRICT_SLOT,
  REJECT_NONE,
  REJECT_STRUCT_BUSY,
  REJECT_STRUCT_ID,
  REJECT_STRUCT_MAX_LEVEL,
  REJECT_STRUCT_NOT_OWNER,
} from './intents';
import { seatToOwner } from './state';
import { STRUCT_CITY, type StructureView } from './structureRules';
import type { SimView } from './view';

/** District kinds. 0 = an empty slot. The numbers are on the wire (BuildDistrict.districtKind) and in the table. */
export const DISTRICT_NONE = 0;
export const DISTRICT_HOUSING = 1;
export const DISTRICT_MARKET = 2;
export const DISTRICT_BARRACKS = 3;
export const DISTRICT_WALLS = 4;
/** Number of kind numbers including 0 (the length of the per-kind arrays of rules.ts). */
export const DISTRICT_KIND_SLOTS = 5;

interface Numbers {
  readonly length: number;
  readonly [index: number]: number;
}

/**
 * The read-only window onto the district table. The arrays are indexed `structureId * DISTRICT_MAX_SLOTS + slot`; an empty slot has kind 0.
 * A district whose `readyTick` has not come is under construction (no effect yet); `upgradeReadyTick` not 0 is a running upgrade (the level
 * is the finished one).
 */
export interface DistrictView {
  readonly districtKind: Numbers;
  readonly districtLevel: Numbers;
  readonly districtReadyTick: Numbers;
  readonly districtUpgradeReadyTick: Numbers;
  /** How many districts of `kind` the ownerId owns (finished or not). */
  districtsOwned(ownerId: number, kind: number): number;
}

export function isDistrictKind(kind: unknown): kind is number {
  return typeof kind === 'number' && Number.isInteger(kind) && kind >= DISTRICT_HOUSING && kind <= DISTRICT_WALLS;
}

/** The slots of a City of `level` (0 for a level outside 1..3). */
export function districtSlotsOf(level: number): number {
  return (DISTRICT_SLOTS_BY_LEVEL[level] as number | undefined) ?? 0;
}

/** Price in gold of the next district of `kind` for an owner that owns `owned` of it: base * min(12, 2 + n) / 2, the structure escalation. */
export function districtBuildPriceGold(kind: number, owned: number): number {
  const halves = PRICE_ESCALATION_ONE_HALVES + owned;
  const capped = halves > PRICE_ESCALATION_MAX_HALVES ? PRICE_ESCALATION_MAX_HALVES : halves;
  return Math.floor(((DISTRICT_BASE_GOLD[kind] as number) * capped) / PRICE_ESCALATION_ONE_HALVES);
}

/** Price in gold of an upgrade of a district of `kind` to `level` (2..DISTRICT_MAX_LEVEL): base * level. */
export function districtUpgradePriceGold(kind: number, level: number): number {
  return (DISTRICT_BASE_GOLD[kind] as number) * level;
}

/** The price of the next district of `kind` for an ownerId in milli-gold. */
export function districtBuildPriceMilli(districts: DistrictView, ownerId: number, kind: number): number {
  return districtBuildPriceGold(kind, districts.districtsOwned(ownerId, kind)) * MILLI_GOLD_PER_GOLD;
}

/** What a FINISHED district of `kind` and `level` gives, in the units of rules.ts; the UI shows these and never hard-codes them. */
export interface DistrictEffect {
  /** Market: milli-gold per second. */
  readonly goldMilliPerSec: number;
  /** Housing: troops added to the cap. */
  readonly capTroops: number;
  /** Barracks: percent added to the troop regeneration. */
  readonly regenPct: number;
  /** Walls: the attacker's cell price in percent (100 = none). */
  readonly wallsCostPct: number;
}

const NO_EFFECT: DistrictEffect = Object.freeze({ goldMilliPerSec: 0, capTroops: 0, regenPct: 0, wallsCostPct: 100 });
const EFFECTS: DistrictEffect[][] = [];
for (let kind = 0; kind < DISTRICT_KIND_SLOTS; kind++) {
  const row: DistrictEffect[] = [];
  row.push(NO_EFFECT); // level 0: no district
  for (let level = 1; level <= DISTRICT_MAX_LEVEL; level++) {
    row.push(
      Object.freeze({
        goldMilliPerSec: kind === DISTRICT_MARKET ? (MARKET_GOLD_MILLI_BY_LEVEL[level] as number) : 0,
        capTroops: kind === DISTRICT_HOUSING ? HOUSING_TROOPS_PER_LEVEL * level : 0,
        regenPct: kind === DISTRICT_BARRACKS ? (BARRACKS_REGEN_PCT_BY_LEVEL[level] as number) : 0,
        wallsCostPct: kind === DISTRICT_WALLS ? (WALLS_COST_PCT_BY_LEVEL[level] as number) : 100,
      }),
    );
  }
  EFFECTS.push(row);
}

/** The effect numbers of a district (a shared frozen object, no allocation); a kind or level outside the tables gives "nothing". */
export function districtEffect(kind: number, level: number): DistrictEffect {
  const row = EFFECTS[kind];
  return row === undefined ? NO_EFFECT : (row[level] ?? NO_EFFECT);
}

/** The slot index into the table arrays. */
export function districtIndex(structure: number, slot: number): number {
  return structure * DISTRICT_MAX_SLOTS + slot;
}

/** The City checks every district intent shares: the id exists, is the seat's and is a City. Returns REJECT_NONE or the reason. */
function checkCity(structures: StructureView, seat: number, id: number): number {
  if (!Number.isInteger(id) || id < 0 || id >= structures.highWater || structures.owner[id] === 0) return REJECT_STRUCT_ID;
  if (structures.owner[id] !== seatToOwner(seat)) return REJECT_STRUCT_NOT_OWNER;
  if (structures.type[id] !== STRUCT_CITY) return REJECT_DISTRICT_NOT_CITY;
  return REJECT_NONE;
}

function checkSlot(structures: StructureView, id: number, slot: number): number {
  if (!Number.isInteger(slot) || slot < 0 || slot >= DISTRICT_MAX_SLOTS || slot >= districtSlotsOf(structures.level[id] as number)) return REJECT_DISTRICT_SLOT;
  return REJECT_NONE;
}

/**
 * BuildDistrict rules, in this order: the kind, the City exists / is the seat's / is a City, the slot exists at the City's level, the City is
 * finished, the slot is free, the purse pays. (The spawn phase gate is the sim's, `applyBuildDistrict`, like Build.)
 */
export function checkBuildDistrict(structures: StructureView, districts: DistrictView, tick: number, goldMilli: number, seat: number, id: number, slot: number, kind: number): number {
  if (!isDistrictKind(kind)) return REJECT_DISTRICT_KIND;
  const city = checkCity(structures, seat, id);
  if (city !== REJECT_NONE) return city;
  const bad = checkSlot(structures, id, slot);
  if (bad !== REJECT_NONE) return bad;
  if (tick < (structures.readyTick[id] as number)) return REJECT_DISTRICT_CITY_BUILDING;
  if (districts.districtKind[districtIndex(id, slot)] !== DISTRICT_NONE) return REJECT_DISTRICT_OCCUPIED;
  if (goldMilli < districtBuildPriceMilli(districts, seatToOwner(seat), kind)) return REJECT_BUILD_GOLD;
  return REJECT_NONE;
}

/** UpgradeDistrict rules: the City checks, the slot exists, it holds a district, below the top level, finished and idle, the purse pays. */
export function checkUpgradeDistrict(structures: StructureView, districts: DistrictView, tick: number, goldMilli: number, seat: number, id: number, slot: number): number {
  const city = checkCity(structures, seat, id);
  if (city !== REJECT_NONE) return city;
  const bad = checkSlot(structures, id, slot);
  if (bad !== REJECT_NONE) return bad;
  const at = districtIndex(id, slot);
  const kind = districts.districtKind[at] as number;
  if (kind === DISTRICT_NONE) return REJECT_DISTRICT_EMPTY;
  const level = districts.districtLevel[at] as number;
  if (level >= DISTRICT_MAX_LEVEL) return REJECT_STRUCT_MAX_LEVEL;
  if (tick < (districts.districtReadyTick[at] as number) || (districts.districtUpgradeReadyTick[at] as number) !== 0) return REJECT_STRUCT_BUSY;
  if (goldMilli < districtUpgradePriceGold(kind, level + 1) * MILLI_GOLD_PER_GOLD) return REJECT_BUILD_GOLD;
  return REJECT_NONE;
}

/** RemoveDistrict rules: the City checks, the slot exists, it holds a district, the seat's Delete cooldown has run out. */
export function checkRemoveDistrict(structures: StructureView, districts: DistrictView, tick: number, deleteReadyTick: number, seat: number, id: number, slot: number): number {
  const city = checkCity(structures, seat, id);
  if (city !== REJECT_NONE) return city;
  const bad = checkSlot(structures, id, slot);
  if (bad !== REJECT_NONE) return bad;
  if (districts.districtKind[districtIndex(id, slot)] === DISTRICT_NONE) return REJECT_DISTRICT_EMPTY;
  if (tick < deleteReadyTick) return REJECT_DELETE_COOLDOWN;
  return REJECT_NONE;
}

/** Why `seat` could not build a district of `kind` in slot `slot` of its City `structureId` right now in the snapshot `view` (REJECT_NONE = it could). */
export function validateBuildDistrict(view: SimView, seat: number, structureId: number, slot: number, kind: number): number {
  return checkBuildDistrict(view.structures, view.districts, view.tick, view.stats.goldMilli[seat] as number, seat, structureId, slot, kind);
}

/** Why `seat` could not upgrade the district in slot `slot` of its City `structureId` right now. */
export function validateUpgradeDistrict(view: SimView, seat: number, structureId: number, slot: number): number {
  return checkUpgradeDistrict(view.structures, view.districts, view.tick, view.stats.goldMilli[seat] as number, seat, structureId, slot);
}

/** Why `seat` could not remove the district in slot `slot` of its City `structureId` right now. */
export function validateRemoveDistrict(view: SimView, seat: number, structureId: number, slot: number): number {
  return checkRemoveDistrict(view.structures, view.districts, view.tick, view.structures.deleteReadyTick(seatToOwner(seat)), seat, structureId, slot);
}
