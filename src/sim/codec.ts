// Compact binary codec of intents and turns. Unsigned LEB128 varints in their shortest form only (a longer encoding of
// the same number is an error), so every accepted byte string has exactly one meaning and re-encodes to itself.
//
//   intent  = kind:u8  seat:u8  id:varint  [payload]
//     payload: DebugPaint and Spawn: cell:varint;  Attack: target:varint pct:varint;  CancelAttack: target:varint;  Noop: none
//   turn    = turn:varint  count:varint  intent*count
//
// Decoding is total: any bytes give either a value or an error result; nothing throws. The decoder checks only what the
// bytes can show (known kind, number ranges, no trailing bytes); whether a seat or a cell exists is for step() to judge.
import { INTENT_KINDS, kindCode, type Intent, type TurnIntents } from './intents';
import { MAX_INTENTS_PER_TURN } from './rules';

export type DecodeError = 'truncated' | 'varint' | 'kind' | 'count' | 'trailing' | 'input';

export type DecodeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: DecodeError; readonly offset: number };

/** Shortest wire size of an intent: kind, seat, one id byte. */
const MIN_INTENT_BYTES = 3;

function varintSize(v: number): number {
  return v < 0x80 ? 1 : v < 0x4000 ? 2 : v < 0x200000 ? 3 : v < 0x10000000 ? 4 : 5;
}

function putVarint(out: Uint8Array, at: number, v: number): number {
  let x = v;
  let p = at;
  while (x >= 0x80) {
    out[p++] = (x % 128) | 0x80;
    x = Math.floor(x / 128);
  }
  out[p++] = x;
  return p;
}

function isU32(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 4294967295;
}

function isU8(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 255;
}

/** A new kind with a payload adds its case to intentSize, putIntent, assertEncodable and Reader.intent. */
function intentSize(i: Intent): number {
  const head = 2 + varintSize(i.id);
  switch (i.kind) {
    case 'DebugPaint':
    case 'Spawn':
      return head + varintSize(i.cell);
    case 'Attack':
      return head + varintSize(i.target) + varintSize(i.pct);
    case 'CancelAttack':
      return head + varintSize(i.target);
    default:
      return head;
  }
}

function putIntent(out: Uint8Array, at: number, i: Intent): number {
  out[at] = kindCode(i.kind);
  out[at + 1] = i.seat;
  let p = putVarint(out, at + 2, i.id);
  if (i.kind === 'DebugPaint' || i.kind === 'Spawn') p = putVarint(out, p, i.cell);
  else if (i.kind === 'Attack') {
    p = putVarint(out, p, i.target);
    p = putVarint(out, p, i.pct);
  } else if (i.kind === 'CancelAttack') p = putVarint(out, p, i.target);
  return p;
}

function payloadEncodable(i: Intent): boolean {
  switch (i.kind) {
    case 'DebugPaint':
    case 'Spawn':
      return isU32(i.cell);
    case 'Attack':
      return isU32(i.target) && isU32(i.pct);
    case 'CancelAttack':
      return isU32(i.target);
    default:
      return true;
  }
}

function assertEncodable(i: Intent): void {
  if (kindCode(i.kind) < 0 || !isU8(i.seat) || !isU32(i.id) || !payloadEncodable(i)) {
    throw new RangeError('intent is not representable on the wire (kind, seat 0..255, id, cell, target and pct 0..2^32-1)');
  }
}

/** Encodes one intent. Throws RangeError for a value the wire cannot hold (a sender-side programming error). */
export function encodeIntent(i: Intent): Uint8Array {
  assertEncodable(i);
  const out = new Uint8Array(intentSize(i));
  putIntent(out, 0, i);
  return out;
}

/** Encodes a turn. Throws RangeError for an unrepresentable intent or turn, or more than MAX_INTENTS_PER_TURN intents. */
export function encodeTurn(t: TurnIntents): Uint8Array {
  if (!isU32(t.turn) || t.intents.length > MAX_INTENTS_PER_TURN) throw new RangeError('turn is not representable on the wire');
  let size = varintSize(t.turn) + varintSize(t.intents.length);
  for (const i of t.intents) {
    assertEncodable(i);
    size += intentSize(i);
  }
  const out = new Uint8Array(size);
  let p = putVarint(out, 0, t.turn);
  p = putVarint(out, p, t.intents.length);
  for (const i of t.intents) p = putIntent(out, p, i);
  return out;
}

class Reader {
  pos = 0;
  error: DecodeError | null = null;
  errorAt = 0;
  constructor(readonly bytes: Uint8Array) {}

  fail(error: DecodeError): 0 {
    if (this.error === null) {
      this.error = error;
      this.errorAt = this.pos;
    }
    return 0;
  }

  u8(): number {
    if (this.pos >= this.bytes.length) return this.fail('truncated');
    return this.bytes[this.pos++] as number;
  }

  /** An unsigned 32-bit varint in its shortest form. */
  varint(): number {
    let value = 0;
    let scale = 1;
    for (let n = 0; n < 5; n++) {
      if (this.pos >= this.bytes.length) return this.fail('truncated');
      const b = this.bytes[this.pos++] as number;
      value += (b & 0x7f) * scale;
      if ((b & 0x80) === 0) {
        if (n > 0 && b === 0) return this.fail('varint');
        if (value > 4294967295) return this.fail('varint');
        return value;
      }
      scale *= 128;
    }
    return this.fail('varint');
  }

  intent(): Intent | null {
    const kindByte = this.u8();
    if (this.error !== null) return null;
    const kind = INTENT_KINDS[kindByte];
    if (kind === undefined) {
      this.pos--;
      this.fail('kind');
      return null;
    }
    const seat = this.u8();
    const id = this.varint();
    if (kind === 'DebugPaint' || kind === 'Spawn') {
      const cell = this.varint();
      return this.error === null ? { kind, seat, id, cell } : null;
    }
    if (kind === 'Attack') {
      const target = this.varint();
      const pct = this.varint();
      return this.error === null ? { kind, seat, id, target, pct } : null;
    }
    if (kind === 'CancelAttack') {
      const target = this.varint();
      return this.error === null ? { kind, seat, id, target } : null;
    }
    return this.error === null ? { kind, seat, id } : null;
  }
}

function isBytes(x: unknown): x is Uint8Array {
  return Object.prototype.toString.call(x) === '[object Uint8Array]';
}

function failure(r: Reader): DecodeResult<never> {
  return { ok: false, error: r.error ?? 'truncated', offset: r.errorAt };
}

/** Decodes exactly one intent from the whole of `bytes`. */
export function decodeIntent(bytes: Uint8Array): DecodeResult<Intent> {
  if (!isBytes(bytes)) return { ok: false, error: 'input', offset: 0 };
  const r = new Reader(bytes);
  const i = r.intent();
  if (i === null) return failure(r);
  if (r.pos !== bytes.length) return { ok: false, error: 'trailing', offset: r.pos };
  return { ok: true, value: i };
}

/** Decodes a turn from the whole of `bytes`. */
export function decodeTurn(bytes: Uint8Array): DecodeResult<TurnIntents> {
  if (!isBytes(bytes)) return { ok: false, error: 'input', offset: 0 };
  const r = new Reader(bytes);
  const turn = r.varint();
  const count = r.varint();
  if (r.error !== null) return failure(r);
  if (count > MAX_INTENTS_PER_TURN || count * MIN_INTENT_BYTES > bytes.length - r.pos) {
    r.errorAt = r.pos;
    return { ok: false, error: count > MAX_INTENTS_PER_TURN ? 'count' : 'truncated', offset: r.pos };
  }
  const intents: Intent[] = [];
  for (let n = 0; n < count; n++) {
    const i = r.intent();
    if (i === null) return failure(r);
    intents.push(i);
  }
  if (r.pos !== bytes.length) return { ok: false, error: 'trailing', offset: r.pos };
  return { ok: true, value: { turn, intents } };
}
