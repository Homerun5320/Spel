// A custom nation may not carry the name of a real country (M06fix 4d): createMatch refuses it with a reason, the draft says the same, the
// comparison ignores case, accents and spacing and looks at both languages, and every AI nation of a custom match keeps a name of its own.
import { beforeAll, describe, expect, it } from 'vitest';
import { countryName, countryWithName } from '../../src/app/countrySearch';
import { createMatch, matchSetupConfig, type PlayerChoice } from '../../src/app/matchSetup';
import type { PreparedWorld } from '../../src/app/matchWorld';
import { checkDraft, defaultDraft } from '../../src/app/setupModel';
import { TABLES, placeholdersOf, setLanguage, t } from '../../src/ui/i18n';
import { loadPreparedWorld } from '../../tools/sim/realWorld';
import { cellAt } from '../helpers/matchConfigs';

let world: PreparedWorld;
beforeAll(async () => {
  world = await loadPreparedWorld();
});

const custom = (name: string): PlayerChoice => ({ kind: 'custom', name, color: 0x336699, flagSeed: 3, cell: cellAt(50, 10) });

describe('countryWithName', () => {
  it('finds a country by its English or Swedish name, whatever the case, accents and spacing', () => {
    const swe = world.countries.find((c) => c.a3 === 'SWE');
    expect(countryWithName(world.countries, 'Sweden')).toBe(swe);
    expect(countryWithName(world.countries, 'sverige')).toBe(swe);
    expect(countryWithName(world.countries, '  SVERIGE  ')).toBe(swe);
    expect(countryWithName(world.countries, 'Nyland')).toBeNull();
    expect(countryWithName(world.countries, '')).toBeNull();
    expect(countryWithName(world.countries, '  ')).toBeNull();
  });

  it('every country, in both its names, is found as itself', () => {
    for (const c of world.countries) {
      const a = countryWithName(world.countries, c.nameEn);
      const b = countryWithName(world.countries, c.nameSv);
      expect(a, c.a3).not.toBeNull();
      expect(b, c.a3).not.toBeNull();
      // two countries may share a normalised name only if they are the same name; the first in table order wins and is itself a country
      expect(world.countries.includes(a!), c.a3).toBe(true);
    }
  });
});

describe('createMatch refuses a custom nation named like a real country', () => {
  it('for every country of the world, in English and in Swedish: code nameTaken, the key and the name in the parameters, nothing built', () => {
    for (const c of world.countries) {
      for (const name of [c.nameEn, c.nameSv]) {
        if (name.trim().length > 24) continue; // too long is refused as an invalid name before (a different, older rule)
        const r = createMatch(world, matchSetupConfig(custom(name), { seed: 1, aiNations: 0, tribes: false }));
        expect(r.ok, `${c.a3} ${name}`).toBe(false);
        if (!r.ok) {
          expect(r.error.code, `${c.a3} ${name}`).toBe('nameTaken');
          expect(r.error.key).toBe('setup.error.nameTaken');
          expect(r.error.params).toEqual({ name: name.trim() });
        }
      }
    }
  });

  it('also in the neutral mode, and with a different case and padding', () => {
    for (const name of ['sweden', '  Sverige ', 'SWEDEN']) {
      const r = createMatch(world, matchSetupConfig(custom(name), { seed: 4, aiNations: 2, tribes: false, neutral: true }));
      expect(r.ok, name).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('nameTaken');
    }
  });

  it('an unused name is accepted, and no AI nation of the match carries the custom name or another AI nation name', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const r = createMatch(world, matchSetupConfig(custom('Zorland'), { seed, aiNations: 12, tribes: false }));
      expect(r.ok, `seed ${seed}`).toBe(true);
      if (!r.ok) continue;
      const names: string[] = [];
      for (const s of r.match.seats) {
        if (s.identity.kind === 'country') names.push(s.identity.nameEn);
        else if (s.identity.kind === 'custom' || s.identity.kind === 'invented') names.push(s.identity.name);
      }
      expect(new Set(names).size, `seed ${seed}`).toBe(names.length);
      expect(names.filter((n) => n === 'Zorland').length).toBe(1);
    }
  });
});

describe('the draft says the same before the Start button', () => {
  it('a draft named like a country cannot start and says why, with the name', () => {
    const d = { ...defaultDraft(1, 'Nyland'), tab: 'custom' as const, name: 'Sweden', cell: cellAt(50, 10) };
    const c = checkDraft(world, d);
    expect(c.ok).toBe(false);
    expect(c.key).toBe('setup.error.nameTaken');
    expect(c.params).toEqual({ name: 'Sweden' });
    expect(checkDraft(world, { ...d, name: 'Zorland' }).ok).toBe(true);
    // the name is cleaned the way the screen does before it is compared
    expect(checkDraft(world, { ...d, name: '  sverige ' }).key).toBe('setup.error.nameTaken');
  });
});

describe('the reason is written in both languages', () => {
  it('has the same placeholder in both tables and fills it', () => {
    expect(placeholdersOf(TABLES.sv['setup.error.nameTaken'] as string)).toEqual(['name']);
    expect(placeholdersOf(TABLES.en['setup.error.nameTaken'] as string)).toEqual(['name']);
    setLanguage('sv');
    expect(t('setup.error.nameTaken', { name: 'Sweden' })).toBe('Namnet "Sweden" tillhör ett riktigt land. Välj ett eget namn.');
    setLanguage('en');
    expect(t('setup.error.nameTaken', { name: 'Sweden' })).toBe('The name "Sweden" belongs to a real country. Choose a name of your own.');
    setLanguage('sv');
    expect(countryName(world.countries[0]!, 'en').length).toBeGreaterThan(0);
  });
});
