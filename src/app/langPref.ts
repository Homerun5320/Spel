// The chosen UI language is a preference (M06fix): the language button writes it, the next page load reads it. An explicit `lang` in the address
// still wins (a shared link, the Dev panel, the tests) and is NOT remembered; test mode (`?test=1`) neither reads nor writes it, so a test page
// is Swedish unless its address says otherwise, whatever an earlier visit stored.
import { DEFAULT_LANGUAGE, languageOf, onLanguageChange, setLanguage, type Lang } from '../ui/i18n';
import { getPref, setPref } from './prefs';

export const LANG_PREF_KEY = 'lang';

const isLang = (v: unknown): v is Lang => v === 'sv' || v === 'en';

/** The language to start in: the address, else the stored choice, else Swedish. */
export function startLanguage(raw: Readonly<Record<string, string>>, test: boolean): Lang {
  if (raw.lang === 'sv' || raw.lang === 'en') return languageOf(raw);
  if (test) return DEFAULT_LANGUAGE;
  return getPref<Lang>(LANG_PREF_KEY, DEFAULT_LANGUAGE, isLang);
}

/** Sets the start language and remembers every later change; returns the function that stops remembering. */
export function applyStartLanguage(raw: Readonly<Record<string, string>>, test: boolean): () => void {
  setLanguage(startLanguage(raw, test));
  if (test) return () => undefined;
  return onLanguageChange((l) => {
    setPref(LANG_PREF_KEY, l);
  });
}
