// Pure numbers of the ring and icon drawing (M10-4); no three. The shaders repeat the two scale formulas, the unit tests pin them here.
import { STRUCT_LEVEL_SCALE, STRUCT_MAX_SCALE, STRUCT_SCREEN_FRAC } from './config';

/** The model's radius in render metres at camera distance `distM`: the scale policy of shaders/structures.ts (never below STRUCT_SCREEN_FRAC of the distance, up to STRUCT_MAX_SCALE times true size). */
export function modelRadiusM(distM: number, sizeM: number, level: number): number {
  const k = Math.min(STRUCT_MAX_SCALE, Math.max(1, (distM * STRUCT_SCREEN_FRAC) / sizeM));
  return k * sizeM * (STRUCT_LEVEL_SCALE[level] ?? 1);
}

/** The projected radius of that model in pixels for a viewport `viewH` pixels high and `tanHalfFov` the tangent of half the vertical field of view. */
export function modelRadiusPx(distM: number, sizeM: number, level: number, viewH: number, tanHalfFov: number): number {
  return (modelRadiusM(distM, sizeM, level) / distM) * (viewH / 2 / tanHalfFov);
}

/** The camera distance (metres) beyond which a model of `sizeM` at level 1 projects to fewer than `px` pixels: the icon takes over there. Beyond the scale plateau the radius is `STRUCT_MAX_SCALE * sizeM` and shrinks as 1 / distance. */
export function iconSwitchDistanceM(sizeM: number, px: number, viewH: number, tanHalfFov: number): number {
  return (STRUCT_MAX_SCALE * sizeM * (viewH / 2 / tanHalfFov)) / px;
}

/** The radius (render metres) of the selection ring round a structure: a bit outside the model, whatever the zoom. */
export const SELECT_RING_FACTOR = 1.35;
export function selectRingRadiusM(distM: number, sizeM: number, level: number): number {
  return modelRadiusM(distM, sizeM, level) * SELECT_RING_FACTOR;
}
