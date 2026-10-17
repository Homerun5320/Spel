// CPU budget of the helicopter flight (M12a-2; perf project). 12 helicopters in the air on a 1024x512 world with 12 players and 300 finished structures: the
// flight phase and a whole step must cost next to nothing, and the page transfer of the table (signature + snapshot, which changes EVERY tick while they fly)
// is measured. Budgets go through budgetMs (tests/perfguard.ts); statistic: median of 200 runs after 50 warm-ups.
import { describe, expect, it } from 'vitest';
import { heliPhase } from '../src/sim/heliPhase';
import { HELI_CRUISE, cellCentreQ8 } from '../src/sim/heliTable';
import { RELATION_ALLIANCE } from '../src/sim/diplomacyTable';
import { heliSignature, snapshotHelis } from '../src/host/heliSnapshot';
import { HELI_FUEL_MAX_Q8, HELI_HP_TENTHS, HELI_ROUTE_CAPACITY } from '../src/sim/rules';
import { step } from '../src/sim/step';
import { createState, ownerSlots, type GameState } from '../src/sim/state';
import { STRUCT_FACTORY, STRUCT_PORT } from '../src/sim/structureRules';
import { setOwner } from '../src/sim/territory';
import { CLASS_PLAINS } from '../src/sim/terrain';
import { budgetMs, measureMedianMs } from './perfguard';

const W = 1024;
const H = 512;

/** 12 players that hold land, 300 finished structures (25 Factories), 12 helicopters cruising along 150-cell eastward routes over plains with 40 m ridges. */
function world(airborne: boolean): GameState {
  const terrain = new Uint8Array(W * H); // sea, except 100 rows of plains (the playable weight of the whole grid must stay under 2^32)
  terrain.fill(CLASS_PLAINS, 200 * W, 300 * W);
  const mean = new Uint16Array(W * H).fill(40);
  const max = new Int16Array(W * H).fill(400);
  const s = createState({ width: W, height: H, seed: 1, seats: 12, terrain, elevation: mean, maxElev: max });
  for (let o = 1; o <= 12; o++) setOwner(s, 250 * W + o * 40, o, 0);
  const factories: number[] = [];
  for (let i = 0; i < 300; i++) {
    const owner = 1 + (i % 12);
    const type = i % 12 === 5 ? STRUCT_FACTORY : i % 4 === 0 ? STRUCT_PORT : 1 + (i % 6);
    const id = s.structures.add(type, owner, (i % 20) * 50 + Math.floor(i / 20) * W * 30 + 7, 0);
    if (type === STRUCT_FACTORY) factories.push(id);
  }
  // M12b: air defence shoots at hostile helicopters. Alliances make every pair friendly, so the 12 helicopters stay in the air for the whole measurement
  // (what this test measures is the flight phase, not the guns; the guns have their own perf test, tests/airDefense.perf.test.ts).
  for (let a = 1; a <= 12; a++) for (let b = a + 1; b <= 12; b++) s.diplo.setRelation(a, b, RELATION_ALLIANCE, 0);
  s.tick = 5000;
  if (airborne) {
    const t = s.helis;
    for (let i = 0; i < 12; i++) {
      const f = factories[i % factories.length] as number;
      const owner = s.structures.owner[f] as number;
      const h = t.addBuilding(owner, f, s.tick, s.tick);
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
      t.route[h * HELI_ROUTE_CAPACITY + 1] = sy * W + sx + 700; // far away: they stay in the air for the whole measurement
      t.stateTick[h] = s.tick;
    }
  }
  return s;
}

describe('helicopter flight performance', () => {
  it('the flight phase of 12 helicopters in the air takes at most budgetMs(0.5) per tick, a whole step at most budgetMs(0.5) more than without them', () => {
    const [bare, flying] = [world(false), world(true)];
    // the first calls build the lazy Los (a one-off, not a per-tick cost): do them before measuring
    step(flying, { turn: flying.tick, intents: [] });
    step(bare, { turn: bare.tick, intents: [] });
    const phase = measureMedianMs(() => heliPhase(flying), { runs: 200, warmups: 50 });
    const without = measureMedianMs(() => void step(bare, { turn: bare.tick, intents: [] }), { runs: 200, warmups: 50 });
    const withHelis = measureMedianMs(() => void step(flying, { turn: flying.tick, intents: [] }), { runs: 200, warmups: 50 });
    let airborne = 0;
    for (let id = 0; id < flying.helis.highWater; id++) if (flying.helis.state[id] === HELI_CRUISE) airborne++;
    console.log(`[heli perf] flight phase, 12 airborne ${(phase * 1000).toFixed(1)} us (budget ${(budgetMs(0.5) * 1000).toFixed(0)} us = budgetMs(0.5)); step without ${(without * 1000).toFixed(1)} us, with ${(withHelis * 1000).toFixed(1)} us`);
    expect(airborne).toBe(12); // still in the air after all the runs
    expect(phase).toBeLessThanOrEqual(budgetMs(0.5));
    expect(withHelis - without).toBeLessThanOrEqual(budgetMs(0.5));
  });

  it('the page transfer of the helicopter table while all 12 fly (it changes every tick): signature plus snapshot at most budgetMs(0.1)', () => {
    const flying = world(true);
    step(flying, { turn: flying.tick, intents: [] });
    const slots = ownerSlots(flying.header.seats);
    let last = -1;
    let changed = 0;
    const per = measureMedianMs(
      () => {
        step(flying, { turn: flying.tick, intents: [] });
        const sig = heliSignature(flying.helis);
        if (sig !== last) changed++;
        last = sig;
        snapshotHelis(flying.helis, slots);
      },
      { runs: 200, warmups: 50 },
    );
    const only = measureMedianMs(
      () => {
        heliSignature(flying.helis);
        snapshotHelis(flying.helis, slots);
      },
      { runs: 200, warmups: 50 },
    );
    console.log(`[heli perf] signature + snapshot of the table with 12 airborne ${(only * 1000).toFixed(1)} us per frame (budget ${(budgetMs(0.1) * 1000).toFixed(0)} us); the signature changed in ${changed} of 250 steps`);
    expect(changed).toBeGreaterThanOrEqual(240); // it really changes every tick: this is the worst case the prompt asked about
    expect(only).toBeLessThanOrEqual(budgetMs(0.1));
    expect(per).toBeGreaterThan(0);
  });
});
