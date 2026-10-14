// Country search (M06, item 1): matches BOTH `name_en` and `name_sv`, ignoring case and diacritics ("aland" finds Åland, "sverige"
// and "sweden" both find Sweden), and shows the name in the UI language. Pure.
import type { Lang } from '../ui/i18n';
import type { CountryInfo } from './matchWorld';

/** Letters that do not decompose into a base letter and a mark. */
const SPECIAL: Readonly<Record<string, string>> = { ø: 'o', æ: 'ae', œ: 'oe', ß: 'ss', ł: 'l', đ: 'd', ð: 'd', þ: 'th', ı: 'i' };

/** Lower case, accents and other combining marks removed, special letters spelled out, runs of white space and punctuation reduced to one space. */
export function normalizeSearch(text: string): string {
  let out = '';
  for (const ch of text.normalize('NFD').toLowerCase()) {
    const code = ch.codePointAt(0) as number;
    if (code >= 0x300 && code <= 0x36f) continue; // combining marks
    out += SPECIAL[ch] ?? ch;
  }
  return out.replace(/[^a-z0-9]+/g, ' ').trim();
}

/** The name of a country in a language. */
export function countryName(country: CountryInfo, lang: Lang): string {
  return lang === 'sv' ? country.nameSv : country.nameEn;
}

export interface SearchHit {
  readonly country: CountryInfo;
  /** Lower is better: 0 exact name, 1 name starts with the query, 2 a word starts with it, 3 it appears inside a name, 4 matches only the other language. */
  readonly rank: number;
}

/** Rank of one normalised name for a normalised query, or -1 for no match. */
function rankIn(name: string, q: string): number {
  if (name === q) return 0;
  if (name.startsWith(q)) return 1;
  if (name.includes(' ' + q)) return 2;
  if (name.includes(q)) return 3;
  return -1;
}

/**
 * The countries that match `query` in either language, best first (rank, then the name in the UI language, then id). An empty query
 * returns every country in the order of the UI-language name. Names compare as plain normalised text (no locale), so the order
 * is the same on every machine.
 */
export function searchCountries(countries: readonly CountryInfo[], query: string, lang: Lang): SearchHit[] {
  const q = normalizeSearch(query);
  const hits: Array<SearchHit & { readonly sort: string }> = [];
  for (const country of countries) {
    const own = normalizeSearch(countryName(country, lang));
    if (q === '') {
      hits.push({ country, rank: 0, sort: own });
      continue;
    }
    const other = normalizeSearch(countryName(country, lang === 'sv' ? 'en' : 'sv'));
    const mine = rankIn(own, q);
    const theirs = rankIn(other, q);
    if (mine < 0 && theirs < 0) continue;
    const rank = mine >= 0 ? (theirs >= 0 ? Math.min(mine, theirs) : mine) : 4;
    hits.push({ country, rank, sort: own });
  }
  hits.sort((a, b) => a.rank - b.rank || (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0) || a.country.id - b.country.id);
  return hits.map(({ country, rank }) => ({ country, rank }));
}
