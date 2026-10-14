// Pure maths of the terrain chunks (no three, no DOM): where a chunk is, its local frame, the key and the debug hue, and the
// float32 mirror of the vertex shader's chunk-relative position (the precision test compares it with float64).
//
// The quadtree has 8 roots: 4 columns (longitude -180 .. 180) by 2 rows (latitude 90 .. -90), 90 x 90 degrees each. A node
// (level, ix, iy) covers longitude -180 + ix * w .. -180 + (ix + 1) * w and latitude 90 - iy * w down to 90 - (iy + 1) * w, with
// w = 90 / 2^level degrees; iy = 0 is the northern row (the same row order as the rasters, so v = iy / rows addresses them).
// The chunk's own frame is the analytic one of geo.ts (east, north, up at its centre); every vertex of the chunk is expressed
// as an OFFSET from the centre point on the unit sphere, so no vertex position is ever formed from absolute float32 coordinates.
import { CHUNK_HUE_STEP } from './config';

export const ROOT_COLS = 4;
export const ROOT_ROWS = 2;
const HALF_PI = Math.PI / 2;

/** Side of a level-`level` chunk in radians (and in Earth radii on the unit sphere). */
export function chunkSizeRad(level: number): number {
  return HALF_PI / 2 ** level;
}

/** Columns and rows of the chunk grid at a level. */
export function levelCols(level: number): number {
  return ROOT_COLS * (1 << level);
}
export function levelRows(level: number): number {
  return ROOT_ROWS * (1 << level);
}

/** A unique number per node (exact in a double up to level 20): level, column, row. */
export function chunkKey(level: number, ix: number, iy: number): number {
  return (level * 4194304 + ix) * 2097152 + iy;
}

/** A hue in [0, 1) per node for the `?chunks=1` colouring: deterministic, neighbours land far apart on the colour wheel. */
export function chunkHue(level: number, ix: number, iy: number): number {
  const n = Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(level + 1, 83492791);
  const h = (n >>> 0) % 4096;
  return (h * CHUNK_HUE_STEP) % 1;
}

/** Geometry of one node in float64. */
export interface ChunkGeo {
  level: number;
  ix: number;
  iy: number;
  /** Centre latitude and longitude, radians. */
  latC: number;
  lonC: number;
  /** Extent in latitude and longitude, radians. */
  dLat: number;
  dLon: number;
  /** Centre direction (unit), east and north at the centre. */
  cx: number;
  cy: number;
  cz: number;
  ex: number;
  ez: number;
  nx: number;
  ny: number;
  nz: number;
}

export function makeChunkGeo(): ChunkGeo {
  return { level: 0, ix: 0, iy: 0, latC: 0, lonC: 0, dLat: 0, dLon: 0, cx: 0, cy: 0, cz: 0, ex: 0, ez: 0, nx: 0, ny: 0, nz: 0 };
}

/** Fills `out` with the geometry of a node (allocation-free). */
export function chunkGeo(level: number, ix: number, iy: number, out: ChunkGeo): ChunkGeo {
  const w = chunkSizeRad(level);
  out.level = level;
  out.ix = ix;
  out.iy = iy;
  out.dLat = w;
  out.dLon = w;
  out.latC = HALF_PI - (iy + 0.5) * w;
  out.lonC = -Math.PI + (ix + 0.5) * w;
  const cl = Math.cos(out.latC);
  const sl = Math.sin(out.latC);
  const co = Math.cos(out.lonC);
  const so = Math.sin(out.lonC);
  out.cx = cl * so;
  out.cy = sl;
  out.cz = cl * co;
  out.ex = co;
  out.ez = -so;
  out.nx = -sl * so;
  out.ny = cl;
  out.nz = -sl * co;
  return out;
}

/**
 * The vertex shader's position of a grid point (gx east 0..1, gy south 0..1) relative to the chunk centre point on the unit
 * sphere, in float64: the exact reference. d = (cos(phi) sin(lam), sin(phi), cos(phi) cos(lam)) minus the centre direction.
 */
export function vertexOffsetExact(g: ChunkGeo, gx: number, gy: number): [number, number, number] {
  const phi = g.latC + (0.5 - gy) * g.dLat;
  const lam = g.lonC + (gx - 0.5) * g.dLon;
  const cp = Math.cos(phi);
  return [cp * Math.sin(lam) - g.cx, Math.sin(phi) - g.cy, cp * Math.cos(lam) - g.cz];
}

const f = Math.fround;

/**
 * The same offset as the vertex shader forms it, with every operation rounded to float32 (the small-angle-safe form: no
 * subtraction of two nearly equal absolute coordinates). `height` is the radial displacement in Earth radii. Returns the position
 * relative to the camera given the chunk origin relative to the camera (`originRel`, float32 of a float64 difference).
 */
export function vertexRelFloat32(g: ChunkGeo, gx: number, gy: number, height: number, originRel: readonly [number, number, number]): [number, number, number] {
  const latC = f(g.latC);
  const dLat = f(g.dLat);
  const dLon = f(g.dLon);
  const dlon = f(f(gx - 0.5) * dLon);
  const dphi = f(f(0.5 - gy) * dLat);
  const phi = f(latC + dphi);
  const cphi = f(Math.cos(phi));
  const sdl = f(Math.sin(f(0.5 * dlon)));
  const sdp = f(Math.sin(f(0.5 * dphi)));
  const e = f(cphi * f(Math.sin(dlon)));
  const n = f(f(Math.sin(dphi)) + f(f(2 * cphi) * f(f(Math.sin(latC)) * f(sdl * sdl))));
  const u = f(2 * f(f(sdp * sdp) + f(f(cphi * f(Math.cos(latC))) * f(sdl * sdl))));
  const ex = f(g.ex);
  const ez = f(g.ez);
  const nx = f(g.nx);
  const ny = f(g.ny);
  const nz = f(g.nz);
  const cx = f(g.cx);
  const cy = f(g.cy);
  const cz = f(g.cz);
  // offset = east * e + north * n - up * u   (east has no y component)
  const ox = f(f(f(ex * e) + f(nx * n)) - f(cx * u));
  const oy = f(f(ny * n) - f(cy * u));
  const oz = f(f(f(ez * e) + f(nz * n)) - f(cz * u));
  const r = f(1 + height);
  // rel = originRel + offset * r + up * height
  return [f(f(originRel[0] + f(ox * r)) + f(cx * height)), f(f(originRel[1] + f(oy * r)) + f(cy * height)), f(f(originRel[2] + f(oz * r)) + f(cz * height))];
}

/** The exact (float64) position relative to the camera of a vertex at radial displacement `height`. */
export function vertexRelExact(g: ChunkGeo, gx: number, gy: number, height: number, cam: readonly [number, number, number]): [number, number, number] {
  const phi = g.latC + (0.5 - gy) * g.dLat;
  const lam = g.lonC + (gx - 0.5) * g.dLon;
  const cp = Math.cos(phi);
  const r = 1 + height;
  return [r * cp * Math.sin(lam) - cam[0], r * Math.sin(phi) - cam[1], r * cp * Math.cos(lam) - cam[2]];
}
