import { describe, expect, it } from 'vitest';
import { clearDevModes, devModes, hashAfterMode, modeActive } from '../src/app/devpanel';
import { registerAppModes } from '../src/app/modes';
import { parseAppState, parseHash, parseTerrainParams, toHash, toQuery } from '../src/app/params';
import { resolveQuality } from '../src/render/quality';

describe('terrain parameters (M07a): one parser for the query and the hash', () => {
  it('chunks is the default; ?terrain=fixed and #terrain-fixed select the old fixed mesh; ?chunks=1 and #chunks colour the chunks', () => {
    expect(parseTerrainParams('')).toEqual({ terrain: 'chunks', chunkDebug: false, chunkTier: null });
    expect(parseTerrainParams('?terrain=fixed').terrain).toBe('fixed');
    expect(parseTerrainParams('', '#terrain-fixed').terrain).toBe('fixed');
    expect(parseTerrainParams('?terrain=nonsense').terrain).toBe('chunks');
    expect(parseTerrainParams('?chunks=1').chunkDebug).toBe(true);
    expect(parseTerrainParams('', '#chunks').chunkDebug).toBe(true);
    expect(parseTerrainParams('?chunks=1', '#chunks-0').chunkDebug).toBe(false); // the hash wins, `chunks-0` switches it off
    expect(parseTerrainParams('', '#terrain-fixed_chunks')).toEqual({ terrain: 'fixed', chunkDebug: true, chunkTier: null });
    expect(parseAppState('?test=1', '#terrain-fixed').terrain.terrain).toBe('fixed');
    expect(parseHash('#terrain-fixed')).toEqual({ terrain: 'fixed' });
    expect(parseHash('#chunks')).toEqual({ chunks: '1' });
  });

  it('the dev modes terrain-fixed, terrain-chunks and chunks are registered and parse identically from ?query and #hash', () => {
    clearDevModes();
    registerAppModes();
    const byId = new Map(devModes().map((m) => [m.id, m]));
    for (const id of ['terrain-fixed', 'terrain-chunks', 'chunks', 'chunktier-high']) expect(byId.has(id), id).toBe(true);
    for (const id of ['terrain-fixed', 'terrain-chunks', 'chunks', 'chunktier-high']) {
      const params = byId.get(id)?.params ?? {};
      expect(parseAppState(`?${toQuery(params)}`, '').terrain, id).toEqual(parseAppState('', `#${toHash(params)}`).terrain);
    }
    expect(toHash(byId.get('terrain-fixed')?.params ?? {})).toBe('terrain-fixed');
    expect(toHash(byId.get('chunks')?.params ?? {})).toBe('chunks');
  });

  it('the chunks colouring is a toggle in the Dev panel: choosing it again switches it off (chunks-0 in the hash)', () => {
    clearDevModes();
    registerAppModes();
    const m = devModes().find((x) => x.id === 'chunks');
    expect(m).toBeDefined();
    if (!m) return;
    expect(modeActive(m, { chunks: '1' })).toBe(true);
    expect(hashAfterMode(m, '', {})).toBe('chunks');
    expect(hashAfterMode(m, '#chunks', { chunks: '1' })).toBe('chunks-0');
  });

  it('chunktier gives the test tier the chunk density of another tier and nothing else (MSAA off, DPR 1 stay)', () => {
    const high = resolveQuality({ test: true, quality: null, chunkTier: 'high' });
    expect(high.tier).toBe('test');
    expect(high.chunkMax).toBe(400);
    expect(high.chunkCells).toBe(32);
    expect([high.antialias, high.maxDpr]).toEqual([false, 1]);
    expect(resolveQuality({ test: true, quality: null, chunkTier: 'nonsense' }).chunkMax).toBe(resolveQuality({ test: true, quality: null }).chunkMax);
    expect(resolveQuality({ test: false, quality: 'low', chunkTier: 'high' }).chunkMax).toBe(resolveQuality({ test: false, quality: 'low' }).chunkMax); // outside test mode it is ignored
  });
});
