// The host seam as a resume point (a snapshot carries the id counters and the scheduled turns, not only the state) and the
// ownership diff when the render-only outbox overflows.
import { describe, expect, it } from 'vitest';
import { MainThreadHost } from '../../src/host/mainThreadHost';
import { cloneEvent, type ClientMessage, type HostEvent, type HostMessage, type Snapshot, type StateDiff } from '../../src/host/protocol';
import { RemoteHost, serveHost } from '../../src/host/remote';
import { createLocalTransport } from '../../src/host/transport';
import { hex32 } from '../../src/sim/hash';
import { OUTBOX_CAPACITY } from '../../src/sim/outbox';
import { TICK_MS } from '../../src/sim/rules';
import { GOLDEN_PARAMS, createScenarioState, scenarioBodies } from '../../src/sim/scenario';
import { deserialize, hashState } from '../../src/sim/serialize';
import { MAX_SEATS, createEmptyState } from '../../src/sim/state';
import { step } from '../../src/sim/step';
import { readGolden } from '../helpers/simGolden';
import { driveScenario } from './helpers';

const CELLS = GOLDEN_PARAMS.width * GOLDEN_PARAMS.height;
// M12a-2: the golden scenario world carries the occluder layer (LaunchHeli needs it), and a restored host must be handed the same layer.
const ELEV = { maxElev: createScenarioState().env.maxElev as Int16Array };
const drive = (host: MainThreadHost, ticks: number): void => driveScenario(host, GOLDEN_PARAMS.seed, GOLDEN_PARAMS.seats, CELLS, ticks);

describe('a snapshot is a resume point of the host', () => {
  const golden = readGolden();

  it('snapshot at tick 3000, MainThreadHost.resume, 3000 more ticks of the script: the golden hash of tick 6000', async () => {
    const host = new MainThreadHost(createScenarioState());
    drive(host, 3000);
    const snap = await host.requestSnapshot();
    expect(snap.tick).toBe(3000);
    const resumed = MainThreadHost.resume(snap, ELEV);
    expect(resumed).not.toBeNull();
    if (resumed === null) return;
    expect(resumed.tick).toBe(3000);
    drive(resumed, 3000);
    const end = await resumed.requestSnapshot();
    expect(hex32(end.hash)).toBe(golden.hashes['6000']);
    // ... and the original, carried on in parallel, is in the same place.
    drive(host, 3000);
    expect((await host.requestSnapshot()).hash).toBe(end.hash);
  });

  it.each([1, 2, 3, 17, 999, 2501])('resuming at tick %i reaches the golden hash of tick 6000 (every phase of the T + 2 pipeline)', async (k) => {
    const host = new MainThreadHost(createScenarioState());
    drive(host, k);
    const resumed = MainThreadHost.resume(await host.requestSnapshot(), ELEV);
    if (resumed === null) throw new Error('resume failed');
    drive(resumed, 6000 - k);
    expect(hex32((await resumed.requestSnapshot()).hash)).toBe(golden.hashes['6000']);
  });

  it('WITHOUT the host part the same bytes diverge (why the snapshot carries it): state alone is not a resume point', async () => {
    const host = new MainThreadHost(createScenarioState());
    drive(host, 3000);
    const snap = await host.requestSnapshot();
    const r = deserialize(snap.bytes);
    if (!r.ok) throw new Error('bad snapshot');
    const bare = new MainThreadHost(r.state);
    drive(bare, 3000);
    expect(hex32((await bare.requestSnapshot()).hash)).not.toBe(golden.hashes['6000']);
    // Carrying only the id counters is not enough either: the scheduled turns matter too.
    const idsOnly = MainThreadHost.resume({ ...snap, resume: { idNext: snap.resume.idNext, pending: [] } });
    if (idsOnly === null) throw new Error('resume failed');
    drive(idsOnly, 3000);
    expect(hex32((await idsOnly.requestSnapshot()).hash)).not.toBe(golden.hashes['6000']);
  });

  it('the resume part holds the id counters and the scheduled turns (>= the snapshot tick, ascending), as plain data', async () => {
    const host = new MainThreadHost(createScenarioState());
    drive(host, 40);
    const snap = await host.requestSnapshot();
    expect(snap.resume.idNext).toBeInstanceOf(Uint32Array);
    expect(snap.resume.idNext.length).toBe(MAX_SEATS);
    expect(snap.resume.idNext.some((n) => n > 0)).toBe(true);
    expect(snap.resume.idNext.slice(GOLDEN_PARAMS.seats + 3).every((n) => n === 0)).toBe(true); // the script's invalid seats are 4..6
    const turns = snap.resume.pending.map((t) => t.turn);
    expect(turns).toEqual([...turns].sort((a, b) => a - b));
    expect(turns.every((t) => t >= 40 && t <= 41)).toBe(true);
    // Exactly what the script scheduled for turns 40 and 41, with ids.
    const expected = [40, 41].filter((t) => scenarioBodies(1, t, 4, CELLS).length > 0);
    expect(turns).toEqual(expected);
    expect(structuredClone(snap)).toEqual(snap);
  });

  it('a snapshot is a copy: scribbling on it changes neither the host nor the next snapshot', async () => {
    const host = new MainThreadHost(createScenarioState());
    drive(host, 40);
    const a = await host.requestSnapshot();
    a.resume.idNext.fill(7);
    for (const t of a.resume.pending) (t.intents as unknown as unknown[]).length = 0;
    const b = await host.requestSnapshot();
    expect(b.resume.idNext.every((n) => n !== 7)).toBe(true);
    const c = MainThreadHost.resume(b, ELEV);
    if (c === null) throw new Error('resume failed');
    drive(c, 5960);
    expect(hex32((await c.requestSnapshot()).hash)).toBe(golden.hashes['6000']);
  });

  it('works through a RemoteHost: the snapshot that crossed LocalTransport resumes into the golden run', async () => {
    const transport = createLocalTransport<ClientMessage, HostMessage>();
    serveHost(new MainThreadHost(createScenarioState()), transport.host);
    const remote = new RemoteHost(transport.client);
    for (let tick = 0; tick < 2000; tick++) {
      for (const b of scenarioBodies(1, tick + 2, 4, CELLS)) remote.submitIntent(b);
      remote.advance(TICK_MS);
    }
    const snap = await remote.requestSnapshot();
    const resumed = MainThreadHost.resume(snap, ELEV);
    if (resumed === null) throw new Error('resume failed');
    drive(resumed, 4000);
    expect(hex32((await resumed.requestSnapshot()).hash)).toBe(golden.hashes['6000']);
  });

  it('a resumed host keeps its options (speed, hash events) and emits a diff that starts at the snapshot tick', async () => {
    const host = new MainThreadHost(createScenarioState());
    drive(host, 50);
    const resumed = MainThreadHost.resume(await host.requestSnapshot(), { hashEveryTicks: 10, ...ELEV });
    if (resumed === null) throw new Error('resume failed');
    const events: HostEvent[] = [];
    resumed.subscribe((e) => events.push(e));
    drive(resumed, 20);
    const hashes = events.filter((e) => e.type === 'hash').map((e) => (e as { tick: number }).tick);
    expect(hashes).toEqual([60, 70]);
    const firstDiff = events.find((e) => e.type === 'diff') as { diff: StateDiff };
    expect(firstDiff.diff.fromTick).toBe(50);
  });

  describe('resume refuses what is not a sound snapshot (null, never a throw)', () => {
    const make = async (): Promise<Snapshot> => {
      const host = new MainThreadHost(createScenarioState());
      drive(host, 30);
      return host.requestSnapshot();
    };

    it('bad bytes, a wrong tick, a wrong hash', async () => {
      const snap = await make();
      expect(MainThreadHost.resume({ ...snap, bytes: new Uint8Array(10) })).toBeNull();
      const flipped = snap.bytes.slice();
      flipped[100] = (flipped[100] as number) ^ 1;
      expect(MainThreadHost.resume({ ...snap, bytes: flipped })).toBeNull();
      expect(MainThreadHost.resume({ ...snap, tick: snap.tick + 1 })).toBeNull();
      expect(MainThreadHost.resume({ ...snap, hash: (snap.hash ^ 1) >>> 0 })).toBeNull();
      expect(MainThreadHost.resume(null as never)).toBeNull();
      expect(MainThreadHost.resume({} as never)).toBeNull();
    });

    it('a resume part of the wrong shape', async () => {
      const snap = await make();
      const bad = (resume: unknown): Snapshot => ({ ...snap, resume: resume as never });
      const turn = snap.tick + 2;
      expect(MainThreadHost.resume(bad(undefined))).toBeNull();
      expect(MainThreadHost.resume(bad(null))).toBeNull();
      expect(MainThreadHost.resume(bad({ idNext: new Uint32Array(3), pending: [] }))).toBeNull();
      expect(MainThreadHost.resume(bad({ idNext: [0], pending: [] }))).toBeNull();
      expect(MainThreadHost.resume(bad({ idNext: new Uint32Array(MAX_SEATS), pending: 'x' }))).toBeNull();
      expect(MainThreadHost.resume(bad({ idNext: new Uint32Array(MAX_SEATS), pending: [{ turn: snap.tick - 1, intents: [] }] }))).toBeNull();
      expect(MainThreadHost.resume(bad({ idNext: new Uint32Array(MAX_SEATS), pending: [{ turn, intents: [] }, { turn, intents: [] }] }))).toBeNull();
      expect(MainThreadHost.resume(bad({ idNext: new Uint32Array(MAX_SEATS), pending: [{ turn: 1.5, intents: [] }] }))).toBeNull();
      expect(MainThreadHost.resume(bad({ idNext: new Uint32Array(MAX_SEATS), pending: [{ turn, intents: 'x' }] }))).toBeNull();
      expect(MainThreadHost.resume(bad({ idNext: new Uint32Array(MAX_SEATS), pending: [{ turn, intents: [null] }] }))).toBeNull();
      expect(MainThreadHost.resume(bad({ idNext: new Uint32Array(MAX_SEATS), pending: [{ turn, intents: [{ kind: 'Noop', seat: 0, id: 'x' }] }] }))).toBeNull();
      expect(MainThreadHost.resume(bad({ idNext: new Uint32Array(MAX_SEATS), pending: [{ turn, intents: [] }] }))).not.toBeNull();
    });

    it('hostile intents inside a sound snapshot are refused by step like any other input', async () => {
      const snap = await make();
      const junk = [{ kind: 'Spawn', seat: 0, id: 0 }, { kind: 'DebugPaint', seat: 99, cell: 1, id: 1 }, { kind: 'Noop', seat: 0, id: 1.5 }];
      const host = MainThreadHost.resume({ ...snap, resume: { idNext: snap.resume.idNext, pending: [{ turn: 30, intents: junk as never }] } });
      if (host === null) throw new Error('resume failed');
      host.advance(TICK_MS);
      expect((await host.requestSnapshot()).tick).toBe(31);
      const r = deserialize((await host.requestSnapshot()).bytes);
      expect(r.ok && r.state.rejects).toBeGreaterThanOrEqual(3);
    });
  });
});

describe('the ownership diff survives an outbox overflow', () => {
  const OVER = OUTBOX_CAPACITY + 500;

  /** A step that paints `count` cells (owner 1) of its first `count` cells and mirrors each into the outbox, like a rule would. */
  const painter = (count: number, atTick = 0) => (state: Parameters<typeof step>[0], turn: Parameters<typeof step>[1]) => {
    if (state.tick === atTick) {
      for (let c = 0; c < count; c++) {
        state.owner[c] = 1;
        state.outbox.push(1, state.tick, c, 1);
      }
    }
    return step(state, turn);
  };

  it('more paints in one step than the outbox holds: the diff is flagged and carries the whole owner array', () => {
    const state = createEmptyState(256, 128, 1, 2);
    const host = new MainThreadHost(state, { stepFn: painter(OVER) });
    const diffs: StateDiff[] = [];
    host.subscribe((e) => {
      if (e.type === 'diff') diffs.push(e.diff);
    });
    host.runTicks(1);
    expect(diffs).toHaveLength(1);
    const d = diffs[0] as StateDiff;
    expect(d.fullOwner).not.toBeNull();
    expect(d.fullOwner?.length).toBe(256 * 128);
    expect(d.cells.length).toBe(0);
    expect(d.owners.length).toBe(0);
    let painted = 0;
    for (const o of d.fullOwner as Uint16Array) painted += o === 1 ? 1 : 0;
    expect(painted).toBe(OVER); // every cell, including the ones the outbox had to drop
    expect(d.fullOwner?.[OVER - 1]).toBe(1);
  });

  it('a mirror that applies fullOwner when present never drifts from the state, across overflowing and ordinary frames', async () => {
    const state = createEmptyState(256, 128, 1, 2, { debugIntents: true });
    const host = new MainThreadHost(state, { stepFn: painter(OVER, 3) });
    const mirror = new Uint16Array(256 * 128);
    let flagged = 0;
    host.subscribe((e) => {
      if (e.type !== 'diff') return;
      if (e.diff.fullOwner !== null) {
        mirror.set(e.diff.fullOwner);
        flagged++;
      } else {
        for (let i = 0; i < e.diff.cells.length; i++) mirror[e.diff.cells[i] as number] = e.diff.owners[i] as number;
      }
    });
    host.submitIntent({ kind: 'DebugPaint', seat: 1, cell: 20000 }); // runs at tick 2, an ordinary frame
    host.submitIntent({ kind: 'DebugPaint', seat: 1, cell: 20001 });
    host.runTicks(3); // ticks 0..2, ordinary
    expect(flagged).toBe(0);
    host.runTicks(1); // tick 3: overflow
    expect(flagged).toBe(1);
    host.submitIntent({ kind: 'DebugPaint', seat: 1, cell: 30000 });
    host.runTicks(4); // ordinary again; the intent runs at tick 5
    const r = deserialize((await host.requestSnapshot()).bytes);
    if (!r.ok) throw new Error('bad snapshot');
    expect(mirror).toEqual(r.state.owner);
    expect(mirror[30000]).toBe(2);
  });

  it('an overflow in the middle of a multi-tick frame flags the whole frame', () => {
    const state = createEmptyState(256, 128, 1, 2);
    const host = new MainThreadHost(state, { stepFn: painter(OVER, 2) });
    const diffs: StateDiff[] = [];
    host.subscribe((e) => {
      if (e.type === 'diff') diffs.push(e.diff);
    });
    host.runTicks(5);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]?.fullOwner).not.toBeNull();
    expect([diffs[0]?.fromTick, diffs[0]?.toTick]).toEqual([0, 5]);
  });

  it('exactly OUTBOX_CAPACITY paints fit and need no resync; one more does', () => {
    for (const [count, flagged] of [[OUTBOX_CAPACITY, false], [OUTBOX_CAPACITY + 1, true]] as const) {
      const host = new MainThreadHost(createEmptyState(256, 128, 1, 2), { stepFn: painter(count) });
      const diffs: StateDiff[] = [];
      host.subscribe((e) => {
        if (e.type === 'diff') diffs.push(e.diff);
      });
      host.runTicks(1);
      const d = diffs[0] as StateDiff;
      expect(d.fullOwner !== null).toBe(flagged);
      if (!flagged) expect(d.cells.length).toBe(OUTBOX_CAPACITY);
    }
  });

  it('an ordinary run (the golden script) never sets fullOwner', () => {
    const host = new MainThreadHost(createScenarioState());
    let seen = 0;
    host.subscribe((e) => {
      if (e.type !== 'diff') return;
      seen++;
      expect(e.diff.fullOwner).toBeNull();
    });
    drive(host, 600);
    expect(seen).toBe(600);
  });

  it('fullOwner crosses LocalTransport and cloneEvent as a private copy', async () => {
    const state = createEmptyState(256, 128, 1, 2);
    const transport = createLocalTransport<ClientMessage, HostMessage>();
    const host = new MainThreadHost(state, { stepFn: painter(OVER) });
    serveHost(host, transport.host);
    const remote = new RemoteHost(transport.client);
    const got: StateDiff[] = [];
    remote.subscribe((e) => {
      if (e.type === 'diff') got.push(e.diff);
    });
    remote.advance(TICK_MS);
    await transport.idle();
    expect(got).toHaveLength(1);
    const d = got[0] as StateDiff;
    expect(d.fullOwner?.length).toBe(256 * 128);
    expect(d.fullOwner?.[OVER - 1]).toBe(1);
    const copy = cloneEvent({ type: 'diff', diff: d });
    expect(copy.type === 'diff' && copy.diff.fullOwner).toEqual(d.fullOwner);
    expect(copy.type === 'diff' && copy.diff.fullOwner?.buffer).not.toBe(d.fullOwner?.buffer);
    expect(hashState(state)).toBeGreaterThan(-1);
  });
});
