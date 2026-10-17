// Look-1: the City style setting ('Gammal' / 'Modern'). The address (`?citystyle=old|new`, `#citystyle-new`) wins and is not remembered; otherwise the
// stored choice (`getPref`), otherwise 'old' (nothing changes by itself). Test mode reads and writes no preference.
import { DEFAULT_CITY_STYLE, isCityStyle, type CityStyle } from '../render/cityTiers';
import { getPref, setPref } from './prefs';

export const CITY_STYLE_PREF_KEY = 'citystyle';

/** The style to start in. */
export function startCityStyle(raw: Readonly<Record<string, string>>, test: boolean): CityStyle {
  const a = raw.citystyle;
  if (isCityStyle(a)) return a;
  if (test) return DEFAULT_CITY_STYLE;
  return getPref<CityStyle>(CITY_STYLE_PREF_KEY, DEFAULT_CITY_STYLE, isCityStyle);
}

/** Remembers the player's choice (not in test mode). */
export function rememberCityStyle(style: CityStyle, test: boolean): void {
  if (!test) setPref(CITY_STYLE_PREF_KEY, style);
}

/** The other style (the setup button cycles). */
export function otherCityStyle(style: CityStyle): CityStyle {
  return style === 'old' ? 'new' : 'old';
}
