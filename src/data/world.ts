// Typed views over the baked packs, and the high-level loader. Read-only data: nothing here mutates a pack.
import {
  BATHY_HEIGHT,
  BATHY_WIDTH,
  NAV_HEIGHT,
  NAV_WIDTH,
  RENDER_HEIGHT,
  RENDER_WIDTH,
  SIM_HEIGHT,
  SIM_WIDTH,
  decodeDepth,
  decodeLandHeight,
  layoutOf,
  type PackName,
} from './format';
import { DataLoader, type LoaderOptions, type LoadTiming } from './loader';

export interface RenderPack {
  width: number;
  height: number;
  bathyWidth: number;
  bathyHeight: number;
  /** Land mean height, sqrt code (decodeLandHeight), 0 = sea. */
  height8: Uint8Array;
  /** Sea depth, sqrt code (decodeDepth), 0 = land. */
  bathy8: Uint8Array;
  /** Country id by descending area, 0 = none. */
  country8: Uint8Array;
}

export interface SimGrid {
  width: number;
  height: number;
  /** Mean elevation in metres (land >= 1, sea <= -1). */
  meanElev: Int16Array;
  /** Max elevation in metres (land >= 1, sea <= -1). */
  maxElev: Int16Array;
  land: Uint8Array;
  /** TerrainClass value per cell. */
  terrainClass: Uint8Array;
  country: Uint8Array;
  /** Bit 0: land next to water, bit 1: water next to land. */
  coast: Uint8Array;
  ruggedness: Uint8Array;
  navWidth: number;
  navHeight: number;
  navFlags: Uint8Array;
  navMaxElev: Int16Array;
}

export interface CountryMeta {
  id: number;
  a3: string;
  name_en: string;
  name_sv: string;
  name_long: string;
  continent: string;
  population: number;
  cells: number;
  weightedAreaKm2: number;
  capitalCell: number | null;
  capitalSource: 'city' | 'central' | null;
  capitalName: string | null;
  playable: boolean;
}

export interface WorldMeta {
  version: number;
  source: { naturalEarth: { sha: string; repo: string }; terrarium: { zoom: number } };
  encoding: { heightSqrt: { maxM: number }; depthSqrt: { maxM: number } };
  sim: { width: number; height: number; cosQ15: number[]; classes: string[] };
  counts: { landCells: number; landCellsNoAntarctica: number; nonIceLandCells: number; classes: Record<string, number>; countries: number; countriesWithMinCells: number };
  countries: CountryMeta[];
}

export interface City {
  name: string;
  lat: number;
  lon: number;
  population: number;
  cell: number;
  country: number;
  capital: boolean;
}
export interface Port {
  name: string;
  lat: number;
  lon: number;
  rank: number;
  cell: number;
  country: number;
}
export interface Overrides {
  version: number;
  minPlayableCells: number;
  merged: Array<{ a3: string; into: string }>;
  unplayable: string[];
  neutralNames: Record<string, { en: string; sv: string }>;
}

function sliceOf(bytes: Uint8Array, offset: number, length: number): Uint8Array {
  return bytes.subarray(offset, offset + length);
}

/** Int16 view of a payload region; copies when the region is not 2-byte aligned. */
function int16Of(bytes: Uint8Array, offset: number, length: number): Int16Array {
  const start = bytes.byteOffset + offset;
  if (start % 2 === 0) return new Int16Array(bytes.buffer, start, length / 2);
  return new Int16Array(bytes.slice(offset, offset + length).buffer);
}

export function renderPackView(bytes: Uint8Array): RenderPack {
  const { layers, totalBytes } = layoutOf('render');
  if (bytes.length !== totalBytes) throw new Error(`render pack is ${bytes.length} bytes, expected ${totalBytes}`);
  const L = (name: string): { offset: number; bytes: number } => {
    const l = layers.find((x) => x.name === name);
    if (!l) throw new Error(`no layer ${name}`);
    return l;
  };
  return {
    width: RENDER_WIDTH,
    height: RENDER_HEIGHT,
    bathyWidth: BATHY_WIDTH,
    bathyHeight: BATHY_HEIGHT,
    height8: sliceOf(bytes, L('height').offset, L('height').bytes),
    bathy8: sliceOf(bytes, L('bathy').offset, L('bathy').bytes),
    country8: sliceOf(bytes, L('country').offset, L('country').bytes),
  };
}

export function simGridView(bytes: Uint8Array): SimGrid {
  const { layers, totalBytes } = layoutOf('sim');
  if (bytes.length !== totalBytes) throw new Error(`sim pack is ${bytes.length} bytes, expected ${totalBytes}`);
  const L = (name: string): { offset: number; bytes: number } => {
    const l = layers.find((x) => x.name === name);
    if (!l) throw new Error(`no layer ${name}`);
    return l;
  };
  return {
    width: SIM_WIDTH,
    height: SIM_HEIGHT,
    meanElev: int16Of(bytes, L('meanElev').offset, L('meanElev').bytes),
    maxElev: int16Of(bytes, L('maxElev').offset, L('maxElev').bytes),
    land: sliceOf(bytes, L('land').offset, L('land').bytes),
    terrainClass: sliceOf(bytes, L('class').offset, L('class').bytes),
    country: sliceOf(bytes, L('country').offset, L('country').bytes),
    coast: sliceOf(bytes, L('coast').offset, L('coast').bytes),
    ruggedness: sliceOf(bytes, L('ruggedness').offset, L('ruggedness').bytes),
    navWidth: NAV_WIDTH,
    navHeight: NAV_HEIGHT,
    navFlags: sliceOf(bytes, L('navFlags').offset, L('navFlags').bytes),
    navMaxElev: int16Of(bytes, L('navMaxElev').offset, L('navMaxElev').bytes),
  };
}

/** Decoded land height in metres at a render pixel (0 for sea). */
export function renderLandHeightM(pack: RenderPack, x: number, y: number): number {
  const c = pack.height8[y * pack.width + x] as number;
  return c === 0 ? 0 : decodeLandHeight(c);
}
/** Decoded sea depth in metres at a bathymetry pixel (0 for land). */
export function bathyDepthM(pack: RenderPack, x: number, y: number): number {
  const c = pack.bathy8[y * pack.bathyWidth + x] as number;
  return c === 0 ? 0 : decodeDepth(c);
}

export interface WorldLoad {
  loader: DataLoader;
  loadRender(): Promise<RenderPack>;
  loadSim(): Promise<SimGrid>;
  loadMeta(): Promise<WorldMeta>;
  loadCities(): Promise<City[]>;
  loadPorts(): Promise<Port[]>;
  loadOverrides(): Promise<Overrides>;
  timings(): LoadTiming[];
}

/** Entry point: pass the injected manifest address and readBytes, get lazy typed loaders. */
export function createWorldLoader(opts: LoaderOptions): WorldLoad {
  const loader = new DataLoader(opts);
  const packOf = async (name: PackName): Promise<Uint8Array> => loader.loadPack(name);
  return {
    loader,
    loadRender: async () => renderPackView(await packOf('render')),
    loadSim: async () => simGridView(await packOf('sim')),
    loadMeta: () => loader.loadJson<WorldMeta>('meta.json'),
    loadCities: () => loader.loadJson<City[]>('cities.json'),
    loadPorts: () => loader.loadJson<Port[]>('ports.json'),
    loadOverrides: () => loader.loadJson<Overrides>('overrides.json'),
    timings: () => loader.timings,
  };
}
