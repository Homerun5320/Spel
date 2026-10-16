// scoreLz (M11b): can a helicopter set troops down on a cell, and how good is the spot? The reason codes are checked in this priority
// order and the first that applies wins. A pure query over a SimView and the nav grid; nothing here is hashed state.
import { ALT_MODE_LOW, type AltMode } from '../los/cache';
import { HELI_FUEL_CELLS, LZ_REASON_BASE, LZ_ENEMY_CITY_CELLS, LZ_MAX_ELEV_M, LZ_SCORE_BASE, LZ_SCORE_EXPOSED_PER_CELL, LZ_SCORE_SPREAD_PER_M, LZ_STEEP_SPREAD_M } from '../rules';
import { seatToOwner } from '../state';
import { CLASS_DEEP_SEA, CLASS_HILLS, CLASS_PEAK, CLASS_PLAINS, CLASS_SHALLOWS } from '../terrain';
import { STRUCT_CITY } from '../structureRules';
import type { Nav } from './grid';
import { cellDistance, planRoute, type NavView } from './route';

export type LzReason = 0 | 65 | 66 | 67 | 68 | 69 | 70 | 71 | 72;
export const LZ_OK = 0;
// Own range (Fix-3A2): LZ_REASON_BASE + n, never equal to a REJECT_* code of src/sim/intents.ts.
export const LZ_WATER = (LZ_REASON_BASE + 1) as LzReason;
export const LZ_PEAK = (LZ_REASON_BASE + 2) as LzReason;
export const LZ_TERRAIN_CLASS = (LZ_REASON_BASE + 3) as LzReason;
export const LZ_STEEP = (LZ_REASON_BASE + 4) as LzReason;
export const LZ_ENEMY_CITY_NEAR = (LZ_REASON_BASE + 5) as LzReason;
export const LZ_TOO_HIGH = (LZ_REASON_BASE + 6) as LzReason;
export const LZ_OUT_OF_FUEL = (LZ_REASON_BASE + 7) as LzReason;
export const LZ_NO_ROUTE = (LZ_REASON_BASE + 8) as LzReason;
/** Name of a reason code (indexed by the code itself: 0 and 65..72). */
export const LZ_REASON_NAMES: Readonly<Record<LzReason, string>> = {
  0: 'OK',
  65: 'WATER',
  66: 'PEAK',
  67: 'TERRAIN_CLASS',
  68: 'STEEP',
  69: 'ENEMY_CITY_NEAR',
  70: 'TOO_HIGH',
  71: 'OUT_OF_FUEL',
  72: 'NO_ROUTE',
};

export interface LzResult {
  readonly reason: LzReason;
  /** > 0 for a valid landing zone (flatter and less exposed approach is higher), 0 otherwise. */
  readonly score: number;
  /** Real-metre spread of the mean heights of the 3x3 sim cells around the cell. */
  readonly spreadM: number;
  /** Route length in sim cells (0 when no route was planned). */
  readonly fuelCells: number;
}

/** Spread (max - min) of the real mean elevation over the 3x3 sim cells around `cell` (wrapX, clamped at the poles). */
export function heightSpreadM(nav: Nav, cell: number): number {
  const w = nav.simWidth;
  const x = cell % w;
  const y = (cell - x) / w;
  let lo = 0x7fffffff;
  let hi = -0x7fffffff;
  for (let dy = -1; dy <= 1; dy++) {
    const yy = y + dy;
    if (yy < 0 || yy >= nav.simHeight) continue;
    for (let dx = -1; dx <= 1; dx++) {
      const e = Math.max(0, nav.meanElev[yy * w + ((x + dx + w) % w)] as number);
      if (e < lo) lo = e;
      if (e > hi) hi = e;
    }
  }
  return hi - lo;
}

function reject(reason: LzReason, spreadM = 0, fuelCells = 0): LzResult {
  return { reason, score: 0, spreadM, fuelCells };
}

/** Rates the cell `cell` as a landing zone for a helicopter of `seat` that starts at `from` in flight mode `mode`. */
export function scoreLz(nav: Nav, view: NavView, seat: number, cell: number, from: number, mode: AltMode = ALT_MODE_LOW): LzResult {
  const cls = nav.terrainClass[cell] as number;
  if (cls === CLASS_DEEP_SEA || cls === CLASS_SHALLOWS) return reject(LZ_WATER);
  if (cls === CLASS_PEAK) return reject(LZ_PEAK);
  if (cls !== CLASS_PLAINS && cls !== CLASS_HILLS) return reject(LZ_TERRAIN_CLASS);
  const spread = heightSpreadM(nav, cell);
  if (spread > LZ_STEEP_SPREAD_M) return reject(LZ_STEEP, spread);
  const s = view.structures;
  const mine = seatToOwner(seat);
  const w = nav.simWidth;
  const cx = cell % w;
  const cy = (cell - cx) / w;
  const r2 = LZ_ENEMY_CITY_CELLS * LZ_ENEMY_CITY_CELLS;
  for (let id = 0; id < s.highWater; id++) {
    const owner = s.owner[id] as number;
    if (owner === 0 || owner === mine || s.type[id] !== STRUCT_CITY) continue;
    const c = s.cell[id] as number;
    const x = c % w;
    let dx = Math.abs(x - cx);
    if (dx > w - dx) dx = w - dx;
    const dy = (c - x) / w - cy;
    if (dx * dx + dy * dy <= r2) return reject(LZ_ENEMY_CITY_NEAR, spread);
  }
  if (Math.max(0, nav.meanElev[cell] as number) > LZ_MAX_ELEV_M) return reject(LZ_TOO_HIGH, spread);
  if (cellDistance(w, from, cell) > HELI_FUEL_CELLS) return reject(LZ_OUT_OF_FUEL, spread);
  const route = planRoute(nav, view, seat, from, cell, mode);
  if (!route.ok) return reject(LZ_NO_ROUTE, spread);
  if (route.fuelCells > HELI_FUEL_CELLS) return reject(LZ_OUT_OF_FUEL, spread, route.fuelCells);
  const score = Math.max(1, LZ_SCORE_BASE - LZ_SCORE_SPREAD_PER_M * spread - LZ_SCORE_EXPOSED_PER_CELL * route.exposedCells);
  return { reason: LZ_OK, score, spreadM: spread, fuelCells: route.fuelCells };
}
