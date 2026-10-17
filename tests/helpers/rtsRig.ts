// The RTS camera of M08 over the real terrain, for the unit tests: a CameraRig whose ground is the detailed surface (the very one the chunk
// shader draws and picking hits) and whose picker is `groundPickerOf` of the same height field.
import { CameraRig, setViewAtAgl, type ViewState } from '../../src/render/camera';
import { EARTH_RADIUS_KM, FLY_GROUND_OCTAVES, HEIGHT_EXAGGERATION } from '../../src/render/config';
import type { Vec3 } from '../../src/render/geo';
import { cameraLookingAt, viewFromPose } from '../../src/render/rts';
import { groundPickerOf } from '../../src/render/transforms';
import { loadChunkWorld, type ChunkWorld } from './chunkWorld';

export const R_M = EARTH_RADIUS_KM * 1000;

export interface RtsWorld {
  world: ChunkWorld;
  ground: (lat: number, lon: number) => number;
  smooth: (lat: number, lon: number) => number;
}

export async function loadRtsWorld(): Promise<RtsWorld> {
  const world = await loadChunkWorld();
  const f = world.detailField;
  const sampler = f.sampler;
  if (!sampler) throw new Error('the detail field has no sampler');
  return {
    world,
    ground: (lat, lon) => f.surfaceRadius(lat, lon),
    smooth: (lat, lon) => 1 + (HEIGHT_EXAGGERATION * sampler.heightAt(lat, lon, FLY_GROUND_OCTAVES)) / R_M,
  };
}

/** A rig as `Globe` builds it (ground, flight ground, picker), at a view; with `altAglM` the camera is that high over the ground under it. */
export function makeRtsRig(w: RtsWorld, view: Partial<ViewState>, altAglM?: number, size: [number, number] = [960, 540]): CameraRig {
  const rig = new CameraRig(size[0], size[1]);
  rig.setGround(w.ground, w.smooth);
  rig.setPicker(groundPickerOf(w.world.detailField));
  if (altAglM !== undefined) setViewAtAgl(rig, w.ground, view, altAglM);
  else rig.setViewUnclamped(view);
  rig.update(0);
  return rig;
}

/** The camera's height over the ground under it, metres. */
export function aglOf(w: RtsWorld, rig: CameraRig): number {
  return rig.aglM();
}

/**
 * A rig whose camera is `aglM` metres over the ground, looking at the ground point (lat, lon) from `heading` with `tilt` degrees from straight
 * down at that point (the camera model of a flight that has ended: `flyTo(lat, lon, 0, { altAglM, tilt, heading })`). The user limits do not apply.
 */
export function makeRigLookingAt(w: RtsWorld, lat: number, lon: number, aglM: number, tilt: number, heading: number, size: [number, number] = [960, 540]): CameraRig {
  const rig = new CameraRig(size[0], size[1]);
  rig.setGround(w.ground, w.smooth);
  rig.setPicker(groundPickerOf(w.world.detailField));
  placeLookingAt(w, rig, lat, lon, aglM, tilt, heading);
  rig.update(0);
  return rig;
}

/** Puts an existing rig where `makeRigLookingAt` puts a new one (the motion state is forgotten, as for every hook). */
export function placeLookingAt(w: RtsWorld, rig: CameraRig, lat: number, lon: number, aglM: number, tilt: number, heading: number): void {
  const g = w.world.detailField.surfacePoint(lat, lon);
  const pose = cameraLookingAt(g, heading, tilt, w.ground, aglM);
  rig.setViewUnclamped(viewFromPose(pose.position, pose.forward, heading));
}

/** The straight distance in metres between the camera positions of two poses. */
export function cameraMovedM(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) * R_M;
}
