// Quality tiers: test / low / medium / high. The tier fixes the globe mesh density, the pixel ratio cap and MSAA.
// `?quality=` picks a tier, `?test=1` forces `test`; without either the card class (AutoTier-1, `gpuClass.ts`) picks the default.

import type { GpuClass } from './gpuClass';

export type QualityTier = 'test' | 'low' | 'medium' | 'high';

export const QUALITY_TIERS: readonly QualityTier[] = ['test', 'low', 'medium', 'high'];

export interface QualitySettings {
  tier: QualityTier;
  /** Globe mesh: longitude segments x latitude segments (triangles = 2 x cols x rows). */
  meshCols: number;
  meshRows: number;
  /** Highest device pixel ratio used. */
  maxDpr: number;
  antialias: boolean;
  /** Terrain chunks (M07a): grid cells per chunk side (the shared mesh has (cells + 1)^2 vertices plus skirts). */
  chunkCells: number;
  /** Hard cap on the chunks drawn per frame (never above `CHUNK_ABSOLUTE_MAX`): the triangle budget is this times `chunkTriangles`. */
  chunkMax: number;
  /** Split distance of a chunk in chunk sizes: a chunk splits while the camera is closer than `chunkSplitK` times its side (smaller = coarser and cheaper). */
  chunkSplitK: number;
  /** The same for the finest levels (cells below 1/8 of a raster texel), where the height raster has no detail left to show. */
  chunkDeepK: number;
}

/** No tier and no camera pose ever draws more chunks than this. */
export const CHUNK_ABSOLUTE_MAX = 400;

export const QUALITY: Record<QualityTier, QualitySettings> = {
  test: { tier: 'test', meshCols: 256, meshRows: 128, maxDpr: 1, antialias: false, chunkCells: 16, chunkMax: 150, chunkSplitK: 4.5, chunkDeepK: 1.8 },
  low: { tier: 'low', meshCols: 256, meshRows: 128, maxDpr: 1, antialias: false, chunkCells: 16, chunkMax: 100, chunkSplitK: 4.5, chunkDeepK: 1.8 },
  medium: { tier: 'medium', meshCols: 512, meshRows: 256, maxDpr: 2, antialias: true, chunkCells: 32, chunkMax: 300, chunkSplitK: 4.5, chunkDeepK: 2.2 },
  high: { tier: 'high', meshCols: 1024, meshRows: 512, maxDpr: 2, antialias: true, chunkCells: 32, chunkMax: 400, chunkSplitK: 9, chunkDeepK: 3.2 },
};

/** Tier used when `?quality=` is absent and not in test mode. */
export const DEFAULT_TIER: QualityTier = 'medium';

export function isQualityTier(value: string | null | undefined): value is QualityTier {
  return value === 'test' || value === 'low' || value === 'medium' || value === 'high';
}

/** Triangles of the globe mesh of a tier (poles included). */
export function meshTriangles(s: QualitySettings): number {
  return 2 * s.meshCols * s.meshRows;
}

/** Where the tier of a page came from (a field of the perf report). `test` is the forced test tier of `?test=1`. */
export type TierSource = 'test' | 'param' | 'dev' | 'pref' | 'auto' | 'default';

export interface QualityOptions {
  test: boolean;
  quality: string | null;
  chunkTier?: string | null;
  /** The card class (AutoTier-1); absent = unknown = the old default. */
  gpuClass?: GpuClass | null;
  /** The player's stored tier (the pref `quality`), raw. */
  pref?: string | null;
  /** True when `quality` came from the Dev panel (it writes the address hash) instead of a typed `?quality=`. */
  fromDev?: boolean;
}

/** Tier of an integrated or software card when nothing else was chosen. */
export const WEAK_GPU_TIER: QualityTier = 'low';

/**
 * `?test=1` forces the test tier (MSAA off, DPR 1); otherwise the order is `?quality=` (the Dev panel writes it too), the stored pref, the
 * class of the card (integrated / software -> `low`) and `DEFAULT_TIER`. The automatic choice is never written to the prefs. In test mode
 * `chunkTier` (`?chunktier=high`) swaps in the chunk density of another tier, so that the headless tests can render the chunk terrain
 * of the high tier without leaving the deterministic test settings.
 */
export function resolveQualityChoice(opts: QualityOptions): { settings: QualitySettings; source: TierSource } {
  if (opts.test) {
    if (isQualityTier(opts.chunkTier) && opts.chunkTier !== 'test') {
      const t = QUALITY[opts.chunkTier];
      return { settings: { ...QUALITY.test, chunkCells: t.chunkCells, chunkMax: t.chunkMax, chunkSplitK: t.chunkSplitK, chunkDeepK: t.chunkDeepK }, source: 'test' };
    }
    return { settings: QUALITY.test, source: 'test' };
  }
  if (isQualityTier(opts.quality)) return { settings: QUALITY[opts.quality], source: opts.fromDev === true ? 'dev' : 'param' };
  if (isQualityTier(opts.pref)) return { settings: QUALITY[opts.pref], source: 'pref' };
  if (opts.gpuClass === 'integrated' || opts.gpuClass === 'software') return { settings: QUALITY[WEAK_GPU_TIER], source: 'auto' };
  return { settings: QUALITY[DEFAULT_TIER], source: 'default' };
}

export function resolveQuality(opts: QualityOptions): QualitySettings {
  return resolveQualityChoice(opts).settings;
}

/** Triangles of one chunk instance: the grid (2 per cell) plus the skirts (4 edges x cells x 2). */
export function chunkTriangles(s: Pick<QualitySettings, 'chunkCells'>): number {
  const n = s.chunkCells;
  return 2 * n * n + 8 * n;
}

/** The hard triangle budget of a tier's chunk terrain (the cap on chunks times the triangles of one). */
export function chunkTriangleBudget(s: QualitySettings): number {
  return Math.min(s.chunkMax, CHUNK_ABSOLUTE_MAX) * chunkTriangles(s);
}
