// Transforms and ground queries (M08): the ONE place that turns sim cells into latitudes, longitudes and world positions and back, that
// asks "how high is the ground here" and "where does this ray meet the ground". Pure TypeScript: no three, no DOM, no GL, so the
// render layer, UI code and (through plain numbers) the tests all call the same functions.
//
// COORDINATES. World = Earth radii, +y north, lon 0 faces +z, +x east (`src/render/geo.ts`). A cell is (x, y) on the sim grid of the
// match (`GameState` is parameterised by width and height; the shipped grid is 1024 x 512): x counts east from longitude -180 and WRAPS
// (`wrapX`: the world is a cylinder around the antimeridian), y counts south from the north pole and does NOT wrap. `index = y * width + x`.
// A cell is a rectangle of 360 / width degrees of longitude by 180 / height degrees of latitude; its centre is its position.
//
// HEIGHTS. Three heights exist at a position (docs/ARCHITECTURE.md "Rules for layers that sit on the terrain" (4)):
//   - the DATA height (`HeightField.heightM`, the filtered raster, the tooltip),
//   - the GROUND height `groundHeightAt` (this file; the very function `heightAt` of `src/render/detail.ts`, not a copy): render metres
//     BEFORE the height exaggeration, all 12 octaves of the detail. THE OCTAVE POLICY: everything that must be above or on the real
//     surface uses the default (all octaves) - the camera's clearance, a helicopter's clearance (M12/M13), a building's foundation (M10);
//     `maxOctaves` is for code that asks what a CHUNK of a level draws (`octavesForLevel`);
//   - the SEEN height `seenHeightAt` (the octaves of the distance law: what a camera draws and what `pickGround` hits). A prop that
//     must stand on the surface a camera sees (dust, a shadow blob) uses it with the camera it is seen from.
//   The camera does not need a cheaper "fast mover" variant: the octaves above the seventh are under 6 % of the 300 m clearance even
//   over the Himalaya (0.42^7 of a 600 m amplitude, times the exaggeration 12 = 17 m), and one evaluation costs 4.5 to 6 microseconds.
import { HeightSampler, bindHeightSource, heightAt as boundHeightAt, type HeightSource } from './detail';
import { DEG, add, dot, latLonToVec, scale, vecToLatLon, wrapLon, type Vec3 } from './geo';
import { EARTH_RADIUS_KM } from './config';
import { type HeightField, type RayHit } from './heightField';

/** A cell of the sim grid: column, row and `index = y * width + x`. */
export interface SimCell {
  x: number;
  y: number;
  index: number;
}

/** The longest step of the ground march in sim cells (the prompt's "0.5 cell"); `HeightField.pick` marches by a SAFE share of the clearance and never farther than its fixed 1.9 km step, which is far below this. */
export const PICK_MAX_STEP_CELLS = 0.5;

// ---- cells <-> latitude / longitude <-> world -----------------------------------------------------------------------------------

/** Wraps a cell column into 0 .. width - 1 (the world wraps east-west). */
export function wrapX(x: number, width: number): number {
  const m = x % width;
  return m < 0 ? m + width : m;
}

/** The cell index of column x (wrapped) and row y (clamped to the grid). */
export function cellIndex(x: number, y: number, width: number, height: number): number {
  const cy = y < 0 ? 0 : y >= height ? height - 1 : y;
  return cy * width + wrapX(x, width);
}

/** Column and row of a cell index. */
export function cellXY(index: number, width: number): { x: number; y: number } {
  const x = index % width;
  return { x, y: (index - x) / width };
}

/** The latitude and longitude (degrees) of the CENTRE of a cell. */
export function cellToLatLon(index: number, width: number, height: number): { lat: number; lon: number } {
  const x = index % width;
  const y = (index - x) / width;
  return { lat: ((height - 2 * y - 1) * 90) / height, lon: ((2 * x + 1 - width) * 180) / width };
}

/** The cell that contains a position (longitude wraps, latitude clamps at the poles). */
export function latLonToCell(latDeg: number, lonDeg: number, width: number, height: number): SimCell {
  const x = Math.min(width - 1, Math.max(0, Math.floor(((wrapLon(lonDeg) + 180) / 360) * width)));
  const y = Math.min(height - 1, Math.max(0, Math.floor(((90 - latDeg) / 180) * height)));
  return { x, y, index: y * width + x };
}

/** The world position (Earth radii; `radius` 1 = sea level) above a latitude and longitude. */
export function latLonToWorld(latDeg: number, lonDeg: number, radius = 1): Vec3 {
  return scale(latLonToVec(latDeg, lonDeg), radius);
}

/** The latitude, longitude and radius (Earth radii) of a world position. */
export function worldToLatLon(p: Vec3): { lat: number; lon: number; radius: number } {
  const { lat, lon } = vecToLatLon(p);
  return { lat, lon, radius: Math.sqrt(dot(p, p)) };
}

/** The world position of the centre of a cell on the sea-level sphere (or at `radius`). */
export function cellToWorld(index: number, width: number, height: number, radius = 1): Vec3 {
  const c = cellToLatLon(index, width, height);
  return latLonToWorld(c.lat, c.lon, radius);
}

/** The cell under a world position (its direction from the planet centre). */
export function worldToCell(p: Vec3, width: number, height: number): SimCell {
  const { lat, lon } = vecToLatLon(p);
  return latLonToCell(lat, lon, width, height);
}

/** Metres on the ground that one cell spans east-west at a latitude (the cos-latitude weight of the sim) and north-south. */
export function cellSizeM(latDeg: number, width: number, height: number): { eastM: number; northM: number } {
  const r = EARTH_RADIUS_KM * 1000;
  return { eastM: ((2 * Math.PI) / width) * r * Math.cos(latDeg * DEG), northM: (Math.PI / height) * r };
}

// ---- the ground height ----------------------------------------------------------------------------------------------------------

/**
 * `groundHeightAt(lat, lon, maxOctaves?)`: THE ground height in render metres at a position, before the height exaggeration, detail
 * included (land > 0, sea 0). It IS `heightAt` of `src/render/detail.ts`: one function, re-exported under the name the layers use
 * (a test pins the identity). It reads the height source the page bound (`bindHeightSource`, done by `Globe`) and THROWS when none is
 * bound: code that has no page (a unit test, a tool) builds its own source with `createGroundHeight`.
 */
export { heightAt as groundHeightAt, seenHeightAt as seenGroundHeightAt } from './detail';

/** A ground-height query over one height source: what `groundHeightAt` is, without the module-level binding. */
export interface GroundHeight {
  readonly sampler: HeightSampler;
  /** Render metres before the exaggeration, all octaves unless `maxOctaves` says fewer: `HeightSampler.heightAt` itself. */
  groundHeightAt(latDeg: number, lonDeg: number, maxOctaves?: number): number;
  /** The same height as a radius in Earth radii for a given exaggeration (the camera's and the pick's ground). */
  radiusAt(latDeg: number, lonDeg: number, exaggeration: number, maxOctaves?: number): number;
}

/**
 * The pure factory behind `groundHeightAt` (D154 (2)): `heightAt` depends on a module-global binding that only the Globe sets, so Node
 * code (transforms tests, layer tests of M10 / M12) makes its own query over a raster. `bind` true also binds it as the module-level
 * source, so `groundHeightAt` and this object answer the same numbers (the identity test uses it).
 */
export function createGroundHeight(source: HeightSource | HeightSampler, bind = false): GroundHeight {
  const sampler = source instanceof HeightSampler ? source : new HeightSampler(source);
  if (bind) bindHeightSource(sampler);
  return {
    sampler,
    groundHeightAt: (lat, lon, maxOctaves) => sampler.heightAt(lat, lon, maxOctaves),
    radiusAt: (lat, lon, exaggeration, maxOctaves) => 1 + (exaggeration * sampler.heightAt(lat, lon, maxOctaves)) / (EARTH_RADIUS_KM * 1000),
  };
}

/** True when the module-level `groundHeightAt` has a source (it throws otherwise). */
export function groundHeightBound(): boolean {
  try {
    boundHeightAt(0, 0, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Rule (2) of docs/ARCHITECTURE.md "Rules for layers that sit on the terrain", stated once: a thing that flies or stands on the ground keeps
 * its height ABOVE the ground and is re-based on the VISIBLE ground, whatever scale the sim's own altitudes have (`GAMEPLAY_HEIGHT_EXAG`, M11a).
 * `groundRadius` is the displaced ground under it (`HeightField.surfaceRadius`, Earth radii, the exaggeration already in), `aboveGroundM` the
 * sim's height above ITS ground in game metres (`altGame - EXAG_sim * meanGround(cell)`), drawn 1 : 1. M12a / M13a / M10 call it.
 */
export function radiusAboveGround(groundRadius: number, aboveGroundM: number): number {
  return groundRadius + aboveGroundM / (EARTH_RADIUS_KM * 1000);
}

// ---- picking ----------------------------------------------------------------------------------------------------------------------

export interface GroundRay {
  /** World position (Earth radii). */
  origin: Vec3;
  /** Direction (normalised by `pickGround`). */
  dir: Vec3;
}

export interface GroundHit extends RayHit {
  /** The hit as a radius in Earth radii. */
  radius: number;
  /** The same hit as render metres above the sea-level sphere before the exaggeration (the SEEN surface; `radius` carries the exaggeration). */
  seenHeightM: number;
}

/** What `pickGround` needs of a height field: the ray march. */
export type GroundPickField = Pick<HeightField, 'pick' | 'exaggeration'>;

/**
 * Where a ray first meets the ground: the surface a camera at the ray's origin SEES (`HeightField.pick`: the shell of the highest
 * possible radius, a march whose step is a safe share of the clearance and never more than the fixed step - a hundredth of the
 * prompt's 0.5 cell - then a 24-step bisection on the bracket), or null when the ray misses the globe. The hit is on the surface
 * `HeightField.seenRadius` describes to 0.05 m (tests/render/transforms.test.ts); `groundHeightAt` with the octaves of the distance
 * law gives its height.
 */
export function pickGround(field: GroundPickField, ray: GroundRay): GroundHit | null {
  const hit = field.pick(ray.origin, ray.dir);
  if (!hit) return null;
  const radius = Math.sqrt(dot(hit.point, hit.point));
  return { ...hit, radius, seenHeightM: ((radius - 1) * EARTH_RADIUS_KM * 1000) / (field.exaggeration || 1) };
}

/** A ground picker in the shape the camera rig takes: a ray in, the world point of the first ground hit (or null) out. */
export type GroundPicker = (origin: Vec3, dir: Vec3) => Vec3 | null;

/** The picker of a field for `CameraRig.setPicker` (allocates the hit only; the march itself allocates nothing per step beyond the vectors of `HeightField.pick`). */
export function groundPickerOf(field: GroundPickField): GroundPicker {
  return (origin, dir) => {
    const hit = field.pick(origin, dir);
    return hit ? hit.point : null;
  };
}

/** The first point of a ray at distance `t` (a helper for tests and layers). */
export function pointAlong(ray: GroundRay, t: number): Vec3 {
  return add(ray.origin, scale(ray.dir, t));
}
