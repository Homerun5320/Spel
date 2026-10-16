// Look-2: the VISUAL gold inflation. Only the text changes: every surface that names gold shows the sim amount times GOLD_DISPLAY_FACTOR through
// formatGold / formatGoldRate. This test pins the two functions and scans the UI sources for a t() call that passes a gold placeholder around them.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TABLES, formatGold, formatGoldRate, placeholdersOf, setLanguage } from '../../src/ui/i18n';
import { GOLD_DISPLAY_FACTOR } from '../../src/ui/uiConfig';
import { effectLines } from '../../src/ui/structureInfo';
import { STRUCT_CITY, cityGoldMilli } from '../../src/sim/public';

afterEach(() => setLanguage('sv'));

describe('formatGold and formatGoldRate', () => {
  it('multiply by the factor, with the thousands separator of the language', () => {
    expect(GOLD_DISPLAY_FACTOR).toBe(10);
    setLanguage('sv');
    expect(formatGold(400)).toMatch(/^4\s000$/);
    setLanguage('en');
    expect(formatGold(400)).toBe('4,000');
    expect(formatGold(0)).toBe('0');
    expect(formatGold(12.5)).toBe('125');
  });
  it('gold per second keeps up to two decimals, no trailing zeros, in the language decimal mark', () => {
    setLanguage('en');
    expect(formatGoldRate(500)).toBe('5');
    expect(formatGoldRate(50)).toBe('0.5');
    expect(formatGoldRate(25)).toBe('0.25');
    expect(formatGoldRate(12500)).toBe('125');
    expect(formatGoldRate(0)).toBe('0');
    setLanguage('sv');
    expect(formatGoldRate(50)).toBe('0,5');
  });
  it('a City effect line reads the inflated gold per second of the sim', () => {
    setLanguage('en');
    const line = effectLines(STRUCT_CITY, 1)[0];
    expect(line?.params.gold).toBe(formatGoldRate(cityGoldMilli(1)));
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
