import { describe, expect, it } from 'vitest';
import { clearDevModes, devModes } from '../src/app/devpanel';
import { registerAppModes } from '../src/app/modes';
import { GROUND_VIEW_NAMES, parseAppState, parseHash, parseViewParam, toHash, toQuery } from '../src/app/params';

describe('the ground views (M07a): ?view=alps-valley and #view-alps-valley through the one parser', () => {
  it('both names parse from the query and from the hash; an unknown name is ignored; the hash wins', () => {
    expect(GROUND_VIEW_NAMES).toEqual(['alps-valley', 'himalaya-valley']);
    for (const name of GROUND_VIEW_NAMES) {
      expect(parseViewParam(`?view=${name}`)).toBe(name);
      expect(parseViewParam('', `#view-${name}`)).toBe(name);
      expect(parseAppState('?test=1', `#view-${name}`).view).toBe(name);
    }
    expect(parseViewParam('')).toBeNull();
    expect(parseViewParam('?view=nowhere')).toBeNull();
    expect(parseViewParam('?view=alps-valley', '#view-himalaya-valley')).toBe('himalaya-valley');
    expect(parseHash('#view-himalaya-valley')).toEqual({ view: 'himalaya-valley' });
    expect(parseHash('#test_view-alps-valley')).toEqual({ test: '1', view: 'alps-valley' });
  });

  it('the two views are Dev panel modes whose params give the very hash and query of the address table', () => {
    clearDevModes();
    registerAppModes();
    const byId = new Map(devModes().map((m) => [m.id, m]));
    for (const name of GROUND_VIEW_NAMES) {
      const mode = byId.get(`view-${name}`);
      expect(mode, name).toBeDefined();
      const params = mode?.params ?? {};
      expect(toHash(params)).toBe(`view-${name}`);
      expect(toQuery(params)).toBe(`view=${name}`);
      expect(parseAppState(`?${toQuery(params)}`, '').view).toBe(name);
      expect(parseAppState('', `#${toHash(params)}`).view).toBe(name);
    }
  });
});
