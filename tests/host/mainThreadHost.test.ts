import { describe, expect, it, vi } from 'vitest';
import { MainThreadHost } from '../../src/host/mainThreadHost';
import type { HostEvent, StateDiff } from '../../src/host/protocol';
import { MAX_INTENTS_PER_TURN, TICK_MS } from '../../src/sim/rules';
import { GOLDEN_PARAMS, GOLDEN_TICKS, createScenarioState, runScenario } from '../../src/sim/scenario';
import { deserialize, hashState } from '../../src/sim/serialize';
import { createEmptyState } from '../../src/sim/state';
import { hex32 } from '../../src/sim/hash';
import { readGolden } from '../helpers/simGolden';
import { driveScenario } from './helpers';

const small = () => new MainThreadHost(createEmptyState(6, 5, 7, 4, { debugIntents: true }));
const diffsOf = (events: HostEvent[]): StateDiff[] => events.flatMap((e) => (e.type === 'diff' ? [e.diff] : []));

async function owners(host: MainThreadHost): Promise<Uint16Array> {
  const snap = await host.requestSnapshot();
  const r = deserialize(snap.bytes);
  if (!r.ok) throw new Error('bad snapshot');
  return r.state.owner;
}

describe('MainThreadHost: the T + 2 schedule', () => {
  it('an intent submitted at tick 0 runs in the step that starts at tick 2, not earlier', async () => {
    const host = small();
    const events: HostEvent[] = [];
    host.subscribe((e) => events.push(e));
    host.submitIntent({ kind: 'DebugPaint', seat: 1, cell: 4 });
    host.advance(TICK_MS); // runs turn 0
    host.advance(TICK_MS); // runs turn 1
    expect(host.tick).toBe(2);
    expect((await owners(host))[4]).toBe(0);
    expect(diffsOf(events).every((d) => d.cells.length === 0)).toBe(true);
    host.advance(TICK_MS); // runs turn 2
    expect((await owners(host))[4]).toBe(2);
    const last = diffsOf(events).at(-1) as StateDiff;
    expect([last.fromTick, last.toTick]).toEqual([2, 3]);
    expect(Array.from(last.cells)).toEqual([4]);
    expect(Array.from(last.owners)).toEqual([2]);
  });

  it('an intent submitted at tick 5 runs in turn 7', async () => {
    const host = small();
    for (let i = 0; i < 5; i++) host.advance(TICK_MS);
    host.submitIntent({ kind: 'DebugPaint', seat: 0, cell: 9 });
    host.advance(TICK_MS);
    host.advance(TICK_MS);
    expect((await owners(host))[9]).toBe(0);
    host.advance(TICK_MS);
    expect((await owners(host))[9]).toBe(1);
  });

  it('intents of one tick share a turn; the host hands out ids per seat so submission order breaks ties', async () => {
    const host = small();
    host.submitIntent({ kind: 'DebugPaint', seat: 2, cell: 3 });
    host.submitIntent({ kind: 'DebugPaint', seat: 0, cell: 3 });
    host.submitIntent({ kind: 'DebugPaint', seat: 2, cell: 3 });
    for (let i = 0; i < 3; i++) host.advance(TICK_MS);
    expect((await owners(host))[3]).toBe(3); // seat 2 sorts after seat 0 and wins
    const r = deserialize((await host.requestSnapshot()).bytes);
    if (r.ok) expect(r.state.stamp[3]).toBe(1); // the later submission of seat 2 (id 1) is applied last
  });

  it('an invalid intent is a no-op and raises the reject counter that the diff reports', () => {
    const host = small();
    const events: HostEvent[] = [];
    host.subscribe((e) => events.push(e));
    host.submitIntent({ kind: 'DebugPaint', seat: 99, cell: 1 });
    host.submitIntent({ kind: 'DebugPaint', seat: 0, cell: 1000 });
    host.submitIntent(null as never);
    host.submitIntent({ kind: 'Spawn', seat: 0 } as never);
    for (let i = 0; i < 3; i++) host.advance(TICK_MS);
    const last = diffsOf(events).at(-1) as StateDiff;
    expect(last.rejects).toBe(4);
    expect(last.cells.length).toBe(0);
  });

  it('a turn never holds more than MAX_INTENTS_PER_TURN intents: the rest is dropped and counted', () => {
    const host = small();
    for (let i = 0; i < MAX_INTENTS_PER_TURN + 5; i++) host.submitIntent({ kind: 'Noop', seat: 0 });
    expect(host.droppedIntents).toBe(5);
    for (let i = 0; i < 3; i++) host.advance(TICK_MS);
    expect(host.tick).toBe(3); // the turn with 4096 intents ran fine
  });
});

describe('MainThreadHost: time, speed and events', () => {
  it('paused runs nothing; 2x runs two ticks per 100 ms; at most 8 ticks per frame; one diff per frame', () => {
    const host = small();
    const events: HostEvent[] = [];
    host.subscribe((e) => events.push(e));
    host.setSpeed(0);
    host.advance(1000);
    expect(host.tick).toBe(0);
    host.setSpeed(2);
    host.advance(100);
    expect(host.tick).toBe(2);
    host.advance(60_000);
    expect(host.tick).toBe(10);
    const diffs = diffsOf(events);
    expect(diffs.map((d) => [d.fromTick, d.toTick])).toEqual([[0, 2], [2, 10]]);
    expect(events.filter((e) => e.type === 'speed').map((e) => (e as { speed: number }).speed)).toEqual([0, 2]);
  });

  it('invalid speeds are ignored and produce no event', () => {
    const host = small();
    const events: HostEvent[] = [];
    host.subscribe((e) => events.push(e));
    host.setSpeed(3 as never);
    host.setSpeed('fast' as never);
    expect(events).toEqual([]);
    expect(host.speed).toBe(1);
  });

  it('emits a hash event every hashEveryTicks ticks, equal to the hash of a direct run at that tick', () => {
    const host = new MainThreadHost(createScenarioState(), { hashEveryTicks: 10 });
    const hashes: Array<{ tick: number; hash: number }> = [];
    host.subscribe((e) => {
      if (e.type === 'hash') hashes.push({ tick: e.tick, hash: e.hash });
    });
    driveScenario(host, 1, 4, 8192, 35);
    const direct = createScenarioState();
    const expected = [10, 20, 30].map((tick) => {
      runScenario(direct, tick);
      return { tick, hash: hashState(direct) };
    });
    expect(hashes).toEqual(expected);
  });

  it('with several ticks in one frame, hashes are taken at the due ticks inside the frame', () => {
    const host = new MainThreadHost(createScenarioState(), { hashEveryTicks: 3, speed: 4 });
    const ticks: number[] = [];
    host.subscribe((e) => {
      if (e.type === 'hash') ticks.push(e.tick);
    });
    host.advance(200); // 8 ticks
    expect(ticks).toEqual([3, 6]);
  });

  it('a frame without ticks emits nothing', () => {
    const host = small();
    const spy = vi.fn();
    host.subscribe(spy);
    host.advance(50);
    expect(spy).not.toHaveBeenCalled();
  });

  it('unsubscribe stops delivery, dispose ends everything', () => {
    const host = small();
    const a = vi.fn();
    const b = vi.fn();
    const stopA = host.subscribe(a);
    host.subscribe(b);
    host.advance(100);
    stopA();
    host.advance(100);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
    host.dispose();
    host.advance(100);
    host.submitIntent({ kind: 'Noop', seat: 0 });
    host.setSpeed(2);
    expect(host.tick).toBe(2);
    expect(b).toHaveBeenCalledTimes(2);
  });

  it('a listener that throws does not stop the host or the other listeners', () => {
    const host = small();
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const good = vi.fn();
    host.subscribe(() => {
      throw new Error('boom');
    });
    host.subscribe(good);
    host.advance(100);
    host.advance(100);
    expect(good).toHaveBeenCalledTimes(2);
    expect(host.tick).toBe(2);
    quiet.mockRestore();
  });

  it('a listener that calls advance() inside an event does not re-enter the host', () => {
    const host = small();
    let calls = 0;
    host.subscribe(() => {
      calls++;
      host.advance(100000);
    });
    host.advance(100);
    expect(host.tick).toBe(1);
    expect(calls).toBe(1);
  });
});

describe('MainThreadHost: nothing is shared across the interface', () => {
  it('the submitted body is copied: changing it afterwards changes nothing', async () => {
    const host = small();
    const body = { kind: 'DebugPaint' as const, seat: 1, cell: 4 };
    host.submitIntent(body);
    (body as { cell: number }).cell = 20;
    (body as { seat: number }).seat = 3;
    for (let i = 0; i < 3; i++) host.advance(TICK_MS);
    const o = await owners(host);
    expect(o[4]).toBe(2);
    expect(o[20]).toBe(0);
  });

  it('every listener gets its own copy of every event; scribbling on one changes neither the others nor later events', () => {
    const host = small();
    host.submitIntent({ kind: 'DebugPaint', seat: 1, cell: 4 });
    const seenA: HostEvent[] = [];
    const seenB: HostEvent[] = [];
    host.subscribe((e) => {
      seenA.push(e);
      if (e.type === 'diff') {
        e.diff.cells.fill(77);
        e.diff.owners.fill(9);
      }
    });
    host.subscribe((e) => seenB.push(e));
    for (let i = 0; i < 3; i++) host.advance(TICK_MS);
    const a = diffsOf(seenA).at(-1) as StateDiff;
    const b = diffsOf(seenB).at(-1) as StateDiff;
    expect(a).not.toBe(b);
    expect(a.cells.buffer).not.toBe(b.cells.buffer);
    expect(Array.from(b.cells)).toEqual([4]);
    expect(Array.from(b.owners)).toEqual([2]);
  });

  it('snapshots are bytes made for the caller: scribbling on them does not touch the host, and each call is a new copy', async () => {
    const host = small();
    host.submitIntent({ kind: 'DebugPaint', seat: 1, cell: 4 });
    for (let i = 0; i < 3; i++) host.advance(TICK_MS);
    const s1 = await host.requestSnapshot();
    const s2 = await host.requestSnapshot();
    expect(s1.bytes).toEqual(s2.bytes);
    expect(s1.bytes.buffer).not.toBe(s2.bytes.buffer);
    s1.bytes.fill(0);
    const s3 = await host.requestSnapshot();
    expect(s3.bytes).toEqual(s2.bytes);
    expect(s3.hash).toBe(s2.hash);
    expect(s3.tick).toBe(3);
  });

  it('requestView() returns copies: filling the owner, terrain and stats of one view with 9 changes neither the host state nor the next view, and no buffer is the sim\'s own', async () => {
    const host = small();
    host.submitIntent({ kind: 'DebugPaint', seat: 1, cell: 4 });
    for (let i = 0; i < 3; i++) host.advance(TICK_MS);
    const state = (host as unknown as { state: { owner: Uint16Array; terrain: Uint8Array } }).state;
    const hashBefore = hashState(state as never);
    const ownerBefore = state.owner.slice();
    const terrainBefore = state.terrain.slice();
    const v1 = await host.requestView();
    const baseline = await host.requestView();
    expect(v1.owner).not.toBeNull();
    expect(v1.terrain).not.toBeNull();
    expect((v1.owner as Uint16Array).buffer).not.toBe(state.owner.buffer);
    expect((v1.terrain as Uint8Array).buffer).not.toBe(state.terrain.buffer);
    expect(v1.owner).not.toBe(baseline.owner);
    expect((v1.owner as Uint16Array).buffer).not.toBe((baseline.owner as Uint16Array).buffer);
    expect(v1.stats.buffer).not.toBe(baseline.stats.buffer);
    (v1.owner as Uint16Array).fill(9);
    (v1.terrain as Uint8Array).fill(9);
    v1.stats.fill(9);
    const v2 = await host.requestView();
    expect(Array.from(v2.owner as Uint16Array)).toEqual(Array.from(ownerBefore));
    expect(Array.from(v2.terrain as Uint8Array)).toEqual(Array.from(terrainBefore));
    expect(Array.from(v2.stats)).toEqual(Array.from(baseline.stats));
    expect(Array.from(state.owner)).toEqual(Array.from(ownerBefore));
    expect(Array.from(state.terrain)).toEqual(Array.from(terrainBefore));
    expect(hashState(state as never)).toBe(hashBefore);
  });

  // A value no statistic can hold (the regeneration of the tempo pass, D142, made the small value 9 a real troop count of some tick).
  const SCRIBBLE = 0xdeadbeef;
  it('the light view in a diff is a copy per listener: scribbling on diff.view.stats in one listener changes neither another listener\'s view nor the next view', async () => {
    const host = small();
    host.submitIntent({ kind: 'DebugPaint', seat: 1, cell: 4 });
    const seenA: HostEvent[] = [];
    const seenB: HostEvent[] = [];
    host.subscribe((e) => {
      seenA.push(e);
      if (e.type === 'diff') e.diff.view.stats.fill(SCRIBBLE);
    });
    host.subscribe((e) => seenB.push(e));
    for (let i = 0; i < 3; i++) host.advance(TICK_MS);
    const a = diffsOf(seenA).at(-1) as StateDiff;
    const b = diffsOf(seenB).at(-1) as StateDiff;
    expect(a.view.stats.buffer).not.toBe(b.view.stats.buffer);
    expect(b.view.stats.some((x) => x === SCRIBBLE)).toBe(false);
    const fresh = await host.requestView();
    expect(Array.from(b.view.stats)).toEqual(Array.from(fresh.stats));
    host.advance(TICK_MS);
    const later = diffsOf(seenB).at(-1) as StateDiff;
    expect(later.view.stats.some((x) => x === SCRIBBLE)).toBe(false);
  });

  it('every message of the SimHost interface is plain structured-cloneable data', () => {
    const host = small();
    const events: HostEvent[] = [];
    host.subscribe((e) => events.push(e));
    host.submitIntent({ kind: 'DebugPaint', seat: 1, cell: 4 });
    host.setSpeed(2);
    host.advance(1000);
    expect(events.length).toBeGreaterThan(1);
    for (const e of events) expect(structuredClone(e)).toEqual(e);
  });
});

describe('MainThreadHost runs the golden scenario', () => {
  it('driven tick by tick through submitIntent and advance it reaches the committed hashes at 1, 10, 100, 1000 and 6000', async () => {
    const golden = readGolden();
    const host = new MainThreadHost(createScenarioState());
    const got: Record<string, string> = {};
    const cells = GOLDEN_PARAMS.width * GOLDEN_PARAMS.height;
    const tickSet = new Set<number>(GOLDEN_TICKS);
    const pending: Array<Promise<void>> = [];
    driveScenario(host, GOLDEN_PARAMS.seed, GOLDEN_PARAMS.seats, cells, 6000, (tick) => {
      if (tickSet.has(tick)) pending.push(host.requestSnapshot().then((s) => void (got[String(tick)] = hex32(s.hash))));
    });
    await Promise.all(pending);
    expect(got).toEqual(golden.hashes);
  });

  it('the diff stream alone rebuilds the ownership array exactly (diffs are complete and ordered)', async () => {
    const host = new MainThreadHost(createScenarioState());
    const rebuilt = new Uint16Array(128 * 64);
    let expectFrom = 0;
    host.subscribe((e) => {
      if (e.type !== 'diff') return;
      expect(e.diff.fromTick).toBe(expectFrom);
      expectFrom = e.diff.toTick;
      for (let i = 0; i < e.diff.cells.length; i++) rebuilt[e.diff.cells[i] as number] = e.diff.owners[i] as number;
    });
    driveScenario(host, 1, 4, 8192, 1500);
    expect(rebuilt).toEqual(await owners(host));
  });
});
