// The chosen UI language is a preference (M06fix): the language button writes it, the next page load reads it. An explicit `lang` in the address
// still wins (a shared link, the Dev panel, the tests) and is NOT remembered; test mode (`?test=1`) neither reads nor writes it, so a test page
// is Swedish unless its address says otherwise, whatever an earlier visit stored.
import { DEFAULT_LANGUAGE, LANGUAGES, languageOf, loadLanguage, onLanguageChange, setLanguage, type Lang } from '../ui/i18n';
import { getPref, setPref } from './prefs';

export const LANG_PREF_KEY = 'lang';

const isLang = (v: unknown): v is Lang => v === 'sv' || v === 'en';

/** The language to start in: the address, else the stored choice, else Swedish. */
export function startLanguage(raw: Readonly<Record<string, string>>, test: boolean): Lang {
  if (raw.lang === 'sv' || raw.lang === 'en') return languageOf(raw);
  if (test) return DEFAULT_LANGUAGE;
  return getPref<Lang>(LANG_PREF_KEY, DEFAULT_LANGUAGE, isLang);
}

/** What `loadStartLanguage` did: the language to show, and the wanted one when its table failed to load (then `lang` is the other language). */
export interface StartLanguage {
  lang: Lang;
  failed: Lang | null;
}

/**
 * Bundle-diet-2: loads the table(s) the first paint needs. Test mode loads both (so `__test.text(key)` and the strict missing-key check see
 * every key); otherwise only the start language. When that one fails to load the OTHER language is loaded and shown instead, and `failed`
 * names the wanted one (the caller tells the player, never silently); when both fail the error propagates to the boot error screen.
 */
export async function loadStartLanguage(raw: Readonly<Record<string, string>>, test: boolean): Promise<StartLanguage> {
  const want = startLanguage(raw, test);
  if (test) {
    await Promise.all(LANGUAGES.map((l) => loadLanguage(l)));
    return { lang: want, failed: null };
  }
  try {
    await loadLanguage(want);
    return { lang: want, failed: null };
  } catch (err) {
    console.error(err);
    const other: Lang = want === 'sv' ? 'en' : 'sv';
    await loadLanguage(other);
    return { lang: other, failed: want };
  }
}

/** Sets the start language (default: the one `startLanguage` picks; its table must be loaded) and remembers every later change; returns the function that stops remembering. */
export function applyStartLanguage(raw: Readonly<Record<string, string>>, test: boolean, lang?: Lang): () => void {
  setLanguage(lang ?? startLanguage(raw, test));
  if (test) return () => undefined;
  return onLanguageChange((l) => {
    setPref(LANG_PREF_KEY, l);
  });
}
