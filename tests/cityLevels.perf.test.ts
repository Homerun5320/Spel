// CPU budget of the dense world (Sim-Growth; perf project). 12 players that hold land, 600 FINISHED structures at the new spacing (300 Cities of levels 1 to 10 with
// the districts their level has, 100 Factories, 100 Ports, 100 Posts), the economy and the effects cache in play. The second run makes every step recompute
// the cache (a build or a conquest on every tick): the worst case. Budgets go through budgetMs (tests/perfguard.ts); the statistic is the median of 200 steps
// after 50 warm-ups.
import { describe, expect, it } from 'vitest';
import { DISTRICT_SLOTS_BY_LEVEL } from '../src/sim/rules';
import { step } from '../src/sim/step';
import { createEmptyState } from '../src/sim/state';
import { STRUCT_CITY, STRUCT_FACTORY, STRUCT_PORT, STRUCT_POST } from '../src/sim/structureRules';
import { setOwner } from '../src/sim/territory';
import { budgetMs, measureMedianMs } from './perfguard';

function world() {
  const s = createEmptyState(1024, 512, 1, 12);
  for (let o = 1; o <= 12; o++) setOwner(s, 100 * 1024 + o * 40, o, 0);
  let cities = 0;
  for (let i = 0; i < 600; i++) {
    const owner = 1 + (i % 12);
    // a lattice of pitch 3 cells (the City spacing): 100 columns, six rows
    const cell = (10 + Math.floor(i / 100) * 3) * 1024 + 3 * (i % 100) + 5;
    const type = i % 2 === 0 ? STRUCT_CITY : [STRUCT_FACTORY, STRUCT_PORT, STRUCT_POST][(i >> 1) % 3];
    const id = s.structures.add(type as number, owner, cell, 0);
    expect(id).toBe(i);
    if (type === STRUCT_CITY) {
      const level = 1 + (cities % 10);
      s.structures.level[id] = level;
      for (let slot = 0; slot < (DISTRICT_SLOTS_BY_LEVEL[level] as number); slot++) {
        s.structures.setDistrict(id, slot, 1 + ((cities + slot) % 4), 1 + (slot % 3), 100, (cities + slot) % 5 === 0 ? 100000000 : 0);
      }
      cities++;
    }
  }
  s.tick = 5000;
  return s;
}

describe('dense world performance', () => {
  it('a step with 12 players, 600 finished structures and City levels 1 to 10 with their districts takes at most budgetMs(4) (median of 200 steps after 50 warm-ups), also when every step recomputes the effects', () => {
    const s = world();
    expect(s.structures.liveCount).toBe(600);
    expect(s.structures.districtCount).toBeGreaterThan(600);
    const budget = budgetMs(4);
    const calm = measureMedianMs(() => void step(s, { turn: s.tick, intents: [] }), { runs: 200, warmups: 50 });
    const t = world();
    const worst = measureMedianMs(
      () => {
        t.structures.effDirty = true;
        step(t, { turn: t.tick, intents: [] });
      },
      { runs: 200, warmups: 50 },
    );
    console.log(`[dense perf] step with ${s.structures.liveCount} structures, ${s.structures.districtCount} districts, 12 players: calm median ${(calm * 1000).toFixed(1)} us, recompute every step ${(worst * 1000).toFixed(1)} us (budget ${(budget * 1000).toFixed(0)} us = budgetMs(4))`);
    expect(calm).toBeLessThanOrEqual(budget);
    expect(worst).toBeLessThanOrEqual(budget);
  });
});
