// i18n (CHARTER section 2, invariant 10): every player-facing string goes through `t(key, params?)`. Two tables, `sv` (the
// default language, `i18n.sv.ts`) and `en` (`i18n.en.ts`), are edited together: `en` is typed `Record<TextKey, string>`, so a key missing
// from either table (or an extra one) does not compile, and `tests/i18n.test.ts` checks the same at run time plus the placeholders and
// that every `t('...')` literal in `src` names a real key. In test mode `setStrictI18n(true)` turns a missing key (or a
// missing placeholder value) into an exception, which the e2e tests see as a page error.
//
// Bundle-diet-2: the page loads only the ACTIVE language. The tables are separate modules that `loadLanguage` pulls in with import() before
// the first paint (boot, `langPref.ts`); the other one loads when the player switches (`switchLanguage`). `t()` stays synchronous. Test mode
// and the unit tests register both tables up front.
//
// Developer tools (the Dev panel, the perf overlay and its report, the debug pages) are Swedish only on purpose (D98).

import type { TextKey } from './i18n.sv';
import { GOLD_DISPLAY_FACTOR } from './uiConfig';

export type { TextKey };

export type Lang = 'sv' | 'en';
export const LANGUAGES: readonly Lang[] = ['sv', 'en'];
export const DEFAULT_LANGUAGE: Lang = 'sv';
/** Each language's own name (shown in the load-error text, which is written in the OTHER language). */
export const LANGUAGE_NAMES: Readonly<Record<Lang, string>> = { sv: 'Svenska', en: 'English' };


/** The loaded tables (empty until `registerTable` / `loadLanguage`), for the parity test and for tools. Treat as read-only. */
export const TABLES: Readonly<Record<Lang, Readonly<Record<string, string>>>> = { sv: {}, en: {} };
const ready: Record<Lang, boolean> = { sv: false, en: false };
const pending: Partial<Record<Lang, Promise<void>>> = {};

/** Puts a language table in place (the dynamic import below, test mode and the unit-test setup use it). */
export function registerTable(lang: Lang, table: Readonly<Record<string, string>>): void {
  Object.assign(TABLES[lang], table);
  ready[lang] = true;
}

export function isLanguageLoaded(lang: Lang): boolean {
  return ready[lang];
}

/** Loads a language table with import() (once). A failed load rejects; a browser caches a failed module fetch, so the player is told to reload the page. */
export function loadLanguage(lang: Lang): Promise<void> {
  if (ready[lang]) return Promise.resolve();
  let p = pending[lang];
  if (p === undefined) {
    p = (lang === 'sv' ? import('./i18n.sv').then((m) => registerTable('sv', m.sv)) : import('./i18n.en').then((m) => registerTable('en', m.en))).catch((err: unknown) => {
      delete pending[lang];
      throw err;
    });
    pending[lang] = p;
  }
  return p;
}

/** Switch to `next`: at once when its table is there, else after it has loaded. A load error rejects and leaves the language as it was. */
export function switchLanguage(next: Lang): Promise<void> {
  if (ready[next]) {
    setLanguage(next);
    return Promise.resolve();
  }
  return loadLanguage(next).then(() => setLanguage(next));
}
export type TextParams = Readonly<Record<string, string | number>>;

let language: Lang = DEFAULT_LANGUAGE;
let version = 0;
let strict = false;
const listeners = new Set<(lang: Lang) => void>();

export function getLanguage(): Lang {
  return language;
}

/** Increases whenever the language changes: cached texts compare it to know they must be rebuilt. */
export function languageVersion(): number {
  return version;
}

export function setLanguage(next: Lang): void {
  if (next === language) return;
  language = next;
  version++;
  for (const l of listeners) l(next);
}

/** Calls `listener` after the language changed; returns the function that stops it. */
export function onLanguageChange(listener: (lang: Lang) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** `lang=en` (query or hash) selects English; anything else is the default. */
export function languageOf(raw: Readonly<Record<string, string>>): Lang {
  return raw.lang === 'en' ? 'en' : raw.lang === 'sv' ? 'sv' : DEFAULT_LANGUAGE;
}

/** Test mode: a missing key or placeholder value throws instead of falling back. */
export function setStrictI18n(on: boolean): void {
  strict = on;
}

export function isStrictI18n(): boolean {
  return strict;
}

const PLACEHOLDER = /\{([A-Za-z0-9_]+)\}/g;

/** The placeholder names of a text, in order of appearance (used by the parity test). */
export function placeholdersOf(text: string): string[] {
  return Array.from(text.matchAll(PLACEHOLDER), (m) => m[1] as string);
}

/**
 * The text of `key` in the current language with `{name}` filled from `params`. A missing key falls back to the other
 * language and then to the key itself; in strict mode (test mode) a key that is missing from EITHER table, or a placeholder
 * without a value, throws.
 */
export function t(key: TextKey, params?: TextParams): string {
  const own = TABLES[language][key];
  const other = TABLES[language === 'sv' ? 'en' : 'sv'][key];
  if (strict && (own === undefined || other === undefined)) {
    throw new Error(`i18n: key "${key}" is missing from the ${own === undefined ? language : language === 'sv' ? 'en' : 'sv'} table`);
  }
  const text = own ?? other ?? key;
  if (params === undefined && !strict) return text;
  return text.replace(PLACEHOLDER, (whole, name: string) => {
    const v = params?.[name];
    if (v === undefined) {
      if (strict) throw new Error(`i18n: key "${key}" needs the value {${name}}`);
      return whole;
    }
    return String(v);
  });
}

/**
 * A text with a count: `oneKey` when `count` is exactly 1, else `key` (the plural; also used for 0). Both languages here have two forms, so the
 * pair is all a caller needs: `tn('setup.cells', 'setup.cells.one', n, { cells: n })`. The value is passed in `params` like for `t`.
 */
export function tn(key: TextKey, oneKey: TextKey, count: number, params?: TextParams): string {
  return t(count === 1 ? oneKey : key, params);
}

/** True when `key` exists in both tables. */
export function hasKey(key: string): key is TextKey {
  return key in TABLES.sv && key in TABLES.en;
}

const GROUP_SEPARATOR: Record<Lang, string> = { sv: ' ', en: ',' };
const DECIMAL_SEPARATOR: Record<Lang, string> = { sv: ',', en: '.' };

/** 1234567 -> "1 234 567" (a no-break space) in Swedish, "1,234,567" in English. Whole numbers only; negative numbers keep the sign. */
export function formatInt(n: number): string {
  const r = Math.round(n);
  const digits = String(Math.abs(r)).replace(/\B(?=(\d{3})+(?!\d))/g, GROUP_SEPARATOR[language]);
  return r < 0 ? `-${digits}` : digits;
}

/** `value` with `decimals` decimals and the language's decimal separator; no locale APIs, no float formatting surprises. */
export function formatFixed(value: number, decimals: number): string {
  const scale = decimals === 0 ? 1 : decimals === 1 ? 10 : decimals === 2 ? 100 : 1000;
  const scaled = Math.round(Math.abs(value) * scale);
  const whole = Math.floor(scaled / scale);
  const frac = scaled - whole * scale;
  const sign = value < 0 && scaled > 0 ? '-' : '';
  if (decimals === 0) return `${sign}${formatInt(whole)}`;
  return `${sign}${formatInt(whole)}${DECIMAL_SEPARATOR[language]}${String(frac).padStart(decimals, '0')}`;
}

/** The compact suffixes of a displayed gold amount from 1 000 000 up: million, billion (10^9, "miljard" in Swedish), trillion (10^12). */
const COMPACT_SUFFIX: Record<Lang, readonly [string, string, string]> = {
  sv: ['\u00a0mn', '\u00a0mdr', '\u00a0bn'],
  en: ['M', 'B', 'T'],
};
/** From this displayed amount upward a gold amount is written in the compact form; below it the whole number with thousands separators. */
export const GOLD_COMPACT_FROM = 1_000_000;

/**
 * Integration (Sim-Levels2 + Look-2): the ONE writer of a DISPLAYED gold amount (a whole number already multiplied by GOLD_DISPLAY_FACTOR). Below
 * GOLD_COMPACT_FROM it is the whole number with the language's thousands separator ("25 050"). From a million up it is compact with at most 3
 * significant digits, cut (never rounded up, so 999 999 999 never reads "1000 mn"): Swedish "1,23 mn", "49,9 mdr", English "1.23M", "49.9B".
 */
export function formatShownGold(shown: number): string {
  const r = Math.round(shown);
  if (r < 0) return `-${formatShownGold(-r)}`;
  if (r < GOLD_COMPACT_FROM) return formatInt(r);
  let ix = 0;
  let unit = GOLD_COMPACT_FROM;
  while (ix < 2 && r >= unit * 1000) {
    unit *= 1000;
    ix++;
  }
  const whole = Math.floor(r / unit);
  const decimals = whole >= 100 ? 0 : whole >= 10 ? 1 : 2;
  const scale = 10 ** decimals;
  const step = unit / scale; // an integer: unit is 10^6 or more and decimals is at most 2
  const q = (r - (r % step)) / step;
  const intPart = Math.floor(q / scale);
  const frac = String(q - intPart * scale)
    .padStart(decimals, '0')
    .replace(/0+$/, '');
  return `${formatInt(intPart)}${frac === '' ? '' : DECIMAL_SEPARATOR[language] + frac}${COMPACT_SUFFIX[language][ix]}`;
}

/**
 * Look-2: the ONE way a gold amount (a purse, a price, a cost) is shown: the sim amount times GOLD_DISPLAY_FACTOR, a whole number with the language's
 * thousands separator, compact from a million (`formatShownGold`). Every surface that names gold goes through this and `formatGoldRate`;
 * tests/ui/goldDisplay.test.ts scans the UI sources for the rest.
 */
export function formatGold(simGold: number): string {
  return formatShownGold(simGold * GOLD_DISPLAY_FACTOR);
}

/** The same for gold per second, given in sim milli-gold per second: up to two decimals, trailing zeros dropped ("5", "0,5", "0,25"), so a gentle per-level step stays readable; a million or more per second is compact like a purse. */
export function formatGoldRate(milliPerSec: number): string {
  const hundredths = Math.round((milliPerSec * GOLD_DISPLAY_FACTOR) / 10);
  if (hundredths >= GOLD_COMPACT_FROM * 100) return formatShownGold(Math.floor(hundredths / 100));
  if (hundredths % 100 === 0) return formatInt(hundredths / 100);
  if (hundredths % 10 === 0) return formatFixed(hundredths / 100, 1);
  return formatFixed(hundredths / 100, 2);
}

/** Seconds as "m:ss" (language neutral). */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}
