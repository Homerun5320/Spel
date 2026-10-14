// Plural-aware counts and the refusal sentences of the setup (M06fix 4b and 4e): "1 cell", never "1 celler"; every reason starts with a capital
// letter and a subject and ends with a full stop, in both languages.
import { afterEach, describe, expect, it } from 'vitest';
import { TABLES, setLanguage, setStrictI18n, t, tn, type TextKey } from '../src/ui/i18n';

afterEach(() => {
  setLanguage('sv');
  setStrictI18n(false);
});

describe('tn', () => {
  it('one is the singular text, every other count (0, 2, 197, 1000) the plural one, in both languages', () => {
    setLanguage('sv');
    expect(tn('setup.cells', 'setup.cells.one', 1, { cells: 1 })).toBe('1 cell');
    expect(tn('setup.cells', 'setup.cells.one', 0, { cells: 0 })).toBe('0 celler');
    expect(tn('setup.cells', 'setup.cells.one', 2, { cells: 2 })).toBe('2 celler');
    expect(tn('setup.cells', 'setup.cells.one', 197, { cells: 197 })).toBe('197 celler');
    setLanguage('en');
    expect(tn('setup.cells', 'setup.cells.one', 1, { cells: 1 })).toBe('1 cell');
    expect(tn('setup.cells', 'setup.cells.one', 0, { cells: 0 })).toBe('0 cells');
    expect(tn('setup.cells', 'setup.cells.one', 2, { cells: 2 })).toBe('2 cells');
    expect(tn('setup.cells', 'setup.cells.one', 1000, { cells: 1000 })).toBe('1000 cells');
  });

  it('is strict like t(): a missing value throws in test mode', () => {
    setStrictI18n(true);
    expect(() => tn('setup.cells', 'setup.cells.one', 1)).toThrow(/needs the value \{cells\}/);
  });

  it('the singular exists in both tables with the same placeholder as the plural', () => {
    for (const lang of ['sv', 'en'] as const) {
      expect(TABLES[lang]['setup.cells.one'], lang).toMatch(/\{cells\}/);
      expect(TABLES[lang]['setup.cells'], lang).toMatch(/\{cells\}/);
    }
  });
});

describe('the reasons a country or a start place is refused', () => {
  const REASONS: TextKey[] = ['setup.reason.tooFewCells', 'setup.reason.smallLandmass', 'setup.reason.noCapitalLand', 'setup.reason.outsideRegion', 'setup.reason.excluded', 'setup.error.nameTaken'];

  it('each starts with a capital letter, ends with a full stop, and is a sentence with a subject (not a bare predicate)', () => {
    for (const lang of ['sv', 'en'] as const) {
      for (const key of REASONS) {
        const text = TABLES[lang][key] as string;
        expect(text.charAt(0), `${lang} ${key}`).toBe(text.charAt(0).toUpperCase());
        expect(text.charAt(0), `${lang} ${key}`).not.toBe(text.charAt(0).toLowerCase());
        expect(text.endsWith('.'), `${lang} ${key}`).toBe(true);
      }
    }
  });

  it('the land mass reason names its subject in both languages', () => {
    setLanguage('sv');
    expect(t('setup.reason.smallLandmass', { cells: 12, need: 197 })).toBe('Landmassan är för liten för en rättvis start: 12 av 197 celler.');
    setLanguage('en');
    expect(t('setup.reason.smallLandmass', { cells: 12, need: 197 })).toBe('The land mass is too small for a fair start: 12 of 197 cells.');
  });
});
