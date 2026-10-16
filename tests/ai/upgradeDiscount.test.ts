// M18d-2: the AI compares its purse with the price the sim DEBITS (the upgrade price with the seat's researched discount), not with the base price.
// A purse one milli-gold under the base price pays the upgrade once the ECONOMY upgrade techs are researched.
import { describe, expect, it } from 'vitest';
import { buildMove, createAiMemory } from '../../src/ai';
import { createRng } from '../../src/sim/rng';
import { IdAllocator, REJECT_NONE, withId, type IntentBody } from '../../src/sim/intents';
import { BUILD_BASE_GOLD, MILLI_GOLD_PER_GOLD } from '../../src/sim/rules';
import type { GameState } from '../../src/sim/state';
import { applyIntent, step } from '../../src/sim/step';
import { STRUCT_FACTORY } from '../../src/sim/structureRules';
import { setOwner } from '../../src/sim/territory';
import { StateView } from '../../src/sim/view';
import { landState } from '../sim/helpers/worlds';

const W = 200;
const H = 100;
const BASE_MILLI = 2 * (BUILD_BASE_GOLD[STRUCT_FACTORY] as number) * MILLI_GOLD_PER_GOLD;

function ask(mask: number): { body: IntentBody | null; state: GameState; id: number } {
  const state = landState(W, H, { seats: 2, players: 2 });
  for (let c = 0; c < state.grid.cells; c++) setOwner(state, c, c % W < 100 ? 1 : 2, 0);
  state.capital[1] = 50 * W + 50 + 1;
  state.tick = 1000;
  state.troops[1] = 1000;
  state.match.setTechMask(1, mask);
  const id = state.structures.add(STRUCT_FACTORY, 1, 50 * W + 60, 0);
  const view = new StateView(state);
  const memory = createAiMemory(view, 0, { humanSeats: [] });
  const rng = createRng(7);
  for (let t = 0; t < 12; t++) {
    state.gold[1] = BASE_MILLI - 1; // one milli-gold under the base price of the upgrade
    view.refresh();
    const body = buildMove(view, memory, rng);
    if (body !== null) return { body, state, id };
    step(state, { turn: state.tick, intents: [] });
  }
  return { body: null, state, id };
}

describe('the AI pays the discounted upgrade price', () => {
  it('without the upgrade techs a purse under the base price builds; with Canal Works and Exchange (ECONOMY steps 1 and 3) it upgrades, and the sim takes the intent', () => {
    expect(ask(0).body?.kind).toBe('Build');
    const r = ask(0b1111);
    expect(r.body?.kind).toBe('Upgrade');
    expect((r.body as Extract<IntentBody, { kind: 'Upgrade' }>).structure).toBe(r.id);
    r.state.gold[1] = BASE_MILLI - 1;
    expect(applyIntent(r.state, withId(r.body as IntentBody, new IdAllocator().alloc(0)))).toBe(REJECT_NONE);
  });
});
