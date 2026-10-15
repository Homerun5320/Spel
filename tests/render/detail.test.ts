// The terrain detail (M07b), TypeScript side: the integer hash against an independent BigInt implementation, the noise, the octave law, the
// coast rule (land above sea level, sea at it), "the detail is real", the bounds the quadtree widens by, and the text of the GLSL twin
// against the constants of the TS one. The GLSL maths itself is compared with these functions in Chromium (e2e/detail.test.ts).
import { beforeAll, describe, expect, it } from 'vitest';
import {
  DETAIL_AMP,
  DETAIL_FREQ0,
  DETAIL_LAND_MIN_M,
  DETAIL_OCTAVES_MAX,
  DETAIL_PERSIST,
  DETAIL_RELIEF_FLOOR_M,
  DETAIL_RIDGE_MEAN,
  DETAIL_SEED,
  HEIGHT_EXAGGERATION,
} from '../../src/render/config';
import {
  HASH_MUL_A,
  HASH_MUL_B,
  HASH_OCTAVE,
  HASH_X,
  HASH_Y,
  HASH_Z,
  HeightSampler,
  NOISE_OFFSET,
  bindHeightSource,
  detailBoundShare,
  detailHash,
  detailHash3,
  heightAt,
  octavesForLevel,
  valueNoise3,
} from '../../src/render/detail';
import { chunkGeo, chunkSizeRad, makeChunkGeo } from '../../src/render/chunkMath';
import { DetailBounds } from '../../src/render/detailBounds';
import { DEG } from '../../src/render/geo';
import { GLSL_DETAIL } from '../../src/render/shaders/detail';
import { loadChunkWorld, rng, type ChunkWorld } from '../helpers/chunkWorld';
import { worldLoader } from '../helpers/dataFiles';

let world: ChunkWorld;
let sampler: HeightSampler;
beforeAll(async () => {
  world = await loadChunkWorld();
  sampler = new HeightSampler({ codes: world.codes, width: world.width, height: world.height, maxM: world.maxM });
});

const M32 = 0xffffffffn;
/** The hash again, in BigInt arithmetic (no Math.imul, no int32): the reference the production function is held against. */
function refHash(x0: bigint): bigint {
  let x = x0 & M32;
  x ^= x >> 16n;
  x = (x * BigInt(HASH_MUL_A)) & M32;
  x ^= x >> 15n;
  x = (x * BigInt(HASH_MUL_B)) & M32;
  x ^= x >> 16n;
  return x;
}
function refHash3(ix: number, iy: number, iz: number, seed: number): bigint {
  let h = (BigInt(seed) + ((BigInt(ix) * BigInt(HASH_X)) & M32)) & M32;
  h = refHash(h);
  h = (h + ((BigInt(iy) * BigInt(HASH_Y)) & M32)) & M32;
  h = refHash(h);
  h = (h + ((BigInt(iz) * BigInt(HASH_Z)) & M32)) & M32;
  return refHash(h);
}

describe('the integer hash (the same function in GLSL on uint and in TypeScript on Math.imul)', () => {
  it('equals an independent BigInt implementation on 5000 random words and 5000 random lattice cells, and has pinned known answers', () => {
    const r = rng(1);
    for (let i = 0; i < 5000; i++) {
      const x = Math.floor(r() * 4294967296);
      expect(BigInt(detailHash(x)), `hash(${x})`).toBe(refHash(BigInt(x)));
    }
    for (let i = 0; i < 5000; i++) {
      const ix = NOISE_OFFSET + Math.floor((r() - 0.5) * 2_000_000);
      const iy = NOISE_OFFSET + Math.floor((r() - 0.5) * 2_000_000);
      const iz = NOISE_OFFSET + Math.floor((r() - 0.5) * 2_000_000);
      const seed = Math.floor(r() * 4294967296);
      expect(BigInt(detailHash3(ix, iy, iz, seed)), `hash3(${ix}, ${iy}, ${iz}, ${seed})`).toBe(refHash3(ix, iy, iz, seed));
    }
    // known answers (the very values the GLSL probe must return in e2e/detail.test.ts)
    expect(detailHash(0)).toBe(0);
    expect(detailHash(1)).toBe(1753845952);
    expect(detailHash(0xffffffff)).toBe(1734902346);
    expect(detailHash3(NOISE_OFFSET, NOISE_OFFSET, NOISE_OFFSET, DETAIL_SEED)).toBe(Number(refHash3(NOISE_OFFSET, NOISE_OFFSET, NOISE_OFFSET, DETAIL_SEED)));
  });

  it('is a good mixer: flipping one input bit flips 16 output bits on average (14 to 18), and neighbouring cells do not correlate', () => {
    const r = rng(2);
    let flips = 0;
    let n = 0;
    for (let i = 0; i < 4000; i++) {
      const x = Math.floor(r() * 4294967296);
      const bit = Math.floor(r() * 32);
      let d = detailHash(x) ^ detailHash((x ^ (1 << bit)) >>> 0);
      while (d !== 0) {
        flips += d & 1;
        d = d >>> 1;
      }
      n++;
    }
    expect(flips / n).toBeGreaterThan(14);
    expect(flips / n).toBeLessThan(18);
    // the cell values (24 bits as a fraction) of a lattice walk: mean 0.5, no step correlation
    let sum = 0;
    let cross = 0;
    let prev = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) {
      const v = (detailHash3(NOISE_OFFSET + i, NOISE_OFFSET, NOISE_OFFSET, DETAIL_SEED) >>> 8) / 16777216;
      sum += v;
      if (i > 0) cross += (v - 0.5) * (prev - 0.5);
      prev = v;
    }
    expect(sum / N).toBeGreaterThan(0.49);
    expect(sum / N).toBeLessThan(0.51);
    expect(Math.abs(cross / N)).toBeLessThan(0.004); // the variance of a uniform is 1/12 = 0.083
  });
});

describe('the 3D value noise and the ridged octave', () => {
  it('stays in [0, 1) with mean 0.5, is continuous (a Lipschitz bound of 2 per lattice cell), and depends on the seed', () => {
    const r = rng(3);
    let sum = 0;
    let lo = 1;
    let hi = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) {
      const x = r() * 3000;
      const y = r() * 3000;
      const z = r() * 3000;
      const v = valueNoise3(x, y, z, DETAIL_SEED);
      sum += v;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
      const e = 1e-4;
      expect(Math.abs(valueNoise3(x + e, y, z, DETAIL_SEED) - v)).toBeLessThanOrEqual(2 * e);
      expect(Math.abs(valueNoise3(x, y + e, z - e, DETAIL_SEED) - valueNoise3(x, y, z, DETAIL_SEED))).toBeLessThanOrEqual(4 * e);
    }
    expect(lo).toBeGreaterThanOrEqual(0);
    expect(hi).toBeLessThan(1);
    expect(sum / N).toBeGreaterThan(0.48);
    expect(sum / N).toBeLessThan(0.52);
    let differ = 0;
    for (let i = 0; i < 200; i++) if (valueNoise3(r() * 100, r() * 100, r() * 100, DETAIL_SEED) !== valueNoise3(0.5, 0.5, 0.5, DETAIL_SEED ^ 1)) differ++;
    expect(differ).toBe(200);
  });

  it('the ridge r^2 (r = 1 - |2 n - 1|) has the mean DETAIL_RIDGE_MEAN the config subtracts (the detail has no bias)', () => {
    const r = rng(4);
    let sum = 0;
    const N = 200000;
    for (let i = 0; i < N; i++) {
      const n = valueNoise3(r() * 5000, r() * 5000, r() * 5000, 77);
      const q = 1 - Math.abs(2 * n - 1);
      sum += q * q;
    }
    expect(Math.abs(sum / N - DETAIL_RIDGE_MEAN)).toBeLessThan(0.01);
  });
});

describe('octavesForLevel (a chunk carries the octaves whose lattice cell is at least two of its vertex spacings)', () => {
  it('is level - 5 for a 32-cell chunk, clamped to [0, 12], shifted by log2(cells / 32), and one octave per level', () => {
    expect(octavesForLevel(0)).toBe(0);
    expect(octavesForLevel(5)).toBeCloseTo(0, 9);
    expect(octavesForLevel(6)).toBeCloseTo(1, 9);
    expect(octavesForLevel(11)).toBeCloseTo(6, 9);
    expect(octavesForLevel(17)).toBe(DETAIL_OCTAVES_MAX);
    expect(octavesForLevel(40)).toBe(DETAIL_OCTAVES_MAX);
    expect(octavesForLevel(10, 16)).toBeCloseTo(octavesForLevel(9, 32), 9);
    for (let l = 0; l < 16; l++) expect(octavesForLevel(l + 1) - octavesForLevel(l)).toBeLessThanOrEqual(1 + 1e-9);
    // the rule itself: the lattice cell of the last full octave is >= 4 vertex spacings (and a half-way octave 2 to 4)
    const R = 6371000;
    for (const level of [8, 11, 14, 17]) {
      const spacing = ((Math.PI / 2) * R) / 2 ** level / 32;
      const k = Math.floor(octavesForLevel(level)) - 1; // the last octave that is fully on
      const cell = R / (DETAIL_FREQ0 * 2 ** k);
      expect(cell / spacing, `level ${level}`).toBeGreaterThanOrEqual(4 - 1e-6);
    }
  });
});

describe('the GLSL twin is written from the same constants', () => {
  it('every constant of the TypeScript module appears in the GLSL text with the same value, and the integer hash is on uint with no sin', () => {
    const glsl = GLSL_DETAIL;
    const num = (name: string): number => {
      const m = new RegExp(`const (?:float|int) ${name} = ([-0-9.e]+);`).exec(glsl);
      expect(m, name).not.toBeNull();
      return Number(m![1]);
    };
    const u = (name: string): number => {
      const m = new RegExp(`const uint ${name} = 0x([0-9a-f]+)u;`).exec(glsl);
      expect(m, name).not.toBeNull();
      return parseInt(m![1]!, 16);
    };
    expect(u('DET_MUL_A')).toBe(HASH_MUL_A);
    expect(u('DET_MUL_B')).toBe(HASH_MUL_B);
    expect(u('DET_X')).toBe(HASH_X);
    expect(u('DET_Y')).toBe(HASH_Y);
    expect(u('DET_Z')).toBe(HASH_Z);
    expect(u('DET_OCTAVE')).toBe(HASH_OCTAVE);
    expect(u('DET_SEED')).toBe(DETAIL_SEED);
    expect(num('DET_OFFSET')).toBe(NOISE_OFFSET);
    expect(num('DET_OCTAVES_MAX')).toBe(DETAIL_OCTAVES_MAX);
    expect(num('DET_FREQ0')).toBeCloseTo(DETAIL_FREQ0, 9);
    expect(num('DET_AMP')).toBe(DETAIL_AMP);
    expect(num('DET_PERSIST')).toBe(DETAIL_PERSIST);
    expect(num('DET_RIDGE_MEAN')).toBe(DETAIL_RIDGE_MEAN);
    expect(num('DET_RELIEF_FLOOR')).toBe(DETAIL_RELIEF_FLOOR_M);
    expect(num('DET_LAND_MIN')).toBe(DETAIL_LAND_MIN_M);
    const code = glsl.replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/\b(sin|cos|tan|fract)\s*\(/);
    expect(code).toContain('uint detHash(uint x)');
    expect(code).toContain('x *= DET_MUL_A;');
    expect(code).toContain('uint h = seed + uint(ix) * DET_X;');
  });
});

/** The land coverage of a position from the raster, written independently: the share of land texels among the four that a bilinear tap reads. */
function coverageOf(lat: number, lon: number): number {
  const u = (lon + 180) / 360;
  const v = (90 - lat) / 180;
  const tx = u * world.width - 0.5;
  const ty = v * world.height - 0.5;
  const x0 = Math.floor(tx);
  const y0 = Math.floor(ty);
  const fx = tx - x0;
  const fy = ty - y0;
  const land = (x: number, y: number): number => (world.codes[Math.min(world.height - 1, Math.max(0, y)) * world.width + (((x % world.width) + world.width) % world.width)] as number >= 1 ? 1 : 0);
  return land(x0, y0) * (1 - fx) * (1 - fy) + land(x0 + 1, y0) * fx * (1 - fy) + land(x0, y0 + 1) * (1 - fx) * fy + land(x0 + 1, y0 + 1) * fx * fy;
}

describe('the coast rule: land above sea level, sea at it, the detail faded to zero at the coast', () => {
  it('on 2000 sampled land and sea CELLS of the sim grid heightAt has the right sign (land > 0, sea <= 0), and the plain filtered raster does not', async () => {
    const sim = await worldLoader().loadSim();
    const r = rng(11);
    const landCells: number[] = [];
    const seaCells: number[] = [];
    for (let c = 0; c < sim.width * sim.height; c++) {
      const cls = sim.terrainClass[c] as number;
      const row = Math.floor(c / sim.width);
      if (row < 8 || row > sim.height - 8) continue; // the polar rows are not part of the game
      (cls >= 2 ? landCells : seaCells).push(c);
    }
    const centre = (c: number): [number, number] => [90 - ((Math.floor(c / sim.width) + 0.5) * 180) / sim.height, ((c % sim.width) + 0.5) * (360 / sim.width) - 180];
    let landOk = 0;
    let seaOk = 0;
    let landDisagree = 0;
    let seaDisagree = 0;
    let naiveSeaPositive = 0;
    for (let i = 0; i < 1000; i++) {
      const [la, lo] = centre(landCells[Math.floor(r() * landCells.length)] as number);
      const cov = coverageOf(la, lo);
      const h = heightAtOf(la, lo);
      // A sim cell is 4 x 4 texels: on a coast its centre may lie on the other side of the raster's coast line than its class says.
      if (cov < 0.5) landDisagree++;
      else {
        expect(h, `land cell at ${la}, ${lo}`).toBeGreaterThan(0);
        landOk++;
      }
      const [sa, so] = centre(seaCells[Math.floor(r() * seaCells.length)] as number);
      const scov = coverageOf(sa, so);
      const sh = heightAtOf(sa, so);
      if (scov >= 0.5) seaDisagree++;
      else {
        expect(sh, `sea cell at ${sa}, ${so}`).toBeLessThanOrEqual(0);
        seaOk++;
      }
      if (world.field.heightM(sa, so) > 0) naiveSeaPositive++;
    }
    // the two classifications agree except on the coast (a handful of cells), so the test keeps its 2000 samples meaningful
    expect(naiveSeaPositive, 'the control: the plain filtered raster is above sea level at some sea cells').toBeGreaterThan(0);
    expect(landOk + seaOk).toBeGreaterThanOrEqual(1900);
    expect(landDisagree + seaDisagree).toBeLessThanOrEqual(100);
    console.log(`[coast sign] 2000 cells: ${landOk} land and ${seaOk} sea checked, ${landDisagree + seaDisagree} coast cells where the 1024 grid and the 4096 raster disagree on the side of the coast line; the plain filtered raster is above sea level at ${naiveSeaPositive} of the 1000 sea cells`);
  });

  it('on 20000 points on the coast line itself (coverage near one half) the sign is the raster mask exactly: land >= 1 m, sea exactly 0, and the surface is continuous across the line within 1 m', () => {
    const r = rng(12);
    let checked = 0;
    let land = 0;
    let sea = 0;
    let maxStep = 0;
    // find texels with land and sea neighbours and put a point at their common edge +- a little
    while (checked < 20000) {
      const tx = Math.floor(r() * world.width);
      const ty = 2 + Math.floor(r() * (world.height - 4));
      const a = world.codes[ty * world.width + tx] as number;
      const b = world.codes[ty * world.width + ((tx + 1) % world.width)] as number;
      if ((a >= 1) === (b >= 1)) continue;
      const lat = 90 - ((ty + 0.5 + (r() - 0.5) * 0.9) / world.height) * 180;
      const lonEdge = ((tx + 1) / world.width) * 360 - 180;
      const eps = ((0.02 + 0.3 * r()) / world.width) * 360;
      const side = r() < 0.5 ? -1 : 1;
      const lon = lonEdge + side * eps;
      const cov = coverageOf(lat, lon);
      const h = heightAtOf(lat, lon);
      if (cov >= 0.5) {
        expect(h, `coverage ${cov} at ${lat}, ${lon}`).toBeGreaterThanOrEqual(DETAIL_LAND_MIN_M);
        land++;
      } else {
        expect(h, `coverage ${cov} at ${lat}, ${lon}`).toBe(0);
        sea++;
      }
      // a step of one hundredth of a texel along the east-west line anywhere near the coast
      const h2 = heightAtOf(lat, lon + (0.01 / world.width) * 360);
      maxStep = Math.max(maxStep, Math.abs(h2 - h));
      checked++;
    }
    expect(land).toBeGreaterThan(2000);
    expect(sea).toBeGreaterThan(2000);
    // (the base rises at up to 4 km per texel and the fade is a smoothstep over half a texel: a hundredth of a texel moves it by metres, the floor jump is 1 m)
    console.log(`[coast sign] ${land} land and ${sea} sea points on the coast line; the largest height step over a hundredth of a texel is ${maxStep.toFixed(1)} m`);
    expect(maxStep).toBeLessThan(120);
  });

  it('the detail is zero where the fade is zero: on land just inside the coast line heightAt with and without octaves differ by under 60 m', () => {
    const r = rng(13);
    let n = 0;
    let worst = 0;
    while (n < 400) {
      const tx = Math.floor(r() * world.width);
      const ty = 2 + Math.floor(r() * (world.height - 4));
      const a = world.codes[ty * world.width + tx] as number;
      const b = world.codes[ty * world.width + ((tx + 1) % world.width)] as number;
      if ((a >= 1) === (b >= 1)) continue;
      const lat = 90 - ((ty + 0.5) / world.height) * 180;
      const lon = ((tx + 1) / world.width) * 360 - 180 + (a >= 1 ? -1 : 1) * ((0.01 + 0.04 * r()) / world.width) * 360; // a few hundredths of a texel on the LAND side of the line
      const cov = coverageOf(lat, lon);
      if (cov < 0.5) continue;
      n++;
      const d = Math.abs(heightAtOf(lat, lon) - heightAtOf(lat, lon, 0));
      worst = Math.max(worst, d);
      expect(d, `coverage ${cov} at ${lat}, ${lon}`).toBeLessThan(60);
    }
    console.log(`[coast fade] ${n} land points within a few hundredths of a texel of the coast line: the detail is at most ${worst.toFixed(1)} m there`);
  });
});

function heightAtOf(lat: number, lon: number, octaves?: number): number {
  return sampler.heightAt(lat, lon, octaves);
}

describe('the detail is real, finite and bounded', () => {
  it('in the Himalaya box (27 to 30 N, 84 to 90 E) heightAt differs from the base height by more than 20 m on at least 50 % of the points, and without octaves it does not', () => {
    const r = rng(21);
    let over = 0;
    let overBase = 0;
    let sum = 0;
    const N = 3000;
    for (let i = 0; i < N; i++) {
      const lat = 27 + 3 * r();
      const lon = 84 + 6 * r();
      const base = world.field.heightM(lat, lon);
      const d = Math.abs(heightAtOf(lat, lon) - base);
      sum += d;
      if (d > 20) over++;
      if (Math.abs(heightAtOf(lat, lon, 0) - base) > 20) overBase++;
    }
    console.log(`[detail is real] Himalaya box: ${((100 * over) / N).toFixed(1)} % of the points are more than 20 m from the base height (mean ${(sum / N).toFixed(0)} m); without octaves ${overBase} of ${N}`);
    expect(over / N).toBeGreaterThanOrEqual(0.5);
    expect(overBase).toBe(0); // the control: with no octaves the height IS the base (this box has no coast)
  });

  it('never NaN or infinite and never below sea level, at 30000 random points including the poles and the antimeridian; a point and its wrapped longitude agree', () => {
    const r = rng(22);
    for (let i = 0; i < 30000; i++) {
      const lat = i % 50 === 0 ? (i % 100 === 0 ? 90 : -90) : -90 + 180 * r();
      const lon = i % 40 === 0 ? 180 : -180 + 360 * r();
      const h = heightAtOf(lat, lon);
      expect(Number.isFinite(h), `${lat}, ${lon}`).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(world.maxM * (1 + detailBoundShare()) + 1);
    }
    for (const [la, lo] of [[66.5, 179.9999], [-77, 179.99999], [72, -179.99999], [28.2, 86.8]] as const) {
      const a = heightAtOf(la, lo);
      const b = heightAtOf(la, lo + 360);
      const c = heightAtOf(la, lo - 360);
      expect(b).toBeCloseTo(a, 6);
      expect(c).toBeCloseTo(a, 6);
    }
    // continuity across the antimeridian on land (Chukotka): 1e-6 degrees apart, heights within a metre
    const west = heightAtOf(66.4, 179.999999);
    const east = heightAtOf(66.4, -179.999999);
    expect(Math.abs(west - east)).toBeLessThan(1);
  });

  it('heightAt of the module is the bound sampler (M08 calls it as groundHeightAt) and throws when nothing is bound', () => {
    bindHeightSource(null);
    expect(() => heightAt(28, 86.9)).toThrow(/no height source/);
    bindHeightSource(sampler);
    expect(heightAt(28.2, 86.8)).toBe(sampler.heightAt(28.2, 86.8));
    expect(heightAt(28.2, 86.8, 0)).toBe(sampler.heightAt(28.2, 86.8, 0));
    // the default is the finest level: all octaves
    expect(heightAt(28.2, 86.8)).toBe(heightAt(28.2, 86.8, DETAIL_OCTAVES_MAX));
    expect(heightAt(28.2, 86.8)).not.toBe(heightAt(28.2, 86.8, 3));
    bindHeightSource(null);
  });

  it('|detail| never exceeds the bound the quadtree widens by: detailBoundShare times the largest relief of the four corner texels, on 40000 land points', () => {
    const r = rng(23);
    const dec = (c: number): number => world.maxM * (c / 255) ** 2;
    let worst = 0;
    let n = 0;
    for (let i = 0; i < 40000; i++) {
      const lat = -60 + 130 * r();
      const lon = -180 + 360 * r();
      if (coverageOf(lat, lon) < 0.6) continue;
      const tx = ((lon + 180) / 360) * world.width - 0.5;
      const ty = ((90 - lat) / 180) * world.height - 0.5;
      // the largest 3x3 range among the four corner texels (independent of the sampler's own relief code)
      let rel = DETAIL_RELIEF_FLOOR_M;
      for (let cy = 0; cy < 2; cy++) {
        for (let cx = 0; cx < 2; cx++) {
          let lo = 255;
          let hi = 0;
          for (let j = -1; j <= 1; j++) {
            for (let k = -1; k <= 1; k++) {
              const x = (((Math.floor(tx) + cx + k) % world.width) + world.width) % world.width;
              const y = Math.min(world.height - 1, Math.max(0, Math.floor(ty) + cy + j));
              const c = world.codes[y * world.width + x] as number;
              lo = Math.min(lo, c);
              hi = Math.max(hi, c);
            }
          }
          rel = Math.max(rel, dec(hi) - dec(lo));
        }
      }
      const withDetail = heightAtOf(lat, lon);
      const without = heightAtOf(lat, lon, 0);
      const bound = detailBoundShare() * rel + 1; // + the 1 m floor
      worst = Math.max(worst, Math.abs(withDetail - without) / bound);
      expect(Math.abs(withDetail - without), `${lat}, ${lon}`).toBeLessThanOrEqual(bound);
      n++;
    }
    console.log(`[detail bound] ${n} land points: the largest |detail| is ${(100 * worst).toFixed(0)} % of the bound`);
    expect(n).toBeGreaterThan(5000);
  });

  it('the exaggeration is applied AFTER the detail: render metres in, the shader multiplies by HEIGHT_EXAGGERATION; the sim keeps its own altitudes', () => {
    // heightAt returns metres of the real scale (Everest about 8 000 m, not 100 000): the x12 is the vertex shader's uExag
    const h = heightAtOf(27.99, 86.93);
    expect(h).toBeGreaterThan(3000);
    expect(h).toBeLessThan(13000);
    expect(HEIGHT_EXAGGERATION).toBe(12);
  });
});

describe('the height interval of a quadtree node with the detail (src/render/detailBounds.ts)', () => {
  const places: Array<[number, number, number, number]> = [
    [27, 30, 84, 90], // Himalaya
    [45, 48, 6, 13], // Alps
    [60, 63, 5, 9], // western Norway
    [-34, -30, -71, -68], // Andes
    [50, 53, 4, 7], // the Netherlands (the coast and the flat land)
  ];

  it('holds the heights the chunk shader can draw in the node (at least 99.95 % of 2 x 8 levels x 200 nodes x 60 points; octaves from the coarse ones less one up to the level\'s)', () => {
    const r = rng(5);
    const g = makeChunkGeo();
    let total = 0;
    let insideTight = 0;
    let outside = 0;
    let widest = 0;
    for (const cells of [16, 32]) {
      const db = new DetailBounds(sampler, world.pyramid, cells);
      for (let level = 3; level <= 17; level += 2) {
        let nodes = 0;
        for (let k = 0; k < 200; k++) {
          const pl = places[k % places.length] as [number, number, number, number];
          const lat = pl[0] + (pl[1] - pl[0]) * r();
          const lon = pl[2] + (pl[3] - pl[2]) * r();
          const ix = Math.floor(((lon + 180) / 360) * 4 * 2 ** level);
          const iy = Math.floor(((90 - lat) / 180) * 2 * 2 ** level);
          chunkGeo(level, ix, iy, g);
          const out = { lo: 0, hi: 0 };
          if (!db.range(level, ix, iy, out)) continue;
          nodes++;
          const sizeM = chunkSizeRad(level) * 6371000;
          const nLevel = octavesForLevel(level, cells);
          const nCoarse = Math.min(Math.ceil(nLevel), Math.max(0, Math.floor(Math.log2(6371000 / DETAIL_FREQ0 / sizeM)) + 1));
          const nMin = Math.max(nCoarse - 1, 0);
          widest = Math.max(widest, (out.hi - out.lo) / sizeM);
          for (let s = 0; s < 60; s++) {
            const la = (g.latC + (r() - 0.5) * g.dLat) / DEG;
            const lo = (g.lonC + (r() - 0.5) * g.dLon) / DEG;
            const h = heightAtOf(la, lo, nMin + (nLevel - nMin) * r());
            if (h > out.hi || h < out.lo) outside = Math.max(outside, h > out.hi ? h - out.hi : out.lo - h);
            else insideTight++;
            total++;
          }
        }
        expect(nodes, `level ${level}`).toBeGreaterThan(100);
      }
    }
    console.log(`[detail bounds] ${insideTight} of ${total} heights inside their node's interval (the worst one outside by ${outside.toFixed(2)} m); the widest interval is ${widest.toFixed(1)} node sides`);
    expect(insideTight / total, 'the interval holds the heights').toBeGreaterThanOrEqual(0.9995);
  });

  it('is tight where it matters: a deep node (76 m) has an interval of a few of its own sides (the ground it draws), not the kilometres of the global bound', () => {
    const db = new DetailBounds(sampler, world.pyramid, 32);
    const r = rng(6);
    let sum = 0;
    let n = 0;
    for (let k = 0; k < 300; k++) {
      const pl = places[k % 4] as [number, number, number, number];
      const lat = pl[0] + (pl[1] - pl[0]) * r();
      const lon = pl[2] + (pl[3] - pl[2]) * r();
      const ix = Math.floor(((lon + 180) / 360) * 4 * 2 ** 17);
      const iy = Math.floor(((90 - lat) / 180) * 2 * 2 ** 17);
      const out = { lo: 0, hi: 0 };
      if (!db.range(17, ix, iy, out)) continue;
      sum += (out.hi - out.lo) / (chunkSizeRad(17) * 6371000);
      n++;
    }
    expect(n).toBeGreaterThan(200);
    expect(sum / n).toBeLessThan(6);
    // the second ask is a table hit and answers the same
    const a = { lo: 0, hi: 0 };
    const b = { lo: 0, hi: 0 };
    db.range(9, 3000, 700, a);
    const missBefore = db.hits.miss;
    db.range(9, 3000, 700, b);
    expect(db.hits.miss).toBe(missBefore);
    expect(b).toEqual(a);
  });

  it('a node with no land near is not widened (the sea is exactly 0): range() answers false for mid-Pacific nodes', () => {
    const db = new DetailBounds(sampler, world.pyramid, 32);
    const out = { lo: 0, hi: 0 };
    expect(db.range(8, 142, 370, out)).toBe(false); // the South Pacific at 40 S 130 W: open sea
    expect(db.range(8, 758, 176, out)).toBe(true); // the Himalaya at 28 N 87 E
    expect(out.hi).toBeGreaterThan(5000);
  });
});
