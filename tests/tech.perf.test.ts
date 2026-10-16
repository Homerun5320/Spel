// CPU budget of the technology (M18d-1; perf project). 12 players that hold land and have researched ALL 16 techs, 60 finished structures (Cities, Factories, Ports, Posts), the economy
// and the cached effects in play. The tech phase and the effect percents must cost next to nothing: one step stays within budgetMs(0.5) (statistic: median of 200 steps after 50
// warm-ups), and so does the worst case in which every step recomputes the structure effects.
import { describe, expect, it } from 'vitest';
import { step } from '../src/sim/step';
import { createEmptyState } from '../src/sim/state';
import { STRUCT_CITY, STRUCT_FACTORY, STRUCT_PORT, STRUCT_POST } from '../src/sim/structureRules';
import { setOwner } from '../src/sim/territory';
import { TECH_ALL_MASK } from '../src/sim/techTable';
import { budgetMs, measureMedianMs } from './perfguard';

function world() {
  const s = createEmptyState(1024, 512, 1, 12);
  for (let o = 1; o <= 12; o++) {
    setOwner(s, 100 * 1024 + o * 40, o, 0);
    s.match.setTechMask(o, TECH_ALL_MASK);
  }
  for (let i = 0; i < 60; i++) {
    const owner = 1 + (i % 12);
    const cell = (i % 12) * 80 + Math.floor(i / 12) * 1024 * 30 + 7;
    const type = [STRUCT_CITY, STRUCT_FACTORY, STRUCT_PORT, STRUCT_POST][i % 4] as number;
    s.structures.add(type, owner, cell, 0);
  }
  s.tick = 5000;
  return s;
}

describe('technology performance', () => {
  it('a step with 12 players that have researched everything takes at most budgetMs(0.5) (median of 200 steps after 50 warm-ups), also when every step recomputes the structure effects', () => {
    const s = world();
    for (let o = 1; o <= 12; o++) expect(s.match.fx(o, 0)).toBe(20);
    const budget = budgetMs(0.5);
    const calm = measureMedianMs(() => void step(s, { turn: s.tick, intents: [] }), { runs: 200, warmups: 50 });
    const t = world();
    const worst = measureMedianMs(
      () => {
        t.structures.effDirty = true;
        step(t, { turn: t.tick, intents: [] });
      },
      { runs: 200, warmups: 50 },
    );
    console.log(`[tech perf] step with 12 players, all techs, 60 structures: calm median ${(calm * 1000).toFixed(1)} us, recompute every step ${(worst * 1000).toFixed(1)} us (budget ${(budget * 1000).toFixed(0)} us = budgetMs(0.5))`);
    expect(calm).toBeLessThanOrEqual(budget);
    expect(worst).toBeLessThanOrEqual(budget);
  });
});
