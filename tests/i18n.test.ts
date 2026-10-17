// i18n (CHARTER invariant 10): both tables hold the same keys and the same placeholders, every key is used, every `t('...')` in
// the source names a real key, a missing key fails in strict (test) mode, and no player-facing file hides a Swedish string
// outside the tables.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TECH_BRANCHES, TECH_COUNT, TECH_FX_CHANNELS } from '../src/sim/rules';
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

const KEY_LITERAL = /'((?:app|start|help|hotkey|hud|phase|reject|toast|tooltip|class|setup|sel|win|pause|result|elim|spectator|deploy|heli|diplo|tech)\.[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)?)'/g;

describe('the source and the tables agree', () => {
  const files = listTs(SRC).filter((f) => !/i18n(\.(sv|en))?\.ts$/.test(f));
  const used = new Map<string, string>();
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    for (const m of text.matchAll(KEY_LITERAL)) used.set(m[1] as string, path.relative(SRC, f));
  }
  // Fix-5A2: the tech-tree text keys are DERIVED from the counts of rules.ts in src/ui/techModel.ts (no literal per key); the families are known here, and
  // tests/ui/techKeys.test.ts checks that exactly TECH_COUNT / TECH_BRANCHES / TECH_FX_CHANNELS keys of each family exist (no dead 'tech.name.16').
  for (const [family, n] of [['tech.name.', TECH_COUNT], ['tech.branch.', TECH_BRANCHES], ['tech.fx.', TECH_FX_CHANNELS]] as const) {
    for (let i = 0; i < n; i++) used.set(`${family}${i}`, 'ui/techModel.ts');
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
  // The Dev panel, the perf overlay and its report, the report modal and the debug pages are developer tools, Swedish only (D98). Fix-4B: the files are DISCOVERED (every .ts under
  // src/ui and src/app that is not on this explicit list of developer tools (the Dev panel and its mode registry `modes.ts`, the perf and debug files, the report) and of the translation tables themselves), so a new file is covered by default.
  const DEV_TOOLS = /^(?:app\/(?:devpanel|modes|debug[A-Za-z]*|perf[A-Za-z]*|probe[A-Za-z]*)\.ts|ui\/(?:perf[A-Za-z]*|report|debug[A-Za-z]*|probe[A-Za-z]*)\.ts)$/;
  /** The translation tables hold the Swedish text on purpose. */
  const TABLE_FILES = new Set(['ui/i18n.ts', 'ui/i18n.sv.ts', 'ui/i18n.en.ts']);
  const discover = (): string[] => {
    const found: string[] = [];
    for (const dir of ['ui', 'app']) {
      for (const f of fs.readdirSync(path.join(SRC, dir))) {
        const rel = `${dir}/${f}`;
        if (f.endsWith('.ts') && !f.endsWith('.d.ts') && !DEV_TOOLS.test(rel) && !TABLE_FILES.has(rel)) found.push(rel);
      }
    }
    return found.sort();
  };
  // The list of the earlier passes stays as a floor: the discovery may never find fewer files than these.
  const PLAYER_FACING = ['ui/matchHud.ts', 'ui/startScreen.ts', 'ui/hudLogic.ts', 'ui/hudStyle.ts', 'ui/clickTracker.ts', 'ui/hudValues.ts', 'app/tooltip.ts', 'app/globeApp.ts', 'app/match.ts', 'app/matchKeys.ts', 'app/clickTarget.ts', 'app/main.ts', 'app/eligibility.ts', 'app/matchSetup.ts', 'app/matchWorld.ts', 'app/countrySearch.ts', 'app/landmass.ts', 'app/inventedNames.ts', 'ui/seatLabels.ts', 'ui/flag.ts', 'app/setupScreen.ts', 'app/setupModel.ts', 'app/countryGeo.ts', 'app/cellGeo.ts', 'ui/uiConfig.ts',
    // Fix-3C: the files added since (match flow, city view, build UI)
    'ui/matchPanels.ts', 'ui/matchFlow.ts', 'ui/cityViewPanel.ts', 'ui/cityViewModel.ts', 'ui/structureInfo.ts', 'ui/selectionPanel.ts', 'ui/buildBar.ts', 'ui/buildReasons.ts', 'ui/toast.ts', 'ui/gpuTip.ts', 'app/winSetup.ts', 'app/cityViewMode.ts', 'app/placement.ts', 'app/structureSelect.ts',
  ];
  /** The code of a file without comments, and every string literal in it that holds å, ä or ö. */
  const offendersIn = (rel: string, text: string): string[] => {
    const out: string[] = [];
    const code = stripComments(text);
    for (const m of code.matchAll(/(['"`])(?:(?!\1)[^\\\n]|\\.)*[åäöÅÄÖ](?:(?!\1)[^\\\n]|\\.)*\1/g)) out.push(`${rel}: ${m[0].slice(0, 60)}`);
    return out;
  };

  it('every .ts under src/ui and src/app except the developer tools and the tables is covered, and the covered set includes every file of the earlier list', () => {
    const files = discover();
    for (const rel of PLAYER_FACING) expect(files, rel).toContain(rel);
    for (const rel of ['ui/deployBox.ts', 'ui/heliInfo.ts', 'ui/helpOverlay.ts', 'ui/winMeter.ts', 'ui/diploReasons.ts', 'ui/hudGate.ts', 'ui/beachheadInfo.ts', 'app/hotkeys.ts', 'app/commandResolver.ts', 'app/deployMode.ts', 'app/launchPreview.ts']) expect(files, rel).toContain(rel);
    for (const rel of ['ui/i18n.ts', 'app/devpanel.ts', 'app/modes.ts', 'ui/perfOverlay.ts', 'ui/report.ts', 'app/debugSim.ts', 'app/perfScene.ts']) expect(files, rel).not.toContain(rel);
    expect(files.length).toBeGreaterThan(55);
  });

  it('the covered files hold no string literal with å, ä or ö', () => {
    const offenders: string[] = [];
    for (const rel of discover()) offenders.push(...offendersIn(rel, fs.readFileSync(path.join(SRC, rel), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('the scan finds a Swedish literal in a file nobody listed (mutant: the literal check is dropped), in all three quote styles, and ignores a comment', () => {
    expect(offendersIn('ui/new.ts', "export const a = 'Avbryt flygningen på riktigt';").length).toBe(1);
    expect(offendersIn('ui/new.ts', 'export const a = "Skicka";\nexport const b = "Välj mål";').length).toBe(1);
    expect(offendersIn('ui/new.ts', 'export const a = `Hög ${1}`;').length).toBe(1);
    expect(offendersIn('ui/new.ts', "// på riktigt\n/* Välj */ export const a = 'x';").length).toBe(0);
  });

  it('the comment stripper keeps strings and drops comments', () => {
    expect(stripComments("const a = 'ö'; // ä in a comment\n/* ö */ const b = 1;")).not.toMatch(/ä in a comment|\/\* ö/);
    expect(stripComments("const a = 'ö';")).toContain("'ö'");
  });
});
