// Small vector helpers shared by the RTS tests.
import { dot, normalize, type Vec3 } from '../../src/render/geo';
export { rng } from './chunkWorld';

export function angleBetween(a: Vec3, b: Vec3): number {
  return Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
}

export const normalizeVec = normalize;
