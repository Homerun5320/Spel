// CPU budget of the helicopter table (M12a-1; perf project). The table adds one phase to every tick (finished production) and one check per
// ProduceHeli; with 12 helicopters in the table, 300 finished structures and 12 players a step must cost what a step without helicopters costs.
// Budgets go through budgetMs (tests/perfguard.ts); never a bare ms limit. Statistic: median of 200 runs after 50 warm-ups.
import { describe, expect, it } from 'vitest';
import { heliPhase } from '../src/sim/heliPhase';
import { HELI_BUILDING, HELI_CRUISE, HELI_PAD } from '../src/sim/heliTable';
import { checkProduceHeli } from '../src/sim/heliRules';
import { step } from '../src/sim/step';
import { createEmptyState, type GameState } from '../src/sim/state';
import { STRUCT_FACTORY, STRUCT_PORT } from '../src/sim/structureRules';
import { setOwner } from '../src/sim/territory';
import { budgetMs, measureMedianMs } from './perfguard';

/** 12 players that hold land, 300 finished structures (a quarter Ports that trade, 25 Factories), 12 helicopters: queued, parked and in the air. */
function world(withHelis: boolean): GameState {
  const s = createEmptyState(1024, 512, 1, 12);
  for (let o = 1; o <= 12; o++) setOwner(s, 100 * 1024 + o * 40, o, 0);
  const factories: number[] = [];
  for (let i = 0; i < 300; i++) {
    const owner = 1 + (i % 12);
    const type = i % 12 === 5 ? STRUCT_FACTORY : i % 4 === 0 ? STRUCT_PORT : 1 + (i % 6);
    const id = s.structures.add(type, owner, (i % 20) * 50 + Math.floor(i / 20) * 1024 * 30 + 7, 0);
    expect(id).toBe(i);
    if (type === STRUCT_FACTORY) factories.push(id);
  }
  s.tick = 5000;
  if (withHelis) {
    for (let i = 0; i < 12; i++) {
      const f = factories[i % factories.length] as number;
      const owner = s.structures.owner[f] as number;
      const h = s.helis.addBuilding(owner, f, s.tick, s.tick + 100000000);
      s.helis.state[h] = i % 3 === 0 ? HELI_BUILDING : i % 3 === 1 ? HELI_PAD : HELI_CRUISE;
    }
    expect(s.helis.liveCount).toBe(12);
  }
  return s;
}

describe('helicopter table performance', () => {
  it('a step with 12 helicopters, 300 finished structures and 12 players takes at most budgetMs(4), and not more than budgetMs(0.5) above the same world without helicopters', () => {
    const [bare, flying] = [world(false), world(true)];
    const budget = budgetMs(4);
    const without = measureMedianMs(() => void step(bare, { turn: bare.tick, intents: [] }), { runs: 200, warmups: 50 });
    const withHelis = measureMedianMs(() => void step(flying, { turn: flying.tick, intents: [] }), { runs: 200, warmups: 50 });
    console.log(`[heli perf] step, 12 players, 300 structures: without helicopters ${(without * 1000).toFixed(1)} us, with 12 ${(withHelis * 1000).toFixed(1)} us (budget ${(budget * 1000).toFixed(0)} us = budgetMs(4), extra budget ${(budgetMs(0.5) * 1000).toFixed(0)} us)`);
    expect(withHelis).toBeLessThanOrEqual(budget);
    expect(withHelis - without).toBeLessThanOrEqual(budgetMs(0.5));
  });

  it('the production phase alone takes at most budgetMs(0.05) with 12 helicopters, and one ProduceHeli check (it scans the structure table) at most budgetMs(0.2)', () => {
    const s = world(true);
    const phase = measureMedianMs(() => heliPhase(s), { runs: 200, warmups: 50 });
    const f = s.helis.factory[1] as number;
    const check = measureMedianMs(() => void checkProduceHeli(s, 1_000_000, false, (s.structures.owner[f] as number) - 1, f), { runs: 200, warmups: 50 });
    console.log(`[heli perf] heliPhase with 12 helicopters ${(phase * 1000).toFixed(2)} us (budget ${(budgetMs(0.05) * 1000).toFixed(0)} us), checkProduceHeli ${(check * 1000).toFixed(2)} us (budget ${(budgetMs(0.2) * 1000).toFixed(0)} us)`);
    expect(phase).toBeLessThanOrEqual(budgetMs(0.05));
    expect(check).toBeLessThanOrEqual(budgetMs(0.2));
  });
});
