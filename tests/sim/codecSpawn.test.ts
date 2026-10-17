// The Spawn intent on the wire (kind byte 2, the layout of DebugPaint) and in the canonical order.
import { describe, expect, it } from 'vitest';
import { decodeIntent, decodeTurn, encodeIntent, encodeTurn } from '../../src/sim/codec';
import { INTENT_KINDS, compareIntents, kindCode, validateIntent, REJECT_CELL, REJECT_NONE, REJECT_SEAT, type Intent } from '../../src/sim/intents';

describe('Spawn on the wire', () => {
  it('kind code 2, appended after Noop and DebugPaint (published codes never change)', () => {
    expect(INTENT_KINDS.slice(0, 3)).toEqual(['Noop', 'DebugPaint', 'Spawn']);
    expect(kindCode('Spawn')).toBe(2);
  });

  it('kind, seat, id varint, cell varint', () => {
    expect(Array.from(encodeIntent({ kind: 'Spawn', seat: 3, id: 1, cell: 300 }))).toEqual([2, 3, 1, 0xac, 0x02]);
    expect(encodeIntent({ kind: 'Spawn', seat: 0, id: 0, cell: 0 }).length).toBe(4);
    expect(encodeIntent({ kind: 'Spawn', seat: 255, id: 4294967295, cell: 4294967295 }).length).toBe(12);
  });

  it('round trips alone and inside a turn, and refuses what the wire cannot carry', () => {
    const i: Intent = { kind: 'Spawn', seat: 7, id: 99, cell: 524287 };
    const one = decodeIntent(encodeIntent(i));
    expect(one).toEqual({ ok: true, value: i });
    const turn = { turn: 12, intents: [i, { kind: 'Noop' as const, seat: 1, id: 4 }, { kind: 'Spawn' as const, seat: 0, id: 0, cell: 0 }] };
    expect(decodeTurn(encodeTurn(turn))).toEqual({ ok: true, value: turn });
    expect(() => encodeIntent({ kind: 'Spawn', seat: 0, id: 0, cell: -1 })).toThrow(RangeError);
    expect(() => encodeIntent({ kind: 'Spawn', seat: 0, id: 0, cell: 4294967296 })).toThrow(RangeError);
    const r = decodeIntent(new Uint8Array([2, 0, 0]));
    expect(r.ok).toBe(false); // a Spawn without its cell
    expect(decodeIntent(new Uint8Array([2, 0, 0, 1, 9])).ok).toBe(false); // trailing byte
  });
});

describe('Spawn: validation and order', () => {
  const ctx = { seats: 4, cells: 100, debugIntents: false };
  it('needs no debug switch; checks seat, id and cell', () => {
    expect(validateIntent({ kind: 'Spawn', seat: 0, id: 0, cell: 99 }, ctx)).toBe(REJECT_NONE);
    expect(validateIntent({ kind: 'Spawn', seat: 0, id: 0, cell: 100 }, ctx)).toBe(REJECT_CELL);
    expect(validateIntent({ kind: 'Spawn', seat: 0, id: 0, cell: -1 }, ctx)).toBe(REJECT_CELL);
    expect(validateIntent({ kind: 'Spawn', seat: 0, id: 0 }, ctx)).toBe(REJECT_CELL);
    expect(validateIntent({ kind: 'Spawn', seat: 4, id: 0, cell: 1 }, ctx)).toBe(REJECT_SEAT);
  });

  it('is ordered after DebugPaint of the same seat and id, and by cell among Spawns (a total order)', () => {
    const a: Intent = { kind: 'Spawn', seat: 1, id: 5, cell: 10 };
    const b: Intent = { kind: 'Spawn', seat: 1, id: 5, cell: 11 };
    const p: Intent = { kind: 'DebugPaint', seat: 1, id: 5, cell: 99 };
    expect(compareIntents(a, b)).toBeLessThan(0);
    expect(compareIntents(b, a)).toBeGreaterThan(0);
    expect(compareIntents(a, a)).toBe(0);
    expect(compareIntents(p, a)).toBeLessThan(0);
    expect(compareIntents(a, { kind: 'Noop', seat: 1, id: 5 })).toBeGreaterThan(0);
  });
});
