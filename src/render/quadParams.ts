// The one place that turns a quality tier and the height raster into the parameters of the chunk quadtree. The production
// `ChunkTerrain` and the quadtree unit tests both build their tree through `makeQuadParams`, so the bounds the tests exercise are the
// bounds the shipped code uses (no hand-copied duplicate to drift). Pure (no three, no DOM).
import { CHUNK_BUDGET_RESERVE, CHUNK_EVICTIONS_PER_FRAME, CHUNK_FRUSTUM_SLACK, CHUNK_HYSTERESIS, CHUNK_MAX_LEVEL, EARTH_RADIUS_KM } from './config';
import { POLE_HEIGHT_U } from './geo';
import type { DetailBounds, HeightIntervalM } from './detailBounds';
import type { HeightPyramid } from './heightPyramid';
import { CHUNK_ABSOLUTE_MAX, type QualitySettings } from './quality';
import type { HeightRange, QuadParams } from './quadtree';

/**
 * The lowest and highest terrain under a rectangle of the raster (u0..u1, v0..v1 as fractions), in Earth radii above the unit sphere with
 * the height exaggeration applied: the pyramid's min / max code, decoded like the shader does (sqrt coding, so squared), times the
 * exaggeration and the tallest height. A rectangle that touches the first or the last raster row also covers the pole column, because the
 * pole rows read the height at one common longitude (POLE_HEIGHT_U) whatever the chunk's longitude is.
 */
export function heightRangeRadii(pyramid: HeightPyramid, exaggeration: number, maxM: number, u0: number, u1: number, v0: number, v1: number, out: HeightRange): void {
  pyramid.range(u0, u1, v0, v1);
  let loC = pyramid.minCode;
  let hiC = pyramid.maxCode;
  if (v0 <= 0 || v1 >= 1) {
    pyramid.range(POLE_HEIGHT_U, POLE_HEIGHT_U, v0, v1);
    if (pyramid.minCode < loC) loC = pyramid.minCode;
    if (pyramid.maxCode > hiC) hiC = pyramid.maxCode;
  }
  const k = (exaggeration * maxM) / (EARTH_RADIUS_KM * 1000);
  const lo = loC / 255;
  const hi = hiC / 255;
  out.lo = k * lo * lo;
  out.hi = k * hi * hi;
}

export interface QuadParamsInput {
  quality: QualitySettings;
  pyramid: HeightPyramid;
  /** Width of the height raster in texels. */
  width: number;
  /** Largest decoded height in metres. */
  maxM: number;
  /** The exaggeration the shader uses right now (read on every call: it can change at run time). */
  exaggeration: () => number;
  /** M07b: the height intervals of the detailed surface (none = the base alone, as in M07a). */
  detail?: DetailBounds | null;
}

/** The quadtree parameters of a tier. The chunk cap is the tier's `chunkMax`, never above `CHUNK_ABSOLUTE_MAX`. */
export function makeQuadParams(o: QuadParamsInput): QuadParams {
  const q = o.quality;
  const db = o.detail ?? null;
  const tmp: HeightIntervalM = { lo: 0, hi: 0 };
  return {
    maxChunks: Math.min(q.chunkMax, CHUNK_ABSOLUTE_MAX),
    maxLevel: CHUNK_MAX_LEVEL,
    splitK: q.chunkSplitK,
    deepK: q.chunkDeepK,
    cells: q.chunkCells,
    texelRad: (2 * Math.PI) / o.width,
    hysteresis: CHUNK_HYSTERESIS,
    frustumSlack: CHUNK_FRUSTUM_SLACK,
    evictionsPerFrame: CHUNK_EVICTIONS_PER_FRAME,
    reserve: CHUNK_BUDGET_RESERVE,
    heightRange: (u0, u1, v0, v1, out) => heightRangeRadii(o.pyramid, o.exaggeration(), o.maxM, u0, u1, v0, v1, out),
    ...(db
      ? {
          detailRange: (level: number, ix: number, iy: number, out: { lo: number; hi: number }): boolean => {
            if (!db.range(level, ix, iy, tmp)) return false;
            const k = o.exaggeration() / (EARTH_RADIUS_KM * 1000);
            out.lo = k * tmp.lo;
            out.hi = k * tmp.hi;
            return true;
          },
        }
      : {}),
  };
}
