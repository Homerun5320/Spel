// The outline of the globe's disc on the screen of a camera rig, from first principles (CamFix, D158): the points of the sphere where a ray from the camera just touches it
// (a circle on the sphere, perpendicular to the direction to the planet's centre), projected with `CameraRig.project`. It does not use `src/render/fit.ts`, so it can check it.
import { CameraRig } from '../../src/render/camera';
import { EARTH_RADIUS_KM } from '../../src/render/config';
import { add, cross, dot, eastAt, latLonToVec, normalize, northAt, scale, sub, type Vec3 } from '../../src/render/geo';

export interface DiscBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  /** The middle of the box (not the disc's centre: the two differ for a tilted view, where the outline is an ellipse). */
  cx: number;
  cy: number;
  /** The free margin on each side as a share of the half-extent in that direction (negative: the disc leaves the picture). */
  marginLeft: number;
  marginRight: number;
  marginTop: number;
  marginBottom: number;
  /** The smallest of the four. */
  margin: number;
  /** The disc's largest reach from the middle of the picture as a share of the NARROWEST half-extent (what the acceptance calls "fills 55 to 80 %"). */
  fillOfNarrow: number;
  /** All the outline points are in front of the camera. */
  inFront: boolean;
}

export function discBox(rig: CameraRig, samples = 1440): DiscBox {
  const pose = rig.pose();
  const rho = Math.hypot(pose.position[0], pose.position[1], pose.position[2]);
  const toCentre = normalize(scale(pose.position, -1));
  // two unit vectors perpendicular to the direction to the planet's centre
  const helper: Vec3 = Math.abs(toCentre[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = normalize(cross(toCentre, helper));
  const v = cross(toCentre, u);
  // the tangent circle: at distance 1/rho from the centre along the direction to the camera, with radius sqrt(1 - 1/rho^2)
  const toCam = scale(toCentre, -1);
  const centre = scale(toCam, 1 / rho);
  const radius = Math.sqrt(Math.max(0, 1 - 1 / (rho * rho)));
  const { width, height } = rig.viewport;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let inFront = true;
  for (let i = 0; i < samples; i++) {
    const a = (2 * Math.PI * i) / samples;
    const p = add(centre, add(scale(u, radius * Math.cos(a)), scale(v, radius * Math.sin(a))));
    const s = rig.project(p, pose);
    if (!(s.depth > 0)) inFront = false;
    minX = Math.min(minX, s.x);
    maxX = Math.max(maxX, s.x);
    minY = Math.min(minY, s.y);
    maxY = Math.max(maxY, s.y);
  }
  const hw = width / 2;
  const hh = height / 2;
  const marginLeft = minX / hw;
  const marginRight = (width - maxX) / hw;
  const marginTop = minY / hh;
  const marginBottom = (height - maxY) / hh;
  const reachX = Math.max(hw - minX, maxX - hw) / hw;
  const reachY = Math.max(hh - minY, maxY - hh) / hh;
  const narrowIsX = hw < hh;
  return {
    minX,
    maxX,
    minY,
    maxY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    marginLeft,
    marginRight,
    marginTop,
    marginBottom,
    margin: Math.min(marginLeft, marginRight, marginTop, marginBottom),
    fillOfNarrow: narrowIsX ? reachX : reachY,
    inFront,
  };
}

/** True when the unit vectors point the same way within `eps`. */
export function sameDirection(a: Vec3, b: Vec3, eps = 1e-9): boolean {
  return 1 - dot(a, b) < eps;
}

/**
 * A rig (1000 pixels high, `aspect` times as wide) at the pose of a focus at 20 N 10 E, a distance, a tilt and a heading EXACTLY as the formulas of src/render/fit.ts see it:
 * `setPose` takes it as it is, with no eased tilt, so this is the camera the old limits allowed (42 000 km at tilt 72) and the camera the maths describes.
 */
export function rawPoseRig(aspect: number, distKm: number, tilt: number, heading: number): CameraRig {
  const h = 1000;
  const rig = new CameraRig(Math.round(h * aspect), h);
  const DEG = Math.PI / 180;
  const F = latLonToVec(20, 10);
  const T = add(scale(northAt(20, 10), Math.cos(heading * DEG)), scale(eastAt(10), Math.sin(heading * DEG)));
  const t = tilt * DEG;
  const offset = sub(scale(F, Math.cos(t)), scale(T, Math.sin(t)));
  rig.setPose(add(F, scale(offset, distKm / EARTH_RADIUS_KM)), scale(offset, -1));
  return rig;
}
