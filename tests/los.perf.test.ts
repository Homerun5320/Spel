// CPU budgets of the LOS masks and the composite (M11a; perf project). Budgets go through budgetMs (tests/perfguard.ts).
// The masks are built lazily inside a query, never in a tick: the tick cost of this module is zero (a test in tests/sim/los.test.ts counts the rebuilds).
import { beforeAll, describe, expect, it } from 'vitest';
import { createLos } from '../src/sim/los/cache';
import { buildMask, maskSide } from '../src/sim/los/mask';
import { createEmptyState } from '../src/sim/state';
import { cellAtLatLon, loadRealLos, type RealLos } from '../tools/sim/losWorld';
import { budgetMs, measureMedianMs } from './perfguard';

let real: RealLos;
beforeAll(async () => {
  real = await loadRealLos();
});

describe('LOS performance', () => {
  it('a mask at R=24 takes at most budgetMs(0.5) and at R=64 at most budgetMs(2) (statistic: median of 15 builds after 5 warm-ups, the Alps site, reused buffer)', () => {
    const site = cellAtLatLon(46.5, 9.5);
    const out24 = new Uint16Array(maskSide(24) ** 2);
    const out64 = new Uint16Array(maskSide(64) ** 2);
    const ms24 = measureMedianMs(() => void buildMask(real.terrain, site, 24, out24), { runs: 15, warmups: 5 });
    const ms64 = measureMedianMs(() => void buildMask(real.terrain, site, 64, out64), { runs: 15, warmups: 5 });
    console.log(`[los perf] mask R=24: median ${ms24.toFixed(3)} ms (budget ${budgetMs(0.5).toFixed(3)}), R=64: ${ms64.toFixed(3)} ms (budget ${budgetMs(2).toFixed(3)})`);
    expect(ms24).toBeLessThanOrEqual(budgetMs(0.5));
    expect(ms64).toBeLessThanOrEqual(budgetMs(2));
  });

  it('200 sites at R=24 (masks and composite from scratch) take at most budgetMs(150) (statistic: median of 7 builds after 2 warm-ups)', () => {
    const state = createEmptyState(1024, 512, 1, 2);
    const src = { tick: 0, structures: state.structures, terrainClass: real.terrainClass };
    const sites: number[] = [];
    for (let i = 0; i < 200; i++) sites.push((60 + (i % 20) * 6 + Math.floor(i / 20) * 7) * 1024 + 100 + ((i * 37) % 800));
    const ms = measureMedianMs(
      () => {
        const los = createLos(real.terrain);
        for (const s of sites) los.addSite(1, s, 24);
        los.sync(src);
      },
      { runs: 7, warmups: 2 },
    );
    console.log(`[los perf] 200 sites R=24: median ${ms.toFixed(1)} ms (budget ${budgetMs(150).toFixed(1)})`);
    expect(ms).toBeLessThanOrEqual(budgetMs(150));
  });

  it('an unchanged site set costs only the scan of the structure table: 1000 queries take at most budgetMs(5) (statistic: median of 7 after 2 warm-ups)', () => {
    const state = createEmptyState(1024, 512, 1, 2);
    const src = { tick: 0, structures: state.structures, terrainClass: real.terrainClass };
    const los = createLos(real.terrain);
    for (let i = 0; i < 100; i++) los.addSite(1, (100 + i) * 1024 + 300, 24);
    los.sync(src);
    const builds = los.maskBuilds;
    const ms = measureMedianMs(
      () => {
        for (let i = 0; i < 1000; i++) {
          los.sync(src);
          los.detected(1, (150 + (i % 40)) * 1024 + 300 + (i % 20), 0);
        }
      },
      { runs: 7, warmups: 2 },
    );
    console.log(`[los perf] 1000 synced queries with 100 sites: median ${ms.toFixed(3)} ms (budget ${budgetMs(5).toFixed(3)})`);
    expect(los.maskBuilds).toBe(builds);
    expect(ms).toBeLessThanOrEqual(budgetMs(5));
  });
});
