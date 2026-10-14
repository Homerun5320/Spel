// The chunk terrain: the quadtree (quadtree.ts) feeding ONE instanced draw of a shared grid mesh (chunkMesh.ts) through the chunk
// vertex shader (shaders/chunk.ts). Owns the instance buffer: per chunk the centre direction as a high and a low float32 part (so
// the shader forms "chunk minus camera" in two parts and the instance data does NOT depend on the camera), the tangent basis, the
// lat/lon extent, the level, the size of a cell, the neighbour levels and a debug hue. The buffer is refilled and uploaded only when
// the selection of chunks changes, not whenever the camera moves; the camera goes to the shader as two vec3 uniforms (hi, lo).
// The only three.js user of the chunk code besides the material.
import { BufferAttribute, DynamicDrawUsage, InstancedBufferGeometry, InstancedInterleavedBuffer, InterleavedBufferAttribute, Mesh, type ShaderMaterial } from 'three';
import type { CameraPose } from './camera';
import { buildChunkGrid, type ChunkGrid } from './chunkMesh';
import { chunkGeo, chunkHue, chunkSizeRad, makeChunkGeo } from './chunkMath';
import { CHUNK_FRUSTUM_SLACK, CHUNK_HYSTERESIS, CHUNK_MAX_LEVEL, EARTH_RADIUS_KM, OWNER_GRID_H, OWNER_GRID_W } from './config';
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
  /** True when the tier's chunk cap refused splits the camera distance asked for (the far detail is lower than wanted). */
  capped: boolean;
}

const ATTR_FLOATS = 4; // floats per instance attribute (a vec4)
const ATTRS = 6;
const STRIDE = ATTR_FLOATS * ATTRS; // floats per instance: ONE interleaved buffer, one upload per frame

export class ChunkTerrain {
  readonly mesh: Mesh;
  readonly grid: ChunkGrid;
  readonly tree: ChunkQuadtree;
  readonly pyramid: HeightPyramid;
  private readonly geometry: InstancedBufferGeometry;
  private readonly buffer: InstancedInterleavedBuffer;
  private readonly data: Float32Array;
  private readonly cells: number;
  private readonly capacity: number;
  private readonly cam: QuadCamera = makeQuadCamera();
  private readonly geo = makeChunkGeo();
  private exag: number;
  private readonly maxM: number;
  private lastKey = new Float64Array(16).fill(NaN);
  // The leaves the instance buffer holds (to see whether a new selection differs from it).
  private heldCount = -1;
  private readonly heldLevel: Uint8Array;
  private readonly heldIx: Int32Array;
  private readonly heldIy: Int32Array;
  private readonly heldCoarser: Uint8Array;
  private readonly camHi: { value: { set(x: number, y: number, z: number): unknown } };
  private readonly camLo: { value: { set(x: number, y: number, z: number): unknown } };
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
      heightRange: (u0, u1, v0, v1, out) => this.heightRange(u0, u1, v0, v1, out),
    });
    const g = new InstancedBufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.grid.position, 3));
    g.setIndex(new BufferAttribute(this.grid.index, 1));
    this.heldLevel = new Uint8Array(this.capacity);
    this.heldIx = new Int32Array(this.capacity);
    this.heldIy = new Int32Array(this.capacity);
    this.heldCoarser = new Uint8Array(4 * this.capacity);
    this.camHi = o.material.uniforms.uCamHi as typeof this.camHi;
    this.camLo = o.material.uniforms.uCamLo as typeof this.camLo;
    if (!this.camHi || !this.camLo) throw new Error('the chunk material must carry uCamHi and uCamLo');
    this.data = new Float32Array(this.capacity * STRIDE);
    this.buffer = new InstancedInterleavedBuffer(this.data, STRIDE, 1);
    this.buffer.setUsage(DynamicDrawUsage);
    ['aOrigin', 'aUp', 'aEast', 'aGeo', 'aNeigh', 'aCell'].forEach((name, a) => g.setAttribute(name, new InterleavedBufferAttribute(this.buffer, ATTR_FLOATS, a * ATTR_FLOATS)));
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
    this.heldCount = -1;
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
    // The camera for the shader as a high and a low part: chunk minus camera is formed there as (hi - hi) + (lo - lo).
    const hx = Math.fround(c.px);
    const hy = Math.fround(c.py);
    const hz = Math.fround(c.pz);
    this.camHi.value.set(hx, hy, hz);
    this.camLo.value.set(c.px - hx, c.py - hy, c.pz - hz);
    if (this.selectionChanged()) this.fill();
  }

  /** True when the tree's leaves (or their neighbour levels) differ from what the instance buffer holds. */
  private selectionChanged(): boolean {
    const t = this.tree;
    const n = t.count;
    if (n !== this.heldCount) return true;
    for (let i = 0; i < n; i++) {
      if (t.level[i] !== this.heldLevel[i] || t.ix[i] !== this.heldIx[i] || t.iy[i] !== this.heldIy[i]) return true;
      const o = 4 * i;
      if (t.coarser[o] !== this.heldCoarser[o] || t.coarser[o + 1] !== this.heldCoarser[o + 1] || t.coarser[o + 2] !== this.heldCoarser[o + 2] || t.coarser[o + 3] !== this.heldCoarser[o + 3]) return true;
    }
    return false;
  }

  private fill(): void {
    const t = this.tree;
    const n = t.count;
    const g = this.geo;
    const d = this.data;
    let mask = 0;
    // The quadtree emits its leaves coarse level first; the finest chunks are the ones nearest to the camera, so drawing them in the
    // reverse order is (nearly) front to back: the early depth test then rejects the far chunks and the skirts behind them before the
    // expensive fragment shader runs (the instances are drawn in the order of the buffer).
    for (let i = 0; i < n; i++) {
      const src = n - 1 - i;
      const level = t.level[src] as number;
      chunkGeo(level, t.ix[src] as number, t.iy[src] as number, g);
      const o = i * STRIDE;
      // 1: centre direction (the high part, a float32) and the size of one grid cell
      d[o + 4] = g.cx;
      d[o + 5] = g.cy;
      d[o + 6] = g.cz;
      d[o + 7] = chunkSizeRad(level) / this.cells;
      // 0: the low part of the centre direction (what the float32 above left out, exact in float32) and the level
      d[o] = g.cx - (d[o + 4] as number);
      d[o + 1] = g.cy - (d[o + 5] as number);
      d[o + 2] = g.cz - (d[o + 6] as number);
      d[o + 3] = level;
      // 2: east and the debug hue
      d[o + 8] = g.ex;
      d[o + 9] = 0;
      d[o + 10] = g.ez;
      d[o + 11] = chunkHue(level, g.ix, g.iy);
      // 3: latitude and longitude of the centre and the extents
      d[o + 12] = g.latC;
      d[o + 13] = g.dLat;
      d[o + 14] = g.dLon;
      d[o + 15] = g.lonC;
      // 4: how many levels coarser the neighbours are (-1: finer)
      // (a neighbour that is split further is marked -1: the finer chunks there are lower or higher than this edge, so the wall stays deep)
      for (let k = 0; k < 4; k++) d[o + 16 + k] = t.finer[4 * src + k] === 1 ? -1 : (t.coarser[4 * src + k] as number);
      // 5: the ownership grid cell the centre is in and the position inside it (float64 here, so the shader's territory position is exact to a millimetre)
      const cellX = (g.lonC / (2 * Math.PI) + 0.5) * OWNER_GRID_W;
      const cellY = (0.5 - g.latC / Math.PI) * OWNER_GRID_H;
      const baseX = Math.floor(cellX);
      const baseY = Math.floor(cellY);
      d[o + 20] = baseX;
      d[o + 21] = baseY;
      d[o + 22] = cellX - baseX;
      d[o + 23] = cellY - baseY;
      mask |= 1 << level;
    }
    this.buffer.clearUpdateRanges();
    if (n > 0) this.buffer.addUpdateRange(0, n * STRIDE);
    this.buffer.needsUpdate = true;
    this.geometry.instanceCount = n;
    this.mesh.visible = n > 0;
    this.levelMask = mask;
    // Remember what the buffer holds.
    this.heldCount = n;
    for (let i = 0; i < n; i++) {
      this.heldLevel[i] = t.level[i] as number;
      this.heldIx[i] = t.ix[i] as number;
      this.heldIy[i] = t.iy[i] as number;
      for (let k = 0; k < 4; k++) this.heldCoarser[4 * i + k] = t.coarser[4 * i + k] as number;
    }
  }

  /** The numbers of the last update (allocates; for tests, the perf overlay and `__test.state()`, not for the frame loop). */
  getStats(): ChunkStats {
    const levels: number[] = [];
    for (let l = 0; l <= CHUNK_MAX_LEVEL; l++) if ((this.levelMask & (1 << l)) !== 0) levels.push(l);
    const n = this.tree.count;
    return { chunkCount: n, lodLevels: levels.length, levels, triangles: n * this.trianglesPerChunk, drawCalls: n > 0 ? 1 : 0, capped: this.tree.capped };
  }

  /** True when every float of the instance data of the drawn chunks is finite (the NaN check of the jitter test). */
  allFinite(): boolean {
    const n = this.tree.count * STRIDE;
    for (let i = 0; i < n; i++) if (!Number.isFinite(this.data[i] as number)) return false;
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
