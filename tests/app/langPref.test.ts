// The language preference (M06fix 4c): the address wins and is not remembered, a change by the player is remembered, test mode is untouched,
// a stored value that is not a language is ignored. (Node has no localStorage: the preferences live in their memory fallback here.)
import { afterEach, describe, expect, it } from 'vitest';
import { LANG_PREF_KEY, applyStartLanguage, startLanguage } from '../../src/app/langPref';
import { getPref, setPref } from '../../src/app/prefs';
import { getLanguage, setLanguage } from '../../src/ui/i18n';

afterEach(() => {
  setPref(LANG_PREF_KEY, 'sv');
  setLanguage('sv');
});

describe('startLanguage', () => {
  it('is Swedish when nothing is stored and the address says nothing', () => {
    setPref(LANG_PREF_KEY, 'sv');
    expect(startLanguage({}, false)).toBe('sv');
  });

  it('is the stored language when the address says nothing', () => {
    setPref(LANG_PREF_KEY, 'en');
    expect(startLanguage({}, false)).toBe('en');
  });

  it('the address wins over the stored language', () => {
    setPref(LANG_PREF_KEY, 'en');
    expect(startLanguage({ lang: 'sv' }, false)).toBe('sv');
    setPref(LANG_PREF_KEY, 'sv');
    expect(startLanguage({ lang: 'en' }, false)).toBe('en');
  });

  it('a stored value that is not a language is ignored', () => {
    setPref(LANG_PREF_KEY, 'de');
    expect(startLanguage({}, false)).toBe('sv');
    setPref(LANG_PREF_KEY, 42);
    expect(startLanguage({}, false)).toBe('sv');
  });

  it('test mode ignores the stored language (a test page is Swedish unless its address says otherwise)', () => {
    setPref(LANG_PREF_KEY, 'en');
    expect(startLanguage({}, true)).toBe('sv');
    expect(startLanguage({ lang: 'en' }, true)).toBe('en');
  });
});

describe('applyStartLanguage', () => {
  it('sets the language, remembers a later change and stops remembering when stopped', () => {
    setPref(LANG_PREF_KEY, 'en');
    const stop = applyStartLanguage({}, false);
    expect(getLanguage()).toBe('en');
    setLanguage('sv');
    expect(getPref(LANG_PREF_KEY, 'x')).toBe('sv');
    setLanguage('en');
    expect(getPref(LANG_PREF_KEY, 'x')).toBe('en');
    stop();
    setLanguage('sv');
    expect(getPref(LANG_PREF_KEY, 'x')).toBe('en');
  });

  it('an address language is applied but not remembered until the player changes it', () => {
    setPref(LANG_PREF_KEY, 'sv');
    const stop = applyStartLanguage({ lang: 'en' }, false);
    expect(getLanguage()).toBe('en');
    expect(getPref(LANG_PREF_KEY, 'x')).toBe('sv');
    stop();
  });

  it('test mode writes nothing', () => {
    setPref(LANG_PREF_KEY, 'sv');
    const stop = applyStartLanguage({}, true);
    setLanguage('en');
    expect(getPref(LANG_PREF_KEY, 'x')).toBe('sv');
    stop();
  });
});
