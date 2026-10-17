// A result hash of a list of routes (M11b): FNV-1a over the waypoints, fuel, ETA and exposed count of each, so Node and Chromium can be compared
// with one string. Not part of any state hash.
import type { AltMode } from '../los/cache';
import type { Nav } from './grid';
import { planRoute, type NavView } from './route';

export function navFingerprint(nav: Nav, view: NavView, seat: number, queries: ReadonlyArray<readonly [number, number, AltMode]>): string {
  let h = 0x811c9dc5;
  const mix = (v: number): void => {
    h = Math.imul(h ^ (v | 0), 0x01000193);
  };
  for (const [from, to, mode] of queries) {
    const r = planRoute(nav, view, seat, from, to, mode);
    if (!r.ok) {
      mix(-1);
      continue;
    }
    mix(r.waypoints.length);
    for (const w of r.waypoints) mix(w);
    mix(r.fuelCells);
    mix(r.etaTicks);
    mix(r.exposedCells);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
