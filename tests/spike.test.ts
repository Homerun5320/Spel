import { describe, expect, it } from 'vitest';
import { fitFovDeg, makeNoiseData, makePrng, sunDirection, CAMERA_DISTANCE, NOISE_HEIGHT, NOISE_WIDTH } from '../src/render/spike';
import { parseParams } from '../src/app/params';

describe('spike maths', () => {
  it('fixed test sun (lon -40, lat 20) is (-0.604, 0.342, 0.720) and unit length', () => {
    const [x, y, z] = sunDirection(-40, 20);
    // The milestone prompt printed x as -0.49, which is not unit length; the formula gives -0.604 (see DECISIONS.md).
    expect(x).toBeCloseTo(-0.604, 3);
    expect(x).toBeCloseTo(Math.cos((20 * Math.PI) / 180) * Math.sin((-40 * Math.PI) / 180), 12);
    expect(y).toBeCloseTo(0.342, 3);
    expect(z).toBeCloseTo(0.72, 2);
    expect(x * x + y * y + z * z).toBeCloseTo(1, 12);
    // Sun on the left half of the image: negative x, camera on +z sees positive z.
    expect(x).toBeLessThan(0);
    expect(z).toBeGreaterThan(0);
  });

  it('fov makes the globe diameter equal the image height', () => {
    const fov = (fitFovDeg() * Math.PI) / 180;
    // Tangent half-angle of a unit sphere at distance d is asin(1/d).
    expect(Math.sin(fov / 2)).toBeCloseTo(1 / CAMERA_DISTANCE, 12);
  });
});

describe('seeded noise texture data', () => {
  it('is deterministic per seed and differs between seeds', () => {
    const a = makeNoiseData(1);
    const b = makeNoiseData(1);
    const c = makeNoiseData(2);
    expect(a.length).toBe(NOISE_WIDTH * NOISE_HEIGHT * 4);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    expect(Buffer.from(a).equals(Buffer.from(c))).toBe(false);
  });
  it('uses the full 0..255 range', () => {
    const a = makeNoiseData(1);
    let lo = 255;
    let hi = 0;
    for (let i = 0; i < a.length; i += 4) {
      lo = Math.min(lo, a[i] as number);
      hi = Math.max(hi, a[i] as number);
    }
    expect(lo).toBe(0);
    expect(hi).toBe(255);
  });
  it('prng is stable', () => {
    const r = makePrng(1);
    const first = [r(), r(), r()];
    const r2 = makePrng(1);
    expect([r2(), r2(), r2()]).toEqual(first);
    for (const v of first) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('url params', () => {
  it('defaults', () => {
    expect(parseParams('')).toEqual({ test: false, blank: false, seed: 1, width: 960, height: 540 });
  });
  it('test mode, blank, size and seed', () => {
    expect(parseParams('?test=1&blank=1&w=320&h=180&seed=7')).toEqual({ test: true, blank: true, seed: 7, width: 320, height: 180 });
  });
  it('rejects junk values', () => {
    expect(parseParams('?test=2&w=abc&h=99999&seed=x')).toEqual({ test: false, blank: false, seed: 1, width: 960, height: 540 });
  });
});
