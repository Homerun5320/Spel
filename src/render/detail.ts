// Terrain detail (M07b): the CPU twin of `src/render/shaders/detail.ts`. No three, no DOM: the same maths in the same operation order
// with the same constants (float constants go through Math.fround because GLSL parses them as float32), so that the GLSL height
// and `heightAt` agree to a small fraction of the local relief (the parity tests in tests/render/detail*.test.ts and e2e/detail.test.ts
// compare them through a readback probe). M08 reuses `heightAt` as its `groundHeightAt`: its signature is stable.
//
// THE MODEL. The base is the 4096x2048 height raster (u8, sqrt coded). A point's four surrounding texels give
//   coverage  = the share of land among them, bilinear (1 where all four are land, 0.5 on the coast line): THE land mask. It is the one
//               the fragment shader draws the coast with, so the coast of the mesh and the coast of the picture are the same line.
//   base      = the bilinear height of the codes (decoded) in metres,
//   relief    = max minus min of the base height over 3x3 texels (never below 100 m), bilinear between the four corner texels' own 3x3
//               ranges so that it is continuous (a per-texel step would show as a grid of the amplitude).
// The detail is  relief * DETAIL_AMP * sum_k w_k * DETAIL_PERSIST^k * (ridge_k - mean)  where ridge_k = (1 - |2 n_k - 1|)^2 of 3D value noise n_k
// on the (rotated) unit sphere at 2^k * DETAIL_FREQ0 cells per Earth radius, and w_k = clamp(octaves - k, 0, 1): `octaves` is the
// level of detail, may be fractional, and the weight of the last octave fades it in. The height is
//   0 on sea (coverage < 0.5), else max(g * (base + detail), 1 m) with g = smoothstep(0.5, 1, coverage),
// so that land never changes sign against the sea (land > 0, sea = 0) and the relief fades to zero at the coast.
//
// LEVEL OF DETAIL. A chunk of level L with `cells` grid cells has a vertex spacing of (pi/2) * R / 2^L / cells, and an octave is only
// allowed where its lattice cell is at least TWO spacings (it is fully on at four): `octavesForLevel`. The vertex shader limits that
// further by the vertex's distance from the camera (`octavesAtDistance`), which is continuous, so a vertex that is shared by a level
// L and a level L + 1 chunk gets the SAME height from both (no pop at the LOD switch), see DECISIONS D147.
//
// SIM VERSUS RENDER. These are RENDER metres: the shader multiplies them by HEIGHT_EXAGGERATION (12) to place a vertex. The simulation's
// altitudes (GAMEPLAY_HEIGHT_EXAG, M11a) are another quantity; a layer that must sit on the visible ground uses `heightAt`.
import {
  POLAR_FADE_END_DEG,
  POLAR_FADE_START_DEG,
  DETAIL_AMP,
  DETAIL_COAST_FADE,
  DETAIL_FREQ0,
  DETAIL_LAND_MIN_M,
  DETAIL_OCTAVES_MAX,
  DETAIL_PERSIST,
  DETAIL_PROBE_OCTAVES,
  DETAIL_RELIEF_FLOOR_M,
  DETAIL_RIDGE_MEAN,
  DETAIL_SEED,
  EARTH_RADIUS_KM,
} from './config';
import { DEG, POLE_HEIGHT_U } from './geo';

const f32 = Math.fround;

/** Lattice coordinates are shifted by this before they become unsigned (GLSL ES 3.00 leaves int to uint of a negative number to the driver). */
export const NOISE_OFFSET = 1 << 20;

// The constants of the hash (GLSL has the same literals).
export const HASH_MUL_A = 0x7feb352d;
export const HASH_MUL_B = 0x846ca68b;
export const HASH_X = 0x27d4eb2f;
export const HASH_Y = 0x165667b1;
export const HASH_Z = 0x9e3779b1;
export const HASH_OCTAVE = 0x6c8e9cf5;

/** A fixed rotation of the sphere before the noise (the 3-4-5 rotation), so that the lattice planes are not the axes of the globe. */
export const ROT: readonly [number, number, number, number, number, number, number, number, number] = [0.36, 0.48, -0.8, -0.8, 0.6, 0, 0.48, 0.64, 0.6];

/** The integer hash of one 32-bit word (xor-shift / multiply rounds, no sin): the same on every GPU and in JavaScript. */
export function detailHash(x: number): number {
  x ^= x >>> 16;
  x = Math.imul(x, HASH_MUL_A);
  x ^= x >>> 15;
  x = Math.imul(x, HASH_MUL_B);
  x ^= x >>> 16;
  return x >>> 0;
}

/** Hash of a lattice cell (integer coordinates already shifted by NOISE_OFFSET) under a seed. */
export function detailHash3(ix: number, iy: number, iz: number, seed: number): number {
  let h = (seed + Math.imul(ix, HASH_X)) >>> 0;
  h = detailHash(h);
  h = (h + Math.imul(iy, HASH_Y)) >>> 0;
  h = detailHash(h);
  h = (h + Math.imul(iz, HASH_Z)) >>> 0;
  return detailHash(h);
}

const INV_2_24 = 1 / 16777216;

/** The value of a lattice corner: 24 bits of the hash, exact in a float32. */
export function cornerValue(ix: number, iy: number, iz: number, seed: number): number {
  return (detailHash3(ix, iy, iz, seed) >>> 8) * INV_2_24;
}

/** 3D value noise in [0, 1): trilinear between the eight corners with the quintic fade curve. */
export function valueNoise3(px: number, py: number, pz: number, seed: number): number {
  const fx = Math.floor(px);
  const fy = Math.floor(py);
  const fz = Math.floor(pz);
  const tx = px - fx;
  const ty = py - fy;
  const tz = pz - fz;
  const sx = tx * tx * tx * (tx * (tx * 6 - 15) + 10);
  const sy = ty * ty * ty * (ty * (ty * 6 - 15) + 10);
  const sz = tz * tz * tz * (tz * (tz * 6 - 15) + 10);
  const x0 = fx + NOISE_OFFSET;
  const y0 = fy + NOISE_OFFSET;
  const z0 = fz + NOISE_OFFSET;
  const c000 = cornerValue(x0, y0, z0, seed);
  const c100 = cornerValue(x0 + 1, y0, z0, seed);
  const c010 = cornerValue(x0, y0 + 1, z0, seed);
  const c110 = cornerValue(x0 + 1, y0 + 1, z0, seed);
  const c001 = cornerValue(x0, y0, z0 + 1, seed);
  const c101 = cornerValue(x0 + 1, y0, z0 + 1, seed);
  const c011 = cornerValue(x0, y0 + 1, z0 + 1, seed);
  const c111 = cornerValue(x0 + 1, y0 + 1, z0 + 1, seed);
  const x00 = c000 + (c100 - c000) * sx;
  const x10 = c010 + (c110 - c010) * sx;
  const x01 = c001 + (c101 - c001) * sx;
  const x11 = c011 + (c111 - c011) * sx;
  const y0v = x00 + (x10 - x00) * sy;
  const y1v = x01 + (x11 - x01) * sy;
  return y0v + (y1v - y0v) * sz;
}

// ---- the level of detail ----------------------------------------------------------------------------------------------------------

/** log2 of (cells per radius of octave 0 times pi): level L of a chunk with 32 cells has L - 5 octaves when this is 10. */
const LOG2_F0_PI = Math.log2(DETAIL_FREQ0 * Math.PI);

/**
 * How many octaves a chunk of this level can carry (fractional: the last octave fades in over one level). An octave is allowed where its
 * lattice cell (Earth radius / (DETAIL_FREQ0 * 2^k)) is at least two vertex spacings of the chunk; `cells` is the grid cells per chunk side.
 */
export function octavesForLevel(level: number, cells = 32): number {
  return Math.min(DETAIL_OCTAVES_MAX, Math.max(0, level + levelBias(cells)));
}

/** The additive constant of `octavesForLevel` (a uniform of the vertex shader). */
export function levelBias(cells: number): number {
  return Math.log2(cells) - LOG2_F0_PI;
}

/**
 * The camera-distance law of the vertex shader: octaves = offset - log2(distance in Earth radii). `kMin` is the smallest split distance of
 * the tier's quadtree in chunk sides (its `deepK`), so a chunk that the quadtree draws is never asked for more octaves than its level
 * carries, and the law is the same function for both sides of an LOD seam.
 */
export interface DetailLod {
  /** log2(kMin * cells / (2 * DETAIL_FREQ0)). */
  offset: number;
  levelBias: number;
}

export function detailLod(cells: number, kMin: number): DetailLod {
  return { offset: Math.log2((kMin * cells) / (2 * DETAIL_FREQ0)), levelBias: levelBias(cells) };
}

/** The octaves the distance law allows (distance in Earth radii), unclamped. */
export function octavesAtDistance(distRadii: number, lod: DetailLod): number {
  return lod.offset - Math.log2(Math.max(distRadii, 1e-9));
}

// ---- the height ------------------------------------------------------------------------------------------------------------------

export interface HeightSource {
  /** u8 sqrt-coded land heights, row 0 = north, 0 = sea. */
  codes: Uint8Array;
  width: number;
  height: number;
  /** Largest decoded height (meta.json encoding.heightSqrt.maxM). */
  maxM: number;
}

export interface SamplerOptions {
  /** The hash seed (default DETAIL_SEED; the mutation test changes it). */
  seed?: number;
}

const AMP = f32(DETAIL_AMP);
const PERSIST = f32(DETAIL_PERSIST);
const RIDGE_MEAN = f32(DETAIL_RIDGE_MEAN);
const FREQ0 = f32(DETAIL_FREQ0);
const RELIEF_FLOOR = f32(DETAIL_RELIEF_FLOOR_M);
const LAND_MIN = f32(DETAIL_LAND_MIN_M);
const FADE0 = f32(DETAIL_COAST_FADE[0]);
const FADE1 = f32(DETAIL_COAST_FADE[1]);
const POLAR0 = f32(POLAR_FADE_START_DEG);
const POLAR1 = f32(POLAR_FADE_END_DEG);
const R = ROT.map(f32);

/** The largest |detail| as a share of the relief: the bound the quadtree widens its bounding spheres by. */
export function detailBoundShare(): number {
  let sum = 0;
  let amp = 1;
  for (let k = 0; k < DETAIL_OCTAVES_MAX; k++) {
    sum += amp;
    amp *= DETAIL_PERSIST;
  }
  return DETAIL_AMP * sum * Math.max(DETAIL_RIDGE_MEAN, 1 - DETAIL_RIDGE_MEAN);
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export interface TerrainSample {
  /** True on land (coverage >= 0.5: the coast line itself is land), false on sea. */
  land: boolean;
  /** 0 on sea, else the coast fade in [0, 1] (0 exactly on the coast line). */
  g: number;
  /** Bilinear base height of the raster, metres. */
  base: number;
  /** Local relief, metres (never below the floor; 0 when it was not asked for). */
  relief: number;
  /** The land coverage (0..1). */
  coverage: number;
}

/**
 * Samples the raster and evaluates the detail. Owns scratch arrays: one instance is NOT reentrant, and it allocates nothing per call.
 */
export class HeightSampler {
  readonly source: HeightSource;
  readonly seed: number;
  readonly sample: TerrainSample = { land: false, g: 0, base: 0, relief: 0, coverage: 0 };
  private readonly block = new Float64Array(16);
  private readonly seeds = new Uint32Array(DETAIL_OCTAVES_MAX);
  private readonly maxM: number;

  constructor(source: HeightSource, opts: SamplerOptions = {}) {
    this.source = source;
    this.seed = (opts.seed ?? DETAIL_SEED) >>> 0;
    this.maxM = f32(source.maxM);
    for (let k = 0; k < DETAIL_OCTAVES_MAX; k++) this.seeds[k] = (this.seed + Math.imul(k, HASH_OCTAVE)) >>> 0;
  }

  /** Code at a texel (longitude wraps, latitude clamps), as an integer. */
  private code(x: number, y: number): number {
    const w = this.source.width;
    const h = this.source.height;
    const wx = ((x % w) + w) % w;
    const wy = y < 0 ? 0 : y >= h ? h - 1 : y;
    return this.source.codes[wy * w + wx] as number;
  }

  private decode(code: number): number {
    const f = code / 255;
    return this.maxM * f * f;
  }

  /** Fills `this.sample` for a texture coordinate (u from -180 degrees, v from the north pole, as the shader's hUv). */
  sampleAt(u: number, v: number, needRelief: boolean): TerrainSample {
    const s = this.sample;
    const W = this.source.width;
    const H = this.source.height;
    const tx = u * W - 0.5;
    const ty = v * H - 0.5;
    const x0 = Math.floor(tx);
    const y0 = Math.floor(ty);
    const fx = tx - x0;
    const fy = ty - y0;
    const c = this.block;
    const c00 = this.code(x0, y0);
    const c10 = this.code(x0 + 1, y0);
    const c01 = this.code(x0, y0 + 1);
    const c11 = this.code(x0 + 1, y0 + 1);
    const w00 = (1 - fx) * (1 - fy);
    const w10 = fx * (1 - fy);
    const w01 = (1 - fx) * fy;
    const w11 = fx * fy;
    const cov = w00 * (c00 >= 0.5 ? 1 : 0) + w10 * (c10 >= 0.5 ? 1 : 0) + w01 * (c01 >= 0.5 ? 1 : 0) + w11 * (c11 >= 0.5 ? 1 : 0);
    s.coverage = cov;
    s.land = false;
    s.g = 0;
    s.base = 0;
    s.relief = 0;
    if (cov < 0.5) return s;
    s.land = true;
    s.g = smoothstep(FADE0, FADE1, cov);
    const cb = c00 * w00 + c10 * w10 + c01 * w01 + c11 * w11;
    const f = cb / 255;
    s.base = this.maxM * f * f;
    if (!needRelief) return s;
    c[5] = c00;
    c[6] = c10;
    c[9] = c01;
    c[10] = c11;
    for (let j = 0; j < 4; j++) {
      for (let i = 0; i < 4; i++) {
        const k = j * 4 + i;
        if (k === 5 || k === 6 || k === 9 || k === 10) continue;
        c[k] = this.code(x0 - 1 + i, y0 - 1 + j);
      }
    }
    let relief = 0;
    for (let b = 0; b < 2; b++) {
      for (let a = 0; a < 2; a++) {
        let lo = 255;
        let hi = 0;
        for (let j = 0; j < 3; j++) {
          for (let i = 0; i < 3; i++) {
            const cv = c[(b + j) * 4 + a + i] as number;
            lo = Math.min(lo, cv);
            hi = Math.max(hi, cv);
          }
        }
        const rel = Math.max(RELIEF_FLOOR, this.decode(hi) - this.decode(lo));
        relief += rel * ((a === 0 ? 1 - fx : fx) * (b === 0 ? 1 - fy : fy));
      }
    }
    // Poleward of the last real elevation row the raster is a smoothed copy: no relief there, so no detail (the same fade the fragment shader applies to the slope).
    s.relief = relief * (1 - smoothstep(POLAR0, POLAR1, Math.abs(90 - v * 180)));
    return s;
  }

  /** The ridged octave sum (dimensionless, about +-0.5) at the rotated direction q for a (fractional) number of octaves. */
  detailSum(qx: number, qy: number, qz: number, octaves: number): number {
    let sum = 0;
    let amp = 1;
    let f = FREQ0;
    const n = Math.min(octaves, DETAIL_OCTAVES_MAX);
    for (let k = 0; k < DETAIL_OCTAVES_MAX; k++) {
      const w = Math.min(1, Math.max(0, n - k));
      if (w <= 0) break;
      const nz = valueNoise3(qx * f, qy * f, qz * f, this.seeds[k] as number);
      const r = 1 - Math.abs(2 * nz - 1);
      sum += w * amp * (r * r - RIDGE_MEAN);
      amp *= PERSIST;
      f *= 2;
    }
    return sum;
  }

  /** Height in metres of the current sample at the unit direction (x, y, z) with that many octaves. */
  heightOfSample(dx: number, dy: number, dz: number, octaves: number): number {
    const s = this.sample;
    if (!s.land) return 0;
    let h = s.base;
    if (octaves > 0) {
      const qx = R[0]! * dx + R[1]! * dy + R[2]! * dz;
      const qy = R[3]! * dx + R[4]! * dy + R[5]! * dz;
      const qz = R[6]! * dx + R[7]! * dy + R[8]! * dz;
      h += s.relief * AMP * this.detailSum(qx, qy, qz, octaves);
    }
    return Math.max(s.g * h, LAND_MIN);
  }

  /** The octave sum S (dimensionless, about +-0.5) at a position for a (fractional) number of octaves: detail = relief * DETAIL_AMP * S. */
  detailSumAt(latDeg: number, lonDeg: number, octaves: number): number {
    const lat = latDeg * DEG;
    const lon = lonDeg * DEG;
    const cl = Math.cos(lat);
    const dx = cl * Math.sin(lon);
    const dy = Math.sin(lat);
    const dz = cl * Math.cos(lon);
    return this.detailSum(R[0]! * dx + R[1]! * dy + R[2]! * dz, R[3]! * dx + R[4]! * dy + R[5]! * dz, R[6]! * dx + R[7]! * dy + R[8]! * dz, octaves);
  }

  /** Render height in metres (before the exaggeration) at a position, with `maxOctaves` octaves of detail (default: all of them). */
  heightAt(latDeg: number, lonDeg: number, maxOctaves: number = DETAIL_OCTAVES_MAX): number {
    const v = (90 - latDeg) / 180;
    const u = v <= 0 || v >= 1 ? POLE_HEIGHT_U : (lonDeg + 180) / 360;
    const n = maxOctaves > 0 ? maxOctaves : 0;
    this.sampleAt(u, v, n > 0);
    if (!this.sample.land) return 0;
    const lat = latDeg * DEG;
    const lon = lonDeg * DEG;
    const cl = Math.cos(lat);
    return this.heightOfSample(cl * Math.sin(lon), Math.sin(lat), cl * Math.cos(lon), n);
  }

  /**
   * The height the vertex shader draws at a position, seen from a camera: the octaves are the smaller of the level's (`levelOctaves`, or all)
   * and the distance law's, the distance being that of the vertex placed with a first pass of `DETAIL_PROBE_OCTAVES` octaves
   * (`exaggeration` is the height exaggeration, `cam` the camera position in Earth radii). The mirror of the GLSL main().
   */
  heightSeenM(latDeg: number, lonDeg: number, cam: readonly [number, number, number], exaggeration: number, lod: DetailLod, levelOctaves: number = DETAIL_OCTAVES_MAX): number {
    const v = (90 - latDeg) / 180;
    const u = v <= 0 || v >= 1 ? POLE_HEIGHT_U : (lonDeg + 180) / 360;
    this.sampleAt(u, v, true);
    if (!this.sample.land) return 0;
    const lat = latDeg * DEG;
    const lon = lonDeg * DEG;
    const cl = Math.cos(lat);
    const dx = cl * Math.sin(lon);
    const dy = Math.sin(lat);
    const dz = cl * Math.cos(lon);
    const lv = Math.min(DETAIL_OCTAVES_MAX, Math.max(0, levelOctaves));
    const h0 = this.heightOfSample(dx, dy, dz, Math.min(lv, DETAIL_PROBE_OCTAVES));
    const r0 = 1 + (exaggeration * h0) / (EARTH_RADIUS_KM * 1000);
    const d0 = Math.hypot(dx * r0 - cam[0], dy * r0 - cam[1], dz * r0 - cam[2]);
    const n = Math.max(0, Math.min(lv, octavesAtDistance(d0, lod)));
    return this.heightOfSample(dx, dy, dz, n);
  }
}

// ---- the module level `heightAt` (M08's groundHeightAt) -----------------------------------------------------------------------------

let bound: HeightSampler | null = null;

/** Binds the height source `heightAt` reads (the page binds the raster it uploads; tests bind the pack). Returns the sampler. */
export function bindHeightSource(source: HeightSource | HeightSampler | null): HeightSampler | null {
  bound = source === null ? null : source instanceof HeightSampler ? source : new HeightSampler(source);
  return bound;
}

/**
 * THE ground height in render metres at a position (before the height exaggeration), detail included: land is above 0, sea is 0.
 * `maxOctaves` limits the detail (default: the finest level, all octaves; `octavesForLevel(level)` gives the vertex shader's value for a
 * chunk level). Throws if no height source is bound.
 */
export function heightAt(latDeg: number, lonDeg: number, maxOctaves?: number): number {
  if (!bound) throw new Error('heightAt: no height source is bound (bindHeightSource)');
  return bound.heightAt(latDeg, lonDeg, maxOctaves);
}
