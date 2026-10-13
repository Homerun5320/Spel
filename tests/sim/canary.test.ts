import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CANARY_VALUES, canaryHash } from '../../src/sim/canary';
import { withHostileGlobals } from './helpers/hostile';

describe('Float64 canary', () => {
  it('loops over 100 000 values and is a pure function of the count', () => {
    expect(CANARY_VALUES).toBe(100000);
    expect(canaryHash()).toBe(canaryHash());
    expect(canaryHash(99999)).not.toBe(canaryHash(100000));
    expect(canaryHash(0)).not.toBe(canaryHash(1));
  });

  it('uses nothing but + - * / and sqrt: no transcendental function, no clock, no random (hostile environment)', () => {
    expect(withHostileGlobals(() => canaryHash())).toBe(canaryHash());
    const src = fs.readFileSync('src/sim/canary.ts', 'utf8').replace(/\/\/[^\n]*/g, '');
    const members = [...src.matchAll(/\bMath\.(\w+)/g)].map((m) => m[1]);
    expect(new Set(members)).toEqual(new Set(['sqrt']));
  });
});
