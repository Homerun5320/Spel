// Fix-4A1: the two new helicopter refusals (full helicopter table, full beachhead table) have their own texts in both languages.
import { afterEach, describe, expect, it } from 'vitest';
import { rejectKey } from '../../src/ui/hudLogic';
import { getLanguage, setLanguage, t } from '../../src/ui/i18n';
import { REJECT_HELI_BEACHHEAD_FULL, REJECT_HELI_TABLE_FULL } from '../../src/sim/public';

const original = getLanguage();
afterEach(() => setLanguage(original));

describe('Fix-4A1 refusal texts', () => {
  it('codes 57 and 58 have their own keys and a real sentence in sv and en', () => {
    expect([REJECT_HELI_TABLE_FULL, REJECT_HELI_BEACHHEAD_FULL]).toEqual([57, 58]);
    const keys = new Set<string>();
    for (const code of [REJECT_HELI_TABLE_FULL, REJECT_HELI_BEACHHEAD_FULL]) {
      const k = rejectKey(code);
      expect(k).not.toBe('reject.other');
      expect(k).not.toBe('toast.heli.fleetCap');
      keys.add(k);
      setLanguage('sv');
      const sv = t(k, { code });
      setLanguage('en');
      const en = t(k, { code });
      expect(sv.length).toBeGreaterThan(15);
      expect(en.length).toBeGreaterThan(15);
      expect(sv).not.toBe(en);
    }
    expect(keys.size).toBe(2);
  });
});
