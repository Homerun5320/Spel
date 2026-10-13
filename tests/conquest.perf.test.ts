// CPU budgets of the conquest (perf project). Wall-clock times go through budgetMs (tests/perfguard.ts); the PRIMARY limit
// of the milestone is the work counters (tests/sim/work.test.ts: cells scanned per tick are proportional to the fronts and
// the changed cells, never a scan of the map). Every statistic is named.
import { describe, expect, it } from 'vitest';
import { startRealMatch } from './helpers/realMatch';
import { budgetMs, median, percentile } from './perfguard';

describe('conquest performance', () => {
  it('a tick of 12 players and 20 tribes on the real world costs at most budgetMs(4) at p95 (statistic: p95 of 400 ticks after 50 warm-up ticks; the bots run outside the timing)', async () => {
    const match = await startRealMatch(1, 12, 20, true);
    const state = match.state;
    const times: number[] = [];
    let scanned = 0;
    let changed = 0;
    let measuredTicks = 0;
    const warmup = 50;
    const measured = 400;
    for (let t = 0; t < warmup + measured; t++) {
      const { ms } = match.tick();
      if (t >= warmup) {
        times.push(ms);
        scanned += state.work.scanned;
        changed += state.work.changed;
        measuredTicks++;
      }
    }
    const p95 = percentile(times, 95);
    const budget = budgetMs(4);
    console.log(
      `[conquest perf] 12 players + 20 tribes, ${measuredTicks} ticks after ${warmup}: p50 ${(median(times) * 1000).toFixed(0)} us, p95 ${(p95 * 1000).toFixed(0)} us, p99 ${(percentile(times, 99) * 1000).toFixed(0)} us, max ${(Math.max(...times) * 1000).toFixed(0)} us (budget p95 <= ${(budget * 1000).toFixed(0)} us = budgetMs(4)); ` +
        `cells scanned per tick ${(scanned / measuredTicks).toFixed(0)}, changed per tick ${(changed / measuredTicks).toFixed(1)}, attacks ${state.attacks.list.length}, owned ${Array.from(state.agg.area).reduce((a, b) => a + b, 0)}`,
    );
    expect(times.length).toBeGreaterThanOrEqual(200);
    expect(p95).toBeLessThanOrEqual(budget);
  });
});
