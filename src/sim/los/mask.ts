// The mask-altitude field of ONE site (M11a): for every cell of the (2R+1)^2 box round the site (cells within R of it), the lowest
// game altitude at which an aircraft over that cell is in line of sight of the antenna, in units of LOS_MASK_UNIT_GM rounded DOWN
// (so the error favours the radar). 0xFFFF = outside the radius or off the map. A target is visible when altitude >= mask * unit.
//
// Rays run from the site to every cell of the perimeter of the box (Bresenham steps along the major axis, x wrapping). Along a ray the
// steepest slope of the occluders passed so far gives the line of sight; a cell several rays reach takes the smallest mask; cells no
// ray reached take the smallest mask of their set neighbours. Horizontal distances use the metres per cell of the site's row.
import { LOS_MASK_SLACK_GM, LOS_MASK_UNIT_GM, LOS_RAY_OVERSAMPLE, LOS_RAY_OVERSAMPLE_MAX_RADIUS, SITE_ANTENNA_M } from '../rules';
import type { LosTerrain } from './terrain';

export const MASK_NONE = 0xffff;
const RAY_OS = LOS_RAY_OVERSAMPLE;
const SLACK = LOS_MASK_SLACK_GM;

/** Side of the mask box of radius R. */
export function maskSide(radius: number): number {
  return 2 * radius + 1;
}

/** The antenna altitude of a site on `cell` in game metres. */
export function antennaGm(t: LosTerrain, cell: number): number {
  return (t.groundGm[cell] as number) + SITE_ANTENNA_M;
}

/** Builds the mask of a site into `out` (length maskSide(radius)^2; allocated when omitted) and returns it. */
export function buildMask(t: LosTerrain, cell: number, radius: number, out?: Uint16Array): Uint16Array {
  const side = maskSide(radius);
  const mask = out ?? new Uint16Array(side * side);
  mask.fill(MASK_NONE);
  const w = t.width;
  const h = t.height;
  const sx = cell % w;
  const sy = (cell - sx) / w;
  const a = antennaGm(t, cell);
  const wM = t.cellWidthM[sy] as number;
  const hM = t.cellHeightM;
  const r2 = radius * radius;
  mask[radius * side + radius] = 0;
  const occ = t.occGm;
  const os = radius > LOS_RAY_OVERSAMPLE_MAX_RADIUS ? 1 : RAY_OS;
  const R = radius;
  const den = 2 * R * os;
  const bigQ = R + 1;
  const bigNum = den * bigQ; // keeps the numerator positive, so `| 0` is a floor
  const dTab = distanceTable(R, wM, hM);
  for (let k = 0; k < 8 * R * os; k++) {
    // k walks the perimeter of the box in steps of 1/os cell: top row, right column, bottom row, left column.
    let dx: number;
    let dy: number;
    const q = k % (2 * R * os);
    const side4 = (k - q) / (2 * R * os);
    if (side4 === 0) {
      dx = -R * os + q;
      dy = -R * os;
    } else if (side4 === 1) {
      dx = R * os;
      dy = -R * os + q;
    } else if (side4 === 2) {
      dx = R * os - q;
      dy = R * os;
    } else {
      dx = -R * os;
      dy = R * os - q;
    }
    let slope = -1e18;
    for (let i = 1; i <= R; i++) {
      const px = (((2 * dx * i + R * os + bigNum) / den) | 0) - bigQ;
      const py = (((2 * dy * i + R * os + bigNum) / den) | 0) - bigQ;
      if (px * px + py * py > r2) break;
      const y = sy + py;
      if (y < 0 || y >= h) break;
      let x = sx + px;
      if (x < 0) x += w;
      else if (x >= w) x -= w;
      const c = y * w + x;
      const at = (py + radius) * side + (px + radius);
      const d = dTab[at] as number;
      const line = a + slope * d;
      let m = Math.floor((line - SLACK < 0 ? 0 : line - SLACK) / LOS_MASK_UNIT_GM);
      if (m > MASK_NONE - 1) m = MASK_NONE - 1;
      if (m < (mask[at] as number)) mask[at] = m;
      const s = ((occ[c] as number) - a) / d;
      if (s > slope) slope = s;
    }
  }
  ringPass(t, mask, cell, radius, a, dTab);
  return mask;
}

let distScratch = new Float64Array(0);

/** The distance in metres from the site to every cell of the box (the site's row decides the metres per cell). */
function distanceTable(R: number, wM: number, hM: number): Float64Array {
  const side = maskSide(R);
  if (distScratch.length < side * side) distScratch = new Float64Array(side * side);
  const d = distScratch;
  for (let py = -R; py <= R; py++) {
    const ey = py * hM;
    for (let px = -R; px <= R; px++) {
      const ex = px * wM;
      d[(py + R) * side + (px + R)] = Math.sqrt(ex * ex + ey * ey);
    }
  }
  return d;
}


const NO_SLOPE = -1e9;
let ringT = new Float64Array(0);

/**
 * The second estimate, ring by ring (Chebyshev rings round the site): the slope an aircraft must clear to be seen over a cell is the
 * interpolation of the thresholds of the two cells of the previous ring that the line to the site crosses between, and a cell raises
 * the threshold for the cells behind it with its own occluder slope. Every cell of the circle gets a value; the smaller of this and the
 * ray estimate is kept (the two err in different places, and an error must favour the radar). Cells of one ring read only the ring
 * before it, so the order inside a ring does not matter.
 */
function ringPass(t: LosTerrain, mask: Uint16Array, cell: number, R: number, a: number, dTab: Float64Array): void {
  const side = maskSide(R);
  if (ringT.length < side * side) ringT = new Float64Array(side * side);
  const T = ringT;
  const w = t.width;
  const h = t.height;
  const sx = cell % w;
  const sy = (cell - sx) / w;
  const occ = t.occGm;
  const r2 = R * R;
  const lift = R + 1;
  T[R * side + R] = NO_SLOPE;
  for (let k = 1; k <= R; k++) {
    const kb = k * lift;
    const invK = 1 / k;
    for (let dy = -k; dy <= k; dy++) {
      const y = sy + dy;
      const step = dy === -k || dy === k ? 1 : 2 * k;
      for (let dx = -k; dx <= k; dx += step) {
        const at = (dy + R) * side + (dx + R);
        if (y < 0 || y >= h) {
          T[at] = NO_SLOPE;
          continue;
        }
        let thr = NO_SLOPE;
        if (k > 1) {
          // The two cells of ring k-1 the line to the site passes between, and the weight of the second.
          if (dx === k || dx === -k) {
            const mx = dx > 0 ? k - 1 : 1 - k;
            const num = dy * (k - 1);
            const y0 = (((num + kb) / k) | 0) - lift;
            const fn = num - y0 * k;
            const b0 = (y0 + R) * side + (mx + R);
            thr = T[b0] as number;
            if (fn !== 0) thr += ((T[b0 + side] as number) - thr) * fn * invK;
          } else {
            const my = dy > 0 ? k - 1 : 1 - k;
            const num = dx * (k - 1);
            const x0 = (((num + kb) / k) | 0) - lift;
            const fn = num - x0 * k;
            const b0 = (my + R) * side + (x0 + R);
            thr = T[b0] as number;
            if (fn !== 0) thr += ((T[b0 + 1] as number) - thr) * fn * invK;
          }
        }
        const d = dTab[at] as number;
        if (dx * dx + dy * dy <= r2) {
          const line = thr <= NO_SLOPE / 2 ? 0 : a + thr * d - SLACK;
          let m = Math.floor((line < 0 ? 0 : line) / LOS_MASK_UNIT_GM);
          if (m > MASK_NONE - 1) m = MASK_NONE - 1;
          if (m < (mask[at] as number)) mask[at] = m;
        }
        let x = sx + dx;
        if (x < 0) x += w;
        else if (x >= w) x -= w;
        const s = ((occ[y * w + x] as number) - a) / d;
        T[at] = s > thr ? s : thr;
      }
    }
  }
}
