// i18n (CHARTER invariant 10): both tables hold the same keys and the same placeholders, every key is used, every `t('...')` in
// the source names a real key, a missing key fails in strict (test) mode, and no player-facing file hides a Swedish string
// outside the tables.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_LANGUAGE,
  LANGUAGES,
  TABLES,
  formatClock,
  formatFixed,
  formatInt,
  getLanguage,
  hasKey,
  languageOf,
  languageVersion,
  onLanguageChange,
  placeholdersOf,
  setLanguage,
  setStrictI18n,
  t,
  type TextKey,
} from '../src/ui/i18n';

const SRC = path.resolve(__dirname, '../src');

afterEach(() => {
  setLanguage('sv');
  setStrictI18n(false);
});

describe('the two tables', () => {
  it('sv and en have exactly the same keys', () => {
    const sv = Object.keys(TABLES.sv).sort();
    const en = Object.keys(TABLES.en).sort();
    expect(en.filter((k) => !sv.includes(k)), 'only in en').toEqual([]);
    expect(sv.filter((k) => !en.includes(k)), 'only in sv').toEqual([]);
    expect(sv.length).toBeGreaterThan(50);
  });

  it('no text is empty, and the same {placeholders} appear in both languages', () => {
    for (const k of Object.keys(TABLES.sv)) {
      const a = TABLES.sv[k] as string;
      const b = TABLES.en[k] as string;
      expect(a.trim().length, `sv ${k}`).toBeGreaterThan(0);
      expect(b.trim().length, `en ${k}`).toBeGreaterThan(0);
      expect(placeholdersOf(a).sort(), `placeholders of ${k}`).toEqual(placeholdersOf(b).sort());
    }
  });

  it('English is really English for the long sentences (not a copy of the Swedish text)', () => {
    let same = 0;
    for (const k of Object.keys(TABLES.sv)) if (TABLES.sv[k] === TABLES.en[k]) same++;
    // a handful of language-neutral texts are equal ("Dev", "{n}.", "{n}x", "+{rate}/s", "{s} s")
    expect(same).toBeLessThanOrEqual(8);
  });

  it('default language is Swedish and both languages are listed', () => {
    expect(DEFAULT_LANGUAGE).toBe('sv');
    expect(LANGUAGES).toEqual(['sv', 'en']);
    expect(getLanguage()).toBe('sv');
  });
});

describe('t()', () => {
  it('fills placeholders and follows the language', () => {
    expect(t('hud.commitTroops', { n: 12 })).toBe('12 trupper');
    setLanguage('en');
    expect(t('hud.commitTroops', { n: 12 })).toBe('12 troops');
    expect(t('start.play')).toBe('Play');
    setLanguage('sv');
    expect(t('start.play')).toBe('Spela');
  });

  it('a language change bumps the version once and calls the listeners', () => {
    const seen: string[] = [];
    const stop = onLanguageChange((l) => seen.push(l));
    const v0 = languageVersion();
    setLanguage('en');
    setLanguage('en');
    expect(languageVersion()).toBe(v0 + 1);
    setLanguage('sv');
    stop();
    setLanguage('en');
    expect(seen).toEqual(['en', 'sv']);
  });

  it('outside test mode a missing key falls back to the key itself and a missing value keeps the placeholder', () => {
    expect(t('no.such.key' as TextKey)).toBe('no.such.key');
    expect(t('hud.commitTroops')).toBe('{n} trupper');
  });

  it('in strict (test) mode a key missing from EITHER table throws, and so does a missing placeholder value', () => {
    setStrictI18n(true);
    expect(() => t('no.such.key' as TextKey)).toThrow(/i18n: key "no.such.key" is missing/);
    expect(() => t('hud.commitTroops')).toThrow(/needs the value \{n\}/);
    expect(t('hud.commitTroops', { n: 3 })).toBe('3 trupper');
    // a key that exists in sv only
    (TABLES.sv as Record<string, string>)['only.sv'] = 'x';
    try {
      expect(() => t('only.sv' as TextKey)).toThrow(/missing from the en table/);
      setLanguage('en');
      expect(() => t('only.sv' as TextKey)).toThrow(/missing from the sv table|missing from the en table/);
    } finally {
      delete (TABLES.sv as Record<string, string>)['only.sv'];
    }
    // a key that exists in en only
    (TABLES.en as Record<string, string>)['only.en'] = 'x';
    try {
      setLanguage('sv');
      expect(() => t('only.en' as TextKey)).toThrow(/missing from the sv table/);
    } finally {
      delete (TABLES.en as Record<string, string>)['only.en'];
    }
  });

  it('hasKey tells real keys from invented ones, languageOf reads lang=en', () => {
    expect(hasKey('hud.gold')).toBe(true);
    expect(hasKey('hud.nope')).toBe(false);
    expect(languageOf({ lang: 'en' })).toBe('en');
    expect(languageOf({ lang: 'sv' })).toBe('sv');
    expect(languageOf({ lang: 'de' })).toBe('sv');
    expect(languageOf({})).toBe('sv');
  });
});

describe('number and time formats', () => {
  it('groups thousands with a no-break space in Swedish and a comma in English', () => {
    expect(formatInt(1234567)).toBe('1 234 567');
    expect(formatInt(-999)).toBe('-999');
    expect(formatInt(0)).toBe('0');
    setLanguage('en');
    expect(formatInt(1234567)).toBe('1,234,567');
  });

  it('decimals use the language separator and never print -0', () => {
    expect(formatFixed(0.29, 2)).toBe('0,29');
    expect(formatFixed(2.55, 1)).toBe('2,6');
    expect(formatFixed(1234.5, 1)).toBe('1 234,5');
    expect(formatFixed(-0.001, 2)).toBe('0,00');
    expect(formatFixed(7, 0)).toBe('7');
    setLanguage('en');
    expect(formatFixed(0.29, 2)).toBe('0.29');
  });

  it('the clock is m:ss', () => {
    expect([formatClock(0), formatClock(9), formatClock(60), formatClock(125), formatClock(3599)]).toEqual(['0:00', '0:09', '1:00', '2:05', '59:59']);
    expect(formatClock(-5)).toBe('0:00');
  });
});

function listTs(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listTs(p));
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

const KEY_LITERAL = /'((?:app|start|help|hud|phase|reject|toast|tooltip|class|setup|sel)\.[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)?)'/g;

describe('the source and the tables agree', () => {
  const files = listTs(SRC).filter((f) => !f.endsWith(path.join('ui', 'i18n.ts')));
  const used = new Map<string, string>();
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    for (const m of text.matchAll(KEY_LITERAL)) used.set(m[1] as string, path.relative(SRC, f));
  }

  it('every key written in the source exists in both tables', () => {
    const missing = [...used.entries()].filter(([k]) => !hasKey(k)).map(([k, f]) => `${k} (${f})`);
    expect(missing).toEqual([]);
    expect(used.size).toBeGreaterThan(40);
  });

  it('every key of the tables is used somewhere (no dead strings)', () => {
    const dead = Object.keys(TABLES.sv).filter((k) => !used.has(k));
    expect(dead).toEqual([]);
  });
});

/** Source text without comments (a plain scan: block comments, then line comments). */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

describe('no Swedish text hides in the player-facing code', () => {
  // The Dev panel, the perf overlay and its report, the report modal and the debug pages are developer tools, Swedish only (D98).
  const PLAYER_FACING = ['ui/matchHud.ts', 'ui/startScreen.ts', 'ui/hudLogic.ts', 'ui/hudStyle.ts', 'ui/clickTracker.ts', 'ui/hudValues.ts', 'app/tooltip.ts', 'app/globeApp.ts', 'app/match.ts', 'app/matchKeys.ts', 'app/clickTarget.ts', 'app/main.ts', 'app/eligibility.ts', 'app/matchSetup.ts', 'app/matchWorld.ts', 'app/countrySearch.ts', 'app/landmass.ts', 'app/inventedNames.ts', 'ui/seatLabels.ts', 'ui/flag.ts', 'app/setupScreen.ts', 'app/setupModel.ts', 'app/countryGeo.ts', 'app/cellGeo.ts', 'ui/uiConfig.ts'];

  it('the files exist and hold no string literal with å, ä or ö', () => {
    const offenders: string[] = [];
    for (const rel of PLAYER_FACING) {
      const file = path.join(SRC, rel);
      expect(fs.existsSync(file), rel).toBe(true);
      const code = stripComments(fs.readFileSync(file, 'utf8'));
      for (const m of code.matchAll(/(['"`])(?:(?!\1)[^\\\n]|\\.)*[åäöÅÄÖ](?:(?!\1)[^\\\n]|\\.)*\1/g)) offenders.push(`${rel}: ${m[0].slice(0, 60)}`);
    }
    expect(offenders).toEqual([]);
  });

  it('the comment stripper keeps strings and drops comments', () => {
    expect(stripComments("const a = 'ö'; // ä in a comment\n/* ö */ const b = 1;")).not.toMatch(/ä in a comment|\/\* ö/);
    expect(stripComments("const a = 'ö';")).toContain("'ö'");
  });
});
