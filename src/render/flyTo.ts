// Camera flights (M06, item 1): `flyTo(lat, lon, distKm)` moves the camera focus along the great circle to a place and eases the
// distance (a hump in the middle for a long hop, so the globe is seen from further away while it turns) and the heading and tilt to
// their end values. The flight is timed by the FX clock (`fxNow()` from src/render/clock.ts), the one cosmetic clock, so it freezes in
// `?test=1` and a test steps it with `advanceFx`. Pure maths over the CameraRig (no three, no DOM).
//
// Why this file and not `src/render/camera/flyTo.ts`: `src/render/camera.ts` is a file, a folder `camera/` next to it would shadow
// its imports (D120). M08 (the RTS camera) extends this same function: the option object has room for more.
//
// Any input that grabs the camera (a drag, the wheel) calls `cancel()`; `update` is called once per frame BEFORE `CameraRig.update`.
import type { CameraRig, ViewState } from './camera';
import { fxNow } from './clock';
import { CAMERA_FOV_DEG, EARTH_RADIUS_KM } from './config';
import { DEG, add, dot, eastAt, latLonToVec, normalize, northAt, scale, sub, vecToLatLon, wrapLon, type Vec3 } from './geo';

/** Flight time in FX seconds: a short hop takes FLY_MIN_S, half way round the world FLY_MIN_S + FLY_EXTRA_S. */
export const FLY_MIN_S = 0.9;
export const FLY_EXTRA_S = 1.7;
/** A hop of this angle (degrees) or more gets the full zoom-out hump in the middle of the flight. */
export const FLY_ARCH_FULL_DEG = 70;
/** The distance in the middle of a full-arch flight is this many times (natural log) larger than the straight blend. */
export const FLY_ARCH_LOG = 0.75;

export interface FlyOptions {
  /** Flight time in FX seconds (default: from the angle, FLY_MIN_S .. FLY_MIN_S + FLY_EXTRA_S); 0 jumps at once. */
  durationS?: number;
  /** Heading and tilt at the end (default 0 and 0: north up, looking straight down). */
  heading?: number;
  tilt?: number;
  /**
   * Where the place should appear on the screen, as a share of half the width (`shiftX`, positive = right of the centre) and half the
   * height (`shiftY`, positive = above the centre) at heading 0 and tilt 0. A menu panel on one side of the screen uses it so that the
   * country ends up in the free part. 0 (default) = the centre.
   */
  shiftX?: number;
  shiftY?: number;
}

const smoother = (s: number): number => s * s * s * (s * (s * 6 - 15) + 10);

function shortestAngle(from: number, to: number): number {
  let d = (to - from) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

/** Angle in radians between two unit vectors. */
function angleBetween(a: Vec3, b: Vec3): number {
  const c = Math.max(-1, Math.min(1, dot(a, b)));
  return Math.acos(c);
}

/** Spherical interpolation of two unit vectors (a straight lerp when they are nearly equal; the far side takes any perpendicular axis). */
function slerp(a: Vec3, b: Vec3, f: number): Vec3 {
  const ang = angleBetween(a, b);
  if (ang < 1e-9) return a;
  if (Math.PI - ang < 1e-9) {
    const side = normalize([-a[1], a[0], 0.0001]);
    const mid = normalize(add(scale(a, 0.0001), side));
    return f < 0.5 ? slerp(a, mid, f * 2) : slerp(mid, b, f * 2 - 1);
  }
  const sa = Math.sin((1 - f) * ang) / Math.sin(ang);
  const sb = Math.sin(f * ang) / Math.sin(ang);
  return normalize(add(scale(a, sa), scale(b, sb)));
}

export class CameraFlight {
  private from: ViewState | null = null;
  private to: ViewState | null = null;
  private t0 = 0;
  private duration = 0;
  private arch = 0;
  private fromVec: Vec3 = [0, 0, 1];
  private toVec: Vec3 = [0, 0, 1];

  constructor(
    private readonly rig: CameraRig,
    private readonly clock: () => number = fxNow,
  ) {}

  /** True while a flight is under way. */
  get active(): boolean {
    return this.to !== null;
  }

  /** The view the running flight ends at (null when none). */
  get end(): ViewState | null {
    return this.to === null ? null : { ...this.to };
  }

  /** The focus that makes (lat, lon) appear at the requested screen position (see FlyOptions.shiftX). */
  focusFor(lat: number, lon: number, distKm: number, shiftX = 0, shiftY = 0): { lat: number; lon: number } {
    if (shiftX === 0 && shiftY === 0) return { lat, lon: wrapLon(lon) };
    const { width, height } = this.rig.viewport;
    const halfH = distKm * Math.tan((CAMERA_FOV_DEG * DEG) / 2);
    const halfW = halfH * (width / height);
    const f = latLonToVec(lat, lon);
    const moved = sub(sub(f, scale(eastAt(lon), (shiftX * halfW) / EARTH_RADIUS_KM)), scale(northAt(lat, lon), (shiftY * halfH) / EARTH_RADIUS_KM));
    return vecToLatLon(normalize(moved));
  }

  /** Starts a flight from the current view to (lat, lon, distKm). Replaces a flight under way (it continues from where the camera is). */
  flyTo(lat: number, lon: number, distKm: number, options: FlyOptions = {}): void {
    const now = this.clock();
    const from = this.rig.view;
    const focus = this.focusFor(lat, lon, distKm, options.shiftX ?? 0, options.shiftY ?? 0);
    const to: ViewState = { lat: focus.lat, lon: wrapLon(focus.lon), distKm, heading: wrapLon(options.heading ?? 0), tilt: options.tilt ?? 0 };
    const fromVec = latLonToVec(from.lat, from.lon);
    const toVec = latLonToVec(to.lat, to.lon);
    const angle = angleBetween(fromVec, toVec);
    this.duration = options.durationS ?? FLY_MIN_S + FLY_EXTRA_S * Math.min(1, angle / Math.PI);
    this.arch = FLY_ARCH_LOG * Math.min(1, angle / (FLY_ARCH_FULL_DEG * DEG));
    this.from = from;
    this.to = to;
    this.fromVec = fromVec;
    this.toVec = toVec;
    this.t0 = now;
    this.update(now);
  }

  /** Stops the flight where it is (the camera keeps its current view). */
  cancel(): void {
    this.from = null;
    this.to = null;
  }

  /** Moves the camera to the flight's position at FX time `now`. Call once per frame before `CameraRig.update`. */
  update(now: number = this.clock()): void {
    const from = this.from;
    const to = this.to;
    if (from === null || to === null) return;
    const s = this.duration <= 0 ? 1 : Math.max(0, Math.min(1, (now - this.t0) / this.duration));
    if (s >= 1) {
      this.from = null;
      this.to = null;
      this.rig.setView({ lat: to.lat, lon: to.lon, distKm: to.distKm, heading: to.heading, tilt: to.tilt });
      return;
    }
    const e = smoother(s);
    const p = vecToLatLon(slerp(this.fromVec, this.toVec, e));
    const logD = Math.log(from.distKm) + (Math.log(to.distKm) - Math.log(from.distKm)) * e + this.arch * Math.sin(Math.PI * e);
    this.rig.setView({
      lat: p.lat,
      lon: p.lon,
      distKm: Math.exp(logD),
      heading: wrapLon(from.heading + shortestAngle(from.heading, to.heading) * e),
      tilt: from.tilt + (to.tilt - from.tilt) * e,
    });
  }
}
