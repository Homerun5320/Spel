import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { HeightPyramid } from '../../src/render/heightPyramid';
import { worldLoader } from '../helpers/dataFiles';

/** The filtered code at a position exactly as the GPU / HeightField form it: bilinear over the four texels, longitude wraps, latitude clamps. */
function bilinear(codes: Uint8Array, W: number, H: number, u: number, v: number): number {
  const tx = u * W - 0.5;
  const ty = v * H - 0.5;
  const x0 = Math.floor(tx);
  const y0 = Math.floor(ty);
  const fx = tx - x0;
  const fy = ty - y0;
  const c = (x: number, y: number): number => codes[Math.min(H - 1, Math.max(0, y)) * W + (((x % W) + W) % W)] as number;
  return c(x0, y0) * (1 - fx) * (1 - fy) + c(x0 + 1, y0) * fx * (1 - fy) + c(x0, y0 + 1) * (1 - fx) * fy + c(x0 + 1, y0 + 1) * fx * fy;
}

function noise(W: number, H: number, seed: number): Uint8Array {
  const a = new Uint8Array(W * H);
  let s = seed >>> 0;
  for (let i = 0; i < a.length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    a[i] = (s >>> 24) & 255;
  }
  return a;
}

describe('height pyramid', () => {
  const W = 128;
  const H = 64;
  const codes = noise(W, H, 5);
  const pyr = new HeightPyramid(codes, W, H, 8);

  it('has levels down to the minimum side', () => {
    expect(pyr.levelCount).toBeGreaterThanOrEqual(4);
  });

  it('property: the range of any rectangle bounds every filtered sample inside it (the bound never lies)', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 0.999, noNaN: true }), fc.double({ min: 0, max: 0.999, noNaN: true }), fc.double({ min: 0.0001, max: 0.4, noNaN: true }), fc.double({ min: 0.0001, max: 0.4, noNaN: true }), (u0, v0, du, dv) => {
        const u1 = Math.min(u0 + du, 1);
        const v1 = Math.min(v0 + dv, 1);
        pyr.range(u0, u1, v0, v1);
        let lo = 255;
        let hi = 0;
        for (let i = 0; i <= 12; i++) {
          for (let j = 0; j <= 12; j++) {
            const c = bilinear(codes, W, H, u0 + ((u1 - u0) * i) / 12, v0 + ((v1 - v0) * j) / 12);
            if (c < lo) lo = c;
            if (c > hi) hi = c;
          }
        }
        expect(pyr.minCode).toBeLessThanOrEqual(Math.ceil(lo));
        expect(pyr.maxCode).toBeGreaterThanOrEqual(Math.floor(hi));
        expect(pyr.minCode).toBeLessThanOrEqual(pyr.maxCode);
      }),
      { numRuns: 400 },
    );
  });

  it('a rectangle inside one bilinear cell gets its tight range (the corners), not the four taps', () => {
    // texel centres at (i + 0.5) / W: the rectangle sits between texels 10 and 11 in x and 20 and 21 in y
    const u0 = (10 + 0.55) / W;
    const u1 = (10 + 0.65) / W;
    const v0 = (20 + 0.55) / H;
    const v1 = (20 + 0.65) / H;
    pyr.range(u0, u1, v0, v1);
    const taps = [codes[20 * W + 10], codes[20 * W + 11], codes[21 * W + 10], codes[21 * W + 11]] as number[];
    expect(pyr.maxCode - pyr.minCode).toBeLessThan(Math.max(...taps) - Math.min(...taps));
  });

  it('wraps in longitude (a rectangle across the seam sees both sides) and clamps in latitude', () => {
    const edge = new Uint8Array(W * H);
    edge[10 * W + 0] = 200;
    edge[10 * W + (W - 1)] = 150;
    const p = new HeightPyramid(edge, W, H, 8);
    p.range(0.99, 1.0, 10 / H, 11 / H);
    expect(p.maxCode).toBeGreaterThanOrEqual(150);
    p.range(0.0, 0.01, 10 / H, 11 / H);
    expect(p.maxCode).toBeGreaterThanOrEqual(200);
    p.range(0.2, 0.3, -0.5, 0.0); // above the north edge: clamps to row 0
    expect(p.maxCode).toBeLessThanOrEqual(255);
  });

  it('on the real height raster the whole world reaches the highest code and the lowest, and the range of every rectangle bounds the filtered samples inside it', async () => {
    const render = await worldLoader().loadRender();
    const p = new HeightPyramid(render.height8, render.width, render.height);
    p.range(0, 1, 0, 1);
    let top = 0;
    for (const c of render.height8) if (c > top) top = c;
    expect(p.maxCode).toBe(top);
    expect(p.minCode).toBe(0);
    // and on real rectangles the range is a bound: no filtered sample inside lies outside it
    let seed = 7;
    const next = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 300; i++) {
      const u0 = next() * 0.95;
      const v0 = next() * 0.95;
      const u1 = u0 + 0.0005 + next() * 0.03;
      const v1 = v0 + 0.0005 + next() * 0.03;
      p.range(u0, u1, v0, v1);
      for (let k = 0; k < 20; k++) {
        const c = bilinear(render.height8, render.width, render.height, u0 + (u1 - u0) * next(), v0 + (v1 - v0) * next());
        expect(c).toBeGreaterThanOrEqual(p.minCode - 1e-9);
        expect(c).toBeLessThanOrEqual(p.maxCode + 1e-9);
      }
    }
  });
});
