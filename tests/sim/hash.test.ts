import { describe, expect, it } from 'vitest';
import { FNV_OFFSET, FNV_PRIME, fnv1aPureWords, foldBytes, foldU16, foldU32, foldWord, hex32 } from '../../src/sim/hash';

describe('state hash core', () => {
  it('packs narrow arrays into little-endian words, with their length first', () => {
    const h = FNV_OFFSET | 0;
    expect(foldBytes(h, new Uint8Array([1, 2, 3, 4]))).toBe(foldWord(foldWord(h, 4), 0x04030201 | 0));
    expect(foldBytes(h, new Uint8Array([1, 2, 3, 4, 5]))).toBe(foldWord(foldWord(foldWord(h, 5), 0x04030201 | 0), 5));
    expect(foldU16(h, new Uint16Array([1, 2]))).toBe(foldWord(foldWord(h, 2), 0x00020001));
    expect(foldU16(h, new Uint16Array([0xffff, 0xffff, 7]))).toBe(foldWord(foldWord(foldWord(h, 3), -1), 7));
    expect(foldU32(h, new Uint32Array([0xdeadbeef, 1]))).toBe(foldWord(foldWord(foldWord(h, 2), 0xdeadbeef), 1));
  });

  it('arrays of different length never hash alike even when the content is all zero', () => {
    const h = FNV_OFFSET | 0;
    expect(foldBytes(h, new Uint8Array(1))).not.toBe(foldBytes(h, new Uint8Array(2)));
    expect(foldBytes(h, new Uint8Array(0))).not.toBe(foldBytes(h, new Uint8Array(1)));
    expect(foldU16(h, new Uint16Array(3))).not.toBe(foldU16(h, new Uint16Array(4)));
  });

  it('any single changed bit anywhere changes the hash (checked for every bit of a 300-byte array)', () => {
    const a = new Uint8Array(300);
    for (let i = 0; i < a.length; i++) a[i] = (i * 37 + 11) & 255;
    const base = foldBytes(FNV_OFFSET | 0, a);
    for (let i = 0; i < a.length; i++) {
      for (let bit = 0; bit < 8; bit++) {
        a[i] = (a[i] as number) ^ (1 << bit);
        expect(foldBytes(FNV_OFFSET | 0, a), `byte ${i} bit ${bit}`).not.toBe(base);
        a[i] = (a[i] as number) ^ (1 << bit);
      }
    }
  });

  it('documents why the fold step exists: pure word-wise FNV-1a loses two changes of bit 31, this hash does not', () => {
    const words = [0x12345678, 0x9abcdef0, 0x0badf00d, 0x11111111];
    const flipped = words.map((w, i) => (i === 0 || i === 2 ? (w ^ 0x80000000) >>> 0 : w));
    expect(fnv1aPureWords(flipped)).toBe(fnv1aPureWords(words)); // the hole
    const fold = (ws: number[]): number => ws.reduce((h, w) => foldWord(h, w), FNV_OFFSET | 0) >>> 0;
    expect(fold(flipped)).not.toBe(fold(words));
    // and the same through the array API: two owner cells whose bytes sit at bit 31 of two different words
    const a = new Uint8Array(16);
    const b = new Uint8Array(16);
    b[3] = 0x80;
    b[11] = 0x80;
    expect(foldBytes(FNV_OFFSET | 0, a)).not.toBe(foldBytes(FNV_OFFSET | 0, b));
  });

  it('keeps the FNV-1a constants', () => {
    expect(FNV_OFFSET).toBe(0x811c9dc5);
    expect(FNV_PRIME).toBe(16777619);
    // Plain FNV-1a on one word is the textbook formula.
    expect(fnv1aPureWords([0])).toBe(Math.imul(0x811c9dc5 | 0, 0x01000193) >>> 0);
  });

  it('hex32 prints eight lower-case digits', () => {
    expect(hex32(0)).toBe('00000000');
    expect(hex32(255)).toBe('000000ff');
    expect(hex32(-1)).toBe('ffffffff');
    expect(hex32(0xabcdef12)).toBe('abcdef12');
  });
});
