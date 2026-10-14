// The playable regions (M06): rectangles in tenths of a degree, the integer test of "the centre of the cell is inside", no Antarctica.
import { describe, expect, it } from 'vitest';
import { REGIONS, REGION_IDS, cellInRect, isRegionId, regionMask, type GeoRect } from '../../src/data/regions';

/** The same test restated with floats (degrees), for cells that are not on an edge. */
function inRectFloat(x: number, y: number, w: number, h: number, r: GeoRect): boolean {
  const lat = 90 - ((y + 0.5) * 180) / h;
  const lon = -180 + ((x + 0.5) * 360) / w;
  return lat >= r.south10 / 10 && lat <= r.north10 / 10 && lon >= r.west10 / 10 && lon <= r.east10 / 10;
}

describe('the region table', () => {
  it('lists the world and the four Skirmish cut-outs, and isRegionId knows exactly those', () => {
    expect(REGION_IDS).toEqual(['world', 'europe', 'eastAsia', 'americas', 'africaMiddleEast']);
    for (const id of REGION_IDS) expect(isRegionId(id)).toBe(true);
    for (const x of ['', 'asia', 'World', null, undefined, 3]) expect(isRegionId(x)).toBe(false);
    expect(REGIONS.find((r) => r.id === 'world')?.rects).toBeNull();
  });

  it('every rectangle is a proper one inside the globe, none crosses the antimeridian and none reaches Antarctica', () => {
    for (const region of REGIONS) {
      for (const r of region.rects ?? []) {
        expect(r.south10, region.id).toBeLessThan(r.north10);
        expect(r.west10, region.id).toBeLessThan(r.east10);
        expect(r.south10, region.id).toBeGreaterThanOrEqual(-600); // nothing south of 60 S
        expect(r.north10, region.id).toBeLessThanOrEqual(900);
        expect(r.west10, region.id).toBeGreaterThanOrEqual(-1800);
        expect(r.east10, region.id).toBeLessThanOrEqual(1800);
      }
    }
  });
});

describe('regionMask', () => {
  it('has no mask for the world and an unknown id', () => {
    expect(regionMask('world', 64, 32)).toBeNull();
    expect(regionMask('nowhere' as never, 64, 32)).toBeNull();
  });

  it('agrees with the float restatement on every cell of a 256 x 128 grid (no cell sits exactly on an edge there)', () => {
    for (const region of REGIONS) {
      if (region.rects === null) continue;
      const mask = regionMask(region.id, 256, 128) as Uint8Array;
      let inside = 0;
      for (let y = 0; y < 128; y++) {
        for (let x = 0; x < 256; x++) {
          const want = region.rects.some((r) => inRectFloat(x, y, 256, 128, r));
          expect(mask[y * 256 + x] === 1, `${region.id} ${x},${y}`).toBe(want);
          if (want) inside++;
        }
      }
      expect(inside, region.id).toBeGreaterThan(256 * 128 * 0.03);
      expect(inside, region.id).toBeLessThan(256 * 128 * 0.5);
    }
  });

  it('puts known cell centres in the right region (Stockholm in Europe, Tokyo in East Asia, Brasilia in the Americas, Nairobi in Africa)', () => {
    const cell = (lat: number, lon: number): [number, number] => [Math.floor(((lon + 180) / 360) * 1024), Math.floor(((90 - lat) / 180) * 512)];
    const inRegion = (id: string, lat: number, lon: number): boolean => {
      const mask = regionMask(id as never, 1024, 512) as Uint8Array;
      const [x, y] = cell(lat, lon);
      return mask[y * 1024 + x] === 1;
    };
    expect(inRegion('europe', 59.3, 18.1)).toBe(true);
    expect(inRegion('europe', 35.7, 139.7)).toBe(false);
    expect(inRegion('eastAsia', 35.7, 139.7)).toBe(true);
    expect(inRegion('eastAsia', 59.3, 18.1)).toBe(false);
    expect(inRegion('americas', -15.8, -47.9)).toBe(true);
    expect(inRegion('americas', 59.3, 18.1)).toBe(false);
    expect(inRegion('africaMiddleEast', -1.3, 36.8)).toBe(true);
    expect(inRegion('africaMiddleEast', 59.3, 18.1)).toBe(false);
  });

  it('cellInRect is exact on the edges: a cell centre on the edge is inside', () => {
    // a 2 x 2 grid has centres at +-45 deg lat and +-90 deg lon
    const r: GeoRect = { south10: 450, north10: 450, west10: 900, east10: 900 };
    expect(cellInRect(1, 0, 2, 2, r)).toBe(true); // lat 45, lon 90
    expect(cellInRect(0, 0, 2, 2, r)).toBe(false);
    expect(cellInRect(1, 1, 2, 2, r)).toBe(false);
  });
});
