// The synthetic fixture world of the golden hashes: integer value noise from a Math.imul hash. No floats anywhere, so
// the bytes are identical on every engine. Terrain class numbers are those of the baked sim pack
// (0 DeepSea, 1 Shallows, 2 Plains, 3 Forest, 4 Hills, 5 Mountain, 6 Peak, 7 Ice); it is a stand-in, not a map of Earth.

/** 32-bit integer hash of a seed and two lattice coordinates. */
export function hash2(seed: number, x: number, y: number): number {
  let h = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** One octave of value noise, 0..255, lattice spacing 2^shift cells, smoothstep weights in 8-bit fixed point. */
function octave(seed: number, x: number, y: number, shift: number): number {
  const gx = x >> shift;
  const gy = y >> shift;
  const mask = (1 << shift) - 1;
  const tx = (x & mask) << (8 - shift);
  const ty = (y & mask) << (8 - shift);
  const sx = (tx * tx * (768 - 2 * tx)) >> 16;
  const sy = (ty * ty * (768 - 2 * ty)) >> 16;
  const v00 = hash2(seed, gx, gy) >>> 24;
  const v10 = hash2(seed, gx + 1, gy) >>> 24;
  const v01 = hash2(seed, gx, gy + 1) >>> 24;
  const v11 = hash2(seed, gx + 1, gy + 1) >>> 24;
  const top = v00 * (256 - sx) + v10 * sx;
  const bottom = v01 * (256 - sx) + v11 * sx;
  return (top * (256 - sy) + bottom * sy) >> 16;
}

export interface FixtureWorld {
  readonly terrain: Uint8Array;
  readonly elevation: Uint16Array;
}

const SEA_LEVEL = 112;
const SHALLOWS_LEVEL = 96;
const METRES_PER_STEP = 34;

/** Builds a width x height fixture world from a seed. Row 0 is north; the top and bottom rows are Ice. */
export function buildFixtureWorld(seed: number, width: number, height: number): FixtureWorld {
  const terrain = new Uint8Array(width * height);
  const elevation = new Uint16Array(width * height);
  const iceRows = Math.max(1, height >> 5);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sum = octave(seed, x, y, 5) * 8 + octave(seed + 1, x, y, 4) * 4 + octave(seed + 2, x, y, 3) * 2 + octave(seed + 3, x, y, 2);
      const n = (sum * 4370) >> 16; // floor(sum / 15) for 0 <= sum <= 3825, in integers (checked by tests/sim/state.test.ts)
      const i = y * width + x;
      const metres = n > SEA_LEVEL ? (n - SEA_LEVEL) * METRES_PER_STEP : 0;
      elevation[i] = metres;
      let cls: number;
      if (n < SHALLOWS_LEVEL) cls = 0;
      else if (n <= SEA_LEVEL) cls = 1;
      else if (metres < 300) cls = (hash2(seed, x, y) & 3) === 0 ? 3 : 2;
      else if (metres < 900) cls = 4;
      else if (metres < 2500) cls = 5;
      else cls = 6;
      if (y < iceRows || y >= height - iceRows) cls = 7;
      terrain[i] = cls;
    }
  }
  return { terrain, elevation };
}
