// Shared setup of the chunk terrain tests: the real height raster, its pyramid, the height field (picking / CPU heights), a quadtree
// of a quality tier and the camera of a view as the quadtree wants it. Loaded once per test file.
import { CameraRig, setViewAtAgl, type CameraPose, type ViewState } from '../../src/render/camera';
import { CHUNK_FRUSTUM_SLACK, CHUNK_HYSTERESIS, CHUNK_MAX_LEVEL, EARTH_RADIUS_KM, HEIGHT_EXAGGERATION } from '../../src/render/config';
import { HeightField } from '../../src/render/heightField';
import { HeightPyramid } from '../../src/render/heightPyramid';
import { QUALITY, type QualitySettings, type QualityTier } from '../../src/render/quality';
import { ChunkQuadtree, makeQuadCamera, type QuadCamera, type QuadParams } from '../../src/render/quadtree';
import { worldLoader } from './dataFiles';

export interface ChunkWorld {
  codes: Uint8Array;
  width: number;
  height: number;
  maxM: number;
  field: HeightField;
  pyramid: HeightPyramid;
}

let cache: Promise<ChunkWorld> | null = null;

export function loadChunkWorld(): Promise<ChunkWorld> {
  cache ??= (async () => {
    const w = worldLoader();
    const [render, meta] = await Promise.all([w.loadRender(), w.loadMeta()]);
    const maxM = meta.encoding.heightSqrt.maxM;
    return {
      codes: render.height8,
      width: render.width,
      height: render.height,
      maxM,
      field: new HeightField({ height8: render.height8, width: render.width, height: render.height, maxM, exaggeration: HEIGHT_EXAGGERATION }),
      pyramid: new HeightPyramid(render.height8, render.width, render.height),
    };
  })();
  return cache;
}

export function quadParams(world: ChunkWorld, q: QualitySettings, over: Partial<QuadParams> = {}): QuadParams {
  const k = (HEIGHT_EXAGGERATION * world.maxM) / (EARTH_RADIUS_KM * 1000);
  return {
    maxChunks: q.chunkMax,
    maxLevel: CHUNK_MAX_LEVEL,
    splitK: q.chunkSplitK,
    deepK: q.chunkDeepK,
    cells: q.chunkCells,
    texelRad: (2 * Math.PI) / world.width,
    hysteresis: CHUNK_HYSTERESIS,
    frustumSlack: CHUNK_FRUSTUM_SLACK,
    heightRange: (u0, u1, v0, v1, out) => {
      world.pyramid.range(u0, u1, v0, v1);
      const lo = world.pyramid.minCode / 255;
      const hi = world.pyramid.maxCode / 255;
      out.lo = k * lo * lo;
      out.hi = k * hi * hi;
    },
    ...over,
  };
}

export function makeTree(world: ChunkWorld, tier: QualityTier = 'test', over: Partial<QuadParams> = {}): ChunkQuadtree {
  return new ChunkQuadtree(quadParams(world, QUALITY[tier], over));
}

/** Fills a quadtree camera from a camera pose (float64). */
export function quadCameraOf(pose: CameraPose, out: QuadCamera = makeQuadCamera()): QuadCamera {
  [out.px, out.py, out.pz] = pose.position;
  [out.fx, out.fy, out.fz] = pose.forward;
  [out.rx, out.ry, out.rz] = pose.right;
  [out.ux, out.uy, out.uz] = pose.up;
  out.tanY = Math.tan((pose.fovDeg * Math.PI) / 360);
  out.aspect = pose.aspect;
  return out;
}

/** The pose of a view; with `altAglM` the camera is that many metres above the displaced ground under it (the hook of the page). */
export function poseOf(world: ChunkWorld, view: Partial<ViewState>, altAglM?: number, size: [number, number] = [960, 540]): CameraPose {
  const rig = new CameraRig(size[0], size[1]);
  if (altAglM !== undefined) setViewAtAgl(rig, (lat, lon) => world.field.surfaceRadius(lat, lon), view, altAglM);
  else rig.setViewUnclamped(view);
  return rig.pose();
}

/** The six altitudes of the crack test and the views the tests look from (one place: the Alps seaboard and the Alps). */
export const ALTITUDE_VIEWS: ReadonlyArray<{ name: string; altAglM: number; view: Partial<ViewState> }> = [
  { name: 'orbit', altAglM: 15_000_000, view: { lat: 43.4, lon: 7.4, heading: 0, tilt: 0 } },
  { name: '3000 km', altAglM: 3_000_000, view: { lat: 43.4, lon: 7.4, heading: 0, tilt: 45 } },
  { name: '500 km', altAglM: 500_000, view: { lat: 43.4, lon: 7.4, heading: 0, tilt: 60 } },
  { name: '60 km', altAglM: 60_000, view: { lat: 43.4, lon: 7.4, heading: 0, tilt: 75 } },
  { name: '8 km', altAglM: 8_000, view: { lat: 43.4, lon: 7.4, heading: 0, tilt: 82 } },
  { name: '300 m', altAglM: 300, view: { lat: 43.4, lon: 7.4, heading: 0, tilt: 84 } },
];

/** A small seeded generator for the fuzz tests (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
