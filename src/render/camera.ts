// Orbit / arcball camera for the globe. Pure maths (no three, no DOM) so that it can be unit-tested in Node.
//
// State: the focus point on the sea-level sphere (lat, lon), the compass bearing the camera looks toward (heading,
// 0 = north up), the tilt away from straight down, and the distance to the focus point. The up vector is built from
// the analytic east/north frame, so it is defined at the poles too. All cosmetic motion (inertia, zoom smoothing)
// integrates on the fx clock: `update(fxNow())`.
import {
  ATMOSPHERE_TOP,
  CAMERA_FOV_DEG,
  CAMERA_MAX_STEP_S,
  CLIP_FAR_MARGIN,
  CLIP_NEAR_FRACTION,
  CLIP_NEAR_MIN,
  DIST_MAX_KM,
  DIST_MIN_GROUND_KM,
  DIST_MIN_KM,
  EARTH_RADIUS_KM,
  INERTIA_TAU_S,
  LAT_LIMIT_DEG,
  ROTATE_DEG_PER_PX,
  RTS_FOLLOW_EPS_M,
  RTS_FOLLOW_TAU_S,
  RTS_TILT_EASE_DEG_PER_S,
  TILT_MAX_DEG,
  WHEEL_ZOOM_RATE,
  ZOOM_MIN_AGL_M,
  ZOOM_TAU_S,
} from './config';
import {
  DEG,
  add,
  cross,
  dot,
  eastAt,
  latLonToVec,
  length,
  normalize,
  northAt,
  rotateAbout,
  scale,
  sub,
  vecToLatLon,
  wrapLon,
  type Vec3,
} from './geo';
import { nearestSpherePoint, raySphere } from './heightField';
import { rtsMix, shortestAngle, tiltBounds, viewFromPose } from './rts';

export interface ViewState {
  lat: number;
  lon: number;
  distKm: number;
  /** Compass bearing the camera looks toward, degrees (0 = north is up). */
  heading: number;
  /** Degrees away from straight down. */
  tilt: number;
}

export interface CameraPose {
  position: Vec3;
  /** The focus point on the sea-level sphere. */
  target: Vec3;
  forward: Vec3;
  up: Vec3;
  right: Vec3;
  near: number;
  far: number;
  fovDeg: number;
  aspect: number;
}

export interface Ray {
  origin: Vec3;
  dir: Vec3;
}

export interface ScreenPoint {
  x: number;
  y: number;
  /** Distance in front of the camera (negative = behind). */
  depth: number;
  /** In front of the camera and inside the viewport. */
  inView: boolean;
  /** The point is on the side of the globe that faces the camera (not hidden behind the horizon). */
  facing: boolean;
}

const FLOOR_SEARCH_KM = 1500;
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** The displaced ground under a latitude / longitude (degrees), as a distance from the planet centre in Earth radii. */
export type GroundRadius = (latDeg: number, lonDeg: number) => number;

/** The first point where a ray meets the ground a camera sees (`pickGround` of src/render/transforms.ts), or null. */
export type GroundPicker = (origin: Vec3, dir: Vec3) => Vec3 | null;

const R_M = EARTH_RADIUS_KM * 1000;

/** The camera position (Earth radii) of a view; the same formula as `CameraRig.pose().position` (a test keeps them in step). */
export function cameraPositionFor(s: ViewState): Vec3 {
  const F = latLonToVec(s.lat, s.lon);
  const E = eastAt(s.lon);
  const N = northAt(s.lat, s.lon);
  const h = s.heading * DEG;
  const T = add(scale(N, Math.cos(h)), scale(E, Math.sin(h)));
  const t = s.tilt * DEG;
  const offset = sub(scale(F, Math.cos(t)), scale(T, Math.sin(t)));
  return add(F, scale(offset, s.distKm / EARTH_RADIUS_KM));
}

/**
 * The distance (km from the focus point) at which a camera looking at the focus point along view `v` (focus, heading, tilt) is
 * `altAglM` metres above the displaced ground under IT: the first distance along the line outward from the focus at which the camera
 * clears the ground, by a geometric scan and bisection (a fixed-point iteration does not converge on a steep slope: the ground moves
 * faster than the camera). The result is the lowest distance that has that height, so it is also the terrain-aware zoom minimum.
 */
export function distForAgl(v: ViewState, surfaceRadius: GroundRadius, altAglM: number): number {
  const target = altAglM / (EARTH_RADIUS_KM * 1000);
  const probe: ViewState = { ...v, distKm: 0.001 };
  const f = (distRadii: number): number => {
    probe.distKm = distRadii * EARTH_RADIUS_KM;
    const p = cameraPositionFor(probe);
    const { lat, lon } = vecToLatLon(p);
    return length(p) - surfaceRadius(lat, lon) - target;
  };
  let lo = 1e-7;
  let hi = lo;
  let fhi = f(hi);
  for (let i = 0; i < 200 && fhi < 0; i++) {
    lo = hi;
    hi *= 1.15;
    fhi = f(hi);
  }
  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi);
    if (f(mid) < 0) lo = mid;
    else hi = mid;
  }
  return hi * EARTH_RADIUS_KM;
}

/**
 * Near and far plane (Earth radii) of the chunk terrain, from the camera's distance to the planet centre and its height above the
 * ground (AGL). The near plane follows the height (a camera 300 m up gets a near plane of 30 m, one in orbit of hundreds of km);
 * the far plane reaches the farthest thing that can be seen: the horizon of the planet plus the way a ray along the horizon takes
 * to leave the atmosphere shell (the sky glow is that shell's far side), plus a margin. So the depth range is as tight as it can
 * be at every altitude and a 24-bit depth buffer is enough without reversed depth (docs/DECISIONS.md).
 */
export function clipPlanes(centreDist: number, aglRadii: number): { near: number; far: number } {
  const horizon = Math.sqrt(Math.max(centreDist * centreDist - 1, 0));
  const shell = Math.sqrt(ATMOSPHERE_TOP * ATMOSPHERE_TOP - 1);
  const near = Math.max(CLIP_NEAR_MIN, CLIP_NEAR_FRACTION * aglRadii);
  return { near, far: horizon + shell + CLIP_FAR_MARGIN };
}

export class CameraRig {
  private s: ViewState = { lat: 0, lon: 0, distKm: 20000, heading: 0, tilt: 0 };
  private targetDistKm = 20000;
  private width: number;
  private height: number;
  private lastNow: number | null = null;
  // Inertia: rotation of the focus about a world axis (`velWeight` = how much of the heading turns with it, 0 in the globe regime).
  private velAxis: Vec3 = [0, 1, 0];
  private velRate = 0;
  private velWeight = 0;
  private dragging = false;
  private dragPrev = { x: 0, y: 0, t: 0 };
  // The wheel's anchor: the cursor and the radius of the sphere the cursor ray is intersected with (1 = sea level, the ground's radius in the RTS regime).
  private anchor: { x: number; y: number; r: number } | null = null;
  // The displaced ground under a position, when the terrain is known (the chunk terrain): the zoom then stops ZOOM_MIN_AGL_M above it.
  private ground: GroundRadius | null = null;
  // A smoother ground (few octaves) for the height a FLIGHT keeps while it moves; the camera's clearance always uses `ground`.
  private flightGround: GroundRadius | null = null;
  // The height the wheel asked for (metres above the ground) while a terrain-aware zoom is under way: the anchor moves the focus over other
  // ground as the camera comes down, so the distance that has this height is solved again every frame until the zoom has settled.
  private targetAglM: number | null = null;
  // M08, the RTS regime (D155). `picker` finds the ground point under a ray. `holdAglM` is the height over the ground the user wants to keep:
  // it is set by the user's zoom, drag and turn (never by `setView`, the test hooks or a classic flight), and while it is set the camera
  // follows the ground at that height. `grip` is the ground point a left drag holds under the cursor.
  private picker: GroundPicker | null = null;
  private holdAglM: number | null = null;
  private grip: { dir: Vec3; r: number; w: number; x: number; y: number } | null = null;
  private followStamp = { lat: NaN, lon: NaN, distKm: NaN, heading: NaN, tilt: NaN, hold: NaN };

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  setViewport(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  get view(): ViewState {
    return { ...this.s };
  }

  /**
   * Makes the zoom terrain aware (M07a): the wheel and `setView` then stop the camera ZOOM_MIN_AGL_M above the displaced ground under
   * it (over the sea 300 m since M08, over the Himalaya 300 m above a ground that the x12 exaggeration put 100 km up), and a wheel step is a
   * share of the height above the ground, so it gets finer the nearer the ground. `null` gives the old fixed minimum distance back.
   * `flightGround` is the smoother ground a flight keeps its height over while it moves (default: the same ground).
   */
  setGround(ground: GroundRadius | null, flightGround: GroundRadius | null = null): void {
    this.ground = ground;
    this.flightGround = flightGround;
  }

  /** The ground point under a ray (the picking of the displaced surface); with it (and a ground) the camera has its RTS regime near the ground. */
  setPicker(picker: GroundPicker | null): void {
    this.picker = picker;
  }

  /** The ground the rig knows (null without one); flights read the radius of the ground under a position from it. */
  groundRadius(latDeg: number, lonDeg: number, smooth = false): number {
    const g = smooth ? (this.flightGround ?? this.ground) : this.ground;
    return g ? g(latDeg, lonDeg) : 1;
  }

  /** The height over the ground the camera keeps while the ground changes under it (null = it keeps nothing: the camera is where a hook or a classic flight left it). */
  get holdAgl(): number | null {
    return this.holdAglM;
  }

  setHoldAgl(aglM: number | null): void {
    this.holdAglM = aglM === null ? null : Math.max(aglM, ZOOM_MIN_AGL_M);
  }

  /** The weight of the RTS regime at the camera's height (0 = globe arcball, 1 = RTS; needs a ground and a picker). */
  get rtsWeight(): number {
    if (!this.ground || !this.picker) return 0;
    return rtsMix(this.aglM());
  }

  /** The angle between the look direction and straight down AT THE CAMERA, degrees (the tilt of an RTS camera; the rig's `view.tilt` is the angle at the sea-level focus). */
  localTilt(): number {
    const p = this.pose();
    const u = normalize(p.position);
    return Math.acos(clamp(-dot(p.forward, u), -1, 1)) / DEG;
  }

  /**
   * The tilt the limits apply to: the angle at the focus in the globe regime, the angle at the camera in the RTS regime (the two differ by the
   * curvature of the planet between the camera and the focus: negligible for a camera 800 km up looking down, but a camera 2 km up looking at
   * the horizon has its sea-level focus hundreds of kilometres away and the angle at the focus moves 10 degrees for a degree of pitch), and a
   * weighted mix in between.
   */
  private effectiveTilt(w: number): number {
    return w >= 1 ? this.localTilt() : (1 - w) * this.s.tilt + w * this.localTilt();
  }

  /** The tilt limits at weight `w`; the upper RTS limit is lowered where the horizon dips below it (a camera over the Himalaya cannot look at the horizon from the orbit state). */
  private tiltLimits(w: number): { min: number; max: number } {
    const b = tiltBounds(w);
    if (w <= 0) return b;
    const dip = Math.acos(1 / Math.max(1, length(this.pose().position))) / DEG;
    return { min: b.min, max: Math.max(b.min, Math.min(b.max, 89 - w * dip)) };
  }

  /** Makes `next` the view without touching the zoom: a zoom under way keeps its share (its distance target moves with the distance). */
  private adoptView(next: ViewState): void {
    const ratio = next.distKm / this.s.distKm;
    this.s = next;
    if (Number.isFinite(ratio) && ratio > 0) this.targetDistKm *= ratio;
  }

  /** The camera's height above the ground under it, in metres (needs `setGround`). */
  aglM(s: ViewState = this.s): number {
    if (!this.ground) return Number.POSITIVE_INFINITY;
    const p = cameraPositionFor(s);
    const { lat, lon } = vecToLatLon(p);
    return (length(p) - this.ground(lat, lon)) * EARTH_RADIUS_KM * 1000;
  }

  /**
   * The lowest distance the user may have for this focus, heading and tilt: DIST_MIN_KM without a ground; with one the distance at which
   * the camera is ZOOM_MIN_AGL_M above the ground (never below DIST_MIN_GROUND_KM).
   */
  floorKm(s: ViewState = this.s, exact = false): number {
    if (!this.ground) return DIST_MIN_KM;
    // beyond this distance the camera is above any displaced ground whatever the tilt (the floor is at most a few hundred km): no search needed
    if (!exact && s.distKm > FLOOR_SEARCH_KM && this.aglM(s) > ZOOM_MIN_AGL_M * 4) return DIST_MIN_GROUND_KM;
    return Math.max(DIST_MIN_GROUND_KM, distForAgl(s, this.ground, ZOOM_MIN_AGL_M));
  }

  /** The viewport in pixels. */
  get viewport(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  /** True while inertia or a zoom animation is still moving the camera. */
  get moving(): boolean {
    return this.velRate > 1e-4 || this.anchor !== null || Math.abs(Math.log(this.targetDistKm / this.s.distKm)) > 1e-4;
  }

  /** Forgets everything the user's hands were doing (the camera was put somewhere): inertia, zoom, drag, the kept height. */
  private resetMotion(): void {
    this.targetDistKm = this.s.distKm;
    this.targetAglM = null;
    this.velRate = 0;
    this.velWeight = 0;
    this.anchor = null;
    this.dragging = false;
    this.grip = null;
    this.holdAglM = null;
  }

  /** Sets the view directly (no animation). Values are clamped to the limits; latitude may reach +-90. */
  setView(v: Partial<ViewState>): void {
    const n = { ...this.s, ...v };
    if (!Number.isFinite(n.lat) || !Number.isFinite(n.lon) || !Number.isFinite(n.distKm) || !Number.isFinite(n.heading) || !Number.isFinite(n.tilt)) {
      throw new Error(`setView: non-finite value in ${JSON.stringify(v)}`);
    }
    this.s = {
      lat: clamp(n.lat, -90, 90),
      lon: wrapLon(n.lon),
      distKm: clamp(n.distKm, this.ground ? DIST_MIN_GROUND_KM : DIST_MIN_KM, DIST_MAX_KM),
      heading: wrapLon(n.heading),
      tilt: clamp(n.tilt, 0, TILT_MAX_DEG),
    };
    if (this.ground) this.s.distKm = clamp(this.s.distKm, this.floorKm(this.s), DIST_MAX_KM);
    this.resetMotion();
  }

  /**
   * Sets the view WITHOUT the user limits: any distance above 1 m and a tilt up to 89.5 degrees (a horizon view). Test hooks only
   * (`__test.setView({altAglM})`); the user's own zoom and tilt stay clamped by `setView`.
   */
  setViewUnclamped(v: Partial<ViewState>): void {
    const n = { ...this.s, ...v };
    if (!Number.isFinite(n.lat) || !Number.isFinite(n.lon) || !Number.isFinite(n.distKm) || !Number.isFinite(n.heading) || !Number.isFinite(n.tilt)) {
      throw new Error(`setViewUnclamped: non-finite value in ${JSON.stringify(v)}`);
    }
    this.s = { lat: clamp(n.lat, -90, 90), lon: wrapLon(n.lon), distKm: clamp(n.distKm, 0.001, 1e6), heading: wrapLon(n.heading), tilt: clamp(n.tilt, 0, 89.5) };
    this.resetMotion();
  }

  /**
   * Puts the camera at a pose (position in Earth radii, look direction) exactly: no limits, no clearance (the caller keeps it above the ground).
   * Flights use it. The kept height is dropped (`setHoldAgl` says what to keep once the camera has arrived).
   */
  setPose(position: Vec3, forward: Vec3): void {
    this.s = viewFromPose(position, forward, this.s.heading);
    this.resetMotion();
  }

  /** Camera pose for the current view. */
  pose(): CameraPose {
    const { lat, lon, heading, tilt, distKm } = this.s;
    const F = latLonToVec(lat, lon);
    const E = eastAt(lon);
    const N = northAt(lat, lon);
    const h = heading * DEG;
    const T = add(scale(N, Math.cos(h)), scale(E, Math.sin(h))); // horizontal look direction
    const t = tilt * DEG;
    const dist = distKm / EARTH_RADIUS_KM;
    const offset = sub(scale(F, Math.cos(t)), scale(T, Math.sin(t))); // unit vector from the focus toward the camera
    const position = add(F, scale(offset, dist));
    const forward = scale(offset, -1);
    const up = add(scale(T, Math.cos(t)), scale(F, Math.sin(t)));
    const right = cross(forward, up);
    const centreDist = length(position);
    return {
      position,
      target: F,
      forward,
      up,
      right,
      near: Math.max(1e-4, dist * 0.08),
      far: Math.max(3, centreDist * 2),
      fovDeg: CAMERA_FOV_DEG,
      aspect: this.width / this.height,
    };
  }

  /** Ray through a pixel (origin = camera position). */
  rayAt(px: number, py: number, pose: CameraPose = this.pose()): Ray {
    const th = Math.tan((pose.fovDeg * DEG) / 2);
    const ndcX = (px / this.width) * 2 - 1;
    const ndcY = 1 - (py / this.height) * 2;
    const dir = normalize(add(pose.forward, add(scale(pose.right, ndcX * th * pose.aspect), scale(pose.up, ndcY * th))));
    return { origin: pose.position, dir };
  }

  /** Screen position (pixels, y down) of a world point. */
  project(point: Vec3, pose: CameraPose = this.pose()): ScreenPoint {
    const v = sub(point, pose.position);
    const depth = dot(v, pose.forward);
    const th = Math.tan((pose.fovDeg * DEG) / 2);
    const safe = depth > 1e-9 ? depth : 1e-9;
    const ndcX = dot(v, pose.right) / (safe * th * pose.aspect);
    const ndcY = dot(v, pose.up) / (safe * th);
    const x = (ndcX * 0.5 + 0.5) * this.width;
    const y = (0.5 - ndcY * 0.5) * this.height;
    const normal = normalize(point);
    const facing = dot(normal, sub(pose.position, point)) > 0;
    return { x, y, depth, inView: depth > 0 && x >= 0 && x <= this.width && y >= 0 && y <= this.height, facing };
  }

  /** The direction (unit vector) of the sphere point of `radius` under a pixel; when the pixel misses the disc, the nearest point of the sphere. */
  private grab(px: number, py: number, radius = 1): Vec3 {
    const { origin, dir } = this.rayAt(px, py);
    const t = raySphere(origin, dir, radius);
    if (radius === 1) return t === null ? nearestSpherePoint(origin, dir) : add(origin, scale(dir, t));
    return t === null ? nearestSpherePoint(origin, dir) : normalize(add(origin, scale(dir, t)));
  }

  /**
   * Moves the focus by rotating it about the world axis (clamps the latitude to the interaction limit). `headingWeight` 1 (or true)
   * turns the look direction rigidly with the focus: the grabbed point stays exactly under the cursor, and the heading follows (the small
   * roll of a trackball); 0 keeps the heading (the globe's drag); a fraction in between is the RTS mix.
   */
  private rotateFocus(axis: Vec3, angle: number, headingWeight: number | boolean = 0): void {
    const weight = headingWeight === true ? 1 : headingWeight === false ? 0 : headingWeight;
    const F = rotateAbout(latLonToVec(this.s.lat, this.s.lon), axis, angle);
    const { lat, lon } = vecToLatLon(F);
    const next = { ...this.s, lat: clamp(lat, -LAT_LIMIT_DEG, LAT_LIMIT_DEG), lon: wrapLon(lon) };
    if (weight > 0) {
      // Rotate the look direction rigidly with the focus. The frame is analytic, so this is defined at the poles too.
      const h = this.s.heading * DEG;
      const T = add(scale(northAt(this.s.lat, this.s.lon), Math.cos(h)), scale(eastAt(this.s.lon), Math.sin(h)));
      const T2 = rotateAbout(T, axis, angle);
      const heading = Math.atan2(dot(T2, eastAt(lon)), dot(T2, northAt(lat, lon))) / DEG;
      if (Number.isFinite(heading)) next.heading = weight >= 1 ? wrapLon(heading) : wrapLon(this.s.heading + weight * shortestAngle(this.s.heading, heading));
    }
    this.s = next;
  }

  /** Rotates the focus so that sphere point `b` (seen at the cursor now) returns to `a` (where the cursor grabbed it). Returns axis and angle. */
  private align(b: Vec3, a: Vec3, headingWeight: number | boolean = 0): { axis: Vec3; angle: number } | null {
    const c = cross(b, a);
    const sin = length(c);
    if (sin < 1e-12) return null;
    const angle = Math.atan2(sin, dot(b, a));
    const axis = scale(c, 1 / sin);
    this.rotateFocus(axis, angle, headingWeight);
    return { axis, angle };
  }

  /**
   * Holds the ground point of a drag under the cursor: the cursor ray meets the sphere of the grip's radius, and the whole rig turns about the
   * planet's centre by the angle that brings that point onto the grip's direction. A turn about the centre keeps every radius, so the grabbed point
   * lands EXACTLY under the cursor; the look direction is rebuilt from the heading and the tilt (no roll in the rig), which leaves a residual of
   * the order of a pixel for a long drag, so the step is repeated (3 passes bring it under 1e-9 rad). Returns the first (big) turn.
   */
  private gripAlign(): { axis: Vec3; angle: number } | null {
    const g = this.grip;
    if (!g) return null;
    let first: { axis: Vec3; angle: number } | null = null;
    for (let i = 0; i < 4; i++) {
      const r = this.align(this.grab(g.x, g.y, g.r), g.dir, g.w);
      if (!r) break;
      if (first === null) first = r;
      if (r.angle < 1e-10) break;
    }
    return first;
  }

  // --- Mouse ------------------------------------------------------------------------------------------------------

  dragStart(px: number, py: number, now: number): void {
    this.dragging = true;
    this.velRate = 0;
    this.anchor = null;
    this.targetAglM = null;
    this.grip = null;
    this.dragPrev = { x: px, y: py, t: now };
    const w = this.rtsWeight;
    if (w > 0 && this.picker) {
      const ray = this.rayAt(px, py);
      const P = this.picker(ray.origin, ray.dir);
      if (P) {
        // the grabbed sphere has the radius of the ground point in the RTS regime and of the sea level in the globe regime; the anchor is where
        // the cursor ray meets THAT sphere (at weight 1 it is the ground point itself), so the drag is continuous in the weight
        const r = 1 + w * (length(P) - 1);
        this.grip = { dir: this.grab(px, py, r), r, w, x: px, y: py };
        this.holdAglM ??= Math.max(this.aglM(), ZOOM_MIN_AGL_M);
      }
    }
  }

  /** Grab-the-globe drag: the sphere point (the globe regime) or the ground point (the RTS regime) under the cursor stays under the cursor. */
  dragMove(px: number, py: number, now: number): void {
    if (!this.dragging) return;
    const dt = Math.max(1 / 240, now - this.dragPrev.t);
    if (this.grip) {
      this.grip.x = px;
      this.grip.y = py;
      const r = this.gripAlign();
      if (this.picker && this.aglM() < ZOOM_MIN_AGL_M) this.liftToClearance(); // the clearance wins over the grip when they disagree (a ridge under the cursor)
      if (r) {
        this.velAxis = r.axis;
        this.velRate = this.velRate * 0.4 + (r.angle / dt) * 0.6;
        this.velWeight = this.grip.w;
      } else {
        this.velRate *= 0.4;
      }
      this.dragPrev = { x: px, y: py, t: now };
      return;
    }
    const a = this.grab(this.dragPrev.x, this.dragPrev.y);
    const b = this.grab(px, py);
    const r = this.align(b, a);
    if (r) {
      const rate = r.angle / dt;
      // Smooth the release velocity a little; the direction of the last move wins.
      this.velAxis = r.axis;
      this.velRate = this.velRate * 0.4 + rate * 0.6;
      this.velWeight = 0;
    } else {
      this.velRate *= 0.4;
    }
    this.dragPrev = { x: px, y: py, t: now };
  }

  dragEnd(now: number): void {
    // A pause before release means no fling.
    if (now - this.dragPrev.t > 0.08) this.velRate = 0;
    this.dragging = false;
    this.grip = null;
  }

  /**
   * Right-drag: heading from horizontal motion, tilt from vertical motion. The tilt limit is the user's (TILT_MAX_DEG, in the RTS regime
   * RTS_TILT_MIN_DEG to RTS_TILT_MAX_DEG); a ground view that starts above it (`?view=`, tilt about 87) can only be tilted DOWN from there,
   * so the first drag never jumps the picture. In the RTS regime the turn is about the ground point at the centre of the screen.
   */
  rotateBy(dxPx: number, dyPx: number): void {
    const w = this.rtsWeight;
    if (w <= 0) {
      this.setViewKeepMotion({ heading: wrapLon(this.s.heading + dxPx * ROTATE_DEG_PER_PX), tilt: clamp(this.s.tilt + dyPx * ROTATE_DEG_PER_PX, 0, Math.max(TILT_MAX_DEG, this.s.tilt)) });
      return;
    }
    const b = this.tiltLimits(w);
    const t0 = this.effectiveTilt(w);
    const wanted = clamp(t0 + dyPx * ROTATE_DEG_PER_PX, Math.min(b.min, t0), Math.max(b.max, t0));
    const pivot = this.pivotPoint(w);
    this.turnAbout(pivot, dxPx * ROTATE_DEG_PER_PX, wanted - t0);
    const err = wanted - this.effectiveTilt(w); // the tilt measure is not linear in the turn about the pivot: one correction
    if (wanted !== t0 && Math.abs(err) > 1e-7) this.turnAbout(pivot, 0, err);
    this.liftToClearance();
    this.holdAglM = Math.max(this.aglM(), ZOOM_MIN_AGL_M);
  }

  /** Two-finger rotate: the compass heading turns by `deg` about the ground point the fingers hold (or the centre of the screen). */
  yawBy(deg: number): void {
    const w = this.rtsWeight;
    const pivot = this.grip ? scale(this.grip.dir, this.grip.r) : this.pivotPoint(w);
    this.turnAbout(pivot, deg, 0);
    this.liftToClearance();
    if (this.grip) this.gripAlign();
    this.holdAglM = Math.max(this.aglM(), ZOOM_MIN_AGL_M);
  }

  private setViewKeepMotion(v: Partial<ViewState>): void {
    this.s = { ...this.s, ...v };
  }

  /**
   * The point the camera turns about in the RTS regime: on the look ray at the centre of the screen, between the sea-level focus (weight 0:
   * the globe's pivot) and the ground the ray meets first (weight 1).
   */
  private pivotPoint(w: number): Vec3 {
    const pose = this.pose();
    const c = pose.position;
    const dF = length(sub(pose.target, c));
    let t = dF;
    if (w > 0 && this.picker) {
      const hit = this.picker(c, pose.forward);
      if (hit) t = dF + w * (length(sub(hit, c)) - dF);
    }
    return add(c, scale(pose.forward, t));
  }

  /**
   * Turns the camera about the point `pivot` on its look ray: `yawDeg` about the vertical there (the compass heading grows with it) and
   * `tiltDeg` about the horizontal across the view (positive = toward the horizon). The camera keeps its distance to the pivot. Pose maths:
   * the orbit state is rebuilt from the new position and look direction.
   */
  private turnAbout(pivot: Vec3, yawDeg: number, tiltDeg: number): void {
    const pose = this.pose();
    let c = pose.position;
    let f = pose.forward;
    if (tiltDeg !== 0) {
      const dq = length(sub(pivot, c));
      f = rotateAbout(f, pose.right, tiltDeg * DEG);
      c = sub(pivot, scale(f, dq));
    }
    if (yawDeg !== 0) {
      const u = normalize(pivot);
      const a = -yawDeg * DEG;
      c = rotateAbout(c, u, a);
      f = rotateAbout(f, u, a);
    }
    this.adoptView(viewFromPose(c, f, this.s.heading));
  }

  /** Wheel zoom anchored at the cursor: the point under the cursor stays under the cursor while the distance eases to the target. */
  zoomAt(px: number, py: number, wheelDelta: number): void {
    const f = Math.exp(wheelDelta * WHEEL_ZOOM_RATE);
    const w = this.rtsWeight;
    if (this.ground) {
      // Steps proportional to the height: the share `f` is taken of the camera's height above the ground (the one of the TARGET view, so
      // that quick wheel turns accumulate), and the distance that has the new height is solved for. The steps shrink as the ground comes
      // near, a step in never goes below the floor, and a step out from the floor leaves it.
      const agl = Math.max(this.aglM({ ...this.s, distKm: this.targetDistKm }), ZOOM_MIN_AGL_M);
      this.targetAglM = Math.max(agl * f, ZOOM_MIN_AGL_M);
      this.targetDistKm = clamp(distForAgl(this.s, this.ground, this.targetAglM), DIST_MIN_GROUND_KM, DIST_MAX_KM);
      this.holdAglM = w > 0 ? this.targetAglM : null;
    } else {
      this.targetDistKm = clamp(this.targetDistKm * f, DIST_MIN_KM, DIST_MAX_KM);
    }
    let r = 1;
    if (w > 0 && this.picker) {
      const ray = this.rayAt(px, py);
      const P = this.picker(ray.origin, ray.dir);
      if (P) r = 1 + w * (length(P) - 1);
    }
    this.anchor = { x: px, y: py, r };
    this.velRate = 0;
  }

  /** Integrates inertia and zoom up to fx time `now` (steps of at most CAMERA_MAX_STEP_S). */
  update(now: number): void {
    if (this.lastNow === null) this.lastNow = now;
    let remaining = now - this.lastNow;
    const total = remaining;
    this.lastNow = now;
    if (!(remaining > 0)) return;
    if (this.targetAglM !== null && this.ground) this.targetDistKm = clamp(distForAgl(this.s, this.ground, this.targetAglM), DIST_MIN_GROUND_KM, DIST_MAX_KM);
    while (remaining > 1e-9) {
      const dt = Math.min(remaining, CAMERA_MAX_STEP_S);
      remaining -= dt;
      if (!this.dragging && this.velRate > 1e-4) {
        this.rotateFocus(this.velAxis, this.velRate * dt, this.velWeight);
        this.velRate *= Math.exp(-dt / INERTIA_TAU_S);
        if (this.velRate <= 1e-4) this.velRate = 0;
      }
      const logGap = Math.log(this.targetDistKm / this.s.distKm);
      if (Math.abs(logGap) > 1e-4) {
        const anchor = this.anchor;
        const before = anchor ? this.grab(anchor.x, anchor.y, anchor.r) : null;
        const next = this.s.distKm * Math.exp(logGap * (1 - Math.exp(-dt / ZOOM_TAU_S)));
        this.s = { ...this.s, distKm: clamp(next, this.ground ? DIST_MIN_GROUND_KM : DIST_MIN_KM, DIST_MAX_KM) };
        // a zoom in brings the tilt into the RTS limits WHILE it runs, so the anchored point stays under the cursor through the pitch too
        if (anchor) this.pitchIntoLimits(dt);
        if (before && anchor) this.align(this.grab(anchor.x, anchor.y, anchor.r), before, true);
      } else {
        if (this.s.distKm !== this.targetDistKm) this.s = { ...this.s, distKm: this.targetDistKm };
        // a wheel zoom that has settled in the RTS regime keeps the height it reached (the user took the camera)
        if (this.anchor !== null && this.holdAglM === null && this.ground && this.picker && this.rtsWeight > 0) this.holdAglM = Math.max(this.aglM(), ZOOM_MIN_AGL_M);
        this.anchor = null;
        this.targetAglM = null;
      }
    }
    this.rtsSettle(total);
    this.keepAboveGround();
  }

  /**
   * The RTS regime between the user's inputs (D155): the tilt is brought into the RTS limits, and the camera follows the ground at the height
   * the user chose, both eased on the fx clock. A drag that is still under way keeps its ground point under the cursor through every change.
   * Nothing here runs for a camera the user has not touched (`holdAglM` null: the test hooks, a classic flight).
   */
  private rtsSettle(dt: number): void {
    const hold = this.holdAglM;
    if (hold === null || !this.ground || !this.picker || this.targetAglM !== null) return;
    if (this.anchor === null && this.stampSame(hold)) {
      // nothing moved since the last pass found nothing to do
      if (this.grip && this.dragging) this.gripAlign();
      return;
    }
    let changed = false;
    const w = this.rtsWeight;
    if (w > 0) {
      // 1. the tilt back into the limits: the camera pitches in place (a turn about the ground point would lift it by the leverage of the distance)
      if (this.pitchIntoLimits(dt)) changed = true;
      // 2. the height over the ground
      const p = cameraPositionFor(this.s);
      const g = vecToLatLon(p);
      const r = length(p);
      const wantR = this.ground(g.lat, g.lon) + hold / R_M;
      if (Math.abs(wantR - r) * R_M > RTS_FOLLOW_EPS_M) {
        const k = 1 - Math.exp(-dt / RTS_FOLLOW_TAU_S);
        const pose = this.pose();
        this.adoptView(viewFromPose(scale(pose.position, (r + (wantR - r) * k) / r), pose.forward, this.s.heading));
        changed = true;
      }
      if (this.grip && this.dragging) this.gripAlign();
    }
    if (!changed) this.markStamp(hold);
  }

  /** One step of the tilt toward its limits at the camera's weight, by pitching in place at RTS_TILT_EASE_DEG_PER_S; true when it moved. */
  private pitchIntoLimits(dt: number): boolean {
    const w = this.rtsWeight;
    if (w <= 0) return false;
    const b = this.tiltLimits(w);
    const tl = this.effectiveTilt(w);
    const want = clamp(tl, b.min, b.max);
    if (Math.abs(want - tl) <= 0.01) return false;
    this.turnAbout(this.pose().position, 0, clamp(want - tl, -RTS_TILT_EASE_DEG_PER_S * dt, RTS_TILT_EASE_DEG_PER_S * dt));
    return true;
  }

  private stampSame(hold: number): boolean {
    const st = this.followStamp;
    const s = this.s;
    return st.lat === s.lat && st.lon === s.lon && st.distKm === s.distKm && st.heading === s.heading && st.tilt === s.tilt && st.hold === hold;
  }

  private markStamp(hold: number): void {
    const st = this.followStamp;
    const s = this.s;
    st.lat = s.lat;
    st.lon = s.lon;
    st.distKm = s.distKm;
    st.heading = s.heading;
    st.tilt = s.tilt;
    st.hold = hold;
  }

  /**
   * The terrain floor: a zoom that anchors at the cursor, a drag or an inertia glide moves the camera over other ground, and a ridge
   * must not cut through it. One cheap height test per frame; the search only runs when the camera is below the floor.
   */
  private keepAboveGround(): void {
    if (!this.ground || this.s.distKm > FLOOR_SEARCH_KM) return;
    if (this.aglM() >= ZOOM_MIN_AGL_M) return;
    if (this.picker) {
      this.liftToClearance();
      return;
    }
    const floor = this.floorKm();
    if (this.s.distKm < floor) this.s = { ...this.s, distKm: floor };
    if (this.targetDistKm < floor) this.targetDistKm = floor;
  }

  /**
   * The RTS camera's clearance: straight up to ZOOM_MIN_AGL_M over the ground under it, nothing else changes (the look direction stays). The
   * distance floor of the globe regime is "the lowest distance along the line from the focus that is high enough"; from a focus 100 km under
   * a ridge that line leaves the mountain, climbs, and meets the next ridge, so the camera could stand inside it. Returns true when it lifted.
   */
  private liftToClearance(): boolean {
    if (!this.ground) return false;
    const p = cameraPositionFor(this.s);
    const g = vecToLatLon(p);
    const r = length(p);
    const wantR = this.ground(g.lat, g.lon) + (ZOOM_MIN_AGL_M + 1e-3) / R_M;
    if (r >= wantR) return false;
    const pose = this.pose();
    this.adoptView(viewFromPose(scale(pose.position, wantR / r), pose.forward, this.s.heading));
    return true;
  }
}

/**
 * Puts the camera of `rig` at `altAglM` metres above the ground under it: the view `v` (focus, heading, tilt) with a distance chosen
 * so that the camera's height above `surfaceRadius(lat, lon)` (the displaced ground under the CAMERA, in Earth radii) equals the
 * wanted one. Along the line from the focus point outward the first distance at which the camera clears the ground is searched by a
 * geometric scan and bisection (a fixed-point iteration does not converge on a steep slope: the ground moves faster than the camera).
 * The user's zoom limit and the tilt clamp do not apply (tilt up to 89.5 degrees). Used by the test hook `altAglM` and the tests.
 */
export function setViewAtAgl(rig: CameraRig, surfaceRadius: GroundRadius, v: Partial<ViewState>, altAglM: number): void {
  rig.setViewUnclamped({ ...v, distKm: 0.001 });
  rig.setViewUnclamped({ distKm: distForAgl(rig.view, surfaceRadius, altAglM) });
}

/** A camera named by where it IS: over `lat`, `lon`, `aglM` metres above the displaced ground there, looking along `heading` with its axis `pitchDeg` below the horizon. */
export interface GroundCameraSpec {
  lat: number;
  lon: number;
  /** Compass bearing of the look direction, degrees (0 = north). */
  heading: number;
  /**
   * Degrees the look direction points below the local horizontal. The orbit rig always looks at a point of the sea-level sphere, so a
   * direction above the sea-level horizon (its dip angle is acos(1 / radius): 5.7 degrees on a camera over 30 km of x12 Alps) is aimed
   * at the sea-level horizon instead: the middle of the picture is never above it.
   */
  pitchDeg: number;
  /** Metres above the displaced ground under the camera. */
  aglM: number;
}

/**
 * The orbit-rig view (focus on the sea-level sphere, distance, heading, tilt) of a camera given by its position, heading and pitch. The
 * orbit rig always looks at a point on the sea-level sphere, and the x12 terrain stands up to 100 km above it, so a camera 2 km above
 * the ground that looks toward the horizon has its focus hundreds of kilometres away: the ray along the look direction meets the sphere
 * there. The returned view reproduces the position and the look direction exactly (a test checks both); the tilt can be above the
 * user's limit, so apply it with `setViewUnclamped`.
 */
export function viewFromGroundCamera(spec: GroundCameraSpec, surfaceRadius: GroundRadius): ViewState {
  const U = latLonToVec(spec.lat, spec.lon);
  const E0 = eastAt(spec.lon);
  const N0 = northAt(spec.lat, spec.lon);
  const h = spec.heading * DEG;
  const H = add(scale(N0, Math.cos(h)), scale(E0, Math.sin(h)));
  const pitch = spec.pitchDeg * DEG;
  const origin = scale(U, surfaceRadius(spec.lat, spec.lon) + spec.aglM / (EARTH_RADIUS_KM * 1000));
  const dir = add(scale(H, Math.cos(pitch)), scale(U, -Math.sin(pitch)));
  return viewFromPose(origin, dir);
}
