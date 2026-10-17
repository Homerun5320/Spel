// Look-1: the City style setting: the address wins, then the stored choice, then 'old'; test mode ignores the store; the hash grammar carries it.
import { beforeEach, describe, expect, it } from 'vitest';
import { CITY_STYLE_PREF_KEY, rememberCityStyle, startCityStyle } from '../../src/app/cityStyle';
import { parseRaw } from '../../src/app/params';
import { getPref } from '../../src/app/prefs';

beforeEach(() => {
  rememberCityStyle('old', false);
});

describe('the City style setting', () => {
  it('defaults to old and reads the address in query and hash form', () => {
    expect(startCityStyle({}, false)).toBe('old');
    expect(startCityStyle(parseRaw('?citystyle=new'), false)).toBe('new');
    expect(startCityStyle(parseRaw('', '#citystyle-new'), true)).toBe('new');
    expect(startCityStyle(parseRaw('?citystyle=gothic'), false)).toBe('old');
  });
  it('remembers a choice, the address still wins, and test mode neither reads nor writes it', () => {
    rememberCityStyle('new', false);
    expect(getPref(CITY_STYLE_PREF_KEY, 'x')).toBe('new');
    expect(startCityStyle({}, false)).toBe('new');
    expect(startCityStyle({ citystyle: 'old' }, false)).toBe('old');
    expect(startCityStyle({}, true)).toBe('old');
    rememberCityStyle('old', true);
    expect(getPref(CITY_STYLE_PREF_KEY, 'x')).toBe('new');
  });
});
