// CPU budgets of the missiles (M14a; perf project). (1) A synthetic blast over more than 100 000 cells (the whole land block of a 1024x512 world turns neutral): budgetMs(50), median of 5 after
// 2 warm-ups (the world is rebuilt outside the timed part). (2) One whole `step` with 20 missiles in the air on the same world: budgetMs(4), median of 50 after 10 warm-ups, and the missile
// phase alone with the table full: budgetMs(0.05), median of 200 after 50. All through budgetMs (tests/perfguard.ts).
import { describe, expect, it } from 'vitest';
import { MISSILE_CAPACITY } from '../src/sim/rules';
import { blastAt, missilePhase } from '../src/sim/missilePhase';
import { MISSILE_FUSION, MISSILE_TACTICAL } from '../src/sim/missileTable';
import { rebuildAggregates, createState, type GameState } from '../src/sim/state';
import { step } from '../src/sim/step';
import { CLASS_PLAINS } from '../src/sim/terrain';
import { budgetMs, measureMedianMs } from './perfguard';

const W = 1024;
const H = 512;
const at = (x: number, y: number): number => y * W + x;

/** A block of plains 400 x 260 round the equator, all owned by seat 0 (ownerId 1), in a deep sea; seat 1 owns one cell far away. */
function world(): GameState {
  const terrain = new Uint8Array(W * H);
  for (let y = 126; y < 386; y++) for (let x = 312; x < 712; x++) terrain[at(x, y)] = CLASS_PLAINS;
  const s = createState({ width: W, height: H, seed: 1, seats: 2, terrain, elevation: new Uint16Array(W * H) });
  s.tick = 5000;
  return s;
}

function own(s: GameState): void {
  for (let y = 126; y < 386; y++) for (let x = 312; x < 712; x++) s.owner[at(x, y)] = 1;
  s.owner[at(711, 385)] = 2;
  rebuildAggregates(s);
  s.missiles.fallout.fill(0);
  s.missiles.falloutCount = 0;
  s.outbox.clear();
}

describe('missile performance', () => {
  it('a blast over more than 100 000 cells takes at most budgetMs(50) (median of 5)', () => {
    const s = world();
    const samples: number[] = [];
    let changed = 0;
    for (let run = 0; run < 7; run++) {
      own(s);
      const before = s.agg.area[1] as number;
      const t0 = performance.now();
      blastAt(s, 2, 0, MISSILE_FUSION, at(512, 256), 9500, 9600);
      const dt = performance.now() - t0;
      changed = before - (s.agg.area[1] as number);
      if (run >= 2) samples.push(dt);
    }
    samples.sort((a, b) => a - b);
    const median = samples[2] as number;
    console.log(`blast over ${changed} cells: median ${median.toFixed(2)} ms`);
    expect(changed).toBeGreaterThan(100000);
    expect(s.missiles.falloutCount).toBeGreaterThan(100000);
    expect(median).toBeLessThan(budgetMs(50));
  });

  it('a whole step with 20 missiles in the air takes at most budgetMs(4) (median of 50), the missile phase with the table full at most budgetMs(0.05)', () => {
    const s = world();
    own(s);
    for (let i = 0; i < 20; i++) s.missiles.add(i, 1 + (i % 2), MISSILE_TACTICAL, 0, s.tick, s.tick + 100000, at(400, 200 + i), at(600, 200 + i));
    const ms = measureMedianMs(() => void step(s, { turn: s.tick, intents: [] }), { runs: 50, warmups: 10 });
    expect(s.missiles.liveCount).toBe(20);
    expect(s.match.ended, 'the rules really ran').toBe(0);
    console.log(`step with 20 missiles in the air: median ${ms.toFixed(3)} ms`);
    expect(ms).toBeLessThan(budgetMs(4));
    for (let i = 20; i < MISSILE_CAPACITY; i++) s.missiles.add(i, 1, MISSILE_TACTICAL, 0, s.tick, s.tick + 100000, at(400, 200), at(600, 200));
    const phase = measureMedianMs(() => void missilePhase(s), { runs: 200, warmups: 50 });
    console.log(`missile phase, 64 missiles: median ${phase.toFixed(4)} ms`);
    expect(phase).toBeLessThan(budgetMs(0.05));
  });
});
