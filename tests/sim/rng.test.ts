import { describe, expect, it } from 'vitest';
import { RNG_WORDS, createRng, nextBelow, nextU32, seedRng, splitmix32Mix, splitmix32Next } from '../../src/sim/rng';

// Independent reference implementations in BigInt (no shared code with the module under test).
const M32 = 0xffffffffn;
function refSplitmix(seed: bigint, count: number): bigint[] {
  let s = seed & M32;
  const out: bigint[] = [];
  for (let i = 0; i < count; i++) {
    s = (s + 0x9e3779b9n) & M32;
    let z = s;
    z = ((z ^ (z >> 16n)) * 0x21f0aaadn) & M32;
    z = ((z ^ (z >> 15n)) * 0x735a2d97n) & M32;
    out.push((z ^ (z >> 15n)) & M32);
  }
  return out;
}
function refSfc32(state: bigint[], count: number): bigint[] {
  let [a, b, c, d] = state as [bigint, bigint, bigint, bigint];
  const out: bigint[] = [];
  for (let i = 0; i < count; i++) {
    const t = (((a + b) & M32) + d) & M32;
    d = (d + 1n) & M32;
    a = b ^ (b >> 9n);
    b = (c + ((c << 3n) & M32)) & M32;
    c = ((c << 21n) & M32) | (c >> 11n);
    c = (c + t) & M32;
    out.push(t);
  }
  return out;
}

describe('rng', () => {
  it('the state is a Uint32Array(4)', () => {
    const r = createRng(1);
    expect(r).toBeInstanceOf(Uint32Array);
    expect(r.length).toBe(RNG_WORDS);
    expect(RNG_WORDS).toBe(4);
  });

  it('splitmix32 matches an independent BigInt implementation', () => {
    for (const seed of [0, 1, 2, 12345, 0x7fffffff, 0xffffffff, -1, -2147483648]) {
      const ref = refSplitmix(BigInt(seed), 8);
      let s = seed | 0;
      for (let i = 0; i < 8; i++) {
        s = splitmix32Next(s);
        expect(BigInt(splitmix32Mix(s))).toBe(ref[i]);
      }
    }
  });

  it('sfc32 seeded through splitmix32 matches the BigInt reference for 1000 draws', () => {
    for (const seed of [0, 1, 7, 0xdeadbeef, 0xffffffff]) {
      const r = createRng(seed);
      // Reference: four splitmix outputs, 12 discarded draws, then 1000 values.
      const init = refSplitmix(BigInt(seed), 4);
      const all = refSfc32(init, 12 + 1000).slice(12);
      // The reference must continue from the same state: recompute with a single generator run.
      const mine: bigint[] = [];
      for (let i = 0; i < 1000; i++) mine.push(BigInt(nextU32(r)));
      expect(mine).toEqual(all);
    }
  });

  it('known answers (pinned so that an accidental change of the stream is noticed)', () => {
    const r0 = createRng(0);
    expect(Array.from(r0)).toEqual([3581349348, 3415017548, 458257046, 2141751582]);
    expect([nextU32(r0), nextU32(r0), nextU32(r0), nextU32(r0)]).toEqual([548183886, 1097162541, 2219297441, 1664216021]);
    const r1 = createRng(1);
    expect(Array.from(r1)).toEqual([4269307524, 2439480051, 1591552067, 3011703621]);
    expect([nextU32(r1), nextU32(r1), nextU32(r1), nextU32(r1)]).toEqual([1130556604, 2591592147, 3014952990, 960850752]);
  });

  it('seedRng overwrites a used state completely', () => {
    const used = createRng(5);
    for (let i = 0; i < 100; i++) nextU32(used);
    seedRng(used, 9);
    expect(used).toEqual(createRng(9));
  });

  it('a copy of the state continues the same stream (the state is the whole generator)', () => {
    const a = createRng(77);
    for (let i = 0; i < 31; i++) nextU32(a);
    const b = a.slice();
    for (let i = 0; i < 100; i++) expect(nextU32(a)).toBe(nextU32(b));
  });

  it('nextBelow stays inside [0, n), covers the range, and is unbiased within a loose band', () => {
    const r = createRng(3);
    const n = 6;
    const counts = new Array<number>(n).fill(0);
    for (let i = 0; i < 60000; i++) {
      const v = nextBelow(r, n);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(n);
      counts[v] = (counts[v] as number) + 1;
    }
    for (const c of counts) expect(Math.abs(c - 10000)).toBeLessThan(500);
  });

  it('nextBelow edge cases: n = 1 draws nothing, huge n is clamped, bad n gives 0', () => {
    const r = createRng(4);
    const before = r.slice();
    expect(nextBelow(r, 1)).toBe(0);
    expect(nextBelow(r, 0)).toBe(0);
    expect(nextBelow(r, -5)).toBe(0);
    expect(nextBelow(r, NaN)).toBe(0);
    expect(r).toEqual(before);
    const v = nextBelow(r, 1e20);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(4294967296);
    // n = 2^32 is the identity on the stream.
    const a = createRng(8);
    const b = createRng(8);
    expect(nextBelow(a, 4294967296)).toBe(nextU32(b));
  });

  it('nextBelow with a rejection region consumes extra draws deterministically', () => {
    // n = 3 000 000 000 rejects every value >= 3 000 000 000 (about a third of draws).
    const a = createRng(11);
    const b = createRng(11);
    const n = 3_000_000_000;
    for (let i = 0; i < 200; i++) {
      let x = nextU32(b);
      while (x >= n) x = nextU32(b);
      expect(nextBelow(a, n)).toBe(x % n);
    }
    expect(a).toEqual(b);
  });
});
