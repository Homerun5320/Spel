// Attack (kind byte 3) and CancelAttack (kind byte 4) on the wire, in validation, in the canonical order and in copyBody / withId.
import { describe, expect, it } from 'vitest';
import { decodeIntent, decodeTurn, encodeIntent, encodeTurn } from '../../src/sim/codec';
import {
  INTENT_KINDS,
  REJECT_NONE,
  REJECT_PCT,
  REJECT_SEAT,
  REJECT_TARGET,
  compareIntents,
  copyBody,
  kindCode,
  validateIntent,
  withId,
  type Intent,
} from '../../src/sim/intents';

describe('Attack and CancelAttack on the wire', () => {
  it('kind codes 3 and 4, appended after Noop, DebugPaint and Spawn (published codes never change)', () => {
    expect(INTENT_KINDS).toEqual(['Noop', 'DebugPaint', 'Spawn', 'Attack', 'CancelAttack', 'DebugGive', 'Build', 'Upgrade', 'Delete', 'BuildDistrict', 'UpgradeDistrict', 'RemoveDistrict']); // Districts-1 appended 9 to 11; M05 appended DebugGive (kind 5), M09 part A Build, Upgrade, Delete (6 to 8); the first five codes are unchanged
    expect([kindCode('Attack'), kindCode('CancelAttack')]).toEqual([3, 4]);
  });

  it('Attack = kind, seat, id varint, target varint, pct varint; CancelAttack = kind, seat, id varint, target varint', () => {
    expect(Array.from(encodeIntent({ kind: 'Attack', seat: 2, id: 1, target: 300, pct: 100 }))).toEqual([3, 2, 1, 0xac, 0x02, 100]);
    expect(Array.from(encodeIntent({ kind: 'Attack', seat: 0, id: 0, target: 0, pct: 1 }))).toEqual([3, 0, 0, 0, 1]);
    expect(Array.from(encodeIntent({ kind: 'CancelAttack', seat: 5, id: 7, target: 2 }))).toEqual([4, 5, 7, 2]);
  });

  it('round trips alone and in a turn; the wire refuses what it cannot carry and decoding refuses short or long input', () => {
    const list: Intent[] = [
      { kind: 'Attack', seat: 7, id: 99, target: 12, pct: 55 },
      { kind: 'CancelAttack', seat: 7, id: 100, target: 12 },
      { kind: 'Attack', seat: 255, id: 4294967295, target: 4294967295, pct: 4294967295 },
    ];
    for (const i of list) expect(decodeIntent(encodeIntent(i))).toEqual({ ok: true, value: i });
    const turn = { turn: 9, intents: [...list, { kind: 'Spawn' as const, seat: 1, id: 2, cell: 3 }] };
    expect(decodeTurn(encodeTurn(turn))).toEqual({ ok: true, value: turn });
    expect(() => encodeIntent({ kind: 'Attack', seat: 0, id: 0, target: -1, pct: 1 })).toThrow(RangeError);
    expect(() => encodeIntent({ kind: 'Attack', seat: 0, id: 0, target: 1, pct: 4294967296 })).toThrow(RangeError);
    expect(() => encodeIntent({ kind: 'CancelAttack', seat: 0, id: 0, target: 1.5 })).toThrow(RangeError);
    expect(decodeIntent(new Uint8Array([3, 0, 0, 1])).ok).toBe(false); // an Attack without its pct
    expect(decodeIntent(new Uint8Array([4, 0, 0])).ok).toBe(false); // a CancelAttack without its target
    expect(decodeIntent(new Uint8Array([4, 0, 0, 1, 9])).ok).toBe(false); // trailing byte
    expect(decodeIntent(new Uint8Array([5, 0, 0])).ok).toBe(false); // the next kind does not exist yet
  });
});

describe('Attack and CancelAttack: validation, copyBody, withId, order', () => {
  const ctx = { seats: 4, cells: 100, debugIntents: false };

  it('Attack: seat, target 0..seats (an ownerId), pct 1..100, all integers; no debug switch', () => {
    expect(validateIntent({ kind: 'Attack', seat: 0, id: 0, target: 0, pct: 1 }, ctx)).toBe(REJECT_NONE);
    expect(validateIntent({ kind: 'Attack', seat: 3, id: 0, target: 4, pct: 100 }, ctx)).toBe(REJECT_NONE);
    expect(validateIntent({ kind: 'Attack', seat: 4, id: 0, target: 0, pct: 50 }, ctx)).toBe(REJECT_SEAT);
    for (const target of [5, -1, 1.5, NaN, '1', undefined, null]) expect(validateIntent({ kind: 'Attack', seat: 0, id: 0, target, pct: 50 }, ctx), String(target)).toBe(REJECT_TARGET);
    for (const pct of [0, 101, -3, 50.5, NaN, '50', undefined, null]) expect(validateIntent({ kind: 'Attack', seat: 0, id: 0, target: 1, pct }, ctx), String(pct)).toBe(REJECT_PCT);
  });

  it('CancelAttack: seat and target', () => {
    expect(validateIntent({ kind: 'CancelAttack', seat: 0, id: 0, target: 0 }, ctx)).toBe(REJECT_NONE);
    expect(validateIntent({ kind: 'CancelAttack', seat: 0, id: 0, target: 5 }, ctx)).toBe(REJECT_TARGET);
    expect(validateIntent({ kind: 'CancelAttack', seat: 9, id: 0, target: 1 }, ctx)).toBe(REJECT_SEAT);
  });

  it('copyBody keeps the known fields only and turns garbage into values that step refuses; withId attaches the id', () => {
    const a = copyBody({ kind: 'Attack', seat: 1, target: 2, pct: 30, extra: 'x', id: 5 });
    expect(a).toEqual({ kind: 'Attack', seat: 1, target: 2, pct: 30 });
    expect(copyBody({ kind: 'Attack', seat: 1 })).toEqual({ kind: 'Attack', seat: 1, target: -1, pct: -1 });
    expect(copyBody({ kind: 'CancelAttack', seat: 1, target: 'x', junk: 1 })).toEqual({ kind: 'CancelAttack', seat: 1, target: -1 });
    expect(withId(a, 8)).toEqual({ kind: 'Attack', seat: 1, target: 2, pct: 30, id: 8 });
    expect(withId({ kind: 'CancelAttack', seat: 2, target: 3 }, 4)).toEqual({ kind: 'CancelAttack', seat: 2, target: 3, id: 4 });
    const src = { kind: 'Attack', seat: 1, target: 2, pct: 30 };
    expect(copyBody(src)).not.toBe(src);
  });

  it('canonical order: seat, id, kind, then target and pct (a total order on valid intents of the same kind)', () => {
    const a: Intent = { kind: 'Attack', seat: 1, id: 5, target: 2, pct: 10 };
    const b: Intent = { kind: 'Attack', seat: 1, id: 5, target: 2, pct: 20 };
    const c: Intent = { kind: 'Attack', seat: 1, id: 5, target: 3, pct: 1 };
    expect(compareIntents(a, b)).toBeLessThan(0);
    expect(compareIntents(b, c)).toBeLessThan(0);
    expect(compareIntents(c, a)).toBeGreaterThan(0);
    expect(compareIntents(a, a)).toBe(0);
    const x: Intent = { kind: 'CancelAttack', seat: 1, id: 5, target: 2 };
    const y: Intent = { kind: 'CancelAttack', seat: 1, id: 5, target: 3 };
    expect(compareIntents(x, y)).toBeLessThan(0);
    expect(compareIntents(a, x)).toBeLessThan(0); // Attack (3) before CancelAttack (4)
    expect(compareIntents({ kind: 'Spawn', seat: 1, id: 5, cell: 1 }, a)).toBeLessThan(0);
  });
});
