// The height field of the LOS maths (M11a) on the real 1024x512 world, loaded in Node from public/data (mean and max elevation of the
// SIM pack). Used by the LOS tests and the measurement; the browser path (fetch) belongs to M11b.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorldLoader } from '../../src/data/world';
import { createLosTerrain, type LosTerrain } from '../../src/sim/los/terrain';

const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/data');

export interface RealLos {
  /** Rebuilds the height field with another exaggeration and occluder weight (for the measurement rounds). */
  withParams(exag: number, weightPct: number): LosTerrain;
  terrain: LosTerrain;
  terrainClass: Uint8Array;
  /** Real mean elevation per sim cell (M11b: the nav grid reads it). */
  meanElev: ArrayLike<number>;
}

let cached: Promise<RealLos> | null = null;

export function loadRealLos(): Promise<RealLos> {
  if (cached !== null) return cached;
  cached = (async (): Promise<RealLos> => {
    const loader = createWorldLoader({
      manifestUrl: 'http://sim.invalid/data/manifest.json',
      readBytes: async (url: string): Promise<Uint8Array> => new Uint8Array(fs.readFileSync(path.join(DATA_DIR, decodeURIComponent(new URL(url).pathname.replace(/^\/data\//, ''))))),
    });
    const [sim, meta] = await Promise.all([loader.loadSim(), loader.loadMeta()]);
    return {
      terrain: createLosTerrain(sim.width, sim.height, meta.sim.cosQ15, sim.meanElev, sim.maxElev),
      terrainClass: sim.terrainClass,
      meanElev: sim.meanElev,
      withParams: (exag, weightPct) => createLosTerrain(sim.width, sim.height, meta.sim.cosQ15, sim.meanElev, sim.maxElev, exag, weightPct),
    };
  })();
  return cached;
}

/** The sim cell of a latitude and longitude on the 1024x512 grid. */
export function cellAtLatLon(lat: number, lon: number): number {
  const x = Math.min(1023, Math.floor(((lon + 180) / 360) * 1024));
  const y = Math.min(511, Math.floor(((90 - lat) / 180) * 512));
  return y * 1024 + x;
}
