// Fix-5A2 (audit 4, finding 1.2): ONE guard for the tech tree's parallel places. When TECH_COUNT or TECH_BRANCHES grows in rules.ts, this fails until every place has
// its entry: the text keys in both languages (names, branch names, effect lines), a column colour per branch, and a slot for every branch in each AI research order.
import { describe, expect, it } from 'vitest';
import { RESEARCH_ORDERS } from '../../src/ai/research';
import { TECH_BRANCHES, TECH_COUNT, TECH_FX_CHANNELS, TECH_STEPS } from '../../src/sim/rules';
import { TECH_ALL_MASK, techBranchOf } from '../../src/sim/techTable';
import { TABLES, LANGUAGES } from '../../src/ui/i18n';
import { TECH_BRANCH_KEYS, TECH_FX_KEYS, TECH_NAME_KEYS } from '../../src/ui/techModel';
import { TECH_UI } from '../../src/ui/uiConfig';

describe('the tech tree has an entry in every parallel place', () => {
  it('the tree fits the 31-bit mask and its layout is branches x steps', () => {
    expect(TECH_COUNT).toBeLessThanOrEqual(31);
    expect(TECH_COUNT).toBe(TECH_BRANCHES * TECH_STEPS);
    expect(TECH_ALL_MASK).toBe(2 ** TECH_COUNT - 1);
  });

  it('every tech, branch and effect channel has a text in both languages (derived key lists, not hand-written ones)', () => {
    expect(TECH_NAME_KEYS.length).toBe(TECH_COUNT);
    expect(TECH_BRANCH_KEYS.length).toBe(TECH_BRANCHES);
    expect(TECH_FX_KEYS.length).toBe(TECH_FX_CHANNELS);
    for (const lang of LANGUAGES) {
      const table = TABLES[lang];
      for (let n = 0; n < TECH_COUNT; n++) {
        const key = TECH_NAME_KEYS[n] as string;
        expect(key, `tech ${n}`).toBe(`tech.name.${n}`);
        expect(table[key], `${lang} ${key}`).toBeTypeOf('string');
        expect((table[key] as string).length, `${lang} ${key}`).toBeGreaterThan(0);
      }
      // no dead key beyond the counts (tests/i18n.test.ts trusts the three families)
      for (const [family, n] of [['tech.name.', TECH_COUNT], ['tech.branch.', TECH_BRANCHES], ['tech.fx.', TECH_FX_CHANNELS]] as const) {
        const dead = Object.keys(table).filter((k) => k.startsWith(family) && Number(k.slice(family.length)) >= n);
        expect(dead, `${lang} ${family}`).toEqual([]);
      }
      for (let b = 0; b < TECH_BRANCHES; b++) expect(table[TECH_BRANCH_KEYS[b] as string], `${lang} branch ${b}`).toBeTypeOf('string');
      for (let c = 0; c < TECH_FX_CHANNELS; c++) expect(table[TECH_FX_KEYS[c] as string], `${lang} effect ${c}`).toContain('{n}');
    }
  });

  it('every branch has a column colour', () => {
    for (let b = 0; b < TECH_BRANCHES; b++) expect(TECH_UI.branch[b], `branch ${b}`).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('every branch is in each AI research order exactly once, and every tech belongs to a branch', () => {
    for (const [name, order] of Object.entries(RESEARCH_ORDERS)) {
      expect([...order].sort((a, b) => a - b), name).toEqual(Array.from({ length: TECH_BRANCHES }, (_, b) => b));
    }
    for (let n = 0; n < TECH_COUNT; n++) {
      const b = techBranchOf(n);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(TECH_BRANCHES);
    }
  });
});
