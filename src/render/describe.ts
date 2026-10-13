// What is at a position of the globe, as the hover tooltip and `__test.pick` report it. Pure (no three, no GL), so it is
// unit-tested on the real packs.
//
// The render raster (4096 x 2048, about 10 km per pixel) and the sim grid (1024 x 512, about 39 km per cell) disagree at coasts:
// a coastal pixel can be land in the render raster inside a sim cell that is water (Sydney, Rio) or the other way round. What is
// DRAWN is the render raster, so land or sea is decided there (a position is land when any of the four render pixels around it
// is land, which is exactly when the filtered surface height is above 0), and the sim layer only supplies the class and, where
// the cell has none, the nearest land (or water) cell. Land therefore never says "sea" and sea never says "land".
import { decodeDepth, decodeLandHeight, TerrainClass, type RenderPack, type SimGrid } from '../data';
import { DEG, latLonToCell } from './geo';

export interface DescribeWorld {
  render: RenderPack;
  sim: SimGrid;
}

export interface GlobePick {
  lat: number;
  lon: number;
  /** Surface height at the hit in metres, filtered like the displaced mesh (0 at sea, a small blend next to a coast). */
  heightM: number;
  /** Land height in metres (the mean of the land pixels around the position, always > 0 on land), or minus the sea depth (<= 0 at sea). */
  elevationM: number;
  /** The sim cell under the position. */
  cell: { x: number; y: number; index: number };
  /** TerrainClass value shown for the position: a water class exactly when `elevationM` <= 0, a land class otherwise. */
  classId: number;
  /** Country id shown for the position (0 = none, always 0 at sea). */
  countryId: number;
}

/** Search radius in sim cells for the nearest cell of the wanted kind (land under a coastal render pixel, or water). */
export const NEAREST_CELL_RADIUS = 2;

/** Same value as SHALLOWS_MAX_DEPTH_M of the bake (tests/tooltip.test.ts compares them): sea up to this depth is Shallows. */
export const SHALLOWS_MAX_DEPTH_M = 200;

/** Land class from a height alone (the fallback where no land cell is near): the bake's max-elevation thresholds. */
export function landClassForHeight(heightM: number): number {
  if (heightM >= 5000) return TerrainClass.Peak;
  if (heightM >= 1500) return TerrainClass.Mountain;
  if (heightM >= 700) return TerrainClass.Hills;
  return TerrainClass.Plains;
}

/** Water class from a depth alone (positive metres). */
export function waterClassForDepth(depthM: number): number {
  return depthM <= SHALLOWS_MAX_DEPTH_M ? TerrainClass.Shallows : TerrainClass.DeepSea;
}

export interface NearCell {
  classId: number;
  countryId: number;
}

/** The sim cell of the wanted kind (land = class >= Plains, else water) nearest to a position, within `radius` cells; ties go to the first in scan order. */
export function nearestSimCell(sim: SimGrid, lat: number, lon: number, wantLand: boolean, radius: number = NEAREST_CELL_RADIUS): NearCell | null {
  const fx = ((lon + 180) / 360) * sim.width;
  const fy = ((90 - lat) / 180) * sim.height;
  const cx = Math.min(sim.width - 1, Math.max(0, Math.floor(fx)));
  const cy = Math.min(sim.height - 1, Math.max(0, Math.floor(fy)));
  const kx = Math.cos(lat * DEG); // east-west cell width shrinks with the latitude
  let best: NearCell | null = null;
  let bestD = Infinity;
  for (let dy = -radius; dy <= radius; dy++) {
    const y = cy + dy;
    if (y < 0 || y >= sim.height) continue;
    for (let dx = -radius; dx <= radius; dx++) {
      const x = (((cx + dx) % sim.width) + sim.width) % sim.width;
      const i = y * sim.width + x;
      const cls = sim.terrainClass[i] as number;
      if (cls >= TerrainClass.Plains !== wantLand) continue;
      const ex = (cx + dx + 0.5 - fx) * kx;
      const ey = cy + dy + 0.5 - fy;
      const d = ex * ex + ey * ey;
      if (d < bestD) {
        bestD = d;
        best = { classId: cls, countryId: sim.country[i] as number };
      }
    }
  }
  return best;
}

export interface LandSample {
  /** Bilinear fraction of the four render pixels around the position that are land (the shader's `landMask`); above 0 exactly when the filtered surface height is above 0. */
  mask: number;
  /** Mean height in metres of those land pixels (0 when none). */
  heightM: number;
  /** Country id of the land pixel with the largest weight (0 when none). */
  countryId: number;
}

/** The land mask, land-only mean height and dominant country of the render raster at a position, with the shader's `sampleLand` pixel convention (longitude wraps, latitude clamps). */
export function sampleLand(render: RenderPack, lat: number, lon: number): LandSample {
  const w = render.width;
  const h = render.height;
  const tx = ((lon + 180) / 360) * w - 0.5;
  const ty = ((90 - lat) / 180) * h - 0.5;
  const x0 = Math.floor(tx);
  const y0 = Math.floor(ty);
  const fx = tx - x0;
  const fy = ty - y0;
  let mask = 0;
  let sum = 0;
  let bestW = 0;
  let countryId = 0;
  for (let j = 0; j < 2; j++) {
    for (let i = 0; i < 2; i++) {
      const x = (((x0 + i) % w) + w) % w;
      const y = Math.min(h - 1, Math.max(0, y0 + j));
      const code = render.height8[y * w + x] as number;
      if (code === 0) continue;
      const weight = (i === 0 ? 1 - fx : fx) * (j === 0 ? 1 - fy : fy);
      mask += weight;
      sum += weight * decodeLandHeight(code);
      if (weight > bestW) {
        bestW = weight;
        countryId = render.country8[y * w + x] as number;
      }
    }
  }
  return { mask, heightM: mask > 1e-9 ? sum / mask : 0, countryId };
}

/** Cell, class, country and elevation of a position (`heightM` is the filtered surface height the pick landed on). */
export function describeAt(world: DescribeWorld, lat: number, lon: number, heightM: number): GlobePick {
  const { sim, render } = world;
  const cell = latLonToCell(lat, lon);
  let classId = sim.terrainClass[cell.index] as number;
  let countryId = sim.country[cell.index] as number;
  const land = sampleLand(render, lat, lon);
  let elevationM: number;
  if (land.mask > 0) {
    // Land in the render raster (at a coast this includes the band of up to one pixel around the drawn coast line, where the
    // surface height already ramps up from 0: the height and the word on the tooltip must agree there too).
    elevationM = land.heightM;
    if (classId < TerrainClass.Plains) {
      // ... inside a sim cell that is water: the country comes from the render id raster, the class from the nearest land cell.
      countryId = land.countryId;
      const near = nearestSimCell(sim, lat, lon, true);
      classId = near ? near.classId : landClassForHeight(elevationM);
      if (countryId === 0 && near) countryId = near.countryId;
    }
  } else {
    // Sea in the render raster: depth from the half resolution bathymetry raster (nearest pixel).
    const bx = Math.min(render.bathyWidth - 1, Math.max(0, Math.floor(((lon + 180) / 360) * render.bathyWidth)));
    const by = Math.min(render.bathyHeight - 1, Math.max(0, Math.floor(((90 - lat) / 180) * render.bathyHeight)));
    const code = render.bathy8[by * render.bathyWidth + bx] as number;
    elevationM = code === 0 ? 0 : -decodeDepth(code);
    if (classId >= TerrainClass.Plains) {
      // ... inside a sim cell that is land: no country, the class of the nearest water cell (or from the depth).
      countryId = 0;
      const near = nearestSimCell(sim, lat, lon, false);
      classId = near ? near.classId : waterClassForDepth(-elevationM);
    }
  }
  return { lat, lon, heightM, elevationM, cell, classId, countryId };
}
