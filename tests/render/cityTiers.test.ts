// Look-1: the City tiers (band and scale from level and top level) and the two City models.
import { describe, expect, it } from 'vitest';
import { CITY_BANDS, cityBand, levelScale } from '../../src/render/cityTiers';
import { STRUCTURE_MODELS, cityLights } from '../../src/render/structureModels';
import { STRUCT_CITY } from '../../src/sim/public';

const city = () => STRUCTURE_MODELS[STRUCT_CITY] as NonNullable<(typeof STRUCTURE_MODELS)[number]>;

describe('the tier function', () => {
  it('level 1 is the first band, the top level the last, for 3 and for 10 levels', () => {
    for (const max of [2, 3, 5, 10, 20]) {
      expect(cityBand(1, max)).toBe(0);
      expect(cityBand(max, max)).toBe(CITY_BANDS - 1);
    }
  });
  it('is monotone in the level and uses every band when the top level is 5 or more', () => {
    for (const max of [3, 5, 10]) {
      let prev = -1;
      let prevScale = 0;
      const seen = new Set<number>();
      for (let l = 1; l <= max; l++) {
        const b = cityBand(l, max);
        const sc = levelScale(l, max);
        expect(b).toBeGreaterThanOrEqual(prev);
        expect(sc).toBeGreaterThan(prevScale);
        prev = b;
        prevScale = sc;
        seen.add(b);
      }
      if (max >= 5) expect(seen.size).toBe(CITY_BANDS);
    }
  });
  it('the scale keeps the old values at three levels: 1, 1.25, 1.5', () => {
    expect([1, 2, 3].map((l) => levelScale(l, 3))).toEqual([1, 1.25, 1.5]);
  });
});

describe('the two City models', () => {
  for (const style of ['old', 'new'] as const) {
    it(`${style}: at most 260 triangles with the night lights, every band 0 to 4 has parts`, () => {
      const m = city().build(style);
      expect(m.triangles + cityLights().positions.length / 9).toBeLessThanOrEqual(260);
      const bands = m.bands as Float32Array;
      expect(bands.length).toBe(m.positions.length / 3);
      const tris = [0, 0, 0, 0, 0];
      for (let i = 0; i < bands.length; i += 3) tris[bands[i] as number] = (tris[bands[i] as number] as number) + 1;
      expect(tris.every((n) => n > 0)).toBe(true);
    });
  }
  it('the styles differ', () => {
    const a = city().build('old');
    const b = city().build('new');
    expect(a.triangles).not.toBe(b.triangles);
  });
});
