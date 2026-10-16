// The model of the city view (Districts-2a): pure functions from the snapshot (`SimView`) to the description of a City and its district tiles.
// Every number comes from `src/sim/public.ts` (the effect constants, prices, build times and the three validators, the SAME checks the sim
// runs); nothing here is a balance value. `citySignature` is the cheap per-frame part: it writes the numbers the panel shows into a reused
// Int32Array, so the panel rebuilds its texts only when the signature changed (no allocation in the frame loop).
import {
  DISTRICT_BARRACKS,
  DISTRICT_BUILD_TICKS,
  DISTRICT_HOUSING,
  DISTRICT_MARKET,
  DISTRICT_MAX_LEVEL,
  DISTRICT_MAX_SLOTS,
  DISTRICT_NONE,
  DISTRICT_WALLS,
  DISTRICT_WALLS_RADIUS_CELLS,
  REJECT_BUILD_GOLD,
  REJECT_DELETE_COOLDOWN,
  REJECT_DISTRICT_CITY_BUILDING,
  REJECT_DISTRICT_EMPTY,
  REJECT_DISTRICT_KIND,
  REJECT_DISTRICT_NOT_CITY,
  REJECT_DISTRICT_OCCUPIED,
  REJECT_DISTRICT_SLOT,
  REJECT_STRUCT_BUSY,
  REJECT_STRUCT_ID,
  REJECT_STRUCT_MAX_LEVEL,
  REJECT_STRUCT_NOT_OWNER,
  STRUCT_CITY,
  TICK_HZ,
  cityGoldMilli,
  cityTroopCap,
  districtBuildPriceGold,
  districtEffect,
  districtIndex,
  districtSlotsOf,
  districtUpgradePriceGold,
  maxLevelOf,
  seatToOwner,
  upgradePriceGold,
  upgradeTicksOf,
  validateBuildDistrict,
  validateRemoveDistrict,
  validateUpgradeDistrict,
  validateUpgrade,
  type SimView,
} from '../sim/public';
import { spawnPhaseBlocks } from './buildReasons';
import { REJECT_PHASE } from './hudCodes';
import { formatFixed, formatGoldRate, formatInt, type TextKey, type TextParams } from './i18n';
import type { DeleteArm } from './structureInfo';
import { deleteArmed, deleteClick } from './structureInfo';

/** The four kinds in the order the build buttons show them. */
export const DISTRICT_KINDS: readonly number[] = [DISTRICT_HOUSING, DISTRICT_MARKET, DISTRICT_BARRACKS, DISTRICT_WALLS];

export function districtNameKey(kind: number): TextKey {
  switch (kind) {
    case DISTRICT_HOUSING:
      return 'sel.district.housing';
    case DISTRICT_MARKET:
      return 'sel.district.market';
    case DISTRICT_BARRACKS:
      return 'sel.district.barracks';
    default:
      return 'sel.district.walls';
  }
}

export interface FxLine {
  readonly key: TextKey;
  readonly params: TextParams;
}


/** What a finished district of `kind` at `level` gives, as one text line (the sim's numbers through `districtEffect`). */
export function districtFxLine(kind: number, level: number): FxLine {
  const e = districtEffect(kind, level);
  switch (kind) {
    case DISTRICT_HOUSING:
      return { key: 'sel.district.fxHousing', params: { troops: formatInt(e.capTroops) } };
    case DISTRICT_MARKET:
      return { key: 'sel.district.fxMarket', params: { gold: formatGoldRate(e.goldMilliPerSec) } };
    case DISTRICT_BARRACKS:
      return { key: 'sel.district.fxBarracks', params: { pct: e.regenPct } };
    default:
      return { key: 'sel.district.fxWalls', params: { mult: formatFixed(e.wallsCostPct / 100, 1), radius: DISTRICT_WALLS_RADIUS_CELLS } };
  }
}

/** The tooltip key of a refused district intent (the codes 39 to 44 and the reused ones); `reject.other` for anything else. */
export function districtWhyKey(reason: number): TextKey {
  switch (reason) {
    case REJECT_PHASE:
      return 'sel.why.phase';
    case REJECT_BUILD_GOLD:
      return 'sel.district.whyGold';
    case REJECT_DISTRICT_CITY_BUILDING:
      return 'sel.district.whyCityBuilding';
    case REJECT_DISTRICT_OCCUPIED:
      return 'sel.district.whyOccupied';
    case REJECT_DISTRICT_EMPTY:
      return 'sel.district.whyEmpty';
    case REJECT_DISTRICT_SLOT:
      return 'sel.district.whySlot';
    case REJECT_DISTRICT_NOT_CITY:
      return 'sel.district.whyNotCity';
    case REJECT_DISTRICT_KIND:
      return 'sel.district.whyKind';
    case REJECT_STRUCT_NOT_OWNER:
      return 'sel.why.notOwner';
    case REJECT_STRUCT_ID:
      return 'sel.why.gone';
    case REJECT_STRUCT_MAX_LEVEL:
      return 'sel.why.maxLevel';
    case REJECT_STRUCT_BUSY:
      return 'sel.why.busy';
    case REJECT_DELETE_COOLDOWN:
      return 'sel.why.cooldown';
    default:
      return 'reject.other';
  }
}

export type TileState = 'empty' | 'building' | 'upgrading' | 'ready';

export interface BuildChoice {
  readonly kind: number;
  readonly price: number;
  readonly buildSeconds: number;
  /** 0 = the button works, else the reason code (spawn phase first, as the sim checks it). */
  readonly reason: number;
  readonly fx: FxLine;
}

export interface TileInfo {
  readonly slot: number;
  readonly state: TileState;
  /** 0 for an empty tile. */
  readonly kind: number;
  readonly level: number;
  /** Progress of the running build or upgrade in percent 0..100 (100 when nothing runs). */
  readonly progressPct: number;
  /** What the district gives now (finished level; none for an empty or still-building tile) and at the next level (null at the top). */
  readonly fxNow: FxLine | null;
  readonly fxNext: FxLine | null;
  readonly upgradePrice: number;
  readonly upgradeReason: number;
  readonly removeReason: number;
  readonly removeSeconds: number;
  /** An empty tile offers the four kinds; an occupied one has none. */
  readonly choices: readonly BuildChoice[];
}

export interface CityTotals {
  readonly goldMilliPerSec: number;
  readonly capTroops: number;
  readonly regenPct: number;
  /** The attacker's cell price in percent (100 = none) from the best finished Walls. */
  readonly wallsCostPct: number;
}

export interface CityInfo {
  readonly id: number;
  readonly level: number;
  readonly slots: number;
  readonly owned: boolean;
  readonly finished: boolean;
  readonly upgrading: boolean;
  readonly upgradePrice: number;
  /** Seconds the upgrade to the next level takes (the sim's `upgradeTicksOf`), 0 at the top level. */
  readonly upgradeSeconds: number;
  readonly upgradeReason: number;
  readonly totals: CityTotals;
  readonly tiles: readonly TileInfo[];
}

/** Spawn phase first, as the sim's own gate runs before its checks. */
function phaseFirst(view: SimView, reason: number): number {
  return reason !== REJECT_STRUCT_ID && reason !== REJECT_STRUCT_NOT_OWNER && reason !== REJECT_DISTRICT_NOT_CITY && spawnPhaseBlocks(view) ? REJECT_PHASE : reason;
}

function progress(tick: number, ready: number, total: number): number {
  if (ready === 0 || total <= 0) return 100;
  const left = ready - tick;
  if (left <= 0) return 100;
  const done = total - left;
  return done <= 0 ? 0 : Math.min(99, Math.floor((done * 100) / total));
}

/** The build choices of an empty tile `slot` of City `id`. */
function choicesFor(view: SimView, seat: number, id: number, slot: number): BuildChoice[] {
  const owner = seatToOwner(seat);
  const out: BuildChoice[] = [];
  for (const kind of DISTRICT_KINDS) {
    out.push({
      kind,
      price: districtBuildPriceGold(kind, view.districts.districtsOwned(owner, kind)),
      buildSeconds: Math.round((DISTRICT_BUILD_TICKS[kind] as number) / TICK_HZ),
      reason: phaseFirst(view, validateBuildDistrict(view, seat, id, slot, kind)),
      fx: districtFxLine(kind, 1),
    });
  }
  return out;
}

/** The description of one tile. */
export function tileInfo(view: SimView, seat: number, id: number, slot: number): TileInfo {
  const d = view.districts;
  const at = districtIndex(id, slot);
  const kind = d.districtKind[at] as number;
  const wait = Math.max(0, view.structures.deleteReadyTick(seatToOwner(seat)) - view.tick);
  if (kind === DISTRICT_NONE) {
    return { slot, state: 'empty', kind: 0, level: 0, progressPct: 100, fxNow: null, fxNext: null, upgradePrice: 0, upgradeReason: 0, removeReason: 0, removeSeconds: 0, choices: choicesFor(view, seat, id, slot) };
  }
  const level = d.districtLevel[at] as number;
  const ready = d.districtReadyTick[at] as number;
  const upReady = d.districtUpgradeReadyTick[at] as number;
  const total = DISTRICT_BUILD_TICKS[kind] as number;
  const building = view.tick < ready;
  const upgrading = !building && upReady !== 0;
  const state: TileState = building ? 'building' : upgrading ? 'upgrading' : 'ready';
  const top = level >= DISTRICT_MAX_LEVEL;
  return {
    slot,
    state,
    kind,
    level,
    progressPct: building ? progress(view.tick, ready, total) : upgrading ? progress(view.tick, upReady, total) : 100,
    fxNow: building ? null : districtFxLine(kind, level),
    fxNext: top ? null : districtFxLine(kind, level + 1),
    upgradePrice: top ? 0 : districtUpgradePriceGold(kind, level + 1),
    upgradeReason: phaseFirst(view, validateUpgradeDistrict(view, seat, id, slot)),
    removeReason: phaseFirst(view, validateRemoveDistrict(view, seat, id, slot)),
    removeSeconds: Math.ceil(wait / TICK_HZ),
    choices: [],
  };
}

/** The totals a City gives with its FINISHED districts (the sim's numbers: the City's own per-level numbers plus `districtEffect` of each district). */
export function cityTotals(view: SimView, id: number): CityTotals {
  const s = view.structures;
  const level = s.level[id] as number;
  let gold = cityGoldMilli(level);
  let cap = cityTroopCap(level);
  let regen = 0;
  let walls = 100;
  const slots = Math.min(DISTRICT_MAX_SLOTS, districtSlotsOf(level));
  for (let slot = 0; slot < slots; slot++) {
    const at = districtIndex(id, slot);
    const kind = view.districts.districtKind[at] as number;
    if (kind === DISTRICT_NONE || view.tick < (view.districts.districtReadyTick[at] as number)) continue;
    const e = districtEffect(kind, view.districts.districtLevel[at] as number);
    gold += e.goldMilliPerSec;
    cap += e.capTroops;
    regen += e.regenPct;
    if (e.wallsCostPct > walls) walls = e.wallsCostPct;
  }
  return { goldMilliPerSec: gold, capTroops: cap, regenPct: regen, wallsCostPct: walls };
}

/** The whole description of City `id` for `seat`, or null when `id` is not a City that exists. */
export function cityInfo(view: SimView, seat: number, id: number): CityInfo | null {
  const s = view.structures;
  if (!Number.isInteger(id) || id < 0 || id >= s.highWater || s.owner[id] === 0 || s.type[id] !== STRUCT_CITY) return null;
  const level = s.level[id] as number;
  const slots = Math.min(DISTRICT_MAX_SLOTS, districtSlotsOf(level));
  const tiles: TileInfo[] = [];
  for (let slot = 0; slot < slots; slot++) tiles.push(tileInfo(view, seat, id, slot));
  const upgradeReason = validateUpgrade(view, seat, id);
  return {
    id,
    level,
    slots,
    owned: s.owner[id] === seatToOwner(seat),
    finished: view.tick >= (s.readyTick[id] as number),
    upgrading: (s.upgradeReadyTick[id] as number) !== 0,
    upgradePrice: level >= maxLevelOf(STRUCT_CITY) ? 0 : upgradePriceGold(STRUCT_CITY, level + 1),
    upgradeSeconds: level >= maxLevelOf(STRUCT_CITY) ? 0 : upgradeTicksOf(STRUCT_CITY, level + 1) / TICK_HZ,
    upgradeReason: phaseFirst(view, upgradeReason),
    totals: cityTotals(view, id),
    tiles,
  };
}

/** The most numbers `citySignature` writes. */
export const CITY_SIG_MAX = 16 + DISTRICT_MAX_SLOTS * 16;

/**
 * The numbers everything on the panel depends on, written into `out` (no allocation): the City's level and state, the totals, and per tile its
 * kind, level, progress percent, the reasons and prices of its buttons. Two equal signatures mean the panel looks the same. Returns the length.
 */
export function citySignature(view: SimView, seat: number, id: number, out: Int32Array): number {
  const s = view.structures;
  let n = 0;
  const level = s.level[id] as number;
  out[n++] = id;
  out[n++] = level;
  out[n++] = view.tick >= (s.readyTick[id] as number) ? 1 : 0;
  out[n++] = (s.upgradeReadyTick[id] as number) !== 0 ? 1 : 0;
  out[n++] = phaseFirst(view, validateUpgrade(view, seat, id));
  const t = cityTotals(view, id);
  out[n++] = t.goldMilliPerSec;
  out[n++] = t.capTroops;
  out[n++] = t.regenPct;
  out[n++] = t.wallsCostPct;
  out[n++] = Math.ceil(Math.max(0, view.structures.deleteReadyTick(seatToOwner(seat)) - view.tick) / TICK_HZ);
  const slots = Math.min(DISTRICT_MAX_SLOTS, districtSlotsOf(level));
  out[n++] = slots;
  const d = view.districts;
  const owner = seatToOwner(seat);
  for (let slot = 0; slot < slots; slot++) {
    const at = districtIndex(id, slot);
    const kind = d.districtKind[at] as number;
    out[n++] = kind;
    out[n++] = d.districtLevel[at] as number;
    const ready = d.districtReadyTick[at] as number;
    const upReady = d.districtUpgradeReadyTick[at] as number;
    const building = kind !== DISTRICT_NONE && view.tick < ready;
    out[n++] = building ? 1 : upReady !== 0 ? 2 : 0;
    const total = kind === DISTRICT_NONE ? 0 : (DISTRICT_BUILD_TICKS[kind] as number);
    out[n++] = building ? progress(view.tick, ready, total) : upReady !== 0 ? progress(view.tick, upReady, total) : 100;
    if (kind === DISTRICT_NONE) {
      for (const k of DISTRICT_KINDS) {
        out[n++] = phaseFirst(view, validateBuildDistrict(view, seat, id, slot, k));
        out[n++] = districtBuildPriceGold(k, d.districtsOwned(owner, k));
      }
    } else {
      out[n++] = phaseFirst(view, validateUpgradeDistrict(view, seat, id, slot));
      out[n++] = phaseFirst(view, validateRemoveDistrict(view, seat, id, slot));
    }
  }
  return n;
}

// ---- the two-step Remove ---------------------------------------------------------------------------------------------------------------------

/** The key a Remove arm is stored under: one per (City, slot), so arming one tile does not arm another. */
export function removeArmKey(structure: number, slot: number): number {
  return structure * DISTRICT_MAX_SLOTS + slot;
}

/** Is Remove armed for the tile at `now` (ms)? Same timing as the structure Delete (`DELETE_ARM_MS`). */
export function removeArmed(arm: DeleteArm | null, structure: number, slot: number, now: number): boolean {
  return deleteArmed(arm, removeArmKey(structure, slot), now);
}

/** One click on a tile's Remove: the first arms it, a second one in time (same tile) sends. */
export function removeClick(arm: DeleteArm | null, structure: number, slot: number, now: number): { readonly send: boolean; readonly arm: DeleteArm | null } {
  return deleteClick(arm, removeArmKey(structure, slot), now);
}
