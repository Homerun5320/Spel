// Look-2: the VISUAL gold inflation. Only the text changes: every surface that names gold shows the sim amount times GOLD_DISPLAY_FACTOR through
// formatGold / formatGoldRate. This test pins the two functions and scans the UI sources for a t() call that passes a gold placeholder around them.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GOLD_COMPACT_FROM, TABLES, formatGold, formatGoldRate, formatInt, formatShownGold, placeholdersOf, setLanguage } from '../../src/ui/i18n';
import { GOLD_DISPLAY_FACTOR } from '../../src/ui/uiConfig';
import { effectLines } from '../../src/ui/structureInfo';
import { STRUCT_CITY, cityGoldMilli } from '../../src/sim/public';

afterEach(() => setLanguage('sv'));

const NB = '\u00a0';

/** `n` as a whole number with the thousands separator of the language, built here by hand (the reference for formatGold below a million). */
const grouped = (n: number, sep: string): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, sep);
/** Gold per second as a panel shows it in `lang`: sim gold/s times the factor, at most two decimals, trailing zeros dropped (below a million). */
const shownRate = (goldPerSec: number, mark: string): string => String(Math.round(goldPerSec * GOLD_DISPLAY_FACTOR * 100) / 100).replace('.', mark);

describe('formatGold and formatGoldRate', () => {
  it('the factor is one whole number of at least 50 (the user asked for 50 times or more); the sim amount times it, with the thousands separator of the language', () => {
    expect(Number.isInteger(GOLD_DISPLAY_FACTOR)).toBe(true);
    expect(GOLD_DISPLAY_FACTOR).toBeGreaterThanOrEqual(50);
    // every case stays below the compact threshold for any factor up to 1 000
    for (const sim of [0, 1, 7, 12.5, 400, 501, 600]) {
      const shown = sim * GOLD_DISPLAY_FACTOR;
      expect(shown).toBeLessThan(GOLD_COMPACT_FROM);
      setLanguage('sv');
      expect(formatGold(sim)).toBe(grouped(Math.round(shown), '\u00a0'));
      setLanguage('en');
      expect(formatGold(sim)).toBe(grouped(Math.round(shown), ','));
    }
    setLanguage('sv');
    expect(formatGold(0)).toBe('0');
    expect(formatGold(12.5)).toBe(formatInt(12.5 * GOLD_DISPLAY_FACTOR));
  });
  it('gold per second keeps up to two decimals, no trailing zeros, in the language decimal mark', () => {
    // sim milli-gold per second: the City 1,5 gold/s, City level 2 1,875, a tenth, a twentieth, a Factory 2,5, nothing
    for (const milli of [1500, 1875, 100, 50, 2500, 0, 1]) {
      setLanguage('en');
      expect(formatGoldRate(milli)).toBe(shownRate(milli / 1000, '.'));
      setLanguage('sv');
      expect(formatGoldRate(milli)).toBe(shownRate(milli / 1000, ','));
    }
  });
  it('a City effect line reads the inflated gold per second of the sim', () => {
    setLanguage('en');
    const line = effectLines(STRUCT_CITY, 1)[0];
    expect(line?.params.gold).toBe(formatGoldRate(cityGoldMilli(1)));
    expect(line?.params.gold).toBe(shownRate(cityGoldMilli(1) / 1000, '.'));
  });
});

describe('formatShownGold: thousands below a million, compact from a million (at most 3 significant digits, cut not rounded)', () => {
  const cases: ReadonlyArray<readonly [number, string, string]> = [
    // displayed amount, Swedish, English
    [0, '0', '0'],
    [999, '999', '999'],
    [1000, `1${NB}000`, '1,000'],
    [25050, `25${NB}050`, '25,050'],
    [999999, `999${NB}999`, '999,999'],
    [1000000, `1${NB}mn`, '1M'],
    [1200000, `1,2${NB}mn`, '1.2M'],
    [1234567, `1,23${NB}mn`, '1.23M'],
    [12345678, `12,3${NB}mn`, '12.3M'],
    [123456789, `123${NB}mn`, '123M'],
    [999999999, `999${NB}mn`, '999M'], // never "1000 mn"
    [1000000000, `1${NB}mdr`, '1B'],
    [1234567890, `1,23${NB}mdr`, '1.23B'],
    [3400000000, `3,4${NB}mdr`, '3.4B'],
    [49950000, `49,9${NB}mn`, '49.9M'],
    [49950000000, `49,9${NB}mdr`, '49.9B'],
    [999999999999, `999${NB}mdr`, '999B'],
    [1000000000000, `1${NB}bn`, '1T'],
    [-1234567, `-1,23${NB}mn`, '-1.23M'],
    [-999, '-999', '-999'],
  ];
  for (const [value, sv, en] of cases) {
    it(`${value}`, () => {
      setLanguage('sv');
      expect(formatShownGold(value)).toBe(sv);
      setLanguage('en');
      expect(formatShownGold(value)).toBe(en);
    });
  }
  it('formatGold feeds it the sim amount times the factor (a level-999 Silo costs 1 000 x 999 = 999 000 gold in the sim)', () => {
    for (const lang of ['sv', 'en'] as const) {
      setLanguage(lang);
      expect(formatGold(999000)).toBe(formatShownGold(999000 * GOLD_DISPLAY_FACTOR));
      expect(formatGold(999000 * 1000)).toBe(formatShownGold(999000 * 1000 * GOLD_DISPLAY_FACTOR));
    }
    // the switch to the compact form sits at the shown amount GOLD_COMPACT_FROM, whatever the factor
    const firstCompact = Math.ceil(GOLD_COMPACT_FROM / GOLD_DISPLAY_FACTOR);
    setLanguage('en');
    expect(formatGold(firstCompact - 1)).toBe(formatInt((firstCompact - 1) * GOLD_DISPLAY_FACTOR));
    expect(formatGold(firstCompact - 1)).toMatch(/^\d{1,3}(,\d{3})*$/);
    expect(formatGold(firstCompact)).toMatch(/^\d{1,3}(\.\d{1,2})?M$/);
    setLanguage('sv');
    expect(formatGold(firstCompact)).toMatch(/^\d{1,3}(,\d{1,2})?\u00a0mn$/);
  });
  it('no compact text has more than 3 significant digits', () => {
    for (const lang of ['sv', 'en'] as const) {
      setLanguage(lang);
      for (let v = 1_000_000; v < 4e12; v = Math.floor(v * 1.37) + 11) {
        const digits = formatShownGold(v).replace(/[^0-9]/g, '').replace(/^0+/, '');
        expect(digits.length, `${lang} ${v} -> ${formatShownGold(v)}`).toBeLessThanOrEqual(3);
      }
    }
  });
});

const GOLD_PLACEHOLDERS = ['price', 'gold', 'rate'];

function sources(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sources(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('no surface bypasses the gold formatter', () => {
  it('every t(key, { price | gold | rate: ... }) of a key with a gold placeholder passes the value through formatGold, formatGoldRate or a named alias', () => {
    const root = path.resolve(__dirname, '../../src');
    const files = [...sources(path.join(root, 'ui')), ...sources(path.join(root, 'app'))].filter((f) => !f.endsWith('i18n.ts'));
    let checked = 0;
    for (const f of files) {
      const text = fs.readFileSync(f, 'utf8');
      const re = /\bt\(\s*(?:'([a-zA-Z0-9_.]+)'|[^,)']*\?\s*'([a-zA-Z0-9_.]+)'\s*:\s*'([a-zA-Z0-9_.]+)')\s*,\s*\{([^}]*)\}/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const keys = [m[1], m[2], m[3]].filter((k): k is string => k !== undefined);
        const body = m[4] as string;
        for (const key of keys) {
          const sv = TABLES.sv[key];
          if (sv === undefined) continue;
          for (const ph of placeholdersOf(sv)) {
            if (!GOLD_PLACEHOLDERS.includes(ph)) continue;
            const value = new RegExp(`\\b${ph}\\s*:\\s*([^,]+)`).exec(body)?.[1] ?? '';
            checked++;
            expect(value, `${path.relative(root, f)}: t('${key}') passes {${ph}} as "${value}"`).toMatch(/formatGold|formatGoldRate|shownPrice|\bgold\(/);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(8);
  });

  it('the purse and the income of the HUD use the formatter', () => {
    const hud = fs.readFileSync(path.resolve(__dirname, '../../src/ui/matchHud.ts'), 'utf8');
    expect(hud).toMatch(/hud-gold'[^\n]*formatGold\(a\)/);
    expect(hud).toMatch(/hud\.goldRate', \{ rate: formatGoldRate\(a\) \}/);
  });
});
