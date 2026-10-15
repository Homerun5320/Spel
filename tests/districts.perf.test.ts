// CPU budget of the districts (Districts-1; perf project). 12 players that hold land, about 300 FINISHED structures of which 100 are Cities with
// districts of every kind (about 330 districts, some upgrading), the economy and the effects cache in play. The second run makes every step recompute
// the cache (a build or a conquest on every tick): the worst case. Budgets go through budgetMs (tests/perfguard.ts).
import { describe, expect, it } from 'vitest';
import { step } from '../src/sim/step';
import { createEmptyState } from '../src/sim/state';
import { STRUCT_CITY, STRUCT_FACTORY, STRUCT_PORT, STRUCT_POST } from '../src/sim/structureRules';
import { setOwner } from '../src/sim/territory';
import { budgetMs, measureMedianMs } from './perfguard';

function world() {
  const s = createEmptyState(1024, 512, 1, 12);
  for (let o = 1; o <= 12; o++) setOwner(s, 100 * 1024 + o * 40, o, 0);
  let cities = 0;
  for (let i = 0; i < 300; i++) {
    const owner = 1 + (i % 12);
    const cell = (i % 20) * 50 + Math.floor(i / 20) * 1024 * 30 + 7;
    const type = i % 3 === 0 ? STRUCT_CITY : [STRUCT_FACTORY, STRUCT_PORT, STRUCT_POST][i % 3];
    const id = s.structures.add(type as number, owner, cell, 0);
    expect(id).toBe(i);
    if (type === STRUCT_CITY) {
      s.structures.level[id] = 1 + (cities % 3);
      const slots = 2 + (cities % 3);
      for (let slot = 0; slot < slots; slot++) {
        // the upgrade is far in the future for every fifth district, so the phase meets pending work on every tick
        s.structures.setDistrict(id, slot, 1 + ((cities + slot) % 4), 1 + (slot % 2), 100, (cities + slot) % 5 === 0 ? 100000000 : 0);
      }
      cities++;
    }
  }
  s.tick = 5000;
  return s;
}

describe('district performance', () => {
  it('a step with 12 players, 300 finished structures and about 330 districts takes at most budgetMs(4) (statistic: median of 200 steps after 50 warm-ups), also when every step recomputes the effects', () => {
    const s = world();
    expect(s.structures.districtCount).toBeGreaterThan(250);
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
    console.log(`[districts perf] step with ${s.structures.districtCount} districts, 300 structures, 12 players: calm median ${(calm * 1000).toFixed(1)} us, recompute every step ${(worst * 1000).toFixed(1)} us (budget ${(budget * 1000).toFixed(0)} us = budgetMs(4))`);
    expect(calm).toBeLessThanOrEqual(budget);
    expect(worst).toBeLessThanOrEqual(budget);
  });
});
