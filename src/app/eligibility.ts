// Who can be chosen, and why not (M06, item 3): the fair-start rule in one place.
//  - A COUNTRY is selectable only if it has at least SETUP_MIN_COUNTRY_CELLS cells (inside the region) AND the connected land mass of
//    its capital has at least START_DISC_CELLS (K = 197) cells. Then a Spawn on the capital claims exactly K cells (the K nearest
//    contiguous unowned land cells), so every nation starts with the same disc.
//  - A CUSTOM START CELL needs the same land mass.
// A refusal carries the i18n key of its reason and the numbers for its placeholders ("{cells} of {need} cells"); the menu shows the
// text with `t(key, params)`. Pure functions of the prepared world; no DOM.
import { isRegionId } from '../data/regions';
import { SETUP_MIN_COUNTRY_CELLS, START_DISC_CELLS } from '../sim/rules';
import { isPlayableClass } from '../sim/terrain';
import type { TextKey } from '../ui/i18n';
import { landmassSizeAt } from './landmass';
import type { CountryInfo, PreparedWorld, RegionAnalysis } from './matchWorld';

export type CountryReason = 'tooFewCells' | 'noCapitalLand' | 'outsideRegion' | 'smallLandmass' | 'excluded';
export type StartReason = 'terrain' | 'outsideRegion' | 'smallLandmass';

export type ReasonParams = {
  /** The count that fell short (own cells, or the cells of the land mass). */
  readonly cells: number;
  /** The count that is needed. */
  readonly need: number;
};

export interface CountryEligibility {
  readonly ok: boolean;
  readonly reason: CountryReason | null;
  /** The i18n key of the reason (null when ok). */
  readonly key: TextKey | null;
  /** The numbers for the key's placeholders (null when the key has none). */
  readonly params: ReasonParams | null;
  /** Own cells inside the region. */
  readonly cells: number;
  /** Cells of the land mass of the capital (0 when the capital is not on playable land). */
  readonly landmass: number;
}

export interface StartEligibility {
  readonly ok: boolean;
  readonly reason: StartReason | null;
  readonly key: TextKey | null;
  readonly params: ReasonParams | null;
  /** Cells of the land mass under the cell (0 when it is not playable). */
  readonly landmass: number;
}

const OK_START: StartEligibility = Object.freeze({ ok: true, reason: null, key: null, params: null, landmass: 0 });

function refuse(reason: CountryReason, cells: number, landmass: number, params: ReasonParams | null): CountryEligibility {
  const key: TextKey =
    reason === 'tooFewCells'
      ? 'setup.reason.tooFewCells'
      : reason === 'smallLandmass'
        ? 'setup.reason.smallLandmass'
        : reason === 'noCapitalLand'
          ? 'setup.reason.noCapitalLand'
          : reason === 'outsideRegion'
            ? 'setup.reason.outsideRegion'
            : 'setup.reason.excluded';
  return { ok: false, reason, key, params, cells, landmass };
}

/** Can this country be chosen as your nation or taken by an AI nation in this region, and if not, why not? */
export function countryEligibility(analysis: RegionAnalysis, country: CountryInfo): CountryEligibility {
  const cells = analysis.cellsInMask.get(country.id) ?? 0;
  const cap = country.capitalCell;
  // A capital outside the cut-out says so first: "outside the region" tells the player more than "0 of 8 cells".
  if (cap >= 0 && analysis.mask !== null && analysis.mask[cap] === 0) return refuse('outsideRegion', cells, 0, null);
  if (cells < SETUP_MIN_COUNTRY_CELLS) return refuse('tooFewCells', cells, 0, { cells, need: SETUP_MIN_COUNTRY_CELLS });
  if (country.excluded) return refuse('excluded', cells, 0, null);
  if (cap < 0) return refuse('noCapitalLand', cells, 0, null);
  if (!isPlayableClass(analysis.terrain[cap] as number)) return refuse('noCapitalLand', cells, 0, null);
  const landmass = landmassSizeAt(analysis.land, cap);
  if (landmass < START_DISC_CELLS) return refuse('smallLandmass', cells, landmass, { cells: landmass, need: START_DISC_CELLS });
  return { ok: true, reason: null, key: null, params: null, cells, landmass };
}

export interface CountryChoice {
  readonly country: CountryInfo;
  readonly eligibility: CountryEligibility;
}

/** Every country of the table with its eligibility in a region (table order = id order). */
export function listCountries(world: PreparedWorld, region: string): CountryChoice[] {
  if (!isRegionId(region)) throw new RangeError(`unknown region ${region}`);
  const analysis = world.analyse(region);
  return world.countries.map((country) => ({ country, eligibility: countryEligibility(analysis, country) }));
}

/** May a custom nation start on this cell? Same land-mass rule as a country, plus the terrain and the region. */
export function startCellEligibility(world: PreparedWorld, analysis: RegionAnalysis, cell: number): StartEligibility {
  const n = world.width * world.height;
  if (!Number.isInteger(cell) || cell < 0 || cell >= n) return { ok: false, reason: 'terrain', key: 'setup.start.terrain', params: null, landmass: 0 };
  if (!isPlayableClass(analysis.terrain[cell] as number)) {
    const outside = analysis.mask !== null && analysis.mask[cell] === 0 && isPlayableClass(world.data.sim.terrainClass[cell] as number);
    return outside
      ? { ok: false, reason: 'outsideRegion', key: 'setup.reason.outsideRegion', params: null, landmass: 0 }
      : { ok: false, reason: 'terrain', key: 'setup.start.terrain', params: null, landmass: 0 };
  }
  const landmass = landmassSizeAt(analysis.land, cell);
  if (landmass < START_DISC_CELLS) return { ok: false, reason: 'smallLandmass', key: 'setup.reason.smallLandmass', params: { cells: landmass, need: START_DISC_CELLS }, landmass };
  return { ...OK_START, landmass };
}
