// ALL tunable thresholds of the bake in ONE file (docs/DECISIONS.md, M01 lists the same values with the reason for each).
// Terrarium z4 smooths peaks heavily (measured on the raw grid: Himalaya box 6563 m, Andes 6034 m, Alps 3358 m), so the
// class thresholds are set to reach the shares in the acceptance list, not to match textbook mountain heights.
import { TerrainClass, type TerrainClassId } from '../../src/data/format';

// ---- Heights ---------------------------------------------------------------------------------------------------------
/** A pixel is replaced by the 3 x 3 median when it deviates more than this from it (metres). Removes the two 11 500 m error pixels. */
export const SPIKE_MEDIAN_DEVIATION_M = 2000;

/** Polar caps (beyond the Web Mercator limit of about 85.05 degrees) copy the nearest real row, smoothed with a box of +-this many columns. */
export const POLAR_SMOOTH_COLUMNS = 32;

// ---- Sim cell aggregation --------------------------------------------------------------------------------------------
/** A sim cell (4 x 4 render pixels) is land when at least this many of its 16 pixels are inside a Natural Earth polygon. */
export const LAND_MIN_PIXELS = 8;
/** Ruggedness byte = height range inside the cell divided by this many metres, clamped to 255. */
export const RUGGEDNESS_STEP_M = 12;

// ---- Water -----------------------------------------------------------------------------------------------------------
/** Sea cells whose mean depth is at most this are Shallows (continental shelf edge), deeper are DeepSea. */
export const SHALLOWS_MAX_DEPTH_M = 200;

// ---- Ice (unplayable) ------------------------------------------------------------------------------------------------
/** Land north of this latitude is Ice. */
export const ICE_NORTH_LAT = 84;
/** Antarctica (Natural Earth ADM0_A3) is Ice everywhere. */
export const ICE_COUNTRY_A3 = 'ATA';
/** Ice caps: land at |lat| >= ICE_CAP_MIN_LAT with mean elevation >= ICE_CAP_MIN_MEAN_M (Greenland's ice sheet). */
export const ICE_CAP_MIN_LAT = 62;
export const ICE_CAP_MIN_MEAN_M = 1400;

// ---- Relief classes (land, not Ice) ----------------------------------------------------------------------------------
/** Peak: max elevation of the cell >= this. */
export const PEAK_MIN_MAX_M = 5000;
/** Mountain: max elevation >= this (and below the Peak threshold). */
export const MOUNTAIN_MIN_MAX_M = 1500;
/** Hills: max elevation >= this, or ruggedness >= HILLS_MIN_RUGGEDNESS. */
export const HILLS_MIN_MAX_M = 700;
export const HILLS_MIN_RUGGEDNESS = 30;

// ---- Biome rule (Forest or Plains), no rivers --------------------------------------------------------------------------
/** No Forest above this mean elevation. */
export const FOREST_MAX_MEAN_M = 2500;
/** Forest probability in percent by absolute latitude: [upper bound (exclusive), percent], first match wins. */
export const FOREST_PERCENT_BY_LAT: ReadonlyArray<readonly [number, number]> = [
  [10, 75], // equatorial rain forest belt
  [25, 12], // subtropical dry belt
  [40, 35], // warm temperate
  [60, 60], // temperate and boreal forest
  [70, 40], // taiga edge
  [90, 5], // tundra
];
/** Integer salts of the cell hash (blotch hash on blocks of FOREST_BLOCK cells, fine hash per cell). */
export const FOREST_BLOCK = 4;
export const FOREST_SALT_BLOTCH = 0x9e3779b1;
export const FOREST_SALT_FINE = 0x85ebca6b;
/** Weight (percent) of the blotch hash in the forest score; the rest comes from the per-cell hash. */
export const FOREST_BLOTCH_WEIGHT = 70;

// ---- Microstates, cities, ports --------------------------------------------------------------------------------------
/** A country with fewer land sim cells is not playable on its own (overrides.json). */
export const MIN_PLAYABLE_CELLS = 8;
/** Cities: this many largest places by pop_max, plus every Admin-0 capital. */
export const MAX_CITIES = 600;
/** BFS radius in sim cells when snapping capitals, cities and ports. */
export const SNAP_RADIUS_CELLS = 3;
/** Render pixels searched around a point when the country-id raster has no country there (coastal city outside the 50m polygon). */
export const COUNTRY_SEARCH_PIXELS = 12;

// ---- Hash and classification -----------------------------------------------------------------------------------------
/** Integer hash of two coordinates and a salt (no floating point). */
export function cellHash(x: number, y: number, salt: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ salt;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}

export function forestPercent(absLat: number): number {
  for (const [upper, percent] of FOREST_PERCENT_BY_LAT) if (absLat < upper) return percent;
  return 0;
}

export interface WaterCell {
  /** Mean depth in metres (positive). */
  meanDepthM: number;
}

export function classifyWater(c: WaterCell): TerrainClassId {
  return c.meanDepthM <= SHALLOWS_MAX_DEPTH_M ? TerrainClass.Shallows : TerrainClass.DeepSea;
}

export interface LandCell {
  x: number;
  y: number;
  /** Latitude of the cell centre in degrees. */
  lat: number;
  meanElevM: number;
  maxElevM: number;
  ruggedness: number;
  isAntarctica: boolean;
}

export function classifyLand(c: LandCell): TerrainClassId {
  const absLat = c.lat < 0 ? -c.lat : c.lat;
  if (c.isAntarctica || c.lat > ICE_NORTH_LAT) return TerrainClass.Ice;
  if (absLat >= ICE_CAP_MIN_LAT && c.meanElevM >= ICE_CAP_MIN_MEAN_M) return TerrainClass.Ice;
  if (c.maxElevM >= PEAK_MIN_MAX_M) return TerrainClass.Peak;
  if (c.maxElevM >= MOUNTAIN_MIN_MAX_M) return TerrainClass.Mountain;
  if (c.maxElevM >= HILLS_MIN_MAX_M || c.ruggedness >= HILLS_MIN_RUGGEDNESS) return TerrainClass.Hills;
  if (c.meanElevM < FOREST_MAX_MEAN_M) {
    const blotch = cellHash(Math.floor(c.x / FOREST_BLOCK), Math.floor(c.y / FOREST_BLOCK), FOREST_SALT_BLOTCH) % 100;
    const fine = cellHash(c.x, c.y, FOREST_SALT_FINE) % 100;
    const score = Math.floor((FOREST_BLOTCH_WEIGHT * blotch + (100 - FOREST_BLOTCH_WEIGHT) * fine) / 100);
    if (score < forestPercent(absLat)) return TerrainClass.Forest;
  }
  return TerrainClass.Plains;
}

// ---- Federations (M18b-1; docs/DECISIONS.md block M18b-1 has the measurements) ------------------------------------------
/**
 * A country is a federation candidate when it has Natural Earth admin-1 provinces AND at least this many land sim cells:
 * 2000 is about 1.6 % of the 124 869 land cells without Antarctica. Measured: it admits Russia, Canada, the USA, China, Brazil,
 * Australia and India (2256 cells) and excludes Indonesia (1229) and South Africa (924); Kazakhstan (2653) and Argentina (2258)
 * are over the line but the 50 m admin-1 file has no provinces for them.
 */
export const FEDERATION_MIN_AREA_CELLS = 2000;
/** A sub-nation holds at least this many land cells (about 1.5 times the fair start K = 197 plus room to grow), else it is merged into a neighbour. */
export const FEDERATION_MIN_PROVINCE_CELLS = 300;
/** At most this many sub-nations per country: the smallest are merged into their smallest neighbour until the count fits. */
export const FEDERATION_MAX_SUBNATIONS = 12;
/** A province with at most this many cells is "tiny": it is listed but never a sub-nation of its own. */
export const PROVINCE_TINY_CELLS = 1;
