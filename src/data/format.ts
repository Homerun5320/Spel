// Binary layout and codecs of the baked world packs. Shared by tools/bake (writer) and the loader (reader),
// so the two can never disagree. Pure: no DOM, no three, no imports from app/render/ui.

/** Render raster (equirectangular). One pixel is about 9.8 km at the equator. */
export const RENDER_WIDTH = 4096;
export const RENDER_HEIGHT = 2048;
/** Bathymetry raster (half resolution). */
export const BATHY_WIDTH = 2048;
export const BATHY_HEIGHT = 1024;
/** Sim grid (about 39 km per cell at the equator) and nav grid (4 x 4 sim cells per nav cell). */
export const SIM_WIDTH = 1024;
export const SIM_HEIGHT = 512;
export const NAV_WIDTH = 256;
export const NAV_HEIGHT = 128;
/** Render pixels per sim cell along each axis. */
export const SIM_BLOCK = RENDER_WIDTH / SIM_WIDTH;
/** Sim cells per nav cell along each axis. */
export const NAV_BLOCK = SIM_WIDTH / NAV_WIDTH;

/** Sqrt coding: decoded metres = max * (code / 255)^2. Land max 9000 m, depth max 11000 m (also in meta.json). */
export const LAND_MAX_M = 9000;
export const DEPTH_MAX_M = 11000;
/** Smallest code that decodes to >= 1 m for both maxima: (3/255)^2 * 9000 = 1.25 m. Code 0 is reserved for "no land / no water". */
export const MIN_LAND_CODE = 3;

export function encodeSqrt(metres: number, maxMetres: number): number {
  const m = metres < 0 ? 0 : metres > maxMetres ? maxMetres : metres;
  return Math.round(255 * Math.sqrt(m / maxMetres));
}

export function decodeSqrt(code: number, maxMetres: number): number {
  const f = code / 255;
  return maxMetres * f * f;
}

/** Land height code (>= MIN_LAND_CODE, decodes to >= 1 m). */
export function encodeLandHeight(metres: number): number {
  const c = encodeSqrt(metres, LAND_MAX_M);
  return c < MIN_LAND_CODE ? MIN_LAND_CODE : c;
}
export function decodeLandHeight(code: number): number {
  return decodeSqrt(code, LAND_MAX_M);
}
/** Depth code of a sea pixel (>= MIN_LAND_CODE, decodes to >= 1 m deep). */
export function encodeDepth(metres: number): number {
  const c = encodeSqrt(metres, DEPTH_MAX_M);
  return c < MIN_LAND_CODE ? MIN_LAND_CODE : c;
}
export function decodeDepth(code: number): number {
  return decodeSqrt(code, DEPTH_MAX_M);
}

/** Terrain classes of the sim grid (numeric values are part of the pack format). */
export const TerrainClass = {
  DeepSea: 0,
  Shallows: 1,
  Plains: 2,
  Forest: 3,
  Hills: 4,
  Mountain: 5,
  Peak: 6,
  Ice: 7,
} as const;
export type TerrainClassId = (typeof TerrainClass)[keyof typeof TerrainClass];
export const TERRAIN_CLASS_NAMES = ['DeepSea', 'Shallows', 'Plains', 'Forest', 'Hills', 'Mountain', 'Peak', 'Ice'] as const;

/** Nav grid flag bits (u8 per nav cell). */
export const NavFlag = {
  AnyLand: 1,
  AllLand: 2,
  AnyRough: 4, // any Mountain or Peak sim cell
  AnyIce: 8,
  AnyCoast: 16,
} as const;

export type LayerType = 'u8' | 'i16';

export interface LayerSpec {
  name: string;
  type: LayerType;
  width: number;
  height: number;
  description: string;
}

/** Layers of a pack in file order. Int16 layers come first so that they stay 2-byte aligned (little endian). */
export const PACK_LAYERS: Record<'render' | 'sim', LayerSpec[]> = {
  render: [
    { name: 'height', type: 'u8', width: RENDER_WIDTH, height: RENDER_HEIGHT, description: 'land mean height, sqrt code (max 9000 m), 0 = sea' },
    { name: 'bathy', type: 'u8', width: BATHY_WIDTH, height: BATHY_HEIGHT, description: 'sea depth, sqrt code (max 11000 m), 0 = land' },
    { name: 'country', type: 'u8', width: RENDER_WIDTH, height: RENDER_HEIGHT, description: 'country id by descending area, 0 = none' },
  ],
  sim: [
    { name: 'meanElev', type: 'i16', width: SIM_WIDTH, height: SIM_HEIGHT, description: 'mean elevation in metres (land >= 1, sea <= -1)' },
    { name: 'maxElev', type: 'i16', width: SIM_WIDTH, height: SIM_HEIGHT, description: 'max elevation in metres (land >= 1, sea <= -1, shallowest point)' },
    { name: 'navMaxElev', type: 'i16', width: NAV_WIDTH, height: NAV_HEIGHT, description: 'nav grid: max of maxElev over the 4 x 4 sim cells' },
    { name: 'land', type: 'u8', width: SIM_WIDTH, height: SIM_HEIGHT, description: 'land mask, 1 = land' },
    { name: 'class', type: 'u8', width: SIM_WIDTH, height: SIM_HEIGHT, description: 'TerrainClass' },
    { name: 'country', type: 'u8', width: SIM_WIDTH, height: SIM_HEIGHT, description: 'majority country id of the land pixels, 0 = none' },
    { name: 'coast', type: 'u8', width: SIM_WIDTH, height: SIM_HEIGHT, description: 'bit 0: land cell next to water, bit 1: water cell next to land (8-neighbourhood)' },
    { name: 'ruggedness', type: 'u8', width: SIM_WIDTH, height: SIM_HEIGHT, description: 'height range inside the cell in 12 m steps, 0..255' },
    { name: 'navFlags', type: 'u8', width: NAV_WIDTH, height: NAV_HEIGHT, description: 'nav grid: NavFlag bits' },
  ],
};

export const COAST_LAND_BIT = 1;
export const COAST_WATER_BIT = 2;

export interface LayerLayout extends LayerSpec {
  offset: number;
  bytes: number;
}

export function bytesPerSample(type: LayerType): number {
  return type === 'i16' ? 2 : 1;
}

/** Offsets of every layer of a pack. */
export function layoutOf(pack: 'render' | 'sim'): { layers: LayerLayout[]; totalBytes: number } {
  const layers: LayerLayout[] = [];
  let offset = 0;
  for (const spec of PACK_LAYERS[pack]) {
    const bytes = spec.width * spec.height * bytesPerSample(spec.type);
    layers.push({ ...spec, offset, bytes });
    offset += bytes;
  }
  return { layers, totalBytes: offset };
}

export const PACK_NAMES = ['render', 'sim'] as const;
export type PackName = (typeof PACK_NAMES)[number];
