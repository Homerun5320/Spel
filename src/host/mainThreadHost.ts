// MainThreadHost: the simulation in the page's own thread behind the SimHost interface.
//
// It owns one GameState and nothing else may touch it. Everything that leaves the host is a copy: events are cloned once per
// listener, snapshots are serialised bytes, and intents are copied on the way in. Swapping this class for a Worker behind a
// message port (M24a) must not change a single caller.
import { IdAllocator, copyBody, withId, type Intent, type IntentBody } from '../sim/intents';
import { OUTBOX_PAINT } from '../sim/outbox';
import { MAX_INTENTS_PER_TURN } from '../sim/rules';
import { deserialize, hashState, serialize } from '../sim/serialize';
import { step, type StepFn } from '../sim/step';
import { MAX_SEATS, type GameState } from '../sim/state';
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
} from './protocol';

export interface MainThreadHostOptions {
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

  /**
   * Takes over `state`: after this call only the host may use it. `resume` (what `requestSnapshot` hands out, already
   * checked by `MainThreadHost.resume`) restores the id counters and the scheduled turns; without it the host starts clean.
   */
  constructor(state: GameState, options: MainThreadHostOptions = {}, resume?: HostResume) {
    this.state = state;
    this.ids = new IdAllocator(resume?.idNext);
    if (resume !== undefined) for (const t of resume.pending) this.pending.set(t.turn, t.intents.map(copyIntent));
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
      owners: overflowed ? new Uint8Array(0) : Uint8Array.from(owners),
      fullOwner: overflowed ? this.state.owner.slice() : null,
      rejects: this.state.rejects,
    };
    if (diff.toTick === fromTick) return;
    this.emit({ type: 'diff', diff });
    for (const h of hashes) this.emit(h);
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
