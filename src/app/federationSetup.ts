// Federations in the match setup (M18b-2): a candidate country ("Dela upp stormakter" on) is replaced by its sub-nations of
// `public/data/federations.bin.gz` (src/data/federations.ts). Each sub-nation is a seat of its own with a fair start (D112) INSIDE its own
// land; the members of one federation are allied from tick 0 by `bindFederation` (src/sim/diplomacy.ts). Pure helpers of the prepared
// world; the start finder (a capital whose disc lies wholly in the sub-nation) is in src/app/matchSetup.ts, which may build a sim. No DOM, no clock, no random.
import type { Federations, SubNation } from '../data/federations';
import type { Lang } from '../ui/i18n';
import { countryName } from './countrySearch';
import type { CountryInfo } from './matchWorld';

/**
 * The name a sub-nation gets in a match (leaderboard, map labels, result): its OWN name, the province ("Alaska"), without the redundant
 * "Region" the data names carry ("Khabarovsk Krai Region" -> "Khabarovsk Krai"). The country is not part of it: the group row of the
 * federation already names it, in the language of the UI (D-Fix-5C). The `country` argument is kept for callers of the old API and is not used.
 */
export function subNationName(sub: SubNation, _country?: CountryInfo): string {
  return sub.name.replace(/ Region$/, '');
}

/** Where the country is needed next to a sub-nation: "Alaska (USA)" with the country in the language of the UI (nameSv / nameEn). */
export function subNationLabel(sub: SubNation, country: CountryInfo, lang: Lang): string {
  return `${subNationName(sub)} (${countryName(country, lang)})`;
}

/** The sub-nations of a country that exist in the pack, in table order (empty when the pack is missing or the country is not a candidate). */
export function membersOf(f: Federations | null, country: CountryInfo): readonly SubNation[] {
  if (f === null) return [];
  const index = country.id - 1;
  if (f.candidate[index] !== 1) return [];
  return (f.membersByCountry[index] ?? []).map((id) => f.subNations[id - 1] as SubNation);
}
