// Seeded random numbers: sfc32 seeded through splitmix32. The generator state is a Uint32Array(4) that lives INSIDE the
// serialised game state (state.rng), never in a module variable, so that a snapshot resumes the same stream.
// Integer arithmetic only (Math.imul and shifts): no floats, no Math.random.

/** Length of the generator state in 32-bit words. */
export const RNG_WORDS = 4;

const GOLDEN_GAMMA = 0x9e3779b9;
/** sfc32 warm-up draws after seeding. */
const WARMUP_DRAWS = 12;

/** The splitmix32 output function applied to one state value. */
export function splitmix32Mix(state: number): number {
  let z = state | 0;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
  return (z ^ (z >>> 15)) >>> 0;
}

/** The splitmix32 state increment. */
export function splitmix32Next(state: number): number {
  return (state + GOLDEN_GAMMA) | 0;
}

/** Seeds an sfc32 state from a 32-bit seed: four splitmix32 outputs, then 12 discarded draws. */
export function seedRng(rng: Uint32Array, seed: number): void {
  let s = seed | 0;
  for (let i = 0; i < RNG_WORDS; i++) {
    s = splitmix32Next(s);
    rng[i] = splitmix32Mix(s);
  }
  for (let i = 0; i < WARMUP_DRAWS; i++) nextU32(rng);
}

/** A fresh generator state for a seed. */
export function createRng(seed: number): Uint32Array {
  const rng = new Uint32Array(RNG_WORDS);
  seedRng(rng, seed);
  return rng;
}

/** The next unsigned 32-bit value of the stream (sfc32). */
export function nextU32(rng: Uint32Array): number {
  const a = (rng[0] as number) | 0;
  const b = (rng[1] as number) | 0;
  let c = (rng[2] as number) | 0;
  const d = (rng[3] as number) | 0;
  const t = (((a + b) | 0) + d) | 0;
  rng[3] = (d + 1) | 0;
  rng[0] = b ^ (b >>> 9);
  rng[1] = (c + (c << 3)) | 0;
  c = (c << 21) | (c >>> 11);
  rng[2] = (c + t) | 0;
  return t >>> 0;
}

/** Uniform integer in [0, n) without modulo bias (rejection sampling). n is clamped to [1, 2^32]; n = 1 draws nothing. */
export function nextBelow(rng: Uint32Array, n: number): number {
  const m = n >= 4294967296 ? 4294967296 : Math.floor(n);
  if (!(m > 1)) return 0;
  const limit = 4294967296 - (4294967296 % m);
  let x = nextU32(rng);
  while (x >= limit) x = nextU32(rng);
  return x % m;
}
