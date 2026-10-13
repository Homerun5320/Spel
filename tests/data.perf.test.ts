// CPU budget of the data loader in Node: load and parse all packs and JSON files, checksums verified.
// Statistic: median of 5 loads after 2 warm-ups. Target 300 ms; the asserted budget is budgetMs(1500).
import { describe, expect, it } from 'vitest';
import { budgetMs, median } from './perfguard';
import { worldLoader } from './helpers/dataFiles';

async function loadAllOnce(): Promise<number> {
  const t0 = performance.now();
  const w = worldLoader();
  await Promise.all([w.loadSim(), w.loadRender(), w.loadMeta(), w.loadCities(), w.loadPorts(), w.loadOverrides()]);
  return performance.now() - t0;
}

describe('data load + parse (Node)', () => {
  it('median of 5 loads is within budgetMs(1500)', async () => {
    for (let i = 0; i < 2; i++) await loadAllOnce();
    const runs: number[] = [];
    for (let i = 0; i < 5; i++) runs.push(await loadAllOnce());
    const m = median(runs);
    console.log(`[data.perf] Node load + parse: ${runs.map((r) => r.toFixed(0)).join(' ')} ms, median ${m.toFixed(0)} ms (target 300 ms, budget ${budgetMs(1500).toFixed(0)} ms)`);
    expect(m).toBeLessThanOrEqual(budgetMs(1500));
  });
});
