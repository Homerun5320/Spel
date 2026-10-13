// The host protocol: every value that crosses the SimHost seam. All of it is plain data (numbers, strings, typed arrays,
// arrays and plain objects) that structuredClone / postMessage can copy, so the same protocol runs between two objects of
// one thread (LocalTransport) and between a page and a Web Worker (M24a). No class instance, function or sim reference
// is ever part of a message.
import type { IntentBody } from '../sim/intents';

/** Game speed: 0 = pause, otherwise the multiple of the 10 Hz tick rate. */
export type Speed = 0 | 1 | 2 | 4;
export const SPEEDS: readonly Speed[] = [0, 1, 2, 4];

export function isSpeed(x: unknown): x is Speed {
  return x === 0 || x === 1 || x === 2 || x === 4;
}

/** What changed while a frame ran its ticks: cells[i] now belongs to owners[i] (ownerId), in the order it happened. */
export interface StateDiff {
  readonly fromTick: number;
  readonly toTick: number;
  readonly cells: Uint32Array;
  readonly owners: Uint8Array;
  /** The reject counter of the state after the frame. */
  readonly rejects: number;
}

/** A complete copy of the state: serialize() bytes (src/sim/serialize.ts) with their tick and hash. */
export interface Snapshot {
  readonly tick: number;
  readonly hash: number;
  readonly bytes: Uint8Array;
}

export type HostEvent =
  | { readonly type: 'diff'; readonly diff: StateDiff }
  | { readonly type: 'hash'; readonly tick: number; readonly hash: number }
  | { readonly type: 'speed'; readonly speed: Speed };

/** A deep copy of an event: nothing is shared with the original. */
export function cloneEvent(e: HostEvent): HostEvent {
  if (e.type === 'diff') {
    const d = e.diff;
    return { type: 'diff', diff: { fromTick: d.fromTick, toTick: d.toTick, cells: d.cells.slice(), owners: d.owners.slice(), rejects: d.rejects } };
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
