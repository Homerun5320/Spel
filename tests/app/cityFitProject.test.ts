// Fix-4B (audit 3, 1.8): `cityFitFlight` is checked by COMPUTING the picture: a ring round the City is projected through a pinhole camera that looks where the flight says, from
// the altitude it says, and must lie inside the free part of the window (the part the panel leaves), with the City in the middle of that part and the ring as large as the margin
// allows where the fit decides the altitude. The earlier test (tests/app/cityFit.test.ts) only pins signs and orderings.
//
// THE RING. The formula counts `CITY_VIEW.ringExtentM` against HALF the free span (`fw / (width / 2)`), so the ring it really fits is `ringExtentM / 2` of plain ground metres; a ring
// of the full 2 400 m would overflow the free part by up to 2x in the plain geometry (found while writing this test, docs/DECISIONS.md Fix-4B). The shipped numbers are left alone on
// purpose: `e2e/cityOpenFit.test.ts` measures the REAL five districts of a level-9 City inside the free part at these three window sizes (the structure scale policy enlarges the models
// with the distance, which is what the factor 2 stands for), and a changed altitude would be a visible change nobody asked for. The test pins the formula's own geometry.
const RING_FITTED_M = CITY_VIEW.ringExtentM / 2;
import { describe, expect, it } from 'vitest';
import { cityFitFlight } from '../../src/app/cityViewMode';
import { CAMERA_FOV_DEG } from '../../src/render/config';
import { CITY_VIEW } from '../../src/ui/uiConfig';

const TILT = CITY_VIEW.flyTiltDeg;

interface Rect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** The free part of a window as `cityFitFlight` defines it (a side panel on the right when it is wider than a third of the window, else a bottom sheet). */
function freeRect(width: number, height: number, panel: { x: number; y: number }): Rect {
  const sideways = panel.x > width / 3;
  return { x0: 0, x1: sideways ? panel.x : width, y0: Math.min(CITY_VIEW.topPx, height / 4), y1: sideways ? height : panel.y };
}

/** Screen pixel of the ground point (east, north) m from the City, for a camera that looks at the ground point (offEast, offNorth) from `altAglM`, tilted `tiltDeg` from straight down, heading 0. */
function project(width: number, height: number, fovDeg: number, tiltDeg: number, altAglM: number, lookEast: number, lookNorth: number, east: number, north: number): { x: number; y: number } {
  const t = (tiltDeg * Math.PI) / 180;
  const D = altAglM / Math.cos(t);
  // camera: south of the look-at point and above it
  const cam = { e: lookEast, n: lookNorth - D * Math.sin(t), u: D * Math.cos(t) };
  const fwd = { e: 0, n: Math.sin(t), u: -Math.cos(t) };
  const up = { e: 0, n: Math.cos(t), u: Math.sin(t) };
  const v = { e: east - cam.e, n: north - cam.n, u: 0 - cam.u };
  const depth = v.e * fwd.e + v.n * fwd.n + v.u * fwd.u;
  const tanHalf = Math.tan((fovDeg * Math.PI) / 360);
  const aspect = width / height;
  const nx = v.e / (depth * tanHalf * aspect);
  const ny = (v.e * up.e + v.n * up.n + v.u * up.u) / (depth * tanHalf);
  return { x: (width / 2) * (1 + nx), y: (height / 2) * (1 - ny) };
}

/** The bounding box of the fitted ring (a disc of `RING_FITTED_M`, 64 points) and the City's own pixel. */
function picture(width: number, height: number, panel: { x: number; y: number }, tiltDeg = TILT): { box: Rect; city: { x: number; y: number }; free: Rect; alt: number } {
  const f = cityFitFlight(width, height, panel, CAMERA_FOV_DEG, tiltDeg);
  const at = (e: number, n: number) => project(width, height, CAMERA_FOV_DEG, tiltDeg, f.altAglM, f.offEastM, f.offNorthM, e, n);
  const box: Rect = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    const p = at(Math.cos(a) * RING_FITTED_M, Math.sin(a) * RING_FITTED_M);
    box.x0 = Math.min(box.x0, p.x);
    box.x1 = Math.max(box.x1, p.x);
    box.y0 = Math.min(box.y0, p.y);
    box.y1 = Math.max(box.y1, p.y);
  }
  return { box, city: at(0, 0), free: freeRect(width, height, panel), alt: f.altAglM };
}

// three window sizes: a laptop with a side panel, a wide screen with a narrow free part (the fit binds), a phone with a bottom sheet
const CASES: Array<[string, number, number, { x: number; y: number }]> = [
  ['960x540, side panel at x=509', 960, 540, { x: 509, y: 64 }],
  ['1366x768, a narrow free part (panel at x=500)', 1366, 768, { x: 500, y: 64 }],
  ['540x960, bottom sheet from y=318', 540, 960, { x: 8, y: 318 }],
  ['960x540, a panel exactly a third wide counts as a bottom sheet', 960, 540, { x: 320, y: 380 }],
  ['480x200, a window so low that a quarter of its height is less than the status bar', 480, 200, { x: 8, y: 120 }],
];

describe('cityFitFlight, computed: the City and its ring fit the free part of the window', () => {
  for (const [name, w, h, panel] of CASES) {
    it(`${name}: every point of the ring is inside the free part, with the margin to spare`, () => {
      const { box, free } = picture(w, h, panel);
      expect(box.x0).toBeGreaterThanOrEqual(free.x0);
      expect(box.x1).toBeLessThanOrEqual(free.x1);
      expect(box.y0).toBeGreaterThanOrEqual(free.y0);
      expect(box.y1).toBeLessThanOrEqual(free.y1);
    });

    it(`${name}: the City stands in the middle of the free part (within 4 % of its size)`, () => {
      const { city, free } = picture(w, h, panel);
      expect(Math.abs(city.x - (free.x0 + free.x1) / 2)).toBeLessThan(0.04 * (free.x1 - free.x0));
      expect(Math.abs(city.y - (free.y0 + free.y1) / 2)).toBeLessThan(0.04 * (free.y1 - free.y0));
    });
  }

  it('where the fit decides the altitude the ring is as large as the formula allows: its tighter axis fills at least 75 % of (margin / 2: the formula counts the ring against half the span), and never more than the margin', () => {
    for (const [, w, h, panel] of CASES.slice(1, 3)) {
      const { box, free } = picture(w, h, panel);
      const fx = (box.x1 - box.x0) / (free.x1 - free.x0);
      const fy = (box.y1 - box.y0) / (free.y1 - free.y0);
      expect(Math.max(fx, fy)).toBeGreaterThan(0.75 * (CITY_VIEW.fitMargin / 2));
      expect(Math.max(fx, fy)).toBeLessThanOrEqual(CITY_VIEW.fitMargin);
    }
  });

  it('it holds at other tilts too (the ring is foreshortened, the north offset is divided by cos tilt)', () => {
    for (const tilt of [0, 25, 50]) {
      const { box, city, free } = picture(1366, 768, { x: 500, y: 64 }, tilt);
      expect(box.x0, `tilt ${tilt}`).toBeGreaterThanOrEqual(free.x0);
      expect(box.x1, `tilt ${tilt}`).toBeLessThanOrEqual(free.x1);
      expect(box.y0, `tilt ${tilt}`).toBeGreaterThanOrEqual(free.y0);
      expect(box.y1, `tilt ${tilt}`).toBeLessThanOrEqual(free.y1);
      expect(Math.abs(city.y - (free.y0 + free.y1) / 2), `tilt ${tilt}`).toBeLessThan(0.04 * (free.y1 - free.y0));
    }
  });
});
