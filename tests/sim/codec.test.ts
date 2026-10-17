import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decodeIntent, decodeTurn, encodeIntent, encodeTurn } from '../../src/sim/codec';
import { MAX_INTENTS_PER_TURN } from '../../src/sim/rules';
import { hashState } from '../../src/sim/serialize';
import { createEmptyState } from '../../src/sim/state';
import { step } from '../../src/sim/step';
import { mixedIntent, wireIntent, wireTurn } from './helpers/arbitraries';

describe('codec: round trip', () => {
  it('10 000 random intents survive encode -> decode unchanged and re-encode to the same bytes', () => {
    let n = 0;
    fc.assert(
      fc.property(mixedIntent, (intent) => {
        n++;
        const bytes = encodeIntent(intent);
        const back = decodeIntent(bytes);
        expect(back.ok).toBe(true);
        if (back.ok) {
          expect(back.value).toEqual(intent);
          expect(encodeIntent(back.value)).toEqual(bytes);
        }
      }),
      { numRuns: 10000 },
    );
    expect(n).toBe(10000);
  });

  it('turns round trip too (any order of intents is kept as given)', () => {
    fc.assert(
      fc.property(wireTurn, (turn) => {
        const bytes = encodeTurn(turn);
        const back = decodeTurn(bytes);
        expect(back.ok && back.value).toEqual(turn);
      }),
      { numRuns: 2000 },
    );
  });

  it('is compact: 3 bytes for a small Noop, 4 for a small DebugPaint, 12 for the largest', () => {
    expect(encodeIntent({ kind: 'Noop', seat: 0, id: 0 }).length).toBe(3);
    expect(encodeIntent({ kind: 'DebugPaint', seat: 3, id: 5, cell: 100 }).length).toBe(4);
    expect(encodeIntent({ kind: 'DebugPaint', seat: 255, id: 4294967295, cell: 4294967295 }).length).toBe(12);
    expect(Array.from(encodeIntent({ kind: 'DebugPaint', seat: 2, id: 1, cell: 300 }))).toEqual([1, 2, 1, 0xac, 0x02]);
    expect(Array.from(encodeTurn({ turn: 7, intents: [{ kind: 'Noop', seat: 1, id: 2 }] }))).toEqual([7, 1, 0, 1, 2]);
  });

  it('refuses to encode what the wire cannot hold', () => {
    expect(() => encodeIntent({ kind: 'Noop', seat: 256, id: 0 })).toThrow(RangeError);
    expect(() => encodeIntent({ kind: 'Noop', seat: -1, id: 0 })).toThrow(RangeError);
    expect(() => encodeIntent({ kind: 'Noop', seat: 0, id: 4294967296 })).toThrow(RangeError);
    expect(() => encodeIntent({ kind: 'DebugPaint', seat: 0, id: 0, cell: 1.5 })).toThrow(RangeError);
    expect(() => encodeTurn({ turn: -1, intents: [] })).toThrow(RangeError);
    expect(() => encodeTurn({ turn: 0, intents: new Array(MAX_INTENTS_PER_TURN + 1).fill({ kind: 'Noop', seat: 0, id: 0 }) })).toThrow(RangeError);
  });
});

describe('codec: malformed bytes give an error result and never throw', () => {
  const err = (r: ReturnType<typeof decodeIntent>) => (r.ok ? 'ok' : r.error);

  it('names the failure', () => {
    expect(err(decodeIntent(new Uint8Array([])))).toBe('truncated');
    expect(err(decodeIntent(new Uint8Array([0, 1])))).toBe('truncated');
    expect(err(decodeIntent(new Uint8Array([25, 0, 0])))).toBe('kind'); // M14a made kind 24 (LaunchMissile) valid; M13c-1 made kind 23 (LaunchShip) valid; M12a-1 made kind 12 (ProduceHeli) valid, Districts-1 kinds 9 to 11, M12a-2 kinds 13 and 14, M18c-1 kinds 15 to 20, M18d-1 kinds 21 and 22 (the first unknown kind is 23);
    expect(err(decodeIntent(new Uint8Array([0, 0, 0, 0])))).toBe('trailing');
    expect(err(decodeIntent(new Uint8Array([1, 0, 0])))).toBe('truncated'); // DebugPaint without a cell
    expect(err(decodeIntent(new Uint8Array([0, 0, 0x80, 0])))).toBe('varint'); // 0x80 0x00 is a long form of 0
    expect(err(decodeIntent(new Uint8Array([0, 0, 0x80, 0x80, 0x80, 0x80, 0x80, 0x01])))).toBe('varint'); // more than 5 bytes
    expect(err(decodeIntent(new Uint8Array([0, 0, 0xff, 0xff, 0xff, 0xff, 0x1f])))).toBe('varint'); // 2^33 - 1 > u32
    expect(err(decodeIntent(new Uint8Array([0, 0, 0xff, 0xff, 0xff, 0xff, 0x0f])))).toBe('ok'); // 2^32 - 1
    expect(err(decodeIntent('nope' as unknown as Uint8Array))).toBe('input');
    expect(err(decodeIntent(null as unknown as Uint8Array))).toBe('input');
    expect(decodeTurn(new Uint8Array([1])).ok).toBe(false);
    expect(decodeTurn(new Uint8Array([1, 2, 0, 0, 0])).ok).toBe(false); // count 2 but one intent
    expect(decodeTurn(new Uint8Array([1, 0, 9])).ok).toBe(false); // trailing
    const huge = decodeTurn(new Uint8Array([0, 0x81, 0x40])); // count = 8193 > MAX_INTENTS_PER_TURN
    expect(huge.ok ? 'ok' : huge.error).toBe('count');
  });

  it('a count that promises more intents than the bytes can hold is refused before anything is allocated', () => {
    const r = decodeTurn(new Uint8Array([0, 0xff, 0x1f])); // count = 4095 with no bytes left
    expect(r.ok).toBe(false);
  });

  it('random bytes: decode never throws, and whatever decodes re-encodes to exactly the same bytes (one meaning per string)', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 40 }), (bytes) => {
        const i = decodeIntent(bytes);
        if (i.ok) expect(encodeIntent(i.value)).toEqual(bytes);
        const t = decodeTurn(bytes);
        if (t.ok) expect(encodeTurn(t.value)).toEqual(bytes);
      }),
      { numRuns: 20000 },
    );
  });

  it('mutated valid encodings: decode never throws and is never silently lossy', () => {
    fc.assert(
      fc.property(wireIntent, fc.nat(11), fc.integer({ min: 0, max: 255 }), (intent, at, byte) => {
        const bytes = encodeIntent(intent).slice();
        if (at < bytes.length) bytes[at] = byte;
        const r = decodeIntent(bytes);
        if (r.ok) expect(encodeIntent(r.value)).toEqual(bytes);
      }),
      { numRuns: 5000 },
    );
  });

  it('every prefix of a valid turn fails cleanly (except the whole)', () => {
    fc.assert(
      fc.property(wireTurn, (turn) => {
        const bytes = encodeTurn(turn);
        for (let n = 0; n < bytes.length; n++) expect(decodeTurn(bytes.subarray(0, n)).ok).toBe(false);
      }),
      { numRuns: 300 },
    );
  });
});

/** Pure noise, or a valid turn with a few bytes overwritten (so that a good share still decodes). */
const garbledBytes = fc.oneof(
  fc.uint8Array({ maxLength: 64 }),
  fc
    .tuple(wireTurn, fc.array(fc.tuple(fc.nat(60), fc.integer({ min: 0, max: 255 })), { maxLength: 3 }))
    .map(([turn, edits]) => {
      const b = encodeTurn(turn).slice();
      for (const [at, v] of edits) if (at < b.length) b[at] = v;
      return b;
    }),
);

describe('malformed bytes never throw out of step()', () => {
  it('random bytes through decodeTurn into step(): 20 000 runs, with the decoded turn as it is and re-aimed at the current tick', () => {
    let decoded = 0;
    fc.assert(
      fc.property(garbledBytes, fc.boolean(), (bytes, aimed) => {
        const state = createEmptyState(6, 5, 3, 4, { debugIntents: true });
        const r = decodeTurn(bytes);
        if (!r.ok) return;
        decoded++;
        const turn = aimed ? { turn: state.tick, intents: r.value.intents } : r.value;
        const result = step(state, turn);
        expect(typeof result.ok).toBe('boolean');
        if (result.ok) expect(state.tick).toBe(1);
        hashState(state);
      }),
      { numRuns: 20000 },
    );
    expect(decoded).toBeGreaterThan(100);
  });

  it('structured garbage: well-formed turns full of out-of-range seats and cells are refused one by one, not thrown', () => {
    fc.assert(
      fc.property(wireTurn, (t) => {
        const state = createEmptyState(6, 5, 3, 4, { debugIntents: true });
        const r = decodeTurn(encodeTurn(t));
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const result = step(state, { turn: 0, intents: r.value.intents });
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.applied + result.rejected).toBe(t.intents.length);
      }),
      { numRuns: 2000 },
    );
  });
});
