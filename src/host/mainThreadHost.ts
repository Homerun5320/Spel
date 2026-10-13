// MainThreadHost: the simulation in the page's own thread behind the SimHost interface.
//
// It owns one GameState and nothing else may touch it. Everything that leaves the host is a copy: events are cloned once per
// listener, snapshots are serialised bytes, and intents are copied on the way in. Swapping this class for a Worker behind a
// message port (M24a) must not change a single caller.
import { IdAllocator, copyBody, withId, type Intent, type IntentBody } from '../sim/intents';
import { OUTBOX_PAINT } from '../sim/outbox';
import { MAX_INTENTS_PER_TURN } from '../sim/rules';
import { hashState, serialize } from '../sim/serialize';
import { step, type StepFn } from '../sim/step';
import type { GameState } from '../sim/state';
import { scheduledTurn } from '../sim/time';
import { FixedStepAccumulator } from './accumulator';
import { cloneEvent, isSpeed, type HostEvent, type HostListener, type SimHost, type Snapshot, type Speed, type StateDiff, type Unsubscribe } from './protocol';

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
  private readonly ids = new IdAllocator();
  private readonly stepFn: StepFn;
  private readonly hashEvery: number;
  private readonly pending = new Map<number, Intent[]>();
  private listeners: HostListener[] = [];
  private advancing = false;
  private disposed = false;
  /** Intents dropped because their turn already held MAX_INTENTS_PER_TURN of them. */
  droppedIntents = 0;

  /** Takes over `state`: after this call only the host may use it. */
  constructor(state: GameState, options: MainThreadHostOptions = {}) {
    this.state = state;
    this.stepFn = options.stepFn ?? step;
    this.hashEvery = options.hashEveryTicks !== undefined && options.hashEveryTicks > 0 ? Math.floor(options.hashEveryTicks) : 0;
    if (options.speed !== undefined) this.accumulator.setSpeed(options.speed);
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
    for (let n = 0; n < count; n++) {
      const turn = this.state.tick;
      const intents = this.pending.get(turn) ?? [];
      this.pending.delete(turn);
      const result = this.stepFn(this.state, { turn, intents });
      if (!result.ok) {
        // Cannot happen with turn = state.tick and a bounded list; stop rather than run on a broken state.
        break;
      }
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
      cells: Uint32Array.from(cells),
      owners: Uint8Array.from(owners),
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
    return Promise.resolve({ tick: this.state.tick, hash: hashState(this.state), bytes: serialize(this.state) });
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
