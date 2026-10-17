// CPU budgets of the conquest (perf project). Wall-clock times go through budgetMs (tests/perfguard.ts); the PRIMARY limit
// of the milestone is the work counters (tests/sim/work.test.ts: cells scanned per tick are proportional to the fronts and
// the changed cells, never a scan of the map). Every statistic is named.
import { describe, expect, it } from 'vitest';
import { applyAttack } from '../src/sim/conquest';
import { step } from '../src/sim/step';
import { createState, type GameState } from '../src/sim/state';
import { setOwner } from '../src/sim/territory';
import { BURST_ROW_WEIGHT, makeBurstState } from './helpers/burstWorld';
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
    // the typical tick as well: a pass over the map in every tick would show here long before it moves the p95
    expect(median(times)).toBeLessThanOrEqual(budgetMs(1));
  });
});

/** A world of `width` x `height` Plains where owner 1 holds two columns of `front` rows and attacks free land with an enormous pool: the same local work on a world of any size. */
function frontWorld(width: number, height: number, front: number): GameState {
  const s = createState({
    width,
    height,
    seed: 1,
    seats: 4,
    terrain: new Uint8Array(width * height).fill(2),
    elevation: new Uint16Array(width * height),
    rowCos: new Uint16Array(height).fill(BURST_ROW_WEIGHT),
  });
  for (let y = 0; y < front; y++) for (let x = 0; x < 2; x++) setOwner(s, y * width + x, 1, 0);
  s.troops[1] = 4000000000;
  if (applyAttack(s, 0, 0, 100) !== 0) throw new Error('the attack was refused');
  s.outbox.clear();
  return s;
}

/** Median over `batches` batches of the time of one tick in a batch of `size` ticks (a tick of a quiet world is a few microseconds: timing single ticks would measure the clock). */
function medianTickMs(s: GameState, batches: number, size: number): number {
  const samples: number[] = [];
  for (let b = 0; b < batches; b++) {
    const t0 = performance.now();
    for (let t = 0; t < size; t++) step(s, { turn: s.tick, intents: [] });
    samples.push((performance.now() - t0) / size);
    s.outbox.clear();
  }
  return median(samples);
}

describe('the cost of a tick does not depend on the size of the world (no pass over the map hides behind a work counter)', () => {
  it('an idle 1024x512 world (no attack, no candidate queued) steps in at most budgetMs(0.1) (statistic: median of 40 batches of 10 ticks after 100 warm-up ticks) and scans 0 cells', () => {
    const s = makeBurstState();
    s.attacks.list.length = 0;
    s.attacks.reindex();
    for (let t = 0; t < 100; t++) step(s, { turn: s.tick, intents: [] }); // warm-up, and the strip's own enclave candidates drain
    expect(s.enclaves.length).toBe(0);
    for (let t = 0; t < 200; t++) {
      step(s, { turn: s.tick, intents: [] });
      expect(s.work.scanned).toBe(0);
    }
    const m = medianTickMs(s, 40, 10);
    const budget = budgetMs(0.1);
    console.log(`[conquest perf] idle 1024x512: median tick ${(m * 1000).toFixed(1)} us (budget <= ${(budget * 1000).toFixed(0)} us = budgetMs(0.1))`);
    expect(m).toBeLessThanOrEqual(budget);
  });

  it('the same local conquest (a front of 64 rows, an attack in progress) costs at most 3 times as much per tick on 1024x512 as on 256x128 (statistic: median of 40 batches of 10 ticks after 100 warm-up ticks, ratio of the two medians)', () => {
    const small = frontWorld(256, 128, 64);
    const big = frontWorld(1024, 512, 64);
    for (let t = 0; t < 100; t++) {
      step(small, { turn: small.tick, intents: [] });
      step(big, { turn: big.tick, intents: [] });
    }
    // the work is the same on both: count it (the primary limit) before timing it
    const a = small.agg.area[1] as number;
    const b = big.agg.area[1] as number;
    const ms = medianTickMs(small, 40, 10);
    const mb = medianTickMs(big, 40, 10);
    const grown = ((small.agg.area[1] as number) - a) / 400;
    expect(Math.abs(((big.agg.area[1] as number) - b) / 400 - grown)).toBeLessThan(0.5 * grown + 0.2); // the same captures per tick, give or take the luck of the hash
    const ratio = mb / ms;
    console.log(`[conquest perf] front of 64 rows: median tick ${(ms * 1000).toFixed(1)} us on 256x128, ${(mb * 1000).toFixed(1)} us on 1024x512, ratio ${ratio.toFixed(2)} (limit 3); captures per tick ${grown.toFixed(2)}`);
    expect(ratio).toBeLessThanOrEqual(3);
  });
});
