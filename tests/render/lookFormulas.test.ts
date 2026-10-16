// Fix-3B (mutation audit 11): pure Look-1 / Polish-1 formulas that no test pinned: the model radius against closeMul at 5, 30 and 200 km, the selection
// ring's lift on lopsided terrain (sign, cos(lat), the pole clamp), and the City style cycle.
import { describe, expect, it } from 'vitest';
import { otherCityStyle } from '../../src/app/cityStyle';
import { STRUCT_APPARENT_CAP_MUL, STRUCT_CLOSE_MUL, STRUCT_MAX_SCALE, STRUCT_SCREEN_FRAC } from '../../src/render/config';
import { closeMul, modelRadiusM, selectRingLiftsM } from '../../src/render/rings';

const CITY_M = 700;

describe('modelRadiusM follows closeMul in the mid range', () => {
  it('5 km: true size; 30 km: the full mid-range enlargement; 200 km: the scale policy has taken over', () => {
    expect(closeMul(5000)).toBeCloseTo(1, 9);
    expect(modelRadiusM(5000, CITY_M, 1)).toBeCloseTo(CITY_M, 6);
    expect(closeMul(30_000)).toBeCloseTo(STRUCT_CLOSE_MUL, 9);
    expect(modelRadiusM(30_000, CITY_M, 1)).toBeCloseTo(STRUCT_CLOSE_MUL * CITY_M, 6); // without closeMul the policy alone would give 1 x here
    const policy = Math.min(STRUCT_MAX_SCALE, (200_000 * STRUCT_SCREEN_FRAC) / CITY_M);
    expect(modelRadiusM(200_000, CITY_M, 1)).toBeCloseTo(policy * CITY_M, 6);
    expect(modelRadiusM(200_000, CITY_M, 1)).toBeLessThanOrEqual(STRUCT_APPARENT_CAP_MUL * CITY_M);
  });

  it('a level scale never lifts the radius above the hard cap', () => {
    expect(modelRadiusM(30_000, CITY_M, 999)).toBeLessThanOrEqual(STRUCT_APPARENT_CAP_MUL * CITY_M + 1e-6);
  });
});

describe('selectRingLiftsM on lopsided terrain', () => {
  const R = 6_371_000;
  const SEG = 8;
  // the ground rises 100 m per degree northwards and 50 m per degree eastwards of the origin
  const ground = (lat0: number, lon0: number) => (lat: number, lon: number): number => 100 * (lat - lat0) + 50 * (lon - lon0);
  const deg = 180 / Math.PI;

  it('is positive on the uphill side (east, north), negative on the downhill side, and scaled by the exaggeration and by cos(lat)', () => {
    const lat = 60;
    const lon = 10;
    const r = 20_000;
    const out = new Float32Array(SEG + 1);
    selectRingLiftsM(lat, lon, r, SEG, 3, R, ground(lat, lon), out);
    const dLat = (r / R) * deg;
    const dLon = (r / (R * Math.cos((lat * Math.PI) / 180))) * deg; // a degree of longitude is shorter at 60 degrees
    expect(out[0]).toBeCloseTo(3 * 50 * dLon, 3); // east
    expect(out[SEG / 4]).toBeCloseTo(3 * 100 * dLat, 3); // north
    expect(out[SEG / 2]).toBeCloseTo(-3 * 50 * dLon, 3); // west
    expect(out[(3 * SEG) / 4]).toBeCloseTo(-3 * 100 * dLat, 3); // south
    expect(out[SEG]).toBeCloseTo(out[0] as number, 5); // the loop closes
  });

  it('clamps the sampled latitude at 89.9 degrees and the longitude factor at cos = 0.05 near the pole', () => {
    const lat = 89.95;
    const lon = 0;
    const r = 20_000;
    const out = new Float32Array(SEG + 1);
    selectRingLiftsM(lat, lon, r, SEG, 1, R, ground(lat, lon), out);
    expect(out[SEG / 4]).toBeCloseTo(100 * (89.9 - lat), 3); // north is cut at 89.9: the ground there is below the centre's
    const dLonPole = (r / (R * 0.05)) * deg; // cos(89.95 deg) = 0.0009 is held at 0.05
    expect(out[0]).toBeCloseTo(50 * dLonPole + 100 * (89.9 - lat), 2); // every vertex is sampled at the clamped latitude, so even the east one is 0.05 degrees lower
  });
});

describe('the City style button cycles', () => {
  it('old -> new -> old', () => {
    expect(otherCityStyle('old')).toBe('new');
    expect(otherCityStyle('new')).toBe('old');
    expect(otherCityStyle(otherCityStyle('old'))).toBe('old');
  });
});
