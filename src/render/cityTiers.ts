// Look-1: the City's visual tiers and its style (pure numbers, no three). A City of level L of at most M levels shows one of CITY_BANDS bands
// (hamlet, village, town, city, metropolis): a model part carries the first band it appears in and the vertex shader collapses the parts of
// higher bands, so ONE instanced geometry serves every level and any maximum level (3 before Sim-Growth, 10 now: `maxLevelOf(STRUCT_CITY)`). The shader repeats `cityBand`.
import { STRUCT_CITY, maxLevelOf } from '../sim/public';

export const CITY_BANDS = 5;
/** The two looks of a City: the original model ('old', the default) and the glass-and-steel one ('new', shown as "Modern"). */
export type CityStyle = 'old' | 'new';
export const CITY_STYLES: readonly CityStyle[] = ['old', 'new'];
export const DEFAULT_CITY_STYLE: CityStyle = 'old';
/** How much larger the top level's instance is than level 1's (the scale grows linearly with the level). */
export const CITY_TOP_SCALE = 1.5;

export const isCityStyle = (v: unknown): v is CityStyle => v === 'old' || v === 'new';

/** The band 0..CITY_BANDS-1 of a City of `level` when the top level is `maxLevel`. Monotone in `level`; level 1 is band 0, the top level the last band. */
export function cityBand(level: number, maxLevel: number = maxLevelOf(STRUCT_CITY)): number {
  if (maxLevel <= 1) return 0;
  const f = (Math.min(Math.max(level, 1), maxLevel) - 1) / (maxLevel - 1);
  return Math.min(CITY_BANDS - 1, Math.floor(f * CITY_BANDS + 1e-4));
}

/** The instance scale of a City of `level`: 1 at level 1 up to CITY_TOP_SCALE at the top level (1, 1.25, 1.5 for three levels, as before). */
export function levelScale(level: number, maxLevel: number = maxLevelOf(STRUCT_CITY)): number {
  if (maxLevel <= 1) return 1;
  const f = (Math.min(Math.max(level, 1), maxLevel) - 1) / (maxLevel - 1);
  return 1 + (CITY_TOP_SCALE - 1) * f;
}
