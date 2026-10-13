import { describe, expect, it } from 'vitest';
import { DEFAULT_TIER, QUALITY, QUALITY_TIERS, isQualityTier, meshTriangles, resolveQuality } from '../../src/render/quality';
import { parseSceneParams } from '../../src/app/params';

describe('quality tiers', () => {
  it('has exactly test / low / medium / high with growing meshes', () => {
    expect([...QUALITY_TIERS]).toEqual(['test', 'low', 'medium', 'high']);
    const tris = QUALITY_TIERS.map((t) => meshTriangles(QUALITY[t]));
    for (let i = 1; i < tris.length; i++) expect(tris[i] as number).toBeGreaterThanOrEqual(tris[i - 1] as number);
  });

  it('test tier is the 256x128 mesh, at most 150k triangles, MSAA off, DPR 1', () => {
    const t = QUALITY.test;
    expect([t.meshCols, t.meshRows]).toEqual([256, 128]);
    expect(meshTriangles(t)).toBeLessThanOrEqual(150_000);
    expect(t.antialias).toBe(false);
    expect(t.maxDpr).toBe(1);
  });

  it('high tier stays at about 1 M triangles', () => {
    const n = meshTriangles(QUALITY.high);
    expect(n).toBeLessThanOrEqual(1_100_000);
    expect(n).toBeGreaterThan(800_000);
  });

  it('?test=1 forces the test tier, ?quality= picks one, unknown values fall back to the default', () => {
    expect(resolveQuality({ test: true, quality: 'high' }).tier).toBe('test');
    expect(resolveQuality({ test: false, quality: 'high' }).tier).toBe('high');
    expect(resolveQuality({ test: false, quality: 'low' }).tier).toBe('low');
    expect(resolveQuality({ test: false, quality: 'ultra' }).tier).toBe(DEFAULT_TIER);
    expect(resolveQuality({ test: false, quality: null }).tier).toBe(DEFAULT_TIER);
    expect(isQualityTier('medium')).toBe(true);
    expect(isQualityTier('x')).toBe(false);
  });

  it('parseSceneParams reads scene and quality', () => {
    expect(parseSceneParams('')).toEqual({ scene: 'globe', quality: null });
    expect(parseSceneParams('?scene=spike&quality=low')).toEqual({ scene: 'spike', quality: 'low' });
    expect(parseSceneParams('?scene=nonsense')).toEqual({ scene: 'globe', quality: null });
  });
});
