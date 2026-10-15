// The effects of FINISHED structures (M09 part B): City levels (troop cap and gold), Factory (gold and a bonus on near Cities), Port (gold
// and trade with the nearest Ports), and the Defense Post price multiplier. Pure integer maths on the structure table.
//
// The per-owner results are cached in the table (`effCityLevels`, `effFixedMilli`, `effPortMilli`: derived, never hashed) and recomputed
// only when the table changed (`effDirty`) or when a structure finishes (`effNextTick`), so the trade pairs are worked out on a change,
// not every tick. The cache is a pure function of the table, the embargo flags and the tick, so a restored state recomputes the same.
import { isqrt } from './detmath';
import {
  CITY_GOLD_MILLI_PER_SEC_PER_LEVEL,
  FACTORY_CITY_BONUS_PCT,
  FACTORY_GOLD_MILLI_PER_SEC,
  FACTORY_RADIUS_CELLS,
  PORT_GOLD_MILLI_PER_SEC,
  POST_COST_DEN,
  POST_COST_NUM,
  POST_RADIUS_CELLS,
  SAM_MOUNTAIN_PCT,
  SAM_RADIUS_CELLS,
  TICK_HZ,
  TRADE_BASE_MILLI,
  TRADE_DIST_CAP_CELLS,
  TRADE_MAX_PARTNERS,
  TRADE_MIN_DIST_CELLS,
  TRADE_SAME_OWNER_PCT,
  TRAIT_NEUTRAL_MILLI,
} from './rules';
import type { GameState } from './state';
import { STRUCT_CITY, STRUCT_FACTORY, STRUCT_PORT, STRUCT_POST } from './structureRules';
import type { StructureTable } from './structures';

const NEVER = 0xffffffff;
/** Scratch for the nearest partners of one Port (ids and squared distances). */
const bestId = new Int32Array(TRADE_MAX_PARTNERS);
const bestD2 = new Int32Array(TRADE_MAX_PARTNERS);

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
 * half of it when both Ports have the same owner, nothing under embargo.
 */
export function tradeMilliPerSec(distCells: number, sameOwner: boolean, embargo: boolean): number {
  if (embargo) return 0;
  const d = distCells > TRADE_DIST_CAP_CELLS ? TRADE_DIST_CAP_CELLS : distCells;
  const v = Math.floor((TRADE_BASE_MILLI * (100 + d)) / 100);
  return sameOwner ? Math.floor((v * TRADE_SAME_OWNER_PCT) / 100) : v;
}

/** A trait multiplier in thousandths (already clamped to +-10 % by the setter) applied to a port income. */
export function applyPortTrait(milli: number, traitMilli: number): number {
  return Math.floor((milli * traitMilli) / TRAIT_NEUTRAL_MILLI);
}

/** SAM / Silo radius in sim cells for a level, 20 % further on a Mountain cell. */
export function samRadiusCells(level: number, onMountain: boolean): number {
  const r = SAM_RADIUS_CELLS[level] ?? 0;
  return onMountain ? Math.floor((r * SAM_MOUNTAIN_PCT) / 100) : r;
}

function recompute(state: GameState): void {
  const t = state.structures;
  const tick = state.tick;
  const w = state.width;
  t.effCityLevels.fill(0);
  t.effFixedMilli.fill(0);
  t.effPortMilli.fill(0);
  let next = NEVER;
  const high = t.highWater;
  const factoryR2 = FACTORY_RADIUS_CELLS * FACTORY_RADIUS_CELLS;
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
    if (type === STRUCT_CITY) {
      const level = t.level[id] as number;
      t.effCityLevels[o] = (t.effCityLevels[o] as number) + level;
      let income = CITY_GOLD_MILLI_PER_SEC_PER_LEVEL * level;
      const cell = t.cell[id] as number;
      for (let f = 0; f < high; f++) {
        if (t.owner[f] !== o || t.type[f] !== STRUCT_FACTORY || tick < (t.readyTick[f] as number)) continue;
        if (dist2Cells(w, cell, t.cell[f] as number) <= factoryR2) {
          income += Math.floor((income * FACTORY_CITY_BONUS_PCT) / 100);
          break;
        }
      }
      t.effFixedMilli[o] = (t.effFixedMilli[o] as number) + income;
    } else if (type === STRUCT_FACTORY) {
      t.effFixedMilli[o] = (t.effFixedMilli[o] as number) + FACTORY_GOLD_MILLI_PER_SEC;
    } else if (type === STRUCT_PORT) {
      let income = PORT_GOLD_MILLI_PER_SEC;
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
        income += tradeMilliPerSec(isqrt(bestD2[k] as number), partnerOwner === o, t.embargoed(o, partnerOwner));
      }
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

/** The finished City levels of an owner (the cap bonus is CAP_CITY_LEVEL_QT per level). */
export function cityLevelsOf(state: GameState, owner: number): number {
  const t = state.structures;
  if (t.liveCount === 0) return 0;
  ensureEffects(state);
  return t.effCityLevels[owner] as number;
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
  if (t.liveCount === 0 || t.ownedCount(target, STRUCT_POST) === 0) return 0;
  const tick = state.tick;
  let n = 0;
  for (let id = 0; id < t.highWater; id++) {
    if (t.owner[id] === target && t.type[id] === STRUCT_POST && tick >= (t.readyTick[id] as number)) t.postCells[n++] = t.cell[id] as number;
  }
  t.postCount = n;
  return n;
}

const POST_R2 = POST_RADIUS_CELLS * POST_RADIUS_CELLS;

/** Applies the Defense Post price to a cell price (milli-QT): x POST_COST_NUM / POST_COST_DEN when a collected Post is within POST_RADIUS_CELLS. */
export function postAdjustedCost(t: StructureTable, width: number, cell: number, cost: number): number {
  const n = t.postCount;
  for (let i = 0; i < n; i++) {
    if (dist2Cells(width, cell, t.postCells[i] as number) <= POST_R2) return Math.floor((cost * POST_COST_NUM) / POST_COST_DEN);
  }
  return cost;
}
