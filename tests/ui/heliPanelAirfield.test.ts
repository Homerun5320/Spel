// Fix-6B [3.2]: the Factory's "Build helicopter" tooltip shows the EFFECTIVE build time (Airfields shorten it), from the sim's own `heliBuildTicksOf`.
import { describe, expect, it } from 'vitest';
import { heliPanelInfo } from '../../src/ui/heliInfo';
import { produceHeliBody, withId } from '../../src/sim/intents';
import { BUILD_TICKS, HELI_BUILD_TICKS, MILLI_GOLD_PER_GOLD, TICK_HZ } from '../../src/sim/rules';
import { step } from '../../src/sim/step';
import { createState, rebuildAggregates, type GameState } from '../../src/sim/state';
import { STRUCT_AIRFIELD, STRUCT_FACTORY } from '../../src/sim/structureRules';
import { CLASS_PLAINS } from '../../src/sim/terrain';
import { StateView } from '../../src/sim/view';

const W = 128;
const H = 64;

function world(): { s: GameState; factory: number; airfield: number } {
  const terrain = new Uint8Array(W * H).fill(CLASS_PLAINS);
  const s = createState({ width: W, height: H, seed: 5, seats: 2, config: { debugIntents: true }, terrain, elevation: new Uint16Array(W * H) });
  for (let c = 0; c < W * H; c++) s.owner[c] = c % W < W / 2 ? 1 : 2;
  rebuildAggregates(s);
  s.gold[1] = 100000 * MILLI_GOLD_PER_GOLD;
  const factory = s.structures.add(STRUCT_FACTORY, 1, 10 * W + 10, s.tick);
  const airfield = s.structures.add(STRUCT_AIRFIELD, 1, 30 * W + 10, s.tick);
  for (let i = 0; i < (BUILD_TICKS[STRUCT_AIRFIELD] as number) + 5; i++) step(s, { turn: s.tick, intents: [] });
  return { s, factory, airfield };
}

describe('heliPanelInfo build time with Airfields', () => {
  it('shows 12 s with a level 1 Airfield as 11.4 s, 7.2 s at level 8+, and the queue chip agrees with the order', () => {
    const { s, factory, airfield } = world();
    const v = new StateView(s);
    expect(heliPanelInfo(v, 0, factory).buildSeconds).toBeCloseTo(114 / TICK_HZ, 5);
    s.structures.level[airfield] = 8;
    s.structures.effDirty = true;
    s.structures.version++;
    const info = heliPanelInfo(v, 0, factory);
    expect(info.buildSeconds).toBeCloseTo(72 / TICK_HZ, 5);
    expect(info.buildSeconds).toBeLessThan(HELI_BUILD_TICKS / TICK_HZ);
    // the order really takes that long: the queue chip right after it reads the same whole seconds
    step(s, { turn: s.tick, intents: [withId(produceHeliBody(0, factory), 1)] });
    step(s, { turn: s.tick, intents: [] });
    step(s, { turn: s.tick, intents: [] });
    expect(heliPanelInfo(v, 0, factory).queueSeconds).toBe(Math.ceil(info.buildSeconds - 2 / TICK_HZ));
  });
});
