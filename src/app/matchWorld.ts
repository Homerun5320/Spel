// The world as the match setup sees it (M06): the baked sim pack, the country table and the overrides in one plain-data bundle, the
// per-country statistics the rules need (cells, coast share, mountain share), and, per playable region, the masked terrain with its
// land masses. Everything here is a pure function of the data; `prepareWorld` caches the (expensive, O(cells)) analysis per region
// inside the returned object, so the menu computes it once and `createMatch` can reuse it.
import type { Overrides, WorldMeta } from '../data/world';
import { regionMask, type RegionId } from '../data/regions';
import { CLASS_MOUNTAIN, CLASS_PEAK, CLASS_PLAINS } from '../sim/terrain';
import { maskTerrain } from '../sim/setup';
import { createSimWorld, type SimWorld, type SimWorldInput } from '../sim/world';
import { computeLandmasses, type Landmasses } from './landmass';

/** Everything the setup reads, as plain arrays (the browser builds it from the loaded packs, the tests from the files). */
export interface WorldData {
  /** The sim pack in the shape of the sim world input (terrain classes, mean elevation, the cos table). */
  readonly sim: SimWorldInput;
  /** Country id per sim cell (0 = none), `width * height` long. */
  readonly country: ArrayLike<number>;
  /** Coast flags per sim cell: bit 0 = land next to water. */
  readonly coast: ArrayLike<number>;
  readonly meta: Pick<WorldMeta, 'countries'>;
  readonly overrides: Pick<Overrides, 'merged' | 'unplayable' | 'minPlayableCells' | 'neutralNames'>;
}

/** One country as the setup knows it. */
export interface CountryInfo {
  readonly id: number;
  readonly a3: string;
  readonly nameEn: string;
  readonly nameSv: string;
  readonly continent: string;
  /** Cells of the country (meta.json). */
  readonly cells: number;
  /** Area in km2 (meta.json, the cos-latitude weighted cell area): the menu sizes the camera flight with it. */
  readonly areaKm2: number;
  /** The capital cell, or -1 when the country has none. */
  readonly capitalCell: number;
  /** Left out of the choice on purpose: the overrides' unplayable list, a merged territory, Antarctica, or a country meta.json calls unplayable. */
  readonly excluded: boolean;
  /** Share of the country's land cells that touch water, in thousandths. */
  readonly coastPermille: number;
  /** Share of the country's land cells that are Mountain or Peak, in thousandths. */
  readonly mountainPermille: number;
  /** The country id its cells count for as HOME LAND: its own id, or the id it is merged into by the overrides. */
  readonly homeId: number;
}

/** A region of the world with the mask applied: what a match in that region plays on. */
export interface RegionAnalysis {
  readonly region: RegionId;
  /** 1 = inside the region, per cell; null for the whole world. */
  readonly mask: Uint8Array | null;
  /** The terrain classes of the match world: the pack's, with every playable cell outside the mask turned into Ice. */
  readonly terrain: Uint8Array;
  readonly land: Landmasses;
  /** Cells of each country (by id) that are inside the mask, any land class. */
  readonly cellsInMask: ReadonlyMap<number, number>;
  /** The match world for this region (the mask applied), ready for `createWorldState`. */
  readonly world: SimWorld;
  /** The world hash to put in the match header, or undefined to let the state compute it (a masked world is not the pack). */
  readonly mapHash: number | undefined;
}

export interface PreparedWorld {
  readonly data: WorldData;
  readonly width: number;
  readonly height: number;
  readonly countries: readonly CountryInfo[];
  readonly byId: ReadonlyMap<number, CountryInfo>;
  /** The analysis of a region (computed on first use, then cached in this object). */
  analyse(region: RegionId): RegionAnalysis;
}

/** Shares in thousandths, floored, 0 for an empty denominator. */
function permille(part: number, whole: number): number {
  return whole > 0 ? Math.floor((part * 1000) / whole) : 0;
}

export function prepareWorld(data: WorldData): PreparedWorld {
  const { width, height } = data.sim;
  const n = width * height;
  if (data.country.length !== n || data.coast.length !== n) throw new RangeError('the country and coast layers must be width * height long');
  const idByA3 = new Map<string, number>();
  for (const c of data.meta.countries) idByA3.set(c.a3, c.id);
  const mergedInto = new Map<string, string>();
  for (const m of data.overrides.merged) mergedInto.set(m.a3, m.into);
  const unplayable = new Set(data.overrides.unplayable);

  // Land cells, coast cells and mountain cells per country in one pass over the pack.
  const land = new Map<number, number>();
  const coast = new Map<number, number>();
  const mountain = new Map<number, number>();
  const terrain = data.sim.terrainClass;
  for (let i = 0; i < n; i++) {
    const id = data.country[i] as number;
    const cls = terrain[i] as number;
    if (id === 0 || cls < CLASS_PLAINS) continue;
    land.set(id, (land.get(id) ?? 0) + 1);
    if (((data.coast[i] as number) & 1) !== 0) coast.set(id, (coast.get(id) ?? 0) + 1);
    if (cls === CLASS_MOUNTAIN || cls === CLASS_PEAK) mountain.set(id, (mountain.get(id) ?? 0) + 1);
  }

  const countries: CountryInfo[] = data.meta.countries.map((c) => {
    const parent = mergedInto.get(c.a3);
    const parentId = parent === undefined ? undefined : idByA3.get(parent);
    const cap = c.capitalCell;
    return {
      id: c.id,
      a3: c.a3,
      // The overrides give the disputed places their neutral names (item 5); everyone else keeps the Natural Earth name.
      nameEn: data.overrides.neutralNames[c.a3]?.en ?? c.name_en,
      nameSv: data.overrides.neutralNames[c.a3]?.sv ?? c.name_sv,
      continent: c.continent,
      cells: c.cells,
      areaKm2: c.weightedAreaKm2,
      capitalCell: typeof cap === 'number' && cap >= 0 && cap < n ? cap : -1,
      excluded: unplayable.has(c.a3) || parent !== undefined || c.continent === 'Antarctica' || c.playable === false,
      coastPermille: permille(coast.get(c.id) ?? 0, land.get(c.id) ?? 0),
      mountainPermille: permille(mountain.get(c.id) ?? 0, land.get(c.id) ?? 0),
      homeId: parentId ?? c.id,
    };
  });
  const byId = new Map<number, CountryInfo>();
  for (const c of countries) byId.set(c.id, c);

  const cache = new Map<RegionId, RegionAnalysis>();
  const analyse = (region: RegionId): RegionAnalysis => {
    const hit = cache.get(region);
    if (hit !== undefined) return hit;
    const mask = regionMask(region, width, height);
    const masked = maskTerrain(terrain, mask);
    const cellsInMask = new Map<number, number>();
    for (let i = 0; i < n; i++) {
      const id = data.country[i] as number;
      if (id !== 0 && (terrain[i] as number) >= CLASS_PLAINS && (mask === null || mask[i] === 1)) cellsInMask.set(id, (cellsInMask.get(id) ?? 0) + 1);
    }
    const world = createSimWorld({ ...data.sim, terrainClass: masked, mapHash: mask === null ? data.sim.mapHash : undefined });
    const out: RegionAnalysis = { region, mask, terrain: masked, land: computeLandmasses(width, height, masked), cellsInMask, world, mapHash: mask === null ? data.sim.mapHash : undefined };
    cache.set(region, out);
    return out;
  };

  return { data, width, height, countries, byId, analyse };
}
