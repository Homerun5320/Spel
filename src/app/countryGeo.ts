// Where a country is on the globe and how far to stand away from it (M06, the menu): the centre of its main land mass (the cells of
// the country in the land mass of its capital, inside the chosen region) and a viewing distance that grows with its area. Used by the
// setup screen to fly the camera to a chosen country. Display data only: it never enters the sim, so floats and trigonometry are fine here.
import type { RegionId } from '../data/regions';
import { SETUP_FLY_AREA_FACTOR, SETUP_FLY_BASE_KM, SETUP_FLY_MAX_KM, SETUP_FLY_MIN_KM } from '../ui/uiConfig';
import type { PreparedWorld } from './matchWorld';

export interface CountryView {
  readonly lat: number;
  readonly lon: number;
  /** The country's area in km2 (meta.json). */
  readonly areaKm2: number;
  /** Camera distance to the focus point in km for a screen whose free part is as high as the window (see `flyDistanceKm`). */
  readonly distKm: number;
}

const cache = new WeakMap<PreparedWorld, Map<RegionId, ReadonlyMap<number, CountryView>>>();

/**
 * The viewing distance for a country of this area (km2): a few times its size, between the limits of the config. `free` is the shorter side
 * of the part of the window the menu panel leaves free, as a share of the window's height (1 on a wide screen with a side panel, about 0.45 on
 * a phone held upright with the panel as a bottom sheet): the less room, the further away the camera stands.
 */
export function flyDistanceKm(areaKm2: number, free = 1): number {
  const d = SETUP_FLY_BASE_KM + (SETUP_FLY_AREA_FACTOR * Math.sqrt(Math.max(0, areaKm2))) / Math.max(0.3, Math.min(1, free));
  return Math.max(SETUP_FLY_MIN_KM, Math.min(SETUP_FLY_MAX_KM, d));
}

/** The view of every country that has land in the region (by country id). Computed once per world and region. */
export function countryViews(world: PreparedWorld, region: RegionId): ReadonlyMap<number, CountryView> {
  let perRegion = cache.get(world);
  if (perRegion === undefined) {
    perRegion = new Map();
    cache.set(world, perRegion);
  }
  const hit = perRegion.get(region);
  if (hit !== undefined) return hit;
  const analysis = world.analyse(region);
  const { width, height } = world;
  const capitalMass = new Map<number, number>();
  for (const c of world.countries) if (c.capitalCell >= 0) capitalMass.set(c.id, analysis.land.label[c.capitalCell] as number);
  const sum = new Map<number, [number, number, number, number]>();
  for (let y = 0; y < height; y++) {
    const lat = ((height - 2 * y - 1) * 90) / height;
    const cl = Math.cos((lat * Math.PI) / 180);
    const sl = Math.sin((lat * Math.PI) / 180);
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const id = world.data.country[i] as number;
      if (id === 0) continue;
      const mass = analysis.land.label[i] as number;
      if (mass < 0 || capitalMass.get(id) !== mass) continue;
      const lon = (((2 * x + 1 - width) * 180) / width) * (Math.PI / 180);
      let s = sum.get(id);
      if (s === undefined) {
        s = [0, 0, 0, 0];
        sum.set(id, s);
      }
      s[0] += cl * Math.sin(lon);
      s[1] += sl;
      s[2] += cl * Math.cos(lon);
      s[3]++;
    }
  }
  const out = new Map<number, CountryView>();
  for (const c of world.countries) {
    const s = sum.get(c.id);
    if (s === undefined || s[3] === 0) continue;
    const len = Math.hypot(s[0], s[1], s[2]);
    if (len < 1e-9) continue;
    const lat = (Math.asin(s[1] / len) * 180) / Math.PI;
    const lon = (Math.atan2(s[0], s[2]) * 180) / Math.PI;
    out.set(c.id, { lat, lon, areaKm2: c.areaKm2, distKm: flyDistanceKm(c.areaKm2) });
  }
  perRegion.set(region, out);
  return out;
}
