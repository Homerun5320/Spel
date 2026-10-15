import { describe, expect, it } from 'vitest';
import { clearDevModes, devModes, hashAfterMode, modeActive, registerDevMode } from '../src/app/devpanel';
import { registerAppModes } from '../src/app/modes';
import { adaptiveEnabled, parseAppState, parseHash, parseParams, parseQuery, parseRaw, parseSceneParams, toHash, toQuery } from '../src/app/params';

describe('hash grammar (one parser for location.search and location.hash)', () => {
  it('the examples of the prompt: #perf, #scene-perf, #scenario-slice_sam-1, #view-alps-valley, #seed-7', () => {
    expect(parseHash('#perf')).toEqual({ perf: '1' });
    expect(parseHash('#scene-perf')).toEqual({ scene: 'perf' });
    expect(parseHash('#scenario-slice_sam-1')).toEqual({ scenario: 'slice', sam: '1' });
    expect(parseHash('#view-alps-valley')).toEqual({ view: 'alps-valley' });
    expect(parseHash('#seed-7')).toEqual({ seed: '7' });
    // the same through the query parser
    expect(parseQuery('?perf=1')).toEqual({ perf: '1' });
    expect(parseQuery('?scenario=slice&sam=1')).toEqual({ scenario: 'slice', sam: '1' });
  });

  it('splits at the FIRST hyphen only; a bare key means key=1; the leading # is optional', () => {
    expect(parseHash('a-b-c-d')).toEqual({ a: 'b-c-d' });
    expect(parseHash('seed--7')).toEqual({ seed: '-7' });
    expect(parseHash('x.y~z-1.5')).toEqual({ 'x.y~z': '1.5' });
    expect(parseHash('')).toEqual({});
    expect(parseHash('#')).toEqual({});
  });

  it('ignores tokens with characters outside A-Za-z0-9 - . _ ~ and tokens without a key or value', () => {
    expect(parseHash('#perf_a/b_seed-7')).toEqual({ perf: '1', seed: '7' });
    expect(parseHash('#%20perf')).toEqual({});
    expect(parseHash('#-x_y-_z')).toEqual({ z: '1' });
    expect(parseHash('#perf__seed-7_')).toEqual({ perf: '1', seed: '7' });
  });

  it('a key in both query and hash takes the hash value; other keys of the query stay', () => {
    expect(parseRaw('?perf=0&quality=low', '#perf')).toEqual({ perf: '1', quality: 'low' });
    expect(parseRaw('?seed=3', '#seed-9')).toEqual({ seed: '9' });
    expect(parseParams('?seed=3', '#seed-9').seed).toBe(9);
    expect(parseParams('?test=1', '').test).toBe(true);
    expect(parseParams('', '#test').test).toBe(true);
    expect(parseSceneParams('?scene=spike', '#scene-globe').scene).toBe('globe');
    expect(parseSceneParams('', '#scene-spike_quality-high')).toEqual({ scene: 'spike', quality: 'high' });
  });

  it('parseAppState carries perf, the Dev button flag and the raw pairs', () => {
    const s = parseAppState('?test=1', '#perf_devbtn');
    expect(s.perf).toBe(true);
    expect(s.devButton).toBe(true);
    expect(s.params.test).toBe(true);
    expect(s.raw).toEqual({ test: '1', perf: '1', devbtn: '1' });
    expect(parseAppState('?perf=1', '#perf-0').perf).toBe(false);
    expect(parseAppState('', '').perf).toBe(false);
  });

  it('toHash and toQuery round-trip through the parsers', () => {
    const p = { scene: 'spike', quality: 'high', perf: '1', view: 'alps-valley' };
    expect(parseHash(toHash(p))).toEqual(p);
    expect(parseQuery(toQuery(p))).toEqual(p);
    expect(toHash({ perf: '1' })).toBe('perf');
    expect(toHash({ scenario: 'slice', sam: '1' })).toBe('scenario-slice_sam');
    expect(() => toHash({ a: 'x_y' })).toThrow();
    expect(() => toHash({ a: '' })).toThrow();
  });
});

describe('registered ? modes', () => {
  it('the parser gives an identical result for the ?query form and the #hash form of every registered mode', () => {
    clearDevModes();
    registerAppModes();
    const withParams = devModes().filter((m) => m.params);
    expect(withParams.map((m) => m.id)).toEqual(expect.arrayContaining(['perf', 'test', 'scene-spike', 'quality-high', 'seed-7']));
    for (const m of withParams) {
      const fromQuery = parseAppState(`?${toQuery(m.params ?? {})}`, '');
      const fromHash = parseAppState('', `#${toHash(m.params ?? {})}`);
      expect(fromHash, m.id).toEqual(fromQuery);
      expect(parseRaw(`?${toQuery(m.params ?? {})}`, ''), m.id).toEqual(parseRaw('', `#${toHash(m.params ?? {})}`));
    }
  });

  it('perf is registered with the relative link ./debug/data.html next to it, never an absolute path', () => {
    clearDevModes();
    registerAppModes();
    expect(devModes().find((m) => m.id === 'perf')?.params).toEqual({ perf: '1' });
    expect(devModes().find((m) => m.href)?.href).toBe('./debug/data.html');
    expect(() => registerDevMode({ id: 'bad', label: 'x', href: '/debug/data.html' })).toThrow(/relative/);
    expect(() => registerDevMode({ id: 'empty', label: 'x' })).toThrow();
  });

  it('choosing a mode writes the hash; a toggle mode that is active writes key-0 (the query cannot be edited)', () => {
    clearDevModes();
    registerAppModes();
    const perf = devModes().find((m) => m.id === 'perf');
    if (!perf) throw new Error('perf mode missing');
    expect(modeActive(perf, {})).toBe(false);
    expect(hashAfterMode(perf, '', {})).toBe('perf');
    expect(hashAfterMode(perf, '#quality-low', { quality: 'low' })).toBe('quality-low_perf');
    expect(modeActive(perf, { perf: '1' })).toBe(true);
    expect(hashAfterMode(perf, '#perf', { perf: '1' })).toBe('perf-0');
    // active through the query only: the hash gets perf-0, which wins
    expect(hashAfterMode(perf, '', { perf: '1' })).toBe('perf-0');
    expect(parseAppState('?perf=1', `#${hashAfterMode(perf, '', { perf: '1' })}`).perf).toBe(false);
  });
});

describe('the adaptive resolution default (Fix-UI)', () => {
  it('is on in the live game, off in test mode, in the performance scene and with the plain #perf overlay; adapt=1 and adapt=0 always win', () => {
    const on = (search: string, hash = ''): boolean => adaptiveEnabled(parseAppState(search, hash));
    expect(on('', '')).toBe(true);
    expect(on('', '#perf')).toBe(false); // raw speed, as docs/PREVIEW.md says
    expect(on('', '#scene-perf')).toBe(false);
    expect(on('?test=1')).toBe(false);
    expect(on('', '#perf_adapt-1')).toBe(true);
    expect(on('?test=1&adapt=1')).toBe(true);
    expect(on('', '#adapt-0')).toBe(false);
  });
});
