// M18e-1: the AI builds Plants and Labs from what is left after its next wanted structure, not before AI_BUILD_EXTRA_START_TICKS, never beyond the rule limits,
// never an Airfield, and never an intent the sim refuses (20 seeds). The mutants are tabulated in the M18e-1 block of docs/DECISIONS.md.
import { describe, expect, it } from 'vitest';
import { buildMove, createAiMemory, type AiMemory } from '../../src/ai';
import { IdAllocator, REJECT_NONE, withId, type IntentBody } from '../../src/sim/intents';
import { createRng } from '../../src/sim/rng';
import { AI_BUILD_CITIES_PER_LAB, AI_BUILD_CITIES_PER_PLANT, AI_BUILD_EXTRA_START_TICKS, MAX_PER_OWNER_BY_TYPE, MILLI_GOLD_PER_GOLD } from '../../src/sim/rules';
import { type GameState } from '../../src/sim/state';
import { applyIntent, step } from '../../src/sim/step';
import { STRUCT_AIRFIELD, STRUCT_CITY, STRUCT_FACTORY, STRUCT_LAB, STRUCT_PLANT, STRUCT_PORT, STRUCT_POST } from '../../src/sim/structureRules';
import { setOwner } from '../../src/sim/territory';
import { StateView } from '../../src/sim/view';
import { landState } from '../sim/helpers/worlds';

const W = 200;
const H = 100;
const capitalCell = 50 * W + 50;

function plain(seed: number, gold: number): { state: GameState; view: StateView; memory: AiMemory; rng: Uint32Array } {
  const state = landState(W, H, { seats: 2, players: 2 });
  for (let c = 0; c < state.grid.cells; c++) setOwner(state, c, c % W < 100 ? 1 : 2, 0);
  state.capital[1] = capitalCell + 1;
  state.gold[1] = gold * MILLI_GOLD_PER_GOLD;
  state.troops[1] = 1000;
  const view = new StateView(state);
  return { state, view, memory: createAiMemory(view, 0, { humanSeats: [] }), rng: createRng(seed) };
}

/** Gives the seat structures (built at `buildTick`: unfinished when it is just before the test tick, so no upgrade or district is tried) straight in the table (far corner of its land). */
function give(state: GameState, counts: Array<[number, number]>, buildTick: number, y0 = 90): void {
  let x = 2;
  for (const [type, n] of counts) {
    for (let i = 0; i < n; i++) {
      state.structures.add(type, 1, y0 * W + x, buildTick);
      x += 4;
    }
  }
}

function typeOf(b: IntentBody | null): number {
  return b !== null && b.kind === 'Build' ? b.type : 0;
}

describe('the AI Plant and Lab', () => {
  it('a rich seat with 4 Cities, 2 Factories, a Port and a Post wants a Plant after AI_BUILD_EXTRA_START_TICKS and not before', () => {
    expect(AI_BUILD_CITIES_PER_PLANT).toBe(4);
    const probe = plain(7, 1000000);
    let think = AI_BUILD_EXTRA_START_TICKS; // the first think tick of the nation from the threshold on
    while ((think + probe.memory.phase) % 100 !== 0) think++;
    expect(think - 100).toBeLessThan(AI_BUILD_EXTRA_START_TICKS);
    for (const [tick, expected] of [[think - 100, 0], [think, STRUCT_PLANT]] as const) {
      const p = plain(7, 1000000);
      give(p.state, [[STRUCT_CITY, 4], [STRUCT_FACTORY, 2], [STRUCT_PORT, 1], [STRUCT_POST, 1]], tick - 1);
      p.state.tick = tick;
      p.view.refresh();
      const t = typeOf(buildMove(p.view, p.memory, p.rng));
      if (expected === 0) expect(t, `tick ${tick}`).not.toBe(STRUCT_PLANT);
      else expect(t, `tick ${tick}`).toBe(STRUCT_PLANT);
    }
  });

  it('the Plant is placed within PLANT_NEAR_CELLS of a City or Port (the intent is legal), and the Lab wanted at 6 Cities comes when the Plants of the ratio are there', () => {
    const p = plain(11, 1000000);
    give(p.state, [[STRUCT_CITY, 6], [STRUCT_FACTORY, 3], [STRUCT_PORT, 2], [STRUCT_POST, 1], [STRUCT_PLANT, 1]], 2999);
    let think = 3000;
    while ((think + p.memory.phase) % 100 !== 0) think++;
    p.state.tick = think;
    p.view.refresh();
    expect(AI_BUILD_CITIES_PER_LAB).toBe(6);
    // 6 Cities, one Plant (the ratio wants 1 per 4): the Lab is next
    const move = buildMove(p.view, p.memory, p.rng);
    expect(move).toMatchObject({ kind: 'Build', type: STRUCT_LAB });
    expect(applyIntent(p.state, withId(move as IntentBody, 1))).toBe(REJECT_NONE);
  });

  it('never beyond the rule limits and never an Airfield: 20 seeds, 9000 ticks, a huge purse, every Build the AI asks for is accepted by the sim', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { state, view, memory, rng } = plain(seed, 2000000);
      const alloc = new IdAllocator();
      const built = new Uint32Array(10);
      for (let t = 0; t < 9000; t++) {
        view.refresh();
        const b = buildMove(view, memory, rng);
        if (b !== null) {
          expect(applyIntent(state, withId(b, alloc.alloc(0))), `seed ${seed} tick ${t} ${JSON.stringify(b)}`).toBe(REJECT_NONE);
          if (b.kind === 'Build') built[b.type] = (built[b.type] as number) + 1;
        }
        step(state, { turn: state.tick, intents: [] });
      }
      expect(built[STRUCT_AIRFIELD], `seed ${seed}`).toBe(0);
      expect(built[STRUCT_PLANT] as number, `seed ${seed} plants`).toBeLessThanOrEqual(MAX_PER_OWNER_BY_TYPE[STRUCT_PLANT] as number);
      expect(built[STRUCT_LAB] as number, `seed ${seed} labs`).toBeLessThanOrEqual(MAX_PER_OWNER_BY_TYPE[STRUCT_LAB] as number);
      if (seed <= 3) {
        expect(built[STRUCT_PLANT] as number, `seed ${seed} built a Plant`).toBeGreaterThan(0);
        expect(built[STRUCT_LAB] as number, `seed ${seed} built a Lab`).toBeGreaterThan(0);
      }
    }
  }, 120_000);
});
