// The state hash: FNV-1a over 32-bit words with a fold step, fixed word order, little-endian packing of narrow arrays.
//
// Pure FNV-1a over whole 32-bit words (h ^= word; h *= prime) has a hole: multiplication only moves bits UPWARD, so a
// change in bit 31 stays in bit 31, and two changes of bit 31 in different words cancel each other exactly. Every word
// step therefore ends with `h ^= h >>> 15`, which brings the high bits down again (tests/sim/hash.test.ts shows both
// the hole of the pure version and that this one has none). A single changed word still always changes the result:
// every step (xor with a word, odd multiply, xorshift) is a bijection of the 32-bit state.

/** FNV-1a 32-bit offset basis. */
export const FNV_OFFSET = 0x811c9dc5;
/** FNV 32-bit prime. */
export const FNV_PRIME = 0x01000193;

/** Folds one 32-bit word into the running hash. */
export function foldWord(h: number, word: number): number {
  const m = Math.imul(h ^ word, FNV_PRIME);
  return m ^ (m >>> 15);
}

/** Folds a byte array: its length, then the bytes packed four at a time, little-endian, the tail zero padded. */
export function foldBytes(h: number, bytes: Uint8Array): number {
  const n = bytes.length;
  let x = foldWord(h, n);
  const full = n - (n & 3);
  for (let i = 0; i < full; i += 4) {
    x = foldWord(x, (bytes[i] as number) | ((bytes[i + 1] as number) << 8) | ((bytes[i + 2] as number) << 16) | ((bytes[i + 3] as number) << 24));
  }
  if (full < n) {
    let w = 0;
    for (let i = full, shift = 0; i < n; i++, shift += 8) w |= (bytes[i] as number) << shift;
    x = foldWord(x, w);
  }
  return x;
}

/** Folds a 16-bit array: its length, then two values per word (low value in the low half), an odd tail zero padded. */
export function foldU16(h: number, values: Uint16Array): number {
  const n = values.length;
  let x = foldWord(h, n);
  const full = n - (n & 1);
  for (let i = 0; i < full; i += 2) x = foldWord(x, (values[i] as number) | ((values[i + 1] as number) << 16));
  if (full < n) x = foldWord(x, values[full] as number);
  return x;
}

/** Folds a 32-bit array: its length, then the values as they are. */
export function foldU32(h: number, values: Uint32Array): number {
  const n = values.length;
  let x = foldWord(h, n);
  for (let i = 0; i < n; i++) x = foldWord(x, values[i] as number);
  return x;
}

/** The unsigned result of a running hash. */
export function finishHash(h: number): number {
  return h >>> 0;
}

/** Eight lower-case hex digits of an unsigned 32-bit value (the form used in hash files and the CLI). */
export function hex32(n: number): string {
  return (n >>> 0).toString(16).padStart(8, '0');
}

/** Reference: plain FNV-1a over whole 32-bit words, WITHOUT the fold step. Only for the test that documents its hole. */
export function fnv1aPureWords(words: readonly number[]): number {
  let h = FNV_OFFSET | 0;
  for (const w of words) h = Math.imul(h ^ w, FNV_PRIME);
  return h >>> 0;
}
