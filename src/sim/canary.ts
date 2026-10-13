// The Float64 canary: a loop of sqrt, multiply, divide, add over 100 000 values whose hash must be equal in every engine
// the game runs in (Node and Chromium today). It is the proof for the cross-engine path later milestones rely on:
// IEEE 754 double arithmetic with the four basic operations and sqrt is exactly rounded, so the bit patterns agree.
// Nothing here uses a transcendental function (those differ between engines), and the bit patterns are read through
// DataView with an explicit byte order, so the hash does not depend on the machine's endianness either.
import { FNV_OFFSET, finishHash, foldWord } from './hash';

/** Number of values the canary loops over. */
export const CANARY_VALUES = 100000;

/** Hash of the canary run. */
export function canaryHash(values: number = CANARY_VALUES): number {
  const buf = new DataView(new ArrayBuffer(8));
  let h = FNV_OFFSET | 0;
  let acc = 1;
  let seed = 0x2545f491;
  for (let i = 0; i < values; i++) {
    // xorshift32 gives a deterministic integer stream; v lies in (0, 1].
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    const v = ((seed >>> 0) + 1) / 4294967296;
    // A dependent chain: every step needs the previous result, so the order of operations matters.
    const r = Math.sqrt(v);
    acc = (acc * 0.9990234375 + r * v) / (1 + v * r);
    const scaled = acc * 1024 + v / (r + 0.5);
    buf.setFloat64(0, scaled, true);
    h = foldWord(h, buf.getUint32(0, true));
    h = foldWord(h, buf.getUint32(4, true));
  }
  return finishHash(h);
}
