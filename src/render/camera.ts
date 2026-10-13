// Orbit / arcball camera for the globe. Pure maths (no three, no DOM) so that it can be unit-tested in Node.
//
// State: the focus point on the sea-level sphere (lat, lon), the compass bearing the camera looks toward (heading,
// 0 = north up), the tilt away from straight down, and the distance to the focus point. The up vector is built from
// the analytic east/north frame, so it is defined at the poles too. All cosmetic motion (inertia, zoom smoothing)
// integrates on the fx clock: `update(fxNow())`.
import {
  CAMERA_FOV_DEG,
  CAMERA_MAX_STEP_S,
  DIST_MAX_KM,
  DIST_MIN_KM,
  EARTH_RADIUS_KM,
  INERTIA_TAU_S,
  LAT_LIMIT_DEG,
  ROTATE_DEG_PER_PX,
  TILT_MAX_DEG,
  WHEEL_ZOOM_RATE,
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

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

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
      distKm: clamp(n.distKm, DIST_MIN_KM, DIST_MAX_KM),
      heading: wrapLon(n.heading),
      tilt: clamp(n.tilt, 0, TILT_MAX_DEG),
    };
    this.targetDistKm = this.s.distKm;
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

  /** Right-drag: heading from horizontal motion, tilt from vertical motion. */
  rotateBy(dxPx: number, dyPx: number): void {
    this.setViewKeepMotion({ heading: wrapLon(this.s.heading + dxPx * ROTATE_DEG_PER_PX), tilt: clamp(this.s.tilt + dyPx * ROTATE_DEG_PER_PX, 0, TILT_MAX_DEG) });
  }

  private setViewKeepMotion(v: Partial<ViewState>): void {
    this.s = { ...this.s, ...v };
  }

  /** Wheel zoom anchored at the cursor: the point under the cursor stays under the cursor while the distance eases to the target. */
  zoomAt(px: number, py: number, wheelDelta: number): void {
    const f = Math.exp(wheelDelta * WHEEL_ZOOM_RATE);
    this.targetDistKm = clamp(this.targetDistKm * f, DIST_MIN_KM, DIST_MAX_KM);
    this.anchor = { x: px, y: py };
    this.velRate = 0;
  }

  /** Integrates inertia and zoom up to fx time `now` (steps of at most CAMERA_MAX_STEP_S). */
  update(now: number): void {
    if (this.lastNow === null) this.lastNow = now;
    let remaining = now - this.lastNow;
    this.lastNow = now;
    if (!(remaining > 0)) return;
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
        this.s = { ...this.s, distKm: clamp(next, DIST_MIN_KM, DIST_MAX_KM) };
        if (before && this.anchor) this.align(this.grab(this.anchor.x, this.anchor.y), before, true);
      } else {
        if (this.s.distKm !== this.targetDistKm) this.s = { ...this.s, distKm: this.targetDistKm };
        this.anchor = null;
      }
    }
  }
}
