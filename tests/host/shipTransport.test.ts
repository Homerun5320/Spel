// M13c-1: the ship table on its way to the page, in the pattern of the beachhead table: host snapshot -> ViewSnapshot -> ViewMirror. The rows (slot order), the route, the signature that
// decides when the host resends, the mirror indexed by slot, and the whole path over a MainThreadHost (the mirror's `SimView.ships` follows the sim's).
import { describe, expect, it } from 'vitest';
import { MainThreadHost } from '../../src/host/mainThreadHost';
import { MirrorShips } from '../../src/host/shipMirror';
import { NO_SHIPS, shipSignature, snapshotShips } from '../../src/host/shipSnapshot';
import { ViewMirror } from '../../src/host/viewMirror';
import { cloneShips } from '../../src/host/protocol';
import { launchShipBody } from '../../src/sim/intents';
import { SHIP_ROUTE_CAPACITY } from '../../src/sim/rules';
import { validateLaunchShip } from '../../src/sim/shipRules';
import { SHIP_LAND, SHIP_OFF, SHIP_SAIL } from '../../src/sim/shipTable';
import { StateView } from '../../src/sim/view';
import { SHIP_W as W, shipFixture } from '../../tools/sim/shipLanding';

const at = (x: number, y: number): number => y * W + x;

describe('the ship snapshot', () => {
  it('copies every live row in slot order with its route; free slots are left out; an empty table is the shared empty snapshot', () => {
    const fx = shipFixture(0, { island: false });
    const t = fx.state.ships;
    expect(snapshotShips(t)).toBe(NO_SHIPS);
    t.add(2, 1, 7, at(95, 24), 50, 600, at(144, 24) + 1);
    t.add(5, 2, 9, at(150, 3), 60, 20, 33);
    t.state[5] = SHIP_LAND;
    t.x[2] = 1234;
    t.y[2] = 5678;
    t.routeLen[2] = 3;
    t.routeIdx[2] = 2;
    t.route[2 * SHIP_ROUTE_CAPACITY + 0] = 11;
    t.route[2 * SHIP_ROUTE_CAPACITY + 1] = 22;
    t.route[2 * SHIP_ROUTE_CAPACITY + 2] = 33;
    const snap = snapshotShips(t);
    expect(snap.count).toBe(2);
    expect(Array.from(snap.slot)).toEqual([2, 5]);
    expect(Array.from(snap.owner)).toEqual([1, 2]);
    expect(Array.from(snap.state)).toEqual([SHIP_SAIL, SHIP_LAND]);
    expect(Array.from(snap.port)).toEqual([7, 9]);
    expect(Array.from(snap.stateTick)).toEqual([50, 60]);
    expect([snap.x[0], snap.y[0]]).toEqual([1234, 5678]);
    expect(Array.from(snap.load)).toEqual([600, 20]);
    expect(Array.from(snap.target)).toEqual([at(144, 24) + 1, 33]);
    expect(Array.from(snap.routeLen)).toEqual([3, 0]);
    expect(Array.from(snap.routeIdx)).toEqual([2, 0]);
    expect(Array.from(snap.route.subarray(0, 3))).toEqual([11, 22, 33]);
    expect(snap.route.length).toBe(2 * SHIP_ROUTE_CAPACITY);
    const copy = cloneShips(snap);
    expect(copy).toEqual(snap);
    expect(copy.route).not.toBe(snap.route); // a deep copy (a Worker host transfers its own)
  });

  it('the mirror spreads the rows back to their slots, empties free slots and counts versions and fleets', () => {
    const fx = shipFixture(0, { island: false });
    const t = fx.state.ships;
    t.add(2, 1, 7, at(95, 24), 50, 600, 99);
    t.add(5, 1, 9, at(95, 30), 60, 20, 33);
    t.x[5] = 256 * 100 + 5;
    t.y[5] = 256 * 7 + 5;
    t.routeLen[2] = 2;
    t.route[2 * SHIP_ROUTE_CAPACITY + 1] = at(142, 24);
    const m = new MirrorShips();
    expect(m.liveCount).toBe(0);
    m.adopt(snapshotShips(t));
    expect(m.version).toBe(1);
    expect([m.liveCount, m.owner[2], m.owner[5], m.owner[0], m.load[2], m.port[5], m.routeLen[2]]).toEqual([2, 1, 1, 0, 600, 9, 2]);
    expect(m.routeCell(2, 1)).toBe(at(142, 24));
    expect(m.countOf(1)).toBe(2);
    expect(m.countOf(2)).toBe(0);
    expect(m.cellOf(5, W)).toBe(7 * W + 100);
    t.remove(2);
    m.adopt(snapshotShips(t));
    expect([m.liveCount, m.owner[2], m.load[2], m.routeLen[2], m.routeCell(2, 1), m.countOf(1)]).toEqual([1, 0, 0, 0, 0, 1]);
    expect(m.version).toBe(2);
  });

  it('the signature changes with every column a snapshot carries and is stable otherwise', () => {
    const fx = shipFixture(0, { island: false });
    const t = fx.state.ships;
    t.add(1, 1, 7, at(95, 24), 50, 600, 99);
    t.routeLen[1] = 2;
    t.route[1 * SHIP_ROUTE_CAPACITY] = at(96, 24);
    t.route[1 * SHIP_ROUTE_CAPACITY + 1] = at(142, 24);
    const base = shipSignature(t);
    expect(shipSignature(t)).toBe(base);
    const seen = new Set<number>([base]);
    for (const f of ['owner', 'state', 'port', 'stateTick', 'x', 'y', 'load', 'target', 'routeLen', 'routeIdx'] as const) {
      const old = t[f][1] as number;
      t[f][1] = old + 1;
      const sig = shipSignature(t);
      expect(seen.has(sig), f).toBe(false);
      seen.add(sig);
      t[f][1] = old;
      expect(shipSignature(t), `${f} undone`).toBe(base);
    }
    t.add(3, 1, 8, at(95, 25), 50, 20, 5);
    expect(seen.has(shipSignature(t)), 'a new row').toBe(false);
  });
});

describe('the ship table over the host', () => {
  it('a launch through submitIntent reaches the mirror: the same ship, the same cell every tick, one version per change, the page-side check agrees with the sim', async () => {
    const fx = shipFixture(0, { island: false });
    const s = fx.state;
    const target = at(144, 24);
    const host = new MainThreadHost(s);
    const { mirror } = await ViewMirror.attach(host);
    expect(mirror.ships.liveCount).toBe(0);
    expect(validateLaunchShip(mirror, 0, fx.port, target, 600)).toBe(0); // the mirror answers the same question as the live view
    expect(validateLaunchShip(new StateView(s), 0, fx.port, target, 600)).toBe(0);
    host.submitIntent(launchShipBody(0, fx.port, target, 600));
    let seenSail = 0;
    for (let i = 0; i < 40; i++) {
      host.advance(100);
      if (s.ships.liveCount > 0) {
        expect(mirror.ships.liveCount).toBe(1);
        expect(mirror.ships.state[0]).toBe(SHIP_SAIL);
        expect(mirror.ships.cellOf(0, W)).toBe(s.ships.cellOf(0, W));
        expect(mirror.ships.load[0]).toBe(600);
        expect(mirror.ships.target[0]).toBe(target + 1);
        seenSail++;
      }
    }
    expect(seenSail).toBeGreaterThan(30);
    // while the ship moves the table changes every tick; a launch from the busy Port is refused by the page-side check too
    const live = validateLaunchShip(new StateView(s), 0, fx.port, target, 600);
    expect(live).not.toBe(0);
    expect(validateLaunchShip(mirror, 0, fx.port, target, 600)).toBe(live);
    const v = mirror.shipsVersion;
    for (let i = 0; i < 5; i++) host.advance(100);
    expect(mirror.shipsVersion).toBe(v + 5);
  });

  it('a quiet table is not resent: with only a docked, cooling ship the version stands still', async () => {
    const fx = shipFixture(0, { island: false });
    const s = fx.state;
    s.ships.add(0, 1, fx.port, at(95, 24), s.tick, 0, 0);
    s.ships.state[0] = SHIP_OFF;
    s.ships.routeLen[0] = 1;
    s.ships.route[0] = at(96, 24);
    s.ships.x[0] = 96 * 256 + 128;
    s.ships.y[0] = 24 * 256 + 128;
    const host = new MainThreadHost(s);
    const { mirror } = await ViewMirror.attach(host);
    expect(mirror.ships.liveCount).toBe(1);
    host.advance(100);
    const v = mirror.shipsVersion;
    for (let i = 0; i < 10; i++) host.advance(100);
    expect(mirror.shipsVersion).toBe(v);
  });
});
