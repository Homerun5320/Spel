// Look-1 / Look-2: the structure tiers (band, footprint and height from any level 1..999), the caps and the two City models.
import { describe, expect, it } from 'vitest';
import { CITY_BANDS, LEVEL_SCALE_TOP, TALL_EXTRA, districtLevelScale, levelArcShare, levelBand, levelCode, levelHeight, levelScale, levelTall } from '../../src/render/cityTiers';
import { STRUCT_APPARENT_CAP_MUL, STRUCT_CLOSE_MUL } from '../../src/render/config';
import { closeMul, modelRadiusM } from '../../src/render/rings';
import { STRUCTURE_MODELS, cityLights } from '../../src/render/structureModels';
import { STRUCT_CITY } from '../../src/sim/public';

const city = () => STRUCTURE_MODELS[STRUCT_CITY] as NonNullable<(typeof STRUCTURE_MODELS)[number]>;

describe('the band function (Look-2: unlimited levels, saturating)', () => {
  it('level 1 is band 0, the edges 3, 8, 20, 50 start bands 1 to 4, and 999 is still band 4', () => {
    expect([1, 2, 3, 7, 8, 19, 20, 49, 50, 999].map((l) => levelBand(l))).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
    expect(levelBand(0)).toBe(0);
    expect(levelBand(5000)).toBe(CITY_BANDS - 1);
    expect(levelBand(Number.NaN)).toBe(0);
  });
  it('band, footprint, height and arc are monotone over every level 1..999; the footprint saturates at LEVEL_SCALE_TOP', () => {
    let band = -1;
    let sc = 0;
    let tall = -1;
    let arc = -1;
    for (let l = 1; l <= 999; l++) {
      expect(levelBand(l)).toBeGreaterThanOrEqual(band);
      expect(levelScale(l)).toBeGreaterThanOrEqual(sc);
      expect(levelTall(l)).toBeGreaterThanOrEqual(tall);
      expect(levelArcShare(l)).toBeGreaterThanOrEqual(arc);
      expect(levelCode(l)).toBeGreaterThanOrEqual(1);
      expect(Math.floor(levelCode(l))).toBe(levelBand(l) + 1); // the packed code never leaks into the next band
      band = levelBand(l);
      sc = levelScale(l);
      tall = levelTall(l);
      arc = levelArcShare(l);
    }
    expect(levelScale(1)).toBe(1);
    expect(levelScale(999)).toBeCloseTo(LEVEL_SCALE_TOP, 9);
    expect(levelScale(999)).toBeLessThanOrEqual(1.5);
    expect(levelScale(5000)).toBe(levelScale(999));
    expect(levelTall(50)).toBe(0);
    expect(levelHeight(999)).toBeCloseTo(1 + TALL_EXTRA, 9);
    expect(levelArcShare(50)).toBeCloseTo(1, 9);
    expect(levelArcShare(1)).toBe(0);
    // a gentle curve: half the growth is done by level 32 (log scale), not by level 500
    expect(levelScale(32)).toBeGreaterThan(1 + (LEVEL_SCALE_TOP - 1) * 0.45);
  });
  it('the district size is the Look-1 table up to level 3 and saturates at 1.5 beyond', () => {
    expect([1, 2, 3].map(districtLevelScale)).toEqual([1, 1.2, 1.4]);
    expect(districtLevelScale(999)).toBeCloseTo(1.5, 9);
    let prev = 0;
    for (let l = 1; l <= 999; l++) {
      expect(districtLevelScale(l)).toBeGreaterThanOrEqual(prev);
      prev = districtLevelScale(l);
    }
  });
});

describe('the hard cap of the apparent size (Look-2)', () => {
  const dists = [150, 800, 3000, 25000, 30000, 150000, 1e6, 1e7, 4e7 * 1000];
  it('a model of any type and level never shows a radius above the cap, at any distance from 150 m to 40 000 km', () => {
    for (const size of [700, 560, 520, 450]) {
      for (const level of [1, 10, 100, 999]) {
        for (const d of dists) expect(modelRadiusM(d, size, level)).toBeLessThanOrEqual(STRUCT_APPARENT_CAP_MUL * size + 1e-6);
      }
    }
    expect(STRUCT_APPARENT_CAP_MUL * 700).toBeLessThanOrEqual(25000);
  });
  it('up close a City is at most about 1.2 km, at 30 km at most 2.4 km (a town, not a province)', () => {
    for (const level of [1, 10, 100, 999]) {
      expect(modelRadiusM(800, 700, level)).toBeLessThanOrEqual(1200);
      expect(modelRadiusM(3000, 700, level)).toBeLessThanOrEqual(1200);
      expect(modelRadiusM(30000, 700, level)).toBeLessThanOrEqual(2400);
    }
  });
  it('two Cities 3 cells apart (39 km a cell at the equator, cos(lat) east-west) do not overlap at any distance up to 60 degrees latitude', () => {
    for (const latDeg of [0, 30, 45, 60]) {
      const spacingM = 3 * 39000 * Math.cos((latDeg * Math.PI) / 180);
      for (const d of dists) expect(2 * modelRadiusM(d, 700, 999)).toBeLessThan(spacingM);
    }
  });
  it('the radius is continuous in the distance (no jump where the caps meet)', () => {
    let prev = modelRadiusM(100, 700, 999);
    for (let d = 100; d < 1e8; d *= 1.01) {
      const v = modelRadiusM(d, 700, 999);
      expect(Math.abs(v - prev)).toBeLessThan(0.03 * Math.max(prev, 700));
      prev = v;
    }
  });
});

describe('the mid-range City enlargement', () => {
  it('is true size close up and far away, full between 25 and 40 km, continuous', () => {
    expect(closeMul(800)).toBe(1);
    expect(closeMul(3000)).toBe(1);
    expect(closeMul(30000)).toBeCloseTo(STRUCT_CLOSE_MUL, 6);
    expect(closeMul(150000)).toBe(1);
    expect(closeMul(3_000_000)).toBe(1);
    let prev = closeMul(100);
    for (let d = 100; d < 400000; d *= 1.01) {
      const v = closeMul(d);
      expect(Math.abs(v - prev)).toBeLessThan(0.03);
      prev = v;
    }
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
