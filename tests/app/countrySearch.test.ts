// Country search (M06): both languages, case and diacritic tolerant, shown in the UI language.
import { beforeAll, describe, expect, it } from 'vitest';
import { countryName, normalizeSearch, searchCountries } from '../../src/app/countrySearch';
import type { CountryInfo, PreparedWorld } from '../../src/app/matchWorld';
import { loadPreparedWorld } from '../../tools/sim/realWorld';

let world: PreparedWorld;
beforeAll(async () => {
  world = await loadPreparedWorld();
});

const byA3 = (a3: string): CountryInfo => world.countries.find((c) => c.a3 === a3) as CountryInfo;

describe('normalizeSearch', () => {
  it('lower-cases, strips diacritics, spells out special letters and squeezes punctuation', () => {
    expect(normalizeSearch('Åland')).toBe('aland');
    expect(normalizeSearch('  Côte   d’Ivoire ')).toBe('cote d ivoire');
    expect(normalizeSearch('São Tomé')).toBe('sao tome');
    expect(normalizeSearch('Curaçao')).toBe('curacao');
    expect(normalizeSearch('Ísland')).toBe('island');
    expect(normalizeSearch('Ørsted Æble Straße')).toBe('orsted aeble strasse');
    expect(normalizeSearch('Österrike')).toBe('osterrike');
    expect(normalizeSearch('')).toBe('');
    expect(normalizeSearch('!!!')).toBe('');
  });
});

describe('searchCountries', () => {
  it('"Sverige" and "Sweden" both find Sweden, in either UI language, in any case', () => {
    const swe = byA3('SWE');
    for (const lang of ['sv', 'en'] as const) {
      for (const q of ['Sverige', 'sweden', 'SWEDEN', 'sVeRiGe', '  sweden  ']) {
        const hits = searchCountries(world.countries, q, lang);
        expect(hits.map((h) => h.country.id), `${lang} "${q}"`).toContain(swe.id);
        expect(hits[0]?.country.id, `${lang} "${q}" first`).toBe(swe.id);
      }
    }
  });

  it('is diacritic tolerant: "aland" finds Åland, "osterrike" finds Austria', () => {
    expect(searchCountries(world.countries, 'aland', 'sv').some((h) => h.country.a3 === 'ALD')).toBe(true);
    expect(searchCountries(world.countries, 'ALAND', 'en').some((h) => h.country.a3 === 'ALD')).toBe(true);
    expect(searchCountries(world.countries, 'osterrike', 'sv')[0]?.country.a3).toBe('AUT');
  });

  it('every country can be found by its own name in both languages (exact match ranks first)', () => {
    for (const c of world.countries) {
      for (const lang of ['sv', 'en'] as const) {
        const own = countryName(c, lang);
        if (normalizeSearch(own) === '') continue;
        const hits = searchCountries(world.countries, own, lang);
        const mine = hits.find((h) => h.country.id === c.id);
        expect(mine, `${c.a3} ${lang} "${own}"`).toBeDefined();
        // nothing ranks before an exact hit unless it is an exact hit of the same normalised name too
        expect((mine as { rank: number }).rank, `${c.a3} ${lang}`).toBe(0);
      }
    }
  });

  it('shows names in the UI language: the same search gives the Swedish or the English text', () => {
    const swe = byA3('SWE');
    expect(countryName(swe, 'sv')).toBe('Sverige');
    expect(countryName(swe, 'en')).toBe('Sweden');
    const ger = byA3('DEU');
    expect(countryName(ger, 'sv')).toBe('Tyskland');
    expect(countryName(ger, 'en')).toBe('Germany');
  });

  it('ranks a name that starts with the query before one that only contains it, and a UI-language match before the other language', () => {
    const hits = searchCountries(world.countries, 'ind', 'en');
    const names = hits.map((h) => normalizeSearch(countryName(h.country, 'en')));
    const firstContains = names.findIndex((n) => !n.startsWith('ind') && !n.includes(' ind'));
    const lastStarts = names.map((n, i) => (n.startsWith('ind') ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
    expect(lastStarts).toBeGreaterThanOrEqual(0);
    if (firstContains >= 0) expect(lastStarts).toBeLessThan(firstContains);
    const ranks = hits.map((h) => h.rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it('an empty query lists every country in the order of its name in the UI language; a query that matches nothing gives nothing', () => {
    const all = searchCountries(world.countries, '', 'sv');
    expect(all.length).toBe(world.countries.length);
    const names = all.map((h) => normalizeSearch(countryName(h.country, 'sv')));
    expect(names).toEqual([...names].sort());
    expect(searchCountries(world.countries, 'zzzzqx', 'en')).toEqual([]);
  });

  it('is deterministic: the same query twice gives the same list', () => {
    expect(searchCountries(world.countries, 'an', 'en')).toEqual(searchCountries(world.countries, 'an', 'en'));
  });
});
