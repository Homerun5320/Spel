// The terrain quadtree: which chunks to draw for a camera. Pure (no three, no DOM) and allocation-free per call.
//
// 8 roots (4 x 2, 90 x 90 degrees). A node splits into its four children while the camera is closer than K times its side
// (the distance runs to the node's bounding sphere, which includes the tallest terrain under it, so the camera at 300 m above a
// 60 km high mountain top is "inside" the chunk). Hysteresis: a node that was split last frame merges back only when the camera is
// (1 + hysteresis) times farther than the split distance, so a camera wobbling around a ring boundary never makes a chunk flicker.
// Nodes outside the view frustum or behind the horizon are dropped (and not split). The result is a hard-capped list of leaves:
// when the wanted split distances need more chunks than the tier allows, ALL split distances shrink by a fixed factor and the
// selection runs again (the quality drops evenly, never "far chunks keep their detail and the near ones starve"); the last pass
// also refuses splits (nearest first) once the cap is reached, so the cap holds for every camera pose.
//
// Per leaf the result also holds, for each of its four edges, how many levels COARSER the neighbouring leaf is (0 = same level,
// finer, or not drawn): the skirt of the finer chunk has to cover the crack to the coarser one.
import { chunkKey, chunkSizeRad, levelCols, levelRows, ROOT_COLS, ROOT_ROWS } from './chunkMath';

export interface QuadParams {
  /** Hard cap on the leaves (the tier's chunk count; never above 400). */
  maxChunks: number;
  maxLevel: number;
  /** Split distance in chunk sides for chunks whose grid cells are at least one raster texel wide. */
  splitK: number;
  /**
   * Split distance for chunks whose cells are 1/8 texel or finer. The height raster has no detail below a texel, so the finest levels
   * only reproduce its smooth bilinear shape and need less distance than the coarse ones (the number of chunks per level grows
   * with K squared and a close camera sees a dozen levels). Between one texel and 1/8 texel the factor falls geometrically.
   */
  deepK: number;
  /** Grid cells per chunk side and the width of one raster texel in radians (they fix which levels are "deep"). */
  cells: number;
  texelRad: number;
  /** Merge distance is the split distance times (1 + hysteresis). */
  hysteresis: number;
  /** The half field of view is widened by this fraction before culling. */
  frustumSlack: number;
  /** Shrink factor of the split distances per extra pass over the budget, and the number of passes. */
  budgetShrink: number;
  budgetPasses: number;
  /**
   * The lowest and highest terrain in the rectangle (u0, u1, v0, v1 of the rasters), in Earth radii above the unit sphere
   * (exaggeration applied), written to `lo` and `hi` of the result object the quadtree passes in (allocation-free).
   */
  heightRange(u0: number, u1: number, v0: number, v1: number, out: HeightRange): void;
}

export interface HeightRange {
  lo: number;
  hi: number;
}

/** What the quadtree needs of the camera, in float64 (the owner overwrites the fields each frame). */
export interface QuadCamera {
  px: number;
  py: number;
  pz: number;
  /** Orthonormal view basis: forward, right, up. */
  fx: number;
  fy: number;
  fz: number;
  rx: number;
  ry: number;
  rz: number;
  ux: number;
  uy: number;
  uz: number;
  /** Tangent of the half vertical field of view and the aspect ratio. */
  tanY: number;
  aspect: number;
}

export function makeQuadCamera(): QuadCamera {
  return { px: 0, py: 0, pz: 1, fx: 0, fy: 0, fz: -1, rx: 1, ry: 0, rz: 0, ux: 0, uy: 1, uz: 0, tanY: 0.27, aspect: 16 / 9 };
}

/** An open-addressing set of node keys (linear probing, fixed capacity, no deletions). */
class KeySet {
  private readonly keys: Float64Array;
  private readonly mask: number;
  private readonly vals: Uint8Array;

  constructor(capacityPow2: number) {
    this.keys = new Float64Array(capacityPow2).fill(-1);
    this.vals = new Uint8Array(capacityPow2);
    this.mask = capacityPow2 - 1;
  }

  clear(): void {
    this.keys.fill(-1);
  }

  private slot(key: number): number {
    return (Math.imul((key | 0) ^ Math.imul((key / 4294967296) | 0, 0x45d9f3b), 0x9e3779b1) >>> 7) & this.mask;
  }

  add(key: number, val = 0): void {
    let i = this.slot(key);
    for (let n = 0; n <= this.mask; n++) {
      const k = this.keys[i] as number;
      if (k === -1 || k === key) {
        this.keys[i] = key;
        this.vals[i] = val;
        return;
      }
      i = (i + 1) & this.mask;
    }
    throw new Error('KeySet is full');
  }

  /** The value stored for the key, or -1 when absent. */
  get(key: number): number {
    let i = this.slot(key);
    for (let n = 0; n <= this.mask; n++) {
      const k = this.keys[i] as number;
      if (k === key) return this.vals[i] as number;
      if (k === -1) return -1;
      i = (i + 1) & this.mask;
    }
    return -1;
  }

  has(key: number): boolean {
    return this.get(key) >= 0;
  }
}

export class ChunkQuadtree {
  readonly params: QuadParams;
  /** The leaves of the last `update` (first `count` entries). */
  count = 0;
  readonly level: Uint8Array;
  readonly ix: Int32Array;
  readonly iy: Int32Array;
  /** Per leaf, for the edges west, east, north, south: levels the neighbour is coarser (0 = same, finer or absent). */
  readonly coarser: Uint8Array;
  /** Nodes whose bounds were evaluated in the last update (all passes): a cost counter, not a result. */
  nodesVisited = 0;
  /** Selection passes the last update needed (1 = the wanted detail fitted the cap). */
  passes = 1;

  private readonly maxChunks: number;
  // Frontier of the level being processed and of the next one.
  private curIx: Int32Array;
  private curIy: Int32Array;
  private curD: Float64Array;
  private nextIx: Int32Array;
  private nextIy: Int32Array;
  private nextD: Float64Array;
  private readonly range: HeightRange = { lo: 0, hi: 0 };
  private readonly candIdx: Int32Array;
  private readonly candD: Float64Array;
  private readonly childIx = new Int32Array(4);
  private readonly childIy = new Int32Array(4);
  private readonly childD = new Float64Array(4);
  private prevSplit = new KeySet(4096);
  private curSplit = new KeySet(4096);
  private readonly leafSet = new KeySet(4096);

  // Per-level constants.
  private readonly size: Float64Array;
  private readonly halfSin: Float64Array;
  private readonly halfCos: Float64Array;
  private readonly levelK: Float64Array;

  // Per-update camera constants.
  private cam: QuadCamera = makeQuadCamera();
  private camR = 1;
  private camNx = 0;
  private camNy = 0;
  private camNz = 1;
  private horizon = 0;
  private nLx = 0;
  private nLy = 0;
  private nLz = 0;
  private nRx = 0;
  private nRy = 0;
  private nRz = 0;
  private nTx = 0;
  private nTy = 0;
  private nTz = 0;
  private nBx = 0;
  private nBy = 0;
  private nBz = 0;
  // Output of `bounds`.
  private bD = 0;

  constructor(params: QuadParams) {
    if (params.maxChunks < ROOT_COLS * ROOT_ROWS) throw new Error('maxChunks is below the 8 roots');
    this.params = params;
    this.maxChunks = params.maxChunks;
    const cap = params.maxChunks + 8;
    this.level = new Uint8Array(cap);
    this.ix = new Int32Array(cap);
    this.iy = new Int32Array(cap);
    this.coarser = new Uint8Array(4 * cap);
    const f = 2 * params.maxChunks + 32;
    this.curIx = new Int32Array(f);
    this.curIy = new Int32Array(f);
    this.curD = new Float64Array(f);
    this.nextIx = new Int32Array(f);
    this.nextIy = new Int32Array(f);
    this.nextD = new Float64Array(f);
    this.candIdx = new Int32Array(f);
    this.candD = new Float64Array(f);
    const levels = params.maxLevel + 1;
    this.size = new Float64Array(levels);
    this.halfSin = new Float64Array(levels);
    this.halfCos = new Float64Array(levels);
    this.levelK = new Float64Array(levels);
    for (let l = 0; l < levels; l++) {
      this.size[l] = chunkSizeRad(l);
      this.halfSin[l] = Math.sin(0.5 * (this.size[l] as number));
      this.halfCos[l] = Math.cos(0.5 * (this.size[l] as number));
      // 0 at one texel per cell and above, 1 at 1/8 texel and below.
      const cellTexels = (this.size[l] as number) / params.cells / params.texelRad;
      const deep = Math.min(1, Math.max(0, -Math.log2(cellTexels) / 3));
      this.levelK[l] = params.splitK * (1 - deep) + params.deepK * deep;
    }
  }

  /** Forgets the hysteresis state (the next update decides every node by the split distance alone). */
  reset(): void {
    this.prevSplit.clear();
    this.curSplit.clear();
  }

  /** Selects the leaves for a camera. */
  update(cam: QuadCamera): void {
    this.cam = cam;
    this.prepareCamera();
    this.nodesVisited = 0;
    const p = this.params;
    let ok = false;
    for (let pass = 0; pass < p.budgetPasses; pass++) {
      const last = pass === p.budgetPasses - 1;
      const scale = p.budgetShrink ** pass;
      ok = this.run(scale, last);
      this.passes = pass + 1;
      if (ok) break;
    }
    if (!ok) throw new Error('quadtree: the last pass must fit the cap');
    // Commit the split history of the pass that fit.
    const t = this.prevSplit;
    this.prevSplit = this.curSplit;
    this.curSplit = t;
    this.computeNeighbours();
  }

  private prepareCamera(): void {
    const c = this.cam;
    this.camR = Math.sqrt(c.px * c.px + c.py * c.py + c.pz * c.pz);
    const inv = 1 / this.camR;
    this.camNx = c.px * inv;
    this.camNy = c.py * inv;
    this.camNz = c.pz * inv;
    this.horizon = Math.acos(Math.min(1, 1 / Math.max(this.camR, 1)));
    const s = 1 + this.params.frustumSlack;
    const ty = c.tanY * s;
    const tx = c.tanY * c.aspect * s;
    const ix = 1 / Math.sqrt(1 + tx * tx);
    const sx = tx * ix; // sin of the half horizontal angle, ix is the cosine
    const iy = 1 / Math.sqrt(1 + ty * ty);
    const sy = ty * iy;
    // Inward normals: left = right * cos + forward * sin, right = -right * cos + forward * sin, bottom = up * cos + forward * sin, top = -up * cos + forward * sin.
    this.nLx = c.rx * ix + c.fx * sx;
    this.nLy = c.ry * ix + c.fy * sx;
    this.nLz = c.rz * ix + c.fz * sx;
    this.nRx = -c.rx * ix + c.fx * sx;
    this.nRy = -c.ry * ix + c.fy * sx;
    this.nRz = -c.rz * ix + c.fz * sx;
    this.nBx = c.ux * iy + c.fx * sy;
    this.nBy = c.uy * iy + c.fy * sy;
    this.nBz = c.uz * iy + c.fz * sy;
    this.nTx = -c.ux * iy + c.fx * sy;
    this.nTy = -c.uy * iy + c.fy * sy;
    this.nTz = -c.uz * iy + c.fz * sy;
  }

  /**
   * Bounds of a node: its bounding sphere (the unit-sphere patch lifted by the tallest terrain under it), the culling tests and
   * the distance from the camera to the sphere in `bD`. Returns false when the node cannot be seen.
   */
  private bounds(level: number, ix: number, iy: number): boolean {
    this.nodesVisited++;
    const w = this.size[level] as number;
    const sh = this.halfSin[level] as number;
    const ch = this.halfCos[level] as number;
    const latC = Math.PI / 2 - (iy + 0.5) * w;
    const lonC = -Math.PI + (ix + 0.5) * w;
    const sl = Math.sin(latC);
    const cl = Math.cos(latC);
    const so = Math.sin(lonC);
    const co = Math.cos(lonC);
    const cx = cl * so;
    const cy = sl;
    const cz = cl * co;
    // Largest angle from the centre to a corner: the cosines for the north and the south pair.
    const sinTop = sl * ch + cl * sh;
    const cosTop = Math.max(0, cl * ch - sl * sh);
    const sinBot = sl * ch - cl * sh;
    const cosBot = Math.max(0, cl * ch + sl * sh);
    const cosA1 = sinTop * sl + cosTop * cl * ch;
    const cosA2 = sinBot * sl + cosBot * cl * ch;
    let cosA = cosA1 < cosA2 ? cosA1 : cosA2;
    if (cosA > 1) cosA = 1;
    if (cosA < -1) cosA = -1;
    const sinA = Math.sqrt(1 - cosA * cosA);
    const cols = levelCols(level);
    const rows = levelRows(level);
    const rg = this.range;
    this.params.heightRange(ix / cols, (ix + 1) / cols, iy / rows, (iy + 1) / rows, rg);
    const rb = 1 + rg.lo;
    const rt = 1 + rg.hi;
    const rm = 0.5 * (rb + rt);
    // Radius of the sphere around c * rm that holds the patch: the corners at the bottom and at the top of the height range.
    const dB = rb * cosA - rm;
    const dT = rt * cosA - rm;
    let rho2 = Math.max(dB * dB + rb * rb * sinA * sinA, dT * dT + rt * rt * sinA * sinA);
    const half = 0.5 * (rt - rb);
    rho2 = Math.max(rho2, half * half);
    const rho = Math.sqrt(rho2);
    const c = this.cam;
    const qx = cx * rm - c.px;
    const qy = cy * rm - c.py;
    const qz = cz * rm - c.pz;
    // Frustum: the four side planes and the plane behind the camera.
    if (qx * this.nLx + qy * this.nLy + qz * this.nLz < -rho) return false;
    if (qx * this.nRx + qy * this.nRy + qz * this.nRz < -rho) return false;
    if (qx * this.nBx + qy * this.nBy + qz * this.nBz < -rho) return false;
    if (qx * this.nTx + qy * this.nTy + qz * this.nTz < -rho) return false;
    if (qx * c.fx + qy * c.fy + qz * c.fz < -rho) return false;
    // Horizon: the patch is out of sight when its nearest point is farther from the camera's sub-point than the horizon of
    // the sea-level sphere plus the extra horizon of its highest point.
    let cosT = cx * this.camNx + cy * this.camNy + cz * this.camNz;
    if (cosT > 1) cosT = 1;
    if (cosT < -1) cosT = -1;
    const theta = Math.acos(cosT);
    const alpha = Math.acos(cosA);
    if (theta - alpha > this.horizon + Math.acos(1 / rt) + 1e-6) return false;
    // Distance for the LOD: a lower bound of the distance from the camera to any point of the patch (not to its bounding sphere,
    // which for a patch with a large height range is much too near). The camera is rc from the centre of the planet and
    // theta - alpha from the nearest edge of the patch as seen from the centre; the patch points lie between radius rb and rt.
    const rc = this.camR;
    let cosPhi = 1;
    if (theta > alpha) cosPhi = cosT * cosA + Math.sqrt(1 - cosT * cosT) * sinA;
    let rp = rc * cosPhi;
    if (rp < rb) rp = rb;
    else if (rp > rt) rp = rt;
    const d2 = rc * rc + rp * rp - 2 * rc * rp * cosPhi;
    this.bD = d2 > 0 ? Math.sqrt(d2) : 0;
    return true;
  }

  private run(scale: number, enforce: boolean): boolean {
    const p = this.params;
    const max = this.maxChunks;
    this.curSplit.clear();
    let emitted = 0;
    let curN = 0;
    for (let iy = 0; iy < ROOT_ROWS; iy++) {
      for (let ix = 0; ix < ROOT_COLS; ix++) {
        if (this.bounds(0, ix, iy)) {
          this.curIx[curN] = ix;
          this.curIy[curN] = iy;
          this.curD[curN] = this.bD;
          curN++;
        }
      }
    }
    for (let level = 0; curN > 0; level++) {
      let nextN = 0;
      let candN = 0;
      const w = this.size[level] as number;
      const splitDist = (this.levelK[level] as number) * scale * w;
      const mergeDist = splitDist * (1 + p.hysteresis);
      for (let i = 0; i < curN; i++) {
        const d = this.curD[i] as number;
        let split = false;
        if (level < p.maxLevel) {
          const was = this.prevSplit.has(chunkKey(level, this.curIx[i] as number, this.curIy[i] as number));
          split = d < (was ? mergeDist : splitDist);
        }
        if (split) {
          this.candIdx[candN] = i;
          this.candD[candN] = d;
          candN++;
        } else {
          if (emitted >= max) return false;
          this.level[emitted] = level;
          this.ix[emitted] = this.curIx[i] as number;
          this.iy[emitted] = this.curIy[i] as number;
          emitted++;
        }
      }
      if (enforce && candN > 1) this.sortCandidates(candN);
      for (let j = 0; j < candN; j++) {
        const i = this.candIdx[j] as number;
        const ix = this.curIx[i] as number;
        const iy = this.curIy[i] as number;
        // Bounds of the four children: how many of them are visible decides what the split costs.
        let vc = 0;
        for (let k = 0; k < 4; k++) {
          const cix = 2 * ix + (k & 1);
          const ciy = 2 * iy + (k >> 1);
          if (this.bounds(level + 1, cix, ciy)) {
            this.childIx[vc] = cix;
            this.childIy[vc] = ciy;
            this.childD[vc] = this.bD;
            vc++;
          }
        }
        const pendingAfter = emitted + (candN - j - 1) + nextN + vc;
        if (pendingAfter > max) {
          if (!enforce) return false;
          // Cap reached: this node stays a leaf.
          this.level[emitted] = level;
          this.ix[emitted] = ix;
          this.iy[emitted] = iy;
          emitted++;
          continue;
        }
        this.curSplit.add(chunkKey(level, ix, iy));
        for (let k = 0; k < vc; k++) {
          this.nextIx[nextN] = this.childIx[k] as number;
          this.nextIy[nextN] = this.childIy[k] as number;
          this.nextD[nextN] = this.childD[k] as number;
          nextN++;
        }
      }
      // The next level becomes the current one.
      let t: Int32Array = this.curIx;
      this.curIx = this.nextIx;
      this.nextIx = t;
      t = this.curIy;
      this.curIy = this.nextIy;
      this.nextIy = t;
      const td = this.curD;
      this.curD = this.nextD;
      this.nextD = td;
      curN = nextN;
    }
    this.count = emitted;
    return true;
  }

  /** Insertion sort of the candidates by distance, nearest first (the candidate lists are short). */
  private sortCandidates(n: number): void {
    for (let a = 1; a < n; a++) {
      const d = this.candD[a] as number;
      const idx = this.candIdx[a] as number;
      let b = a - 1;
      while (b >= 0 && (this.candD[b] as number) > d) {
        this.candD[b + 1] = this.candD[b] as number;
        this.candIdx[b + 1] = this.candIdx[b] as number;
        b--;
      }
      this.candD[b + 1] = d;
      this.candIdx[b + 1] = idx;
    }
  }

  /** For each leaf and edge (west, east, north, south): how many levels coarser the leaf across the edge is. */
  private computeNeighbours(): void {
    this.leafSet.clear();
    for (let i = 0; i < this.count; i++) this.leafSet.add(chunkKey(this.level[i] as number, this.ix[i] as number, this.iy[i] as number), 1);
    for (let i = 0; i < this.count; i++) {
      const l = this.level[i] as number;
      const ix = this.ix[i] as number;
      const iy = this.iy[i] as number;
      const cols = levelCols(l);
      const rows = levelRows(l);
      this.coarser[4 * i] = this.coarserAcross(l, (ix + cols - 1) % cols, iy);
      this.coarser[4 * i + 1] = this.coarserAcross(l, (ix + 1) % cols, iy);
      this.coarser[4 * i + 2] = iy > 0 ? this.coarserAcross(l, ix, iy - 1) : 0;
      this.coarser[4 * i + 3] = iy < rows - 1 ? this.coarserAcross(l, ix, iy + 1) : 0;
    }
  }

  /** Levels coarser than `level` of the leaf covering the same-level cell (nx, ny); 0 when that cell is a leaf, is split further, or is not drawn. */
  private coarserAcross(level: number, nx: number, ny: number): number {
    for (let k = 0; k <= level; k++) {
      if (this.leafSet.has(chunkKey(level - k, nx >> k, ny >> k))) return k;
    }
    return 0;
  }
}
