// Intents: everything that can change game state, as plain serialisable data. UI, AI and the network emit intents
// and never touch the state; only step() (src/sim/step.ts) applies them.
//
// Every intent has a seat (0-based) and an id (unsigned 32 bit, unique per seat, handed out by an IdAllocator).
// Inside one turn intents run in the canonical order (seat, id, kind, payload); the id is the tie-break between the
// intents of one seat, so the result never depends on the order in which they arrived.
import { MAX_SEATS } from './state';

export type IntentKind = 'Noop' | 'DebugPaint';

/** The intent kinds in wire order (the index is the kind byte of the codec). */
export const INTENT_KINDS: readonly IntentKind[] = ['Noop', 'DebugPaint'];

/** Does nothing; valid for any seat. Exists to prove the pipeline (and as the heartbeat of a lockstep client). */
export interface NoopBody {
  readonly kind: 'Noop';
  readonly seat: number;
}

/** Gives one cell to a seat. Valid only when the match config has debugIntents. M04 replaces it with Spawn and Attack. */
export interface DebugPaintBody {
  readonly kind: 'DebugPaint';
  readonly seat: number;
  readonly cell: number;
}

/** An intent before it has an id (what the UI submits to a host). */
export type IntentBody = NoopBody | DebugPaintBody;

export type Intent = IntentBody & { readonly id: number };

/** The intents of one turn: all intents that run in the step that starts at tick `turn`. */
export interface TurnIntents {
  readonly turn: number;
  readonly intents: readonly Intent[];
}

// Reject reasons. 0 means valid. The numbers are part of the outbox, never of the hash.
export const REJECT_NONE = 0;
export const REJECT_SHAPE = 1;
export const REJECT_KIND = 2;
export const REJECT_SEAT = 3;
export const REJECT_ID = 4;
export const REJECT_CELL = 5;
export const REJECT_DISABLED = 6;
export const REJECT_DUPLICATE = 7;

export interface ValidateContext {
  readonly seats: number;
  readonly cells: number;
  readonly debugIntents: boolean;
}

/** Code of a kind name for sorting and the wire; -1 when unknown. */
export function kindCode(kind: unknown): number {
  for (let i = 0; i < INTENT_KINDS.length; i++) if (INTENT_KINDS[i] === kind) return i;
  return -1;
}

function isIntegerIn(v: unknown, lo: number, hi: number): boolean {
  return typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
}

/** Why an intent is not valid in this match (REJECT_*), or REJECT_NONE. Total: any value whatsoever may be passed in. */
export function validateIntent(x: unknown, ctx: ValidateContext): number {
  if (typeof x !== 'object' || x === null) return REJECT_SHAPE;
  const o = x as { kind?: unknown; seat?: unknown; id?: unknown; cell?: unknown };
  const code = kindCode(o.kind);
  if (code < 0) return REJECT_KIND;
  if (!isIntegerIn(o.seat, 0, MAX_SEATS - 1) || (o.seat as number) >= ctx.seats) return REJECT_SEAT;
  if (!isIntegerIn(o.id, 0, 4294967295)) return REJECT_ID;
  if (o.kind === 'DebugPaint') {
    if (!ctx.debugIntents) return REJECT_DISABLED;
    if (!isIntegerIn(o.cell, 0, ctx.cells - 1)) return REJECT_CELL;
  }
  return REJECT_NONE;
}

/** The payload of an intent as one number (the cell for DebugPaint, 0 otherwise). Only for validated intents. */
export function payloadOf(i: Intent): number {
  return i.kind === 'DebugPaint' ? i.cell : 0;
}

/** Canonical order of VALID intents: seat, then id, then kind, then payload. A total order on valid intents. */
export function compareIntents(a: Intent, b: Intent): number {
  if (a.seat !== b.seat) return a.seat - b.seat;
  if (a.id !== b.id) return a.id - b.id;
  const ka = kindCode(a.kind);
  const kb = kindCode(b.kind);
  if (ka !== kb) return ka - kb;
  return payloadOf(a) - payloadOf(b);
}

/** An intent that step() always refuses (seat -1); what a host stores for input that is not an intent at all. */
export const INVALID_BODY: IntentBody = Object.freeze({ kind: 'Noop', seat: -1 });

/**
 * A fresh copy of an intent body made only from its known fields. Total: input that is not an object, has an unknown
 * kind, or lacks a numeric seat gives INVALID_BODY; other bad field values are copied as they are and refused by step().
 * The copy shares nothing with the input (the host stores copies, never the caller's object).
 */
export function copyBody(x: unknown): IntentBody {
  if (typeof x !== 'object' || x === null) return INVALID_BODY;
  const o = x as { kind?: unknown; seat?: unknown; cell?: unknown };
  const seat = typeof o.seat === 'number' ? o.seat : -1;
  if (o.kind === 'Noop') return { kind: 'Noop', seat };
  if (o.kind === 'DebugPaint') return { kind: 'DebugPaint', seat, cell: typeof o.cell === 'number' ? o.cell : -1 };
  return INVALID_BODY;
}

/** Attaches an id to a body (a new object). */
export function withId(body: IntentBody, id: number): Intent {
  return body.kind === 'DebugPaint'
    ? { kind: 'DebugPaint', seat: body.seat, cell: body.cell, id }
    : { kind: 'Noop', seat: body.seat, id };
}

/** Hands out intent ids: one counter per seat, starting at 0. A seat outside 0..MAX_SEATS-1 gets id 0 and no counter. */
export class IdAllocator {
  private readonly next = new Uint32Array(MAX_SEATS);

  alloc(seat: number): number {
    if (!isIntegerIn(seat, 0, MAX_SEATS - 1)) return 0;
    const id = this.next[seat] as number;
    this.next[seat] = id + 1;
    return id;
  }
}
