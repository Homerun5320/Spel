// Fix-3A2: the landing-zone reason codes live in their own range (LZ_REASON_BASE + n), so one integer can never mean both an LZ reason and an
// intent refusal (REJECT_*). rejectKey() therefore never turns an LZ code into the text of a REJECT code.
import { describe, expect, it } from 'vitest';
import * as intents from '../../src/sim/intents';
import { LZ_ENEMY_CITY_NEAR, LZ_NO_ROUTE, LZ_OK, LZ_OUT_OF_FUEL, LZ_PEAK, LZ_REASON_NAMES, LZ_STEEP, LZ_TERRAIN_CLASS, LZ_TOO_HIGH, LZ_WATER } from '../../src/sim/nav/lz';
import { LZ_REASON_BASE } from '../../src/sim/rules';
import { rejectKey } from '../../src/ui/hudLogic';

const LZ = [LZ_WATER, LZ_PEAK, LZ_TERRAIN_CLASS, LZ_STEEP, LZ_ENEMY_CITY_NEAR, LZ_TOO_HIGH, LZ_OUT_OF_FUEL, LZ_NO_ROUTE];

describe('LZ reason codes versus REJECT codes', () => {
  const rejects = Object.entries(intents)
    .filter(([k, v]) => k.startsWith('REJECT_') && typeof v === 'number')
    .map(([, v]) => v as number);

  it('the two ranges are disjoint: no LZ reason equals any REJECT_* code, and every LZ reason is above the highest REJECT code', () => {
    expect(rejects.length).toBeGreaterThan(40);
    for (const code of LZ) expect(rejects, `LZ code ${code}`).not.toContain(code);
    expect(Math.min(...LZ)).toBeGreaterThan(Math.max(...rejects));
    expect(LZ).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map((n) => LZ_REASON_BASE + n));
    expect(LZ_OK).toBe(0);
    expect(new Set(LZ).size).toBe(8);
  });

  it('every LZ code has a name, and rejectKey never maps one to the text of a REJECT code (it is the generic "other")', () => {
    for (const code of LZ) {
      expect(typeof (LZ_REASON_NAMES as Readonly<Record<number, string>>)[code]).toBe('string');
      expect(rejectKey(code)).toBe('reject.other');
    }
    expect(rejectKey(intents.REJECT_TERRAIN)).toBe('reject.terrain'); // the old collision: NO_ROUTE (8) read as REJECT_TERRAIN (8)
  });
});
