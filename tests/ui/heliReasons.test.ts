// M12a-1: the refusal texts of the helicopter rules. The six ProduceHeli codes (45 to 50) and the eight landing-zone reasons (65 to 72) go through
// rejectKey -> structureRefusalKey -> airRefusalKey to their own text keys, each with a Swedish and an English text.
import { afterEach, describe, expect, it } from 'vitest';
import { airRefusalKey } from '../../src/ui/buildReasons';
import { rejectKey } from '../../src/ui/hudLogic';
import { getLanguage, setLanguage, t, TABLES } from '../../src/ui/i18n';
import {
  LZ_ENEMY_CITY_NEAR,
  LZ_NO_ROUTE,
  LZ_OUT_OF_FUEL,
  LZ_PEAK,
  LZ_STEEP,
  LZ_TERRAIN_CLASS,
  LZ_TOO_HIGH,
  LZ_WATER,
  REJECT_HELI_FACTORY_BUILDING,
  REJECT_HELI_FLEET_CAP,
  REJECT_HELI_NO_FACTORY,
  REJECT_HELI_NO_GOLD,
  REJECT_HELI_NOT_OWNER,
  REJECT_HELI_QUEUE_BUSY,
} from '../../src/sim/public';

const PRODUCE = [REJECT_HELI_NO_FACTORY, REJECT_HELI_NOT_OWNER, REJECT_HELI_FACTORY_BUILDING, REJECT_HELI_QUEUE_BUSY, REJECT_HELI_FLEET_CAP, REJECT_HELI_NO_GOLD];
const LZ = [LZ_WATER, LZ_PEAK, LZ_TERRAIN_CLASS, LZ_STEEP, LZ_ENEMY_CITY_NEAR, LZ_TOO_HIGH, LZ_OUT_OF_FUEL, LZ_NO_ROUTE];

const original = getLanguage();
afterEach(() => setLanguage(original));

describe('helicopter refusal texts', () => {
  it('every ProduceHeli code (45..50) and every landing-zone reason (65..72) has its own key, never the generic "other"', () => {
    expect([...PRODUCE].sort((a, b) => a - b)).toEqual([45, 46, 47, 48, 49, 50]);
    expect(LZ).toEqual([65, 66, 67, 68, 69, 70, 71, 72]);
    const keys = new Set<string>();
    for (const code of [...PRODUCE, ...LZ]) {
      const k = rejectKey(code);
      expect(k, `code ${code}`).not.toBe('reject.other');
      expect(airRefusalKey(code)).toBe(k);
      keys.add(k);
    }
    expect(keys.size).toBe(14); // one text each
  });

  it('every one of the 14 texts exists in Swedish and in English, is a real sentence and differs between the languages', () => {
    for (const code of [...PRODUCE, ...LZ]) {
      const key = rejectKey(code);
      setLanguage('sv');
      const sv = t(key, { code });
      setLanguage('en');
      const en = t(key, { code });
      expect(sv.length, key).toBeGreaterThan(8);
      expect(en.length, key).toBeGreaterThan(8);
      expect(sv, key).not.toBe(en);
      expect(sv).not.toMatch(/Avvisat/);
      expect(en).not.toMatch(/Refused \(code/);
      expect(Object.keys(TABLES.sv)).toContain(key);
      expect(Object.keys(TABLES.en)).toContain(key);
    }
  });

  it('the neighbours still behave: a build refusal, a district refusal and an unknown code keep their keys', () => {
    expect(rejectKey(32)).toBe('toast.build.gold');
    expect(rejectKey(44)).toBe('toast.district.cityBuilding');
    expect(rejectKey(55)).toBe('reject.other'); // 51 to 54 are the LaunchHeli / RecallHeli reasons since M12a-2
    expect(rejectKey(64)).toBe('reject.other');
    expect(rejectKey(73)).toBe('reject.other');
  });
});
