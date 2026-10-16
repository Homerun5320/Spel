// The district layer (Districts-2b): ONE instanced mesh, ONE draw call, for every district of every City. An instance is a district on a slot of a City;
// the four models share one geometry (districtModels.ts) and the vertex shader (shaders/districts.ts) keeps only the instance's kind. It reads the
// snapshot's structure and district tables (`StructureView`, `DistrictView`) and nothing else. Slot heights come from `groundHeightAt` when the table
// changes (never per frame); `frame` sets uniforms and decides, with a distance test over the instances, whether the mesh is drawn at all.
import { BufferAttribute, DoubleSide, DynamicDrawUsage, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, ShaderMaterial, Vector3, Vector4 } from 'three';
import { DISTRICT_BUILD_TICKS, DISTRICT_MAX_SLOTS, STRUCT_CITY, districtIndex, type DistrictView, type StructureView } from '../sim/public';
import { AMBIENT_DAY, AMBIENT_NIGHT, DISTRICT_FADE_PX_HI, DISTRICT_FADE_PX_LO, DISTRICT_LEVEL_SCALE, DISTRICT_MODEL_UNIT, DISTRICT_TRIANGLE_BUDGET, EARTH_RADIUS_KM, HEIGHT_EXAGGERATION, STRUCT_BUILD_MIN_HEIGHT, STRUCT_CLOSE_FAR_M, STRUCT_CLOSE_MUL, STRUCT_CLOSE_RISE_LO_M, STRUCT_CLOSE_RISE_HI_M, STRUCT_POP_SECONDS, SUN_COLOR } from './config';
import { levelScale } from './cityTiers';
import { latLonToVec } from './geo';
import { buildDistrictModels, districtRadiusM, districtSlotModelOffset, districtSlotOffsetM } from './districtModels';
import type { QualityTier } from './quality';
import { districtVertexShader } from './shaders/districts';
import { structureFragmentShader } from './shaders/structures';
import { STRUCTURE_MODELS } from './structureModels';
import { yawOf } from './structures';
import { cellToLatLon, groundHeightAt } from './transforms';

/** A district as the layer drew it (float64, for tests and the props hook). */
export interface DrawnDistrict {
  structure: number;
  slot: number;
  kind: number;
  level: number;
  owner: number;
  /** The City's level (decides the slot count and the ring's size). */
  cityLevel: number;
  lat: number;
  lon: number;
  /** Height of the district's floor in render metres above the sea-level sphere, as the instance buffers carry it (the City's height plus the slot's offset). */
  heightM: number;
  ready: number;
}

export interface DistrictLayerOptions {
  readonly tier: QualityTier;
  readonly gridWidth: number;
  readonly gridHeight: number;
  readonly sun: Vector3;
}

const NEVER = -1e9;
const CITY_RADIUS_M = STRUCTURE_MODELS[STRUCT_CITY]?.radiusM ?? 700;
const EARTH_M = EARTH_RADIUS_KM * 1000;

export class DistrictLayer {
  readonly meshes: Mesh[] = [];
  private readonly gridWidth: number;
  private readonly gridHeight: number;
  private readonly geometry: InstancedBufferGeometry;
  private readonly material: ShaderMaterial;
  private readonly mesh: Mesh;
  private readonly cap: number;
  private readonly triPerInstance: number;
  private readonly hi: Float32Array;
  private readonly lo: Float32Array;
  private readonly params: Float32Array;
  private readonly slot: Float32Array;
  private readonly build: Float32Array;
  private readonly rgb: Float32Array;
  private readonly cut: Float32Array;
  private readonly attrs: InstancedBufferAttribute[];
  private readonly camHi = new Vector3();
  private readonly camLo = new Vector3();
  private readonly seenKey: Int32Array;
  private readonly born: Float32Array;
  private primed = false;
  private count = 0;
  private fxTime = 0;
  private exaggeration = HEIGHT_EXAGGERATION;
  private palette: Uint8Array | null = null;
  private structures: StructureView | null = null;
  private districts: DistrictView | null = null;
  private version = -1;
  private dirty = true;
  private drawn: DrawnDistrict[] = [];
  private readonly kindCounts = [0, 0, 0, 0, 0];
  /** Districts left out because the layer's triangle budget was full (the highest City ids and slots go first). */
  dropped = 0;
  /** Triangles of the instances in the draw (the merged geometry of the four kinds counts for each). */
  trianglesDrawn = 0;
  /** Whether the mesh was drawn on the last frame (false when empty or when the camera is beyond every instance's cut distance). */
  drawnNow = false;

  constructor(o: DistrictLayerOptions) {
    this.gridWidth = o.gridWidth;
    this.gridHeight = o.gridHeight;
    const models = buildDistrictModels();
    this.triPerInstance = models.triangles;
    this.cap = Math.max(1, Math.floor(DISTRICT_TRIANGLE_BUDGET[o.tier] / models.triangles));
    this.seenKey = new Int32Array(4096 * DISTRICT_MAX_SLOTS).fill(-1);
    this.born = new Float32Array(4096 * DISTRICT_MAX_SLOTS).fill(NEVER);
    const g = new InstancedBufferGeometry();
    g.setAttribute('position', new BufferAttribute(models.positions, 3));
    g.setAttribute('aColor', new BufferAttribute(models.colors, 3));
    g.setAttribute('aTint', new BufferAttribute(models.tints, 1));
    g.setAttribute('aKind', new BufferAttribute(models.kinds, 1));
    const c = this.cap;
    this.hi = new Float32Array(c * 3);
    this.lo = new Float32Array(c * 3);
    this.params = new Float32Array(c * 4);
    this.slot = new Float32Array(c * 4);
    this.build = new Float32Array(c * 3);
    this.rgb = new Float32Array(c * 3);
    this.cut = new Float32Array(c);
    const inst = (name: string, arr: Float32Array, size: number): InstancedBufferAttribute => {
      const a = new InstancedBufferAttribute(arr, size);
      a.setUsage(DynamicDrawUsage);
      g.setAttribute(name, a);
      return a;
    };
    this.attrs = [inst('aHi', this.hi, 3), inst('aLo', this.lo, 3), inst('aParams', this.params, 4), inst('aSlot', this.slot, 4), inst('aBuild', this.build, 3), inst('aOwner', this.rgb, 3)];
    g.instanceCount = 0;
    this.geometry = g;
    const v3 = (rgb: readonly number[]): Vector3 => new Vector3(rgb[0], rgb[1], rgb[2]);
    this.material = new ShaderMaterial({
      uniforms: {
        uCamHi: { value: this.camHi },
        uCamLo: { value: this.camLo },
        uSizeM: { value: CITY_RADIUS_M },
        uModelUnit: { value: DISTRICT_MODEL_UNIT },
        uKmPerUnit: { value: EARTH_RADIUS_KM },
        uTime: { value: 0 },
        uTick: { value: 0 },
        uPopSeconds: { value: STRUCT_POP_SECONDS },
        uBuildMin: { value: STRUCT_BUILD_MIN_HEIGHT },
        uViewH: { value: 540 },
        uFadeLo: { value: DISTRICT_FADE_PX_LO },
        uFadeHi: { value: DISTRICT_FADE_PX_HI },
        uClose: { value: new Vector4(STRUCT_CLOSE_MUL, STRUCT_CLOSE_RISE_LO_M, STRUCT_CLOSE_RISE_HI_M, STRUCT_CLOSE_FAR_M) },
        uSun: { value: o.sun },
        uSunColor: { value: v3(SUN_COLOR) },
        uAmbientDay: { value: v3(AMBIENT_DAY) },
        uAmbientNight: { value: v3(AMBIENT_NIGHT) },
        uGhost: { value: new Vector4(0, 0, 0, 0) },
        uAlpha: { value: 1 },
      },
      vertexShader: districtVertexShader,
      fragmentShader: structureFragmentShader,
      side: DoubleSide,
    });
    this.mesh = new Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.meshes.push(this.mesh);
  }

  setOwnerPalette(rgba: Uint8Array): void {
    this.palette = rgba;
    this.dirty = true;
  }

  setExaggeration(x: number): void {
    this.exaggeration = x;
    this.dirty = true;
  }

  /** Hands the layer the snapshot's tables; instances are rebuilt when `version` moved (or the palette / exaggeration changed). */
  setTable(structures: StructureView, districts: DistrictView, version: number): void {
    this.structures = structures;
    this.districts = districts;
    if (version !== this.version) {
      this.version = version;
      this.dirty = true;
    }
  }

  /** Per frame: the camera (float64, Earth radii), the fx time, the sim tick as a fraction, the viewport height and tan(fov / 2). */
  frame(camera: ArrayLike<number>, fxTime: number, tickFraction: number, viewH: number, tanHalfFov: number): void {
    const x = camera[0] as number;
    const y = camera[1] as number;
    const z = camera[2] as number;
    const hx = Math.fround(x);
    const hy = Math.fround(y);
    const hz = Math.fround(z);
    this.camHi.set(hx, hy, hz);
    this.camLo.set(x - hx, y - hy, z - hz);
    const u = this.material.uniforms;
    (u.uTime as { value: number }).value = fxTime;
    (u.uTick as { value: number }).value = tickFraction;
    (u.uViewH as { value: number }).value = viewH;
    this.fxTime = fxTime;
    if (this.dirty) this.rebuild();
    // the cut: nothing is drawn (no draw call) when every instance is beyond its fade-out distance
    let any = false;
    if (this.count > 0) {
      const hiA = this.hi;
      const loA = this.lo;
      const cutBase = viewH / 2 / tanHalfFov;
      for (let i = 0; i < this.count; i++) {
        const dx = (hiA[i * 3] as number) + (loA[i * 3] as number) - x;
        const dy = (hiA[i * 3 + 1] as number) + (loA[i * 3 + 1] as number) - y;
        const dz = (hiA[i * 3 + 2] as number) + (loA[i * 3 + 2] as number) - z;
        const dM = Math.sqrt(dx * dx + dy * dy + dz * dz) * EARTH_M;
        if (dM * DISTRICT_FADE_PX_LO < (this.cut[i] as number) * cutBase) {
          any = true;
          break;
        }
      }
    }
    this.drawnNow = any;
    this.mesh.visible = any;
  }

  private rebuild(): void {
    this.dirty = false;
    const st = this.structures;
    const ds = this.districts;
    if (st === null || ds === null || this.palette === null) return;
    const palette = this.palette;
    this.count = 0;
    this.drawn = [];
    this.dropped = 0;
    this.trianglesDrawn = 0;
    this.kindCounts.fill(0);
    for (let id = 0; id < st.highWater; id++) {
      const owner = st.owner[id] as number;
      if (owner === 0 || st.type[id] !== STRUCT_CITY) {
        for (let s = 0; s < DISTRICT_MAX_SLOTS; s++) this.seenKey[districtIndex(id, s)] = -1;
        continue;
      }
      const cityLevel = st.level[id] as number;
      const cell = st.cell[id] as number;
      const ll = cellToLatLon(cell, this.gridWidth, this.gridHeight);
      const cityGround = groundHeightAt(ll.lat, ll.lon);
      const cityRadius = 1 + (this.exaggeration * cityGround) / EARTH_M;
      const dir = latLonToVec(ll.lat, ll.lon);
      const yaw = yawOf(id);
      const cs = levelScale(cityLevel);
      const unitM = CITY_RADIUS_M * cs;
      for (let slot = 0; slot < DISTRICT_MAX_SLOTS; slot++) {
        const at = districtIndex(id, slot);
        const kind = ds.districtKind[at] as number;
        if (kind === 0) {
          this.seenKey[at] = -1;
          continue;
        }
        const key = cell * 8 + kind;
        if (this.seenKey[at] !== key) {
          this.seenKey[at] = key;
          this.born[at] = this.primed ? this.fxTime : NEVER;
        }
        if (this.count >= this.cap) {
          this.dropped++;
          continue;
        }
        const off = districtSlotOffsetM(cityLevel, slot, yaw, CITY_RADIUS_M) ?? { east: 0, north: 0 };
        const model = districtSlotModelOffset(slot);
        const cosLat = Math.max(0.05, Math.cos((ll.lat * Math.PI) / 180));
        const slat = ll.lat + ((off.north / EARTH_M) * 180) / Math.PI;
        const slon = ll.lon + ((off.east / (EARTH_M * cosLat)) * 180) / Math.PI;
        const slotGround = groundHeightAt(Math.max(-89.9, Math.min(89.9, slat)), slon);
        const yUnits = (this.exaggeration * (slotGround - cityGround)) / unitM;
        const level = ds.districtLevel[at] as number;
        const i = this.count++;
        this.hi[i * 3] = Math.fround((dir[0] as number) * cityRadius);
        this.hi[i * 3 + 1] = Math.fround((dir[1] as number) * cityRadius);
        this.hi[i * 3 + 2] = Math.fround((dir[2] as number) * cityRadius);
        this.lo[i * 3] = (dir[0] as number) * cityRadius - (this.hi[i * 3] as number);
        this.lo[i * 3 + 1] = (dir[1] as number) * cityRadius - (this.hi[i * 3 + 1] as number);
        this.lo[i * 3 + 2] = (dir[2] as number) * cityRadius - (this.hi[i * 3 + 2] as number);
        this.params[i * 4] = cs;
        this.params[i * 4 + 1] = yaw;
        this.params[i * 4 + 2] = this.born[at] as number;
        this.params[i * 4 + 3] = kind;
        this.slot[i * 4] = model.x;
        this.slot[i * 4 + 1] = yUnits;
        this.slot[i * 4 + 2] = model.z;
        this.slot[i * 4 + 3] = model.angle;
        const ready = ds.districtReadyTick[at] as number;
        this.build[i * 3] = ready - ((DISTRICT_BUILD_TICKS[kind] as number | undefined) ?? 0);
        this.build[i * 3 + 1] = ready;
        this.build[i * 3 + 2] = DISTRICT_LEVEL_SCALE[level] ?? 1;
        this.rgb[i * 3] = (palette[owner * 4] as number) / 255;
        this.rgb[i * 3 + 1] = (palette[owner * 4 + 1] as number) / 255;
        this.rgb[i * 3 + 2] = (palette[owner * 4 + 2] as number) / 255;
        this.cut[i] = districtRadiusM(cityLevel, level, CITY_RADIUS_M) * STRUCT_CLOSE_MUL; // metres; `frame` turns it into a cut distance (districtCutDistanceM)
        this.trianglesDrawn += this.triPerInstance;
        this.kindCounts[kind] = (this.kindCounts[kind] as number) + 1;
        this.drawn.push({
          structure: id,
          slot,
          kind,
          level,
          owner,
          cityLevel,
          lat: slat,
          lon: slon,
          heightM: this.exaggeration * cityGround + (this.slot[i * 4 + 1] as number) * unitM,
          ready,
        });
      }
    }
    this.primed = true;
    this.geometry.instanceCount = this.count;
    for (const a of this.attrs) a.needsUpdate = true;
  }

  /** What the layer drew. */
  instances(): readonly DrawnDistrict[] {
    return this.drawn;
  }

  /** Instances in the draw per district kind (index = kind). */
  counts(): readonly number[] {
    return this.kindCounts;
  }

  total(): number {
    return this.count;
  }

  /** Whether the mesh is part of the next draw (one draw call) or not (empty, or too far away). */
  get visible(): boolean {
    return this.mesh.visible;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
