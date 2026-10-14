// The exact edges of the setup rules, on hand-made worlds (tests/helpers/synthWorld.ts): a land mass of exactly K cells and one cell short,
// the capital spacing at exactly 17 cells and one less (also across the antimeridian), and what prepareWorld does with the overrides.
import { describe, expect, it } from 'vitest';
import { countryEligibility, listCountries, startCellEligibility } from '../../src/app/eligibility';
import { createMatch, matchSetupConfig, type BuiltMatch, type MatchSetupConfig } from '../../src/app/matchSetup';
import { prepareWorld, type WorldData } from '../../src/app/matchWorld';
import { SETUP_CAPITAL_MIN_DISTANCE_CELLS, SETUP_MIN_COUNTRY_CELLS, START_DISC_CELLS } from '../../src/sim/rules';
import { CLASS_MOUNTAIN, CLASS_PEAK, CLASS_PLAINS } from '../../src/sim/terrain';
import { synthWorld } from '../helpers/synthWorld';

function build(data: WorldData, config: MatchSetupConfig): BuiltMatch {
  const r = createMatch(prepareWorld(data), config);
  if (!r.ok) throw new Error(`createMatch refused: ${r.error.code} ${r.error.key} ${JSON.stringify(r.error.params)}`);
  return r.match;
}

/** Two islands: KKK is a 14 x 14 block plus one cell (exactly K = 197 cells), LLL a 14 x 14 block (196 cells, one short). */
function islands(): WorldData {
  return synthWorld({
    width: 100,
    height: 60,
    rects: [
      { id: 1, x0: 10, x1: 23, y0: 10, y1: 23 },
      { id: 2, x0: 50, x1: 63, y0: 10, y1: 23 },
    ],
    cells: [[24, 10, 1, CLASS_PLAINS]],
    countries: [
      { id: 1, a3: 'KKK', capital: [17, 17] },
      { id: 2, a3: 'LLL', capital: [57, 17] },
    ],
  });
}

describe('a land mass of exactly K cells', () => {
  it('the test worlds really hold K and K - 1 cells', () => {
    expect(START_DISC_CELLS).toBe(197);
    const w = prepareWorld(islands());
    const a = w.analyse('world');
    expect(w.byId.get(1)!.cells).toBe(START_DISC_CELLS);
    expect(w.byId.get(2)!.cells).toBe(START_DISC_CELLS - 1);
    expect(Math.max(...a.land.size)).toBe(START_DISC_CELLS);
  });

  it('a country with a land mass of exactly K is selectable and a Spawn claims K cells; one with K - 1 is refused with {cells: 196, need: 197}', () => {
    const w = prepareWorld(islands());
    const a = w.analyse('world');
    const ok = countryEligibility(a, w.byId.get(1)!);
    expect(ok).toMatchObject({ ok: true, landmass: START_DISC_CELLS });
    const short = countryEligibility(a, w.byId.get(2)!);
    expect(short).toMatchObject({ ok: false, reason: 'smallLandmass', params: { cells: START_DISC_CELLS - 1, need: START_DISC_CELLS } });
    expect(listCountries(w, 'world').map((c) => c.eligibility.ok)).toEqual([true, false]);

    const m = build(islands(), matchSetupConfig({ kind: 'real', countryId: 1 }, { aiNations: 0, tribes: false }));
    expect(m.state.agg.area[1]).toBe(START_DISC_CELLS);
    const r = createMatch(w, matchSetupConfig({ kind: 'real', countryId: 2 }, { aiNations: 0, tribes: false }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatchObject({ code: 'notSelectable', key: 'setup.reason.smallLandmass', params: { cells: START_DISC_CELLS - 1, need: START_DISC_CELLS } });
  });

  it('a custom start cell on a land mass of exactly K is accepted (and claims K cells); on K - 1 it is refused with the numbers', () => {
    const w = prepareWorld(islands());
    const a = w.analyse('world');
    const inK = 14 * 100 + 15;
    const inShort = 14 * 100 + 55;
    expect(startCellEligibility(w, a, inK)).toMatchObject({ ok: true, landmass: START_DISC_CELLS });
    expect(startCellEligibility(w, a, inShort)).toMatchObject({ ok: false, reason: 'smallLandmass', params: { cells: START_DISC_CELLS - 1, need: START_DISC_CELLS } });

    const custom = (cell: number) => matchSetupConfig({ kind: 'custom', name: 'Zorland', color: 0x336699, flagSeed: 3, cell }, { aiNations: 0, tribes: false });
    expect(build(islands(), custom(inK)).state.agg.area[1]).toBe(START_DISC_CELLS);
    const r = createMatch(w, custom(inShort));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatchObject({ code: 'startCell', key: 'setup.reason.smallLandmass', params: { cells: START_DISC_CELLS - 1, need: START_DISC_CELLS } });
  });

  it('a country with exactly SETUP_MIN_COUNTRY_CELLS cells passes the cell count (and one with one less does not)', () => {
    const data = synthWorld({
      width: 100,
      height: 60,
      rects: [
        { id: 1, x0: 10, x1: 17, y0: 10, y1: 10 }, // 8 cells in a row: the cell count is fine, the land mass is not
        { id: 2, x0: 30, x1: 36, y0: 10, y1: 10 }, // 7 cells
        { id: 3, x0: 40, x1: 80, y0: 20, y1: 50 }, // the land mass of K cells
      ],
      countries: [
        { id: 1, a3: 'AAA', capital: [10, 10] },
        { id: 2, a3: 'BBB', capital: [30, 10] },
        { id: 3, a3: 'CCC', capital: [60, 30] },
      ],
    });
    const w = prepareWorld(data);
    const a = w.analyse('world');
    expect(countryEligibility(a, w.byId.get(1)!).reason).toBe('smallLandmass');
    expect(countryEligibility(a, w.byId.get(2)!).reason).toBe('tooFewCells');
    expect(SETUP_MIN_COUNTRY_CELLS).toBe(8);
  });
});

/** One land mass shared by two countries; the second capital sits `gap` cells east of the first. */
function twoCountries(gap: number): WorldData {
  return synthWorld({
    width: 200,
    height: 100,
    rects: [
      { id: 1, x0: 10, x1: 39, y0: 30, y1: 60 },
      { id: 2, x0: 40, x1: 69, y0: 30, y1: 60 },
    ],
    countries: [
      { id: 1, a3: 'AAA', capital: [30, 45] },
      { id: 2, a3: 'BBB', capital: [30 + gap, 45] },
    ],
  });
}

describe('the capital spacing', () => {
  const aiConfig = matchSetupConfig({ kind: 'real', countryId: 1 }, { aiNations: 1, tribes: false });

  it('two capitals exactly SETUP_CAPITAL_MIN_DISTANCE_CELLS apart are allowed, one cell closer is refused', () => {
    expect(SETUP_CAPITAL_MIN_DISTANCE_CELLS).toBe(17);
    const ok = build(twoCountries(SETUP_CAPITAL_MIN_DISTANCE_CELLS), aiConfig);
    expect(ok.seats.filter((s) => s.kind === 'ai').map((s) => s.countryId)).toEqual([2]);
    expect(ok.state.agg.area[2]).toBe(START_DISC_CELLS);
    const r = createMatch(prepareWorld(twoCountries(SETUP_CAPITAL_MIN_DISTANCE_CELLS - 1)), aiConfig);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatchObject({ code: 'notEnoughCountries', params: { available: 0, wanted: 1 } });
  });

  it('the distance is Euclidean over both axes (a diagonal of 12 and 12 is 16.97 cells: refused; 12 and 13 is 17.69: allowed)', () => {
    const diag = (dx: number, dy: number): WorldData =>
      synthWorld({
        width: 200,
        height: 100,
        rects: [
          { id: 1, x0: 10, x1: 39, y0: 20, y1: 70 },
          { id: 2, x0: 40, x1: 69, y0: 20, y1: 70 },
        ],
        countries: [
          { id: 1, a3: 'AAA', capital: [30, 40] },
          { id: 2, a3: 'BBB', capital: [30 + dx, 40 + dy] },
        ],
      });
    expect(createMatch(prepareWorld(diag(12, 12)), aiConfig).ok).toBe(false);
    expect(createMatch(prepareWorld(diag(12, 13)), aiConfig).ok).toBe(true);
  });

  /** One land mass over the seam of the world: AAA in the west (x 0..14), BBB in the east (x 185..199). */
  function seam(capA: number, capB: number): WorldData {
    return synthWorld({
      width: 200,
      height: 100,
      rects: [
        { id: 1, x0: 0, x1: 14, y0: 30, y1: 60 },
        { id: 2, x0: 185, x1: 199, y0: 30, y1: 60 },
      ],
      countries: [
        { id: 1, a3: 'AAA', capital: [capA, 45] },
        { id: 2, a3: 'BBB', capital: [capB, 45] },
      ],
    });
  }

  it('across the antimeridian the short way counts: x = 1 and x = width - 2 are 3 cells apart and refused', () => {
    const r = createMatch(prepareWorld(seam(1, 198)), aiConfig);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('notEnoughCountries');
    // the other way round: the AI nation sits at the east edge and the player in the west, same result
    const r2 = createMatch(prepareWorld(seam(198, 1)), matchSetupConfig({ kind: 'real', countryId: 2 }, { aiNations: 1, tribes: false }));
    expect(r2.ok).toBe(false);
  });

  it('across the antimeridian exactly 17 cells apart is allowed', () => {
    // 5 cells east of the seam and 12 west of it: 5 + 12 = 17 along the short way
    const m = build(seam(5, 200 - 12), aiConfig);
    expect(m.seats.filter((s) => s.kind === 'ai').map((s) => s.countryId)).toEqual([2]);
    const r = createMatch(prepareWorld(seam(5, 200 - 11)), aiConfig);
    expect(r.ok).toBe(false);
  });
});

describe('prepareWorld and the overrides', () => {
  /** AAA with a neutral name, BBB merged into it, CCC unplayable, DDD with Plains, Mountain and Peak cells, EEE playable:false, FFF in Antarctica, GGG plain. */
  function overridden(): WorldData {
    return synthWorld({
      width: 100,
      height: 60,
      rects: [
        { id: 1, x0: 0, x1: 14, y0: 0, y1: 14 },
        { id: 2, x0: 20, x1: 34, y0: 0, y1: 14 },
        { id: 3, x0: 40, x1: 54, y0: 0, y1: 14 },
        { id: 4, x0: 60, x1: 64, y0: 0, y1: 1 }, // 10 Plains cells ...
        { id: 4, x0: 60, x1: 62, y0: 2, y1: 2, cls: CLASS_MOUNTAIN }, // ... + 3 Mountain
        { id: 5, x0: 70, x1: 84, y0: 0, y1: 14 },
        { id: 6, x0: 0, x1: 14, y0: 30, y1: 44 },
        { id: 7, x0: 20, x1: 34, y0: 30, y1: 44 },
      ],
      cells: [
        [63, 2, 4, CLASS_PEAK],
        [64, 2, 4, CLASS_PEAK],
      ],
      countries: [
        { id: 1, a3: 'AAA', capital: [7, 7], nameEn: 'Rawland', nameSv: 'Rawland-sv' },
        { id: 2, a3: 'BBB', capital: [27, 7] },
        { id: 3, a3: 'CCC', capital: [47, 7] },
        { id: 4, a3: 'DDD', capital: [60, 0] },
        { id: 5, a3: 'EEE', capital: [77, 7], playable: false },
        { id: 6, a3: 'FFF', capital: [7, 37], continent: 'Antarctica' },
        { id: 7, a3: 'GGG', capital: [27, 37], nameEn: 'Plainland', nameSv: 'Slättland' },
      ],
      overrides: {
        merged: [{ a3: 'BBB', into: 'AAA' }],
        unplayable: ['CCC'],
        neutralNames: { AAA: { en: 'Neutral Alpha', sv: 'Neutrala Alfa' } },
      },
    });
  }

  it('uses the overrides\' neutral names in both languages and leaves the other names as they are', () => {
    const w = prepareWorld(overridden());
    const aaa = w.byId.get(1)!;
    expect([aaa.nameEn, aaa.nameSv]).toEqual(['Neutral Alpha', 'Neutrala Alfa']);
    const ggg = w.byId.get(7)!;
    expect([ggg.nameEn, ggg.nameSv]).toEqual(['Plainland', 'Slättland']);
    const only = prepareWorld(synthWorld({ width: 10, height: 10, rects: [{ id: 1, x0: 0, x1: 3, y0: 0, y1: 3 }], countries: [{ id: 1, a3: 'AAA', capital: [1, 1], nameEn: 'Raw', nameSv: 'Rå' }], overrides: { neutralNames: { AAA: { en: 'OnlyEn', sv: 'EnbartSv' } } } }));
    expect([only.byId.get(1)!.nameEn, only.byId.get(1)!.nameSv]).toEqual(['OnlyEn', 'EnbartSv']);
  });

  it('leaves out merged, unplayable, playable:false and Antarctic countries, and nobody else', () => {
    const w = prepareWorld(overridden());
    const excluded = Object.fromEntries(w.countries.map((c) => [c.a3, c.excluded]));
    expect(excluded).toEqual({ AAA: false, BBB: true, CCC: true, DDD: false, EEE: true, FFF: true, GGG: false });
    const a = w.analyse('world');
    expect(countryEligibility(a, w.byId.get(2)!)).toMatchObject({ ok: false, reason: 'excluded' });
    expect(countryEligibility(a, w.byId.get(3)!)).toMatchObject({ ok: false, reason: 'excluded' });
    expect(countryEligibility(a, w.byId.get(1)!).ok).toBe(true);
  });

  it('every country is its own home land, a merged territory included (D127)', () => {
    const w = prepareWorld(overridden());
    for (const c of w.countries) expect(c.homeId, c.a3).toBe(c.id);
  });

  it('counts Mountain AND Peak cells for the defence trait (10 Plains, 3 Mountain, 2 Peak: 5 of 15 = 333 thousandths, not 200)', () => {
    const w = prepareWorld(overridden());
    const ddd = w.byId.get(4)!;
    expect(ddd.cells).toBe(15);
    expect(ddd.mountainPermille).toBe(333);
    expect(w.byId.get(7)!.mountainPermille).toBe(0);
  });
});
