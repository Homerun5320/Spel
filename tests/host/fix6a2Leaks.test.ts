// Fix-6A2: audit 5 mutation holes. Each test fails on the one-line mutant named in docs/DECISIONS.md (Fix-6A2).
import { describe, expect, it } from 'vitest';
import { HELI_HOVER, cellCentreQ8 } from '../../src/sim/heliTable';
import {
  OUTBOX_ELIMINATED,
  OUTBOX_HELI_DOWNED,
  OUTBOX_HELI_HOME,
  OUTBOX_HELI_LANDED,
  OUTBOX_HELI_LAUNCHED,
  OUTBOX_HELI_PRODUCED,
  OUTBOX_HELI_QUEUED,
  OUTBOX_HELI_RTB,
  OUTBOX_HELI_SCRAPPED,
} from '../../src/sim/outbox';
import { HELI_HP_TENTHS } from '../../src/sim/rules';
import { createState, type GameState } from '../../src/sim/state';
import { step, type StepFn } from '../../src/sim/step';
import { STRUCT_FACTORY, STRUCT_SAM } from '../../src/sim/structureRules';
import { CLASS_PLAINS } from '../../src/sim/terrain';
import { MainThreadHost } from '../../src/host/mainThreadHost';
import type { HostEvent, StateDiff } from '../../src/host/protocol';
import { ViewMirror } from '../../src/host/viewMirror';
import { snapshotMissiles } from '../../src/host/missileSnapshot';
import { MissileTable } from '../../src/sim/missileTable';
import { VIEW_EVENTS_CAP } from '../../src/sim/view';
import { OUTBOX_BEACHHEAD_FORMED } from '../../src/sim/outbox';

const W = 256;
const H = 96;
const at = (x: number, y: number): number => y * W + x;

function world(): { s: GameState; heli: number } {
  const terrain = new Uint8Array(W * H).fill(CLASS_PLAINS);
  const s = createState({ width: W, height: H, seed: 3, seats: 4, config: { debugIntents: true }, terrain, elevation: new Uint16Array(W * H).fill(5), maxElev: new Int16Array(W * H).fill(5) });
  const factory = s.structures.add(STRUCT_FACTORY, 1, at(20, 48), s.tick);
  s.structures.readyTick[factory] = s.tick;
  const sam = s.structures.add(STRUCT_SAM, 2, at(150, 48), s.tick);
  s.structures.readyTick[sam] = s.tick;
  const heli = s.helis.addBuilding(1, factory, s.tick, s.tick);
  const t = s.helis;
  t.state[heli] = HELI_HOVER;
  t.x[heli] = cellCentreQ8(20);
  t.y[heli] = cellCentreQ8(20);
  t.mode[heli] = 0;
  t.hp[heli] = HELI_HP_TENTHS;
  t.alt[heli] = 400;
  t.fuel[heli] = 777;
  t.readyTick[heli] = 99;
  t.factory[heli] = 5;
  t.stateTick[heli] = 0;
  t.load[heli] = 55;
  t.stateTick[heli] = s.tick;
  return { s, heli };
}

function stepWith(push: (s: GameState) => void): StepFn {
  return (s, input) => {
    const r = step(s, input);
    s.outbox.clear();
    push(s);
    return r;
  };
}

describe('hidden enemy helicopter: every one of the eight helicopter event kinds is filtered', () => {
  const KINDS = [OUTBOX_HELI_QUEUED, OUTBOX_HELI_PRODUCED, OUTBOX_HELI_SCRAPPED, OUTBOX_HELI_LAUNCHED, OUTBOX_HELI_LANDED, OUTBOX_HELI_DOWNED, OUTBOX_HELI_RTB, OUTBOX_HELI_HOME];
  for (const kind of KINDS) {
    it(`kind ${kind} about a hidden enemy helicopter does not reach the enemy viewer`, () => {
      const host = new MainThreadHost(world().s, { viewerSeat: 1, stepFn: stepWith((st) => { st.outbox.push(kind, st.tick, 0, 1); st.outbox.push(OUTBOX_ELIMINATED, st.tick, 3, 0); }) });
      const diffs: StateDiff[] = [];
      host.subscribe((e: HostEvent) => { if (e.type === 'diff') diffs.push(e.diff); });
      host.runTicks(1);
      const ev = (diffs[0] as StateDiff).view.events;
      const kinds: number[] = [];
      for (let i = 0; i < ev.length; i += 4) kinds.push(ev[i] as number);
      expect(kinds).toEqual([OUTBOX_ELIMINATED]);
    });
  }
});

describe('the row of a hidden helicopter is a FREE slot in every column (the documented contract "all zero")', () => {
  it('full view', async () => {
    const { s, heli } = world();
    const host = new MainThreadHost(s, { viewerSeat: 1 });
    const v = await host.requestView();
    const h = v.helis!;
    const cols: Array<[string, ArrayLike<number>]> = [['owner', h.owner], ['state', h.state], ['factory', h.factory], ['readyTick', h.readyTick], ['x', h.x], ['y', h.y], ['alt', h.alt], ['hp', h.hp], ['load', h.load], ['fuel', h.fuel]];
    for (const [name, arr] of cols) expect(arr[heli], name).toBe(0);
    expect(h.liveCount).toBe(0);
  });
});

describe('snapshots are copies, never sim references (CHARTER 2.6)', () => {
  it('the launch counters of a missile snapshot do not follow the live table', () => {
    const t = new MissileTable(16, 4);
    t.launches[3] = 2;
    const snap = snapshotMissiles(t);
    t.launches[3] = 9;
    expect(snap.launches[3]).toBe(2);
  });
});

describe('the mirror forwards how many events the cap dropped', () => {
  it('eventsDropped of a frame reaches mirror.events.dropped', async () => {
    const { s } = world();
    const total = VIEW_EVENTS_CAP + 40;
    const host = new MainThreadHost(s, { stepFn: stepWith((st) => { for (let i = 0; i < total; i++) st.outbox.push(OUTBOX_BEACHHEAD_FORMED, st.tick, i, 0); }) });
    const { mirror, stop } = await ViewMirror.attach(host);
    host.runTicks(1);
    expect(mirror.events.length).toBe(VIEW_EVENTS_CAP);
    expect(mirror.events.dropped).toBeGreaterThanOrEqual(40);
    stop();
  });
});
