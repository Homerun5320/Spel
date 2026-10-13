import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { hex32 } from '../../src/sim/hash';
import { GOLDEN_PARAMS, createScenarioState, runScenario } from '../../src/sim/scenario';
import {
  FORMAT_VERSION,
  HEADER_BYTES,
  MAGIC,
  deserialize,
  hashState,
  serialize,
  serializedLength,
  type DeserializeError,
} from '../../src/sim/serialize';
import { STATE_ARRAY_NAMES, createEmptyState, stateArray, type GameState } from '../../src/sim/state';
import { step } from '../../src/sim/step';

function sample(ticks = 60): GameState {
  const s = createScenarioState();
  runScenario(s, ticks);
  return s;
}

function expectErr(bytes: Uint8Array, error: DeserializeError): void {
  const r = deserialize(bytes);
  expect(r.ok ? 'ok' : r.error).toBe(error);
}

describe('serialize / deserialize', () => {
  it('round-trips: same hash, same arrays, same header, same scalars', () => {
    const s = sample();
    const r = deserialize(serialize(s));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const t = r.state;
    expect(hashState(t)).toBe(hashState(s));
    expect(t.header).toEqual(s.header);
    expect([t.width, t.height, t.tick, t.rejects]).toEqual([s.width, s.height, s.tick, s.rejects]);
    for (const name of STATE_ARRAY_NAMES) expect(stateArray(t, name)).toEqual(stateArray(s, name));
    expect(t.outbox.length).toBe(0);
  });

  it('the layout is the documented one (little-endian, 60 byte header, 8 bytes per cell, 4 byte checksum)', () => {
    const s = sample(5);
    const b = serialize(s);
    const v = new DataView(b.buffer);
    expect(b.length).toBe(serializedLength(128, 64));
    expect(b.length).toBe(HEADER_BYTES + 128 * 64 * 8 + 4);
    expect(HEADER_BYTES).toBe(60);
    expect(Array.from(b.subarray(0, 4))).toEqual([0x53, 0x50, 0x45, 0x4c]); // 'SPEL'
    expect(v.getUint32(0, true)).toBe(MAGIC);
    expect(v.getUint32(4, true)).toBe(FORMAT_VERSION);
    expect(v.getUint32(8, true)).toBe(s.header.engineVersion);
    expect(v.getUint32(12, true)).toBe(s.header.mapHash);
    expect(v.getUint32(16, true)).toBe(s.header.seed);
    expect(v.getUint32(20, true)).toBe(1); // debugIntents
    expect(v.getUint32(24, true)).toBe(4);
    expect(v.getUint32(28, true)).toBe(128);
    expect(v.getUint32(32, true)).toBe(64);
    expect(v.getUint32(36, true)).toBe(5);
    expect(v.getUint32(40, true)).toBe(s.rejects);
    for (let i = 0; i < 4; i++) expect(v.getUint32(44 + 4 * i, true)).toBe(s.rng[i]);
    expect(b[60]).toBe(s.terrain[0]);
    expect(v.getUint16(60 + 8192 + 2 * 100, true)).toBe(s.elevation[100]);
    expect(v.getUint32(b.length - 4, true)).toBe(hashState(s));
  });

  it('is a pure function of the state: twice the same bytes, a fresh buffer each time', () => {
    const s = sample();
    const a = serialize(s);
    const b = serialize(s);
    expect(a).toEqual(b);
    expect(a.buffer).not.toBe(b.buffer);
    a[100] = (a[100] as number) ^ 1;
    expect(serialize(s)).toEqual(b);
  });

  it('shares no memory with the bytes it was made from, or with the state it came from', () => {
    const s = sample();
    const bytes = serialize(s);
    const r = deserialize(bytes);
    if (!r.ok) throw new Error('round trip failed');
    const h = hashState(r.state);
    bytes.fill(0);
    expect(hashState(r.state)).toBe(h);
    const again = serialize(r.state);
    r.state.owner[0] = (r.state.owner[0] as number) ^ 1;
    expect(deserialize(again).ok).toBe(true);
  });

  it('reads bytes that sit inside a bigger buffer (byteOffset) and Node Buffers', () => {
    const s = sample(10);
    const bytes = serialize(s);
    const big = new Uint8Array(bytes.length + 13);
    big.set(bytes, 5);
    const view = big.subarray(5, 5 + bytes.length);
    const r = deserialize(view);
    expect(r.ok && hashState(r.state)).toBe(hashState(s));
    const buf = Buffer.from(bytes);
    const r2 = deserialize(buf);
    expect(r2.ok && hashState(r2.state)).toBe(hashState(s));
    if (r2.ok) {
      buf.fill(0);
      expect(hashState(r2.state)).toBe(hashState(s));
    }
  });

  it('a snapshot at tick k continues exactly like the original (the generator state is in the snapshot)', () => {
    const s = sample(300);
    const r = deserialize(serialize(s));
    if (!r.ok) throw new Error('round trip failed');
    runScenario(s, 900);
    runScenario(r.state, 900);
    expect(hashState(r.state)).toBe(hashState(s));
    expect(r.state.rng).toEqual(s.rng);
  });

  it('the outbox is not serialised: bytes are the same with and without events in it', () => {
    const a = sample(20);
    const b = sample(20);
    for (let i = 0; i < 50; i++) b.outbox.push(1, 0, i, 0);
    expect(serialize(a)).toEqual(serialize(b));
  });
});

describe('deserialize: errors are results, never throws', () => {
  const good = serialize(createEmptyState(4, 2, 7, 2, { debugIntents: true }));
  const patch = (fn: (v: DataView, b: Uint8Array) => void): Uint8Array => {
    const b = good.slice();
    fn(new DataView(b.buffer), b);
    return b;
  };

  it('names what is wrong', () => {
    expectErr(null as never, 'not-bytes');
    expectErr('SPEL' as never, 'not-bytes');
    expectErr(new Uint16Array(40) as never, 'not-bytes');
    expectErr(new Uint8Array(0), 'too-short');
    expectErr(good.subarray(0, 63), 'too-short');
    expectErr(patch((v) => v.setUint32(0, 0x12345678, true)), 'magic');
    expectErr(patch((v) => v.setUint32(4, FORMAT_VERSION + 1, true)), 'format-version');
    expectErr(patch((v) => v.setUint32(8, 2, true)), 'engine-version');
    expectErr(patch((v) => v.setUint32(20, 2, true)), 'header'); // unknown config bit
    expectErr(patch((v) => v.setUint32(24, 0, true)), 'header'); // zero seats
    expectErr(patch((v) => v.setUint32(24, 256, true)), 'header');
    expectErr(patch((v) => v.setUint32(28, 0, true)), 'header');
    expectErr(patch((v) => v.setUint32(28, 4097, true)), 'header');
    expectErr(patch((v) => { v.setUint32(28, 4096, true); v.setUint32(32, 4096, true); }), 'header'); // 16 M cells
    expectErr(patch((v) => v.setUint32(28, 5, true)), 'size');
    expectErr(good.subarray(0, good.length - 1), 'size');
    expectErr(new Uint8Array([...good, 0]), 'size');
    const ownerAt = HEADER_BYTES + 8 + 16; // 4x2 = 8 cells: terrain 8 bytes, elevation 16 bytes, then owner
    expectErr(patch((_v, b) => { b[ownerAt + 3] = 3; }), 'owner-range'); // 2 seats: ownerId 3 does not exist
    expectErr(patch((v) => v.setUint32(good.length - 4, 0, true)), 'checksum');
    expectErr(patch((v) => v.setUint32(36, 99, true)), 'checksum'); // tick altered, checksum stale
  });

  it('an absurd header never allocates: a 2^32-wide claim is refused before any array is made', () => {
    const b = patch((v) => { v.setUint32(28, 0xffffffff, true); v.setUint32(32, 0xffffffff, true); });
    expectErr(b, 'header');
  });

  it('EVERY single changed bit of a serialized state is detected (all 1024 bit flips of a small state)', () => {
    for (let i = 0; i < good.length; i++) {
      for (let bit = 0; bit < 8; bit++) {
        const b = good.slice();
        b[i] = (b[i] as number) ^ (1 << bit);
        expect(deserialize(b).ok, `byte ${i} bit ${bit}`).toBe(false);
      }
    }
  });

  it('a byte flipped anywhere in a bigger state is detected too (sampled positions)', () => {
    const bytes = serialize(sample(100));
    fc.assert(
      fc.property(fc.nat(bytes.length - 1), fc.integer({ min: 1, max: 255 }), (at, x) => {
        const b = bytes.slice();
        b[at] = (b[at] as number) ^ x;
        expect(deserialize(b).ok).toBe(false);
      }),
      { numRuns: 400 },
    );
  });

  it('random bytes and truncated / extended valid states never throw (fast-check)', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 300 }), (b) => {
        expect(deserialize(b).ok).toBe(false);
      }),
      { numRuns: 3000 },
    );
    fc.assert(
      fc.property(fc.nat(good.length + 20), (n) => {
        const b = n <= good.length ? good.subarray(0, n) : new Uint8Array([...good, ...new Uint8Array(n - good.length)]);
        const r = deserialize(b);
        expect(r.ok).toBe(n === good.length);
      }),
      { numRuns: 400 },
    );
  });

  it('deserialized states are healthy: step works on them', () => {
    const r = deserialize(good);
    if (!r.ok) throw new Error('unexpected');
    expect(step(r.state, { turn: 0, intents: [{ kind: 'DebugPaint', seat: 1, cell: 3, id: 0 }] }).ok).toBe(true);
    expect(r.state.owner[3]).toBe(2);
    expect(hex32(hashState(r.state)).length).toBe(8);
  });
});

describe('golden params', () => {
  it('serialized size of the golden world', () => {
    expect(serialize(createScenarioState(GOLDEN_PARAMS)).length).toBe(60 + 8192 * 8 + 4);
  });
});
