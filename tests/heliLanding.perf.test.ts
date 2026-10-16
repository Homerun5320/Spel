// CPU budget of the beachhead machinery (M12a-3; perf project). 12 helicopters in the air and 4 cut-off beachheads on a 1024x512 world with 12 players:
// (1) one tick of the helicopter phase with the cut-off cache dirty every tick (worst case: it is rebuilt each tick), (2) the check of all four beachheads
// (a bounded search from each seed) at once, which the real phase does only every 10th tick. Budgets go through budgetMs (tests/perfguard.ts);
// statistic: median of 200 runs after 50 warm-ups.
import { describe, expect, it } from 'vitest';
import { cutOffWeightOf } from '../src/sim/beachheadCluster';
import { ownedStdAreaQ15 } from '../src/sim/economy';
import { beachheadPhase } from '../src/sim/heliLanding';
import { heliPhase } from '../src/sim/heliPhase';
import { BEACH_CUT_OFF, HELI_CRUISE, cellCentreQ8 } from '../src/sim/heliTable';
import { HELI_FUEL_MAX_Q8, HELI_HP_TENTHS, HELI_ROUTE_CAPACITY } from '../src/sim/rules';
import { createState, type GameState } from '../src/sim/state';
import { STRUCT_FACTORY } from '../src/sim/structureRules';
import { setOwner } from '../src/sim/territory';
import { CLASS_PLAINS } from '../src/sim/terrain';
import { budgetMs, measureMedianMs } from './perfguard';

const W = 1024;
const H = 512;

function world(): GameState {
  const terrain = new Uint8Array(W * H);
  terrain.fill(CLASS_PLAINS, 200 * W, 300 * W);
  const mean = new Uint16Array(W * H).fill(40);
  const max = new Int16Array(W * H).fill(400);
  const s = createState({ width: W, height: H, seed: 1, seats: 12, terrain, elevation: mean, maxElev: max });
  for (let o = 1; o <= 12; o++) setOwner(s, 250 * W + o * 40, o, 0);
  const factories: number[] = [];
  for (let i = 0; i < 12; i++) factories.push(s.structures.add(STRUCT_FACTORY, 1 + i, (i % 20) * 50 + Math.floor(i / 20) * W * 30 + 7, 0));
  s.tick = 5000;
  for (let i = 0; i < 12; i++) {
    const t = s.helis;
    const h = t.addBuilding(1 + i, factories[i] as number, s.tick, s.tick);
    t.state[h] = HELI_CRUISE;
    t.mode[h] = i & 1;
    const sx = 100 + i * 20;
    const sy = 60 + i * 30;
    t.x[h] = cellCentreQ8(sx);
    t.y[h] = cellCentreQ8(sy);
    t.alt[h] = 400;
    t.hp[h] = HELI_HP_TENTHS;
    t.fuel[h] = HELI_FUEL_MAX_Q8;
    t.routeLen[h] = 2;
    t.routeIdx[h] = 1;
    t.route[h * HELI_ROUTE_CAPACITY] = sy * W + sx;
    t.route[h * HELI_ROUTE_CAPACITY + 1] = sy * W + sx + 700;
    t.stateTick[h] = s.tick;
  }
  // four cut-off beachheads of nine cells, owners 1 to 4, landed now (they revert 450 ticks from now, after the measurement)
  for (let b = 0; b < 4; b++) {
    const cx = 100 + b * 150;
    const cy = 270;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) setOwner(s, (cy + dy) * W + cx + dx, 1 + b, 0);
    s.beachheads.add(1 + b, cy * W + cx, s.tick, BEACH_CUT_OFF);
  }
  return s;
}

describe('beachhead performance', () => {
  it('a helicopter phase with 12 helicopters in the air and 4 beachheads, the cut-off cache rebuilt every tick, takes at most budgetMs(0.5); the check of all four at once too', () => {
    const s = world();
    expect(cutOffWeightOf(s, 1)).toBeGreaterThan(0);
    const tick = measureMedianMs(
      () => {
        s.beachheads.dirty = true; // worst case: some cell changed owner this tick
        ownedStdAreaQ15(s, 1);
        heliPhase(s);
        s.tick++;
      },
      { runs: 200, warmups: 50 },
    );
    const check = measureMedianMs(
      () => {
        for (let b = 0; b < 4; b++) s.beachheads.landTick[b] = s.tick - 10; // every row is due: four searches
        beachheadPhase(s);
      },
      { runs: 200, warmups: 50 },
    );
    console.log(`[landing perf] tick with 12 airborne and 4 beachheads (cache rebuilt) ${(tick * 1000).toFixed(1)} us; the four searches ${(check * 1000).toFixed(1)} us (budget ${(budgetMs(0.5) * 1000).toFixed(0)} us each)`);
    expect(s.beachheads.liveCount).toBe(4);
    expect(tick).toBeLessThanOrEqual(budgetMs(0.5));
    expect(check).toBeLessThanOrEqual(budgetMs(0.5));
  });
});
