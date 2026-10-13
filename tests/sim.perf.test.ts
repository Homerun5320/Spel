// CPU budget of the simulation (perf project). Budgets go through budgetMs (tests/perfguard.ts); never a bare ms limit.
import { describe, expect, it } from 'vitest';
import { hashState, serialize } from '../src/sim/serialize';
import { createEmptyState } from '../src/sim/state';
import { step } from '../src/sim/step';
import { budgetMs, measureMedianMs } from './perfguard';

describe('sim performance', () => {
  const state = createEmptyState(1024, 512, 1, 8);

  it('an empty-world step at 1024x512 takes at most budgetMs(1) (statistic: median of 101 single steps after 2 warm-ups)', () => {
    const ms = measureMedianMs(() => void step(state, { turn: state.tick, intents: [] }), { runs: 101, warmups: 2 });
    const budget = budgetMs(1);
    console.log(`[sim perf] empty step at 1024x512: median ${(ms * 1000).toFixed(1)} us (budget ${(budget * 1000).toFixed(0)} us = budgetMs(1))`);
    expect(ms).toBeLessThanOrEqual(budget);
  });

  it('a step with 64 DebugPaints stays within the same budget (the cost is per intent, not per cell)', () => {
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
    expect(ms).toBeLessThanOrEqual(budgetMs(1));
  });

  it('logs the cost of hash and serialize at 1024x512 (not asserted: they run at checkpoints, not every tick)', () => {
    const hashMs = measureMedianMs(() => void hashState(state), { runs: 5, warmups: 2 });
    const serMs = measureMedianMs(() => void serialize(state), { runs: 5, warmups: 2 });
    console.log(`[sim perf] hashState ${hashMs.toFixed(2)} ms, serialize ${serMs.toFixed(2)} ms at 1024x512`);
    expect(hashMs).toBeGreaterThan(0);
  });
});
