// Quality tiers: test / low / medium / high. The tier fixes the globe mesh density, the pixel ratio cap and MSAA.
// `?quality=` picks a tier, `?test=1` forces `test`.

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
}

export const QUALITY: Record<QualityTier, QualitySettings> = {
  test: { tier: 'test', meshCols: 256, meshRows: 128, maxDpr: 1, antialias: false },
  low: { tier: 'low', meshCols: 256, meshRows: 128, maxDpr: 1, antialias: false },
  medium: { tier: 'medium', meshCols: 512, meshRows: 256, maxDpr: 2, antialias: true },
  high: { tier: 'high', meshCols: 1024, meshRows: 512, maxDpr: 2, antialias: true },
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

/** `?test=1` forces the test tier; otherwise `?quality=` (unknown values fall back to the default). */
export function resolveQuality(opts: { test: boolean; quality: string | null }): QualitySettings {
  if (opts.test) return QUALITY.test;
  return QUALITY[isQualityTier(opts.quality) ? opts.quality : DEFAULT_TIER];
}
