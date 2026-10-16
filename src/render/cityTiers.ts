// Look-1 / Look-2: the visual tiers of a structure and the City style (pure numbers, no three).
// Look-2: levels are unlimited (the sim caps them at about 999), so the look follows the level through SATURATING BANDS: `levelBand` maps any level to
// band 0..BAND_COUNT-1 on a roughly logarithmic scale (edges at LEVEL_BAND_EDGES); a City model part carries the first band it appears in and the vertex
// shader collapses the parts of higher bands, so ONE instanced geometry serves every level. Beyond the last band the model gets TALLER (`levelTall`,
// up to TALL_EXTRA more height), never wider: the footprint (`levelScale`) grows at most LEVEL_SCALE_TOP times from level 1 to LEVEL_VISUAL_CAP.
// The shader repeats `levelBand` / `levelTall` through the packed instance attribute `levelCode` (below), so nothing here is read per frame.
import { DISTRICT_LEVEL_SCALE } from './config';

export const CITY_BANDS = 5;
/** The same number as BAND_COUNT: every structure type uses the bands (only the City's model has parts in higher bands). */
export const BAND_COUNT = CITY_BANDS;
/** The levels at which band 1, 2, 3, 4 start (band 0 is level 1 to 2). */
export const LEVEL_BAND_EDGES: readonly number[] = [3, 8, 20, 50];
/** The level at which the look stops changing (the sim's hard cap of levels, STRUCT_LEVEL_HARD_CAP, is 999; the look does not read it so that it never moves with a balance change). */
export const LEVEL_VISUAL_CAP = 999;
/** How much wider the footprint is at LEVEL_VISUAL_CAP than at level 1 (Look-2: was 1.5 at level 10 of 10). */
export const LEVEL_SCALE_TOP = 1.3;
/** How much taller the model is at LEVEL_VISUAL_CAP than at the first level of the last band. */
export const TALL_EXTRA = 0.3;
/** Kept for the old name: the City's footprint factor at the cap. */
export const CITY_TOP_SCALE = LEVEL_SCALE_TOP;

/** The two looks of a City: the original model ('old', the default) and the glass-and-steel one ('new', shown as "Modern"). */
export type CityStyle = 'old' | 'new';
export const CITY_STYLES: readonly CityStyle[] = ['old', 'new'];
export const DEFAULT_CITY_STYLE: CityStyle = 'old';

export const isCityStyle = (v: unknown): v is CityStyle => v === 'old' || v === 'new';

const clampLevel = (level: number): number => Math.min(LEVEL_VISUAL_CAP, Math.max(1, Number.isFinite(level) ? level : 1));

/** The band 0..BAND_COUNT-1 of a structure of `level` (any level; 1, 3, 8, 20, 50 start the bands). Monotone, saturating. */
export function levelBand(level: number): number {
  const l = clampLevel(level);
  let b = 0;
  for (const e of LEVEL_BAND_EDGES) if (l >= e) b++;
  return b;
}
/** Look-1 name of the same function (the `maxLevel` argument of Look-1 is gone: the bands no longer depend on the top level). */
export const cityBand = levelBand;

/** The footprint factor of a structure of `level`: 1 at level 1, LEVEL_SCALE_TOP at LEVEL_VISUAL_CAP, logarithmic in between (gentle). */
export function levelScale(level: number): number {
  return 1 + (LEVEL_SCALE_TOP - 1) * (Math.log(clampLevel(level)) / Math.log(LEVEL_VISUAL_CAP));
}

/** 0 up to the first level of the last band, then rising logarithmically to 1 at LEVEL_VISUAL_CAP: how far into the "taller" range a level is. */
export function levelTall(level: number): number {
  const first = LEVEL_BAND_EDGES[LEVEL_BAND_EDGES.length - 1] as number;
  const l = clampLevel(level);
  return l <= first ? 0 : Math.log(l / first) / Math.log(LEVEL_VISUAL_CAP / first);
}

/** The height factor of the model (1 up to TALL_EXTRA more). */
export function levelHeight(level: number): number {
  return 1 + TALL_EXTRA * levelTall(level);
}

/** The code the instance attribute carries in its w component: `band + 1` plus half of `levelTall` (0 = a ghost: no band parts, no lights). The shader decodes it with floor / fract. */
export function levelCode(level: number): number {
  return levelBand(level) + 1 + 0.5 * levelTall(level);
}

/** The City far-icon's lit share of its progress arc: logarithmic, full at the first level of the top band (the arc is a level-at-a-glance, not a percentage of the cap). */
export function levelArcShare(level: number): number {
  const top = LEVEL_BAND_EDGES[LEVEL_BAND_EDGES.length - 1] as number;
  return Math.min(1, Math.log(clampLevel(level)) / Math.log(top));
}

/** The size factor of a district of `level`: the Look-1 table up to level 3 (1, 1.2, 1.4), then a saturating rise to 1.5 at LEVEL_VISUAL_CAP (never narrower than the table's last step). */
export function districtLevelScale(level: number): number {
  const last = DISTRICT_LEVEL_SCALE.length - 1;
  if (level <= last) return DISTRICT_LEVEL_SCALE[Math.max(1, Math.floor(level))] ?? 1;
  const top = DISTRICT_LEVEL_SCALE[last] as number;
  const f = Math.min(1, Math.log(clampLevel(level) / last) / Math.log(LEVEL_VISUAL_CAP / last));
  return top + 0.1 * f;
}
