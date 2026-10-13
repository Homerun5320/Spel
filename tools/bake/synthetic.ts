// Synthetic inputs for testing the pipeline itself (seeded noise heights, a few boxes as countries). NEVER committed as real
// packs: index.ts writes them only under .cache/bake-synthetic, and tests assert that public/data holds no synthetic data.
import type { BuildInputs, GeoCollection } from './build';
import { MERC_SIZE } from './terrarium';

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

function box(lon0: number, lat0: number, lon1: number, lat1: number): number[][] {
  return [
    [lon0, lat0],
    [lon1, lat0],
    [lon1, lat1],
    [lon0, lat1],
    [lon0, lat0],
  ];
}

export function syntheticInputs(): Omit<BuildInputs, 'log'> {
  const rand = mulberry32(0x5eed);
  const merc = new Float32Array(MERC_SIZE * MERC_SIZE);
  // Low-frequency noise: a coarse 64 x 64 random grid, bilinearly interpolated, scaled to -4000 .. 3000 m,
  // plus one 11 500 m error pixel to exercise the spike filter.
  const N = 64;
  const coarse = new Float32Array(N * N);
  for (let i = 0; i < coarse.length; i++) coarse[i] = -4000 + rand() * 7000;
  for (let y = 0; y < MERC_SIZE; y++) {
    const fy = (y / MERC_SIZE) * (N - 1);
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    for (let x = 0; x < MERC_SIZE; x++) {
      const fx = (x / MERC_SIZE) * (N - 1);
      const x0 = Math.floor(fx);
      const tx = fx - x0;
      const a = coarse[y0 * N + x0] as number;
      const b = coarse[y0 * N + Math.min(N - 1, x0 + 1)] as number;
      const c = coarse[Math.min(N - 1, y0 + 1) * N + x0] as number;
      const d = coarse[Math.min(N - 1, y0 + 1) * N + Math.min(N - 1, x0 + 1)] as number;
      merc[y * MERC_SIZE + x] = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    }
  }
  merc[1000 * MERC_SIZE + 1000] = 11500;
  const feature = (a3: string, name: string, coordinates: number[][][][] | number[][][], type: 'Polygon' | 'MultiPolygon'): GeoCollection['features'][number] => ({
    properties: { ADM0_A3: a3, NAME: name, NAME_SV: name, NAME_LONG: name, CONTINENT: 'Synthetic', POP_EST: 1000 },
    geometry: { type, coordinates },
  });
  const countries: GeoCollection = {
    features: [
      feature('AAA', 'Aland', [box(-60, -20, 40, 50), box(-30, 0, -10, 20).reverse()], 'Polygon'),
      // Straddles the antimeridian as two pieces (Natural Earth style).
      feature('BBB', 'Bland', [[box(170, -10, 180, 10)], [box(-180, -10, -170, 10)]], 'MultiPolygon'),
      feature('CCC', 'Cland', [box(100, 20, 110, 30)], 'Polygon'),
      // Closed along the pole like the real Natural Earth Antarctica ring (coast with vertices every 90 degrees).
      feature('ATA', 'Antarctica', [[[-180, -70], [-90, -70], [0, -70], [90, -70], [180, -70], [180, -90], [-180, -90], [-180, -70]]], 'Polygon'),
    ],
  };
  const place = (name: string, lon: number, lat: number, pop: number, cls: string): GeoCollection['features'][number] => ({
    properties: { name, nameascii: name, latitude: lat, longitude: lon, pop_max: pop, featurecla: cls, adm0cap: cls === 'Admin-0 capital' ? 1 : 0 },
    geometry: { type: 'Point', coordinates: [lon, lat] },
  });
  const places: GeoCollection = {
    features: [
      place('Acity', 0, 30, 5_000_000, 'Admin-0 capital'),
      place('Aport', 38, 10, 300_000, 'Populated place'),
      place('Ccity', 105, 25, 800_000, 'Admin-0 capital'),
      place('Ghost', 80, 70, 900_000, 'Populated place'),
    ],
  };
  const ports: GeoCollection = {
    features: [
      { properties: { name: 'Aharbour', scalerank: 3 }, geometry: { type: 'Point', coordinates: [39.5, 30] } },
      { properties: { name: 'Nowhere', scalerank: 4 }, geometry: { type: 'Point', coordinates: [-150, 0] } },
    ],
  };
  return { merc, countries, places, ports, naturalEarthSha: 'synthetic' };
}
