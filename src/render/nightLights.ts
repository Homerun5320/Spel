// Night lights: a 2048x1024 single-channel light texture drawn on the CPU from cities.json (no image assets). Every city
// gets a soft core whose radius and strength grow with the population, plus a few seeded satellite lights around it
// (suburbs and towns). Deterministic: the PRNG is seeded from `LIGHTS_SEED` and the city index.
import { SIM_HEIGHT, SIM_WIDTH, type City } from '../data';
import { LIGHTS_HEIGHT, LIGHTS_SEED, LIGHTS_WIDTH } from './config';

/** sfc32-free tiny PRNG (mulberry32); the render side has no determinism lint but the texture must be reproducible. */
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

/** Adds a gaussian blob (peak `peak`, sigma in texels) around a texel position; longitude wraps, latitude clips. */
function addBlob(light: Float32Array, w: number, h: number, cx: number, cy: number, sigma: number, peak: number): void {
  const reach = Math.ceil(sigma * 3);
  const inv = 1 / (2 * sigma * sigma);
  // Texels shrink in longitude towards the poles; widen the blob there so it stays round on the globe.
  const lat = ((0.5 - cy / h) * Math.PI);
  const stretch = 1 / Math.max(0.25, Math.cos(lat));
  const reachX = Math.ceil(reach * stretch);
  for (let dy = -reach; dy <= reach; dy++) {
    const y = Math.floor(cy) + dy;
    if (y < 0 || y >= h) continue;
    for (let dx = -reachX; dx <= reachX; dx++) {
      const x = (((Math.floor(cx) + dx) % w) + w) % w;
      const ex = (dx + 0.5 - (cx - Math.floor(cx))) / stretch;
      const ey = dy + 0.5 - (cy - Math.floor(cy));
      const v = peak * Math.exp(-(ex * ex + ey * ey) * inv);
      const i = y * w + x;
      // Combine as 1 - (1-a)(1-b) so overlapping blobs saturate instead of exceeding 1.
      light[i] = 1 - (1 - (light[i] as number)) * (1 - v);
    }
  }
}

/** The light texture of a city list as bytes (0..255, row 0 = north, column 0 = longitude -180). */
export function buildCityLights(cities: readonly City[], width = LIGHTS_WIDTH, height = LIGHTS_HEIGHT): Uint8Array {
  const light = new Float32Array(width * height);
  cities.forEach((c, index) => {
    const rnd = mulberry32(Math.imul(LIGHTS_SEED, 2654435761) ^ Math.imul(index + 1, 40503));
    // The light sits at the centre of the city's sim cell (always a land cell); a city without a valid cell uses lat/lon.
    const hasCell = Number.isInteger(c.cell) && c.cell >= 0 && c.cell < SIM_WIDTH * SIM_HEIGHT;
    const cx = hasCell ? (((c.cell % SIM_WIDTH) + 0.5) / SIM_WIDTH) * width : ((c.lon + 180) / 360) * width;
    const cy = hasCell ? ((Math.floor(c.cell / SIM_WIDTH) + 0.5) / SIM_HEIGHT) * height : ((90 - c.lat) / 180) * height;
    // Population on a log scale: 100 k -> 0, 35 M -> 2.55 decades.
    const decades = Math.max(0, Math.min(2.7, Math.log10(Math.max(c.population, 1e4) / 1e5)));
    const texelScale = width / 1024; // the sizes below are written for a 1024-wide texture (about 39 km per texel)
    const sigma = (0.45 + 0.3 * decades) * texelScale;
    const peak = Math.min(1, 0.5 + 0.2 * decades);
    addBlob(light, width, height, cx, cy, sigma, peak);
    const satellites = 1 + Math.round(decades * 4);
    for (let s = 0; s < satellites; s++) {
      const ang = rnd() * 2 * Math.PI;
      const rad = sigma * (1.6 + 2.8 * rnd());
      addBlob(light, width, height, cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad * 0.8, (0.4 + 0.25 * rnd()) * texelScale, 0.25 + 0.3 * rnd());
    }
  });
  const out = new Uint8Array(width * height);
  for (let i = 0; i < out.length; i++) out[i] = Math.round(Math.min(1, light[i] as number) * 255);
  return out;
}
