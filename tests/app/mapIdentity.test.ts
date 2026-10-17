// The map identity of a match (M06fix): the header's mapHash says WHICH map a match was played on. The whole world keeps the pack's hash; every
// Skirmish cut-out is another map (its masked terrain) and must get its own hash: different from the pack's and from every other region's,
// the same on every run, and the one the built match really carries. Before M06fix the only test compared Europe with the plain world, and a
// data source that supplies the pack's hash made a mutant (cut-out keeps the pack hash) invisible.
import { beforeAll, describe, expect, it } from 'vitest';
import { listCountries } from '../../src/app/eligibility';
import { prepareWorld, type PreparedWorld, type WorldData } from '../../src/app/matchWorld';
import { createMatch, matchSetupConfig } from '../../src/app/matchSetup';
import { REGION_IDS, type RegionId } from '../../src/data/regions';
import { hex32 } from '../../src/sim/hash';
import { hashWorld } from '../../src/sim/state';
import { createSimWorld } from '../../src/sim/world';
import { loadPreparedWorld, loadRealWorldData } from '../../tools/sim/realWorld';

let data: WorldData;
let world: PreparedWorld;
beforeAll(async () => {
  data = await loadRealWorldData();
  world = await loadPreparedWorld();
});

/** The hashes of the committed world and its four cut-outs. A change of a rectangle in src/data/regions.ts or of the pack moves them on purpose. */
const PINNED: Record<RegionId, string> = {
  world: '5c837846',
  europe: 'aa95807c',
  eastAsia: '05e894a8',
  americas: '5c1f0bb6',
  africaMiddleEast: 'd6f84fff',
};

const packHash = (d: WorldData): number => {
  const w = createSimWorld(d.sim);
  return hashWorld(w.terrain, w.elevation);
};

describe('every region has its own map identity', () => {
  it('the five hashes are pairwise different', () => {
    const hashes = REGION_IDS.map((r) => world.analyse(r).mapHash);
    expect(new Set(hashes).size).toBe(REGION_IDS.length);
  });

  it('the whole world is the pack (its terrain and elevation hash); no cut-out is', () => {
    const pack = packHash(data);
    expect(world.analyse('world').mapHash).toBe(pack);
    for (const r of REGION_IDS) if (r !== 'world') expect(world.analyse(r).mapHash, r).not.toBe(pack);
  });

  it('is a function of the data only: a second preparation gives the same hashes, equal to the pinned ones', () => {
    const again = prepareWorld(data);
    for (const r of REGION_IDS) {
      expect(again.analyse(r).mapHash, r).toBe(world.analyse(r).mapHash);
      expect(hex32(world.analyse(r).mapHash), r).toBe(PINNED[r]);
    }
  });

  it('the world the analysis hands to the sim carries the same hash', () => {
    for (const r of REGION_IDS) expect(world.analyse(r).world.mapHash, r).toBe(world.analyse(r).mapHash);
  });

  it('a pack that SUPPLIES a hash (the checksum of the sim pack): the whole world keeps it, every cut-out still gets its own', () => {
    const supplied = 0x0badf00d;
    const w = prepareWorld({ ...data, sim: { ...data.sim, mapHash: supplied } });
    expect(w.analyse('world').mapHash).toBe(supplied);
    const seen = new Set<number>([supplied]);
    for (const r of REGION_IDS) {
      if (r === 'world') continue;
      const h = w.analyse(r).mapHash;
      expect(h, r).not.toBe(supplied);
      expect(h, r).toBe(world.analyse(r).mapHash); // the same cut-out hash whoever built the data
      expect(seen.has(h), r).toBe(false);
      seen.add(h);
    }
  });

  it('the cut-out hash follows the terrain: a land cell inside Europe turned into sea moves the Europe hash and the pack hash', () => {
    const terrain = Uint8Array.from(data.sim.terrainClass);
    // Stockholm's cell turned into deep sea
    const stockholm = 89651;
    expect(terrain[stockholm]).toBeGreaterThanOrEqual(2);
    terrain[stockholm] = 0;
    const w = prepareWorld({ ...data, sim: { ...data.sim, terrainClass: terrain } });
    expect(w.analyse('europe').mapHash).not.toBe(world.analyse('europe').mapHash);
    expect(w.analyse('world').mapHash).not.toBe(world.analyse('world').mapHash);
  });
});

describe('the built match carries the identity of its region', () => {
  for (const r of REGION_IDS) {
    it(`${r}: the header's mapHash is the region's, and no two regions share one`, () => {
      const choice = listCountries(world, r).find((x) => x.eligibility.ok);
      expect(choice, `a selectable country in ${r}`).toBeDefined();
      const res = createMatch(world, matchSetupConfig({ kind: 'real', countryId: (choice as { country: { id: number } }).country.id }, { seed: 3, tribes: false, aiNations: 1, region: r }));
      if (!res.ok) throw new Error(`createMatch refused: ${res.error.code}`);
      expect(res.match.state.header.mapHash).toBe(world.analyse(r).mapHash);
    });
  }
});
