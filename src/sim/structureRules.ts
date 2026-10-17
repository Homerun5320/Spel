// The structure rules that UI and AI may read (M09 part A): the type numbers, the prices and the placement checks. Pure and
// read-only: everything here takes a read-only window (`StructureView`, `BuildSource`) and returns numbers. The sim's own Build
// validation (src/sim/structures.ts) calls `checkBuild` below, the SAME function `validateBuild` wraps, so there is one implementation.
import { TECH_FX_UPGRADE } from './techTable';
import {
  BUILD_BASE_GOLD,
  AIRFIELD_HELI_TIME_MAX_PCT,
  AIRFIELD_HELI_TIME_PCT_PER_LEVEL,
  BUILD_TICKS,
  HELI_FLEET_AIRFIELD_MAX,
  HELI_FLEET_PER_AIRFIELD_LEVEL,
  LAB_RESEARCH_MAX_PCT,
  LAB_RESEARCH_PCT_PER_LEVEL,
  MAX_PER_OWNER_BY_TYPE,
  MILLI_GOLD_PER_GOLD,
  PLANT_NEAR_CELLS,
  PRICE_ESCALATION_MAX_HALVES,
  PRICE_ESCALATION_ONE_HALVES,
  SPACING_CELLS_BY_TYPE,
  SPACING_SCOPE,
  STRUCT_LEVEL_HARD_CAP,
} from './rules';
import { cityGoldMilliAt, cityTroopCapAt, plantGoldMilliAt } from './levelCurves';
import {
  REJECT_BUILD_FALLOUT,
  REJECT_BUILD_FOREST,
  REJECT_BUILD_FULL,
  REJECT_BUILD_GOLD,
  REJECT_BUILD_HILLS,
  REJECT_BUILD_MAX_COUNT,
  REJECT_BUILD_NO_NEIGHBOUR,
  REJECT_BUILD_MOUNTAIN,
  REJECT_BUILD_NO_COAST,
  REJECT_BUILD_NO_FACTORY,
  REJECT_BUILD_NOT_OWNED,
  REJECT_BUILD_OCCUPIED,
  REJECT_BUILD_PEAK,
  REJECT_BUILD_SPACING,
  REJECT_BUILD_TYPE,
  REJECT_CELL,
  REJECT_DELETE_COOLDOWN,
  REJECT_NONE,
  REJECT_STRUCT_BUSY,
  REJECT_STRUCT_ID,
  REJECT_STRUCT_MAX_LEVEL,
  REJECT_STRUCT_NOT_OWNER,
} from './intents';
import { seatToOwner } from './state';
import type { SimView } from './view';
import { CLASS_DEEP_SEA, CLASS_FOREST, CLASS_HILLS, CLASS_MOUNTAIN, CLASS_PEAK, CLASS_SHALLOWS } from './terrain';

/** Structure types. 0 is "no structure" (a free slot, an empty cell). The numbers are on the wire (Build.type) and in the table. */
export const STRUCT_NONE = 0;
export const STRUCT_CITY = 1;
export const STRUCT_FACTORY = 2;
export const STRUCT_PORT = 3;
export const STRUCT_SILO = 4;
export const STRUCT_SAM = 5;
export const STRUCT_POST = 6;
/** M18e-1: the Airfield (more helicopters, faster helicopter production), the Lab (faster research) and the Plant (a little gold). */
export const STRUCT_AIRFIELD = 7;
export const STRUCT_LAB = 8;
export const STRUCT_PLANT = 9;
/** Number of type numbers including 0 (the length of the per-type arrays of rules.ts). */
export const STRUCT_TYPE_SLOTS = 10;

/** An array you can index and measure but not write to. */
interface Numbers {
  readonly length: number;
  readonly [index: number]: number;
}

/** The read-only window onto the structure table (SoA, indexed by structure id; owner 0 = a free slot). */
export interface StructureView {
  /** Slots of the table. */
  readonly capacity: number;
  /** Slots 0..highWater-1 have been used; the rest never. Iterate to this. */
  readonly highWater: number;
  /** Structures alive (owner not 0). */
  readonly liveCount: number;
  /** Optional change counter (StructureTable.version): lets a sensor cache see a level or owner change inside one tick. */
  readonly version?: number;
  readonly type: Numbers;
  /** ownerId (0 = free slot). */
  readonly owner: Numbers;
  readonly cell: Numbers;
  /** Level 1..maxLevelOf(type) (the finished level; an upgrade in progress is not counted yet). */
  readonly level: Numbers;
  readonly buildTick: Numbers;
  /** The tick at which the structure is finished (works from then on). */
  readonly readyTick: Numbers;
  /** The tick at which a running upgrade finishes, 0 = none. */
  readonly upgradeReadyTick: Numbers;
  /** The structure on a cell, or -1. */
  idAt(cell: number): number;
  /** How many structures of `type` the ownerId owns (finished or not). */
  ownedCount(ownerId: number, type: number): number;
  /** The tick from which the ownerId may Delete again. */
  deleteReadyTick(ownerId: number): number;
}

/** What the placement rules read: a subset of SimView (a SimView is a BuildSource) that the sim can also provide from its state. */
export interface BuildSource {
  readonly width: number;
  readonly height: number;
  readonly tick: number;
  readonly owner: Numbers;
  readonly terrainClass: Numbers;
  readonly structures: StructureView;
  /** The tick until which a cell is fallout (0 = never; the layer is zero until M14). */
  falloutUntilAt(cell: number): number;
}

export function isStructType(type: unknown): type is number {
  return typeof type === 'number' && Number.isInteger(type) && type >= STRUCT_CITY && type <= STRUCT_PLANT;
}

/** Price in gold of the next structure of `type` for a seat that owns `owned` of it: base * min(12, 2 + n) / 2, in integers. */
export function buildPriceGold(type: number, owned: number): number {
  const halves = PRICE_ESCALATION_ONE_HALVES + owned;
  const capped = halves > PRICE_ESCALATION_MAX_HALVES ? PRICE_ESCALATION_MAX_HALVES : halves;
  return Math.floor(((BUILD_BASE_GOLD[type] as number) * capped) / PRICE_ESCALATION_ONE_HALVES);
}

/** The highest level of a structure type: STRUCT_LEVEL_HARD_CAP for every type (Sim-Levels2: unlimited in practice). The one function UI and AI use, never a level count of their own. */
export function maxLevelOf(type: number): number {
  void type; // the same for every type
  return STRUCT_LEVEL_HARD_CAP;
}

/** Gold per second (milli) a FINISHED City of `level` pays before the Factory bonus: 1.5 at level 1, a concave curve towards 3.0 (levelCurves.ts). */
export function cityGoldMilli(level: number): number {
  return cityGoldMilliAt(level);
}

/** Troop cap (troops) a FINISHED City of `level` adds: CAP_CITY_LEVEL_TROOPS at level 1, a concave curve towards 2400 (levelCurves.ts). */
export function cityTroopCap(level: number): number {
  return cityTroopCapAt(level);
}

/** Price in gold of an upgrade to `level` (2..maxLevelOf(type)): base * level for EVERY type, the City included, no escalation. */
export function upgradePriceGold(type: number, level: number): number {
  return (BUILD_BASE_GOLD[type] as number) * level;
}

/** Ticks an upgrade to any level takes: the build time of the type (one rule for all types). */
export function upgradeTicksOf(type: number, level: number): number {
  void level; // the same for every level
  return BUILD_TICKS[type] as number;
}

/** The price of the next structure of `type` for a seat, in milli-gold (what the purse is counted in). */
export function buildPriceMilli(structures: StructureView, ownerId: number, type: number): number {
  return buildPriceGold(type, structures.ownedCount(ownerId, type)) * MILLI_GOLD_PER_GOLD;
}

/** Is the cell next to open water (4 neighbours, x wrapping)? */
export function isCoastCell(width: number, height: number, terrainClass: Numbers, cell: number): boolean {
  const x = cell % width;
  const y = (cell - x) / width;
  const west = y * width + (x === 0 ? width - 1 : x - 1);
  const east = y * width + (x + 1 === width ? 0 : x + 1);
  if (isWater(terrainClass[west] as number) || isWater(terrainClass[east] as number)) return true;
  if (y > 0 && isWater(terrainClass[cell - width] as number)) return true;
  return y + 1 < height && isWater(terrainClass[cell + width] as number);
}

function isWater(cls: number): boolean {
  return cls === CLASS_DEEP_SEA || cls === CLASS_SHALLOWS;
}

/** Is any structure in the spacing scope closer than SPACING_CELLS_BY_TYPE[type] to `cell` (Euclidean in sim cells, x wrapping)? */
export function violatesSpacing(src: BuildSource, ownerId: number, type: number, cell: number): boolean {
  const s = src.structures;
  const w = src.width;
  const x = cell % w;
  const y = (cell - x) / w;
  const spacing = SPACING_CELLS_BY_TYPE[type] as number;
  const limit = spacing * spacing;
  const scope: number = SPACING_SCOPE;
  for (let i = 0; i < s.highWater; i++) {
    const o = s.owner[i] as number;
    if (o === 0) continue;
    if (scope !== 2 && s.type[i] !== type) continue;
    if (scope === 1 && o !== ownerId) continue;
    const c = s.cell[i] as number;
    const sx = c % w;
    let dx = sx > x ? sx - x : x - sx;
    if (w - dx < dx) dx = w - dx;
    const dy = (c - sx) / w - y;
    if (dx * dx + dy * dy < limit) return true;
  }
  return false;
}

/** Does the owner have a FINISHED Factory? */
export function hasFinishedFactory(src: BuildSource, ownerId: number): boolean {
  const s = src.structures;
  for (let i = 0; i < s.highWater; i++) {
    if (s.owner[i] === ownerId && s.type[i] === STRUCT_FACTORY && src.tick >= (s.readyTick[i] as number)) return true;
  }
  return false;
}

/** What the per-owner effect scans read (a SimView and a GameState both have it). */
export interface TickedStructures {
  readonly structures: StructureView;
  readonly tick: number;
}

/** The levels of the owner's FINISHED structures of `type` added up (0 when it owns none: no scan). */
export function finishedLevelSum(src: TickedStructures, ownerId: number, type: number): number {
  const s = src.structures;
  if (s.ownedCount(ownerId, type) === 0) return 0;
  let sum = 0;
  for (let i = 0; i < s.highWater; i++) {
    if (s.owner[i] === ownerId && s.type[i] === type && src.tick >= (s.readyTick[i] as number)) sum += s.level[i] as number;
  }
  return sum;
}

/** M18e-1: helicopters Airfield levels add to the fleet cap: HELI_FLEET_PER_AIRFIELD_LEVEL per level, at most HELI_FLEET_AIRFIELD_MAX. `levels` = the finished levels added up. */
export function airfieldFleetBonusOfLevels(levels: number): number {
  const b = levels * HELI_FLEET_PER_AIRFIELD_LEVEL;
  return b > HELI_FLEET_AIRFIELD_MAX ? HELI_FLEET_AIRFIELD_MAX : b;
}

/** M18e-1: percent Airfield levels shorten the production of a helicopter: AIRFIELD_HELI_TIME_PCT_PER_LEVEL per level, at most AIRFIELD_HELI_TIME_MAX_PCT. */
export function airfieldTimePctOfLevels(levels: number): number {
  const p = levels * AIRFIELD_HELI_TIME_PCT_PER_LEVEL;
  return p > AIRFIELD_HELI_TIME_MAX_PCT ? AIRFIELD_HELI_TIME_MAX_PCT : p;
}

/** M18e-1: percent Lab levels shorten a research that starts now: LAB_RESEARCH_PCT_PER_LEVEL per level, at most LAB_RESEARCH_MAX_PCT. */
export function labResearchPctOfLevels(levels: number): number {
  const p = levels * LAB_RESEARCH_PCT_PER_LEVEL;
  return p > LAB_RESEARCH_MAX_PCT ? LAB_RESEARCH_MAX_PCT : p;
}

/** M18e-1: the helicopters the owner's finished Airfields add to the fleet cap. */
export function airfieldFleetBonusOf(src: TickedStructures, ownerId: number): number {
  return airfieldFleetBonusOfLevels(finishedLevelSum(src, ownerId, STRUCT_AIRFIELD));
}

/** M18e-1: percent the owner's finished Airfields shorten the production of a helicopter. */
export function airfieldTimePctOf(src: TickedStructures, ownerId: number): number {
  return airfieldTimePctOfLevels(finishedLevelSum(src, ownerId, STRUCT_AIRFIELD));
}

/** M18e-1: percent the owner's finished Labs shorten a research that starts now. */
export function labResearchPctOf(src: TickedStructures, ownerId: number): number {
  return labResearchPctOfLevels(finishedLevelSum(src, ownerId, STRUCT_LAB));
}

/** M18e-1: gold per second (milli) of a FINISHED Plant of `level` (before techs): 0.8 at level 1, towards 1.6. */
export function plantGoldMilli(level: number): number {
  return plantGoldMilliAt(level);
}

/** M18e-1: does the owner have a City or Port (finished or not) within PLANT_NEAR_CELLS of `cell`? */
export function hasPlantNeighbour(src: BuildSource, ownerId: number, cell: number): boolean {
  const s = src.structures;
  const w = src.width;
  const x = cell % w;
  const y = (cell - x) / w;
  const limit = PLANT_NEAR_CELLS * PLANT_NEAR_CELLS;
  for (let i = 0; i < s.highWater; i++) {
    if (s.owner[i] !== ownerId) continue;
    const t = s.type[i];
    if (t !== STRUCT_CITY && t !== STRUCT_PORT) continue;
    const c = s.cell[i] as number;
    const sx = c % w;
    let dx = sx > x ? sx - x : x - sx;
    if (w - dx < dx) dx = w - dx;
    const dy = (c - sx) / w - y;
    if (dx * dx + dy * dy <= limit) return true;
  }
  return false;
}

/**
 * THE placement rules. Returns REJECT_NONE or the reason, checking in this order: type, cell, Peak, ownership, the terrain
 * rules (Mountain allows only SAM / Post / Silo; Hills no Port; Forest no Silo), Port on the coast, the cell is free, spacing,
 * fallout, Silo needs a finished Factory of the same owner, the per-owner limit (M18e-1), a Plant needs a City or Port near (M18e-1), the table has room, the purse. `goldMilli` is the seat's gold.
 */
export function checkBuild(src: BuildSource, goldMilli: number, seat: number, type: number, cell: number): number {
  if (!isStructType(type)) return REJECT_BUILD_TYPE;
  if (!Number.isInteger(cell) || cell < 0 || cell >= src.width * src.height) return REJECT_CELL;
  const ownerId = seatToOwner(seat);
  const cls = src.terrainClass[cell] as number;
  if (cls === CLASS_PEAK) return REJECT_BUILD_PEAK;
  if (src.owner[cell] !== ownerId) return REJECT_BUILD_NOT_OWNED;
  if (cls === CLASS_MOUNTAIN && type !== STRUCT_SAM && type !== STRUCT_POST && type !== STRUCT_SILO) return REJECT_BUILD_MOUNTAIN;
  if (cls === CLASS_HILLS && type === STRUCT_PORT) return REJECT_BUILD_HILLS;
  if (cls === CLASS_FOREST && type === STRUCT_SILO) return REJECT_BUILD_FOREST;
  if (type === STRUCT_PORT && !isCoastCell(src.width, src.height, src.terrainClass, cell)) return REJECT_BUILD_NO_COAST;
  if (src.structures.idAt(cell) >= 0) return REJECT_BUILD_OCCUPIED;
  if (violatesSpacing(src, ownerId, type, cell)) return REJECT_BUILD_SPACING;
  if (src.falloutUntilAt(cell) > src.tick) return REJECT_BUILD_FALLOUT;
  if (type === STRUCT_SILO && !hasFinishedFactory(src, ownerId)) return REJECT_BUILD_NO_FACTORY;
  // M18e-1: the per-owner limit (Airfield, Lab, Plant) and the Plant's neighbour rule, before the table and the purse.
  const maxOwned = MAX_PER_OWNER_BY_TYPE[type] as number;
  if (maxOwned !== 0 && src.structures.ownedCount(ownerId, type) >= maxOwned) return REJECT_BUILD_MAX_COUNT;
  if (type === STRUCT_PLANT && !hasPlantNeighbour(src, ownerId, cell)) return REJECT_BUILD_NO_NEIGHBOUR;
  if (src.structures.liveCount >= src.structures.capacity) return REJECT_BUILD_FULL;
  if (goldMilli < buildPriceMilli(src.structures, ownerId, type)) return REJECT_BUILD_GOLD;
  return REJECT_NONE;
}

/** The upgrade price in milli-gold with a technology discount of `discountPct` percent (M18d-1; 0 = the plain `upgradePriceGold` x 1000). */
export function upgradePriceMilliFor(type: number, level: number, discountPct: number): number {
  const full = upgradePriceGold(type, level) * MILLI_GOLD_PER_GOLD;
  return discountPct === 0 ? full : Math.floor((full * (100 - discountPct)) / 100);
}

/** M18d-2: the price in milli-gold that `seat` pays NOW for an upgrade of a `type` to `level` (its researched upgrade discount applied): what the sim debits, what the page and the AI show and compare. */
export function upgradePriceNowMilli(view: SimView, seat: number, type: number, level: number): number {
  return upgradePriceMilliFor(type, level, view.match.techFxOfSeat(seat, TECH_FX_UPGRADE));
}

/** Upgrade rules: the structure exists and is the seat's, is finished and not upgrading, is below the top level, the seat can pay. */
export function checkUpgrade(structures: StructureView, tick: number, goldMilli: number, seat: number, id: number, discountPct = 0): number {
  if (!Number.isInteger(id) || id < 0 || id >= structures.highWater || structures.owner[id] === 0) return REJECT_STRUCT_ID;
  if (structures.owner[id] !== seatToOwner(seat)) return REJECT_STRUCT_NOT_OWNER;
  const level = structures.level[id] as number;
  if (level >= maxLevelOf(structures.type[id] as number)) return REJECT_STRUCT_MAX_LEVEL;
  if (tick < (structures.readyTick[id] as number) || (structures.upgradeReadyTick[id] as number) !== 0) return REJECT_STRUCT_BUSY;
  if (goldMilli < upgradePriceMilliFor(structures.type[id] as number, level + 1, discountPct)) return REJECT_BUILD_GOLD;
  return REJECT_NONE;
}

/** Delete rules: the structure exists and is the seat's, and the seat's Delete cooldown has run out. */
export function checkDelete(structures: StructureView, tick: number, seat: number, id: number): number {
  if (!Number.isInteger(id) || id < 0 || id >= structures.highWater || structures.owner[id] === 0) return REJECT_STRUCT_ID;
  if (structures.owner[id] !== seatToOwner(seat)) return REJECT_STRUCT_NOT_OWNER;
  if (tick < structures.deleteReadyTick(seatToOwner(seat))) return REJECT_DELETE_COOLDOWN;
  return REJECT_NONE;
}

/**
 * The public face of the placement rules for UI and AI: why `seat` could not build `type` on `cell` right now in the snapshot `view`
 * (REJECT_NONE = it could). The sim runs the same `checkBuild` on its own state when the Build intent arrives.
 */
export function validateBuild(view: SimView, seat: number, type: number, cell: number): number {
  return checkBuild(view, view.stats.goldMilli[seat] as number, seat, type, cell);
}

// ---- M10-4: the public face of the Upgrade / Delete checks ----------------------------------------------------------------------------------------------

/**
 * Why `seat` could not Upgrade structure `id` right now in the snapshot `view` (REJECT_NONE = it could): REJECT_STRUCT_ID (no such structure),
 * REJECT_STRUCT_NOT_OWNER, REJECT_STRUCT_MAX_LEVEL, REJECT_STRUCT_BUSY (still under construction or already upgrading) or REJECT_BUILD_GOLD.
 * The sim's `applyUpgrade` runs the same `checkUpgrade`.
 */
export function validateUpgrade(view: SimView, seat: number, structureId: number): number {
  return checkUpgrade(view.structures, view.tick, view.stats.goldMilli[seat] as number, seat, structureId, view.match.techFxOfSeat(seat, TECH_FX_UPGRADE));
}

/** Why `seat` could not Delete structure `id` right now (REJECT_STRUCT_ID, REJECT_STRUCT_NOT_OWNER, REJECT_DELETE_COOLDOWN); the sim's `applyDelete` runs the same `checkDelete`. */
export function validateDelete(view: SimView, seat: number, structureId: number): number {
  return checkDelete(view.structures, view.tick, seat, structureId);
}
