// CPU budget of the structure table (M09 part A; perf project). The table adds one phase to every tick (finished upgrades) and
// nothing else: with 12 players and about 300 structures (some of them upgrading) a step must cost what an empty-world step costs.
// Budgets go through budgetMs (tests/perfguard.ts); never a bare ms limit.
import { describe, expect, it } from 'vitest';
import { step } from '../src/sim/step';
import { createEmptyState } from '../src/sim/state';
import { STRUCT_CITY, STRUCT_PORT, STRUCT_POST } from '../src/sim/structureRules';
import { setOwner } from '../src/sim/territory';
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

  // M09 part B: the effects. 12 players that hold land, about 300 FINISHED structures (a quarter of them Ports that trade), the economy and the
  // cache of the effects in play. The second run makes every step recompute the cache (a build or a conquest on every tick): the worst case.
  function effectsWorld() {
    const s = createEmptyState(1024, 512, 1, 12);
    for (let o = 1; o <= 12; o++) setOwner(s, 100 * 1024 + o * 40, o, 0);
    for (let i = 0; i < 300; i++) {
      const owner = 1 + (i % 12);
      const type = i % 4 === 0 ? STRUCT_PORT : 1 + (i % 6);
      expect(s.structures.add(type, owner, (i % 20) * 50 + Math.floor(i / 20) * 1024 * 30 + 7, 0)).toBe(i);
    }
    s.tick = 5000; // everything is finished
    return s;
  }
  it('a step with 12 players and 300 finished structures takes at most budgetMs(4) (statistic: median of 200 steps after 50 warm-ups), also when every step recomputes the effects', () => {
    const s = effectsWorld();
    const budget = budgetMs(4);
    const calm = measureMedianMs(() => void step(s, { turn: s.tick, intents: [] }), { runs: 200, warmups: 50 });
    const t = effectsWorld();
    const worst = measureMedianMs(
      () => {
        t.structures.effDirty = true;
        step(t, { turn: t.tick, intents: [] });
      },
      { runs: 200, warmups: 50 },
    );
    console.log(`[structures perf] step with 300 finished structures, 12 players: calm median ${(calm * 1000).toFixed(1)} us, recompute every step ${(worst * 1000).toFixed(1)} us (budget ${(budget * 1000).toFixed(0)} us = budgetMs(4))`);
    expect(calm).toBeLessThanOrEqual(budget);
    expect(worst).toBeLessThanOrEqual(budget);
  });
});
