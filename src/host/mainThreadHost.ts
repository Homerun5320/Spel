// MainThreadHost: the simulation in the page's own thread behind the SimHost interface.
//
// It owns one GameState and nothing else may touch it. Everything that leaves the host is a copy: events are cloned once per
// listener, snapshots are serialised bytes, and intents are copied on the way in. Swapping this class for a Worker behind a
// message port (M24a) must not change a single caller.
import { IdAllocator, copyBody, withId, type Intent, type IntentBody } from '../sim/intents';
import { OUTBOX_PAINT, OUTBOX_REJECT } from '../sim/outbox';
import { MAX_INTENTS_PER_TURN } from '../sim/rules';
import { deserialize, hashState, serialize } from '../sim/serialize';
import { step, type StepFn } from '../sim/step';
import { MAX_SEATS, type GameState } from '../sim/state';
import { snapshotStructures, structureSignature } from './structureSnapshot';
import { StateView, attackPairs, fillSeatStats, statsLength, type SimView } from '../sim/view';
import { scheduledTurn } from '../sim/time';
import { FixedStepAccumulator } from './accumulator';
import {
  cloneEvent,
  isSpeed,
  type HostEvent,
  type HostListener,
  type HostResume,
  type SimHost,
  type Snapshot,
  type Speed,
  type StateDiff,
  type Unsubscribe,
  type StructureSnapshot,
  type ViewSnapshot,
} from './protocol';

/**
 * Code that runs in the sim's own thread at every tick boundary and answers with intents (the AI, src/host/aiDriver.ts). It is
 * handed a read-only SimView over the live state (statistics refreshed for this tick) and a `submit` that files an intent for
 * T + 2 exactly like a player's. It never sees the state itself.
 */
export interface TickDriver {
  onTick(view: SimView, submit: (body: IntentBody) => void): void;
}

export interface MainThreadHostOptions {
  /** Called before every tick (default: none). */
  readonly driver?: TickDriver;
  /** Initial speed (default 1). */
  readonly speed?: Speed;
  /** Emit a 'hash' event every this many ticks (0 = never, the default). Hashing a 1024x512 state costs a few ms. */
  readonly hashEveryTicks?: number;
  /** The step function (default: the real one). A test passes a broken copy to prove the golden check notices. */
  readonly stepFn?: StepFn;
}

export class MainThreadHost implements SimHost {
  private readonly state: GameState;
  private readonly accumulator = new FixedStepAccumulator();
  private readonly ids: IdAllocator;
  private readonly stepFn: StepFn;
  private readonly hashEvery: number;
  private readonly pending = new Map<number, Intent[]>();
  private listeners: HostListener[] = [];
  private advancing = false;
  private disposed = false;
  /** Intents dropped because their turn already held MAX_INTENTS_PER_TURN of them. */
  droppedIntents = 0;
  /** The most recent refusal seen in the outbox (REJECT_* code and the tick of the step), for the view snapshots. */
  private lastRejectReason = 0;
  private lastRejectTick = -1;
  /** The fingerprint of the structure table in the last diff that carried it (-1 = none yet): a diff carries the table only when it changed. */
  private lastStructSig = -1;
  /** Reused for the statistics of every view (the snapshot gets a copy). */
  private readonly statsScratch: Uint32Array;
  private readonly driver: TickDriver | null;
  /** The read-only window the driver reads (null without a driver). */
  private readonly driverView: StateView | null;
  private readonly submitBound = (body: IntentBody): void => this.submitIntent(body);

  /**
   * Takes over `state`: after this call only the host may use it. `resume` (what `requestSnapshot` hands out, already
   * checked by `MainThreadHost.resume`) restores the id counters and the scheduled turns; without it the host starts clean.
   */
  constructor(state: GameState, options: MainThreadHostOptions = {}, resume?: HostResume) {
    this.state = state;
    this.ids = new IdAllocator(resume?.idNext);
    if (resume !== undefined) for (const t of resume.pending) this.pending.set(t.turn, t.intents.map(copyIntent));
    this.statsScratch = new Uint32Array(statsLength(state.header.seats));
    this.driver = options.driver ?? null;
    this.driverView = this.driver === null ? null : new StateView(state);
    this.stepFn = options.stepFn ?? step;
    this.hashEvery = options.hashEveryTicks !== undefined && options.hashEveryTicks > 0 ? Math.floor(options.hashEveryTicks) : 0;
    if (options.speed !== undefined) this.accumulator.setSpeed(options.speed);
  }

  /**
   * A host that continues from a snapshot exactly as the original would have. Returns null when the snapshot is not
   * sound: bytes that do not deserialize, a tick or hash that does not match them, or a resume part of the wrong shape.
   */
  static resume(snapshot: Snapshot, options: MainThreadHostOptions = {}): MainThreadHost | null {
    if (typeof snapshot !== 'object' || snapshot === null) return null;
    const r = deserialize(snapshot.bytes);
    if (!r.ok || r.state.tick !== snapshot.tick || hashState(r.state) !== snapshot.hash) return null;
    if (!validResume(snapshot.resume, r.state.tick)) return null;
    return new MainThreadHost(r.state, options, snapshot.resume);
  }

  /** Current tick (a read-only convenience of the main-thread host; a remote host learns it from diffs). */
  get tick(): number {
    return this.state.tick;
  }

  get speed(): Speed {
    return this.accumulator.speed;
  }

  submitIntent(body: IntentBody): void {
    if (this.disposed) return;
    const copy = copyBody(body);
    const turn = scheduledTurn(this.state.tick);
    let list = this.pending.get(turn);
    if (list === undefined) {
      list = [];
      this.pending.set(turn, list);
    }
    if (list.length >= MAX_INTENTS_PER_TURN) {
      this.droppedIntents++;
      return;
    }
    list.push(withId(copy, this.ids.alloc(copy.seat)));
  }

  setSpeed(speed: Speed): void {
    if (this.disposed || !isSpeed(speed)) return;
    if (this.accumulator.setSpeed(speed)) this.emit({ type: 'speed', speed });
  }

  advance(dtMs: number): void {
    if (this.disposed || this.advancing) return;
    const due = this.accumulator.advance(dtMs);
    if (due === 0) return;
    this.advancing = true;
    try {
      this.runTicks(due);
    } finally {
      this.advancing = false;
    }
  }

  /** Runs `count` ticks and emits the diff (and due hashes) once. Public for tests that drive ticks without a clock. */
  runTicks(count: number): void {
    const fromTick = this.state.tick;
    const cells: number[] = [];
    const owners: number[] = [];
    const hashes: HostEvent[] = [];
    let overflowed = false;
    for (let n = 0; n < count; n++) {
      const turn = this.state.tick;
      if (this.driver !== null && this.driverView !== null) {
        // Tick boundary: the state is exactly the end of the previous tick; whatever the driver sends runs at turn + 2.
        this.driverView.refresh();
        this.driver.onTick(this.driverView, this.submitBound);
      }
      const intents = this.pending.get(turn) ?? [];
      this.pending.delete(turn);
      const result = this.stepFn(this.state, { turn, intents });
      if (!result.ok) {
        // Cannot happen with turn = state.tick and a bounded list; stop rather than run on a broken state.
        break;
      }
      // A capped outbox may have dropped paints: then the list of changed cells is incomplete (see StateDiff.fullOwner).
      if (this.state.outbox.dropped > 0) overflowed = true;
      for (const ev of this.state.outbox.drain()) {
        if (ev.kind === OUTBOX_PAINT) {
          cells.push(ev.a);
          owners.push(ev.b);
        } else if (ev.kind === OUTBOX_REJECT) {
          this.lastRejectReason = ev.a;
          this.lastRejectTick = ev.tick;
        }
      }
      if (this.hashEvery > 0 && this.state.tick % this.hashEvery === 0) {
        hashes.push({ type: 'hash', tick: this.state.tick, hash: hashState(this.state) });
      }
    }
    const diff: StateDiff = {
      fromTick,
      toTick: this.state.tick,
      cells: overflowed ? new Uint32Array(0) : Uint32Array.from(cells),
      owners: overflowed ? new Uint16Array(0) : Uint16Array.from(owners),
      fullOwner: overflowed ? this.state.owner.slice() : null,
      rejects: this.state.rejects,
      view: this.buildView(false),
    };
    if (diff.toTick === fromTick) return;
    this.emit({ type: 'diff', diff });
    for (const h of hashes) this.emit(h);
  }

  /** The light view of the state; `full` adds copies of the owner array and the terrain layer. */
  private buildView(full: boolean): ViewSnapshot {
    const s = this.state;
    fillSeatStats(s, this.statsScratch);
    return {
      tick: s.tick,
      rejects: s.rejects,
      lastRejectReason: this.lastRejectReason,
      lastRejectTick: this.lastRejectTick,
      width: s.width,
      height: s.height,
      seats: s.header.seats,
      players: s.header.players,
      flow: s.header.config.spawnPhase === true,
      debugIntents: s.header.config.debugIntents,
      stats: this.statsScratch.slice(),
      attacks: attackPairs(s),
      owner: full ? s.owner.slice() : null,
      terrain: full ? s.terrain.slice() : null,
      structures: full ? snapshotStructures(s.structures) : this.changedStructures(),
    };
  }

  /** The structure table when it differs from the one the last diff carried, else null (the signature costs one pass over the used slots). */
  private changedStructures(): StructureSnapshot | null {
    const sig = structureSignature(this.state.structures);
    if (sig === this.lastStructSig) return null;
    this.lastStructSig = sig;
    return snapshotStructures(this.state.structures);
  }

  requestView(): Promise<ViewSnapshot> {
    return Promise.resolve(this.buildView(true));
  }

  subscribe(listener: HostListener): Unsubscribe {
    this.listeners = [...this.listeners, listener];
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  requestSnapshot(): Promise<Snapshot> {
    const pending = [...this.pending.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([turn, intents]) => ({ turn, intents: intents.map(copyIntent) }));
    const resume: HostResume = { idNext: this.ids.counters(), pending };
    return Promise.resolve({ tick: this.state.tick, hash: hashState(this.state), bytes: serialize(this.state), resume });
  }

  dispose(): void {
    this.disposed = true;
    this.listeners = [];
    this.pending.clear();
  }

  private emit(event: HostEvent): void {
    for (const l of this.listeners) {
      try {
        l(cloneEvent(event));
      } catch (err) {
        // A broken listener must not stop the simulation or starve the other listeners.
        console.error('[sim host] listener threw', err);
      }
    }
  }
}

/** A fresh copy of a scheduled intent (the host never hands out or keeps a reference to its own list). */
function copyIntent(x: Intent): Intent {
  return withId(copyBody(x), x.id);
}

/** Is `r` a resume part this host could have produced for a state at `tick`? */
function validResume(r: unknown, tick: number): r is HostResume {
  if (typeof r !== 'object' || r === null) return false;
  const o = r as { idNext?: unknown; pending?: unknown };
  if (!(o.idNext instanceof Uint32Array) || o.idNext.length !== MAX_SEATS) return false;
  if (!Array.isArray(o.pending)) return false;
  let last = -1;
  for (const t of o.pending as unknown[]) {
    if (typeof t !== 'object' || t === null) return false;
    const e = t as { turn?: unknown; intents?: unknown };
    if (typeof e.turn !== 'number' || !Number.isInteger(e.turn) || e.turn < tick || e.turn <= last || e.turn > 4294967295) return false;
    if (!Array.isArray(e.intents) || e.intents.length > MAX_INTENTS_PER_TURN) return false;
    for (const i of e.intents as unknown[]) {
      if (typeof i !== 'object' || i === null || typeof (i as { id?: unknown }).id !== 'number') return false;
    }
    last = e.turn;
  }
  return true;
}
