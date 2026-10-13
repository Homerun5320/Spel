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
  serializedLengthOf,
  type DeserializeError,
} from '../../src/sim/serialize';
import { ENGINE_VERSION, STATE_ARRAY_NAMES, createEmptyState, createState, stateArray, type GameState } from '../../src/sim/state';
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

  it('the layout is the documented one (little-endian, 64 byte header, 11 bytes per cell, 2 per row, 16 per ownerId, the attack table, the enclave queue, 4 byte checksum)', () => {
    const s = sample(5);
    const b = serialize(s);
    const v = new DataView(b.buffer);
    expect(b.length).toBe(serializedLengthOf(s));
    // fixed part + attack table (8 byte head; per attack 36 bytes, 8 per non-empty frontier bag and 4 per frontier cell) + 20 bucket counts and the queued cells (4 each) + checksum
    const attacks = s.attacks.list.reduce((n, a) => n + 36 + 4 * a.size + 8 * a.counts.reduce((k, c) => k + (c > 0 ? 1 : 0), 0), 0);
    expect(b.length).toBe(HEADER_BYTES + 128 * 64 * 11 + 64 * 2 + 5 * 16 + 8 + attacks + 20 * 4 + 4 * s.enclaves.length + 4);
    expect(serializedLength(128, 64, 4)).toBe(HEADER_BYTES + 128 * 64 * 11 + 64 * 2 + 5 * 16 + 8 + 20 * 4 + 4);
    expect(HEADER_BYTES).toBe(64);
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
    expect(v.getUint32(60, true)).toBe(4); // players
    expect(b[HEADER_BYTES]).toBe(s.terrain[0]);
    expect(v.getUint16(HEADER_BYTES + 8192 + 2 * 100, true)).toBe(s.elevation[100]);
    // the exposure array follows the stamp array (terrain 1 + elevation 2 + owner 2 + stamp 4 bytes per cell)
    const exposureAt = HEADER_BYTES + 128 * 64 * 9;
    for (const i of [0, 100, 4097, 8191]) expect(v.getUint16(exposureAt + 2 * i, true)).toBe(s.exposure[i]);
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

describe('serialize / deserialize: wide values (every field at its full range)', () => {
  /** A cheap deterministic word source for the test itself (not the sim generator, so a broken rng cannot hide anything). */
  function words(seed: number): () => number {
    let x = seed | 0;
    return () => {
      x = (Math.imul(x ^ (x >>> 15), 0x2c1b3c6d) + 0x9e3779b9) | 0;
      return (x ^ (x >>> 13)) >>> 0;
    };
  }

  /** A state with extreme values written directly: owner 0..255, stamp up to 0xffffffff, tick and rejects above 2^16. */
  function extreme(seed: number, seats: number, w = 40, h = 25): GameState {
    const s = createEmptyState(w, h, seed, seats, { debugIntents: true });
    const next = words(seed ^ 0x5bd1e995);
    for (let i = 0; i < s.owner.length; i++) {
      s.terrain[i] = next() & 7;
      s.elevation[i] = next() & 0xffff;
      s.owner[i] = next() % (seats + 1);
      s.stamp[i] = next();
    }
    // The extremes themselves, so a truncating writer cannot hide behind a lucky random draw.
    s.stamp[0] = 0xffffffff;
    s.stamp[1] = 0x10000;
    s.stamp[2] = 0x80000000;
    s.elevation[0] = 0xffff;
    s.owner[0] = seats;
    s.owner[1] = 1;
    s.tick = 0xfffffffe;
    s.rejects = (0x10000 + (next() & 0xffff0000)) >>> 0;
    for (let i = 0; i < 4; i++) s.rng[i] = next() | 0x80000000;
    s.rng[0] = 0xffffffff;
    return s;
  }

  function roundTrip(s: GameState): GameState {
    const r = deserialize(serialize(s));
    if (!r.ok) throw new Error(`round trip failed: ${r.error}`);
    return r.state;
  }

  function expectSame(t: GameState, s: GameState): void {
    expect(hashState(t)).toBe(hashState(s));
    expect(t.header).toEqual(s.header);
    expect(t.tick).toBe(s.tick);
    expect(t.rejects).toBe(s.rejects);
    expect([t.width, t.height]).toEqual([s.width, s.height]);
    for (const name of STATE_ARRAY_NAMES) expect(stateArray(t, name)).toEqual(stateArray(s, name));
  }

  it.each([1, 4, 127, 128, 254, 255])('round-trips a %i-seat state with extreme owner, stamp, tick, rejects and generator words', (seats) => {
    const s = extreme(seats * 7919, seats);
    expectSame(roundTrip(s), s);
    // The bytes themselves: the words are stored in full, not through a narrower field.
    const v = new DataView(serialize(s).buffer);
    expect(v.getUint32(24, true)).toBe(seats);
    expect(v.getUint32(36, true)).toBe(0xfffffffe);
    expect(v.getUint32(40, true)).toBe(s.rejects);
    expect(v.getUint32(44, true)).toBe(0xffffffff);
    const n = s.width * s.height;
    expect(v.getUint32(HEADER_BYTES + 5 * n + 0, true)).toBe(0xffffffff);
    expect(v.getUint32(HEADER_BYTES + 5 * n + 4, true)).toBe(0x10000);
    expect(v.getUint32(HEADER_BYTES + 5 * n + 8, true)).toBe(0x80000000);
    expect(serialize(s)[HEADER_BYTES + 2 * n + n]).toBe(seats); // owner[0]
  });

  it('ownerId is a 16-bit field (D71): the high byte is stored, hashed and range checked', () => {
    const s = createEmptyState(4, 2, 3, 2);
    expect(s.owner).toBeInstanceOf(Uint16Array);
    s.owner[5] = 2;
    const base = serialize(s);
    const ownerAt = HEADER_BYTES + 8 + 16;
    expect([base[ownerAt + 10], base[ownerAt + 11]]).toEqual([2, 0]);
    // A value that only a 16-bit field can hold: the hash sees it, the checksum accepts it, the range check refuses it.
    const wide = createEmptyState(4, 2, 3, 2);
    wide.owner[5] = 0x0102;
    expect(hashState(wide)).not.toBe(hashState(s));
    const bytes = serialize(wide);
    expect([bytes[ownerAt + 10], bytes[ownerAt + 11]]).toEqual([2, 1]);
    const r = deserialize(bytes);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('owner-range');
  });

  it('keeps tick and rejects above 65535 apart and exact', () => {
    for (const [tick, rejects] of [[65536, 65537], [0x12345678, 0x9abcdef0], [0xffffffff, 0xffffffff]] as const) {
      const s = createEmptyState(8, 8, 3, 2);
      s.tick = tick;
      s.rejects = rejects;
      const t = roundTrip(s);
      expect([t.tick, t.rejects]).toEqual([tick, rejects]);
    }
  });

  it('keeps seeds at both ends of the range: -1 and 0xffffffff are the same seed, 0 and 0x80000000 are kept', () => {
    for (const seed of [-1, 0xffffffff, 0, 0x80000000, -2147483648, 0x10000]) {
      const fresh = createEmptyState(40, 25, seed, 3, { debugIntents: true });
      const t = roundTrip(fresh);
      expect(t.header.seed).toBe(fresh.header.seed);
      expect(t.header.seed).toBe(seed >>> 0);
      expect(t.rng).toEqual(fresh.rng);
      expect(hashState(t)).toBe(hashState(fresh));
    }
  });

  it('keeps all 256 values of the terrain byte, the elevation word and a full-range mapHash', () => {
    const s = createState({
      width: 64,
      height: 64,
      seed: 5,
      seats: 255,
      terrain: Uint8Array.from({ length: 4096 }, (_, i) => i & 255),
      elevation: Uint16Array.from({ length: 4096 }, (_, i) => (i * 40503) & 0xffff),
      mapHash: 0xfedcba98,
    });
    for (let i = 0; i < 4096; i++) s.owner[i] = (i * 3) & 255 || 255;
    expectSame(roundTrip(s), s);
    expect(roundTrip(s).header.mapHash).toBe(0xfedcba98);
  });

  it('round-trips random extreme states (fast-check: seats, seed, tick, rejects, sizes)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 255 }),
        fc.integer({ min: -2147483648, max: 4294967295 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 0, max: 0xffffffff }),
        fc.integer({ min: 0, max: 0xffffffff }),
        (seats, seed, w, h, tick, rejects) => {
          const s = extreme(seed, seats, w, h);
          s.tick = tick;
          s.rejects = rejects;
          expectSame(roundTrip(s), s);
        },
      ),
      { numRuns: 200 },
    );
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
    expectErr(patch((v) => v.setUint32(8, ENGINE_VERSION + 1, true)), 'engine-version');
    expectErr(patch((v) => v.setUint32(20, 2, true)), 'header'); // unknown config bit
    expectErr(patch((v) => v.setUint32(24, 0, true)), 'header'); // zero seats
    expectErr(patch((v) => v.setUint32(24, 256, true)), 'header');
    expectErr(patch((v) => v.setUint32(28, 0, true)), 'header');
    expectErr(patch((v) => v.setUint32(28, 4097, true)), 'header');
    expectErr(patch((v) => { v.setUint32(28, 4096, true); v.setUint32(32, 4096, true); }), 'header'); // 16 M cells
    expectErr(patch((v) => v.setUint32(28, 5, true)), 'size');
    expectErr(good.subarray(0, good.length - 1), 'size');
    expectErr(new Uint8Array([...good, 0]), 'size');
    const ownerAt = HEADER_BYTES + 8 + 16; // 4x2 = 8 cells: terrain 8 bytes, elevation 16 bytes, then owner (u16, little endian)
    expectErr(patch((_v, b) => { b[ownerAt + 6] = 3; }), 'owner-range'); // 2 seats: ownerId 3 does not exist
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
    expect(serialize(createScenarioState(GOLDEN_PARAMS)).length).toBe(64 + 8192 * 11 + 64 * 2 + 5 * 16 + 8 + 20 * 4 + 4);
  });
});
