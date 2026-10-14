// Who can be chosen and why not (M06, the fair-start rule): >= 8 cells AND a connected land mass of >= K cells at the capital.
// Real data: the committed world, countries chosen from meta.json by their properties, never by name.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { countryEligibility, listCountries, startCellEligibility, type CountryChoice } from '../../src/app/eligibility';
import { landmassSizeAt } from '../../src/app/landmass';
import type { PreparedWorld } from '../../src/app/matchWorld';
import { SETUP_MIN_COUNTRY_CELLS, START_DISC_CELLS } from '../../src/sim/rules';
import { setLanguage, setStrictI18n, t, TABLES } from '../../src/ui/i18n';
import { loadPreparedWorld } from '../../tools/sim/realWorld';

let world: PreparedWorld;
beforeAll(async () => {
  world = await loadPreparedWorld();
});
afterEach(() => {
  setLanguage('sv');
  setStrictI18n(false);
});

describe('the committed world', () => {
  it('the cells inside the (absent) world mask are the cells meta.json counts, country by country', () => {
    const a = world.analyse('world');
    for (const c of world.countries) expect(a.cellsInMask.get(c.id) ?? 0, c.a3).toBe(c.cells);
  });
});

describe('country eligibility in the whole world', () => {
  let list: CountryChoice[];
  beforeAll(() => {
    list = listCountries(world, 'world');
  });

  it('a country is selectable exactly when it has >= 8 cells and a land mass of >= K cells at its capital (and is not excluded on purpose)', () => {
    const analysis = world.analyse('world');
    let ok = 0;
    for (const { country, eligibility } of list) {
      const landmass = country.capitalCell < 0 ? 0 : landmassSizeAt(analysis.land, country.capitalCell);
      const want = !country.excluded && country.cells >= SETUP_MIN_COUNTRY_CELLS && landmass >= START_DISC_CELLS;
      expect(eligibility.ok, `${country.a3} cells ${country.cells} land mass ${landmass}`).toBe(want);
      if (eligibility.ok) ok++;
    }
    expect(ok).toBeGreaterThan(120);
    expect(ok).toBeLessThan(list.length);
  });

  it('EVERY country with a land mass < K or < 8 cells is disabled, with a reason key that exists in both languages and the numbers of its placeholders', () => {
    setStrictI18n(true);
    let refused = 0;
    for (const { country, eligibility } of list) {
      const landmass = country.capitalCell < 0 ? 0 : landmassSizeAt(world.analyse('world').land, country.capitalCell);
      if (country.cells >= SETUP_MIN_COUNTRY_CELLS && landmass >= START_DISC_CELLS && !country.excluded) continue;
      refused++;
      expect(eligibility.ok, country.a3).toBe(false);
      expect(eligibility.reason, country.a3).not.toBeNull();
      const key = eligibility.key as keyof typeof TABLES.sv & string;
      expect(TABLES.sv[key], `${country.a3} sv`).toBeDefined();
      expect(TABLES.en[key], `${country.a3} en`).toBeDefined();
      for (const lang of ['sv', 'en'] as const) {
        setLanguage(lang);
        expect(t(eligibility.key as never, eligibility.params ?? {}).length, `${country.a3} ${lang}`).toBeGreaterThan(5);
      }
    }
    expect(refused).toBeGreaterThan(80);
  });

  it('too few cells say "{cells} of 8", a small land mass says "{cells} of 197" with the land mass size, in both languages', () => {
    const few = list.find((x) => x.eligibility.reason === 'tooFewCells' && !x.country.excluded) ?? (list.find((x) => x.eligibility.reason === 'tooFewCells') as CountryChoice);
    expect(few.eligibility.params).toEqual({ cells: few.country.cells, need: SETUP_MIN_COUNTRY_CELLS });
    const small = list.find((x) => x.eligibility.reason === 'smallLandmass') as CountryChoice;
    expect(small).toBeDefined();
    const p = small.eligibility.params as { cells: number; need: number };
    expect(p.need).toBe(START_DISC_CELLS);
    expect(p.cells).toBeLessThan(START_DISC_CELLS);
    expect(p.cells).toBe(small.eligibility.landmass);
    setLanguage('sv');
    expect(t('setup.reason.smallLandmass', p)).toBe(`för liten landmassa för en rättvis start: ${p.cells} av 197 celler`);
    setLanguage('en');
    expect(t('setup.reason.smallLandmass', p)).toBe(`land mass too small for a fair start: ${p.cells} of 197 cells`);
  });

  it('the on-purpose exclusions are marked: Antarctica, the unplayable list and the merged territories can never be chosen', () => {
    const ata = list.find((x) => x.country.continent === 'Antarctica') as CountryChoice;
    expect(ata.eligibility.ok).toBe(false);
    expect(ata.eligibility.reason).toBe('excluded');
    for (const x of list) if (x.country.excluded) expect(x.eligibility.ok, x.country.a3).toBe(false);
    expect(list.filter((x) => x.country.excluded).length).toBeGreaterThan(70);
  });

  it('a country whose capital is not on playable land is refused for that reason, not as "0 of 197"', () => {
    const noLand = list.filter((x) => x.eligibility.reason === 'noCapitalLand');
    expect(noLand.length).toBeGreaterThan(0);
    for (const x of noLand) expect(x.eligibility.params).toBeNull();
  });

  it('a small land mass is not a small country: countries with few own cells but a big land mass are selectable', () => {
    const small = list.filter((x) => x.country.cells < 400 && x.eligibility.ok);
    expect(small.length).toBeGreaterThanOrEqual(20);
    for (const x of small) expect(x.eligibility.landmass).toBeGreaterThanOrEqual(START_DISC_CELLS);
  });
});

describe('regions', () => {
  it('only countries whose capital is inside the cut-out can be chosen there; the others say why', () => {
    for (const region of ['europe', 'eastAsia', 'americas', 'africaMiddleEast'] as const) {
      const analysis = world.analyse(region);
      const list = listCountries(world, region);
      const ok = list.filter((x) => x.eligibility.ok);
      expect(ok.length, region).toBeGreaterThan(5);
      for (const x of ok) {
        expect((analysis.mask as Uint8Array)[x.country.capitalCell], `${region} ${x.country.a3}`).toBe(1);
        expect(x.eligibility.landmass).toBeGreaterThanOrEqual(START_DISC_CELLS);
      }
      const outside = list.filter((x) => x.eligibility.reason === 'outsideRegion');
      expect(outside.length, region).toBeGreaterThan(50);
      // the land mass is measured INSIDE the mask: nothing is bigger than the world's land mass of the same capital
      const whole = listCountries(world, 'world');
      for (let i = 0; i < list.length; i++) {
        expect((list[i] as CountryChoice).eligibility.landmass).toBeLessThanOrEqual((whole[i] as CountryChoice).eligibility.landmass);
      }
    }
  });

  it('listCountries refuses an unknown region', () => {
    expect(() => listCountries(world, 'atlantis')).toThrow(RangeError);
  });
});

describe('a custom start cell', () => {
  const cellAt = (lat: number, lon: number): number => Math.floor(((90 - lat) / 180) * 512) * 1024 + Math.floor(((lon + 180) / 360) * 1024);

  it('accepts land on a big land mass and says which land mass it is', () => {
    const a = world.analyse('world');
    const e = startCellEligibility(world, a, cellAt(59.3, 18.1));
    expect(e.ok).toBe(true);
    expect(e.reason).toBeNull();
    expect(e.landmass).toBeGreaterThanOrEqual(START_DISC_CELLS);
  });

  it('refuses sea, Peak and Ice with the terrain reason', () => {
    const a = world.analyse('world');
    const sea = startCellEligibility(world, a, cellAt(0, -30));
    expect([sea.ok, sea.reason, sea.key]).toEqual([false, 'terrain', 'setup.start.terrain']);
    const ice = startCellEligibility(world, a, cellAt(-80, 0));
    expect(ice.reason).toBe('terrain');
    for (const bad of [-1, 1024 * 512, 3.5, Number.NaN]) expect(startCellEligibility(world, a, bad).reason, String(bad)).toBe('terrain');
  });

  it('refuses land on a too small land mass with the "{cells} of 197" parameters', () => {
    const a = world.analyse('world');
    const small = listCountries(world, 'world').find((x) => x.eligibility.reason === 'smallLandmass' && x.eligibility.landmass > 0) as CountryChoice;
    const e = startCellEligibility(world, a, small.country.capitalCell);
    expect(e.ok).toBe(false);
    expect(e.reason).toBe('smallLandmass');
    expect(e.key).toBe('setup.reason.smallLandmass');
    expect(e.params).toEqual({ cells: small.eligibility.landmass, need: START_DISC_CELLS });
  });

  it('refuses land outside the chosen region with its own reason, and sea in the region with the terrain reason', () => {
    const eu = world.analyse('europe');
    const outside = startCellEligibility(world, eu, cellAt(35.7, 139.7));
    expect([outside.ok, outside.reason, outside.key]).toEqual([false, 'outsideRegion', 'setup.reason.outsideRegion']);
    expect(startCellEligibility(world, eu, cellAt(59.3, 18.1)).ok).toBe(true);
    expect(startCellEligibility(world, eu, cellAt(45, -20)).reason).toBe('terrain');
  });
});

describe('every refusal text', () => {
  it('is a complete sentence fragment in both languages for every key the module can return', () => {
    setStrictI18n(true);
    for (const key of ['setup.reason.tooFewCells', 'setup.reason.smallLandmass', 'setup.reason.noCapitalLand', 'setup.reason.outsideRegion', 'setup.reason.excluded', 'setup.start.terrain'] as const) {
      for (const lang of ['sv', 'en'] as const) {
        setLanguage(lang);
        expect(t(key, { cells: 12, need: 197 })).toMatch(/\S/);
      }
    }
  });

  it('countryEligibility on the analysis object gives the same answer as listCountries', () => {
    const a = world.analyse('world');
    for (const x of listCountries(world, 'world')) expect(countryEligibility(a, x.country)).toEqual(x.eligibility);
  });
});
