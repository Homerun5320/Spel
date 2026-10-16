// The structure layer (M10): ONE instanced-mesh pipeline for every structure type. `STRUCTURE_MODELS` (structureModels.ts) says which types have a model;
// this file makes one `InstancedBufferGeometry` + mesh per modelled type (one draw call each, none while the type has no instance), plus a single
// ghost mesh for the placement preview. It reads the snapshot's structure table (a `StructureView`) and nothing else: the sim is out of reach.
//
// PLACEMENT. An instance stands on `groundHeightAt` (all octaves, the foundation rule of docs/ARCHITECTURE.md), times the height exaggeration, in
// the direction of its cell centre; its up axis is the globe normal. The position is kept in float64 here and handed to the GPU as a float32 pair
// (`aHi`, `aLo`), so it does not swim against the ground (rules for layers (1)). The scale policy, pop-in and the construction look are in the
// shader (shaders/structures.ts). Nothing here allocates per frame: `frame` sets uniforms; the buffers are rewritten only when the table, the
// palette or the exaggeration changed.
import { BufferAttribute, BufferGeometry, DoubleSide, DynamicDrawUsage, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, ShaderMaterial, Vector3, Vector4 } from 'three';
import { STRUCT_CITY, maxLevelOf, type StructureView } from '../sim/public';
import { EARTH_RADIUS_KM, GHOST_ALPHA, GHOST_BAD_RGB, GHOST_MIX, GHOST_OK_RGB, HEIGHT_EXAGGERATION, STRUCT_BUILD_MIN_HEIGHT, STRUCT_CLOSE_FAR_M, STRUCT_CLOSE_MUL, STRUCT_CLOSE_RISE_LO_M, STRUCT_CLOSE_RISE_HI_M, STRUCT_DISH_RAD_PER_SEC, STRUCT_MAX_SCALE, STRUCT_POP_SECONDS, STRUCT_SCREEN_FRAC, STRUCT_TRIANGLE_BUDGET, AMBIENT_DAY, AMBIENT_NIGHT, SUN_COLOR, ICON_FADE_PX_HI, ICON_FADE_PX_LO, ICON_HALF_PX, NIGHT_LIGHT_SUN_DOT, RANGE_RING_RGB, RING_HALF_WIDTH_FRAC, RING_HALF_WIDTH_M, RING_SEGMENTS, SELECT_RING_RGB } from './config';
import { selectRingLiftsM, selectRingRadiusM } from './rings';
import { latLonToVec } from './geo';
import type { QualityTier } from './quality';
import { DEFAULT_CITY_STYLE, levelScale, type CityStyle } from './cityTiers';
import { CITY_LIGHT_COUNT, STRUCTURE_MODELS, cityLights, modelledTypes, type ModelData } from './structureModels';
import { iconFragmentShader, iconVertexShader, ringFragmentShader, ringVertexShader, structureFragmentShader, structureVertexShader } from './shaders/structures';
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
  /** The instance's turn (radians, model +x -> east/north): the Port's pier points along it. */
  yaw: number;
  /** The sim tick at which it is finished (the City's lights come on from then). */
  ready: number;
}

interface TypeLayer {
  readonly type: number;
  model: ModelData;
  readonly cap: number;
  /** Triangles one instance costs (the model plus, for the City, its night lights). */
  tris: number;
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

interface RingState {
  readonly mesh: Mesh;
  readonly geometry: BufferGeometry;
  readonly material: ShaderMaterial;
  readonly hi: Float32Array;
  readonly lo: Float32Array;
  readonly dir: Float32Array;
  readonly sk: Float32Array;
  readonly lift: Float32Array;
  readonly attrs: BufferAttribute[];
}

interface IconState {
  readonly mesh: Mesh;
  readonly geometry: InstancedBufferGeometry;
  readonly material: ShaderMaterial;
  readonly cap: number;
  readonly hi: Float32Array;
  readonly lo: Float32Array;
  readonly info: Float32Array;
  readonly rgb: Float32Array;
  readonly attrs: InstancedBufferAttribute[];
  count: number;
}

const RING_VERTS = (RING_SEGMENTS + 1) * 2;

const FLOATS = { hi: 3, lo: 3, params: 4, owner: 3, build: 2 } as const;
const NEVER = -1e9;

/** The yaw (radians, model +x -> east/north) that points a pier from a coast cell to the open water, or NaN when no neighbour is sea. */
function seawardYaw(lat: number, lon: number, gridW: number, gridH: number, cell: number): number {
  const col = cell % gridW;
  const row = (cell - col) / gridW;
  let se = 0;
  let sn = 0;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      if (dx === 0 && dy === 0) continue;
      const r = row + dy;
      if (r < 0 || r >= gridH) continue;
      const ll = cellToLatLon(r * gridW + ((col + dx + gridW) % gridW), gridW, gridH);
      if (groundHeightAt(ll.lat, ll.lon) > 0) continue;
      let dl = ll.lon - lon;
      if (dl > 180) dl -= 360;
      if (dl < -180) dl += 360;
      const w = 1 / Math.hypot(dx, dy);
      se += dl * Math.cos((lat * Math.PI) / 180) * w;
      sn += (ll.lat - lat) * w;
    }
  }
  return se === 0 && sn === 0 ? NaN : Math.atan2(sn, se);
}

export function yawOf(id: number): number {
  return (Math.imul(id + 1, 0x9e3779b1) >>> 0) / 4294967296 * Math.PI * 2;
}

export interface StructureLayerOptions {
  readonly tier: QualityTier;
  /** The sim grid of the match (cells <-> latitude / longitude). */
  readonly gridWidth: number;
  readonly gridHeight: number;
  /** The shared sun direction vector of the globe (updated by `Globe.render` every frame). */
  readonly sun: Vector3;
  /** Look-1: the City's look at the start ('old' by default). */
  readonly cityStyle?: CityStyle;
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
  /** Structures left out because the layer's triangle budget (all types together) or a type's buffer was full: the highest ids go first, deterministically. */
  dropped = 0;
  /** Triangles of the structure instances drawn (models and City lights; not the icons, rings or the ghost). Never above the tier's STRUCT_TRIANGLE_BUDGET. */
  trianglesDrawn = 0;
  private readonly triangleBudget: number;
  private fxTime = 0;
  private viewH = 540;
  // M10-4: the ring mesh (selection ring + range ring) and the far icons (one draw call each)
  private readonly ring: RingState;
  private readonly icons: IconState;
  private selId = -1;
  private selRangeCells = 0;
  private selVisible = false;
  private readonly liftScratch = new Float32Array(RING_SEGMENTS + 1);
  private selX = 0;
  private selY = 0;
  private selZ = 0;
  private selSizeM = 700;
  private selLevel = 1;
  private selMaxLevel = 3;

  private cityStyle: CityStyle = DEFAULT_CITY_STYLE;

  constructor(o: StructureLayerOptions) {
    this.cityStyle = o.cityStyle ?? DEFAULT_CITY_STYLE;
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
      uMaxLevel: { value: maxLevelOf(STRUCT_CITY) }, // the bands belong to the City alone (every other model part is band 0)
      uClose: { value: new Vector4(STRUCT_CLOSE_MUL, STRUCT_CLOSE_RISE_LO_M, STRUCT_CLOSE_RISE_HI_M, STRUCT_CLOSE_FAR_M) },
      uKmPerUnit: { value: EARTH_RADIUS_KM },
      uTime: { value: 0 },
      uTick: { value: 0 },
      uPopSeconds: { value: STRUCT_POP_SECONDS },
      uBuildMin: { value: STRUCT_BUILD_MIN_HEIGHT },
      uSpin: { value: 0 },
      uSun: { value: o.sun },
      uSunColor: { value: v4(SUN_COLOR) },
      uAmbientDay: { value: v4(AMBIENT_DAY) },
      uAmbientNight: { value: v4(AMBIENT_NIGHT) },
    };
    const budget = STRUCT_TRIANGLE_BUDGET[o.tier];
    this.triangleBudget = budget;
    for (const type of modelledTypes()) {
      const spec = STRUCTURE_MODELS[type];
      if (spec === undefined) continue;
      const model = spec.build(type === STRUCT_CITY ? this.cityStyle : undefined);
      // the City's night lights ride in the same buffers (a tint code per light, lit in the vertex shader): no extra draw call
      const extra = type === STRUCT_CITY ? cityLights() : null;
      const tris = model.triangles + (extra === null ? 0 : extra.positions.length / 9);
      // the buffer of a type never needs more than the whole budget buys; the City's cap holds for both of its styles (a live switch keeps the buffers)
      let capTris = tris;
      if (type === STRUCT_CITY) for (const st of ['old', 'new'] as const) capTris = Math.max(capTris, spec.build(st).triangles + (extra === null ? 0 : extra.positions.length / 9));
      const cap = Math.max(1, Math.floor(budget / capTris));
      const geometry = new InstancedBufferGeometry();
      const cat = (a: Float32Array, b: Float32Array | undefined): Float32Array => (b === undefined ? a : Float32Array.from([...a, ...b]));
      geometry.setAttribute('position', new BufferAttribute(cat(model.positions, extra?.positions), 3));
      geometry.setAttribute('aColor', new BufferAttribute(cat(model.colors, extra?.colors), 3));
      geometry.setAttribute('aTint', new BufferAttribute(cat(model.tints, extra?.tints), 1));
      geometry.setAttribute('aBand', new BufferAttribute(cat(model.bands ?? new Float32Array(model.triangles * 3), extra === null ? undefined : new Float32Array(extra.positions.length / 3)), 1));
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
      this.layers.set(type, { type, model, cap, tris, geometry, material, mesh, hi, lo, params, rgb, build, attrs, count: 0 });
    }
    // The ring mesh: the selection ring first, the range ring after it (drawRange picks one or both).
    {
      const V = RING_VERTS * 2;
      const hi = new Float32Array(V * 3);
      const lo = new Float32Array(V * 3);
      const dir = new Float32Array(V * 3);
      const sk = new Float32Array(V * 2);
      const lift = new Float32Array(V); // Polish-1: per vertex ground offset (Earth radii) of the selection ring
      const index: number[] = [];
      for (let ringNo = 0; ringNo < 2; ringNo++) {
        for (let i = 0; i < RING_SEGMENTS; i++) {
          const a = ringNo * RING_VERTS + i * 2;
          index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
        for (let i = 0; i <= RING_SEGMENTS; i++) {
          for (let side = 0; side < 2; side++) {
            const v = ringNo * RING_VERTS + i * 2 + side;
            sk[v * 2] = side === 0 ? -1 : 1;
            sk[v * 2 + 1] = ringNo === 0 ? 1 : 0;
          }
        }
      }
      const geometry = new BufferGeometry();
      const attrs = [new BufferAttribute(hi, 3), new BufferAttribute(lo, 3), new BufferAttribute(dir, 3), new BufferAttribute(sk, 2), new BufferAttribute(lift, 1)];
      for (const a of attrs) a.setUsage(DynamicDrawUsage);
      geometry.setAttribute('aHi', attrs[0] as BufferAttribute);
      geometry.setAttribute('aLo', attrs[1] as BufferAttribute);
      geometry.setAttribute('aDir', attrs[2] as BufferAttribute);
      geometry.setAttribute('aSideKind', attrs[3] as BufferAttribute);
      geometry.setAttribute('aLift', attrs[4] as BufferAttribute);
      geometry.setAttribute('position', new BufferAttribute(hi, 3));
      geometry.setIndex(index);
      geometry.setDrawRange(0, 0);
      const material = new ShaderMaterial({
        uniforms: {
          uCamHi: this.uniforms.uCamHi as { value: unknown },
          uCamLo: this.uniforms.uCamLo as { value: unknown },
          uSelR: { value: 0 },
          uHalfMin: { value: RING_HALF_WIDTH_M / (EARTH_RADIUS_KM * 1000) },
          uHalfFrac: { value: RING_HALF_WIDTH_FRAC },
          uSelectRgb: { value: v4(SELECT_RING_RGB) },
          uRangeRgb: { value: v4(RANGE_RING_RGB) },
        },
        vertexShader: ringVertexShader,
        fragmentShader: ringFragmentShader,
        side: DoubleSide,
        transparent: true,
        depthWrite: false,
      });
      const mesh = new Mesh(geometry, material);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = 4;
      this.meshes.push(mesh);
      this.ring = { mesh, geometry, material, hi, lo, dir, sk, lift, attrs };
    }
    // The far icons: one quad per structure, every type in one draw call.
    {
      let cap = 0;
      for (const l of this.layers.values()) cap += l.cap;
      cap = Math.max(1, Math.min(4096, cap));
      const geometry = new InstancedBufferGeometry();
      geometry.setAttribute('corner', new BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2));
      geometry.setAttribute('position', new BufferAttribute(new Float32Array(12), 3));
      geometry.setIndex([0, 1, 2, 0, 2, 3]);
      const hi = new Float32Array(cap * 3);
      const lo = new Float32Array(cap * 3);
      const info = new Float32Array(cap * 4);
      const rgb = new Float32Array(cap * 3);
      const attrs = [this.instanced(geometry, 'aHi', hi, 3), this.instanced(geometry, 'aLo', lo, 3), this.instanced(geometry, 'aInfo', info, 4), this.instanced(geometry, 'aOwner', rgb, 3)];
      geometry.instanceCount = 0;
      const material = new ShaderMaterial({
        uniforms: {
          uCamHi: this.uniforms.uCamHi as { value: unknown },
          uCamLo: this.uniforms.uCamLo as { value: unknown },
          uKmPerUnit: this.uniforms.uKmPerUnit as { value: unknown },
          uPxK: this.uniforms.uPxK as { value: unknown },
          uMaxScale: this.uniforms.uMaxScale as { value: unknown },
          uClose: this.uniforms.uClose as { value: unknown },
          uViewH: { value: this.viewH },
          uFadeHi: { value: ICON_FADE_PX_HI },
          uFadeLo: { value: ICON_FADE_PX_LO },
          uHalfPx: { value: ICON_HALF_PX },
        },
        vertexShader: iconVertexShader,
        fragmentShader: iconFragmentShader,
        side: DoubleSide,
        transparent: true,
        depthWrite: false,
      });
      const mesh = new Mesh(geometry, material);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = 3;
      this.meshes.push(mesh);
      this.icons = { mesh, geometry, material, cap, hi, lo, info, rgb, attrs, count: 0 };
    }
    // The ghost: one instance of the City's model (any modelled type: the first one) drawn see-through in green or red.
    const first = this.layers.values().next().value as TypeLayer | undefined;
    if (first !== undefined) {
      const geometry = new InstancedBufferGeometry();
      geometry.setAttribute('position', first.geometry.getAttribute('position'));
      geometry.setAttribute('aColor', first.geometry.getAttribute('aColor'));
      geometry.setAttribute('aTint', first.geometry.getAttribute('aTint'));
      geometry.setAttribute('aBand', first.geometry.getAttribute('aBand'));
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
  frame(camera: ArrayLike<number>, fxTime: number, tickFraction: number, viewH = 540): void {
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
    (this.uniforms.uSpin as { value: number }).value = (fxTime * STRUCT_DISH_RAD_PER_SEC) % (Math.PI * 2); // the SAM dish angle: one scalar, the rest is vertex-shader work
    this.viewH = viewH;
    (this.icons.material.uniforms.uViewH as { value: number }).value = viewH;
    if (this.dirty) this.rebuild();
    if (this.selVisible) {
      const dx = x - this.selX;
      const dy = y - this.selY;
      const dz = z - this.selZ;
      const distM = Math.sqrt(dx * dx + dy * dy + dz * dz) * EARTH_RADIUS_KM * 1000;
      (this.ring.material.uniforms.uSelR as { value: number }).value = selectRingRadiusM(distM, this.selSizeM, this.selLevel, this.selMaxLevel) / (EARTH_RADIUS_KM * 1000);
    }
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
    this.icons.count = 0;
    this.drawn = [];
    this.dropped = 0;
    this.trianglesDrawn = 0;
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
      // ONE triangle budget for the whole layer (all types together); the cut is by id, so it is the same on every machine
      if (layer.count >= layer.cap || this.trianglesDrawn + layer.tris > this.triangleBudget) {
        this.dropped++;
        continue;
      }
      this.trianglesDrawn += layer.tris;
      const level = t.level[id] as number;
      const p = this.place(cell);
      const i = layer.count++;
      layer.hi[i * 3] = Math.fround(p.x);
      layer.hi[i * 3 + 1] = Math.fround(p.y);
      layer.hi[i * 3 + 2] = Math.fround(p.z);
      layer.lo[i * 3] = p.x - (layer.hi[i * 3] as number);
      layer.lo[i * 3 + 1] = p.y - (layer.hi[i * 3 + 1] as number);
      layer.lo[i * 3 + 2] = p.z - (layer.hi[i * 3 + 2] as number);
      const topLevel = maxLevelOf(type);
      layer.params[i * 4] = levelScale(level, topLevel);
      let yaw = NaN;
      if (STRUCTURE_MODELS[type]?.seaward === true) yaw = seawardYaw(p.lat, p.lon, this.gridWidth, this.gridHeight, cell);
      if (Number.isNaN(yaw)) yaw = yawOf(id);
      layer.params[i * 4 + 1] = yaw;
      layer.params[i * 4 + 2] = this.born[id] as number;
      layer.params[i * 4 + 3] = level;
      layer.rgb[i * 3] = (palette[owner * 4] as number) / 255;
      layer.rgb[i * 3 + 1] = (palette[owner * 4 + 1] as number) / 255;
      layer.rgb[i * 3 + 2] = (palette[owner * 4 + 2] as number) / 255;
      layer.build[i * 2] = t.buildTick[id] as number;
      layer.build[i * 2 + 1] = t.readyTick[id] as number;
      const ic = this.icons;
      if (ic.count < ic.cap) {
        const j = ic.count++;
        for (let a = 0; a < 3; a++) {
          ic.hi[j * 3 + a] = layer.hi[i * 3 + a] as number;
          ic.lo[j * 3 + a] = layer.lo[i * 3 + a] as number;
          ic.rgb[j * 3 + a] = layer.rgb[i * 3 + a] as number;
        }
        ic.info[j * 4] = type;
        ic.info[j * 4 + 1] = STRUCTURE_MODELS[type]?.radiusM ?? 700;
        ic.info[j * 4 + 2] = levelScale(level, topLevel);
        ic.info[j * 4 + 3] = type === STRUCT_CITY ? Math.min(1, Math.max(0, level / Math.max(1, topLevel))) : 1;
      }
      this.drawn.push({ id, type, owner, cell, level, lat: p.lat, lon: p.lon, radius: p.radius, heightM: p.heightM, yaw, ready: t.readyTick[id] as number });
    }
    this.primed = true;
    for (const l of this.layers.values()) {
      l.geometry.instanceCount = l.count;
      l.mesh.visible = l.count > 0;
      for (const a of l.attrs) a.needsUpdate = true;
    }
    this.icons.geometry.instanceCount = this.icons.count;
    this.icons.mesh.visible = this.icons.count > 0;
    for (const a of this.icons.attrs) a.needsUpdate = true;
    if (this.ghost !== null && this.ghost.cell >= 0) this.writeGhost();
    if (this.selId >= 0) this.refreshRings();
  }

  // ---- M10-4: selection ring, range ring, icons, lights ---------------------------------------------------------------------------------

  /** Selects structure `id` of the table (-1 = none). `rangeCells` > 0 also draws a range ring of that radius (sim cells; SAM and Defense Post). */
  setSelection(id: number, rangeCells = 0): void {
    if (id === this.selId && rangeCells === this.selRangeCells) return;
    this.selId = id;
    this.selRangeCells = rangeCells;
    this.refreshRings();
  }

  /** What the ring mesh shows (tests, the props hook). */
  ringInfo(): { selected: number; visible: boolean; rangeCells: number; drawIndices: number } {
    return { selected: this.selId, visible: this.selVisible, rangeCells: this.selRangeCells, drawIndices: this.ring.geometry.drawRange.count };
  }

  /** Instances in the icon buffer. */
  iconCount(): number {
    return this.icons.count;
  }

  /** How many city lights are lit right now: the levels of the finished Cities on the night side of the sun. Same rule as the vertex shader. */
  litLights(): number {
    const sun = this.uniforms.uSun?.value as Vector3 | undefined;
    if (sun === undefined) return 0;
    const sl = Math.hypot(sun.x, sun.y, sun.z) || 1;
    const tick = (this.uniforms.uTick as { value: number }).value;
    let n = 0;
    for (const d of this.drawn) {
      if (d.type !== STRUCT_CITY || tick < d.ready) continue;
      const u = latLonToVec(d.lat, d.lon);
      if (((u[0] as number) * sun.x + (u[1] as number) * sun.y + (u[2] as number) * sun.z) / sl < NIGHT_LIGHT_SUN_DOT) n += Math.min(d.level, CITY_LIGHT_COUNT);
    }
    return n;
  }

  private refreshRings(): void {
    const t = this.table;
    const r = this.ring;
    const id = this.selId;
    if (t === null || id < 0 || id >= t.highWater || t.owner[id] === 0 || !this.layers.has(t.type[id] as number)) {
      this.selVisible = false;
      r.mesh.visible = false;
      return;
    }
    const type = t.type[id] as number;
    const cell = t.cell[id] as number;
    this.selLevel = t.level[id] as number;
    this.selMaxLevel = maxLevelOf(type);
    this.selSizeM = STRUCTURE_MODELS[type]?.radiusM ?? 700;
    const c = this.place(cell);
    this.selX = c.x;
    this.selY = c.y;
    this.selZ = c.z;
    const cl = Math.hypot(c.x, c.y, c.z);
    const ux = c.x / cl;
    const uy = c.y / cl;
    const uz = c.z / cl;
    // east = cross((0,1,0), up), north = cross(up, east): the same frame as the vertex shader
    let ex = uz;
    let ez = -ux;
    const el = Math.hypot(ex, ez);
    if (el > 1e-4) {
      ex /= el;
      ez /= el;
    } else {
      ex = 1;
      ez = 0;
    }
    const nx = uy * ez;
    const ny = uz * ex - ux * ez;
    const nz = -uy * ex;
    const put = (v: number, x: number, y: number, z: number, dx: number, dy: number, dz: number): void => {
      r.hi[v * 3] = Math.fround(x);
      r.hi[v * 3 + 1] = Math.fround(y);
      r.hi[v * 3 + 2] = Math.fround(z);
      r.lo[v * 3] = x - (r.hi[v * 3] as number);
      r.lo[v * 3 + 1] = y - (r.hi[v * 3 + 1] as number);
      r.lo[v * 3 + 2] = z - (r.hi[v * 3 + 2] as number);
      r.dir[v * 3] = dx;
      r.dir[v * 3 + 1] = dy;
      r.dir[v * 3 + 2] = dz;
    };
    // Polish-1: the ground under the ring's vertices (sampled here, when the selection or the structure changes; never per frame). The ring stands at the
    // radius of the true-size model; at a distance the ring is wider but then the relief under it is below a pixel.
    const lifts = this.liftScratch;
    selectRingLiftsM(c.lat, c.lon, selectRingRadiusM(0, this.selSizeM, this.selLevel, this.selMaxLevel), RING_SEGMENTS, this.exaggeration, EARTH_RADIUS_KM * 1000, groundHeightAt, lifts);
    for (let i = 0; i <= RING_SEGMENTS; i++) {
      const lf = (lifts[i] as number) / (EARTH_RADIUS_KM * 1000);
      r.lift[i * 2] = lf;
      r.lift[i * 2 + 1] = lf;
    }
    for (let i = 0; i <= RING_SEGMENTS; i++) {
      const a = (i / RING_SEGMENTS) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      for (let side = 0; side < 2; side++) put(i * 2 + side, c.x, c.y, c.z, ex * ca + nx * sa, ny * sa, ez * ca + nz * sa);
    }
    if (this.selRangeCells > 0) {
      const cx = cell % this.gridWidth;
      const cy = (cell - cx) / this.gridWidth;
      for (let i = 0; i <= RING_SEGMENTS; i++) {
        const a = (i / RING_SEGMENTS) * Math.PI * 2;
        const gx = cx + Math.cos(a) * this.selRangeCells;
        const gy = cy + Math.sin(a) * this.selRangeCells;
        const lat = Math.max(-89.9, Math.min(89.9, ((this.gridHeight - 2 * gy - 1) * 90) / this.gridHeight));
        const lon = ((2 * gx + 1 - this.gridWidth) * 180) / this.gridWidth;
        const ground = Math.max(0, groundHeightAt(lat, lon));
        const rad = 1 + (this.exaggeration * ground) / (EARTH_RADIUS_KM * 1000);
        const d = latLonToVec(lat, lon);
        const px = (d[0] as number) * rad;
        const py = (d[1] as number) * rad;
        const pz = (d[2] as number) * rad;
        // outward tangent at that point: (p - centre) without its radial part
        let ox = px - c.x;
        let oy = py - c.y;
        let oz = pz - c.z;
        const dot = ox * (d[0] as number) + oy * (d[1] as number) + oz * (d[2] as number);
        ox -= (d[0] as number) * dot;
        oy -= (d[1] as number) * dot;
        oz -= (d[2] as number) * dot;
        const ol = Math.hypot(ox, oy, oz) || 1;
        for (let side = 0; side < 2; side++) put(RING_VERTS + i * 2 + side, px, py, pz, ox / ol, oy / ol, oz / ol);
      }
    }
    for (const a of r.attrs) a.needsUpdate = true;
    r.geometry.setDrawRange(0, this.selRangeCells > 0 ? RING_SEGMENTS * 12 : RING_SEGMENTS * 6);
    this.selVisible = true;
    r.mesh.visible = true;
  }

  /** The placement preview: a see-through model of `type` on `cell`, green when `ok`, red when not. */
  setGhost(type: number, cell: number, ok: boolean): void {
    const g = this.ghost;
    if (g === null || !this.layers.has(type)) return;
    if (g.type === type && g.cell === cell && g.ok === ok && g.mesh.visible) return;
    if (g.type !== type) {
      // the ghost wears the model of the type being placed (the attributes are shared, not copied; the draw count follows the position attribute)
      const src = this.layers.get(type);
      if (src !== undefined) {
        g.geometry.setAttribute('position', src.geometry.getAttribute('position'));
        g.geometry.setAttribute('aColor', src.geometry.getAttribute('aColor'));
        g.geometry.setAttribute('aTint', src.geometry.getAttribute('aTint'));
        (g.material.uniforms.uSizeM as { value: number }).value = STRUCTURE_MODELS[type]?.radiusM ?? 700;
      }
    }
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
    const yaw = STRUCTURE_MODELS[g.type]?.seaward === true ? seawardYaw(p.lat, p.lon, this.gridWidth, this.gridHeight, g.cell) : NaN;
    (parA.array as Float32Array).set([1, Number.isNaN(yaw) ? 0 : yaw, NEVER, 0]);
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

  /** The City's look now. */
  get cityStyleNow(): CityStyle {
    return this.cityStyle;
  }

  /**
   * Look-1: switches the City's model ('old' / 'new') live. Only the City's vertex buffers are replaced (the instance buffers, the ghost and the draw
   * call stay); nothing is rebuilt per frame. The next `frame` recounts the triangle budget with the new model.
   */
  setCityStyle(style: CityStyle): void {
    const layer = this.layers.get(STRUCT_CITY);
    if (style === this.cityStyle) return;
    this.cityStyle = style;
    const spec = STRUCTURE_MODELS[STRUCT_CITY];
    if (layer === undefined || spec === undefined) return;
    const model = spec.build(style);
    const extra = cityLights();
    const cat = (a: Float32Array, b: Float32Array): Float32Array => Float32Array.from([...a, ...b]);
    const pos = new BufferAttribute(cat(model.positions, extra.positions), 3);
    const col = new BufferAttribute(cat(model.colors, extra.colors), 3);
    const tint = new BufferAttribute(cat(model.tints, extra.tints), 1);
    const band = new BufferAttribute(cat(model.bands ?? new Float32Array(model.triangles * 3), new Float32Array(extra.positions.length / 3)), 1);
    for (const g of [layer.geometry, this.ghost?.geometry]) {
      if (g === undefined) continue;
      g.setAttribute('position', pos);
      g.setAttribute('aColor', col);
      g.setAttribute('aTint', tint);
      g.setAttribute('aBand', band);
    }
    layer.model = model;
    layer.tris = model.triangles + extra.positions.length / 9;
    this.dirty = true;
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
    this.ring.geometry.dispose();
    this.ring.material.dispose();
    this.icons.geometry.dispose();
    this.icons.material.dispose();
    if (this.ghost !== null) {
      this.ghost.geometry.dispose();
      this.ghost.material.dispose();
    }
  }
}
