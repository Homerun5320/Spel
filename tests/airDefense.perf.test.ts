// CPU budget of the air defence (M12b; perf project). 12 helicopters in the air (6 Low, 6 High, hovering over the defended ground) and 40 air-defence
// structures (28 SAM sites, 12 Defense Posts) of the other seat: one `airDefensePhase` per tick, spatial hash rebuilt each tick, the engagement checks, the kills.
// Statistic: median of 200 ticks after 50 warm-ups, at most budgetMs(0.5) (tests/perfguard.ts). The state is put back between ticks OUTSIDE the timed call.
import { describe, expect, it } from 'vitest';
import { airDefensePhase } from '../src/sim/airDefense';
import { HELI_HOVER, cellCentreQ8 } from '../src/sim/heliTable';
import { HELI_FUEL_MAX_Q8, HELI_HP_TENTHS } from '../src/sim/rules';
import { createState, type GameState } from '../src/sim/state';
import { STRUCT_FACTORY, STRUCT_POST, STRUCT_SAM } from '../src/sim/structureRules';
import { CLASS_PLAINS } from '../src/sim/terrain';
import { setOwner } from '../src/sim/territory';
import { budgetMs } from './perfguard';

const W = 1024;
const H = 512;

function world(): GameState {
  const terrain = new Uint8Array(W * H);
  terrain.fill(CLASS_PLAINS, 200 * W, 300 * W);
  const mean = new Uint16Array(W * H).fill(40);
  const max = new Int16Array(W * H).fill(400);
  const s = createState({ width: W, height: H, seed: 9, seats: 2, terrain, elevation: mean, maxElev: max });
  for (let o = 1; o <= 2; o++) setOwner(s, 250 * W + o * 300, o, 0);
  s.tick = 5000;
  for (let i = 0; i < 40; i++) {
    const type = i < 28 ? STRUCT_SAM : STRUCT_POST;
    const id = s.structures.add(type, 2, (215 + (i % 4) * 20) * W + 100 + Math.floor(i / 4) * 40, 0);
    s.structures.readyTick[id] = 0;
  }
  const factory = s.structures.add(STRUCT_FACTORY, 1, 250 * W + 300, 0);
  s.structures.readyTick[factory] = 0;
  for (let i = 0; i < 12; i++) {
    const h = s.helis.addBuilding(1, factory, s.tick, s.tick);
    place(s, h, i);
  }
  return s;
}

function place(s: GameState, h: number, i: number): void {
  const t = s.helis;
  t.state[h] = HELI_HOVER;
  t.mode[h] = i & 1;
  t.x[h] = cellCentreQ8(110 + (i % 6) * 60);
  t.y[h] = cellCentreQ8(225 + Math.floor(i / 6) * 40);
  t.alt[h] = 400;
  t.hp[h] = HELI_HP_TENTHS;
  t.fuel[h] = HELI_FUEL_MAX_Q8;
  t.stateTick[h] = s.tick;
}

describe('air defence performance', () => {
  it('one airDefensePhase with 12 helicopters in the air and 40 air-defence structures takes at most budgetMs(0.5) (median of 200 ticks after 50 warm-ups)', () => {
    const s = world();
    airDefensePhase(s); // builds the lazy Los (and its masks): a one-off, not a per-tick cost
    const samples: number[] = [];
    let engaged = 0;
    for (let i = 0; i < 250; i++) {
      for (let h = 0; h < 12; h++) place(s, h, h); // all 12 alive and in place again, the salvo clocks run on
      const t0 = performance.now();
      airDefensePhase(s);
      const t1 = performance.now();
      s.tick++;
      if (i >= 50) samples.push(t1 - t0);
      for (let id = 0; id < s.structures.highWater; id++) if ((s.structures.salvoTick[id] as number) > s.tick) engaged++;
    }
    samples.sort((a, b) => a - b);
    const median = samples[samples.length >> 1] as number;
    console.log(`[air defence perf] 12 helicopters, 40 structures: median ${(median * 1000).toFixed(1)} us (budget ${(budgetMs(0.5) * 1000).toFixed(0)} us = budgetMs(0.5))`);
    expect(samples.length).toBe(200);
    expect(engaged).toBeGreaterThan(0); // the structures really were working
    expect(median).toBeLessThanOrEqual(budgetMs(0.5));
  });
});
