// Terrain detail in GLSL ES 3.00 (M07b): the shader twin of `src/render/detail.ts`. THE SAME MATHS in the same operation order with the
// same constants (the hash is an integer hash on uint, the TypeScript one uses Math.imul): `tests/render/detail*.test.ts` compare the
// two texts and `e2e/detail.test.ts` compares their results through the readback probe (`src/render/detailProbe.ts`). The module is used
// by the chunk vertex shader (`src/render/shaders/chunk.ts`) and by the probe; the including shader declares
//   uniform sampler2D uHeight; uniform ivec2 uHeightSize; uniform float uHeightMaxM;
// and includes GLSL_TEXELS from `src/render/shaders/common.ts` first (fetchCode).
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
} from '../config';
import { HASH_MUL_A, HASH_MUL_B, HASH_OCTAVE, HASH_X, HASH_Y, HASH_Z, NOISE_OFFSET, ROT } from '../detail';

/** A number as a GLSL float literal (always with a decimal point). */
function glslFloat(x: number): string {
  const t = String(x);
  return /[.e]/.test(t) ? t : `${t}.0`;
}

const u = (x: number): string => `0x${(x >>> 0).toString(16)}u`;

export const GLSL_DETAIL = /* glsl */ `
const uint DET_MUL_A = ${u(HASH_MUL_A)};
const uint DET_MUL_B = ${u(HASH_MUL_B)};
const uint DET_X = ${u(HASH_X)};
const uint DET_Y = ${u(HASH_Y)};
const uint DET_Z = ${u(HASH_Z)};
const uint DET_OCTAVE = ${u(HASH_OCTAVE)};
const uint DET_SEED = ${u(DETAIL_SEED)};
const int DET_OFFSET = ${NOISE_OFFSET};
const int DET_OCTAVES_MAX = ${DETAIL_OCTAVES_MAX};
const float DET_FREQ0 = ${glslFloat(DETAIL_FREQ0)};
const float DET_AMP = ${glslFloat(DETAIL_AMP)};
const float DET_PERSIST = ${glslFloat(DETAIL_PERSIST)};
const float DET_PROBE_OCTAVES = ${glslFloat(DETAIL_PROBE_OCTAVES)};
const float DET_RIDGE_MEAN = ${glslFloat(DETAIL_RIDGE_MEAN)};
const float DET_RELIEF_FLOOR = ${glslFloat(DETAIL_RELIEF_FLOOR_M)};
const float DET_LAND_MIN = ${glslFloat(DETAIL_LAND_MIN_M)};
const float DET_FADE0 = ${glslFloat(DETAIL_COAST_FADE[0])};
const float DET_FADE1 = ${glslFloat(DETAIL_COAST_FADE[1])};
const float DET_POLAR0 = ${glslFloat(POLAR_FADE_START_DEG)};
const float DET_POLAR1 = ${glslFloat(POLAR_FADE_END_DEG)};
const vec3 DET_ROT0 = vec3(${ROT.slice(0, 3).map(glslFloat).join(', ')});
const vec3 DET_ROT1 = vec3(${ROT.slice(3, 6).map(glslFloat).join(', ')});
const vec3 DET_ROT2 = vec3(${ROT.slice(6, 9).map(glslFloat).join(', ')});

// The integer hash of one word (no sin: the same value on every GPU, and in JavaScript with Math.imul).
uint detHash(uint x) {
  x ^= x >> 16u;
  x *= DET_MUL_A;
  x ^= x >> 15u;
  x *= DET_MUL_B;
  x ^= x >> 16u;
  return x;
}

uint detHash3(int ix, int iy, int iz, uint seed) {
  uint h = seed + uint(ix) * DET_X;
  h = detHash(h);
  h += uint(iy) * DET_Y;
  h = detHash(h);
  h += uint(iz) * DET_Z;
  return detHash(h);
}

float detCorner(int ix, int iy, int iz, uint seed) {
  return float(detHash3(ix, iy, iz, seed) >> 8u) * (1.0 / 16777216.0);
}

// 3D value noise in [0, 1): trilinear between the eight corners with the quintic fade curve.
float detNoise(vec3 p, uint seed) {
  vec3 fl = floor(p);
  vec3 t = p - fl;
  vec3 s = t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
  ivec3 i = ivec3(fl) + ivec3(DET_OFFSET);
  float c000 = detCorner(i.x, i.y, i.z, seed);
  float c100 = detCorner(i.x + 1, i.y, i.z, seed);
  float c010 = detCorner(i.x, i.y + 1, i.z, seed);
  float c110 = detCorner(i.x + 1, i.y + 1, i.z, seed);
  float c001 = detCorner(i.x, i.y, i.z + 1, seed);
  float c101 = detCorner(i.x + 1, i.y, i.z + 1, seed);
  float c011 = detCorner(i.x, i.y + 1, i.z + 1, seed);
  float c111 = detCorner(i.x + 1, i.y + 1, i.z + 1, seed);
  float x00 = c000 + (c100 - c000) * s.x;
  float x10 = c010 + (c110 - c010) * s.x;
  float x01 = c001 + (c101 - c001) * s.x;
  float x11 = c011 + (c111 - c011) * s.x;
  float y0 = x00 + (x10 - x00) * s.y;
  float y1 = x01 + (x11 - x01) * s.y;
  return y0 + (y1 - y0) * s.z;
}

// The ridged octave sum (about +-0.5) at the rotated direction q for a (fractional) number of octaves; the last octave fades in.
float detSum(vec3 q, float octaves) {
  float sum = 0.0;
  float amp = 1.0;
  float f = DET_FREQ0;
  float n = min(octaves, float(DET_OCTAVES_MAX));
  for (int k = 0; k < DET_OCTAVES_MAX; k++) {
    float w = clamp(n - float(k), 0.0, 1.0);
    if (w <= 0.0) break;
    float nz = detNoise(q * f, DET_SEED + uint(k) * DET_OCTAVE);
    float r = 1.0 - abs(2.0 * nz - 1.0);
    sum += w * amp * (r * r - DET_RIDGE_MEAN);
    amp *= DET_PERSIST;
    f *= 2.0;
  }
  return sum;
}

float detCode(int x, int y) {
  return floor(fetchCode(uHeight, uHeightSize, ivec2(x, y)) + 0.5);
}

float detDecode(float code) {
  float f = code / 255.0;
  return uHeightMaxM * f * f;
}

// What the raster says at a texture coordinate: g = 0 on sea, else the coast fade; base height and local relief in metres.
struct DetSample {
  float land; // 1 on land (coverage >= 0.5: the coast line itself is land), else 0
  float g;
  float base;
  float relief;
};

DetSample detSample(vec2 hUv, bool needRelief) {
  DetSample s;
  s.land = 0.0;
  s.g = 0.0;
  s.base = 0.0;
  s.relief = 0.0;
  vec2 t = hUv * vec2(uHeightSize) - 0.5;
  vec2 fl = floor(t);
  vec2 f = t - fl;
  int x0 = int(fl.x);
  int y0 = int(fl.y);
  float c[16];
  float c00 = detCode(x0, y0);
  float c10 = detCode(x0 + 1, y0);
  float c01 = detCode(x0, y0 + 1);
  float c11 = detCode(x0 + 1, y0 + 1);
  float w00 = (1.0 - f.x) * (1.0 - f.y);
  float w10 = f.x * (1.0 - f.y);
  float w01 = (1.0 - f.x) * f.y;
  float w11 = f.x * f.y;
  float cov = w00 * step(0.5, c00) + w10 * step(0.5, c10) + w01 * step(0.5, c01) + w11 * step(0.5, c11);
  if (cov < 0.5) return s;
  s.land = 1.0;
  s.g = smoothstep(DET_FADE0, DET_FADE1, cov);
  float cb = c00 * w00 + c10 * w10 + c01 * w01 + c11 * w11;
  float fb = cb / 255.0;
  s.base = uHeightMaxM * fb * fb;
  if (!needRelief) return s;
  for (int j = 0; j < 4; j++) {
    for (int i = 0; i < 4; i++) {
      int k = j * 4 + i;
      if (k == 5) { c[k] = c00; continue; }
      if (k == 6) { c[k] = c10; continue; }
      if (k == 9) { c[k] = c01; continue; }
      if (k == 10) { c[k] = c11; continue; }
      c[k] = detCode(x0 - 1 + i, y0 - 1 + j);
    }
  }
  float relief = 0.0;
  for (int b = 0; b < 2; b++) {
    for (int a = 0; a < 2; a++) {
      float lo = 255.0;
      float hi = 0.0;
      for (int j = 0; j < 3; j++) {
        for (int i = 0; i < 3; i++) {
          float cv = c[(b + j) * 4 + a + i];
          lo = min(lo, cv);
          hi = max(hi, cv);
        }
      }
      float rel = max(DET_RELIEF_FLOOR, detDecode(hi) - detDecode(lo));
      relief += rel * ((a == 0 ? 1.0 - f.x : f.x) * (b == 0 ? 1.0 - f.y : f.y));
    }
  }
  // Poleward of the last real elevation row the raster is a smoothed copy: no relief there, so no detail (the same fade the fragment shader applies to the slope).
  s.relief = relief * (1.0 - smoothstep(DET_POLAR0, DET_POLAR1, abs(90.0 - hUv.y * 180.0)));
  return s;
}

// The rotation applied to a direction before the noise.
vec3 detRotate(vec3 d) {
  return vec3(dot(DET_ROT0, d), dot(DET_ROT1, d), dot(DET_ROT2, d));
}

// The height in metres (render metres, before the exaggeration) of a sample at the rotated direction q with that many octaves.
float detHeight(DetSample s, vec3 q, float octaves) {
  if (s.land < 0.5) return 0.0;
  float h = s.base;
  if (octaves > 0.0) h += s.relief * DET_AMP * detSum(q, octaves);
  return max(s.g * h, DET_LAND_MIN);
}

// The height (render metres) the chunk vertex shader draws at a vertex: the octaves are the smaller of what the chunk's level carries
// (level + lod.y) and what the distance law allows (lod.x - log2(distance in Earth radii)), the distance being that of the vertex placed
// by a first pass of DET_PROBE_OCTAVES octaves. dir is the unit direction of the vertex, relUnit the vertex on the unit sphere minus the
// camera, lod = (offset, level bias, detail on), exagPerM the exaggeration over the Earth radius in metres. Mirror: heightSeenM in detail.ts.
float detVertexHeight(vec2 hUv, vec3 dir, vec3 relUnit, float level, vec3 lod, float exagPerM) {
  bool on = lod.z > 0.5;
  DetSample ds = detSample(hUv, on);
  if (ds.land < 0.5) return 0.0;
  if (!on) return detHeight(ds, vec3(0.0), 0.0);
  vec3 q = detRotate(dir);
  float levelOct = clamp(level + lod.y, 0.0, float(DET_OCTAVES_MAX));
  float h0 = detHeight(ds, q, min(levelOct, DET_PROBE_OCTAVES));
  float r0 = 1.0 + exagPerM * h0;
  float d0 = length(relUnit + dir * (r0 - 1.0));
  float octaves = max(min(levelOct, lod.x - log2(max(d0, 1e-9))), 0.0);
  return detHeight(ds, q, octaves);
}
`;
