// M17-pre: helicopter visibility per viewer and the Nav accessor of the views. Every rule is asserted through the real mask (src/sim/heliVisibility.ts), the real
// host snapshot and the real ViewMirror; the mutants are tabulated in the M17-pre block of docs/DECISIONS.md.
import { describe, expect, it } from 'vitest';
import { navOf, scoreLzOf } from '../../src/sim/access';
import { bindFederation } from '../../src/sim/diplomacy';
import { RELATION_ALLIANCE, RELATION_TRUCE, RELATION_WAR } from '../../src/sim/diplomacyTable';
import { HELI_BUILDING, HELI_DOWNED, HELI_HOVER, HELI_PAD, cellCentreQ8 } from '../../src/sim/heliTable';
import { heliVisibilityOf } from '../../src/sim/heliVisibility';
import { HELI_HP_TENTHS } from '../../src/sim/rules';
import { hashState } from '../../src/sim/serialize';
import { createState, type GameState } from '../../src/sim/state';
import { step } from '../../src/sim/step';
import { StateView } from '../../src/sim/view';
import { STRUCT_FACTORY, STRUCT_SAM } from '../../src/sim/structureRules';
import { CLASS_PLAINS } from '../../src/sim/terrain';
import { ViewMirror } from '../../src/host/viewMirror';
import { MainThreadHost } from '../../src/host/mainThreadHost';
import { syntheticFixture } from '../../tools/sim/heliRaid';

const W = 256;
const H = 96;
const at = (x: number, y: number): number => y * W + x;

/** Puts helicopter `id` in the air as a hovering one at cell (x, y), flight mode `mode` (0 Low, 1 High); the flight phase is not run. */
function hover(s: GameState, id: number, x: number, y: number, mode: 0 | 1, state = HELI_HOVER): void {
  const t = s.helis;
  t.state[id] = state;
  t.x[id] = cellCentreQ8(x);
  t.y[id] = cellCentreQ8(y);
  t.mode[id] = mode;
  t.hp[id] = HELI_HP_TENTHS;
  t.alt[id] = 400;
  t.stateTick[id] = s.tick;
}

/** A flat 4-player world: seat 1 (owner 2) has a finished SAM at (150, 48); a Factory of owner 1 at (20, 48) holds helicopter 0 (owner 1). */
function world(): { s: GameState; heli: number; sam: number } {
  const terrain = new Uint8Array(W * H).fill(CLASS_PLAINS);
  const elevation = new Uint16Array(W * H).fill(5);
  const maxElev = new Int16Array(W * H).fill(5);
  const s = createState({ width: W, height: H, seed: 3, seats: 4, config: { debugIntents: true }, terrain, elevation, maxElev });
  const factory = s.structures.add(STRUCT_FACTORY, 1, at(20, 48), s.tick);
  s.structures.readyTick[factory] = s.tick;
  const sam = s.structures.add(STRUCT_SAM, 2, at(150, 48), s.tick);
  s.structures.readyTick[sam] = s.tick;
  const heli = s.helis.addBuilding(1, factory, s.tick, s.tick);
  hover(s, heli, 20, 20, 0); // far from every sensor
  return { s, heli, sam };
}

const sees = (s: GameState, seat: number, id: number): boolean => heliVisibilityOf(s).sight(seat).has(id);

describe('the visibility mask', () => {
  it('a low helicopter behind a ridge is absent from the enemy view and present in the owner view; a high one in range is seen', () => {
    const fx = syntheticFixture('ridge-sam', 7);
    const s = fx.state;
    hover(s, fx.heli, 92, 48, 0);
    expect(sees(s, 0, fx.heli)).toBe(true); // the owner
    expect(sees(s, 1, fx.heli)).toBe(false); // the SAM owner, ridge between
    expect(heliVisibilityOf(s).sight(1).count).toBe(0);
    hover(s, fx.heli, 92, 48, 1);
    expect(sees(s, 1, fx.heli)).toBe(true); // High: only the range counts
    hover(s, fx.heli, 92, 48, 0);
    expect(sees(s, 1, fx.heli)).toBe(false); // back to Low: hidden again in the same tick
  });

  it('a low helicopter inside the open sensor range is seen, one outside it is not', () => {
    const { s, heli } = world();
    hover(s, heli, 140, 48, 0);
    expect(sees(s, 1, heli)).toBe(true);
    hover(s, heli, 20, 20, 0);
    expect(sees(s, 1, heli)).toBe(false);
  });

  it('an ally, a federation member and a truce partner always see it; war does not; the owner always does', () => {
    const { s, heli } = world();
    expect(sees(s, 0, heli)).toBe(true);
    expect(sees(s, 1, heli)).toBe(false);
    expect(sees(s, 2, heli)).toBe(false);
    s.diplo.setRelation(1, 3, RELATION_ALLIANCE, 0); // owners 1 and 3 = seats 0 and 2
    expect(sees(s, 2, heli)).toBe(true);
    expect(sees(s, 1, heli)).toBe(false);
    s.diplo.setRelation(1, 2, RELATION_TRUCE, s.tick + 100000);
    expect(sees(s, 1, heli)).toBe(true);
    s.diplo.setRelation(1, 2, RELATION_WAR, 0);
    expect(sees(s, 1, heli)).toBe(false);
    bindFederation(s, 0, 3);
    expect(sees(s, 3, heli)).toBe(true);
  });

  it('a relation that changes in flight changes the visibility from the next tick', () => {
    const { s, heli } = world();
    const view = new StateView(s);
    expect(view.visibleHelis(1).has(heli)).toBe(false);
    s.diplo.setRelation(1, 2, RELATION_ALLIANCE, 0);
    s.tick++;
    expect(view.visibleHelis(1).has(heli)).toBe(true);
    s.diplo.setRelation(1, 2, RELATION_WAR, 0);
    s.tick++;
    expect(view.visibleHelis(1).has(heli)).toBe(false);
  });

  it('a hostile helicopter under production or parked is never seen, a wreck follows the sensor rule, a seat out of range sees nothing', () => {
    const { s, heli } = world();
    hover(s, heli, 150, 49, 0, HELI_PAD);
    expect(sees(s, 0, heli)).toBe(true);
    expect(sees(s, 1, heli)).toBe(false); // inside the SAM range but parked
    hover(s, heli, 150, 49, 0, HELI_BUILDING);
    expect(sees(s, 1, heli)).toBe(false);
    hover(s, heli, 150, 49, 0, HELI_DOWNED);
    expect(sees(s, 1, heli)).toBe(true);
    expect(heliVisibilityOf(s).sight(4).count).toBe(0);
  });

  it('reading the mask, the view and the Nav does not change the state hash', () => {
    const run = (read: boolean): string => {
      const fx = syntheticFixture('ridge-sam', 11);
      const s = fx.state;
      hover(s, fx.heli, 92, 48, 0);
      const view = new StateView(s);
      for (let i = 0; i < 120; i++) {
        if (read) {
          view.refresh();
          view.visibleHelis(0);
          view.visibleHelis(1);
          view.navOf();
        }
        step(s, { turn: s.tick, intents: [] });
      }
      return String(hashState(s));
    };
    expect(run(true)).toBe(run(false));
  });
});

describe('navOf on the views', () => {
  it('a StateView returns the Nav the state owns: the very object; reading it before a step leaves the hash alone', () => {
    const fx = syntheticFixture('plains-sam', 5);
    const s = fx.state;
    const before = hashState(s);
    const view = new StateView(s);
    const nav = view.navOf();
    expect(nav).not.toBeNull();
    expect(nav).toBe(navOf(s));
    expect(hashState(s)).toBe(before);
    expect(scoreLzOf(s, 0, fx.lz, at(40, 48), 0).reason).toBe(0);
  });

  it('is null without the occluder layer and null on a ViewMirror', async () => {
    const bare = createState({ width: 64, height: 32, seed: 1, seats: 2, terrain: new Uint8Array(64 * 32).fill(CLASS_PLAINS), elevation: new Uint16Array(64 * 32) });
    expect(new StateView(bare).navOf()).toBeNull();
    const { s } = world();
    const host = new MainThreadHost(s, { viewerSeat: 0 });
    const { mirror, stop } = await ViewMirror.attach(host);
    expect(mirror.navOf()).toBeNull();
    stop();
  });
});

describe('the host sends only the rows the viewer may see', () => {
  it('the snapshot of a viewer holds no row (and no count) of an unseen enemy helicopter; the ViewMirror follows the next diff', async () => {
    const { s, heli } = world();
    hover(s, heli, 20, 20, 0);
    const host = new MainThreadHost(s, { viewerSeat: 1 });
    const { mirror, stop } = await ViewMirror.attach(host);
    expect(mirror.helis.owner[heli]).toBe(0);
    expect(mirror.helis.countOf(1)).toBe(0);
    expect(mirror.helis.liveCount).toBe(0);
    expect(mirror.visibleHelis().count).toBe(0);
    // it flies into the sensor range: the next diff carries the row
    hover(s, heli, 140, 48, 0);
    host.runTicks(1);
    expect(mirror.helis.owner[heli]).toBe(1);
    expect(mirror.visibleHelis().has(heli)).toBe(true);
    expect(mirror.helis.countOf(1)).toBe(1);
    // and out of it again: the row is gone, nothing hangs
    hover(s, heli, 20, 20, 0);
    host.runTicks(1);
    expect(mirror.helis.owner[heli]).toBe(0);
    expect(mirror.visibleHelis().count).toBe(0);
    stop();
    // the owner sees it all the time
    const own = new MainThreadHost(s, { viewerSeat: 0 });
    const m2 = await ViewMirror.attach(own);
    expect(m2.mirror.helis.owner[heli]).toBe(1);
    m2.stop();
  });

  it('a relation that changes with the helicopter standing still brings or takes the row in the next diff (the signature is the viewer\'s)', async () => {
    const { s, heli } = world();
    const host = new MainThreadHost(s, { viewerSeat: 1 });
    const { mirror, stop } = await ViewMirror.attach(host);
    expect(mirror.helis.owner[heli]).toBe(0);
    s.diplo.setRelation(1, 2, RELATION_ALLIANCE, 0);
    host.runTicks(1);
    expect(mirror.helis.owner[heli]).toBe(1);
    expect(mirror.helis.liveCount).toBe(1);
    s.diplo.setRelation(1, 2, RELATION_WAR, 0);
    host.runTicks(1);
    expect(mirror.helis.owner[heli]).toBe(0);
    expect(mirror.helis.liveCount).toBe(0);
    stop();
  });

  it('a host without a viewer seat sends the whole table (tests, debug pages)', async () => {
    const { s, heli } = world();
    const host = new MainThreadHost(s);
    const { mirror, stop } = await ViewMirror.attach(host);
    expect(mirror.helis.owner[heli]).toBe(1);
    stop();
  });
});
