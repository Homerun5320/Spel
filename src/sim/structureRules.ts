// The structure rules that UI and AI may read (M09 part A): the type numbers, the prices and the placement checks. Pure and
// read-only: everything here takes a read-only window (`StructureView`, `BuildSource`) and returns numbers. The sim's own Build
// validation (src/sim/structures.ts) calls `checkBuild` below, the SAME function `validateBuild` wraps, so there is one implementation.
import {
  BUILD_BASE_GOLD,
  MILLI_GOLD_PER_GOLD,
  PRICE_ESCALATION_MAX_HALVES,
  PRICE_ESCALATION_ONE_HALVES,
  SPACING_CELLS,
  SPACING_SCOPE,
  STRUCT_MAX_LEVEL,
} from './rules';
import {
  REJECT_BUILD_FALLOUT,
  REJECT_BUILD_FOREST,
  REJECT_BUILD_FULL,
  REJECT_BUILD_GOLD,
  REJECT_BUILD_HILLS,
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
/** Number of type numbers including 0 (the length of the per-type arrays of rules.ts). */
export const STRUCT_TYPE_SLOTS = 7;

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
  readonly type: Numbers;
  /** ownerId (0 = free slot). */
  readonly owner: Numbers;
  readonly cell: Numbers;
  /** Level 1..STRUCT_MAX_LEVEL (the finished level; an upgrade in progress is not counted yet). */
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
  return typeof type === 'number' && Number.isInteger(type) && type >= STRUCT_CITY && type <= STRUCT_POST;
}

/** Price in gold of the next structure of `type` for a seat that owns `owned` of it: base * min(12, 2 + n) / 2, in integers. */
export function buildPriceGold(type: number, owned: number): number {
  const halves = PRICE_ESCALATION_ONE_HALVES + owned;
  const capped = halves > PRICE_ESCALATION_MAX_HALVES ? PRICE_ESCALATION_MAX_HALVES : halves;
  return Math.floor(((BUILD_BASE_GOLD[type] as number) * capped) / PRICE_ESCALATION_ONE_HALVES);
}

/** Price in gold of an upgrade to `level` (2..STRUCT_MAX_LEVEL): base * level, no escalation. */
export function upgradePriceGold(type: number, level: number): number {
  return (BUILD_BASE_GOLD[type] as number) * level;
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

/** Is any structure in the spacing scope closer than SPACING_CELLS to `cell` (Euclidean in sim cells, x wrapping)? */
export function violatesSpacing(src: BuildSource, ownerId: number, type: number, cell: number): boolean {
  const s = src.structures;
  const w = src.width;
  const x = cell % w;
  const y = (cell - x) / w;
  const limit = SPACING_CELLS * SPACING_CELLS;
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

/**
 * THE placement rules. Returns REJECT_NONE or the reason, checking in this order: type, cell, Peak, ownership, the terrain
 * rules (Mountain allows only SAM / Post / Silo; Hills no Port; Forest no Silo), Port on the coast, the cell is free, spacing,
 * fallout, Silo needs a finished Factory of the same owner, the table has room, the purse. `goldMilli` is the seat's gold.
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
  if (src.structures.liveCount >= src.structures.capacity) return REJECT_BUILD_FULL;
  if (goldMilli < buildPriceMilli(src.structures, ownerId, type)) return REJECT_BUILD_GOLD;
  return REJECT_NONE;
}

/** Upgrade rules: the structure exists and is the seat's, is finished and not upgrading, is below the top level, the seat can pay. */
export function checkUpgrade(structures: StructureView, tick: number, goldMilli: number, seat: number, id: number): number {
  if (!Number.isInteger(id) || id < 0 || id >= structures.highWater || structures.owner[id] === 0) return REJECT_STRUCT_ID;
  if (structures.owner[id] !== seatToOwner(seat)) return REJECT_STRUCT_NOT_OWNER;
  const level = structures.level[id] as number;
  if (level >= STRUCT_MAX_LEVEL) return REJECT_STRUCT_MAX_LEVEL;
  if (tick < (structures.readyTick[id] as number) || (structures.upgradeReadyTick[id] as number) !== 0) return REJECT_STRUCT_BUSY;
  if (goldMilli < upgradePriceGold(structures.type[id] as number, level + 1) * MILLI_GOLD_PER_GOLD) return REJECT_BUILD_GOLD;
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
