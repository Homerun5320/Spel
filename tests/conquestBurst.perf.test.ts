// The worst case of the conquest, in a file of its own so that the process has nothing else on its heap: 100 000 cells change
// owner in ONE tick. Wall-clock time goes through budgetMs (tests/perfguard.ts); the statistic is named in the test.
import { describe, expect, it } from 'vitest';
import { advanceAttack } from '../src/sim/conquest';
import { seatToOwner, type GameState } from '../src/sim/state';
import { makeBurstState } from './helpers/burstWorld';
import { budgetMs, median } from './perfguard';

describe('conquest burst', () => {
  it('conquering 100 000 cells in ONE tick takes at most budgetMs(50) (statistic: median of 7 runs after 2 warm-ups, each on a fresh 1024x512 world; the world is built outside the timing)', () => {
    const runs = 7;
    const warmups = 2;
    const samples: number[] = [];
    let work = '';
    for (let i = 0; i < warmups + runs; i++) {
      const s: GameState = makeBurstState();
      const a = s.attacks.list[0];
      if (a === undefined) throw new Error('no attack');
      s.work.reset();
      const t0 = performance.now();
      const taken = advanceAttack(s, a, 0, 100000);
      const dt = performance.now() - t0;
      expect(taken).toBe(100000);
      expect(s.agg.area[seatToOwner(0)]).toBe(100000 + 2 * 512);
      if (i >= warmups) samples.push(dt);
      if (i === warmups) work = `popped ${s.work.popped}, pushed ${s.work.pushed}, captured ${s.work.captured}, frontier left ${a.size}`;
    }
    const m = median(samples);
    const budget = budgetMs(50);
    console.log(`[conquest perf] 100 000 cells in one tick: median ${m.toFixed(1)} ms (min ${Math.min(...samples).toFixed(1)}, max ${Math.max(...samples).toFixed(1)}; budget <= ${budget.toFixed(1)} ms = budgetMs(50)); ${work}`);
    expect(m).toBeLessThanOrEqual(budget);
  });
});
