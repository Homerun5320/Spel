import { afterEach, describe, expect, it } from 'vitest';
import { advanceFx, fxNow, setFxTime } from '../../src/render/clock';

describe('fx clock', () => {
  afterEach(() => setFxTime(0));

  it('starts frozen and only moves through advanceFx / setFxTime', () => {
    setFxTime(0);
    expect(fxNow()).toBe(0);
    expect(fxNow()).toBe(0);
    expect(advanceFx(0.5)).toBe(0.5);
    expect(fxNow()).toBe(0.5);
    setFxTime(42);
    expect(fxNow()).toBe(42);
  });

  it('ignores negative, zero and non-finite steps', () => {
    setFxTime(10);
    advanceFx(-1);
    advanceFx(0);
    advanceFx(Number.NaN);
    advanceFx(Number.POSITIVE_INFINITY);
    setFxTime(Number.NaN);
    expect(fxNow()).toBe(10);
  });
});
