// The host protocol: every value that crosses the SimHost seam. All of it is plain data (numbers, strings, typed arrays,
// arrays and plain objects) that structuredClone / postMessage can copy, so the same protocol runs between two objects of
// one thread (LocalTransport) and between a page and a Web Worker (M24a). No class instance, function or sim reference
// is ever part of a message.
import type { Intent, IntentBody } from '../sim/intents';

/** Game speed: 0 = pause, otherwise the multiple of the 10 Hz tick rate. */
export type Speed = 0 | 1 | 2 | 4;
export const SPEEDS: readonly Speed[] = [0, 1, 2, 4];

export function isSpeed(x: unknown): x is Speed {
  return x === 0 || x === 1 || x === 2 || x === 4;
}

/**
 * What changed while a frame ran its ticks: cells[i] now belongs to owners[i] (ownerId), in the order it happened.
 *
 * The list is built from the render-only outbox, which is capped. When a frame's outbox overflowed (more events in one
 * step than OUTBOX_CAPACITY) the host cannot say which cells changed: `fullOwner` is then the COMPLETE ownerId array
 * after the frame, `cells` and `owners` are empty, and a consumer must replace its whole ownership mirror with it. It is
 * null for an ordinary frame. A consumer that handles only cells/owners drifts from the sim after an overflow.
 */
export interface StateDiff {
  readonly fromTick: number;
  readonly toTick: number;
  readonly cells: Uint32Array;
  readonly owners: Uint8Array;
  /** The whole owner array after the frame when the changed-cell list is incomplete (see above), else null. */
  readonly fullOwner: Uint8Array | null;
  /** The reject counter of the state after the frame. */
  readonly rejects: number;
}

/**
 * What a host keeps OUTSIDE the game state and a restart needs: the next intent id of every seat (ids are written into
 * `state.stamp`, so they are part of the hash) and the intents already scheduled for turns the state has not run yet.
 */
export interface HostResume {
  /** The next intent id per seat (MAX_SEATS entries). */
  readonly idNext: Uint32Array;
  /** Scheduled intents, ascending by turn; every turn is >= the snapshot's tick. */
  readonly pending: ReadonlyArray<{ readonly turn: number; readonly intents: readonly Intent[] }>;
}

/**
 * A complete resume point: serialize() bytes (src/sim/serialize.ts) with their tick and hash, plus the host's own
 * bookkeeping. `MainThreadHost.resume(snapshot)` continues exactly like the straight run; `deserialize(bytes)` alone
 * gives only the state (enough to inspect or to replay with explicit turn lists).
 */
export interface Snapshot {
  readonly tick: number;
  readonly hash: number;
  readonly bytes: Uint8Array;
  readonly resume: HostResume;
}

export type HostEvent =
  | { readonly type: 'diff'; readonly diff: StateDiff }
  | { readonly type: 'hash'; readonly tick: number; readonly hash: number }
  | { readonly type: 'speed'; readonly speed: Speed };

/** A deep copy of an event: nothing is shared with the original. */
export function cloneEvent(e: HostEvent): HostEvent {
  if (e.type === 'diff') {
    const d = e.diff;
    return {
      type: 'diff',
      diff: { fromTick: d.fromTick, toTick: d.toTick, cells: d.cells.slice(), owners: d.owners.slice(), fullOwner: d.fullOwner === null ? null : d.fullOwner.slice(), rejects: d.rejects },
    };
  }
  return e.type === 'hash' ? { type: 'hash', tick: e.tick, hash: e.hash } : { type: 'speed', speed: e.speed };
}

export type HostListener = (event: HostEvent) => void;
export type Unsubscribe = () => void;

/**
 * What the UI, the AI driver and (later) the network see of the simulation. Every method takes and returns copies, and
 * the host never reads a clock: the caller says how much time has passed (`advance`). A host in a Worker implements the
 * same interface behind a message port (RemoteHost).
 */
export interface SimHost {
  /** Schedules an intent of a seat for turn T + 2 (T = the host's current tick). The host copies it and hands out its id. */
  submitIntent(body: IntentBody): void;
  setSpeed(speed: Speed): void;
  /** Tells the host that `dtMs` milliseconds of real time passed; it runs the ticks that are due (at most 8 per call). */
  advance(dtMs: number): void;
  /** Events: one diff per advance() that ran ticks, hashes at the configured interval, speed changes. Every listener gets its own copy. */
  subscribe(listener: HostListener): Unsubscribe;
  /** A complete copy of the current state. */
  requestSnapshot(): Promise<Snapshot>;
  dispose(): void;
}

export type ClientMessage =
  | { readonly type: 'submit'; readonly body: IntentBody }
  | { readonly type: 'speed'; readonly speed: Speed }
  | { readonly type: 'advance'; readonly dtMs: number }
  | { readonly type: 'snapshot'; readonly requestId: number }
  | { readonly type: 'dispose' };

export type HostMessage =
  | { readonly type: 'event'; readonly event: HostEvent }
  | { readonly type: 'snapshot'; readonly requestId: number; readonly snapshot: Snapshot }
  | { readonly type: 'error'; readonly message: string };

/** One end of a message channel: post sends a copy, handlers receive copies. `transfer` lists buffers to move, not copy. */
export interface Port<Send, Receive> {
  post(message: Send, transfer?: ArrayBuffer[]): void;
  onMessage(handler: (message: Receive) => void): Unsubscribe;
  close(): void;
}
