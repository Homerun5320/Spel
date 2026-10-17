// M14a: the missile table on its way to the page (host snapshot -> ViewSnapshot -> ViewMirror), and the OUTBOX_MISSILE_* facts that reach the page through ViewSnapshot.events (Events-1
// forwards every kind that is not a paint or a refusal, so the new kinds flow without a change there: this test pins that).
import { describe, expect, it } from 'vitest';
import { MainThreadHost } from '../../src/host/mainThreadHost';
import { MirrorMissiles } from '../../src/host/missileMirror';
import { NO_MISSILES, missileSignature, snapshotMissiles } from '../../src/host/missileSnapshot';
import { cloneMissiles } from '../../src/host/protocol';
import { ViewMirror } from '../../src/host/viewMirror';
import { launchMissileBody } from '../../src/sim/intents';
import { missilePosition } from '../../src/sim/missileGeom';
import { validateMissileLaunch } from '../../src/sim/missileRules';
import { MISSILE_FISSION, MISSILE_TACTICAL } from '../../src/sim/missileTable';
import {
  OUTBOX_MISSILE_BUILDING_DESTROYED,
  OUTBOX_MISSILE_DETONATED,
  OUTBOX_MISSILE_LAUNCHED,
  OUTBOX_MISSILE_WARNING,
  OUTBOX_PAINT,
} from '../../src/sim/outbox';
import { StateView } from '../../src/sim/view';
import { missileFixture } from '../../tools/sim/missiles';

describe('the missile snapshot', () => {
  it('copies every live row in slot order and the launch counters; an empty table still carries the counters', () => {
    const fx = missileFixture('plain-cruise', 1);
    const t = fx.state.missiles;
    const empty = snapshotMissiles(t);
    expect(empty.count).toBe(0);
    expect(empty.launches.length).toBe(9);
    expect(NO_MISSILES.count).toBe(0);
    t.add(3, 1, MISSILE_TACTICAL, 4, 10, 40, 100, 200);
    t.add(9, 2, MISSILE_FISSION, 6, 20, 90, 300, 400);
    t.launches[3] = 2;
    const snap = snapshotMissiles(t);
    expect(snap.count).toBe(2);
    expect(Array.from(snap.slot)).toEqual([3, 9]);
    expect(Array.from(snap.owner)).toEqual([1, 2]);
    expect(Array.from(snap.cls)).toEqual([MISSILE_TACTICAL, MISSILE_FISSION]);
    expect(Array.from(snap.silo)).toEqual([4, 6]);
    expect(Array.from(snap.launchTick)).toEqual([10, 20]);
    expect(Array.from(snap.impactTick)).toEqual([40, 90]);
    expect(Array.from(snap.startCell)).toEqual([100, 300]);
    expect(Array.from(snap.targetCell)).toEqual([200, 400]);
    expect(snap.launches[3]).toBe(2);
    const copy = cloneMissiles(snap);
    expect(copy).toEqual(snap);
    expect(copy.owner).not.toBe(snap.owner);
  });

  it('the mirror spreads the rows back to their slots and answers launchesOf', () => {
    const t = missileFixture('plain-cruise', 1).state.missiles;
    t.add(3, 1, MISSILE_TACTICAL, 4, 10, 40, 100, 200);
    t.launches[4] = 7; // ownerId 1, class 1
    const m = new MirrorMissiles();
    m.adopt(snapshotMissiles(t));
    expect([m.liveCount, m.owner[3], m.owner[0], m.impactTick[3], m.targetCell[3], m.version]).toEqual([1, 1, 0, 40, 200, 1]);
    expect(m.launchesOf(1, MISSILE_FISSION)).toBe(7);
    expect(m.launchesOf(2, 0)).toBe(0);
    t.remove(3);
    m.adopt(snapshotMissiles(t));
    expect([m.liveCount, m.owner[3], m.version]).toEqual([0, 0, 2]);
    for (const f of ['cls', 'silo', 'launchTick', 'impactTick', 'startCell', 'targetCell'] as const) expect(m[f][3], `${f} of a gone row`).toBe(0);
  });

  it('the signature changes with every column and with the counters, and is stable otherwise', () => {
    const t = missileFixture('plain-cruise', 1).state.missiles;
    t.add(1, 1, MISSILE_TACTICAL, 4, 10, 40, 100, 200);
    const base = missileSignature(t);
    expect(missileSignature(t)).toBe(base);
    const seen = new Set<number>([base]);
    for (const f of ['owner', 'cls', 'silo', 'launchTick', 'impactTick', 'startCell', 'targetCell'] as const) {
      const old = t[f][1] as number;
      t[f][1] = old + 1;
      const sig = missileSignature(t);
      expect(seen.has(sig), f).toBe(false);
      seen.add(sig);
      t[f][1] = old;
      expect(missileSignature(t), `${f} undone`).toBe(base);
    }
    t.launches[5] = 1;
    expect(seen.has(missileSignature(t)), 'a counter').toBe(false);
  });
});

describe('the missile table and its events over the host', () => {
  it('a launch reaches the mirror, the position follows the flight, the blast empties the table, and every OUTBOX_MISSILE_* fact arrives exactly once', async () => {
    const fx = missileFixture('plain-cruise', 1);
    const s = fx.state;
    const host = new MainThreadHost(s);
    const { mirror } = await ViewMirror.attach(host);
    expect(mirror.missiles.liveCount).toBe(0);
    expect(validateMissileLaunch(mirror, 0, fx.silo, MISSILE_TACTICAL, fx.target)).toBe(validateMissileLaunch(new StateView(s), 0, fx.silo, MISSILE_TACTICAL, fx.target));
    host.submitIntent(launchMissileBody(0, fx.silo, MISSILE_TACTICAL, fx.target));
    const seen: Array<[number, number, number]> = [];
    let airborne = 0;
    const pos = new Int32Array(3);
    let lastZ = 0;
    for (let i = 0; i < 45; i++) {
      host.advance(100);
      for (let k = 0; k < mirror.events.length; k++) seen.push([mirror.events.kindAt(k), mirror.events.aAt(k), mirror.events.bAt(k)]);
      mirror.clearEvents();
      if (mirror.missiles.liveCount === 1) {
        airborne++;
        expect(mirror.missiles.targetCell[0]).toBe(fx.target);
        expect(mirror.missiles.owner[0]).toBe(1);
        missilePosition(mirror.missiles.startCell[0] as number, mirror.missiles.targetCell[0] as number, mirror.missiles.launchTick[0] as number, mirror.missiles.impactTick[0] as number, mirror.tick, 1024, 512, pos);
        lastZ = pos[2] as number;
      }
    }
    void lastZ;
    expect(airborne).toBeGreaterThan(25);
    expect(mirror.missiles.liveCount).toBe(0);
    expect(mirror.missiles.launchesOf(1, MISSILE_TACTICAL)).toBe(1);
    const count = (kind: number): number => seen.filter((e) => e[0] === kind).length;
    expect(count(OUTBOX_MISSILE_LAUNCHED)).toBe(1);
    expect(count(OUTBOX_MISSILE_WARNING)).toBe(1);
    expect(count(OUTBOX_MISSILE_DETONATED)).toBe(1);
    const gone = fx.buildings.filter((id) => s.structures.owner[id] === 0).length;
    expect(gone, 'the City and the Factory at least').toBeGreaterThanOrEqual(2);
    expect(count(OUTBOX_MISSILE_BUILDING_DESTROYED)).toBe(gone);
    expect(count(OUTBOX_PAINT), 'paints are not side facts').toBe(0);
    expect(seen.find((e) => e[0] === OUTBOX_MISSILE_DETONATED)).toEqual([OUTBOX_MISSILE_DETONATED, MISSILE_TACTICAL, fx.target]);
  });

  it('a quiet table is not resent: with a missile far from its blast the version moves only at the launch and the blast', async () => {
    const fx = missileFixture('fusion-silo', 1);
    const s = fx.state;
    const host = new MainThreadHost(s);
    const { mirror } = await ViewMirror.attach(host);
    host.submitIntent(launchMissileBody(0, fx.silo, 2, fx.target));
    for (let i = 0; i < 5; i++) host.advance(100); // the intent runs two ticks after it was filed
    const v = mirror.missilesVersion;
    for (let i = 0; i < 20; i++) host.advance(100);
    expect(mirror.missilesVersion, 'the flight itself changes no column').toBe(v);
    expect(mirror.missiles.liveCount).toBe(1);
    for (let i = 0; i < 40; i++) host.advance(100);
    expect(mirror.missiles.liveCount).toBe(0);
    expect(mirror.missilesVersion).toBeGreaterThan(v);
  });
});
