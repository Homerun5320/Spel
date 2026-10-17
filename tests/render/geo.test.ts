import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { SUN_DAY_SECONDS, SUN_DECLINATION_DEG } from '../../src/render/config';
import {
  dot,
  eastAt,
  latLonToCell,
  latLonToVec,
  length,
  northAt,
  rotateAbout,
  subsolarLonAt,
  sunDirectionAt,
  timeForSubsolarLon,
  vecToLatLon,
  wrapLon,
} from '../../src/render/geo';

describe('geo', () => {
  it('lat/lon <-> vector round trip, unit length', () => {
    fc.assert(
      fc.property(fc.double({ min: -89.9, max: 89.9, noNaN: true }), fc.double({ min: -179.9, max: 179.9, noNaN: true }), (lat, lon) => {
        const v = latLonToVec(lat, lon);
        expect(length(v)).toBeCloseTo(1, 12);
        const r = vecToLatLon(v);
        expect(r.lat).toBeCloseTo(lat, 8);
        expect(r.lon).toBeCloseTo(lon, 8);
      }),
    );
  });

  it('the world frame matches the spike: lon 0 faces +z, +x is east, +y is north', () => {
    expect(latLonToVec(0, 0)).toEqual([0, 0, 1]);
    expect(latLonToVec(0, 90)[0]).toBeCloseTo(1, 12);
    expect(latLonToVec(90, 0)[1]).toBeCloseTo(1, 12);
  });

  it('east and north are orthonormal and tangent everywhere, including the poles', () => {
    for (const lat of [-90, -89.99, -45, 0, 30, 89.99, 90]) {
      for (const lon of [-180, -90, 0, 33, 180]) {
        const p = latLonToVec(lat, lon);
        const e = eastAt(lon);
        const n = northAt(lat, lon);
        expect(length(e)).toBeCloseTo(1, 12);
        expect(length(n)).toBeCloseTo(1, 12);
        expect(dot(e, n)).toBeCloseTo(0, 12);
        expect(dot(p, e)).toBeCloseTo(0, 12);
        expect(dot(p, n)).toBeCloseTo(0, 12);
      }
    }
  });

  it('rotateAbout keeps length and moves a point by the angle', () => {
    const v = rotateAbout([1, 0, 0], [0, 1, 0], Math.PI / 2);
    expect(v[0]).toBeCloseTo(0, 12);
    expect(v[2]).toBeCloseTo(-1, 12);
  });

  it('latLonToCell follows x = floor((lon+180)/360*1024), y = floor((90-lat)/180*512)', () => {
    expect(latLonToCell(59.3, 18.1)).toMatchObject({ x: Math.floor(((18.1 + 180) / 360) * 1024), y: Math.floor(((90 - 59.3) / 180) * 512) });
    expect(latLonToCell(27.99, 86.93)).toMatchObject({ x: 759, y: 176 });
    expect(latLonToCell(90, -180)).toMatchObject({ x: 0, y: 0 });
    expect(latLonToCell(-90, 180)).toMatchObject({ x: 0, y: 511 }); // 180 wraps to -180
    expect(latLonToCell(0, 179.99)).toMatchObject({ x: 1023, y: 256 });
    expect(latLonToCell(10, 540).x).toBe(latLonToCell(10, 180).x);
  });

  it('wrapLon maps into [-180, 180)', () => {
    expect(wrapLon(190)).toBe(-170);
    expect(wrapLon(-190)).toBe(170);
    expect(wrapLon(180)).toBe(-180);
  });

  it('the sun is a pure function of the fx time: unit vector, fixed declination, moves west, one day per SUN_DAY_SECONDS', () => {
    for (const t of [0, 1, 123.4, 5000]) {
      const s = sunDirectionAt(t);
      expect(length(s)).toBeCloseTo(1, 12);
      expect(vecToLatLon(s).lat).toBeCloseTo(SUN_DECLINATION_DEG, 9);
    }
    expect(subsolarLonAt(SUN_DAY_SECONDS / 4)).toBeCloseTo(wrapLon(subsolarLonAt(0) - 90), 9);
    expect(subsolarLonAt(SUN_DAY_SECONDS)).toBeCloseTo(subsolarLonAt(0), 9);
  });

  it('timeForSubsolarLon inverts subsolarLonAt', () => {
    for (const lon of [-170, -90, 0, 20, 139.7, 179]) {
      const t = timeForSubsolarLon(lon);
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThan(SUN_DAY_SECONDS);
      expect(wrapLon(subsolarLonAt(t) - lon)).toBeCloseTo(0, 9);
    }
  });
});
