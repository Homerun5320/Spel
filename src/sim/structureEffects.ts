// The effects of FINISHED structures (M09 part B): City levels (troop cap and gold), Factory (gold and a bonus on near Cities), Port (gold
// and trade with the nearest Ports), and the Defense Post price multiplier. Pure integer maths on the structure table.
//
// The per-owner results are cached in the table (`effCityLevels`, `effFixedMilli`, `effPortMilli`: derived, never hashed) and recomputed
// only when the table changed (`effDirty`) or when a structure finishes (`effNextTick`), so the trade pairs are worked out on a change,
// not every tick. The cache is a pure function of the table, the embargo flags and the tick, so a restored state recomputes the same.
import { isqrt } from './detmath';
import { RELATION_ALLIANCE } from './diplomacyTable';
import {
  BARRACKS_REGEN_PCT_MAX,
  CAP_CITY_LEVEL_TROOPS,
  DISTRICT_MAX_SLOTS,
  DISTRICT_WALLS_RADIUS_CELLS,
  QT_PER_TROOP,
  FACTORY_BONUS_MAX_CITIES,
  PORT_INCOME_MAX_MILLI_PER_SEC,
  STRUCT_CAPACITY,
  POST_COST_DEN,
  POST_COST_NUM,
  POST_RADIUS_CELLS,
  SAM_MOUNTAIN_PCT,
  TICK_HZ,
  TRADE_BASE_MILLI,
  TRADE_DIST_CAP_CELLS,
  TRADE_MAX_PARTNERS,
  TRADE_MIN_DIST_CELLS,
  TRADE_ALLIANCE_PCT,
  TRADE_SAME_OWNER_PCT,
  TRAIT_NEUTRAL_MILLI,
} from './rules';
import {
  barracksRegenPctAt,
  cityTroopCapAt,
  factoryCityBonusPctAt,
  factoryGoldMilliAt,
  factoryRadiusCellsAt,
  housingTroopsAt,
  marketGoldMilliAt,
  portGoldMilliAt,
  portTradePctAt,
  samRadiusBaseAt,
  wallsCostPctAt,
} from './levelCurves';
import { DISTRICT_BARRACKS, DISTRICT_HOUSING, DISTRICT_MARKET, DISTRICT_WALLS } from './districtRules';
import { TECH_FX_GOLD, TECH_FX_WALLS_POST } from './techTable';
import type { GameState } from './state';
import { STRUCT_CITY, STRUCT_FACTORY, STRUCT_PORT, STRUCT_POST, cityGoldMilli } from './structureRules';
import type { StructureTable } from './structures';

const NEVER = 0xffffffff;
/** Scratch for the nearest partners of one Port (ids and squared distances). */
const bestId = new Int32Array(TRADE_MAX_PARTNERS);
const bestD2 = new Int32Array(TRADE_MAX_PARTNERS);
/** Scratch: how many Cities each Factory slot has boosted in this recompute. */
const boosted = new Uint8Array(STRUCT_CAPACITY);

/** The squared distance in sim cells between two cells (x wrapping, no latitude weight). */
export function dist2Cells(width: number, a: number, b: number): number {
  const ax = a % width;
  const bx = b % width;
  let dx = ax > bx ? ax - bx : bx - ax;
  if (width - dx < dx) dx = width - dx;
  const dy = (a - ax) / width - (b - bx) / width;
  return dx * dx + dy * dy;
}

/**
 * The trade value one Port of a pair earns, in milli-gold per second: TRADE_BASE_MILLI * (100 + min(distance, TRADE_DIST_CAP_CELLS)) / 100,
 * half of it when both Ports have the same owner, TRADE_ALLIANCE_PCT of it for allied owners (Fix-4A1), nothing under embargo.
 */
export function tradeMilliPerSec(distCells: number, sameOwner: boolean, embargo: boolean, allied = false): number {
  if (embargo) return 0;
  const d = distCells > TRADE_DIST_CAP_CELLS ? TRADE_DIST_CAP_CELLS : distCells;
  const v = Math.floor((TRADE_BASE_MILLI * (100 + d)) / 100);
  if (sameOwner) return Math.floor((v * TRADE_SAME_OWNER_PCT) / 100);
  return allied ? Math.floor((v * TRADE_ALLIANCE_PCT) / 100) : v;
}

/** A trait multiplier in thousandths (already clamped to +-10 % by the setter) applied to a port income. */
export function applyPortTrait(milli: number, traitMilli: number): number {
  return Math.floor((milli * traitMilli) / TRAIT_NEUTRAL_MILLI);
}

/** SAM / Silo radius in sim cells for a level, 20 % further on a Mountain cell. */
export function samRadiusCells(level: number, onMountain: boolean): number {
  const r = samRadiusBaseAt(level);
  return onMountain ? Math.floor((r * SAM_MOUNTAIN_PCT) / 100) : r;
}

/** Adds the FINISHED districts of City `id` (owner `o`) to the owner's cache; returns the earliest future tick at which one of them finishes. */
function districtEffects(t: StructureTable, id: number, o: number, tick: number, nextIn: number, goldPct: number): number {
  let next = nextIn;
  for (let slot = 0; slot < DISTRICT_MAX_SLOTS; slot++) {
    const at = id * DISTRICT_MAX_SLOTS + slot;
    const kind = t.districtKind[at] as number;
    if (kind === 0) continue;
    const ready = t.districtReadyTick[at] as number;
    const up = t.districtUpgradeReadyTick[at] as number;
    if (up > tick && up < next) next = up;
    if (tick < ready) {
      if (ready < next) next = ready;
      continue;
    }
    const level = t.districtLevel[at] as number;
    if (kind === DISTRICT_MARKET) {
      const market = marketGoldMilliAt(level);
      t.effFixedMilli[o] = (t.effFixedMilli[o] as number) + (goldPct === 0 ? market : market + Math.floor((market * goldPct) / 100));
    }
    else if (kind === DISTRICT_HOUSING) t.effHousingQt[o] = (t.effHousingQt[o] as number) + housingTroopsAt(level) * QT_PER_TROOP;
    else if (kind === DISTRICT_BARRACKS) {
      const sum = (t.effBarracksPct[o] as number) + barracksRegenPctAt(level);
      t.effBarracksPct[o] = sum > BARRACKS_REGEN_PCT_MAX ? BARRACKS_REGEN_PCT_MAX : sum;
    }
  }
  return next;
}

function recompute(state: GameState): void {
  const t = state.structures;
  const tick = state.tick;
  const w = state.width;
  t.effCityLevels.fill(0);
  t.effCityCount.fill(0);
  t.effCityStepQt.fill(0);
  t.effFixedMilli.fill(0);
  t.effPortMilli.fill(0);
  t.effHousingQt.fill(0);
  t.effBarracksPct.fill(0);
  let next = NEVER;
  const high = t.highWater;
  boosted.fill(0, 0, high);
  const minD2 = TRADE_MIN_DIST_CELLS * TRADE_MIN_DIST_CELLS;
  for (let id = 0; id < high; id++) {
    const o = t.owner[id] as number;
    if (o === 0) continue;
    const ready = t.readyTick[id] as number;
    const up = t.upgradeReadyTick[id] as number;
    if (up > tick && up < next) next = up;
    if (tick < ready) {
      if (ready < next) next = ready;
      continue;
    }
    const type = t.type[id] as number;
    const goldPct = state.match.fx(o, TECH_FX_GOLD);
    if (type === STRUCT_CITY) {
      const level = t.level[id] as number;
      t.effCityLevels[o] = (t.effCityLevels[o] as number) + level;
      t.effCityCount[o] = (t.effCityCount[o] as number) + 1;
      t.effCityStepQt[o] = (t.effCityStepQt[o] as number) + (cityTroopCapAt(level) - CAP_CITY_LEVEL_TROOPS) * QT_PER_TROOP;
      let income = cityGoldMilli(level);
      // The best finished Factory of the owner in reach that still has a free slot (highest level, then lowest id) boosts this City.
      const cell = t.cell[id] as number;
      let bestF = -1;
      let bestFLevel = 0;
      for (let f = 0; f < high; f++) {
        if (t.owner[f] !== o || t.type[f] !== STRUCT_FACTORY || tick < (t.readyTick[f] as number)) continue;
        const fl = t.level[f] as number;
        if (fl <= bestFLevel || (boosted[f] as number) >= FACTORY_BONUS_MAX_CITIES) continue;
        const r = factoryRadiusCellsAt(fl);
        if (dist2Cells(w, cell, t.cell[f] as number) <= r * r) {
          bestF = f;
          bestFLevel = fl;
        }
      }
      if (bestF >= 0) {
        boosted[bestF] = (boosted[bestF] as number) + 1;
        income += Math.floor((income * factoryCityBonusPctAt(bestFLevel)) / 100);
      }
      // Economy techs (M18d-1): + goldPct percent on a City's income (cached here, so the tick pays one addition for it).
      if (goldPct !== 0) income += Math.floor((income * goldPct) / 100);
      t.effFixedMilli[o] = (t.effFixedMilli[o] as number) + income;
      if (t.districtCount > 0) next = districtEffects(t, id, o, tick, next, goldPct);
    } else if (type === STRUCT_FACTORY) {
      t.effFixedMilli[o] = (t.effFixedMilli[o] as number) + factoryGoldMilliAt(t.level[id] as number);
    } else if (type === STRUCT_PORT) {
      const portLevel = t.level[id] as number;
      let income = portGoldMilliAt(portLevel);
      let trade = 0;
      const cell = t.cell[id] as number;
      let n = 0;
      for (let q = 0; q < high; q++) {
        if (q === id || t.type[q] !== STRUCT_PORT || (t.owner[q] as number) === 0 || tick < (t.readyTick[q] as number)) continue;
        const d2 = dist2Cells(w, cell, t.cell[q] as number);
        if (d2 < minD2) continue;
        // Insert into the sorted best list; a later (higher) id never beats an equal distance.
        let at = n;
        while (at > 0 && (bestD2[at - 1] as number) > d2) at--;
        if (at >= TRADE_MAX_PARTNERS) continue;
        const last = n < TRADE_MAX_PARTNERS ? n : TRADE_MAX_PARTNERS - 1;
        for (let k = last; k > at; k--) {
          bestD2[k] = bestD2[k - 1] as number;
          bestId[k] = bestId[k - 1] as number;
        }
        bestD2[at] = d2;
        bestId[at] = q;
        if (n < TRADE_MAX_PARTNERS) n++;
      }
      for (let k = 0; k < n; k++) {
        const partnerOwner = t.owner[bestId[k] as number] as number;
        // Allied Ports trade at TRADE_ALLIANCE_PCT of the open rate (Fix-4A1; M18c-1 had them at the same-owner half); an embargo beats everything.
        trade += tradeMilliPerSec(isqrt(bestD2[k] as number), partnerOwner === o, t.embargoed(o, partnerOwner), partnerOwner !== o && state.diplo.relationOf(o, partnerOwner) === RELATION_ALLIANCE);
      }
      let tradeMilli = Math.floor((trade * portTradePctAt(portLevel)) / 100);
      if (goldPct !== 0) tradeMilli += Math.floor((tradeMilli * goldPct) / 100);
      income += tradeMilli;
      if (income > PORT_INCOME_MAX_MILLI_PER_SEC) income = PORT_INCOME_MAX_MILLI_PER_SEC;
      t.effPortMilli[o] = (t.effPortMilli[o] as number) + income;
    }
  }
  t.effNextTick = next;
  t.effDirty = false;
}

/** Brings the cache up to date (cheap when nothing changed). */
export function ensureEffects(state: GameState): void {
  const t = state.structures;
  if (t.effDirty || state.tick >= t.effNextTick) recompute(state);
}

/** The finished City levels of an owner added up (a statistic; the cap reads cityCountOf and cityStepQtOf). */
export function cityLevelsOf(state: GameState, owner: number): number {
  const t = state.structures;
  if (t.liveCount === 0) return 0;
  ensureEffects(state);
  return t.effCityLevels[owner] as number;
}

/** The number of finished Cities of an owner (each adds CAP_CITY_LEVEL_QT to the cap at level 1). */
export function cityCountOf(state: GameState, owner: number): number {
  const t = state.structures;
  if (t.liveCount === 0) return 0;
  ensureEffects(state);
  return t.effCityCount[owner] as number;
}

/** The troop cap in QT the owner's City levels above 1 add (cityTroopCap(level) - CAP_CITY_LEVEL_TROOPS per City; Sim-Levels2). */
export function cityStepQtOf(state: GameState, owner: number): number {
  const t = state.structures;
  if (t.liveCount === 0) return 0;
  ensureEffects(state);
  return t.effCityStepQt[owner] as number;
}

/** The troop cap in QT the owner's finished Housing districts add (Districts-1; cached with the other effects). */
export function housingQtOf(state: GameState, owner: number): number {
  const t = state.structures;
  if (t.districtCount === 0) return 0;
  ensureEffects(state);
  return t.effHousingQt[owner] as number;
}

/** The percent the owner's finished Barracks add to its troop regeneration (at most BARRACKS_REGEN_PCT_MAX). */
export function barracksPctOf(state: GameState, owner: number): number {
  const t = state.structures;
  if (t.districtCount === 0) return 0;
  ensureEffects(state);
  return t.effBarracksPct[owner] as number;
}

/** The structure income of an owner in milli-gold per second, with the owner's port trait applied to the Port income. */
export function structGoldMilliPerSec(state: GameState, owner: number): number {
  const t = state.structures;
  if (t.liveCount === 0) return 0;
  ensureEffects(state);
  const trait = state.home !== null ? (state.home.portMilli[owner] as number) : TRAIT_NEUTRAL_MILLI;
  return (t.effFixedMilli[owner] as number) + applyPortTrait(t.effPortMilli[owner] as number, trait);
}

/** The structure income of an owner in milli-gold per tick. */
export function structGoldMilliPerTick(state: GameState, owner: number): number {
  return Math.floor(structGoldMilliPerSec(state, owner) / TICK_HZ);
}

/**
 * Collects the cells of the finished Defense Posts of `target` into the table's scratch (`postCells`, `postCount`) for an attack that
 * runs this tick. O(structures) and only when the target owns a Post at all.
 */
export function collectPosts(state: GameState, target: number): number {
  const t: StructureTable = state.structures;
  t.postCount = 0;
  t.postBoostPct = state.match.fx(target, TECH_FX_WALLS_POST);
  if (t.liveCount === 0 || t.ownedCount(target, STRUCT_POST) === 0) return 0;
  const tick = state.tick;
  let n = 0;
  for (let id = 0; id < t.highWater; id++) {
    if (t.owner[id] === target && t.type[id] === STRUCT_POST && tick >= (t.readyTick[id] as number)) t.postCells[n++] = t.cell[id] as number;
  }
  t.postCount = n;
  return n;
}

/**
 * Collects the cells and cost percents of the finished Walls of `target` into the table's scratch (`wallCells`, `wallPcts`, `wallCount`) for an
 * attack that runs this tick. O(structures), and only when the target owns a Walls district at all.
 */
export function collectWalls(state: GameState, target: number): number {
  const t: StructureTable = state.structures;
  t.wallCount = 0;
  const boost = state.match.fx(target, TECH_FX_WALLS_POST);
  if (t.districtCount === 0 || t.districtsOwned(target, DISTRICT_WALLS) === 0) return 0;
  const tick = state.tick;
  let n = 0;
  for (let id = 0; id < t.highWater; id++) {
    if (t.owner[id] !== target || t.type[id] !== STRUCT_CITY) continue;
    for (let slot = 0; slot < DISTRICT_MAX_SLOTS; slot++) {
      const at = id * DISTRICT_MAX_SLOTS + slot;
      if (t.districtKind[at] !== DISTRICT_WALLS || tick < (t.districtReadyTick[at] as number)) continue;
      t.wallCells[n] = t.cell[id] as number;
      const wallPct = wallsCostPctAt(t.districtLevel[at] as number);
      t.wallPcts[n] = boost === 0 ? wallPct : Math.floor((wallPct * (100 + boost)) / 100);
      n++;
    }
  }
  t.wallCount = n;
  return n;
}

const WALL_R2 = DISTRICT_WALLS_RADIUS_CELLS * DISTRICT_WALLS_RADIUS_CELLS;

/**
 * The cell price with the Walls of the collected set applied: the largest percent of the Walls whose City is within DISTRICT_WALLS_RADIUS_CELLS of
 * the cell, floor(cost * percent / 100). The caller keeps the larger of this and `postAdjustedCost` (Walls and a Defense Post do not stack).
 */
export function wallAdjustedCost(t: StructureTable, width: number, cell: number, cost: number): number {
  const n = t.wallCount;
  let best = 100;
  for (let i = 0; i < n; i++) {
    const pct = t.wallPcts[i] as number;
    if (pct > best && dist2Cells(width, cell, t.wallCells[i] as number) <= WALL_R2) best = pct;
  }
  return best === 100 ? cost : Math.floor((cost * best) / 100);
}

const POST_R2 = POST_RADIUS_CELLS * POST_RADIUS_CELLS;

/** Applies the Defense Post price to a cell price (milli-QT): x POST_COST_NUM / POST_COST_DEN when a collected Post is within POST_RADIUS_CELLS. */
export function postAdjustedCost(t: StructureTable, width: number, cell: number, cost: number): number {
  const n = t.postCount;
  for (let i = 0; i < n; i++) {
    if (dist2Cells(width, cell, t.postCells[i] as number) <= POST_R2) return t.postBoostPct === 0 ? Math.floor((cost * POST_COST_NUM) / POST_COST_DEN) : Math.floor((cost * POST_COST_NUM * (100 + t.postBoostPct)) / (POST_COST_DEN * 100));
  }
  return cost;
}
