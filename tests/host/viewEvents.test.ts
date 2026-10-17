// Events-1: ViewSnapshot.events, the drained, capped side-fact list. Real MainThreadHost, real ViewMirror, the real helicopter mask; the outbox events are pushed by a
// step wrapper (the real step runs first) so every kind is under control. Mutants: the Events-1 block of docs/DECISIONS.md.
import { describe, expect, it } from 'vitest';
import { RELATION_ALLIANCE } from '../../src/sim/diplomacyTable';
import { HELI_HOVER, cellCentreQ8 } from '../../src/sim/heliTable';
import {
  OUTBOX_BEACHHEAD_FORMED,
  OUTBOX_ELIMINATED,
  OUTBOX_HELI_DOWNED,
  OUTBOX_HELI_LAUNCHED,
  OUTBOX_HELI_SCRAPPED,
  OUTBOX_PAINT,
  OUTBOX_REJECT,
} from '../../src/sim/outbox';
import { HELI_HP_TENTHS } from '../../src/sim/rules';
import { hashState } from '../../src/sim/serialize';
import { createState, type GameState } from '../../src/sim/state';
import { step, type StepFn } from '../../src/sim/step';
import { STRUCT_FACTORY, STRUCT_SAM } from '../../src/sim/structureRules';
import { CLASS_PLAINS } from '../../src/sim/terrain';
import { EMPTY_VIEW_EVENTS, StateView, VIEW_EVENTS_CAP } from '../../src/sim/view';
import { MainThreadHost } from '../../src/host/mainThreadHost';
import type { HostEvent, StateDiff } from '../../src/host/protocol';
import { ViewMirror } from '../../src/host/viewMirror';

const W = 256;
const H = 96;
const at = (x: number, y: number): number => y * W + x;

/** Seat 0 (owner 1) owns helicopter `heli` (parked at (20,20), outside every sensor); seat 1 (owner 2) has a SAM at (150,48). */
function world(): { s: GameState; heli: number } {
  const terrain = new Uint8Array(W * H).fill(CLASS_PLAINS);
  const s = createState({ width: W, height: H, seed: 3, seats: 4, config: { debugIntents: true }, terrain, elevation: new Uint16Array(W * H).fill(5), maxElev: new Int16Array(W * H).fill(5) });
  const factory = s.structures.add(STRUCT_FACTORY, 1, at(20, 48), s.tick);
  s.structures.readyTick[factory] = s.tick;
  const sam = s.structures.add(STRUCT_SAM, 2, at(150, 48), s.tick);
  s.structures.readyTick[sam] = s.tick;
  const heli = s.helis.addBuilding(1, factory, s.tick, s.tick);
  place(s, heli, 20, 20);
  return { s, heli };
}

function place(s: GameState, id: number, x: number, y: number): void {
  const t = s.helis;
  t.state[id] = HELI_HOVER;
  t.x[id] = cellCentreQ8(x);
  t.y[id] = cellCentreQ8(y);
  t.mode[id] = 0;
  t.hp[id] = HELI_HP_TENTHS;
  t.alt[id] = 400;
  t.stateTick[id] = s.tick;
}

type Push = (s: GameState) => void;
/** The real step, then an outbox holding exactly what `push` adds. */
function stepWith(push: Push): StepFn {
  return (s, input) => {
    const r = step(s, input);
    s.outbox.clear(); // what the hovering test helicopter makes of itself is not under test
    push(s);
    return r;
  };
}

function collect(host: MainThreadHost): StateDiff[] {
  const diffs: StateDiff[] = [];
  host.subscribe((e: HostEvent) => {
    if (e.type === 'diff') diffs.push(e.diff);
  });
  return diffs;
}

const list = (d: StateDiff): number[][] => {
  const out: number[][] = [];
  for (let i = 0; i < d.view.events.length; i += 4) out.push([d.view.events[i] as number, d.view.events[i + 1] as number, d.view.events[i + 2] as number, d.view.events[i + 3] as number]);
  return out;
};
const kinds = (d: StateDiff): number[] => list(d).map((r) => r[0] as number);

describe('the drained side-fact list', () => {
  it('delivers every side fact exactly once, in order, however many frames are skipped; paints and refusals stay out; an unknown kind passes as it is', () => {
    const { s } = world();
    let n = 0;
    const host = new MainThreadHost(s, {
      stepFn: stepWith((st) => {
        n++;
        st.outbox.push(OUTBOX_PAINT, st.tick, 5, 1);
        st.outbox.push(OUTBOX_ELIMINATED, st.tick, n, 0);
        st.outbox.push(OUTBOX_REJECT, st.tick, 9, 0);
        st.outbox.push(99, st.tick, n, 7); // a kind this build has never heard of
      }),
    });
    const diffs = collect(host);
    host.runTicks(3); // one frame for three ticks (a paused tab catches up)
    host.runTicks(2);
    expect(diffs).toHaveLength(2);
    const t0 = (diffs[0] as StateDiff).fromTick + 1; // the wrapper pushes after the step, so st.tick is already incremented
    expect(list(diffs[0] as StateDiff)).toEqual([
      [OUTBOX_ELIMINATED, t0, 1, 0], [99, t0, 1, 7],
      [OUTBOX_ELIMINATED, t0 + 1, 2, 0], [99, t0 + 1, 2, 7],
      [OUTBOX_ELIMINATED, t0 + 2, 3, 0], [99, t0 + 2, 3, 7],
    ]);
    expect(list(diffs[1] as StateDiff)).toEqual([
      [OUTBOX_ELIMINATED, t0 + 3, 4, 0], [99, t0 + 3, 4, 7],
      [OUTBOX_ELIMINATED, t0 + 4, 5, 0], [99, t0 + 4, 5, 7],
    ]);
    expect((diffs[0] as StateDiff).view.eventsDropped).toBe(0);
  });

  it('a frame without facts carries an empty list, and the full view never drains the stream', async () => {
    const { s } = world();
    const host = new MainThreadHost(s, { stepFn: stepWith((st) => st.outbox.push(OUTBOX_ELIMINATED, st.tick, 1, 0)) });
    const diffs = collect(host);
    host.runTicks(1);
    const full = await host.requestView();
    expect(full.events.length).toBe(0);
    host.runTicks(1);
    expect(list(diffs[1] as StateDiff)).toHaveLength(1);
    const quiet = new MainThreadHost(world().s);
    const q = collect(quiet);
    quiet.runTicks(2);
    expect((q[0] as StateDiff).view.events.length).toBe(0);
  });

  it('keeps the NEWEST VIEW_EVENTS_CAP events in order and counts the lost ones in eventsDropped', () => {
    const { s } = world();
    const total = VIEW_EVENTS_CAP + 72;
    const host = new MainThreadHost(s, {
      stepFn: stepWith((st) => {
        for (let i = 0; i < total; i++) st.outbox.push(OUTBOX_BEACHHEAD_FORMED, st.tick, i, 0);
      }),
    });
    const diffs = collect(host);
    host.runTicks(1);
    const rows = list(diffs[0] as StateDiff);
    expect(rows).toHaveLength(VIEW_EVENTS_CAP);
    expect(rows.map((r) => r[2])).toEqual(Array.from({ length: VIEW_EVENTS_CAP }, (_, i) => 72 + i));
    expect((diffs[0] as StateDiff).view.eventsDropped).toBe(72);
    host.runTicks(1);
    expect((diffs[1] as StateDiff).view.eventsDropped).toBe(72); // a fresh span with the same overflow: the count restarted
  });
});

describe('the mirror', () => {
  it('collects the facts of several frames until the consumer clears them, keeps the newest at the cap, and the StateView answers empty', async () => {
    const { s } = world();
    let n = 0;
    const host = new MainThreadHost(s, { stepFn: stepWith((st) => st.outbox.push(OUTBOX_ELIMINATED, st.tick, n++, 0)) });
    const { mirror, stop } = await ViewMirror.attach(host);
    expect(mirror.events.length).toBe(0);
    const same = mirror.events;
    host.runTicks(1);
    host.runTicks(1);
    host.runTicks(1);
    expect(mirror.events).toBe(same); // no new object per frame
    expect([0, 1, 2].map((i) => mirror.events.aAt(i))).toEqual([0, 1, 2]);
    expect(mirror.events.kindAt(1)).toBe(OUTBOX_ELIMINATED);
    expect(mirror.events.tickAt(2) - mirror.events.tickAt(0)).toBe(2);
    expect(mirror.events.kindAt(3)).toBe(-1);
    mirror.clearEvents();
    expect(mirror.events.length).toBe(0);
    for (let i = 0; i < VIEW_EVENTS_CAP + 5; i++) host.runTicks(1); // never read: the ring keeps the newest
    expect(mirror.events.length).toBe(VIEW_EVENTS_CAP);
    expect(mirror.events.dropped).toBe(5);
    expect(mirror.events.aAt(VIEW_EVENTS_CAP - 1)).toBe(n - 1);
    expect(mirror.events.aAt(0)).toBe(n - VIEW_EVENTS_CAP);
    stop();
    expect(new StateView(world().s).events).toBe(EMPTY_VIEW_EVENTS);
  });
});

describe('hidden enemy helicopters leave no trace', () => {
  const pushes: Push = (st) => {
    st.outbox.push(OUTBOX_HELI_LAUNCHED, st.tick, 0, 1234);
    st.outbox.push(OUTBOX_HELI_DOWNED, st.tick, 0, 1);
    st.outbox.push(OUTBOX_ELIMINATED, st.tick, 3, 0);
  };

  it('the enemy viewer gets only the neutral fact while the helicopter is outside its sensors, the owner gets all three', () => {
    const enemy = new MainThreadHost(world().s, { viewerSeat: 1, stepFn: stepWith(pushes) });
    const e = collect(enemy);
    enemy.runTicks(1);
    expect(kinds(e[0] as StateDiff)).toEqual([OUTBOX_ELIMINATED]);
    const own = new MainThreadHost(world().s, { viewerSeat: 0, stepFn: stepWith(pushes) });
    const o = collect(own);
    own.runTicks(1);
    expect(kinds(o[0] as StateDiff)).toEqual([OUTBOX_HELI_LAUNCHED, OUTBOX_HELI_DOWNED, OUTBOX_ELIMINATED]);
  });

  it('the same facts go through once the helicopter is inside the viewer\'s sensor range, or the seats are allied; a viewer-less host sends all', () => {
    const w = world();
    place(w.s, w.heli, 140, 48);
    const seen = new MainThreadHost(w.s, { viewerSeat: 1, stepFn: stepWith(pushes) });
    const a = collect(seen);
    seen.runTicks(1);
    expect(kinds(a[0] as StateDiff)).toEqual([OUTBOX_HELI_LAUNCHED, OUTBOX_HELI_DOWNED, OUTBOX_ELIMINATED]);
    const w2 = world();
    w2.s.diplo.setRelation(1, 2, RELATION_ALLIANCE, 0);
    const ally = new MainThreadHost(w2.s, { viewerSeat: 1, stepFn: stepWith(pushes) });
    const b = collect(ally);
    ally.runTicks(1);
    expect(kinds(b[0] as StateDiff)).toHaveLength(3);
    const free = new MainThreadHost(world().s, { stepFn: stepWith(pushes) });
    const c = collect(free);
    free.runTicks(1);
    expect(kinds(c[0] as StateDiff)).toHaveLength(3);
  });

  it('a helicopter whose slot was freed in the step is judged by its owner before the step', () => {
    const scrap: Push = (st) => {
      st.outbox.push(OUTBOX_HELI_SCRAPPED, st.tick, 0, 2);
      st.helis.owner[0] = 0; // the slot is free when the host looks
    };
    const own = new MainThreadHost(world().s, { viewerSeat: 0, stepFn: stepWith(scrap) });
    const a = collect(own);
    own.runTicks(1);
    expect(kinds(a[0] as StateDiff)).toEqual([OUTBOX_HELI_SCRAPPED]);
    const enemy = new MainThreadHost(world().s, { viewerSeat: 1, stepFn: stepWith(scrap) });
    const b = collect(enemy);
    enemy.runTicks(1);
    expect(kinds(b[0] as StateDiff)).toEqual([]);
  });
});

describe('the state does not know the readers', () => {
  it('the hash after 60 ticks is the same with a listening mirror, with a viewer seat, and with nobody listening', async () => {
    const pushes2: Push = (st) => {
      st.outbox.push(OUTBOX_HELI_DOWNED, st.tick, 0, 1);
      st.outbox.push(OUTBOX_ELIMINATED, st.tick, 1, 0);
    };
    const run = async (opts: { viewerSeat?: number }, listen: boolean): Promise<number> => {
      const { s } = world();
      const host = new MainThreadHost(s, { ...opts, stepFn: stepWith(pushes2) });
      let stop = (): void => {};
      if (listen) stop = (await ViewMirror.attach(host)).stop;
      for (let i = 0; i < 60; i++) host.runTicks(1);
      stop();
      return hashState(s);
    };
    const bare = await run({}, false);
    expect(await run({}, true)).toBe(bare);
    expect(await run({ viewerSeat: 1 }, true)).toBe(bare);
  });
});
