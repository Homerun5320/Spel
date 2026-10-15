// CPU budget of the structure table (M09 part A; perf project). The table adds one phase to every tick (finished upgrades) and
// nothing else: with 12 players and about 300 structures (some of them upgrading) a step must cost what an empty-world step costs.
// Budgets go through budgetMs (tests/perfguard.ts); never a bare ms limit.
import { describe, expect, it } from 'vitest';
import { step } from '../src/sim/step';
import { createEmptyState } from '../src/sim/state';
import { STRUCT_CITY, STRUCT_POST } from '../src/sim/structureRules';
import { budgetMs, measureMedianMs } from './perfguard';

describe('structure table performance', () => {
  it('a step at 1024x512 with 12 players and 300 structures takes at most budgetMs(0.05) = 50 us (statistic: median of 200 steps after 50 warm-ups)', () => {
    const s = createEmptyState(1024, 512, 1, 12);
    for (let i = 0; i < 300; i++) {
      const owner = 1 + (i % 12);
      const id = s.structures.add(1 + (i % 6), owner, (i % 20) * 50 + Math.floor(i / 20) * 1024 * 30 + 7, 0);
      expect(id).toBe(i);
      // a third of them are being upgraded far in the future, so the phase meets pending work on every tick
      if (i % 3 === 0) s.structures.upgradeReadyTick[id] = 100000000;
    }
    expect(s.structures.liveCount).toBe(300);
    expect(s.structures.ownedCount(1, STRUCT_CITY) + s.structures.ownedCount(1, STRUCT_POST)).toBeGreaterThan(0);
    const ms = measureMedianMs(() => void step(s, { turn: s.tick, intents: [] }), { runs: 200, warmups: 50 });
    const budget = budgetMs(0.05);
    console.log(`[structures perf] step with 300 structures at 1024x512: median ${(ms * 1000).toFixed(1)} us (budget ${(budget * 1000).toFixed(0)} us = budgetMs(0.05))`);
    expect(ms).toBeLessThanOrEqual(budget);
  });
});
