import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FixedStepAccumulator } from '../../src/host/accumulator';
import { MAX_TICKS_PER_FRAME, TICK_MS } from '../../src/sim/rules';

describe('FixedStepAccumulator', () => {
  it('runs one tick per 100 ms at 1x and keeps the remainder', () => {
    const a = new FixedStepAccumulator();
    expect(a.speed).toBe(1);
    expect(a.advance(100)).toBe(1);
    expect(a.advance(99)).toBe(0);
    expect(a.advance(1)).toBe(1);
    // 16 ms frames: 7 frames = 112 ms = one tick and 12 ms left
    let ticks = 0;
    for (let i = 0; i < 7; i++) ticks += a.advance(16);
    expect(ticks).toBe(1);
    expect(a.pendingMs).toBeCloseTo(12, 9);
  });

  it('2x and 4x run twice and four times as fast; pause runs nothing and throws the time away', () => {
    const a = new FixedStepAccumulator();
    a.setSpeed(2);
    expect(a.advance(100)).toBe(2);
    expect(a.advance(25)).toBe(0);
    expect(a.advance(25)).toBe(1);
    a.setSpeed(4);
    expect(a.advance(100)).toBe(4);
    expect(a.advance(25)).toBe(1);
    a.setSpeed(0);
    expect(a.advance(100000)).toBe(0);
    a.setSpeed(1);
    expect(a.advance(50)).toBe(0); // no burst after the pause
    expect(a.advance(50)).toBe(1);
  });

  it('never runs more than 8 ticks per frame and drops the backlog', () => {
    expect(MAX_TICKS_PER_FRAME).toBe(8);
    const a = new FixedStepAccumulator();
    expect(a.advance(10_000)).toBe(8);
    expect(a.advance(0)).toBe(0);
    expect(a.advance(100)).toBe(1); // the 10 s backlog is gone
    a.setSpeed(4);
    expect(a.advance(5000)).toBe(8);
    expect(a.pendingMs).toBeLessThan(TICK_MS);
    a.setSpeed(1);
    expect(a.advance(800)).toBe(8); // exactly at the cap
    expect(a.advance(700)).toBe(7);
  });

  it('ignores negative, zero, NaN and infinite frame times', () => {
    const a = new FixedStepAccumulator();
    for (const dt of [-100, 0, NaN, Infinity, -Infinity]) expect(a.advance(dt)).toBe(0);
    expect(a.pendingMs).toBe(0);
  });

  it('accepts only the speeds 0, 1, 2 and 4', () => {
    const a = new FixedStepAccumulator();
    for (const bad of [3, -1, 8, 1.5, NaN, '2', null, undefined]) {
      expect(a.setSpeed(bad as never)).toBe(false);
      expect(a.speed).toBe(1);
    }
    for (const ok of [0, 2, 4, 1] as const) {
      expect(a.setSpeed(ok)).toBe(true);
      expect(a.speed).toBe(ok);
    }
  });

  it('over any sequence of whole-ms frames below the cap the ticks equal floor(total / 100) (fast-check)', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 400 }), { maxLength: 200 }), (frames) => {
        const a = new FixedStepAccumulator();
        let ticks = 0;
        let total = 0;
        for (const dt of frames) {
          ticks += a.advance(dt);
          total += dt;
        }
        expect(ticks).toBe(Math.floor(total / 100));
      }),
      { numRuns: 500 },
    );
  });

  it('reset clears the remainder', () => {
    const a = new FixedStepAccumulator();
    a.advance(60);
    a.reset();
    expect(a.advance(60)).toBe(0);
  });
});
