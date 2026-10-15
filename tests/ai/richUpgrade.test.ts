// M09c: the AI upgrades its lowest structure instead of waiting when its purse pays both the next structure and the upgrade, and never
// upgrades a structure on its border (it could change hands before the intent runs).
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

function scene(gold: number, factoryX: number): { state: GameState; view: StateView; ask: () => IntentBody | null; id: number } {
  const state = landState(W, H, { seats: 2, players: 2 });
  for (let c = 0; c < state.grid.cells; c++) setOwner(state, c, c % W < 100 ? 1 : 2, 0);
  state.capital[1] = 50 * W + 50 + 1;
  state.tick = 1000;
  state.gold[1] = gold * MILLI_GOLD_PER_GOLD;
  state.troops[1] = 1000;
  const id = state.structures.add(STRUCT_FACTORY, 1, 50 * W + factoryX, 0); // finished long ago
  const view = new StateView(state);
  const memory = createAiMemory(view, 0, { humanSeats: [] });
  const rng = createRng(7);
  const ask = (): IntentBody | null => {
    for (let t = 0; t < 12; t++) {
      state.gold[1] = gold * MILLI_GOLD_PER_GOLD; // keep the purse as asked
      view.refresh();
      const b = buildMove(view, memory, rng);
      if (b !== null) return b;
      step(state, { turn: state.tick, intents: [] });
    }
    return null;
  };
  return { state, view, ask, id };
}

describe('the AI upgrade when rich', () => {
  const cityPrice = BUILD_BASE_GOLD[1] as number;
  const upgradeToTwo = 2 * (BUILD_BASE_GOLD[STRUCT_FACTORY] as number);

  it('upgrades the Factory when the purse pays the next City and the upgrade, builds the City when it pays only the City', () => {
    const rich = scene(upgradeToTwo, 60);
    const b = rich.ask();
    expect(b?.kind).toBe('Upgrade');
    expect((b as Extract<IntentBody, { kind: 'Upgrade' }>).structure).toBe(rich.id);
    expect(applyIntent(rich.state, withId(b as IntentBody, new IdAllocator().alloc(0)))).toBe(REJECT_NONE);
    expect(rich.state.structures.upgradeReadyTick[rich.id]).toBeGreaterThan(0);

    const poorer = scene(upgradeToTwo - 1, 60);
    const c = poorer.ask();
    expect(c?.kind).toBe('Build');
    expect(upgradeToTwo - 1).toBeGreaterThanOrEqual(cityPrice);
  });

  it('does not upgrade a structure that stands beside another owner (its border)', () => {
    const border = scene(upgradeToTwo, 99); // the next cell east belongs to seat 1
    expect(border.ask()?.kind).toBe('Build');
  });
});
