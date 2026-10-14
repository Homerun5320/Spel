// Where the camera goes for a country (M06): the centre of its main land mass and a distance that grows with its area and with how little
// of the window the menu panel leaves free.
import { beforeAll, describe, expect, it } from 'vitest';
import { countryViews, flyDistanceKm } from '../../src/app/countryGeo';
import { countryEligibility } from '../../src/app/eligibility';
import type { PreparedWorld } from '../../src/app/matchWorld';
import { SETUP_FLY_BASE_KM, SETUP_FLY_MAX_KM, SETUP_FLY_MIN_KM } from '../../src/ui/uiConfig';
import { loadPreparedWorld } from '../../tools/sim/realWorld';

let world: PreparedWorld;
beforeAll(async () => {
  world = await loadPreparedWorld();
});

describe('flyDistanceKm', () => {
  it('stays between the limits, grows with the area and is further away when the free part of the window is small', () => {
    expect(flyDistanceKm(0)).toBe(Math.max(SETUP_FLY_MIN_KM, SETUP_FLY_BASE_KM));
    expect(flyDistanceKm(1e12)).toBe(SETUP_FLY_MAX_KM);
    let last = 0;
    for (const a of [1e3, 1e4, 1e5, 1e6, 1e7]) {
      const d = flyDistanceKm(a);
      expect(d).toBeGreaterThanOrEqual(last);
      last = d;
    }
    expect(flyDistanceKm(4.5e5, 0.45)).toBeGreaterThan(flyDistanceKm(4.5e5, 1));
    expect(flyDistanceKm(4.5e5, 0)).toBe(flyDistanceKm(4.5e5, 0.3)); // the share is clamped
    expect(flyDistanceKm(4.5e5, 7)).toBe(flyDistanceKm(4.5e5, 1));
  });
});

describe('countryViews', () => {
  it('every selectable country has a view on its own land: inside the bounds of the globe, with a distance in range', () => {
    const views = countryViews(world, 'world');
    const analysis = world.analyse('world');
    for (const c of world.countries) {
      if (!countryEligibility(analysis, c).ok) continue;
      const v = views.get(c.id);
      expect(v, c.a3).toBeDefined();
      expect(Math.abs(v!.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(v!.lon)).toBeLessThanOrEqual(180);
      expect(v!.distKm).toBeGreaterThanOrEqual(SETUP_FLY_MIN_KM);
      expect(v!.distKm).toBeLessThanOrEqual(SETUP_FLY_MAX_KM);
    }
  });

  it('the centre is near the capital for a compact country (within about 15 degrees for the 20 smallest selectable ones that have a land mass)', () => {
    const views = countryViews(world, 'world');
    const analysis = world.analyse('world');
    const small = world.countries.filter((c) => countryEligibility(analysis, c).ok).sort((a, b) => a.areaKm2 - b.areaKm2).slice(0, 20);
    for (const c of small) {
      const v = views.get(c.id)!;
      const x = c.capitalCell % world.width;
      const y = (c.capitalCell - x) / world.width;
      const capLat = ((world.height - 2 * y - 1) * 90) / world.height;
      const capLon = ((2 * x + 1 - world.width) * 180) / world.width;
      const dLon = Math.abs(((v.lon - capLon + 540) % 360) - 180);
      expect(Math.abs(v.lat - capLat), c.a3).toBeLessThan(15);
      expect(dLon, c.a3).toBeLessThan(15 / Math.max(0.2, Math.cos((capLat * Math.PI) / 180)));
    }
  });

  it('is cached per world and region, and a region only has views for the land inside it', () => {
    expect(countryViews(world, 'world')).toBe(countryViews(world, 'world'));
    const eu = countryViews(world, 'europe');
    const all = countryViews(world, 'world');
    expect(eu.size).toBeLessThan(all.size);
    for (const v of eu.values()) {
      expect(v.lat).toBeGreaterThan(30);
      expect(v.lat).toBeLessThan(75);
    }
  });
});
