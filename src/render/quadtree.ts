// The terrain quadtree: which chunks to draw for a camera. Pure (no three, no DOM) and allocation-free per call.
//
// 8 roots (4 x 2, 90 x 90 degrees). A node splits into its four children while the camera is closer than K times its side (the
// distance runs to the patch between the node's lowest and highest terrain; K is larger for the coarse levels that give the globe its
// shape at orbit and smaller for the fine ones, see `deepK`). Hysteresis: a node that was split last frame merges back only when the
// camera is (1 + hysteresis) times farther than the split distance, so a camera wobbling around a ring boundary never makes a chunk
// flicker. Nodes outside the view frustum or behind the horizon are dropped (and not split).
//
// The result is a hard-capped list of leaves. The refinement is BEST FIRST: every node that wants a split is queued with its urgency
// (its distance in units of its own split distance, 0 = the camera is inside it) and the most urgent are split first until no node
// wants a split or the next split would not fit the cap. Under the cap that is exactly "split everything that wants to"; over it the
// detail right around the camera wins and the far field stays coarse (the budget is spent where the player looks), and the cap holds
// for every camera pose.
//
// Per leaf the result also holds, for each of its four edges, how many levels COARSER the neighbouring leaf is (0 = same level,
// finer, or not drawn): the skirt of the finer chunk has to cover the crack to the coarser one.
import { chunkKey, chunkSizeRad, levelCols, levelRows, ROOT_COLS, ROOT_ROWS } from './chunkMath';

export interface QuadParams {
  /** Hard cap on the leaves (the tier's chunk count; never above 400). */
  maxChunks: number;
  maxLevel: number;
  /** Split distance in chunk sides for chunks whose grid cells are at least four raster texels wide (the orbit levels). */
  splitK: number;
  /**
   * Split distance for chunks whose cells are 1/8 texel or finer. The height raster has no detail below a texel, so the finer levels
   * only reproduce its smooth bilinear shape and need less distance than the coarse ones (the number of chunks per level grows
   * with K squared and a close camera sees a dozen levels; triangles of a few pixels also shade partly empty 2 x 2 pixel quads).
   * Between four texels and 1/8 texel per cell the factor falls geometrically.
   */
  deepK: number;
  /** Grid cells per chunk side and the width of one raster texel in radians (they fix which levels are "deep"). */
  cells: number;
  texelRad: number;
  /** Merge distance is the split distance times (1 + hysteresis). */
  hysteresis: number;
  /** The half field of view is widened by this fraction before culling. */
  frustumSlack: number;
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
  /** Per leaf and edge: 1 when the neighbour across the edge is split further (finer chunks lie there), else 0. */
  readonly finer: Uint8Array;
  /** Nodes whose bounds were evaluated in the last update (all passes): a cost counter, not a result. */
  nodesVisited = 0;
  /** True when the cap refused at least one split the last update wanted (the far detail is lower than asked for). */
  capped = false;

  private readonly maxChunks: number;
  // The nodes of the refinement (leaves and the nodes that were split) and the heap of those that want a split.
  private readonly nLevel: Uint8Array;
  private readonly nIx: Int32Array;
  private readonly nIy: Int32Array;
  private readonly nD: Float64Array;
  private readonly nSplit: Uint8Array;
  private readonly heapNode: Int32Array;
  private readonly heapKey: Float64Array;
  private heapN = 0;
  private readonly range: HeightRange = { lo: 0, hi: 0 };
  private readonly childIx = new Int32Array(4);
  private readonly childIy = new Int32Array(4);
  private readonly childD = new Float64Array(4);
  private prevSplit = new KeySet(16384);
  private curSplit = new KeySet(16384);
  private readonly leafSet = new KeySet(16384);

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
    this.finer = new Uint8Array(4 * cap);
    // Every split adds at most 4 nodes; a split that keeps the number of leaves (one visible child) can repeat down a branch, so at most
    // one split per leaf per level.
    const nodes = 8 + 4 * params.maxChunks * (params.maxLevel + 1);
    this.nLevel = new Uint8Array(nodes);
    this.nIx = new Int32Array(nodes);
    this.nIy = new Int32Array(nodes);
    this.nD = new Float64Array(nodes);
    this.nSplit = new Uint8Array(nodes);
    this.heapNode = new Int32Array(nodes);
    this.heapKey = new Float64Array(nodes);
    const levels = params.maxLevel + 1;
    this.size = new Float64Array(levels);
    this.halfSin = new Float64Array(levels);
    this.halfCos = new Float64Array(levels);
    this.levelK = new Float64Array(levels);
    for (let l = 0; l < levels; l++) {
      this.size[l] = chunkSizeRad(l);
      this.halfSin[l] = Math.sin(0.5 * (this.size[l] as number));
      this.halfCos[l] = Math.cos(0.5 * (this.size[l] as number));
      // 0 at four texels per cell and above, 1 at 1/8 texel and below (five octaves, geometric in between).
      const cellTexels = (this.size[l] as number) / params.cells / params.texelRad;
      const deep = Math.min(1, Math.max(0, (2 - Math.log2(cellTexels)) / 5));
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
    this.refine();
    // Commit the split history.
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

  /** Pushes node `n` on the heap of the nodes that want a split, most urgent (smallest key) on top. */
  private heapPush(n: number, key: number): void {
    let i = this.heapN++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if ((this.heapKey[parent] as number) <= key) break;
      this.heapNode[i] = this.heapNode[parent] as number;
      this.heapKey[i] = this.heapKey[parent] as number;
      i = parent;
    }
    this.heapNode[i] = n;
    this.heapKey[i] = key;
  }

  /** Removes and returns the most urgent node. */
  private heapPop(): number {
    const top = this.heapNode[0] as number;
    const n = --this.heapN;
    if (n > 0) {
      const node = this.heapNode[n] as number;
      const key = this.heapKey[n] as number;
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && (this.heapKey[c + 1] as number) < (this.heapKey[c] as number)) c++;
        if ((this.heapKey[c] as number) >= key) break;
        this.heapNode[i] = this.heapNode[c] as number;
        this.heapKey[i] = this.heapKey[c] as number;
        i = c;
      }
      this.heapNode[i] = node;
      this.heapKey[i] = key;
    }
    return top;
  }

  /**
   * Queues node `n` when it wants a split: its distance is under its split distance (the merge distance when it was split last
   * frame). The key is the distance in units of that distance, so the nodes the camera is deepest inside come first.
   */
  private queue(n: number): void {
    const level = this.nLevel[n] as number;
    if (level >= this.params.maxLevel) return;
    const was = this.prevSplit.has(chunkKey(level, this.nIx[n] as number, this.nIy[n] as number));
    const dist = (this.levelK[level] as number) * (was ? 1 + this.params.hysteresis : 1) * (this.size[level] as number);
    const d = this.nD[n] as number;
    if (d < dist) this.heapPush(n, d / dist);
  }

  private refine(): void {
    const max = this.maxChunks;
    this.curSplit.clear();
    this.heapN = 0;
    this.capped = false;
    let nodes = 0;
    let leaves = 0;
    for (let iy = 0; iy < ROOT_ROWS; iy++) {
      for (let ix = 0; ix < ROOT_COLS; ix++) {
        if (!this.bounds(0, ix, iy)) continue;
        this.nLevel[nodes] = 0;
        this.nIx[nodes] = ix;
        this.nIy[nodes] = iy;
        this.nD[nodes] = this.bD;
        this.nSplit[nodes] = 0;
        this.queue(nodes);
        nodes++;
        leaves++;
      }
    }
    while (this.heapN > 0) {
      const n = this.heapPop();
      const level = this.nLevel[n] as number;
      const ix = this.nIx[n] as number;
      const iy = this.nIy[n] as number;
      // The four children: how many of them are visible decides what the split costs in leaves.
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
      if (leaves - 1 + vc > max) {
        this.capped = true; // stays a leaf; a cheaper split (fewer visible children) may still fit
        continue;
      }
      this.nSplit[n] = 1; // (with no visible child the node simply drops out; it is not recorded as split, nothing finer lies there)
      if (vc > 0) this.curSplit.add(chunkKey(level, ix, iy));
      leaves += vc - 1;
      for (let k = 0; k < vc; k++) {
        this.nLevel[nodes] = level + 1;
        this.nIx[nodes] = this.childIx[k] as number;
        this.nIy[nodes] = this.childIy[k] as number;
        this.nD[nodes] = this.childD[k] as number;
        this.nSplit[nodes] = 0;
        this.queue(nodes);
        nodes++;
      }
    }
    // The leaves: every node that was not split, finest last (nodes are created coarse to fine along every branch).
    let count = 0;
    for (let n = 0; n < nodes; n++) {
      if (this.nSplit[n] === 1) continue;
      this.level[count] = this.nLevel[n] as number;
      this.ix[count] = this.nIx[n] as number;
      this.iy[count] = this.nIy[n] as number;
      count++;
    }
    this.count = count;
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
      this.setEdge(4 * i, l, (ix + cols - 1) % cols, iy);
      this.setEdge(4 * i + 1, l, (ix + 1) % cols, iy);
      if (iy > 0) this.setEdge(4 * i + 2, l, ix, iy - 1);
      else this.noEdge(4 * i + 2);
      if (iy < rows - 1) this.setEdge(4 * i + 3, l, ix, iy + 1);
      else this.noEdge(4 * i + 3);
    }
  }

  private noEdge(slot: number): void {
    this.coarser[slot] = 0;
    this.finer[slot] = 0;
  }

  /** Writes how many levels coarser the neighbour cell (nx, ny) of level `level` is, and whether it is split further (finer chunks there). */
  private setEdge(slot: number, level: number, nx: number, ny: number): void {
    const d = this.coarserAcross(level, nx, ny);
    this.coarser[slot] = d;
    // The same-level cell is an internal node of the tree (it was split) exactly when finer leaves lie there.
    this.finer[slot] = d === 0 && this.prevSplit.has(chunkKey(level, nx, ny)) ? 1 : 0;
  }

  /** Levels coarser than `level` of the leaf covering the same-level cell (nx, ny); 0 when that cell is a leaf, is split further, or is not drawn. */
  private coarserAcross(level: number, nx: number, ny: number): number {
    for (let k = 0; k <= level; k++) {
      if (this.leafSet.has(chunkKey(level - k, nx >> k, ny >> k))) return k;
    }
    return 0;
  }
}
