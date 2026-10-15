// The structure layer (M10): ONE instanced-mesh pipeline for every structure type. `STRUCTURE_MODELS` (structureModels.ts) says which types have a model;
// this file makes one `InstancedBufferGeometry` + mesh per modelled type (one draw call each, none while the type has no instance), plus a single
// ghost mesh for the placement preview. It reads the snapshot's structure table (a `StructureView`) and nothing else: the sim is out of reach.
//
// PLACEMENT. An instance stands on `groundHeightAt` (all octaves, the foundation rule of docs/ARCHITECTURE.md), times the height exaggeration, in
// the direction of its cell centre; its up axis is the globe normal. The position is kept in float64 here and handed to the GPU as a float32 pair
// (`aHi`, `aLo`), so it does not swim against the ground (rules for layers (1)). The scale policy, pop-in and the construction look are in the
// shader (shaders/structures.ts). Nothing here allocates per frame: `frame` sets uniforms; the buffers are rewritten only when the table, the
// palette or the exaggeration changed.
import { DoubleSide, DynamicDrawUsage, BufferAttribute, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, ShaderMaterial, Vector3, Vector4 } from 'three';
import type { StructureView } from '../sim/public';
import { EARTH_RADIUS_KM, GHOST_ALPHA, GHOST_BAD_RGB, GHOST_MIX, GHOST_OK_RGB, HEIGHT_EXAGGERATION, STRUCT_BUILD_MIN_HEIGHT, STRUCT_LEVEL_SCALE, STRUCT_MAX_SCALE, STRUCT_POP_SECONDS, STRUCT_SCREEN_FRAC, STRUCT_TRIANGLE_BUDGET, AMBIENT_DAY, AMBIENT_NIGHT, SUN_COLOR } from './config';
import { latLonToVec } from './geo';
import type { QualityTier } from './quality';
import { STRUCTURE_MODELS, modelledTypes, type ModelData } from './structureModels';
import { structureFragmentShader, structureVertexShader } from './shaders/structures';
import { cellToLatLon, groundHeightAt } from './transforms';

/** A structure as the layer drew it (float64 numbers, for tests and the props hook). */
export interface DrawnStructure {
  id: number;
  type: number;
  owner: number;
  cell: number;
  level: number;
  lat: number;
  lon: number;
  /** Radius of the base in Earth radii (1 = sea level), the exaggeration in. */
  radius: number;
  /** The same as render metres above the sea-level sphere: `(radius - 1) * R`. Equals `exaggeration * groundHeightAt` to float64 rounding. */
  heightM: number;
}

interface TypeLayer {
  readonly type: number;
  readonly model: ModelData;
  readonly cap: number;
  readonly geometry: InstancedBufferGeometry;
  readonly material: ShaderMaterial;
  readonly mesh: Mesh;
  readonly hi: Float32Array;
  readonly lo: Float32Array;
  readonly params: Float32Array;
  readonly rgb: Float32Array;
  readonly build: Float32Array;
  readonly attrs: InstancedBufferAttribute[];
  count: number;
}

const FLOATS = { hi: 3, lo: 3, params: 4, owner: 3, build: 2 } as const;
const NEVER = -1e9;

function yawOf(id: number): number {
  return (Math.imul(id + 1, 0x9e3779b1) >>> 0) / 4294967296 * Math.PI * 2;
}

export interface StructureLayerOptions {
  readonly tier: QualityTier;
  /** The sim grid of the match (cells <-> latitude / longitude). */
  readonly gridWidth: number;
  readonly gridHeight: number;
  /** The shared sun direction vector of the globe (updated by `Globe.render` every frame). */
  readonly sun: Vector3;
}

export class StructureLayer {
  readonly meshes: Mesh[] = [];
  private readonly layers = new Map<number, TypeLayer>();
  private readonly gridWidth: number;
  private readonly gridHeight: number;
  private readonly uniforms: Record<string, { value: unknown }>;
  private readonly camHi = new Vector3();
  private readonly camLo = new Vector3();
  private readonly ghost: { mesh: Mesh; geometry: InstancedBufferGeometry; material: ShaderMaterial; type: number; cell: number; ok: boolean; attrs: InstancedBufferAttribute[] } | null;
  private exaggeration = HEIGHT_EXAGGERATION;
  private palette: Uint8Array | null = null;
  private table: StructureView | null = null;
  private tableVersion = -1;
  private builtKey = '';
  private dirty = true;
  private drawn: DrawnStructure[] = [];
  /** The ids already shown once: a structure that appears while the layer is watching pops in, one that was there at the start does not. */
  private readonly seenKey: Int32Array;
  private readonly born: Float32Array;
  private primed = false;
  /** Structures left out because a type's instance cap was reached. */
  dropped = 0;
  private fxTime = 0;

  constructor(o: StructureLayerOptions) {
    this.gridWidth = o.gridWidth;
    this.gridHeight = o.gridHeight;
    this.seenKey = new Int32Array(4096).fill(-1);
    this.born = new Float32Array(4096).fill(NEVER);
    const v4 = (rgb: readonly number[]): Vector3 => new Vector3(rgb[0], rgb[1], rgb[2]);
    this.uniforms = {
      uCamHi: { value: this.camHi },
      uCamLo: { value: this.camLo },
      uPxK: { value: STRUCT_SCREEN_FRAC },
      uMaxScale: { value: STRUCT_MAX_SCALE },
      uKmPerUnit: { value: EARTH_RADIUS_KM },
      uTime: { value: 0 },
      uTick: { value: 0 },
      uPopSeconds: { value: STRUCT_POP_SECONDS },
      uBuildMin: { value: STRUCT_BUILD_MIN_HEIGHT },
      uSun: { value: o.sun },
      uSunColor: { value: v4(SUN_COLOR) },
      uAmbientDay: { value: v4(AMBIENT_DAY) },
      uAmbientNight: { value: v4(AMBIENT_NIGHT) },
    };
    const budget = STRUCT_TRIANGLE_BUDGET[o.tier];
    for (const type of modelledTypes()) {
      const spec = STRUCTURE_MODELS[type];
      if (spec === undefined) continue;
      const model = spec.build();
      const cap = Math.max(1, Math.floor(budget / model.triangles));
      const geometry = new InstancedBufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(model.positions, 3));
      geometry.setAttribute('aColor', new BufferAttribute(model.colors, 3));
      geometry.setAttribute('aTint', new BufferAttribute(model.tints, 1));
      const hi = new Float32Array(cap * FLOATS.hi);
      const lo = new Float32Array(cap * FLOATS.lo);
      const params = new Float32Array(cap * FLOATS.params);
      const rgb = new Float32Array(cap * FLOATS.owner);
      const build = new Float32Array(cap * FLOATS.build);
      const attrs = [
        this.instanced(geometry, 'aHi', hi, FLOATS.hi),
        this.instanced(geometry, 'aLo', lo, FLOATS.lo),
        this.instanced(geometry, 'aParams', params, FLOATS.params),
        this.instanced(geometry, 'aOwner', rgb, FLOATS.owner),
        this.instanced(geometry, 'aBuild', build, FLOATS.build),
      ];
      geometry.instanceCount = 0;
      const material = this.makeMaterial(spec.radiusM, false);
      const mesh = new Mesh(geometry, material);
      mesh.frustumCulled = false; // the instances are all over the globe; the bounding volume of the shared geometry says nothing
      mesh.visible = false;
      this.meshes.push(mesh);
      this.layers.set(type, { type, model, cap, geometry, material, mesh, hi, lo, params, rgb, build, attrs, count: 0 });
    }
    // The ghost: one instance of the City's model (any modelled type: the first one) drawn see-through in green or red.
    const first = this.layers.values().next().value as TypeLayer | undefined;
    if (first !== undefined) {
      const geometry = new InstancedBufferGeometry();
      geometry.setAttribute('position', first.geometry.getAttribute('position'));
      geometry.setAttribute('aColor', first.geometry.getAttribute('aColor'));
      geometry.setAttribute('aTint', first.geometry.getAttribute('aTint'));
      const attrs = [
        this.instanced(geometry, 'aHi', new Float32Array(3), 3),
        this.instanced(geometry, 'aLo', new Float32Array(3), 3),
        this.instanced(geometry, 'aParams', new Float32Array(4), 4),
        this.instanced(geometry, 'aOwner', new Float32Array(3), 3),
        this.instanced(geometry, 'aBuild', new Float32Array(2), 2),
      ];
      geometry.instanceCount = 1;
      const material = this.makeMaterial(STRUCTURE_MODELS[first.type]?.radiusM ?? 700, true);
      const mesh = new Mesh(geometry, material);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = 5;
      this.meshes.push(mesh);
      this.ghost = { mesh, geometry, material, type: 0, cell: -1, ok: true, attrs };
    } else {
      this.ghost = null;
    }
  }

  private instanced(geometry: InstancedBufferGeometry, name: string, array: Float32Array, size: number): InstancedBufferAttribute {
    const a = new InstancedBufferAttribute(array, size);
    a.setUsage(DynamicDrawUsage);
    geometry.setAttribute(name, a);
    return a;
  }

  private makeMaterial(radiusM: number, ghost: boolean): ShaderMaterial {
    return new ShaderMaterial({
      uniforms: { ...this.uniforms, uSizeM: { value: radiusM }, uGhost: { value: new Vector4(0, 0, 0, 0) }, uAlpha: { value: ghost ? GHOST_ALPHA : 1 } },
      vertexShader: structureVertexShader,
      fragmentShader: structureFragmentShader,
      side: DoubleSide,
      transparent: ghost,
      depthWrite: !ghost,
    });
  }

  /** The owner colours (RGBA bytes per ownerId, as `buildOwnerPalette` makes them). */
  setOwnerPalette(rgba: Uint8Array): void {
    this.palette = rgba;
    this.dirty = true;
  }

  setExaggeration(x: number): void {
    this.exaggeration = x;
    this.dirty = true;
  }

  /** Hands the layer the snapshot's table; instances are rebuilt when `version` moved (or the palette / exaggeration changed). */
  setTable(table: StructureView, version: number): void {
    this.table = table;
    if (version !== this.tableVersion) {
      this.tableVersion = version;
      this.dirty = true;
    }
  }

  /** Per frame: the camera position (float64, Earth radii), the fx time and the sim tick as a fraction. */
  frame(camera: ArrayLike<number>, fxTime: number, tickFraction: number): void {
    const x = camera[0] as number;
    const y = camera[1] as number;
    const z = camera[2] as number;
    const hx = Math.fround(x);
    const hy = Math.fround(y);
    const hz = Math.fround(z);
    this.camHi.set(hx, hy, hz);
    this.camLo.set(x - hx, y - hy, z - hz);
    (this.uniforms.uTime as { value: number }).value = fxTime;
    (this.uniforms.uTick as { value: number }).value = tickFraction;
    this.fxTime = fxTime;
    if (this.dirty) this.rebuild();
  }

  /** Where an instance of a cell stands: the direction of the cell centre at the radius of the ground there (float64). */
  private place(cell: number): { lat: number; lon: number; radius: number; heightM: number; x: number; y: number; z: number } {
    const ll = cellToLatLon(cell, this.gridWidth, this.gridHeight);
    const ground = groundHeightAt(ll.lat, ll.lon);
    const radius = 1 + (this.exaggeration * ground) / (EARTH_RADIUS_KM * 1000);
    const d = latLonToVec(ll.lat, ll.lon);
    return { lat: ll.lat, lon: ll.lon, radius, heightM: (radius - 1) * EARTH_RADIUS_KM * 1000, x: d[0] * radius, y: d[1] * radius, z: d[2] * radius };
  }

  private rebuild(): void {
    this.dirty = false;
    const t = this.table;
    if (t === null || this.palette === null) return;
    for (const l of this.layers.values()) l.count = 0;
    this.drawn = [];
    this.dropped = 0;
    const palette = this.palette;
    for (let id = 0; id < t.highWater; id++) {
      const owner = t.owner[id] as number;
      if (owner === 0) {
        this.seenKey[id] = -1;
        continue;
      }
      const type = t.type[id] as number;
      const layer = this.layers.get(type);
      if (layer === undefined) continue; // a type without a model is not drawn yet
      const cell = t.cell[id] as number;
      const key = cell * 8 + type;
      if (this.seenKey[id] !== key) {
        this.seenKey[id] = key;
        this.born[id] = this.primed ? this.fxTime : NEVER;
      }
      if (layer.count >= layer.cap) {
        this.dropped++;
        continue;
      }
      const level = t.level[id] as number;
      const p = this.place(cell);
      const i = layer.count++;
      layer.hi[i * 3] = Math.fround(p.x);
      layer.hi[i * 3 + 1] = Math.fround(p.y);
      layer.hi[i * 3 + 2] = Math.fround(p.z);
      layer.lo[i * 3] = p.x - (layer.hi[i * 3] as number);
      layer.lo[i * 3 + 1] = p.y - (layer.hi[i * 3 + 1] as number);
      layer.lo[i * 3 + 2] = p.z - (layer.hi[i * 3 + 2] as number);
      layer.params[i * 4] = STRUCT_LEVEL_SCALE[level] ?? 1;
      layer.params[i * 4 + 1] = yawOf(id);
      layer.params[i * 4 + 2] = this.born[id] as number;
      layer.params[i * 4 + 3] = 0;
      layer.rgb[i * 3] = (palette[owner * 4] as number) / 255;
      layer.rgb[i * 3 + 1] = (palette[owner * 4 + 1] as number) / 255;
      layer.rgb[i * 3 + 2] = (palette[owner * 4 + 2] as number) / 255;
      layer.build[i * 2] = t.buildTick[id] as number;
      layer.build[i * 2 + 1] = t.readyTick[id] as number;
      this.drawn.push({ id, type, owner, cell, level, lat: p.lat, lon: p.lon, radius: p.radius, heightM: p.heightM });
    }
    this.primed = true;
    for (const l of this.layers.values()) {
      l.geometry.instanceCount = l.count;
      l.mesh.visible = l.count > 0;
      for (const a of l.attrs) a.needsUpdate = true;
    }
    if (this.ghost !== null && this.ghost.cell >= 0) this.writeGhost();
  }

  /** The placement preview: a see-through model of `type` on `cell`, green when `ok`, red when not. */
  setGhost(type: number, cell: number, ok: boolean): void {
    const g = this.ghost;
    if (g === null || !this.layers.has(type)) return;
    if (g.type === type && g.cell === cell && g.ok === ok && g.mesh.visible) return;
    g.type = type;
    g.cell = cell;
    g.ok = ok;
    this.writeGhost();
  }

  private writeGhost(): void {
    const g = this.ghost;
    if (g === null) return;
    const p = this.place(g.cell);
    const [hiA, loA, parA, ownA, bldA] = g.attrs as [InstancedBufferAttribute, InstancedBufferAttribute, InstancedBufferAttribute, InstancedBufferAttribute, InstancedBufferAttribute];
    const hi = hiA.array as Float32Array;
    const lo = loA.array as Float32Array;
    hi[0] = Math.fround(p.x);
    hi[1] = Math.fround(p.y);
    hi[2] = Math.fround(p.z);
    lo[0] = p.x - hi[0];
    lo[1] = p.y - hi[1];
    lo[2] = p.z - hi[2];
    (parA.array as Float32Array).set([1, 0, NEVER, 0]);
    (ownA.array as Float32Array).set(g.ok ? GHOST_OK_RGB : GHOST_BAD_RGB);
    (bldA.array as Float32Array).set([0, 1]);
    for (const a of g.attrs) a.needsUpdate = true;
    const rgb = g.ok ? GHOST_OK_RGB : GHOST_BAD_RGB;
    (g.material.uniforms.uGhost as { value: Vector4 }).value.set(rgb[0], rgb[1], rgb[2], GHOST_MIX);
    g.mesh.visible = true;
  }

  clearGhost(): void {
    if (this.ghost === null) return;
    this.ghost.cell = -1;
    this.ghost.mesh.visible = false;
  }

  /** The cell the ghost stands on, or -1. */
  get ghostCell(): number {
    return this.ghost?.cell ?? -1;
  }
  get ghostOk(): boolean {
    return this.ghost?.ok ?? true;
  }

  /** What the layer drew (float64 positions), the structures of types without a model left out. */
  instances(): readonly DrawnStructure[] {
    return this.drawn;
  }

  /** Instances per type number actually in the draw. */
  counts(): Record<number, number> {
    const out: Record<number, number> = {};
    for (const l of this.layers.values()) out[l.type] = l.count;
    return out;
  }

  /** The triangles of one instance of a type (0 when it has no model). */
  trianglesOf(type: number): number {
    return this.layers.get(type)?.model.triangles ?? 0;
  }

  dispose(): void {
    for (const l of this.layers.values()) {
      l.geometry.dispose();
      l.material.dispose();
    }
    if (this.ghost !== null) {
      this.ghost.geometry.dispose();
      this.ghost.material.dispose();
    }
  }
}
