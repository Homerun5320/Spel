// The maths of the RTS camera (M08, D155), pure: no three, no DOM, no state. `CameraRig` (src/render/camera.ts) and `CameraFlight`
// (src/render/flyTo.ts) call these; the unit tests call them directly.
//
// TWO WAYS TO NAME THE SAME CAMERA. The orbit rig stores a focus on the sea-level sphere, a distance, a heading and a tilt
// (`ViewState`). That is the right thing for a globe, and the wrong thing for a camera 300 m over the x12 Himalaya: the focus is then
// 60 km below the ground and a turn about it swings the camera through the mountain. The RTS operations therefore work on the camera's
// POSE (position and look direction, `viewFromPose` turns a pose back into the rig's state exactly) and flights work on the camera MODEL
// (ground position, height above the ground, heading, tilt: what a person means by "fly there, 2 km up, looking north-east").
import { EARTH_RADIUS_KM, RTS_AGL_FULL_M, RTS_AGL_GLOBE_M, RTS_TILT_MAX_DEG, RTS_TILT_MIN_DEG, TILT_MAX_DEG } from './config';
import { DEG, add, dot, eastAt, latLonToVec, length, normalize, northAt, scale, sub, vecToLatLon, wrapLon, type Vec3 } from './geo';
import { nearestSpherePoint, raySphere } from './heightField';
import type { GroundRadius, ViewState } from './camera';

const R_M = EARTH_RADIUS_KM * 1000;
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/**
 * The weight of the RTS camera, 0 (globe) to 1 (RTS), from the camera's height above the ground in metres: a smoothstep of the
 * logarithm of the height between `RTS_AGL_GLOBE_M` (0) and `RTS_AGL_FULL_M` (1). Continuous, monotone, no step anywhere.
 */
export function rtsMix(aglM: number): number {
  if (!(aglM < RTS_AGL_GLOBE_M)) return 0;
  if (aglM <= RTS_AGL_FULL_M) return 1;
  const x = Math.log(RTS_AGL_GLOBE_M / aglM) / Math.log(RTS_AGL_GLOBE_M / RTS_AGL_FULL_M);
  return x * x * (3 - 2 * x);
}

/** The tilt limits (degrees from straight down) at a mix weight: [0, TILT_MAX_DEG] for the globe, [RTS_TILT_MIN_DEG, RTS_TILT_MAX_DEG] for the RTS camera. */
export function tiltBounds(w: number): { min: number; max: number } {
  return { min: RTS_TILT_MIN_DEG * w, max: TILT_MAX_DEG + (RTS_TILT_MAX_DEG - TILT_MAX_DEG) * w };
}

/**
 * The orbit-rig state of a camera given by its pose: the look ray meets the sea-level sphere at the focus (a ray above the horizon is
 * aimed at the horizon instead, the nearest point of the sphere), the distance is the way from there, the tilt the angle at the focus
 * between the vertical and the camera, the heading the compass bearing of the look direction at the focus. `fallbackHeading` is
 * used when the camera looks straight down (the bearing is undefined).
 */
export function viewFromPose(origin: Vec3, forward: Vec3, fallbackHeading = 0): ViewState {
  const d = normalize(forward);
  const t = raySphere(origin, d, 1);
  const F = normalize(t === null ? nearestSpherePoint(origin, d) : add(origin, scale(d, t)));
  const toCam = sub(origin, F);
  const dist = Math.max(length(toCam), 1e-12);
  const offset = scale(toCam, 1 / dist);
  const tilt = Math.acos(clamp(dot(offset, F), -1, 1)) / DEG;
  const fwd = scale(offset, -1);
  const tangential = sub(fwd, scale(F, dot(fwd, F)));
  const { lat, lon } = vecToLatLon(F);
  const heading = length(tangential) < 1e-9 ? fallbackHeading : Math.atan2(dot(tangential, eastAt(lon)), dot(tangential, northAt(lat, lon))) / DEG;
  return { lat, lon, distKm: dist * EARTH_RADIUS_KM, heading: wrapLon(heading), tilt };
}

/** A camera named the way a flight thinks of it. `tilt` is the angle between the look direction and straight down AT THE CAMERA. */
export interface CameraModel {
  /** Ground position of the camera (the point under it). */
  lat: number;
  lon: number;
  /** Height above the ground under the camera, metres. */
  aglM: number;
  /** Compass bearing of the look direction's horizontal part, degrees. */
  heading: number;
  tilt: number;
}

/** The model of a pose; `ground` is the radius of the ground (Earth radii) under a position. */
export function modelFromPose(position: Vec3, forward: Vec3, ground: GroundRadius, fallbackHeading = 0): CameraModel {
  const r = length(position);
  const u = scale(position, 1 / r);
  const { lat, lon } = vecToLatLon(position);
  const down = -dot(forward, u);
  const tangential = sub(forward, scale(u, dot(forward, u)));
  const heading = length(tangential) < 1e-9 ? fallbackHeading : Math.atan2(dot(tangential, eastAt(lon)), dot(tangential, northAt(lat, lon))) / DEG;
  return { lat, lon, aglM: (r - ground(lat, lon)) * R_M, heading: wrapLon(heading), tilt: Math.acos(clamp(down, -1, 1)) / DEG };
}

/** The pose of a model at the given absolute radius (Earth radii) over its ground position. */
export function poseFromModel(m: CameraModel, radius: number): { position: Vec3; forward: Vec3 } {
  const u = latLonToVec(m.lat, m.lon);
  const h = m.heading * DEG;
  const T = add(scale(northAt(m.lat, m.lon), Math.cos(h)), scale(eastAt(m.lon), Math.sin(h)));
  const t = m.tilt * DEG;
  return { position: scale(u, radius), forward: add(scale(u, -Math.cos(t)), scale(T, Math.sin(t))) };
}

/**
 * The camera of a place seen from a direction: it looks at the ground point `ground` (a world point on the displaced surface) from
 * `heading` and `tilt` (degrees from straight down at that point), at the lowest distance whose camera is `altAglM` metres over the
 * displaced ground under IT (geometric scan and bisection along the line from the point, the same solver as `distForAgl`).
 */
export function cameraLookingAt(ground: Vec3, heading: number, tilt: number, groundRadius: GroundRadius, altAglM: number): { position: Vec3; forward: Vec3 } {
  const { lat, lon } = vecToLatLon(ground);
  const u = normalize(ground);
  const h = heading * DEG;
  const T = add(scale(northAt(lat, lon), Math.cos(h)), scale(eastAt(lon), Math.sin(h)));
  const t = tilt * DEG;
  const offset = sub(scale(u, Math.cos(t)), scale(T, Math.sin(t))); // from the ground point toward the camera
  const target = altAglM / R_M;
  const f = (d: number): number => {
    const p = add(ground, scale(offset, d));
    const g = vecToLatLon(p);
    return length(p) - groundRadius(g.lat, g.lon) - target;
  };
  let lo = 1e-9;
  let hi = lo;
  let fhi = f(hi);
  for (let i = 0; i < 300 && fhi < 0; i++) {
    lo = hi;
    hi *= 1.15;
    fhi = f(hi);
  }
  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi);
    if (f(mid) < 0) lo = mid;
    else hi = mid;
  }
  return { position: add(ground, scale(offset, hi)), forward: scale(offset, -1) };
}

/** The shortest signed angle in degrees from `from` to `to`. */
export function shortestAngle(from: number, to: number): number {
  let d = (to - from) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}
