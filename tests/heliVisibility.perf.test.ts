// CPU budget of the helicopter visibility mask (M17-pre; perf project). 12 viewers, 64 helicopters in the air (half Low, half High) over a world with 3 SAM sites per
// viewer; the tick moves between samples so every sample is a fresh computation of all 12 rows (the Los sync included). Statistic: median of 40 samples after 5 warm-ups,
// at most budgetMs(0.5) (tests/perfguard.ts).
import { describe, expect, it } from 'vitest';
import { HELI_HOVER, cellCentreQ8 } from '../src/sim/heliTable';
import { HeliVisibility } from '../src/sim/heliVisibility';
import { HELI_CAPACITY, HELI_FUEL_MAX_Q8, HELI_HP_TENTHS } from '../src/sim/rules';
import { createState, type GameState } from '../src/sim/state';
import { STRUCT_FACTORY, STRUCT_SAM } from '../src/sim/structureRules';
import { CLASS_PLAINS } from '../src/sim/terrain';
import { budgetMs } from './perfguard';

const W = 1024;
const H = 512;
const PLAYERS = 12;

function world(): GameState {
  const terrain = new Uint8Array(W * H);
  terrain.fill(CLASS_PLAINS, 200 * W, 300 * W);
  const s = createState({ width: W, height: H, seed: 9, seats: PLAYERS, terrain, elevation: new Uint16Array(W * H).fill(40), maxElev: new Int16Array(W * H).fill(400) });
  s.tick = 5000;
  for (let o = 1; o <= PLAYERS; o++) {
    for (let k = 0; k < 3; k++) {
      const sam = s.structures.add(STRUCT_SAM, o, (205 + ((o * 7 + k * 13) % 90)) * W + 40 + o * 70 + k * 15, 0);
      s.structures.readyTick[sam] = 0;
    }
  }
  const factory = s.structures.add(STRUCT_FACTORY, 1, 250 * W + 300, 0);
  s.structures.readyTick[factory] = 0;
  for (let i = 0; i < HELI_CAPACITY; i++) {
    const h = s.helis.addBuilding(1 + (i % PLAYERS), factory, s.tick, s.tick);
    const t = s.helis;
    t.state[h] = HELI_HOVER;
    t.mode[h] = i & 1;
    t.x[h] = cellCentreQ8(60 + ((i * 37) % 900));
    t.y[h] = cellCentreQ8(205 + ((i * 11) % 90));
    t.alt[h] = 400;
    t.hp[h] = HELI_HP_TENTHS;
    t.fuel[h] = HELI_FUEL_MAX_Q8;
    t.stateTick[h] = s.tick;
  }
  return s;
}

describe('helicopter visibility performance', () => {
  it('the mask of 64 helicopters for 12 viewers takes at most budgetMs(0.5) (median of 40 samples after 5 warm-ups)', () => {
    const s = world();
    const vis = new HeliVisibility(s);
    let seen = 0;
    const samples: number[] = [];
    for (let i = 0; i < 45; i++) {
      s.tick++;
      const t0 = performance.now();
      for (let seat = 0; seat < PLAYERS; seat++) seen += vis.sight(seat).count;
      const dt = performance.now() - t0;
      if (i >= 5) samples.push(dt);
    }
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)] as number;
    console.log(`heli visibility: median ${median.toFixed(3)} ms for ${PLAYERS} viewers x ${HELI_CAPACITY} helicopters (budget ${budgetMs(0.5).toFixed(2)} ms)`);
    expect(seen).toBeGreaterThan(PLAYERS * 5); // each viewer at least sees its own five or six
    expect(median).toBeLessThanOrEqual(budgetMs(0.5));
  });
});
