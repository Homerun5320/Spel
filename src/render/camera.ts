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
  // Inertia: rotation of the focus about a world axis.
  private velAxis: Vec3 = [0, 1, 0];
  private velRate = 0;
  private dragging = false;
  private dragPrev = { x: 0, y: 0, t: 0 };
  private anchor: { x: number; y: number } | null = null;
  // The displaced ground under a position, when the terrain is known (the chunk terrain): the zoom then stops ZOOM_MIN_AGL_M above it.
  private ground: GroundRadius | null = null;
  // The height the wheel asked for (metres above the ground) while a terrain-aware zoom is under way: the anchor moves the focus over other
  // ground as the camera comes down, so the distance that has this height is solved again every frame until the zoom has settled.
  private targetAglM: number | null = null;

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
   * it (over the sea about 1 km, over the Himalaya 1 km above a ground that the x12 exaggeration put 100 km up), and a wheel step is a
   * share of the height above the ground, so it gets finer the nearer the ground. `null` gives the old fixed minimum distance back.
   */
  setGround(ground: GroundRadius | null): void {
    this.ground = ground;
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
    this.targetDistKm = this.s.distKm;
    this.targetAglM = null;
    this.velRate = 0;
    this.anchor = null;
    this.dragging = false;
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
    this.targetDistKm = this.s.distKm;
    this.targetAglM = null;
    this.velRate = 0;
    this.anchor = null;
    this.dragging = false;
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

  /** Sea-level sphere point under a pixel; when the pixel misses the disc, the nearest point of the sphere. */
  private grab(px: number, py: number): Vec3 {
    const { origin, dir } = this.rayAt(px, py);
    const t = raySphere(origin, dir, 1);
    return t === null ? nearestSpherePoint(origin, dir) : add(origin, scale(dir, t));
  }

  /** Moves the focus by rotating it about the world axis (clamps the latitude to the interaction limit). */
  private rotateFocus(axis: Vec3, angle: number, withHeading = false): void {
    const F = rotateAbout(latLonToVec(this.s.lat, this.s.lon), axis, angle);
    const { lat, lon } = vecToLatLon(F);
    const next = { ...this.s, lat: clamp(lat, -LAT_LIMIT_DEG, LAT_LIMIT_DEG), lon: wrapLon(lon) };
    if (withHeading) {
      // Rotate the look direction rigidly with the focus: the grabbed point stays exactly under the cursor, and the
      // heading follows (the small roll of a trackball). The frame is analytic, so this is defined at the poles too.
      const h = this.s.heading * DEG;
      const T = add(scale(northAt(this.s.lat, this.s.lon), Math.cos(h)), scale(eastAt(this.s.lon), Math.sin(h)));
      const T2 = rotateAbout(T, axis, angle);
      const heading = Math.atan2(dot(T2, eastAt(lon)), dot(T2, northAt(lat, lon))) / DEG;
      if (Number.isFinite(heading)) next.heading = wrapLon(heading);
    }
    this.s = next;
  }

  /** Rotates the focus so that sphere point `b` (seen at the cursor now) returns to `a` (where the cursor grabbed it). Returns axis and angle. */
  private align(b: Vec3, a: Vec3, withHeading = false): { axis: Vec3; angle: number } | null {
    const c = cross(b, a);
    const sin = length(c);
    if (sin < 1e-12) return null;
    const angle = Math.atan2(sin, dot(b, a));
    const axis = scale(c, 1 / sin);
    this.rotateFocus(axis, angle, withHeading);
    return { axis, angle };
  }

  // --- Mouse ------------------------------------------------------------------------------------------------------

  dragStart(px: number, py: number, now: number): void {
    this.dragging = true;
    this.velRate = 0;
    this.anchor = null;
    this.targetAglM = null;
    this.dragPrev = { x: px, y: py, t: now };
  }

  /** Grab-the-globe drag: the sphere point under the cursor stays under the cursor. */
  dragMove(px: number, py: number, now: number): void {
    if (!this.dragging) return;
    const a = this.grab(this.dragPrev.x, this.dragPrev.y);
    const b = this.grab(px, py);
    const r = this.align(b, a);
    const dt = Math.max(1 / 240, now - this.dragPrev.t);
    if (r) {
      const rate = r.angle / dt;
      // Smooth the release velocity a little; the direction of the last move wins.
      this.velAxis = r.axis;
      this.velRate = this.velRate * 0.4 + rate * 0.6;
    } else {
      this.velRate *= 0.4;
    }
    this.dragPrev = { x: px, y: py, t: now };
  }

  dragEnd(now: number): void {
    // A pause before release means no fling.
    if (now - this.dragPrev.t > 0.08) this.velRate = 0;
    this.dragging = false;
  }

  /**
   * Right-drag: heading from horizontal motion, tilt from vertical motion. The tilt limit is the user's (TILT_MAX_DEG); a ground view that
   * starts above it (`?view=`, tilt about 87) can only be tilted DOWN from there, so the first drag never jumps the picture.
   */
  rotateBy(dxPx: number, dyPx: number): void {
    this.setViewKeepMotion({ heading: wrapLon(this.s.heading + dxPx * ROTATE_DEG_PER_PX), tilt: clamp(this.s.tilt + dyPx * ROTATE_DEG_PER_PX, 0, Math.max(TILT_MAX_DEG, this.s.tilt)) });
  }

  private setViewKeepMotion(v: Partial<ViewState>): void {
    this.s = { ...this.s, ...v };
  }

  /** Wheel zoom anchored at the cursor: the point under the cursor stays under the cursor while the distance eases to the target. */
  zoomAt(px: number, py: number, wheelDelta: number): void {
    const f = Math.exp(wheelDelta * WHEEL_ZOOM_RATE);
    if (this.ground) {
      // Steps proportional to the height: the share `f` is taken of the camera's height above the ground (the one of the TARGET view, so
      // that quick wheel turns accumulate), and the distance that has the new height is solved for. The steps shrink as the ground comes
      // near, a step in never goes below the floor, and a step out from the floor leaves it.
      const agl = Math.max(this.aglM({ ...this.s, distKm: this.targetDistKm }), ZOOM_MIN_AGL_M);
      this.targetAglM = Math.max(agl * f, ZOOM_MIN_AGL_M);
      this.targetDistKm = clamp(distForAgl(this.s, this.ground, this.targetAglM), DIST_MIN_GROUND_KM, DIST_MAX_KM);
    } else {
      this.targetDistKm = clamp(this.targetDistKm * f, DIST_MIN_KM, DIST_MAX_KM);
    }
    this.anchor = { x: px, y: py };
    this.velRate = 0;
  }

  /** Integrates inertia and zoom up to fx time `now` (steps of at most CAMERA_MAX_STEP_S). */
  update(now: number): void {
    if (this.lastNow === null) this.lastNow = now;
    let remaining = now - this.lastNow;
    this.lastNow = now;
    if (!(remaining > 0)) return;
    if (this.targetAglM !== null && this.ground) this.targetDistKm = clamp(distForAgl(this.s, this.ground, this.targetAglM), DIST_MIN_GROUND_KM, DIST_MAX_KM);
    while (remaining > 1e-9) {
      const dt = Math.min(remaining, CAMERA_MAX_STEP_S);
      remaining -= dt;
      if (!this.dragging && this.velRate > 1e-4) {
        this.rotateFocus(this.velAxis, this.velRate * dt);
        this.velRate *= Math.exp(-dt / INERTIA_TAU_S);
        if (this.velRate <= 1e-4) this.velRate = 0;
      }
      const logGap = Math.log(this.targetDistKm / this.s.distKm);
      if (Math.abs(logGap) > 1e-4) {
        const before = this.anchor ? this.grab(this.anchor.x, this.anchor.y) : null;
        const next = this.s.distKm * Math.exp(logGap * (1 - Math.exp(-dt / ZOOM_TAU_S)));
        this.s = { ...this.s, distKm: clamp(next, this.ground ? DIST_MIN_GROUND_KM : DIST_MIN_KM, DIST_MAX_KM) };
        if (before && this.anchor) this.align(this.grab(this.anchor.x, this.anchor.y), before, true);
      } else {
        if (this.s.distKm !== this.targetDistKm) this.s = { ...this.s, distKm: this.targetDistKm };
        this.anchor = null;
        this.targetAglM = null;
      }
    }
    this.keepAboveGround();
  }

  /**
   * The terrain floor: a zoom that anchors at the cursor, a drag or an inertia glide moves the camera over other ground, and a ridge
   * must not cut through it. One cheap height test per frame; the search only runs when the camera is below the floor.
   */
  private keepAboveGround(): void {
    if (!this.ground || this.s.distKm > FLOOR_SEARCH_KM) return;
    if (this.aglM() >= ZOOM_MIN_AGL_M) return;
    const floor = this.floorKm();
    if (this.s.distKm < floor) this.s = { ...this.s, distKm: floor };
    if (this.targetDistKm < floor) this.targetDistKm = floor;
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
  const t = raySphere(origin, dir, 1);
  const F = normalize(t === null ? nearestSpherePoint(origin, dir) : add(origin, scale(dir, t)));
  const toCam = sub(origin, F);
  const dist = length(toCam);
  const offset = scale(toCam, 1 / dist);
  const tilt = Math.acos(clamp(dot(offset, F), -1, 1)) / DEG;
  const forward = scale(offset, -1);
  const tangential = sub(forward, scale(F, dot(forward, F)));
  const { lat, lon } = vecToLatLon(F);
  const heading = Math.atan2(dot(tangential, eastAt(lon)), dot(tangential, northAt(lat, lon))) / DEG;
  return { lat, lon, distKm: dist * EARTH_RADIUS_KM, heading: wrapLon(heading), tilt };
}
