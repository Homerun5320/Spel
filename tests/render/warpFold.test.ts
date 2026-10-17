// The territory's domain warp (src/render/shaders/territory.ts) moves the cell lookup so that borders wiggle. A warp whose slope is above 1
// somewhere FOLDS the map there: the lookup position runs backwards, and a border grows islands and slivers (dark blobs on the border line).
// This is a float64 mirror of the GLSL noise (the same integer hash, the same octaves) that measures the Jacobian determinant of
// p -> p + warp(p) over many positions with every fine octave at full weight (the closest view); it must stay positive everywhere.
import { describe, expect, it } from 'vitest';
import { OWNER_WARP_AMP, OWNER_WARP_FINE_AMP, OWNER_WARP_FINE_PERSIST } from '../../src/render/config';

const imul = Math.imul;
function hash2(ix: number, iy: number, periodX: number): [number, number] {
  let h = (imul(ix & (periodX - 1), 0x27d4eb2f) + imul(iy, 0x165667b1)) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = imul(h, 0x85ebca6b) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = imul(h, 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return [(h & 0xffff) / 65535, (h >>> 16) / 65535];
}
function noise2(x: number, y: number, periodX: number): [number, number] {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let fx = x - ix;
  let fy = y - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, periodX);
  const b = hash2(ix + 1, iy, periodX);
  const c = hash2(ix, iy + 1, periodX);
  const d = hash2(ix + 1, iy + 1, periodX);
  const out: [number, number] = [0, 0];
  for (let k = 0; k < 2; k++) {
    const top = a[k]! + (b[k]! - a[k]!) * fx;
    const bottom = c[k]! + (d[k]! - c[k]!) * fx;
    out[k] = top + (bottom - top) * fy;
  }
  return out;
}
function noise1(x: number, y: number, periodX: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let fx = x - ix;
  let fy = y - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const h = (i: number, j: number): number => hash2(i, j, periodX)[0] ;
  const top = h(ix, iy) + (h(ix + 1, iy) - h(ix, iy)) * fx;
  const bottom = h(ix, iy + 1) + (h(ix + 1, iy + 1) - h(ix, iy + 1)) * fx;
  return top + (bottom - top) * fy;
}

/** The whole warp displacement in cells at p, every fine octave at full weight. (The one-value noise of the coarse octaves uses the first half of the same hash in the GLSL: `ownerHash`.) */
function warp(px: number, py: number, octaves = 6): [number, number] {
  const q1x = px * 0.25;
  const q1y = py * 0.25;
  const q2x = px * 0.5;
  const q2y = py * 0.5;
  const w1x = noise1(q1x, q1y, 256) - 0.5;
  const w1y = noise1(q1x, q1y + 137, 256) - 0.5;
  const w2x = noise1(q2x, q2y + 59, 512) - 0.5;
  const w2y = noise1(q2x, q2y + 211, 512) - 0.5;
  let wx = OWNER_WARP_AMP * (w1x * 1.2 + w2x * 0.55);
  let wy = OWNER_WARP_AMP * (w1y * 1.2 + w2y * 0.55);
  let amp = OWNER_WARP_AMP * OWNER_WARP_FINE_AMP;
  for (let k = 0; k < octaves; k++) {
    const s = 2 ** k;
    const n = noise2(px * s, py * s + 53 * k, 1024 * s);
    wx += (n[0] - 0.5) * amp;
    wy += (n[1] - 0.5) * amp;
    amp *= OWNER_WARP_FINE_PERSIST;
  }
  return [wx, wy];
}

describe('the territory warp does not fold the map', () => {
  it('p -> p + warp(p) has a positive Jacobian determinant (at least 0.1) at 60 000 positions with all six fine octaves on', () => {
    let worst = Infinity;
    let lcg = 99;
    const rnd = (): number => {
      lcg = (Math.imul(lcg, 1664525) + 1013904223) >>> 0;
      return lcg / 4294967296;
    };
    for (let i = 0; i < 60_000; i++) {
      const x = 1024 * rnd();
      const y = 512 * rnd();
      const h = 1e-5;
      const a = warp(x + h, y);
      const b = warp(x - h, y);
      const c = warp(x, y + h);
      const d = warp(x, y - h);
      const dxx = (a[0] - b[0]) / (2 * h);
      const dxy = (a[1] - b[1]) / (2 * h);
      const dyx = (c[0] - d[0]) / (2 * h);
      const dyy = (c[1] - d[1]) / (2 * h);
      const det = (1 + dxx) * (1 + dyy) - dxy * dyx;
      worst = Math.min(worst, det);
    }
    console.log(`[warp] smallest Jacobian determinant over 60 000 positions: ${worst.toFixed(3)}`);
    expect(worst).toBeGreaterThan(0.1);
  });

  it('the mirror is not trivial: the warp moves a lookup by up to a cell and its fine octaves matter', () => {
    let maxAll = 0;
    let maxFine = 0;
    for (let i = 0; i < 2000; i++) {
      const x = 5 + 0.37 * i;
      const y = 100 + 0.11 * i;
      const full = warp(x, y);
      const coarse = warp(x, y, 0);
      maxAll = Math.max(maxAll, Math.abs(full[0]), Math.abs(full[1]));
      maxFine = Math.max(maxFine, Math.abs(full[0] - coarse[0]), Math.abs(full[1] - coarse[1]));
    }
    expect(maxAll).toBeGreaterThan(0.2);
    expect(maxAll).toBeLessThan(1);
    expect(maxFine).toBeGreaterThan(0.02);
  });
});
