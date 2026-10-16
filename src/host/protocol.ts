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
  readonly owners: Uint16Array;
  /** The whole owner array after the frame when the changed-cell list is incomplete (see above), else null. */
  readonly fullOwner: Uint16Array | null;
  /** The reject counter of the state after the frame. */
  readonly rejects: number;
  /** The light view of the state after the frame (statistics, refusals; `owner` and `terrain` are null here): one event per frame carries both. */
  readonly view: ViewSnapshot;
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

/**
 * What the page needs besides the changed cells, once per frame that ran ticks (`StateDiff.view`) and in full on request
 * (`SimHost.requestView`): the tick, the reject count and the LAST refusal (reason and tick, for a toast), the per-seat
 * statistics packed as in src/sim/view.ts (`stats`, STAT_COUNT blocks of `seats` values) and the match facts a mirror needs once.
 * `owner` and `terrain` are full copies and only present in the answer to `requestView` (a few hundred KB each); the diff
 * leaves them null, because the diff events keep a mirror's owner array current. A Worker host transfers these buffers.
 */
export interface ViewSnapshot {
  readonly tick: number;
  readonly rejects: number;
  /** REJECT_* code of the most recent refused intent, 0 when none has been refused. */
  readonly lastRejectReason: number;
  /** The tick of the step that refused it, -1 when none has been refused. */
  readonly lastRejectTick: number;
  readonly width: number;
  readonly height: number;
  readonly seats: number;
  readonly players: number;
  /** The match config's `spawnPhase` flag. */
  readonly flow: boolean;
  readonly debugIntents: boolean;
  readonly stats: Uint32Array;
  /** The attacks running, as pairs (attacker ownerId, target ownerId) one after the other in creation order: `attacks[2 i]`, `attacks[2 i + 1]` (D143). */
  readonly attacks: Uint16Array;
  /** The packed match view (M18-1, src/sim/matchView.ts): the result, the win progress and the per-seat statistics; in every frame. */
  readonly match: Uint32Array;
  readonly owner: Uint16Array | null;
  readonly terrain: Uint8Array | null;
  /** The structure table (M10): always present in the answer to `requestView`; in a frame's diff only when the table changed since the last frame that carried it, else null. */
  readonly structures: StructureSnapshot | null;
  /** The helicopter table (M12a-1): always present in the answer to `requestView`; in a frame's diff only when it changed since the last frame that carried it, else null. */
  readonly helis: HeliSnapshot | null;
}

/** The helicopter table as the page sees it (M12a-1): copies of the sim's arrays for the slots 0..highWater-1 (a free slot has owner 0) and the helicopters per ownerId. */
export interface HeliSnapshot {
  readonly capacity: number;
  readonly highWater: number;
  readonly liveCount: number;
  readonly owner: Uint16Array;
  readonly state: Uint8Array;
  readonly factory: Uint16Array;
  readonly readyTick: Uint32Array;
  readonly x: Int32Array;
  readonly y: Int32Array;
  readonly alt: Int32Array;
  readonly hp: Uint16Array;
  readonly load: Uint16Array;
  readonly fuel: Uint32Array;
  /** Helicopters per ownerId (also those under production). */
  readonly counts: Uint16Array;
}

/**
 * The structure table as the page sees it (M10): copies of the sim's arrays for the slots 0..highWater-1 (a free slot has owner 0), the
 * per-owner delete cooldowns and the per-(owner, type) counts. Plain typed arrays, never a reference into the sim. The build progress is
 * not stored: it is a function of the tick (`structureProgress` in src/host/structureMirror.ts) from `buildTick` and `readyTick`.
 */
export interface StructureSnapshot {
  readonly capacity: number;
  readonly highWater: number;
  readonly liveCount: number;
  readonly type: Uint8Array;
  readonly owner: Uint16Array;
  readonly cell: Int32Array;
  readonly level: Uint16Array;
  readonly buildTick: Uint32Array;
  readonly readyTick: Uint32Array;
  readonly upgradeReadyTick: Uint32Array;
  /** Per ownerId: the tick from which that owner may Delete again. */
  readonly deleteReady: Uint32Array;
  /** Structures per (ownerId, type), index ownerId * STRUCT_TYPE_SLOTS + type. */
  readonly counts: Uint16Array;
  /** The district table (Districts-1) for the slots 0..highWater-1: index id * DISTRICT_MAX_SLOTS + slot. */
  readonly districtKind: Uint8Array;
  readonly districtLevel: Uint16Array;
  readonly districtReadyTick: Uint32Array;
  readonly districtUpgradeReadyTick: Uint32Array;
  /** Districts per (ownerId, kind), index ownerId * DISTRICT_KIND_SLOTS + kind. */
  readonly districtCounts: Uint16Array;
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
      diff: { fromTick: d.fromTick, toTick: d.toTick, cells: d.cells.slice(), owners: d.owners.slice(), fullOwner: d.fullOwner === null ? null : d.fullOwner.slice(), rejects: d.rejects, view: cloneView(d.view) },
    };
  }
  return e.type === 'hash' ? { type: 'hash', tick: e.tick, hash: e.hash } : { type: 'speed', speed: e.speed };
}

/** A deep copy of a view snapshot. */
export function cloneView(v: ViewSnapshot): ViewSnapshot {
  return {
    ...v,
    stats: v.stats.slice(),
    attacks: v.attacks.slice(),
    match: v.match.slice(),
    owner: v.owner === null ? null : v.owner.slice(),
    terrain: v.terrain === null ? null : v.terrain.slice(),
    structures: v.structures === null ? null : cloneStructures(v.structures),
    helis: v.helis === null ? null : cloneHelis(v.helis),
  };
}

/** A deep copy of a helicopter snapshot. */
export function cloneHelis(s: HeliSnapshot): HeliSnapshot {
  return {
    ...s,
    owner: s.owner.slice(),
    state: s.state.slice(),
    factory: s.factory.slice(),
    readyTick: s.readyTick.slice(),
    x: s.x.slice(),
    y: s.y.slice(),
    alt: s.alt.slice(),
    hp: s.hp.slice(),
    load: s.load.slice(),
    fuel: s.fuel.slice(),
    counts: s.counts.slice(),
  };
}

/** A deep copy of a structure snapshot. */
export function cloneStructures(s: StructureSnapshot): StructureSnapshot {
  return {
    ...s,
    type: s.type.slice(),
    owner: s.owner.slice(),
    cell: s.cell.slice(),
    level: s.level.slice(),
    buildTick: s.buildTick.slice(),
    readyTick: s.readyTick.slice(),
    upgradeReadyTick: s.upgradeReadyTick.slice(),
    deleteReady: s.deleteReady.slice(),
    counts: s.counts.slice(),
    districtKind: s.districtKind.slice(),
    districtLevel: s.districtLevel.slice(),
    districtReadyTick: s.districtReadyTick.slice(),
    districtUpgradeReadyTick: s.districtUpgradeReadyTick.slice(),
    districtCounts: s.districtCounts.slice(),
  };
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
  /** The light view of the current state: statistics plus FULL copies of the owner array and the terrain layer. A page asks once at start; the events keep it current. */
  requestView(): Promise<ViewSnapshot>;
  dispose(): void;
}

export type ClientMessage =
  | { readonly type: 'submit'; readonly body: IntentBody }
  | { readonly type: 'speed'; readonly speed: Speed }
  | { readonly type: 'advance'; readonly dtMs: number }
  | { readonly type: 'snapshot'; readonly requestId: number }
  | { readonly type: 'view'; readonly requestId: number }
  | { readonly type: 'dispose' };

export type HostMessage =
  | { readonly type: 'event'; readonly event: HostEvent }
  | { readonly type: 'snapshot'; readonly requestId: number; readonly snapshot: Snapshot }
  | { readonly type: 'view'; readonly requestId: number; readonly view: ViewSnapshot }
  | { readonly type: 'error'; readonly message: string };

/** One end of a message channel: post sends a copy, handlers receive copies. `transfer` lists buffers to move, not copy. */
export interface Port<Send, Receive> {
  post(message: Send, transfer?: ArrayBuffer[]): void;
  onMessage(handler: (message: Receive) => void): Unsubscribe;
  close(): void;
}
