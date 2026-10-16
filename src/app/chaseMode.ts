// The chase camera (M13a-2): an input mode on the stack that rides along with one of your own helicopters. Every frame (`tick`, the fx clock) it reads the helicopter's
// drawn pose, smooths it (an exponential approach, so the 10 Hz hops of the table do not jerk the picture), puts the camera `HELI_CHASE_BACK_M` behind it and
// `HELI_CHASE_UP_M` above it, looking at it with a little extra look-down, and keeps the camera at least `HELI_CHASE_CLEAR_M` above the displaced ground under IT
// (the rig's own `groundRadius`). It uses only the camera's public functions (`viewFromGroundCamera`, `setViewUnclamped`): camera.ts, rts.ts and fit.ts are untouched.
// Escape (the stack), H, a press on the canvas and the wheel end it; the press and the wheel are NOT taken, so the same gesture goes on to drag or zoom the camera.
import { viewFromGroundCamera, type GroundRadius, type ViewState } from '../render/camera';
import { EARTH_RADIUS_KM, HELI_CHASE_BACK_M, HELI_CHASE_CLEAR_M, HELI_CHASE_LEAN_DEG, HELI_CHASE_SMOOTH_S, HELI_CHASE_UP_M } from '../render/config';
import { shortestAngle } from '../render/rts';
import type { InputMode, KeyInput } from './input';

const R_M = EARTH_RADIUS_KM * 1000;
const DEG = Math.PI / 180;

/** Where a helicopter is drawn: degrees, compass heading (0 = north, clockwise), and its radius from the planet's centre in Earth radii. */
export interface ChasePose {
  lat: number;
  lon: number;
  heading: number;
  radius: number;
}

export interface ChaseTarget {
  /** Fills `out` with the pose of helicopter `id`; false when it cannot be followed any more (landed home, shot down, gone). */
  read(id: number, out: ChasePose): boolean;
  /** The displaced ground under a latitude / longitude (the camera rig's own sampling). */
  groundRadius: GroundRadius;
  /** Applies the view to the camera. */
  apply(view: ViewState): void;
  /** The mode starts: a running camera flight must not fight it. */
  cancelFlight(): void;
  /** The mode asks to be popped (H, a press, the wheel, the helicopter is gone). */
  exit(lost: boolean): void;
  /** The mode was popped. */
  ended(): void;
}

export interface ChaseMode extends InputMode {
  readonly heli: number;
}

/**
 * The camera view for a smoothed pose: `back` metres behind along the heading, `up` metres above, never lower than `clear` metres above the ground under the camera,
 * looking at the helicopter (`leanDeg` further down). Pure; the mode and the tests use it.
 */
export function chaseView(pose: ChasePose, ground: GroundRadius, back = HELI_CHASE_BACK_M, up = HELI_CHASE_UP_M, clear = HELI_CHASE_CLEAR_M, leanDeg = HELI_CHASE_LEAN_DEG): ViewState {
  const h = pose.heading * DEG;
  const cosLat = Math.max(0.05, Math.cos(pose.lat * DEG));
  const lat = pose.lat - ((Math.cos(h) * back) / R_M) / DEG;
  const lon = pose.lon - ((Math.sin(h) * back) / (R_M * cosLat)) / DEG;
  const g = ground(lat, lon);
  const camR = Math.max(pose.radius + up / R_M, g + clear / R_M);
  const aglM = (camR - g) * R_M;
  const dh = (camR - pose.radius) * R_M;
  const pitchDeg = Math.atan2(dh, back) / DEG + leanDeg;
  return viewFromGroundCamera({ lat, lon, heading: pose.heading, pitchDeg, aglM }, ground);
}

export function createChaseMode(heli: number, target: ChaseTarget): ChaseMode {
  const raw: ChasePose = { lat: 0, lon: 0, heading: 0, radius: 1 };
  const sm: ChasePose = { lat: 0, lon: 0, heading: 0, radius: 1 };
  let lastNow = -1;
  let started = false;

  const follow = (now: number): void => {
    if (!target.read(heli, raw)) {
      target.exit(true);
      return;
    }
    if (!started) {
      sm.lat = raw.lat;
      sm.lon = raw.lon;
      sm.heading = raw.heading;
      sm.radius = raw.radius;
      started = true;
    } else {
      const dt = lastNow < 0 ? 0 : Math.max(0, Math.min(0.5, now - lastNow));
      const a = 1 - Math.exp(-dt / HELI_CHASE_SMOOTH_S);
      // the place follows exactly (a helicopter covers kilometres a tick: any lag would lose it); the heading and the height ease
      sm.lat = raw.lat;
      sm.lon = raw.lon;
      sm.heading = (sm.heading + shortestAngle(sm.heading, raw.heading) * a + 360) % 360;
      sm.radius += (raw.radius - sm.radius) * a;
    }
    if (now >= 0) lastNow = now;
    target.apply(chaseView(sm, target.groundRadius));
  };

  return {
    id: `chase:${heli}`,
    heli,
    onPush(): void {
      target.cancelFlight();
      follow(-1);
    },
    onPop(): void {
      target.ended();
    },
    tick(now: number): void {
      follow(now);
    },
    key(e: KeyInput): boolean {
      if (e.key !== 'h' && e.key !== 'H') return false;
      if (e.repeat !== true) target.exit(false);
      return true;
    },
    // a press or a wheel notch ends the ride and goes on to the camera below (a drag, a zoom)
    pointerDown(): boolean {
      target.exit(false);
      return false;
    },
    wheel(): boolean {
      target.exit(false);
      return false;
    },
  };
}
