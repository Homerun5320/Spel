// Level curves (Sim-Levels2): what a structure or district of ANY level gives. Every curve is concave with a hard asymptote and uses
// integer maths only: value(L) = base + floor(extra * sat(L) / 1000), sat(L) = floor(1000 * (L - 1) / (L - 1 + LEVEL_SAT_K)) in 0..999.
// Level 1 is always exactly `base` (unchanged from before the change); level 10 is about 1.7 to 1.8 times level 1 for the gold curves, level 100
// only a little more than level 10, and no level ever passes base + extra. Pure, imports only rules.ts.
import {
  BARRACKS_REGEN_EXTRA_PCT,
  BARRACKS_REGEN_PCT_BASE,
  CAP_CITY_LEVEL_TROOPS,
  CITY_GOLD_EXTRA_MILLI,
  CITY_GOLD_MILLI_PER_SEC_PER_LEVEL,
  CITY_TROOP_EXTRA_TROOPS,
  FACTORY_CITY_BONUS_EXTRA_PCT,
  FACTORY_CITY_BONUS_PCT,
  FACTORY_GOLD_EXTRA_MILLI,
  FACTORY_GOLD_MILLI_PER_SEC,
  FACTORY_RADIUS_CELLS,
  FACTORY_RADIUS_EXTRA_CELLS,
  HOUSING_TROOPS_BASE,
  HOUSING_TROOPS_EXTRA,
  LEVEL_SAT_K,
  MARKET_GOLD_EXTRA_MILLI,
  MARKET_GOLD_MILLI_BASE,
  PORT_GOLD_EXTRA_MILLI,
  PORT_GOLD_MILLI_PER_SEC,
  PORT_TRADE_EXTRA_PCT,
  SAM_RADIUS_BASE_CELLS,
  SAM_RADIUS_EXTRA_CELLS,
  STRUCT_LEVEL_HARD_CAP,
  WALLS_COST_EXTRA_PCT,
  WALLS_COST_PCT_BASE,
} from './rules';

/** The saturation of a level in thousandths: 0 at level 1, rising with a flat tail towards (never reaching) 1000. */
export function satPermille(level: number): number {
  if (level <= 1) return 0;
  const l = level - 1;
  return Math.floor((l * 1000) / (l + LEVEL_SAT_K));
}

function lift(base: number, extra: number, level: number): number {
  return base + Math.floor((extra * satPermille(level)) / 1000);
}

/** Gold per second (milli) of a finished City before the Factory bonus: 1.5 at level 1, towards 3.0. */
export function cityGoldMilliAt(level: number): number {
  return level < 1 ? 0 : lift(CITY_GOLD_MILLI_PER_SEC_PER_LEVEL, CITY_GOLD_EXTRA_MILLI, level);
}
/** Troops a finished City adds to the cap: CAP_CITY_LEVEL_TROOPS at level 1, towards that plus CITY_TROOP_EXTRA_TROOPS. */
export function cityTroopCapAt(level: number): number {
  return level < 1 ? 0 : lift(CAP_CITY_LEVEL_TROOPS, CITY_TROOP_EXTRA_TROOPS, level);
}
export function factoryGoldMilliAt(level: number): number {
  return level < 1 ? 0 : lift(FACTORY_GOLD_MILLI_PER_SEC, FACTORY_GOLD_EXTRA_MILLI, level);
}
export function factoryCityBonusPctAt(level: number): number {
  return level < 1 ? 0 : lift(FACTORY_CITY_BONUS_PCT, FACTORY_CITY_BONUS_EXTRA_PCT, level);
}
export function factoryRadiusCellsAt(level: number): number {
  return level < 1 ? 0 : lift(FACTORY_RADIUS_CELLS, FACTORY_RADIUS_EXTRA_CELLS, level);
}
export function portGoldMilliAt(level: number): number {
  return level < 1 ? 0 : lift(PORT_GOLD_MILLI_PER_SEC, PORT_GOLD_EXTRA_MILLI, level);
}
/** The percent of its trade value a Port earns: 100 at level 1, towards 120. */
export function portTradePctAt(level: number): number {
  return level < 1 ? 0 : lift(100, PORT_TRADE_EXTRA_PCT, level);
}
/** SAM / Silo radius in sim cells on flat ground: 24 at level 1, towards 32. */
export function samRadiusBaseAt(level: number): number {
  return level < 1 ? 0 : lift(SAM_RADIUS_BASE_CELLS, SAM_RADIUS_EXTRA_CELLS, level);
}
export function housingTroopsAt(level: number): number {
  return level < 1 ? 0 : lift(HOUSING_TROOPS_BASE, HOUSING_TROOPS_EXTRA, level);
}
export function marketGoldMilliAt(level: number): number {
  return level < 1 ? 0 : lift(MARKET_GOLD_MILLI_BASE, MARKET_GOLD_EXTRA_MILLI, level);
}
export function barracksRegenPctAt(level: number): number {
  return level < 1 ? 0 : lift(BARRACKS_REGEN_PCT_BASE, BARRACKS_REGEN_EXTRA_PCT, level);
}
/** The attacker's cell price in percent behind Walls of a level: 150 at level 1, towards 200. */
export function wallsCostPctAt(level: number): number {
  return level < 1 ? 0 : lift(WALLS_COST_PCT_BASE, WALLS_COST_EXTRA_PCT, level);
}

/** A table indexed by level (0 unused, 1..STRUCT_LEVEL_HARD_CAP) for the UI that reads tables. */
function tableOf(fn: (level: number) => number): readonly number[] {
  const t: number[] = [0];
  for (let level = 1; level <= STRUCT_LEVEL_HARD_CAP; level++) t.push(fn(level));
  return Object.freeze(t);
}
export const FACTORY_GOLD_MILLI_BY_LEVEL = tableOf(factoryGoldMilliAt);
export const FACTORY_CITY_BONUS_PCT_BY_LEVEL = tableOf(factoryCityBonusPctAt);
export const FACTORY_RADIUS_CELLS_BY_LEVEL = tableOf(factoryRadiusCellsAt);
export const PORT_GOLD_MILLI_BY_LEVEL = tableOf(portGoldMilliAt);
export const PORT_TRADE_PCT_BY_LEVEL = tableOf(portTradePctAt);
