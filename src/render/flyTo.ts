// Camera flights (M06, item 1): `flyTo(lat, lon, distKm)` moves the camera focus along the great circle to a place and eases the
// distance (a hump in the middle for a long hop, so the globe is seen from further away while it turns) and the heading and tilt to
// their end values. The flight is timed by the FX clock (`fxNow()` from src/render/clock.ts), the one cosmetic clock, so it freezes in
// `?test=1` and a test steps it with `advanceFx`. Pure maths over the CameraRig (no three, no DOM).
//
// Why this file and not `src/render/camera/flyTo.ts`: `src/render/camera.ts` is a file, a folder `camera/` next to it would shadow
// its imports (D120). M08 (the RTS camera) extends this same function: the option object has room for more.
//
// Any input that grabs the camera (a drag, the wheel) calls `cancel()`; `update` is called once per frame BEFORE `CameraRig.update`.
//
// M08 (D155): the same function also flies to a GROUND position at a given ALTITUDE, tilt and heading (`FlyOptions.altAglM`, the RTS
// mode). That flight is planned on the camera model (ground position, height, heading, tilt: `src/render/rts.ts`) in three overlapping
// phases - rise (if the hop is long: the camera is at least `FLY_ARCH_RATIO` times the distance flown high), move (while it is high), dive
// (the slow part: the log-rate of the height is bounded, so no frame moves the camera more than a few percent of its height) - and
// it ends with the camera exactly where `cameraLookingAt` puts it, keeping the height it arrived at. All time is `fxNow()`.
import type { CameraRig, ViewState } from './camera';
import { fxNow } from './clock';
import {
  CAMERA_FOV_DEG,
  EARTH_RADIUS_KM,
  FLY_ARCH_RATIO,
  FLY_PEAK_MAX_M,
  FLY_RHO_MAX,
  FLY_SHARE_ACTIVE,
  FLY_SHARE_MOVE,
  FLY_TURN_WINDOW,
  RTS_TILT_MAX_DEG,
  RTS_TILT_MIN_DEG,
  ZOOM_MIN_AGL_M,
} from './config';
import { DEG, add, dot, eastAt, latLonToVec, normalize, northAt, scale, sub, vecToLatLon, wrapLon, type Vec3 } from './geo';
import { cameraLookingAt, modelFromPose, poseFromModel, viewFromPose, type CameraModel } from './rts';

/** Flight time in FX seconds: a short hop takes FLY_MIN_S, half way round the world FLY_MIN_S + FLY_EXTRA_S. */
export const FLY_MIN_S = 0.9;
export const FLY_EXTRA_S = 1.7;
/** A hop of this angle (degrees) or more gets the full zoom-out hump in the middle of the flight. */
export const FLY_ARCH_FULL_DEG = 70;
/** The distance in the middle of a full-arch flight is this many times (natural log) larger than the straight blend. */
export const FLY_ARCH_LOG = 0.75;
/** Look-1: the longest a `fast` ground flight takes, in fx seconds. */
export const FLY_FAST_MAX_S = 1.8;

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
  /**
   * M08, the RTS mode: fly to the ground point (lat, lon) and arrive with the camera this many metres above the ground UNDER IT (never
   * less than `ZOOM_MIN_AGL_M`, 300 m), looking at the point with `tilt` (degrees from straight down at the point, default 45, kept in
   * 20 to 80) and `heading`. `distKm` is then ignored and `shiftX` / `shiftY` do not apply. After the flight the camera keeps that height
   * over the ground (the RTS camera follows the terrain). `rts: true` without an altitude takes `distKm` (km) as the height.
   */
  altAglM?: number;
  rts?: boolean;
  /**
   * Look-1: the fast profile of a flight the UI starts (open city): the ground flight takes at most `FLY_FAST_MAX_S` fx seconds for any
   * distance (the 5 percent per frame rule of the planner does not apply), the same eased phases, the same clearance. `durationS` wins.
   */
  fast?: boolean;
}

/** The ground flight's plan: the camera model at the start and the end, the exact end pose, the phase heights and the clock. */
interface GroundFlight {
  m0: CameraModel;
  m1: CameraModel;
  endPosition: Vec3;
  endForward: Vec3;
  u0: Vec3;
  u1: Vec3;
  a0: number;
  a1: number;
  plan: GroundFlightPlan;
  t0: number;
  duration: number;
}

const smoother = (s: number): number => s * s * s * (s * (s * 6 - 15) + 10);

/** Progress through a window [a, b] of the flight (0 before, 1 after), eased; an empty window is 1 once its time has come. */
const windowed = (s: number, w: readonly [number, number]): number => (w[1] - w[0] <= 1e-12 ? (s >= w[1] ? 1 : 0) : smoother(Math.max(0, Math.min(1, (s - w[0]) / (w[1] - w[0])))));
const smoothstep3 = (e0: number, e1: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** The plan of a ground flight: the highest height, the duration in fx seconds and the windows (shares of the duration) of its phases. */
export interface GroundFlightPlan {
  peak: number;
  duration: number;
  rise: readonly [number, number];
  move: readonly [number, number];
  dive: readonly [number, number];
}

/**
 * Lays out a ground flight (D155). The camera rises from `a0` to the peak (at least `FLY_ARCH_RATIO` times the distance flown in height, never
 * under either end), moves along the great circle while it is high, and dives to `a1`. The rise and the dive share `FLY_SHARE_ACTIVE` of the
 * time in proportion to their log spans, so both run at the same log-rate, and the duration is the longest of
 *  - the classic duration of the hop (`FLY_MIN_S` + `FLY_EXTRA_S` by the angle),
 *  - what the rise and the dive need so that the height's log-rate peaks at `FLY_RHO_MAX` e-folds per second (the eased ramp peaks at 1.875
 *    times its mean),
 *  - what the move needs so that its speed peaks at `FLY_RHO_MAX` heights per second (the move takes `FLY_SHARE_MOVE` of the time).
 * From orbit to 300 m that is about 14 s, from 30 km to 300 m about 5 s, a 25 km hop at 300 m about 7 s.
 */
export function planGroundFlight(a0: number, a1: number, angleRad: number): GroundFlightPlan {
  const distM = angleRad * EARTH_RADIUS_KM * 1000;
  const peak = Math.max(a0, a1, Math.min(FLY_PEAK_MAX_M, FLY_ARCH_RATIO * distM), 1);
  const rise = Math.log(peak / Math.max(a0, 1));
  const dive = Math.log(peak / Math.max(a1, 1));
  const spans = rise + dive;
  const tHeight = spans > 0 ? (1.875 * spans) / (FLY_SHARE_ACTIVE * FLY_RHO_MAX) : 0;
  const tMove = distM > 0 ? (1.875 * distM) / (FLY_SHARE_MOVE * peak * FLY_RHO_MAX) : 0;
  const duration = Math.max(FLY_MIN_S + FLY_EXTRA_S * Math.min(1, angleRad / Math.PI), tHeight, tMove);
  const fr = spans > 0 ? (FLY_SHARE_ACTIVE * rise) / spans : 0;
  const fd = spans > 0 ? (FLY_SHARE_ACTIVE * dive) / spans : 0;
  const moveStart = fr * 0.5;
  return { peak, duration, rise: [0, fr], move: [moveStart, moveStart + FLY_SHARE_MOVE], dive: [1 - fd, 1] };
}

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
  private ground: GroundFlight | null = null;

  constructor(
    private readonly rig: CameraRig,
    private readonly clock: () => number = fxNow,
  ) {}

  /** True while a flight is under way. */
  get active(): boolean {
    return this.to !== null || this.ground !== null;
  }

  /** The view the running flight ends at (null when none). */
  get end(): ViewState | null {
    if (this.ground !== null) return viewFromPose(this.ground.endPosition, this.ground.endForward, this.ground.m1.heading);
    return this.to === null ? null : { ...this.to };
  }

  /** The time the running ground flight takes in fx seconds (null for none or a classic flight). */
  get groundDuration(): number | null {
    return this.ground === null ? null : this.ground.duration;
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
    if (options.altAglM !== undefined || options.rts === true) {
      this.flyToGround(lat, lon, options.altAglM ?? distKm * 1000, options);
      return;
    }
    this.ground = null;
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

  /**
   * The RTS flight (see the header): from wherever the camera is to `altAglM` metres over the ground point (lat, lon). The end pose is
   * solved on the camera's ground (`cameraLookingAt`), the path is planned on the camera model, and the camera is put on it with
   * `CameraRig.setPose` every frame.
   */
  private flyToGround(lat: number, lon: number, altAglM: number, options: FlyOptions): void {
    const now = this.clock();
    this.from = null;
    this.to = null;
    const rig = this.rig;
    const pose = rig.pose();
    const view = rig.view;
    const a1 = Math.max(altAglM, ZOOM_MIN_AGL_M);
    const tilt = Math.max(RTS_TILT_MIN_DEG, Math.min(RTS_TILT_MAX_DEG, options.tilt ?? 45));
    const heading = wrapLon(options.heading ?? view.heading);
    const groundR = (la: number, lo: number): number => rig.groundRadius(la, lo);
    const target = scale(latLonToVec(lat, lon), groundR(lat, wrapLon(lon)));
    const end = cameraLookingAt(target, heading, tilt, groundR, a1);
    const m0 = modelFromPose(pose.position, pose.forward, groundR, view.heading);
    const m1 = modelFromPose(end.position, end.forward, groundR, heading);
    const u0 = latLonToVec(m0.lat, m0.lon);
    const u1 = latLonToVec(m1.lat, m1.lon);
    const angle = angleBetween(u0, u1);
    const plan = planGroundFlight(m0.aglM, m1.aglM, angle);
    const duration = options.durationS ?? (options.fast === true ? Math.min(plan.duration, FLY_FAST_MAX_S) : plan.duration);
    this.ground = { m0, m1, endPosition: end.position, endForward: end.forward, u0, u1, a0: m0.aglM, a1: m1.aglM, plan, t0: now, duration };
    this.update(now);
  }

  /** Stops the flight where it is (the camera keeps its current view; after an RTS flight it keeps the height it has). */
  cancel(): void {
    if (this.ground !== null) this.rig.setHoldAgl(this.rig.aglM());
    this.from = null;
    this.to = null;
    this.ground = null;
  }

  /** One frame of the ground flight at progress `s` in [0, 1). */
  private stepGround(g: GroundFlight, s: number): void {
    const rise = windowed(s, g.plan.rise);
    const move = windowed(s, g.plan.move);
    const dive = windowed(s, g.plan.dive);
    const turn = windowed(s, FLY_TURN_WINDOW);
    const a0 = Math.max(g.a0, 1);
    const a1 = Math.max(g.a1, 1);
    const lnPeak = Math.log(g.plan.peak);
    const agl = Math.exp(Math.log(a0) + (lnPeak - Math.log(a0)) * rise - (lnPeak - Math.log(a1)) * dive);
    const p = vecToLatLon(slerp(g.u0, g.u1, move));
    // the radius: the smooth ground while the camera moves, the real one once it is (nearly) there, and never under the clearance
    const rig = this.rig;
    const smooth = rig.groundRadius(p.lat, p.lon, true);
    const real = rig.groundRadius(p.lat, p.lon);
    const used = smooth + (real - smooth) * smoothstep3(0.85, 1, move);
    const radius = Math.max(used + agl / (EARTH_RADIUS_KM * 1000), real + (ZOOM_MIN_AGL_M + 1) / (EARTH_RADIUS_KM * 1000));
    const pose = poseFromModel(
      { lat: p.lat, lon: p.lon, aglM: agl, heading: wrapLon(g.m0.heading + shortestAngle(g.m0.heading, g.m1.heading) * turn), tilt: g.m0.tilt + (g.m1.tilt - g.m0.tilt) * turn },
      radius,
    );
    rig.setPose(pose.position, pose.forward);
  }

  /** Moves the camera to the flight's position at FX time `now`. Call once per frame before `CameraRig.update`. */
  update(now: number = this.clock()): void {
    const g = this.ground;
    if (g !== null) {
      const s = g.duration <= 0 ? 1 : Math.max(0, Math.min(1, (now - g.t0) / g.duration));
      if (s >= 1) {
        this.ground = null;
        this.rig.setPose(g.endPosition, g.endForward);
        this.rig.setHoldAgl(g.a1);
        return;
      }
      this.stepGround(g, s);
      return;
    }
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
