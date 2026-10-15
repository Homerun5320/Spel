// Fix-Sim (audit 1): AI build details the mutation audit proved untested: the City fallback when the wanted type finds no place, the order of
// the rich upgrade (lowest level first), the Defense Post threshold, the memory blob round trip, and no build in the spawn phase.
import { describe, expect, it } from 'vitest';
import { MEMORY_FIXED_WORDS, buildMove, createAiMemory, loadMemoryWords, memoryWords, type AiMemory } from '../../src/ai';
import { IdAllocator, REJECT_NONE, withId, type IntentBody } from '../../src/sim/intents';
import { createRng } from '../../src/sim/rng';
import { MILLI_GOLD_PER_GOLD } from '../../src/sim/rules';
import { createState, type GameState } from '../../src/sim/state';
import { CLASS_PLAINS } from '../../src/sim/terrain';
import { applyIntent, step } from '../../src/sim/step';
import { STRUCT_CITY, STRUCT_FACTORY, STRUCT_PORT, STRUCT_POST } from '../../src/sim/structureRules';
import { setOwner } from '../../src/sim/territory';
import { StateView } from '../../src/sim/view';
import { landState } from '../sim/helpers/worlds';

const W = 200;
const H = 100;
const capitalCell = 50 * W + 50;

/** Seat 0 (ownerId 1) owns the west half of a landlocked open plain and has spawned at (50, 50); seat 1 holds the east. */
function plain(gold: number, spawnPhase = false): { state: GameState; view: StateView; memory: AiMemory; rng: Uint32Array } {
  const state = spawnPhase
    ? createState({ width: W, height: H, seed: 1, seats: 2, players: 2, config: { spawnPhase: true }, terrain: new Uint8Array(W * H).fill(CLASS_PLAINS), elevation: new Uint16Array(W * H) })
    : landState(W, H, { seats: 2, players: 2 });
  for (let c = 0; c < state.grid.cells; c++) setOwner(state, c, c % W < 100 ? 1 : 2, 0);
  state.capital[1] = capitalCell + 1;
  state.gold[1] = gold * MILLI_GOLD_PER_GOLD;
  state.troops[1] = 1000;
  const view = new StateView(state);
  return { state, view, memory: createAiMemory(view, 0, { humanSeats: [] }), rng: createRng(7) };
}

describe('the AI City fallback', () => {
  it('a landlocked seat that wants a Port builds a City instead, so it never stalls: City, City, Factory, City, City, Factory', () => {
    const { state, view, memory, rng } = plain(1000000);
    const alloc = new IdAllocator();
    const types: number[] = [];
    for (let t = 0; t < 3000 && types.length < 6; t++) {
      view.refresh();
      const b = buildMove(view, memory, rng);
      if (b !== null) {
        expect(applyIntent(state, withId(b, alloc.alloc(0)))).toBe(REJECT_NONE);
        if (b.kind === 'Build') types.push((b as Extract<IntentBody, { kind: 'Build' }>).type);
      }
      step(state, { turn: state.tick, intents: [] });
    }
    expect(types).toEqual([STRUCT_CITY, STRUCT_CITY, STRUCT_FACTORY, STRUCT_CITY, STRUCT_CITY, STRUCT_FACTORY]);
  });
});

/** Gives the seat finished-or-not structures straight in the table (cells in the far south-west corner of its land, away from the window's busy part). */
function give(state: GameState, counts: Array<[number, number, number]>, tick: number, y0 = 90): void {
  let x = 2;
  for (const [type, n, level] of counts) {
    for (let i = 0; i < n; i++) {
      const id = state.structures.add(type, 1, y0 * W + x, 0);
      state.structures.level[id] = level;
      x += 2;
    }
  }
  state.tick = tick;
}

/** The kind and type of what buildMove asks for with the structures given and a huge purse (unfinished structures at tick 0: no upgrade candidates). */
function wanted(counts: Array<[number, number, number]>): IntentBody | null {
  const p = plain(1000000);
  give(p.state, counts, 0);
  p.view.refresh();
  return buildMove(p.view, p.memory, p.rng);
}

describe('the AI build thresholds', () => {
  it('a Defense Post only from the fourth City and one per four Cities: 7 Cities with 1 Post want a City, 8 want a Post', () => {
    const seven = wanted([[STRUCT_CITY, 7, 1], [STRUCT_FACTORY, 3, 1], [STRUCT_PORT, 2, 1], [STRUCT_POST, 1, 1]]);
    expect(seven).toMatchObject({ kind: 'Build', type: STRUCT_CITY });
    const eight = wanted([[STRUCT_CITY, 8, 1], [STRUCT_FACTORY, 4, 1], [STRUCT_PORT, 3, 1], [STRUCT_POST, 1, 1]]);
    expect(eight).toMatchObject({ kind: 'Build', type: STRUCT_POST });
    const four = wanted([[STRUCT_CITY, 4, 1], [STRUCT_FACTORY, 2, 1], [STRUCT_PORT, 1, 1]]);
    expect(four).toMatchObject({ kind: 'Build', type: STRUCT_POST });
    const three = wanted([[STRUCT_CITY, 3, 1], [STRUCT_FACTORY, 1, 1], [STRUCT_PORT, 1, 1]]);
    expect(three).toMatchObject({ kind: 'Build', type: STRUCT_CITY });
  });

  it('a rich seat upgrades the LOWEST level first, then City before Factory: a level-1 Factory beats a level-2 City', () => {
    const p = plain(1000000);
    give(p.state, [[STRUCT_CITY, 1, 2]], 0, 30);
    const f = p.state.structures.add(STRUCT_FACTORY, 1, 60 * W + 30, 0);
    p.state.structures.level[f] = 1;
    p.state.tick = 1000; // everything finished and idle
    p.view.refresh();
    const move = buildMove(p.view, p.memory, p.rng);
    expect(move).toMatchObject({ kind: 'Upgrade', structure: f });
  });

  it('nobody builds in the spawn phase of a match (the phase of the view, not only the tribe flag)', () => {
    const p = plain(1000000, true);
    for (let t = 0; t < 40; t++) {
      p.view.refresh();
      expect(p.view.phase).toBe(0);
      expect(buildMove(p.view, p.memory, p.rng)).toBeNull();
      p.state.tick++;
    }
  });
});

describe('the AI memory blob', () => {
  it('round trips every field including buildRetryAt, and a wrong length is refused', () => {
    const p = plain(0);
    const a = createAiMemory(p.view, 0, { humanSeats: [] });
    a.release = 11;
    a.retryAt = 22;
    a.attempts = 3;
    a.buildRetryAt = 444;
    a.builds = 5;
    a.lastAttack.fill(-1);
    a.lastAttack[1] = 99;
    const words = memoryWords(a);
    expect(words.length).toBe(MEMORY_FIXED_WORDS + a.lastAttack.length);
    const b = createAiMemory(p.view, 0, { humanSeats: [] });
    expect(loadMemoryWords(b, words)).toBe(true);
    expect([b.release, b.retryAt, b.attempts, b.buildRetryAt, b.builds]).toEqual([11, 22, 3, 444, 5]);
    expect(Array.from(b.lastAttack)).toEqual(Array.from(a.lastAttack));
    expect(loadMemoryWords(b, words.slice(1))).toBe(false);
    expect(loadMemoryWords(b, new Int32Array(words.length + 1))).toBe(false);
  });
});
