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
    .filter(([k, v]) => k.startsWith('REJECT_') && !k.startsWith('REJECT_DIPLO_') && !k.startsWith('REJECT_TECH_') && k !== 'REJECT_BUILD_MAX_COUNT' && k !== 'REJECT_BUILD_NO_NEIGHBOUR' && typeof v === 'number') // M18e-1: the two build refusals 118 and 119 sit above the landing-zone range too, after the technology block (they are pinned by tests/sim/m18e1.test.ts); M18d-1: the technology block (110 to 117) sits above the landing-zone range too, like the diplomacy block; M18c-1: the diplomacy block (80 to 93) sits ABOVE the landing-zone range on purpose (tests/sim/diplomacy.test.ts pins it); the 0 to 54 block stays below
    .map(([, v]) => v as number);

  it('the two ranges are disjoint: no LZ reason equals any REJECT_* code, and every LZ reason is above the highest REJECT code', () => {
    expect(rejects.length).toBeGreaterThan(40);
    for (const code of LZ) expect(rejects, `LZ code ${code}`).not.toContain(code);
    expect(Math.min(...LZ)).toBeGreaterThan(Math.max(...rejects));
    expect(LZ).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map((n) => LZ_REASON_BASE + n));
    expect(LZ_OK).toBe(0);
    expect(new Set(LZ).size).toBe(8);
  });

  it('every LZ code has a name, and rejectKey maps each one to its OWN text (M12a-1: toast.lz.*), never to the text of a REJECT code', () => {
    const keys = new Set<string>();
    for (const code of LZ) {
      expect(typeof (LZ_REASON_NAMES as Readonly<Record<number, string>>)[code]).toBe('string');
      expect(rejectKey(code), `LZ code ${code}`).toMatch(/^toast\.lz\./); // Fix-3A2 had the generic 'reject.other' here until the texts existed
      keys.add(rejectKey(code));
    }
    expect(keys.size).toBe(8);
    expect(rejectKey(intents.REJECT_TERRAIN)).toBe('reject.terrain'); // the old collision: NO_ROUTE (8) read as REJECT_TERRAIN (8)
  });
});
