// Star field data: seeded directions, sizes and colours (pure; the Points object is built in globe.ts).
import { STAR_COUNT, STAR_SEED, STAR_SIZE_MAX, STAR_SIZE_MIN } from './config';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface StarField {
  /** xyz unit directions. */
  positions: Float32Array;
  /** Point size in CSS pixels. */
  sizes: Float32Array;
  /** Linear rgb brightness colour. */
  colors: Float32Array;
}

/** The seeded star field: uniform on the sphere, many faint and few bright stars, a little colour. */
export function buildStars(count = STAR_COUNT, seed = STAR_SEED): StarField {
  const rnd = mulberry32(seed);
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const z = rnd() * 2 - 1;
    const a = rnd() * 2 * Math.PI;
    const r = Math.sqrt(1 - z * z);
    positions[i * 3] = r * Math.cos(a);
    positions[i * 3 + 1] = z;
    positions[i * 3 + 2] = r * Math.sin(a);
    const m = rnd() ** 6; // brightness: most stars faint
    sizes[i] = STAR_SIZE_MIN + (STAR_SIZE_MAX - STAR_SIZE_MIN) * m;
    const tint = rnd();
    const lum = 0.28 + 0.72 * m;
    colors[i * 3] = lum * (tint < 0.2 ? 1.0 : tint > 0.8 ? 0.8 : 0.92);
    colors[i * 3 + 1] = lum * (tint < 0.2 ? 0.82 : 0.92);
    colors[i * 3 + 2] = lum * (tint < 0.2 ? 0.7 : tint > 0.8 ? 1.0 : 0.96);
  }
  return { positions, sizes, colors };
}
