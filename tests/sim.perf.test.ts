// CPU budget of the simulation (perf project). Budgets go through budgetMs (tests/perfguard.ts); never a bare ms limit.
//
// The budgets are deliberately tight: they must tell a step that costs O(intents) from one that, by accident, touches
// every cell (a scan of the 524 288 owner cells costs about 330 us, a slice() copy of one array about 260 us, a hashState
// about 2.2 ms on the reference machine). The measured costs are 0.5 us (empty) and 60 us (64 paints).
import { describe, expect, it } from 'vitest';
import { hashState, serialize } from '../src/sim/serialize';
import { createEmptyState } from '../src/sim/state';
import { step } from '../src/sim/step';
import { budgetMs, measureMedianMs } from './perfguard';

describe('sim performance', () => {
  const state = createEmptyState(1024, 512, 1, 8);

  it('an empty-world step at 1024x512 takes at most budgetMs(0.05) = 50 us (statistic: median of 101 single steps after 2 warm-ups)', () => {
    const ms = measureMedianMs(() => void step(state, { turn: state.tick, intents: [] }), { runs: 101, warmups: 2 });
    const budget = budgetMs(0.05);
    console.log(`[sim perf] empty step at 1024x512: median ${(ms * 1000).toFixed(1)} us (budget ${(budget * 1000).toFixed(0)} us = budgetMs(0.05))`);
    expect(ms).toBeLessThanOrEqual(budget);
  });

  it('a step with 64 DebugPaints takes at most budgetMs(0.2) = 200 us (statistic: median of 51 steps after 2 warm-ups; the cost is per intent, not per cell)', () => {
    const s = createEmptyState(1024, 512, 1, 8, { debugIntents: true });
    const make = (): Parameters<typeof step>[1] => ({
      turn: s.tick,
      intents: Array.from({ length: 64 }, (_, i) => ({ kind: 'DebugPaint' as const, seat: i & 7, id: s.tick * 64 + i, cell: (i * 7919) % (1024 * 512) })),
    });
    const ms = measureMedianMs(
      () => {
        step(s, make());
        s.outbox.clear(); // a host drains the outbox after every step
      },
      { runs: 51, warmups: 2 },
    );
    console.log(`[sim perf] step with 64 DebugPaints at 1024x512: median ${(ms * 1000).toFixed(1)} us`);
    expect(ms).toBeLessThanOrEqual(budgetMs(0.2));
  });

  it('logs the cost of hash and serialize at 1024x512 (not asserted: they run at checkpoints, not every tick)', () => {
    const hashMs = measureMedianMs(() => void hashState(state), { runs: 5, warmups: 2 });
    const serMs = measureMedianMs(() => void serialize(state), { runs: 5, warmups: 2 });
    console.log(`[sim perf] hashState ${hashMs.toFixed(2)} ms, serialize ${serMs.toFixed(2)} ms at 1024x512`);
    expect(hashMs).toBeGreaterThan(0);
  });
});
