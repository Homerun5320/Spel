import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decodeTurn, encodeIntent, encodeTurn } from '../../src/sim/codec';
import {
  INVALID_BODY,
  IdAllocator,
  REJECT_CELL,
  REJECT_DISABLED,
  REJECT_DUPLICATE,
  REJECT_ID,
  REJECT_KIND,
  REJECT_NONE,
  REJECT_SEAT,
  REJECT_SHAPE,
  compareIntents,
  copyBody,
  validateIntent,
  withId,
  type Intent,
} from '../../src/sim/intents';
import { OUTBOX_CAPACITY, OUTBOX_PAINT, OUTBOX_REJECT } from '../../src/sim/outbox';
import { INTENT_DELAY_TURNS, MAX_INTENTS_PER_TURN, TICK_HZ, TICK_MS } from '../../src/sim/rules';
import { hashState } from '../../src/sim/serialize';
import { createEmptyState, type GameState } from '../../src/sim/state';
import { step } from '../../src/sim/step';
import { scheduledTurn } from '../../src/sim/time';
import { smallMatchIntent } from './helpers/arbitraries';

const W = 6;
const H = 5;
const SEATS = 4;
const fresh = (debug = true): GameState => createEmptyState(W, H, 42, SEATS, { debugIntents: debug });
const paint = (seat: number, cell: number, id: number): Intent => ({ kind: 'DebugPaint', seat, cell, id });
const noop = (seat: number, id: number): Intent => ({ kind: 'Noop', seat, id });

function deepFreeze<T>(x: T): T {
  if (typeof x === 'object' && x !== null) {
    Object.freeze(x);
    for (const v of Object.values(x)) deepFreeze(v);
  }
  return x;
}

describe('rules and schedule', () => {
  it('10 Hz, two turns of input delay', () => {
    expect(TICK_HZ).toBe(10);
    expect(TICK_MS).toBe(100);
    expect(TICK_MS * TICK_HZ).toBe(1000);
    expect(INTENT_DELAY_TURNS).toBe(2);
    expect(scheduledTurn(0)).toBe(2);
    expect(scheduledTurn(5)).toBe(7);
    expect(scheduledTurn(4294967295)).toBe(1);
  });
});

describe('step: the turn', () => {
  it('runs the turn whose index is the current tick, increments the tick and draws once from the generator', () => {
    const s = fresh();
    const rngBefore = s.rng.slice();
    const r = step(s, { turn: 0, intents: [] });
    expect(r).toEqual({ ok: true, applied: 0, rejected: 0 });
    expect(s.tick).toBe(1);
    expect(s.rng).not.toEqual(rngBefore);
  });

  it('a wrong turn index, a missing list or a garbage turn is an error RESULT and leaves the state untouched', () => {
    const s = fresh();
    const h = hashState(s);
    expect(step(s, { turn: 1, intents: [] })).toEqual({ ok: false, error: 'turn-mismatch' });
    expect(step(s, { turn: 0, intents: 'x' as unknown as Intent[] })).toEqual({ ok: false, error: 'bad-turn' });
    expect(step(s, null as never)).toEqual({ ok: false, error: 'bad-turn' });
    expect(step(s, undefined as never)).toEqual({ ok: false, error: 'bad-turn' });
    expect(step(s, 5 as never)).toEqual({ ok: false, error: 'bad-turn' });
    expect(step(s, { turn: 0, intents: new Array(MAX_INTENTS_PER_TURN + 1).fill(noop(0, 0)) })).toEqual({ ok: false, error: 'too-many' });
    expect(hashState(s)).toBe(h);
    expect(s.tick).toBe(0);
    expect(s.outbox.length).toBe(0);
    // exactly MAX_INTENTS_PER_TURN is fine (all but one are duplicates of each other)
    expect(step(s, { turn: 0, intents: new Array(MAX_INTENTS_PER_TURN).fill(noop(0, 0)) }).ok).toBe(true);
  });

  it('DebugPaint gives the cell to the seat (ownerId = seat + 1) and stamps the intent id', () => {
    const s = fresh();
    expect(step(s, { turn: 0, intents: [paint(2, 7, 31)] })).toEqual({ ok: true, applied: 1, rejected: 0 });
    expect(s.owner[7]).toBe(3);
    expect(s.stamp[7]).toBe(31);
    expect(s.owner.reduce((a, b) => a + b, 0)).toBe(3);
    expect(s.outbox.drain()).toEqual([{ kind: OUTBOX_PAINT, tick: 0, a: 7, b: 3 }]);
  });

  it('Noop is valid for every seat and changes nothing but the tick and the generator', () => {
    const s = fresh(false);
    const owners = s.owner.slice();
    expect(step(s, { turn: 0, intents: [noop(0, 0), noop(3, 0)] })).toEqual({ ok: true, applied: 2, rejected: 0 });
    expect(s.owner).toEqual(owners);
    expect(s.rejects).toBe(0);
  });
});

describe('step: invalid intents become no-ops and raise the reject counter', () => {
  const cases: Array<[string, unknown, number, boolean?]> = [
    ['seat beyond the match', paint(SEATS, 0, 0), REJECT_SEAT],
    ['negative seat', paint(-1, 0, 0), REJECT_SEAT],
    ['fractional seat', paint(1.5, 0, 0), REJECT_SEAT],
    ['seat as a string', { kind: 'Noop', seat: '1', id: 0 }, REJECT_SEAT],
    ['cell beyond the grid', paint(0, W * H, 0), REJECT_CELL],
    ['negative cell', paint(0, -1, 0), REJECT_CELL],
    ['NaN cell', paint(0, NaN, 0), REJECT_CELL],
    ['missing cell', { kind: 'DebugPaint', seat: 0, id: 0 }, REJECT_CELL],
    ['negative id', noop(0, -1), REJECT_ID],
    ['id beyond 32 bits', noop(0, 4294967296), REJECT_ID],
    ['missing id', { kind: 'Noop', seat: 0 }, REJECT_ID],
    ['unknown kind', { kind: 'Spawn', seat: 0, id: 0 }, REJECT_KIND],
    ['no kind', { seat: 0, id: 0 }, REJECT_KIND],
    ['null', null, REJECT_SHAPE],
    ['a number', 7, REJECT_SHAPE],
    ['a string', 'Noop', REJECT_SHAPE],
    ['DebugPaint with debugIntents off', paint(0, 0, 0), REJECT_DISABLED, false],
  ];

  it.each(cases)('%s', (_name, bad, reason, debug = true) => {
    const s = fresh(debug);
    const owners = s.owner.slice();
    const stamps = s.stamp.slice();
    const r = step(s, { turn: 0, intents: [bad as Intent] });
    expect(r).toEqual({ ok: true, applied: 0, rejected: 1 });
    expect(s.rejects).toBe(1);
    expect(s.owner).toEqual(owners);
    expect(s.stamp).toEqual(stamps);
    expect(s.tick).toBe(1);
    expect(s.outbox.drain()).toEqual([{ kind: OUTBOX_REJECT, tick: 0, a: reason, b: 0 }]);
  });

  it('a duplicate (seat, id) inside a turn is refused, whichever copy came first in the list', () => {
    const a = fresh();
    const b = fresh();
    const x = paint(1, 3, 5);
    const y = paint(1, 9, 5); // same seat and id, other cell
    step(a, { turn: 0, intents: [x, y] });
    step(b, { turn: 0, intents: [y, x] });
    expect(hashState(a)).toBe(hashState(b));
    expect(a.rejects).toBe(1);
    expect(a.outbox.drain().filter((e) => e.kind === OUTBOX_REJECT).map((e) => e.a)).toEqual([REJECT_DUPLICATE]);
    // the canonical survivor is the one with the smaller payload
    expect(a.owner[3]).toBe(2);
    expect(a.owner[9]).toBe(0);
  });

  it('the same id from two different seats is fine', () => {
    const s = fresh();
    expect(step(s, { turn: 0, intents: [paint(0, 1, 0), paint(1, 2, 0)] })).toEqual({ ok: true, applied: 2, rejected: 0 });
  });

  it('the reject counter wraps at 2^32', () => {
    const s = fresh();
    s.rejects = 4294967295;
    step(s, { turn: 0, intents: [noop(9, 0)] });
    expect(s.rejects).toBe(0);
  });

  it('valid and invalid intents mix: the valid ones still run', () => {
    const s = fresh();
    expect(step(s, { turn: 0, intents: [paint(0, 1, 0), paint(99, 2, 1), paint(0, 3, 2), null as never] })).toEqual({ ok: true, applied: 2, rejected: 2 });
    expect([s.owner[1], s.owner[2], s.owner[3]]).toEqual([1, 0, 1]);
  });

  it('whatever junk a turn holds, step returns a result and never throws (fast-check, 2000 runs)', () => {
    fc.assert(
      fc.property(fc.array(fc.anything(), { maxLength: 12 }), fc.nat(3), (junk, turnOffset) => {
        const s = fresh();
        const r = step(s, { turn: turnOffset, intents: junk as unknown as Intent[] });
        expect(typeof r.ok).toBe('boolean');
        if (r.ok) expect(s.tick).toBe(1);
        else expect(s.tick).toBe(0);
      }),
      { numRuns: 2000 },
    );
    fc.assert(
      fc.property(fc.anything(), (turn) => {
        const s = fresh();
        expect(typeof step(s, turn as never).ok).toBe('boolean');
      }),
      { numRuns: 1000 },
    );
  });

  it('weird objects (prototype tricks, extra fields, boxed numbers) are judged by their own fields only', () => {
    const s = fresh();
    const withProto = Object.create({ kind: 'Noop', seat: 0, id: 0 }) as Intent;
    expect(validateIntent(withProto, { seats: 4, cells: 30, debugIntents: true })).toBe(REJECT_NONE); // inherited fields read the same
    expect(validateIntent({ kind: 'Noop', seat: new Number(0), id: 0 }, { seats: 4, cells: 30, debugIntents: true })).toBe(REJECT_SEAT);
    expect(validateIntent({ kind: 'Noop', seat: 0, id: 0, extra: 'ignored', cell: 'ignored' }, { seats: 4, cells: 30, debugIntents: true })).toBe(REJECT_NONE);
    expect(step(s, { turn: 0, intents: [] }).ok).toBe(true);
  });
});

describe('step: order inside a turn is (seat, id), independent of arrival order', () => {
  it('two seats paint the same cell: the higher (seat, id) is applied last and wins, in either input order', () => {
    const a = fresh();
    const b = fresh();
    const lo = paint(0, 5, 9);
    const hi = paint(2, 5, 1);
    step(a, { turn: 0, intents: [lo, hi] });
    step(b, { turn: 0, intents: [hi, lo] });
    expect(a.owner[5]).toBe(3);
    expect(a.stamp[5]).toBe(1);
    expect(hashState(a)).toBe(hashState(b));
  });

  it('one seat, two ids on the same cell: the larger id is applied last (id tie-break)', () => {
    for (const order of [[0, 1, 2], [2, 1, 0], [1, 2, 0], [1, 0, 2]]) {
      const s = fresh();
      const list = [paint(1, 4, 10), paint(1, 4, 20), paint(1, 4, 30)];
      step(s, { turn: 0, intents: order.map((i) => list[i] as Intent) });
      expect(s.stamp[4]).toBe(30);
    }
  });

  it('any permutation of the intents of a turn gives the same state (fast-check, 500 runs)', () => {
    const cells = W * H;
    fc.assert(
      fc.property(fc.array(smallMatchIntent(SEATS, cells), { maxLength: 14 }), fc.infiniteStream(fc.nat()), (intents, rnd) => {
        const shuffled = [...intents];
        const it = rnd[Symbol.iterator]();
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = (it.next().value as number) % (i + 1);
          [shuffled[i], shuffled[j]] = [shuffled[j] as Intent, shuffled[i] as Intent];
        }
        const a = fresh();
        const b = fresh();
        step(a, { turn: 0, intents });
        step(b, { turn: 0, intents: shuffled });
        expect(hashState(a)).toBe(hashState(b));
        expect(a.outbox.length).toBe(b.outbox.length);
      }),
      { numRuns: 500 },
    );
  });

  it('compareIntents is the order (seat, id, kind, payload) and a total order on valid intents', () => {
    expect(compareIntents(paint(0, 9, 9), paint(1, 0, 0))).toBeLessThan(0);
    expect(compareIntents(paint(1, 0, 3), paint(1, 9, 2))).toBeGreaterThan(0);
    expect(compareIntents(noop(1, 3), paint(1, 0, 3))).toBeLessThan(0);
    expect(compareIntents(paint(1, 4, 3), paint(1, 5, 3))).toBeLessThan(0);
    expect(compareIntents(paint(1, 4, 3), paint(1, 4, 3))).toBe(0);
  });
});

describe('intents never change state outside step()', () => {
  it('validate, copy, encode, decode, compare and id handling leave the state hash alone', () => {
    const s = fresh();
    step(s, { turn: 0, intents: [paint(1, 3, 3)] });
    const h = hashState(s);
    const i = paint(2, 5, 7);
    validateIntent(i, { seats: 4, cells: 30, debugIntents: true });
    copyBody(i);
    withId(copyBody(i), 3);
    compareIntents(i, paint(0, 0, 0));
    new IdAllocator().alloc(2);
    decodeTurn(encodeTurn({ turn: 1, intents: [i] }));
    encodeIntent(i);
    expect(hashState(s)).toBe(h);
  });

  it('step does not modify its input: frozen turns, frozen intents and frozen lists are fine', () => {
    const s = fresh();
    const turn = deepFreeze({ turn: 0, intents: [paint(3, 2, 1), paint(0, 2, 0), noop(1, 4), paint(0, 99, 5)] });
    expect(() => step(s, turn)).not.toThrow();
    expect(turn.intents.map((x) => x.seat)).toEqual([3, 0, 1, 0]); // not even re-sorted in place
  });

  it('an intent object stays valid and unchanged after step (the state keeps no reference to it)', () => {
    const s = fresh();
    const i = paint(1, 6, 8);
    const copy = { ...i };
    step(s, { turn: 0, intents: [i] });
    expect(i).toEqual(copy);
    expect(Object.keys(i).sort()).toEqual(['cell', 'id', 'kind', 'seat']);
  });
});

describe('copyBody and IdAllocator', () => {
  it('copyBody keeps only the known fields of a body and turns non-intents into INVALID_BODY', () => {
    const src = { kind: 'DebugPaint', seat: 1, cell: 2, id: 99, evil: { shared: true } };
    const c = copyBody(src);
    expect(c).toEqual({ kind: 'DebugPaint', seat: 1, cell: 2 });
    expect(c).not.toBe(src);
    expect(copyBody({ kind: 'Noop', seat: 3, id: 5 })).toEqual({ kind: 'Noop', seat: 3 });
    for (const junk of [null, undefined, 3, 'x', [], { kind: 'Spawn' }, { seat: 1 }]) expect(copyBody(junk)).toBe(INVALID_BODY);
    expect(copyBody({ kind: 'Noop', seat: 'a' })).toEqual({ kind: 'Noop', seat: -1 });
    const alloc = new IdAllocator();
    expect([alloc.alloc(0), alloc.alloc(0), alloc.alloc(1), alloc.alloc(0)]).toEqual([0, 1, 0, 2]);
    expect(alloc.alloc(-1)).toBe(0);
    expect(alloc.alloc(300)).toBe(0);
    expect(alloc.alloc(1.5)).toBe(0);
    expect(alloc.alloc(1)).toBe(1);
    // INVALID_BODY is refused by step in every match
    const s = fresh();
    expect(step(s, { turn: 0, intents: [withId(INVALID_BODY, 0)] })).toEqual({ ok: true, applied: 0, rejected: 1 });
  });
});

describe('outbox', () => {
  it('is not part of the hash: junk in it, draining it or never reading it gives the same hash', () => {
    const a = fresh();
    const b = fresh();
    step(a, { turn: 0, intents: [paint(0, 1, 0)] });
    step(b, { turn: 0, intents: [paint(0, 1, 0)] });
    for (let i = 0; i < 100; i++) b.outbox.push(9, i, i, i);
    expect(a.outbox.length).toBe(1);
    expect(b.outbox.length).toBe(101);
    expect(hashState(a)).toBe(hashState(b));
    b.outbox.clear();
    expect(hashState(a)).toBe(hashState(b));
  });

  it('is bounded: past OUTBOX_CAPACITY events are counted as dropped, never grow the memory', () => {
    const s = fresh();
    for (let i = 0; i < OUTBOX_CAPACITY + 10; i++) s.outbox.push(1, 0, i, 0);
    expect(s.outbox.length).toBe(OUTBOX_CAPACITY);
    expect(s.outbox.dropped).toBe(10);
    expect(s.outbox.drain().length).toBe(OUTBOX_CAPACITY);
    expect(s.outbox.dropped).toBe(0);
    expect(s.outbox.length).toBe(0);
  });

  it('step never reads it: a full outbox does not change what step does', () => {
    const a = fresh();
    const b = fresh();
    for (let i = 0; i < OUTBOX_CAPACITY; i++) b.outbox.push(1, 0, i, 0);
    for (let t = 0; t < 20; t++) {
      const intents = [paint(t % 4, t, t), paint((t + 1) % 4, 29 - t, t)];
      step(a, { turn: t, intents });
      step(b, { turn: t, intents });
    }
    expect(hashState(a)).toBe(hashState(b));
  });
});
