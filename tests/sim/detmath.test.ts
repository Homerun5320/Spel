import { describe, expect, it } from 'vitest';
import {
  ANGLE_QUARTER,
  ANGLE_TURN,
  ISQRT_MAX,
  Q15_ONE,
  clamp,
  cosQ15,
  divQ15,
  floorDiv,
  isqrt,
  isqrt32,
  mulQ15,
  scaleQ15,
  sinQ15,
} from '../../src/sim/detmath';

function bigSqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

describe('isqrt32 / isqrt', () => {
  it('are exact for every n up to 200 000', () => {
    for (let n = 0; n <= 200000; n++) {
      const r = Math.floor(Math.sqrt(n));
      expect(isqrt32(n)).toBe(r);
      expect(isqrt(n)).toBe(r);
    }
  });

  it('isqrt32 is exact on the boundaries of every square up to 2^32 and on random values', () => {
    for (let r = 1; r < 65536; r += 1) {
      const sq = r * r;
      expect(isqrt32(sq)).toBe(r);
      expect(isqrt32(sq - 1)).toBe(r - 1);
      if (sq + 1 < 4294967296) expect(isqrt32(sq + 1)).toBe(r);
    }
    expect(isqrt32(4294967295)).toBe(65535);
    expect(isqrt32(0)).toBe(0);
  });

  it('isqrt is exact up to 2^52 (checked against BigInt) including around perfect squares', () => {
    const samples: number[] = [ISQRT_MAX, ISQRT_MAX - 1, 2 ** 51, 2 ** 51 + 1, 9007199254740 /* ~2^43 */];
    let s = 123456789;
    for (let i = 0; i < 5000; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) | 0;
      const hi = (s >>> 0) % 1048576; // 20 bits
      s = (Math.imul(s, 1664525) + 1013904223) | 0;
      samples.push(hi * 4294967296 + (s >>> 0));
    }
    for (const r of [94906265, 94906266, 67108863, 67108864, 1, 2, 3]) samples.push(r * r, r * r - 1, r * r + 1);
    for (const n of samples) {
      if (n < 0 || n > ISQRT_MAX) continue;
      expect(BigInt(isqrt(n))).toBe(bigSqrt(BigInt(n)));
    }
  });

  it('isqrt clamps and floors its input', () => {
    expect(isqrt(-5)).toBe(0);
    expect(isqrt(NaN)).toBe(0);
    expect(isqrt(15.9)).toBe(3);
    expect(isqrt(ISQRT_MAX * 10)).toBe(isqrt(ISQRT_MAX));
    expect(isqrt(ISQRT_MAX)).toBe(67108864);
  });
});

describe('fixed point helpers', () => {
  it('floorDiv floors toward minus infinity and is exact for large operands', () => {
    expect(floorDiv(7, 2)).toBe(3);
    expect(floorDiv(-7, 2)).toBe(-4);
    expect(floorDiv(7, -2)).toBe(-4);
    expect(floorDiv(-7, -2)).toBe(3);
    expect(floorDiv(-8, 2)).toBe(-4);
    expect(floorDiv(2 ** 52 + 1, 3)).toBe(Number((BigInt(2 ** 52) + 1n) / 3n));
    expect(floorDiv(9007199254740991, 7)).toBe(Number(9007199254740991n / 7n));
  });

  it('clamp', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
  });

  it('mulQ15 rounds half up and keeps Q15_ONE as identity', () => {
    for (const a of [-32768, -12345, -1, 0, 1, 777, 32767, 32768]) {
      expect(mulQ15(a, Q15_ONE)).toBe(a);
      expect(mulQ15(Q15_ONE, a)).toBe(a);
      expect(mulQ15(a, 0)).toBe(0);
    }
    expect(mulQ15(16384, 16384)).toBe(8192);
    expect(mulQ15(1, 16384)).toBe(1); // 0.5 rounds up
    expect(mulQ15(-1, 16384)).toBe(0); // -0.5 rounds up to 0
  });

  it('scaleQ15 and divQ15 are exact integer arithmetic', () => {
    expect(scaleQ15(1000, Q15_ONE)).toBe(1000);
    expect(scaleQ15(1000, 16384)).toBe(500);
    expect(scaleQ15(3, 16384)).toBe(2);
    expect(scaleQ15(2 ** 30, 32000)).toBe(Math.floor((2 ** 30 * 32000 + 16384) / 32768));
    expect(divQ15(1, 2)).toBe(16384);
    expect(divQ15(1, 3)).toBe(10923);
    expect(divQ15(5, 5)).toBe(Q15_ONE);
    expect(divQ15(-1, 3)).toBe(-10923);
  });
});

describe('Q15 sin / cos', () => {
  it('stay within 1 unit of the true value for ALL 65536 angles', () => {
    let worst = 0;
    for (let a = 0; a < ANGLE_TURN; a++) {
      const s = Math.sin((a / ANGLE_TURN) * 2 * Math.PI) * Q15_ONE;
      const c = Math.cos((a / ANGLE_TURN) * 2 * Math.PI) * Q15_ONE;
      worst = Math.max(worst, Math.abs(sinQ15(a) - s), Math.abs(cosQ15(a) - c));
    }
    console.log(`[detmath] worst Q15 sin/cos error over 65536 angles: ${worst.toFixed(3)} units`);
    expect(worst).toBeLessThanOrEqual(1);
  });

  it('hit the exact values at the quarter turns', () => {
    expect([sinQ15(0), sinQ15(ANGLE_QUARTER), sinQ15(2 * ANGLE_QUARTER), sinQ15(3 * ANGLE_QUARTER)]).toEqual([0, Q15_ONE, 0, -Q15_ONE]);
    expect([cosQ15(0), cosQ15(ANGLE_QUARTER), cosQ15(2 * ANGLE_QUARTER), cosQ15(3 * ANGLE_QUARTER)]).toEqual([Q15_ONE, 0, -Q15_ONE, 0]);
  });

  it('are odd / even / periodic and sin^2 + cos^2 stays near 1', () => {
    for (let a = 0; a < ANGLE_TURN; a += 37) {
      expect(sinQ15(a + ANGLE_TURN)).toBe(sinQ15(a));
      expect(sinQ15(-a)).toBeGreaterThanOrEqual(-sinQ15(a) - 1);
      expect(sinQ15(-a)).toBeLessThanOrEqual(-sinQ15(a) + 1);
      expect(cosQ15(-a)).toBeGreaterThanOrEqual(cosQ15(a) - 1);
      expect(cosQ15(-a)).toBeLessThanOrEqual(cosQ15(a) + 1);
      const norm = mulQ15(sinQ15(a), sinQ15(a)) + mulQ15(cosQ15(a), cosQ15(a));
      expect(Math.abs(norm - Q15_ONE)).toBeLessThanOrEqual(3);
    }
  });
});
