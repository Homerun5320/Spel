// Districts-1: the AI's district move. It fills free slots of its finished interior Cities (Market, Barracks, Housing, Walls by slot number), then upgrades
// the cheapest district, only when it is rich, never sends an intent the validators refuse (20 seeds), backs off when there is nothing to do, and keeps
// the back-off in its serialised memory.
import { describe, expect, it } from 'vitest';
import { buildMove, createAiMemory, loadMemoryWords, memoryWords, type AiMemory } from '../../src/ai';
import {
  DISTRICT_BARRACKS,
  DISTRICT_HOUSING,
  DISTRICT_MARKET,
  DISTRICT_WALLS,
  districtIndex,
  validateBuildDistrict,
  validateUpgradeDistrict,
} from '../../src/sim/districtRules';
import { IdAllocator, REJECT_NONE, withId, type IntentBody } from '../../src/sim/intents';
import { createRng } from '../../src/sim/rng';
import { AI_DISTRICT_MIN_CITIES, AI_DISTRICT_RETRY_TICKS, MILLI_GOLD_PER_GOLD } from '../../src/sim/rules';
import type { GameState } from '../../src/sim/state';
import { applyIntent, step } from '../../src/sim/step';
import { STRUCT_CITY } from '../../src/sim/structureRules';
import { setOwner } from '../../src/sim/territory';
import { StateView } from '../../src/sim/view';
import { landState } from '../sim/helpers/worlds';

const W = 200;
const H = 100;

function plain(seed: number): { state: GameState; view: StateView; memory: AiMemory; rng: Uint32Array } {
  const state = landState(W, H, { seats: 2, players: 2, seed });
  for (let c = 0; c < state.grid.cells; c++) setOwner(state, c, c % W < 100 ? 1 : 2, 0);
  state.capital[1] = 50 * W + 50 + 1;
  state.troops[1] = 1000;
  state.tick = 1000;
  const view = new StateView(state);
  return { state, view, memory: createAiMemory(view, 0, { humanSeats: [] }), rng: createRng(seed) };
}

/** Three finished interior Cities of the AI (level `level`), far from the border at x = 100. */
function withCities(seed: number, level = 1): ReturnType<typeof plain> {
  const p = plain(seed);
  for (const x of [30, 50, 70]) {
    const id = p.state.structures.add(STRUCT_CITY, 1, 50 * W + x, 0);
    p.state.structures.level[id] = level;
  }
  return p;
}

/** Runs `ticks` ticks with a purse kept at `gold`, applying every move the AI makes; returns the moves. */
function play(p: ReturnType<typeof plain>, ticks: number, gold: number, onMove?: (b: IntentBody) => void): IntentBody[] {
  const alloc = new IdAllocator();
  const moves: IntentBody[] = [];
  for (let t = 0; t < ticks; t++) {
    p.state.gold[1] = gold * MILLI_GOLD_PER_GOLD;
    p.state.troops[1] = 1000;
    p.view.refresh();
    const b = buildMove(p.view, p.memory, p.rng);
    if (b !== null) {
      moves.push(b);
      onMove?.(b);
      expect(applyIntent(p.state, withId(b, alloc.alloc(0))), `${b.kind} at tick ${p.state.tick}`).toBe(REJECT_NONE);
    }
    step(p.state, { turn: p.state.tick, intents: [] });
  }
  return moves;
}

describe('the AI district move', () => {
  it('a rich AI with three Cities fills their slots in the order Market, Barracks (slot 1), then upgrades; the first district is a Market', () => {
    const p = withCities(3);
    const moves = play(p, 400, 100000);
    const districts = moves.filter((m) => m.kind === 'BuildDistrict');
    expect(districts.length).toBeGreaterThanOrEqual(6); // three level 1 Cities, two slots each (and more as the AI builds Cities on the way)
    expect(districts[0]).toMatchObject({ kind: 'BuildDistrict', slot: 0, districtKind: DISTRICT_MARKET });
    for (const d of districts) {
      if (d.kind !== 'BuildDistrict') continue;
      expect(d.districtKind).toBe([DISTRICT_MARKET, DISTRICT_BARRACKS, DISTRICT_HOUSING, DISTRICT_WALLS][d.slot]);
    }
    expect(moves.filter((m) => m.kind === 'UpgradeDistrict').length).toBeGreaterThan(0);
    expect(p.state.structures.districtsOwned(1, DISTRICT_MARKET)).toBeGreaterThanOrEqual(3);
  });

  it('fills the slot of a higher City level with Housing and Walls too, and upgrades the cheapest district first', () => {
    const p = withCities(4, 3);
    const upgrades: Array<{ price: number }> = [];
    play(p, 1500, 400000, (b) => {
      if (b.kind === 'UpgradeDistrict') {
        const kind = p.state.structures.districtKind[districtIndex(b.structure, b.slot)] as number;
        const level = p.state.structures.districtLevel[districtIndex(b.structure, b.slot)] as number;
        upgrades.push({ price: (kind === DISTRICT_MARKET ? 60 : kind === DISTRICT_HOUSING ? 150 : kind === DISTRICT_BARRACKS ? 250 : 300) * (level + 1) });
      }
    });
    const t = p.state.structures;
    for (const k of [DISTRICT_MARKET, DISTRICT_BARRACKS, DISTRICT_HOUSING, DISTRICT_WALLS]) expect(t.districtsOwned(1, k), `kind ${k}`).toBeGreaterThanOrEqual(3);
    expect(upgrades.length).toBeGreaterThan(0);
    // Market upgrades (60 base) come before the dearer kinds: the first upgrade is the cheapest one available at that moment
    expect(upgrades[0]?.price).toBe(120);
  });

  it('does nothing when poor, with fewer than AI_DISTRICT_MIN_CITIES Cities, as a tribe, or with Cities on the border', () => {
    expect(AI_DISTRICT_MIN_CITIES).toBe(3);
    const poor = withCities(5);
    expect(play(poor, 100, 5).filter((m) => m.kind.endsWith('District'))).toEqual([]);
    const few = plain(6);
    for (const x of [30, 50]) few.state.structures.add(STRUCT_CITY, 1, 50 * W + x, 0);
    let early = 0;
    let late = 0;
    play(few, 600, 100000, (b) => {
      if (!b.kind.endsWith('District')) return;
      if (few.state.structures.ownedCount(1, STRUCT_CITY) < AI_DISTRICT_MIN_CITIES) early++;
      else late++;
    });
    expect([early, late > 0]).toEqual([0, true]); // none below three Cities, some once the AI has built the third
    const tribe = withCities(7);
    const asTribe: AiMemory = { ...tribe.memory, tribe: true };
    for (let t = 0; t < 100; t++) {
      tribe.state.gold[1] = 100000 * MILLI_GOLD_PER_GOLD;
      tribe.view.refresh();
      expect(buildMove(tribe.view, asTribe, tribe.rng)).toBeNull();
      step(tribe.state, { turn: tribe.state.tick, intents: [] });
    }
    const border = plain(8);
    for (const x of [97, 98, 99]) border.state.structures.add(STRUCT_CITY, 1, (10 + 20 * (x - 97)) * W + x, 0); // x = 99 touches the enemy at x = 100
    const kinds = play(border, 200, 100000).filter((m) => m.kind.endsWith('District'));
    for (const k of kinds) {
      const cell = border.state.structures.cell[(k as { structure: number }).structure] as number;
      expect(cell % W, 'a border City gets no district').toBeLessThan(99);
    }
  });

  it('a think with nothing to do backs off for AI_DISTRICT_RETRY_TICKS and the back-off survives the memory round trip', () => {
    const p = withCities(9, 3);
    p.state.tick = 1000;
    // level 3 Cities (no City upgrade to buy) with every slot full at the top level: nothing left to build or upgrade
    for (const id of [0, 1, 2]) {
      p.state.structures.level[id] = 3;
      for (let slot = 0; slot < 4; slot++) p.state.structures.setDistrict(id, slot, 1 + slot, 3, 100, 0);
    }
    let move: IntentBody | null = null;
    let first = -1;
    for (let t = 0; t < 12 && first < 0; t++) {
      p.state.gold[1] = 100000 * MILLI_GOLD_PER_GOLD;
      p.view.refresh();
      move = buildMove(p.view, p.memory, p.rng);
      if (p.memory.districtRetryAt > 0) first = p.state.tick;
      step(p.state, { turn: p.state.tick, intents: [] });
    }
    expect(first).toBeGreaterThan(0);
    expect(p.memory.districtRetryAt).toBe(first + AI_DISTRICT_RETRY_TICKS);
    void move;
    const words = memoryWords(p.memory);
    const other = createAiMemory(p.view, 0, { humanSeats: [] });
    expect(loadMemoryWords(other, words)).toBe(true);
    expect(other.districtRetryAt).toBe(p.memory.districtRetryAt);
  });

  it('never sends an intent the validators refuse: 20 seeds, a varying purse, Cities that get conquered and rebuilt under it', () => {
    let districtMoves = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const p = withCities(seed, 1 + (seed % 3));
      const alloc = new IdAllocator();
      for (let t = 0; t < 700; t++) {
        // a purse that swings between poor and rich, and an enemy that takes a City cell now and then (a random one of the three)
        p.state.gold[1] = (((seed * 7 + t * 13) % 11) * 90 + 50) * MILLI_GOLD_PER_GOLD;
        if (t % 211 === 200) setOwner(p.state, 50 * W + [30, 50, 70][seed % 3]!, 2, 0);
        if (t % 211 === 5) setOwner(p.state, 50 * W + [30, 50, 70][seed % 3]!, 1, 0);
        p.view.refresh();
        const b = buildMove(p.view, p.memory, p.rng);
        if (b !== null) {
          if (b.kind === 'BuildDistrict') {
            districtMoves++;
            expect(validateBuildDistrict(p.view, 0, b.structure, b.slot, b.districtKind), `seed ${seed} tick ${t}`).toBe(REJECT_NONE);
          } else if (b.kind === 'UpgradeDistrict') {
            districtMoves++;
            expect(validateUpgradeDistrict(p.view, 0, b.structure, b.slot), `seed ${seed} tick ${t}`).toBe(REJECT_NONE);
          }
          // the sim agrees with the validators one step later: the intent is applied at T + 0 here, so apply it and require success
          expect(applyIntent(p.state, withId(b, alloc.alloc(0))), `seed ${seed} tick ${t} ${b.kind}`).toBe(REJECT_NONE);
        }
        step(p.state, { turn: p.state.tick, intents: [] });
      }
    }
    expect(districtMoves).toBeGreaterThan(100);
  });
});
