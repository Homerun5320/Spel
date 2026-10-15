// Fitting the globe in the window (CamFix, D158). Pure maths: no three, no DOM, no state. `CameraRig` (src/render/camera.ts) asks it for the farthest
// distance of a window and for the tilt it may show at a distance; the unit tests ask it for the exact extent of the disc.
//
// THE GEOMETRY. The orbit rig looks at a focus point F on the sea-level sphere from the distance d (Earth radii) with the tilt t from straight down:
// the camera is at F + d * (cos t * F - sin t * T), T the horizontal look direction. The planet's centre O is behind F: in the camera's frame (x right,
// y up, z forward) it is at x = 0, y = -sin t, z = d + cos t. So the disc of the globe, seen from the camera at a distance c = sqrt(d^2 + 1 + 2 d cos t)
// from O, is a cone of half angle a = asin(1 / c) whose axis is e = atan2(sin t, d + cos t) BELOW the view axis. At tilt 0 the disc is centred and
// its radius on the screen is tan(a); at a larger tilt it moves down by e and its far edge goes out by e: the far edge is at tan(a + e), the
// near edge (the focus is always inside the disc) at tan(a - e), and the sides at k = sin a / sqrt(cos^2 e - sin^2 a) (the plane x = k z touches the
// cone). Everything is in fractions of the half-height (tan of half the vertical field) and of the half-width (that times the aspect).
import {
  CAMERA_FOV_DEG,
  DIST_ABS_MAX_KM,
  DIST_MAX_KM,
  EARTH_RADIUS_KM,
  FIT_ASPECT_MIN,
  FIT_FILL_SAFE,
  FIT_REFERENCE_ASPECT,
  FIT_TILT_FREE_KM,
} from './config';

const RAD = Math.PI / 180;
const HALF_TAN = Math.tan((CAMERA_FOV_DEG * RAD) / 2);
/** The tilt the eased limit starts at: above any tilt a camera can have (`setViewUnclamped` stops at 89.5). */
export const TILT_CAP_FREE_DEG = 90;

/** The aspect ratio the maths uses for `aspect` (width / height): the reference for something that is not a positive finite number (a canvas with no size yet), at least `FIT_ASPECT_MIN`. */
export function clampAspect(aspect: number): number {
  if (!(aspect > 0) || !Number.isFinite(aspect)) return FIT_REFERENCE_ASPECT;
  return aspect < FIT_ASPECT_MIN ? FIT_ASPECT_MIN : aspect;
}

/** Tangent of half the field of view in the narrowest direction of a window: the vertical one when it is at least as wide as high, else the horizontal one. */
export function narrowHalfTan(aspect: number): number {
  const a = clampAspect(aspect);
  return HALF_TAN * (a < 1 ? a : 1);
}

/**
 * The share of the narrowest half-extent the globe's disc takes when the camera looks straight down from `distKm` (tilt 0, the disc is centred): its
 * tangent radius over the tangent of the half field. 0.63 at `DIST_MAX_KM` in a window at least as wide as high; more than 1 when the disc is bigger than the window.
 */
export function discFill(distKm: number, aspect: number): number {
  const c = 1 + distKm / EARTH_RADIUS_KM;
  return 1 / Math.sqrt(c * c - 1) / narrowHalfTan(aspect);
}

/** The distance (km from the focus) at which a camera looking straight down has the disc at the share `fill` of the narrowest half-extent (the inverse of `discFill`). */
export function fitDistKm(aspect: number, fill: number): number {
  const t = fill * narrowHalfTan(aspect);
  const c = Math.sqrt(1 + 1 / (t * t));
  return (c - 1) * EARTH_RADIUS_KM;
}

const REFERENCE_FILL = discFill(DIST_MAX_KM, 1);

/**
 * The farthest distance of a window: the disc has the same share of the narrowest half-extent as `DIST_MAX_KM` gives in a window at least as wide as
 * high, so it is `DIST_MAX_KM` for every aspect of 1 and more, and farther the narrower the window gets (the horizontal field is the narrow one), up
 * to `DIST_ABS_MAX_KM`. Continuous and monotone in the aspect.
 */
export function maxDistKm(aspect: number): number {
  const a = clampAspect(aspect);
  if (a >= 1) return DIST_MAX_KM;
  return Math.min(DIST_ABS_MAX_KM, fitDistKm(a, REFERENCE_FILL));
}

/**
 * The distance from which the eased tilt is 0: the disc fills `FIT_FILL_SAFE` of the narrowest half-extent at tilt 0, which is where it just fits with the
 * margin (a tilt there pushes the far edge out). More than `FIT_TILT_FREE_KM` for every aspect.
 */
export function tiltEaseEndKm(aspect: number): number {
  return fitDistKm(aspect, FIT_FILL_SAFE);
}

/**
 * The eased tilt limit (degrees) for a distance, given the distance `endKm` where it reaches 0 (`tiltEaseEndKm` of the window): `TILT_CAP_FREE_DEG` up
 * to `FIT_TILT_FREE_KM`, a smoothstep of the logarithm of the distance down to 0 at `endKm`, 0 beyond. Continuous, monotone, flat at both ends. The
 * rig caches `endKm` and calls this every frame: no allocation, one logarithm.
 */
export function tiltCapAt(distKm: number, endKm: number): number {
  if (distKm <= FIT_TILT_FREE_KM) return TILT_CAP_FREE_DEG;
  if (distKm >= endKm) return 0;
  const x = Math.log(distKm / FIT_TILT_FREE_KM) / Math.log(endKm / FIT_TILT_FREE_KM);
  return TILT_CAP_FREE_DEG * (1 - x * x * (3 - 2 * x));
}

/**
 * The largest tilt (degrees from straight down) the camera shows at `distKm` in a window of `aspect`: the user's tilt is kept up to
 * `FIT_TILT_FREE_KM` and eased to 0 as the distance grows toward the point where the whole disc fits at tilt 0 with room to spare; from there the
 * disc is centred. Beyond it the disc could be shown tilted without being cut (a tilted disc moves by its radius times sin t and the margin is
 * 8 %), but a globe that is only nearly centred is not what zooming out is for (acceptance: the middle of the disc within 3 % of the middle of
 * the view at the maximum distance), and the limit must not rise again with the distance. The tilt the user chose is not touched: the rig shows
 * `min(tilt, maxTiltForDist)` and gives the tilt back when the distance shrinks.
 */
export function maxTiltForDist(distKm: number, aspect: number): number {
  return tiltCapAt(distKm, tiltEaseEndKm(aspect));
}

/** The tilt that is shown: the user's tilt, brought down to the limit. */
export function shownTiltAt(tiltDeg: number, distKm: number, endKm: number): number {
  const cap = tiltCapAt(distKm, endKm);
  return tiltDeg < cap ? tiltDeg : cap;
}

/** The extent of the globe's disc in the picture. All numbers are fractions of the half-height (`top`, `bottom`) or the half-width (`side`); 1 is the edge of the picture. */
export interface DiscExtent {
  /** How far the disc reaches above the middle of the picture (its near edge: the focus is always inside the disc, so this is >= 0). */
  top: number;
  /** How far it reaches below the middle (its far edge). Infinity when the disc reaches behind the camera. */
  bottom: number;
  /** How far it reaches to each side. Infinity when the disc reaches behind the camera. */
  side: number;
  /** The largest of the three: the disc fits with a margin of `1 - fill` on every side when this is below 1. */
  fill: number;
  /** How far below the middle of the picture the disc's centre is, as a fraction of the half-height. */
  centre: number;
}

/** The exact extent of the disc seen from `distKm` at tilt `tiltDeg` in a window of `aspect` (see the header for the formulas). */
export function discExtent(distKm: number, tiltDeg: number, aspect: number): DiscExtent {
  const a = clampAspect(aspect);
  const t = tiltDeg * RAD;
  const d = distKm / EARTH_RADIUS_KM;
  const c = Math.sqrt(d * d + 1 + 2 * d * Math.cos(t));
  const alpha = Math.asin(Math.min(1, 1 / c));
  const e = Math.atan2(Math.sin(t), d + Math.cos(t));
  const top = Math.tan(alpha - e) / HALF_TAN;
  const sinA = Math.sin(alpha);
  const cosE = Math.cos(e);
  const reachesBehind = alpha + e >= Math.PI / 2 || cosE * cosE <= sinA * sinA;
  const bottom = reachesBehind ? Number.POSITIVE_INFINITY : Math.tan(alpha + e) / HALF_TAN;
  const side = reachesBehind ? Number.POSITIVE_INFINITY : sinA / Math.sqrt(cosE * cosE - sinA * sinA) / (HALF_TAN * a);
  return { top, bottom, side, fill: Math.max(Math.abs(top), bottom, side), centre: Math.tan(e) / HALF_TAN };
}

/** True when the whole disc is in the picture with at least `margin` (a fraction of the half-extent) free on every side. */
export function discFits(distKm: number, tiltDeg: number, aspect: number, margin = 1 - FIT_FILL_SAFE): boolean {
  return discExtent(distKm, tiltDeg, aspect).fill <= 1 - margin;
}

/**
 * The raw geometric limit: the largest tilt (0 to 89.5 degrees) at which the disc still fits with `1 - fillMax` free on every side at this distance,
 * found by bisection; 0 when it does not fit even straight down. NOT what the camera shows (that is `maxTiltForDist`, which is 0 wherever this is not
 * far above 0 because the globe is centred there): the tests use it to prove that the eased limit never asks for more than the geometry allows.
 */
export function geometricTiltLimit(distKm: number, aspect: number, fillMax = FIT_FILL_SAFE): number {
  if (discExtent(distKm, 0, aspect).fill > fillMax) return 0;
  let lo = 0;
  let hi = 89.5;
  if (discExtent(distKm, hi, aspect).fill <= fillMax) return hi;
  for (let i = 0; i < 50; i++) {
    const mid = 0.5 * (lo + hi);
    if (discExtent(distKm, mid, aspect).fill <= fillMax) lo = mid;
    else hi = mid;
  }
  return lo;
}
