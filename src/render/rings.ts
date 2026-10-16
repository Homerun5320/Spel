// Pure numbers of the ring and icon drawing (M10-4); no three. The shaders repeat the two scale formulas, the unit tests pin them here.
import { STRUCT_CLOSE_FAR_M, STRUCT_CLOSE_MUL, STRUCT_CLOSE_NEAR_M, STRUCT_MAX_SCALE, STRUCT_SCREEN_FRAC } from './config';
import { levelScale } from './cityTiers';

/** Look-1: the close-range enlargement at camera distance `distM` (STRUCT_CLOSE_MUL up to STRUCT_CLOSE_NEAR_M, eased to 1 at STRUCT_CLOSE_FAR_M); the shaders repeat it. */
export function closeMul(distM: number): number {
  const t = Math.min(1, Math.max(0, (distM - STRUCT_CLOSE_NEAR_M) / (STRUCT_CLOSE_FAR_M - STRUCT_CLOSE_NEAR_M)));
  return STRUCT_CLOSE_MUL + (1 - STRUCT_CLOSE_MUL) * t * t * (3 - 2 * t);
}

/** The model's radius in render metres at camera distance `distM`: the scale policy of shaders/structures.ts (never below STRUCT_SCREEN_FRAC of the distance, up to STRUCT_MAX_SCALE times true size). */
export function modelRadiusM(distM: number, sizeM: number, level: number): number {
  const k = Math.max(closeMul(distM), Math.min(STRUCT_MAX_SCALE, Math.max(1, (distM * STRUCT_SCREEN_FRAC) / sizeM)));
  return k * sizeM * (levelScale(level));
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

/**
 * Polish-1: how far the ground under each vertex of the selection ring stands above (+) or below (-) the ground under the structure, in metres of the drawn
 * (exaggerated) terrain. Vertex `i` of `segments + 1` is at angle `2 pi i / segments` from east towards north, `radiusM` away from the centre. The layer
 * samples this when the selection or the structure changes and the vertex shader adds it along the local up, so the ring follows a steep slope instead
 * of being cut into a "D" by the terrain. `groundAt(lat, lon)` is `groundHeightAt`; `earthRadiusM` converts the offset to degrees.
 */
export function selectRingLiftsM(lat: number, lon: number, radiusM: number, segments: number, exaggeration: number, earthRadiusM: number, groundAt: (lat: number, lon: number) => number, out: Float32Array): void {
  const base = groundAt(lat, lon);
  const cosLat = Math.max(0.05, Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const vlat = lat + ((Math.sin(a) * radiusM) / earthRadiusM) * (180 / Math.PI);
    const vlon = lon + ((Math.cos(a) * radiusM) / (earthRadiusM * cosLat)) * (180 / Math.PI);
    const lift = exaggeration * (groundAt(Math.max(-89.9, Math.min(89.9, vlat)), vlon) - base);
    out[i] = lift;
  }
}
