// M13a-1: the helicopter block of the Factory panel (pure numbers from the sim's own check), and the produced / scrapped watcher.
// The state is a real sim state read through a StateView, so a rule changed in the sim changes the panel's verdict here.
import { describe, expect, it } from 'vitest';
import { HeliWatcher, heliPanelInfo } from '../../src/ui/heliInfo';
import { deleteBody, produceHeliBody, REJECT_HELI_FLEET_CAP, REJECT_HELI_NO_GOLD, REJECT_HELI_QUEUE_BUSY, REJECT_NONE, withId, type Intent } from '../../src/sim/intents';
import { BUILD_TICKS, HELI_BUILD_TICKS, HELI_PRICE_GOLD, MILLI_GOLD_PER_GOLD, TICK_HZ } from '../../src/sim/rules';
import { step } from '../../src/sim/step';
import { createState, rebuildAggregates, type GameState } from '../../src/sim/state';
import { STRUCT_FACTORY } from '../../src/sim/structureRules';
import { CLASS_PLAINS } from '../../src/sim/terrain';
import { StateView } from '../../src/sim/view';

const W = 128;
const H = 64;

function world(): { s: GameState; factory: number } {
  const terrain = new Uint8Array(W * H).fill(CLASS_PLAINS);
  const s = createState({ width: W, height: H, seed: 5, seats: 2, config: { debugIntents: true }, terrain, elevation: new Uint16Array(W * H) });
  for (let c = 0; c < W * H; c++) s.owner[c] = c % W < W / 2 ? 1 : 2;
  rebuildAggregates(s);
  s.gold[1] = 100000 * MILLI_GOLD_PER_GOLD;
  const factory = s.structures.add(STRUCT_FACTORY, 1, 10 * W + 10, s.tick);
  for (let i = 0; i < (BUILD_TICKS[STRUCT_FACTORY] as number); i++) step(s, { turn: s.tick, intents: [] });
  return { s, factory };
}
let nid = 1;
const run = (s: GameState, ticks: number, intents: Intent[] = []): void => {
  for (let i = 0; i < ticks; i++) step(s, { turn: s.tick, intents: i === 0 ? intents : [] });
};

describe('heliPanelInfo', () => {
  it('free Factory: accepted, price 200, no queue; after an order: queue seconds, busy, fleet 1', () => {
    const { s, factory } = world();
    const v = new StateView(s);
    const a = heliPanelInfo(v, 0, factory);
    expect(a.reason).toBe(REJECT_NONE);
    expect(a.price).toBe(HELI_PRICE_GOLD);
    expect(a.queueSeconds).toBe(0);
    expect(a.fleet).toBe(0);
    expect(a.cap).toBeGreaterThanOrEqual(3);
    run(s, 1, [withId(produceHeliBody(0, factory), nid++)]);
    const b = heliPanelInfo(v, 0, factory);
    expect(b.reason).toBe(REJECT_HELI_QUEUE_BUSY);
    expect(b.fleet).toBe(1);
    expect(b.queueSeconds).toBe(Math.ceil((HELI_BUILD_TICKS - 1) / TICK_HZ));
    expect(b.buildSeconds).toBe(HELI_BUILD_TICKS / TICK_HZ);
  });

  it('no gold and a full fleet are named by their reason', () => {
    const { s, factory } = world();
    s.gold[1] = 0;
    expect(heliPanelInfo(new StateView(s), 0, factory).reason).toBe(REJECT_HELI_NO_GOLD);
    s.gold[1] = 100000 * MILLI_GOLD_PER_GOLD;
    const cap = heliPanelInfo(new StateView(s), 0, factory).cap;
    for (let i = 0; i < cap; i++) {
      run(s, 1, [withId(produceHeliBody(0, factory), nid++)]);
      run(s, HELI_BUILD_TICKS);
    }
    expect(heliPanelInfo(new StateView(s), 0, factory).reason).toBe(REJECT_HELI_FLEET_CAP);
  });
});

describe('HeliWatcher', () => {
  it('says produced when a build finishes and scrapped when the Factory is deleted mid-build, and is silent otherwise', () => {
    const { s, factory } = world();
    const v = new StateView(s);
    const w = new HeliWatcher();
    let version = 1;
    expect(w.update(v, version, 0)).toBeNull(); // first look: just remembers
    run(s, 1, [withId(produceHeliBody(0, factory), nid++)]);
    expect(w.update(v, ++version, 0)).toBeNull(); // queued
    expect(w.update(v, version, 0)).toBeNull(); // same version: no work
    run(s, HELI_BUILD_TICKS);
    expect(w.update(v, ++version, 0)).toBe('produced');
    run(s, 1, [withId(produceHeliBody(0, factory), nid++)]);
    expect(w.update(v, ++version, 0)).toBeNull();
    run(s, 1, [withId(deleteBody(0, factory), nid++)]);
    expect(w.update(v, version + 1, 0)).toBe('scrapped');
  });
});
