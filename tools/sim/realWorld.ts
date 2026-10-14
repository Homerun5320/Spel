// Loads the real 1024x512 world from public/data in Node (the fs variant of the loader's injected readBytes) and turns it
// into a SimWorld. Used by the scenario CLI, the tests and the perf tests; the browser path (fetch) is M05's.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorldLoader } from '../../src/data/world';
import { createSimWorld, type SimWorld } from '../../src/sim/world';
import { prepareWorld, type PreparedWorld, type WorldData } from '../../src/app/matchWorld';

const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/data');
const MANIFEST_URL = 'http://sim.invalid/data/manifest.json';

let cached: Promise<SimWorld> | null = null;
let cachedData: Promise<WorldData> | null = null;
let cachedPrepared: Promise<PreparedWorld> | null = null;

/** The committed world as a SimWorld (loaded once per process; the SimWorld is immutable, so sharing it is safe). */
export function loadRealWorld(dir: string = DATA_DIR): Promise<SimWorld> {
  if (dir === DATA_DIR && cached !== null) return cached;
  const load = (async (): Promise<SimWorld> => {
    const loader = createWorldLoader({
      manifestUrl: MANIFEST_URL,
      readBytes: async (url: string): Promise<Uint8Array> => new Uint8Array(fs.readFileSync(path.join(dir, decodeURIComponent(new URL(url).pathname.replace(/^\/data\//, ''))))),
    });
    const [sim, meta] = await Promise.all([loader.loadSim(), loader.loadMeta()]);
    return createSimWorld({ width: sim.width, height: sim.height, terrainClass: sim.terrainClass, meanElev: sim.meanElev, cosQ15: meta.sim.cosQ15 });
  })();
  if (dir === DATA_DIR) cached = load;
  return load;
}

/** The committed world with the layers the match setup needs (country ids, coast flags, the country table and the overrides), loaded once per process. */
export function loadRealWorldData(dir: string = DATA_DIR): Promise<WorldData> {
  if (dir === DATA_DIR && cachedData !== null) return cachedData;
  const load = (async (): Promise<WorldData> => {
    const loader = createWorldLoader({
      manifestUrl: MANIFEST_URL,
      readBytes: async (url: string): Promise<Uint8Array> => new Uint8Array(fs.readFileSync(path.join(dir, decodeURIComponent(new URL(url).pathname.replace(/^\/data\//, ''))))),
    });
    const [sim, meta, overrides] = await Promise.all([loader.loadSim(), loader.loadMeta(), loader.loadOverrides()]);
    return {
      sim: { width: sim.width, height: sim.height, terrainClass: sim.terrainClass, meanElev: sim.meanElev, cosQ15: meta.sim.cosQ15 },
      country: sim.country,
      coast: sim.coast,
      meta,
      overrides,
    };
  })();
  if (dir === DATA_DIR) cachedData = load;
  return load;
}

/** The same, prepared for `createMatch` (per-country statistics; the region analyses are cached inside the object). */
export function loadPreparedWorld(): Promise<PreparedWorld> {
  if (cachedPrepared === null) cachedPrepared = loadRealWorldData().then(prepareWorld);
  return cachedPrepared;
}
