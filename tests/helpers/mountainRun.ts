// CamFix item 6: the scripted measurement of the camera over mountains (D158). Pure code: the REAL height field (the detailed surface the chunk terrain draws), the camera
// rig as `Globe` builds it, the fx clock in steps of 1/60 s, inputs as the page gives them (`dragStart` / `dragMove` / `dragEnd`, `zoomAt`). It logs the camera's
// height over the ground, its radius (the height over the planet's centre) and the ground under it per frame and says how much of the terrain's roughness reaches the
// camera and how the zoom behaves between its inputs. The same script ran on the M08 head and on the v9 / M07b baseline (a git worktree of ec44223: the numbers are in
// docs/PROGRESS.md "Measurements CamFix"), so it uses only what both cameras have.
import { CameraRig, viewFromGroundCamera } from '../../src/render/camera';
import { groundPickerOf } from '../../src/render/transforms';
import { loadRtsWorld, R_M, type RtsWorld } from './rtsRig';

export const MOUNTAIN_PLACES = {
  Alps: { lat: 46.0, lon: 7.7 },
  Himalaya: { lat: 28.4, lon: 86.7 },
} as const;
export type MountainPlace = keyof typeof MOUNTAIN_PLACES;

export { loadRtsWorld };
export type { RtsWorld };

/** One run: per frame the height over the ground (m), the camera's radius (m from the planet's centre), the full-detail ground radius under it (m) and the distance to the focus (km). */
export interface FrameLog {
  agl: number[];
  r: number[];
  ground: number[];
  dist: number[];
  /** Frame index at which each input started (a stroke, a notch). */
  inputs: number[];
}

export function newLog(): FrameLog {
  return { agl: [], r: [], ground: [], dist: [], inputs: [] };
}

export function sampleFrame(rig: CameraRig, log: FrameLog): void {
  const agl = rig.aglM();
  const p = rig.pose().position;
  const r = Math.hypot(p[0], p[1], p[2]) * R_M;
  log.agl.push(agl);
  log.r.push(r);
  log.ground.push(r - agl);
  log.dist.push(rig.view.distKm);
}

/**
 * A rig as `Globe` builds it (the ground, the smooth ground of flights, the picker), with the camera `aglM` metres over `place`, looking north with its axis `90 - tilt` degrees
 * below the horizon (`viewFromGroundCamera`: the camera is named by where it is, the same call in every version of the camera). The user's hold is set by the first drag or zoom.
 */
export function rigOver(w: RtsWorld, place: MountainPlace, aglM: number, tilt: number, heading = 0): CameraRig {
  const rig = new CameraRig(960, 540);
  rig.setGround(w.ground, w.smooth);
  rig.setPicker(groundPickerOf(w.world.detailField));
  rig.setViewUnclamped(viewFromGroundCamera({ ...MOUNTAIN_PLACES[place], heading, pitchDeg: 90 - tilt, aglM }, w.ground));
  rig.update(0);
  return rig;
}

/**
 * Six drags of 500 px to the right (`strokeFrames` frames each: 48 is 0.8 s, 625 px/s, a fast pan; 96 is 312 px/s, a steady one; a small wobble of the cursor up and down as a
 * hand has), the cursor held still for 0.1 s and released, 0.2 s of rest, then 2 s of rest: the camera's height over the ground is the one the user holds throughout.
 */
export function runDrag(rig: CameraRig, strokeFrames = 48): FrameLog {
  const log = newLog();
  let t = 0;
  const frame = (): void => {
    t += 1 / 60;
    rig.update(t);
    sampleFrame(rig, log);
  };
  for (let stroke = 0; stroke < 6; stroke++) {
    log.inputs.push(log.agl.length);
    rig.dragStart(200, 330, t);
    for (let k = 1; k <= strokeFrames; k++) {
      t += 1 / 60;
      rig.dragMove(200 + (500 * k) / strokeFrames, 330 - 40 * Math.sin(k / 6), t);
      rig.update(t);
      sampleFrame(rig, log);
    }
    for (let k = 0; k < 6; k++) frame();
    rig.dragEnd(t);
    for (let k = 0; k < 12; k++) frame();
  }
  for (let k = 0; k < 120; k++) frame();
  return log;
}

/** Wheel notches (a notch every `frames` frames) with the cursor at (480, 300); the frame of each notch is in `inputs`. */
export function runZoom(rig: CameraRig, notches: readonly number[], frames = 90): FrameLog {
  const log = newLog();
  let t = 0;
  for (const n of notches) {
    log.inputs.push(log.agl.length);
    rig.zoomAt(480, 300, n);
    for (let k = 0; k < frames; k++) {
      t += 1 / 60;
      rig.update(t);
      sampleFrame(rig, log);
    }
  }
  return log;
}

export const rms = (xs: readonly number[]): number => Math.sqrt(xs.reduce((s, x) => s + x * x, 0) / Math.max(1, xs.length));

/** x minus its centred moving average over +-`half` frames: what is faster than about `2 * half` frames (the edges, where the window is cut, are dropped by the caller). */
export function highPass(xs: readonly number[], half: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    let s = 0;
    let n = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(xs.length - 1, i + half); j++) {
      s += xs[j] as number;
      n++;
    }
    out.push((xs[i] as number) - s / n);
  }
  return out;
}

/** The second difference per frame, as an acceleration per second squared (the frame step is 1/60 s). */
export function secondDiff(xs: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < xs.length - 1; i++) out.push(((xs[i + 1] as number) - 2 * (xs[i] as number) + (xs[i - 1] as number)) * 3600);
  return out;
}

/** How many times the direction of the series reverses (changes under `eps` per frame are not a direction). */
export function reversals(xs: readonly number[], eps: number): number {
  let n = 0;
  let prev = 0;
  for (let i = 1; i < xs.length; i++) {
    const d = (xs[i] as number) - (xs[i - 1] as number);
    if (Math.abs(d) < eps) continue;
    const s = Math.sign(d);
    if (prev !== 0 && s !== prev) n++;
    prev = s;
  }
  return n;
}

export interface DragMetrics {
  /** RMS of the camera's radius with everything slower than 1 s taken out (m), and the same for the ground radius under the camera: what the terrain does at that rate and what the camera does. */
  hfCamM: number;
  hfGroundM: number;
  /** hfCamM / hfGroundM: the share of the terrain's fast roughness that reaches the camera. */
  hfShare: number;
  /** The same two for everything faster than 1/6 s (the shake). */
  shakeCamM: number;
  shakeGroundM: number;
  /** The deepest the camera went under the height it holds, as a share of it (0 = never), and the lowest height (m). */
  dipShare: number;
  minAglM: number;
  /** The largest vertical acceleration of the camera's radius (m/s^2) and its RMS. */
  accMaxMs2: number;
  accRmsMs2: number;
  /** Direction reversals of the camera's radius (each is the camera going up where it went down); 0.02 m per frame is not a direction. */
  reversals: number;
  /** The height at the end (it must return to the held one). */
  endAglM: number;
}

export function dragMetrics(log: FrameLog, holdM: number): DragMetrics {
  const trim = <T>(xs: readonly T[], n: number): T[] => xs.slice(n, xs.length - n);
  const hfCam = rms(trim(highPass(log.r, 30), 30));
  const hfGround = rms(trim(highPass(log.ground, 30), 30));
  const shakeCam = rms(trim(highPass(log.r, 5), 30));
  const shakeGround = rms(trim(highPass(log.ground, 5), 30));
  const acc = secondDiff(log.r);
  return {
    hfCamM: hfCam,
    hfGroundM: hfGround,
    hfShare: hfCam / hfGround,
    shakeCamM: shakeCam,
    shakeGroundM: shakeGround,
    dipShare: Math.max(0, (holdM - Math.min(...log.agl)) / holdM),
    minAglM: Math.min(...log.agl),
    accMaxMs2: Math.max(...acc.map(Math.abs)),
    accRmsMs2: rms(acc),
    reversals: reversals(log.r, 0.02),
    endAglM: log.agl[log.agl.length - 1] as number,
  };
}

export interface ZoomMetrics {
  /**
   * Direction reversals of the camera's RADIUS (the distance from the planet's centre) beyond the ones the notches ask for (a notch in followed by a notch out turns the
   * direction once, on purpose). 0 = the camera never goes up where it went down: no hunting. (The height over the ground is not used: a camera that flies a straight line
   * over bumpy ground has a bumpy height, and that is not the camera hunting.)
   */
  extraReversals: number;
  /** The largest change of ln(radius over the planet's centre) in one frame, and of ln(height over the ground). */
  maxStepLnR: number;
  maxStepLnAgl: number;
  /** The height at the end of the run and its lowest value. */
  endAglM: number;
  minAglM: number;
}

export function zoomMetrics(log: FrameLog, notches: readonly number[]): ZoomMetrics {
  const step = (xs: readonly number[]): number => Math.max(...xs.slice(1).map((x, i) => Math.abs(Math.log(x) - Math.log(xs[i] as number))));
  let asked = 0;
  for (let i = 1; i < notches.length; i++) if (Math.sign(notches[i] as number) !== Math.sign(notches[i - 1] as number)) asked++;
  return { extraReversals: Math.max(0, reversals(log.r, 0.02) - asked), maxStepLnR: step(log.r), maxStepLnAgl: step(log.agl), endAglM: log.agl[log.agl.length - 1] as number, minAglM: Math.min(...log.agl) };
}

