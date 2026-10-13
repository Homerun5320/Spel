import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALLOWED_HOSTS, BlockedError, CACHE_DIR, cachedFetch, neUrl, terrariumUrl } from '../../tools/bake/fetch';
import { MERC_MAX_LAT, MERC_SIZE, resampleToRender, terrariumHeight } from '../../tools/bake/terrarium';
import { RENDER_HEIGHT, RENDER_WIDTH } from '../../src/data/format';

afterEach(() => vi.unstubAllGlobals());

describe('bake fetch', () => {
  it('only the two allowed hosts are used by the URL builders', () => {
    expect(ALLOWED_HOSTS).toEqual(['elevation-tiles-prod.s3.amazonaws.com', 'raw.githubusercontent.com']);
    expect(new URL(terrariumUrl(8, 5)).pathname).toBe('/terrarium/4/8/5.png');
    expect(new URL(neUrl('abc', 'f.geojson')).hostname).toBe('raw.githubusercontent.com');
  });

  it('a blocked host aborts with a clear error and leaves no half file in the cache', async () => {
    vi.stubGlobal('fetch', async () => new Response('denied', { status: 403 }));
    const rel = `ne/blocked-test-${process.pid}/x.geojson`;
    await expect(cachedFetch(neUrl('blocked-test', 'x.geojson'), rel)).rejects.toThrow(/BLOCKED: cannot fetch .*raw\.githubusercontent\.com/);
    await expect(cachedFetch(neUrl('blocked-test', 'x.geojson'), rel)).rejects.toBeInstanceOf(BlockedError);
    expect(fs.existsSync(path.join(CACHE_DIR, rel))).toBe(false);
    expect(fs.existsSync(`${path.join(CACHE_DIR, rel)}.tmp${process.pid}`)).toBe(false);
  });

  it('a network failure also ends as BlockedError (after retries)', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls++;
      throw new TypeError('fetch failed');
    });
    await expect(cachedFetch(terrariumUrl(0, 0), `terrarium/test-${process.pid}/0.png`)).rejects.toBeInstanceOf(BlockedError);
    expect(calls).toBe(4);
  });

  it('refuses any other host outright', async () => {
    vi.stubGlobal('fetch', async () => new Response('x'));
    await expect(cachedFetch('https://example.com/a.png', 'x/a.png')).rejects.toThrow(/not allowed/);
  });
});

describe('terrarium decoding and resampling', () => {
  it('decodes the Terrarium formula R*256 + G + B/256 - 32768', () => {
    expect(terrariumHeight(128, 0, 0)).toBe(0);
    expect(terrariumHeight(129, 44, 128)).toBeCloseTo(300.5 + 256 * 0 + 0, 6); // 129*256 + 44 + 0.5 - 32768 = 300.5
    expect(terrariumHeight(0, 0, 0)).toBe(-32768);
  });

  it('a constant grid resamples to the same constant everywhere, polar caps included', () => {
    const merc = new Float32Array(MERC_SIZE * MERC_SIZE).fill(123);
    const r = resampleToRender(merc);
    expect(r.mean.length).toBe(RENDER_WIDTH * RENDER_HEIGHT);
    for (const i of [0, RENDER_WIDTH * 10 + 5, RENDER_WIDTH * 1024 + 2000, RENDER_WIDTH * 2040 + 7, RENDER_WIDTH * RENDER_HEIGHT - 1]) {
      expect(r.mean[i]).toBeCloseTo(123, 3);
      expect(r.max[i]).toBeCloseTo(123, 3);
    }
    // The Mercator limit is about 85.05 degrees: 56 rows of 0.088 degrees are synthetic at each pole.
    expect(MERC_MAX_LAT).toBeCloseTo(85.0511, 3);
    expect(r.syntheticRowsNorth).toBe(56);
    expect(r.syntheticRowsSouth).toBe(56);
  });

  it('a row-dependent grid keeps its latitude: a step at the equator stays at the equator', () => {
    const merc = new Float32Array(MERC_SIZE * MERC_SIZE);
    merc.fill(500, 0, (MERC_SIZE / 2) * MERC_SIZE); // northern half
    merc.fill(-500, (MERC_SIZE / 2) * MERC_SIZE);
    const r = resampleToRender(merc);
    expect(r.mean[RENDER_WIDTH * 1000]).toBeCloseTo(500, 3);
    expect(r.mean[RENDER_WIDTH * 1050]).toBeCloseTo(-500, 3);
  });
});
