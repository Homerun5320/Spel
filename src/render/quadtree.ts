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
// The budget is STATEFUL so that a camera that wobbles under a binding cap does not make whole subtrees swap every frame (a ranking
// cut-off moves with every tiny camera change): the refinement runs in two passes. Pass A first re-admits every node that was split
// last frame and still passes its (hysteresis-widened) distance test. Pass B then admits the new splits, most urgent first, with the
// budget that is left. When a new split does not fit, it may undo ONE previous split (at most `evictionsPerFrame` per frame) whose own
// urgency is worse than the newcomer's by more than the hysteresis band, so the detail follows the camera at a bounded pace and a
// chunk that is not clearly less important than a newcomer is never swapped out.
//
// Per leaf the result also holds, for each of its four edges, how many levels COARSER the neighbouring leaf is (0 = same level,
// finer, or not drawn): the skirt of the finer chunk has to cover the crack to the coarser one.
import { chunkKey, chunkSizeRad, levelCols, levelRows, ROOT_COLS, ROOT_ROWS } from './chunkMath';

export interface QuadParams {
  /** Hard cap on the leaves (the tier's chunk count; never above 400). */
  maxChunks: number;
  maxLevel: number;
  /** Split distance in chunk sides for chunks whose grid cells are at least eight raster texels wide (the orbit levels). */
  splitK: number;
  /**
   * Split distance for chunks whose cells are 1/8 texel or finer. The height raster has no detail below a texel, so the finer levels
   * only reproduce its smooth bilinear shape and need less distance than the coarse ones (the number of chunks per level grows
   * with K squared and a close camera sees a dozen levels; triangles of a few pixels also shade partly empty 2 x 2 pixel quads).
   * Between eight texels and 1/8 texel per cell the factor falls geometrically.
   */
  deepK: number;
  /** Grid cells per chunk side and the width of one raster texel in radians (they fix which levels are "deep"). */
  cells: number;
  texelRad: number;
  /** Merge distance is the split distance times (1 + hysteresis). */
  hysteresis: number;
  /** The half field of view is widened by this fraction before culling. */
  frustumSlack: number;
  /** Most previous splits that may be undone per frame to make room for a clearly more urgent split under the cap. */
  evictionsPerFrame: number;
  /**
   * Share of the cap that new splits (pass B) leave free. The splits of the last frame (pass A) may use the whole cap, so a camera that
   * wobbles (a few leaves more here and there as chunks cross the frustum edge) never finds the cap exhausted by what it already holds
   * and has to swap equally urgent splits of different cost every frame.
   */
  reserve: number;
  /**
   * The lowest and highest terrain in the rectangle (u0, u1, v0, v1 of the rasters), in Earth radii above the unit sphere
   * (exaggeration applied), written to `lo` and `hi` of the result object the quadtree passes in (allocation-free).
   */
  heightRange(u0: number, u1: number, v0: number, v1: number, out: HeightRange): void;
  /**
   * M07b: the interval of the DETAILED surface of a node in Earth radii (exaggeration applied), when it has one: written to `out` over the
   * base interval, true if it did. The detail moves the surface by up to a good share of the relief, so the base interval alone would put
   * a camera that hovers over the detailed ground kilometres from where the tree thinks the ground is (src/render/detailBounds.ts).
   */
  detailRange?(level: number, ix: number, iy: number, out: HeightRange): boolean;
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

/** A binary min-heap of (node, key) pairs in typed arrays (fixed capacity, no allocation after construction). */
class NodeHeap {
  private readonly node: Int32Array;
  private readonly key: Float64Array;
  n = 0;
  /** The key of the node `pop` returned last. */
  topKey = 0;

  constructor(capacity: number) {
    this.node = new Int32Array(capacity);
    this.key = new Float64Array(capacity);
  }

  clear(): void {
    this.n = 0;
  }

  push(node: number, key: number): void {
    let i = this.n++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if ((this.key[parent] as number) <= key) break;
      this.node[i] = this.node[parent] as number;
      this.key[i] = this.key[parent] as number;
      i = parent;
    }
    this.node[i] = node;
    this.key[i] = key;
  }

  /** Removes and returns the most urgent node (its key goes to `topKey`). */
  pop(): number {
    const top = this.node[0] as number;
    this.topKey = this.key[0] as number;
    const n = --this.n;
    if (n > 0) {
      const node = this.node[n] as number;
      const key = this.key[n] as number;
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && (this.key[c + 1] as number) < (this.key[c] as number)) c++;
        if ((this.key[c] as number) >= key) break;
        this.node[i] = this.node[c] as number;
        this.key[i] = this.key[c] as number;
        i = c;
      }
      this.node[i] = node;
      this.key[i] = key;
    }
    return top;
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
  private readonly reserveLeaves: number;
  // The nodes of the refinement (leaves and the nodes that were split) and the heap of those that want a split.
  private readonly nLevel: Uint8Array;
  private readonly nIx: Int32Array;
  private readonly nIy: Int32Array;
  private readonly nD: Float64Array;
  private readonly nSplit: Uint8Array;
  /** 1 for a node whose parent was undone (it no longer exists), first child and number of visible children of a split node. */
  private readonly nDead: Uint8Array;
  private readonly nChild0: Int32Array;
  private readonly nChildN: Uint8Array;
  /** Pass A re-admits the splits of the last frame; pass B admits the new ones. */
  private readonly heapA: NodeHeap;
  private readonly heapB: NodeHeap;
  /** The nodes pass A split (the candidates to be undone) and how many there are. */
  private readonly victims: Int32Array;
  private victimN = 0;
  private nodeN = 0;
  private leafN = 0;
  /**
   * Splits of the last update that were undone to make room under the cap (a stat, not a result): by pass B for a clearly more urgent
   * newcomer, or by pass A when the splits of the last frame no longer fit together (their children came into view and the cap binds).
   */
  evictions = 0;
  /** The part of `evictions` that pass B made (to make room for a more urgent newcomer): the per-frame limit applies to these. */
  private evictionsB = 0;
  /** Pass B: a newcomer with at least this key found no victim worth undoing, so neither will a less urgent one. */
  private evictFloor = Infinity;
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
    this.reserveLeaves = Math.min(Math.floor(params.reserve * params.maxChunks), params.maxChunks - ROOT_COLS * ROOT_ROWS);
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
    this.nDead = new Uint8Array(nodes);
    this.nChild0 = new Int32Array(nodes);
    this.nChildN = new Uint8Array(nodes);
    this.heapA = new NodeHeap(nodes);
    this.heapB = new NodeHeap(nodes);
    this.victims = new Int32Array(nodes);
    const levels = params.maxLevel + 1;
    this.size = new Float64Array(levels);
    this.halfSin = new Float64Array(levels);
    this.halfCos = new Float64Array(levels);
    this.levelK = new Float64Array(levels);
    for (let l = 0; l < levels; l++) {
      this.size[l] = chunkSizeRad(l);
      this.halfSin[l] = Math.sin(0.5 * (this.size[l] as number));
      this.halfCos[l] = Math.cos(0.5 * (this.size[l] as number));
      // 0 at eight texels per cell and above, 1 at 1/8 texel and below (six octaves, geometric in between).
      const cellTexels = (this.size[l] as number) / params.cells / params.texelRad;
      const deep = Math.min(1, Math.max(0, (3 - Math.log2(cellTexels)) / 6));
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
    if (this.params.detailRange) this.params.detailRange(level, ix, iy, rg);
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

  /**
   * Queues node `n` when it wants a split: its distance is under its split distance (the merge distance when it was split last
   * frame). The key is the distance in units of that distance, so the nodes the camera is deepest inside come first. A node that was
   * split last frame goes to pass A (re-admitted before any newcomer), the others to pass B.
   */
  private queue(n: number): void {
    const level = this.nLevel[n] as number;
    if (level >= this.params.maxLevel) return;
    const was = this.prevSplit.has(chunkKey(level, this.nIx[n] as number, this.nIy[n] as number));
    const dist = (this.levelK[level] as number) * (was ? 1 + this.params.hysteresis : 1) * (this.size[level] as number);
    const d = this.nD[n] as number;
    if (d < dist) (was ? this.heapA : this.heapB).push(n, d / dist);
  }

  private addNode(level: number, ix: number, iy: number, d: number): number {
    const n = this.nodeN++;
    this.nLevel[n] = level;
    this.nIx[n] = ix;
    this.nIy[n] = iy;
    this.nD[n] = d;
    this.nSplit[n] = 0;
    this.nDead[n] = 0;
    this.nChildN[n] = 0;
    this.queue(n);
    return n;
  }

  /**
   * The split of pass A that is the least urgent by more than the hysteresis band compared to a newcomer of urgency `key`, and whose
   * children are all still leaves; -1 when there is none. Urgency of a victim is its distance over its plain split distance.
   */
  private findVictim(key: number): number {
    const need = key * (1 + this.params.hysteresis);
    let best = -1;
    let bestKey = need;
    for (let i = 0; i < this.victimN; i++) {
      const v = this.victims[i] as number;
      const c0 = this.nChild0[v] as number;
      const cn = this.nChildN[v] as number;
      let leaf = true;
      for (let k = 0; k < cn; k++) {
        if (this.nSplit[c0 + k] === 1) {
          leaf = false;
          break;
        }
      }
      if (!leaf) continue;
      const level = this.nLevel[v] as number;
      const kv = (this.nD[v] as number) / ((this.levelK[level] as number) * (this.size[level] as number));
      if (kv > bestKey) {
        bestKey = kv;
        best = i;
      }
    }
    return best;
  }

  /** Undoes the split of victim slot `slot`: its children disappear and it is a leaf again. */
  private evict(slot: number): void {
    const v = this.victims[slot] as number;
    const c0 = this.nChild0[v] as number;
    const cn = this.nChildN[v] as number;
    for (let k = 0; k < cn; k++) this.nDead[c0 + k] = 1;
    this.nSplit[v] = 0;
    this.nChildN[v] = 0;
    this.leafN += 1 - cn;
    this.victims[slot] = this.victims[--this.victimN] as number;
    this.evictions++;
    this.evictionsB++;
  }

  /** Splits queued nodes of one heap, most urgent first, as far as the cap allows (pass B may undo clearly less urgent splits of pass A). */
  private drain(heap: NodeHeap, passB: boolean): void {
    const max = passB ? this.maxChunks - this.reserveLeaves : this.maxChunks;
    while (heap.n > 0) {
      const n = heap.pop();
      if (this.nDead[n] === 1) continue;
      const key = heap.topKey;
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
      if (passB && this.leafN - 1 + vc > max && key < this.evictFloor) {
        while (this.leafN - 1 + vc > max && this.evictionsB < this.params.evictionsPerFrame) {
          const slot = this.findVictim(key);
          if (slot < 0) {
            this.evictFloor = key;
            break;
          }
          this.evict(slot);
        }
      }
      if (this.nDead[n] === 1) continue; // (undone with its parent to make room: cannot happen for a newcomer less urgent than its parent, kept as a guard)
      if (this.leafN - 1 + vc > max) {
        this.capped = true; // stays a leaf; a cheaper split (fewer visible children) may still fit
        // A split of the last frame that no longer fits in pass A (its children became visible, the cap binds) is undone for the cap too.
        if (!passB) this.evictions++;
        continue;
      }
      this.nSplit[n] = 1; // (with no visible child the node simply drops out; nothing finer lies there)
      this.nChild0[n] = this.nodeN;
      this.nChildN[n] = vc;
      if (!passB && vc > 0) this.victims[this.victimN++] = n;
      this.leafN += vc - 1;
      for (let k = 0; k < vc; k++) this.addNode(level + 1, this.childIx[k] as number, this.childIy[k] as number, this.childD[k] as number);
    }
  }

  private refine(): void {
    this.curSplit.clear();
    this.heapA.clear();
    this.heapB.clear();
    this.capped = false;
    this.nodeN = 0;
    this.leafN = 0;
    this.victimN = 0;
    this.evictions = 0;
    this.evictionsB = 0;
    this.evictFloor = Infinity;
    for (let iy = 0; iy < ROOT_ROWS; iy++) {
      for (let ix = 0; ix < ROOT_COLS; ix++) {
        if (!this.bounds(0, ix, iy)) continue;
        this.addNode(0, ix, iy, this.bD);
        this.leafN++;
      }
    }
    this.drain(this.heapA, false);
    this.drain(this.heapB, true);
    // The leaves: every node that exists and was not split, finest last (nodes are created coarse to fine along every branch). The
    // splits that stand are this frame's history.
    let count = 0;
    for (let n = 0; n < this.nodeN; n++) {
      if (this.nDead[n] === 1) continue;
      if (this.nSplit[n] === 1) {
        // 1: finer leaves lie here; 2: split but nothing finer is visible (the node drops out; remembered so that next frame's pass A
        // re-admits it, it frees a leaf instead of costing one)
        this.curSplit.add(chunkKey(this.nLevel[n] as number, this.nIx[n] as number, this.nIy[n] as number), (this.nChildN[n] as number) > 0 ? 1 : 2);
        continue;
      }
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
    this.finer[slot] = d === 0 && this.prevSplit.get(chunkKey(level, nx, ny)) === 1 ? 1 : 0;
  }

  /** Levels coarser than `level` of the leaf covering the same-level cell (nx, ny); 0 when that cell is a leaf, is split further, or is not drawn. */
  private coarserAcross(level: number, nx: number, ny: number): number {
    for (let k = 0; k <= level; k++) {
      if (this.leafSet.has(chunkKey(level - k, nx >> k, ny >> k))) return k;
    }
    return 0;
  }
}
