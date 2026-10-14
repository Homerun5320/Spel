// The chunk terrain: the quadtree (quadtree.ts) feeding ONE instanced draw of a shared grid mesh (chunkMesh.ts) through the chunk
// vertex shader (shaders/chunk.ts). Owns the instance buffers, refilled each frame from the camera: per chunk the camera-relative
// origin (a float64 difference stored as float32), the tangent basis, the lat/lon extent, the level, the skirt depth, the
// neighbour levels and a debug hue. The only three.js user of the chunk code besides the material.
import { DynamicDrawUsage, InstancedBufferAttribute, InstancedBufferGeometry, BufferAttribute, Mesh, type ShaderMaterial } from 'three';
import type { CameraPose } from './camera';
import { buildChunkGrid, type ChunkGrid } from './chunkMesh';
import { chunkGeo, chunkHue, chunkSizeRad, makeChunkGeo } from './chunkMath';
import { CHUNK_BUDGET_PASSES, CHUNK_BUDGET_SHRINK, CHUNK_FRUSTUM_SLACK, CHUNK_HYSTERESIS, CHUNK_MAX_LEVEL, EARTH_RADIUS_KM } from './config';
import { POLE_HEIGHT_U } from './geo';
import { HeightPyramid } from './heightPyramid';
import { ChunkQuadtree, makeQuadCamera, type HeightRange, type QuadCamera } from './quadtree';
import { CHUNK_ABSOLUTE_MAX, chunkTriangles, type QualitySettings } from './quality';

export interface ChunkTerrainOptions {
  material: ShaderMaterial;
  quality: QualitySettings;
  /** The u8 sqrt-coded height codes (the very bytes of the height texture) and their size. */
  codes: Uint8Array;
  width: number;
  height: number;
  /** Largest decoded height in metres (meta.json). */
  maxM: number;
  /** Height exaggeration the shader currently uses (kept in step by `setExaggeration`). */
  exaggeration: number;
}

/** What the tests and the perf overlay read of the chunk terrain. */
export interface ChunkStats {
  chunkCount: number;
  /** Distinct quadtree levels among the chunks drawn. */
  lodLevels: number;
  /** The levels themselves, ascending. */
  levels: number[];
  /** Triangles drawn (chunks times the triangles of one instance, skirts included). */
  triangles: number;
  drawCalls: number;
  /** Selection passes the last update needed (1 = the wanted detail fitted the tier's chunk cap). */
  passes: number;
}

const FLOATS = 4; // per instance attribute
const ATTRS = 5;

export class ChunkTerrain {
  readonly mesh: Mesh;
  readonly grid: ChunkGrid;
  readonly tree: ChunkQuadtree;
  readonly pyramid: HeightPyramid;
  private readonly geometry: InstancedBufferGeometry;
  private readonly attrs: InstancedBufferAttribute[] = [];
  private readonly data: Float32Array[] = [];
  private readonly cells: number;
  private readonly capacity: number;
  private readonly cam: QuadCamera = makeQuadCamera();
  private readonly geo = makeChunkGeo();
  private exag: number;
  private readonly maxM: number;
  private lastKey = new Float64Array(16).fill(NaN);
  private levelMask = 0;
  private readonly trianglesPerChunk: number;

  constructor(o: ChunkTerrainOptions) {
    this.cells = o.quality.chunkCells;
    this.capacity = Math.min(o.quality.chunkMax, CHUNK_ABSOLUTE_MAX);
    this.exag = o.exaggeration;
    this.maxM = o.maxM;
    this.pyramid = new HeightPyramid(o.codes, o.width, o.height);
    this.grid = buildChunkGrid(this.cells);
    this.trianglesPerChunk = chunkTriangles(o.quality);
    if (this.grid.triangles !== this.trianglesPerChunk) throw new Error(`chunk grid has ${this.grid.triangles} triangles, expected ${this.trianglesPerChunk}`);
    this.tree = new ChunkQuadtree({
      maxChunks: this.capacity,
      maxLevel: CHUNK_MAX_LEVEL,
      splitK: o.quality.chunkSplitK,
      deepK: o.quality.chunkDeepK,
      cells: this.cells,
      texelRad: (2 * Math.PI) / o.width,
      hysteresis: CHUNK_HYSTERESIS,
      frustumSlack: CHUNK_FRUSTUM_SLACK,
      budgetShrink: CHUNK_BUDGET_SHRINK,
      budgetPasses: CHUNK_BUDGET_PASSES,
      heightRange: (u0, u1, v0, v1, out) => this.heightRange(u0, u1, v0, v1, out),
    });
    const g = new InstancedBufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.grid.position, 3));
    g.setIndex(new BufferAttribute(this.grid.index, 1));
    const names = ['aOrigin', 'aUp', 'aEast', 'aGeo', 'aNeigh'];
    for (let a = 0; a < ATTRS; a++) {
      const arr = new Float32Array(this.capacity * FLOATS);
      const attr = new InstancedBufferAttribute(arr, FLOATS, false, 1);
      attr.setUsage(DynamicDrawUsage);
      g.setAttribute(names[a] as string, attr);
      this.data.push(arr);
      this.attrs.push(attr);
    }
    g.instanceCount = 0;
    this.geometry = g;
    this.mesh = new Mesh(g, o.material);
    this.mesh.frustumCulled = false; // culling is the quadtree's job; the geometry has no meaningful bounding volume
    this.mesh.visible = false;
  }

  /** Height exaggeration used for the bounding volumes (must follow the shader's `uExag`). */
  setExaggeration(x: number): void {
    this.exag = x;
    this.lastKey.fill(NaN);
  }

  /** Forgets the LOD hysteresis (a camera jump: the next update decides every chunk by the split distance alone) and forces the next update to run. */
  reset(): void {
    this.tree.reset();
    this.lastKey.fill(NaN);
  }

  private heightRange(u0: number, u1: number, v0: number, v1: number, out: HeightRange): void {
    this.pyramid.range(u0, u1, v0, v1);
    let loC = this.pyramid.minCode;
    let hiC = this.pyramid.maxCode;
    if (v0 <= 0 || v1 >= 1) {
      // The pole rows read the height at one common longitude (POLE_HEIGHT_U), wherever the chunk is.
      this.pyramid.range(POLE_HEIGHT_U, POLE_HEIGHT_U, v0, v1);
      if (this.pyramid.minCode < loC) loC = this.pyramid.minCode;
      if (this.pyramid.maxCode > hiC) hiC = this.pyramid.maxCode;
    }
    const k = this.exag * this.maxM / (EARTH_RADIUS_KM * 1000);
    const lo = loC / 255;
    const hi = hiC / 255;
    out.lo = k * lo * lo;
    out.hi = k * hi * hi;
  }

  /** Selects the chunks for the camera and refills the instance buffers. Does nothing when the camera has not moved. */
  update(pose: CameraPose): void {
    const k = this.lastKey;
    const p = pose.position;
    const f = pose.forward;
    const r = pose.right;
    const u = pose.up;
    if (
      k[0] === p[0] && k[1] === p[1] && k[2] === p[2] &&
      k[3] === f[0] && k[4] === f[1] && k[5] === f[2] &&
      k[6] === r[0] && k[7] === r[1] && k[8] === r[2] &&
      k[9] === u[0] && k[10] === u[1] && k[11] === u[2] &&
      k[12] === pose.fovDeg && k[13] === pose.aspect && k[14] === this.exag
    ) {
      return;
    }
    k[0] = p[0]; k[1] = p[1]; k[2] = p[2];
    k[3] = f[0]; k[4] = f[1]; k[5] = f[2];
    k[6] = r[0]; k[7] = r[1]; k[8] = r[2];
    k[9] = u[0]; k[10] = u[1]; k[11] = u[2];
    k[12] = pose.fovDeg; k[13] = pose.aspect; k[14] = this.exag;
    const c = this.cam;
    c.px = p[0]; c.py = p[1]; c.pz = p[2];
    c.fx = f[0]; c.fy = f[1]; c.fz = f[2];
    c.rx = r[0]; c.ry = r[1]; c.rz = r[2];
    c.ux = u[0]; c.uy = u[1]; c.uz = u[2];
    c.tanY = Math.tan((pose.fovDeg * Math.PI) / 360);
    c.aspect = pose.aspect;
    this.tree.update(c);
    this.fill();
  }

  private fill(): void {
    const t = this.tree;
    const n = t.count;
    const c = this.cam;
    const g = this.geo;
    const [d0, d1, d2, d3, d4] = this.data as [Float32Array, Float32Array, Float32Array, Float32Array, Float32Array];
    let mask = 0;
    for (let i = 0; i < n; i++) {
      const level = t.level[i] as number;
      chunkGeo(level, t.ix[i] as number, t.iy[i] as number, g);
      const o = i * FLOATS;
      // 0: origin relative to the camera (float64 difference, rounded once to float32) and the level
      d0[o] = g.cx - c.px;
      d0[o + 1] = g.cy - c.py;
      d0[o + 2] = g.cz - c.pz;
      d0[o + 3] = level;
      // 1: centre direction and the size of one grid cell
      d1[o] = g.cx;
      d1[o + 1] = g.cy;
      d1[o + 2] = g.cz;
      d1[o + 3] = chunkSizeRad(level) / this.cells;
      // 2: east and the debug hue
      d2[o] = g.ex;
      d2[o + 1] = 0;
      d2[o + 2] = g.ez;
      d2[o + 3] = chunkHue(level, g.ix, g.iy);
      // 3: latitude and longitude of the centre and the extents
      d3[o] = g.latC;
      d3[o + 1] = g.dLat;
      d3[o + 2] = g.dLon;
      d3[o + 3] = g.lonC;
      // 4: how many levels coarser the neighbours are
      d4[o] = t.coarser[4 * i] as number;
      d4[o + 1] = t.coarser[4 * i + 1] as number;
      d4[o + 2] = t.coarser[4 * i + 2] as number;
      d4[o + 3] = t.coarser[4 * i + 3] as number;
      mask |= 1 << level;
    }
    for (const a of this.attrs) {
      a.clearUpdateRanges();
      if (n > 0) a.addUpdateRange(0, n * FLOATS);
      a.needsUpdate = true;
    }
    this.geometry.instanceCount = n;
    this.mesh.visible = n > 0;
    this.levelMask = mask;
  }

  /** The numbers of the last update (allocates; for tests, the perf overlay and `__test.state()`, not for the frame loop). */
  getStats(): ChunkStats {
    const levels: number[] = [];
    for (let l = 0; l <= CHUNK_MAX_LEVEL; l++) if ((this.levelMask & (1 << l)) !== 0) levels.push(l);
    const n = this.tree.count;
    return { chunkCount: n, lodLevels: levels.length, levels, triangles: n * this.trianglesPerChunk, drawCalls: n > 0 ? 1 : 0, passes: this.tree.passes };
  }

  /** True when every float of the instance data of the drawn chunks is finite (the NaN check of the jitter test). */
  allFinite(): boolean {
    const n = this.tree.count * FLOATS;
    for (const arr of this.data) for (let i = 0; i < n; i++) if (!Number.isFinite(arr[i] as number)) return false;
    return true;
  }

  /** The chunks of the last update as plain data (tests): level, column, row, and the four neighbour levels. */
  leaves(): Array<{ level: number; ix: number; iy: number; coarser: [number, number, number, number] }> {
    const t = this.tree;
    const out: Array<{ level: number; ix: number; iy: number; coarser: [number, number, number, number] }> = [];
    for (let i = 0; i < t.count; i++) {
      out.push({ level: t.level[i] as number, ix: t.ix[i] as number, iy: t.iy[i] as number, coarser: [t.coarser[4 * i] as number, t.coarser[4 * i + 1] as number, t.coarser[4 * i + 2] as number, t.coarser[4 * i + 3] as number] });
    }
    return out;
  }

  dispose(): void {
    this.geometry.dispose();
  }
}
