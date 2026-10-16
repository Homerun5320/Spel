// The helicopter layer (M13a-1): ONE instanced draw call for every helicopter in the table. It reads a `HeliView` (the snapshot's copy of the sim table)
// and nothing else; it never touches the sim. A row is drawn when its owner is not 0 and it is not under production (`HELI_BUILDING`); the state only
// decides where it stands: a parked one (`HELI_PAD`) stands on the pad corner of its Factory's plate (the shader adds the offset in Factory units so it
// follows the structures' scale policy), every other state at the row's position (Q8 cells) and its altitude above the visible ground (rule 2 of
// docs/ARCHITECTURE.md "Rules for layers that sit on the terrain": `altGame - GAMEPLAY_HEIGHT_EXAG * meanElev(cell)` metres above `groundHeightAt`, drawn 1:1).
// The position is float64 on the CPU and goes to the GPU as a float32 pair (`aHi`, `aLo`). The buffers are rewritten only when the table version, the
// palette or the exaggeration changed; `frame` sets uniforms and allocates nothing. Positions hop from snapshot to snapshot (no interpolation, BACKLOG M13a-2).
import { BufferAttribute, DoubleSide, DynamicDrawUsage, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, ShaderMaterial, Vector3, Vector4 } from 'three';
import { HELI_BUILDING, HELI_DOWNED, HELI_PAD, type HeliView } from '../sim/public';
import { GAMEPLAY_HEIGHT_EXAG } from '../sim/rules';
import { AMBIENT_DAY, AMBIENT_NIGHT, EARTH_RADIUS_KM, HELI_INSTANCE_CAP, HELI_MODEL_SCALE, HELI_PAD_OFFSET, HELI_POLICY_SIZE_M, HELI_ROTOR_RAD_PER_SEC, HELI_TAIL_ROTOR_MUL, HEIGHT_EXAGGERATION, STRUCT_CLOSE_FAR_M, STRUCT_CLOSE_MUL, STRUCT_CLOSE_RISE_HI_M, STRUCT_CLOSE_RISE_LO_M, STRUCT_MAX_SCALE, STRUCT_SCREEN_FRAC, SUN_COLOR } from './config';
import { latLonToVec } from './geo';
import { heliModel, HELI_TAIL_HUB } from './heliModel';
import { heliVertexShader } from './shaders/helis';
import { structureFragmentShader } from './shaders/structures';
import { groundHeightAt, radiusAboveGround } from './transforms';

/** A helicopter as the layer drew it (float64, for tests and the `__test.helis()` hook). */
export interface DrawnHeli {
  id: number;
  owner: number;
  state: number;
  /** Position of the row in sim cells (Q8 / 256). */
  cellX: number;
  cellY: number;
  lat: number;
  lon: number;
  /** Metres above the visible ground (0 for a parked one). */
  aglM: number;
  /** Radius in Earth radii of the point the model stands on. */
  radius: number;
  /** The same as render metres above the sea-level sphere. */
  heightM: number;
  yaw: number;
  parked: boolean;
}

/** Latitude and longitude (degrees) of a Q8 sim position (x east, y south, cell centres at +128). */
export function heliLatLon(qx: number, qy: number, gridW: number, gridH: number): { lat: number; lon: number } {
  const lon = ((qx / 256) * 360) / gridW - 180;
  const lat = 90 - ((qy / 256) * 180) / gridH;
  return { lat, lon };
}

export interface HeliLayerOptions {
  readonly gridWidth: number;
  readonly gridHeight: number;
  readonly sun: Vector3;
  /** Mean elevation per sim cell in metres (`world.sim.meanElev`); without it the sim altitude is taken as the height above the ground. */
  readonly meanElev?: ArrayLike<number>;
}

const TWO_PI = Math.PI * 2;

export class HeliLayer {
  readonly meshes: Mesh[] = [];
  /** Instances in the draw. */
  count = 0;
  /** Test hooks (`?test=1`): the rotor angle forced from outside (null = the fx clock), and the whole layer switched off for a draw-call count. */
  spinOverride: number | null = null;
  private enabled = true;
  /** Triangles of one instance. */
  readonly modelTriangles: number;
  private readonly mesh: Mesh;
  private readonly geometry: InstancedBufferGeometry;
  private readonly material: ShaderMaterial;
  private readonly hi = new Float32Array(HELI_INSTANCE_CAP * 3);
  private readonly lo = new Float32Array(HELI_INSTANCE_CAP * 3);
  private readonly rgb = new Float32Array(HELI_INSTANCE_CAP * 3);
  private readonly info = new Float32Array(HELI_INSTANCE_CAP * 3);
  private readonly attrs: InstancedBufferAttribute[] = [];
  private readonly camHi = new Vector3();
  private readonly camLo = new Vector3();
  private readonly gridWidth: number;
  private readonly gridHeight: number;
  private readonly meanElev: ArrayLike<number> | undefined;
  private exaggeration = HEIGHT_EXAGGERATION;
  private palette: Uint8Array | null = null;
  private table: HeliView | null = null;
  private version = -1;
  private dirty = true;
  /** Per slot: the last drawn position and heading, so a moving one points the way it flies. */
  private readonly lastX = new Int32Array(HELI_INSTANCE_CAP).fill(-1);
  private readonly lastY = new Int32Array(HELI_INSTANCE_CAP).fill(-1);
  private readonly lastOwner = new Uint16Array(HELI_INSTANCE_CAP);
  private readonly yaws = new Float32Array(HELI_INSTANCE_CAP);
  private drawnList: DrawnHeli[] = [];

  constructor(o: HeliLayerOptions) {
    this.gridWidth = o.gridWidth;
    this.gridHeight = o.gridHeight;
    this.meanElev = o.meanElev;
    const model = heliModel();
    this.modelTriangles = model.triangles;
    const geometry = new InstancedBufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(model.positions, 3));
    geometry.setAttribute('aColor', new BufferAttribute(model.colors, 3));
    geometry.setAttribute('aTint', new BufferAttribute(model.tints, 1));
    const add = (name: string, array: Float32Array, size: number): void => {
      const a = new InstancedBufferAttribute(array, size);
      a.setUsage(DynamicDrawUsage);
      geometry.setAttribute(name, a);
      this.attrs.push(a);
    };
    add('aHi', this.hi, 3);
    add('aLo', this.lo, 3);
    add('aOwner', this.rgb, 3);
    add('aInfo', this.info, 3);
    geometry.instanceCount = 0;
    const v3 = (rgb: readonly number[]): Vector3 => new Vector3(rgb[0], rgb[1], rgb[2]);
    this.material = new ShaderMaterial({
      uniforms: {
        uCamHi: { value: this.camHi },
        uCamLo: { value: this.camLo },
        uSizeM: { value: HELI_POLICY_SIZE_M },
        uPxK: { value: STRUCT_SCREEN_FRAC },
        uMaxScale: { value: STRUCT_MAX_SCALE },
        uClose: { value: new Vector4(STRUCT_CLOSE_MUL, STRUCT_CLOSE_RISE_LO_M, STRUCT_CLOSE_RISE_HI_M, STRUCT_CLOSE_FAR_M) },
        uKmPerUnit: { value: EARTH_RADIUS_KM },
        uModelScale: { value: HELI_MODEL_SCALE },
        uPad: { value: v3(HELI_PAD_OFFSET) },
        uSpin: { value: 0 },
        uTailMul: { value: HELI_TAIL_ROTOR_MUL },
        uTailHub: { value: v3(HELI_TAIL_HUB) },
        uSun: { value: o.sun },
        uSunColor: { value: v3(SUN_COLOR) },
        uAmbientDay: { value: v3(AMBIENT_DAY) },
        uAmbientNight: { value: v3(AMBIENT_NIGHT) },
        uGhost: { value: new Vector4(0, 0, 0, 0) },
        uAlpha: { value: 1 },
      },
      vertexShader: heliVertexShader,
      fragmentShader: structureFragmentShader,
      side: DoubleSide,
    });
    this.geometry = geometry;
    this.mesh = new Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.meshes.push(this.mesh);
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

  /** Hands the layer the snapshot's helicopter table; the instances are rewritten when `version` moved. */
  setTable(table: HeliView, version: number): void {
    this.table = table;
    if (version !== this.version) {
      this.version = version;
      this.dirty = true;
    }
  }

  /** Per frame: the camera (float64, Earth radii) and the fx time. */
  frame(camera: ArrayLike<number>, fxTime: number): void {
    const x = camera[0] as number;
    const y = camera[1] as number;
    const z = camera[2] as number;
    const hx = Math.fround(x);
    const hy = Math.fround(y);
    const hz = Math.fround(z);
    this.camHi.set(hx, hy, hz);
    this.camLo.set(x - hx, y - hy, z - hz);
    (this.material.uniforms.uSpin as { value: number }).value = this.spinOverride ?? (fxTime * HELI_ROTOR_RAD_PER_SEC) % TWO_PI;
    if (this.dirty) this.rebuild();
  }

  /** Switches the layer off or on (a test counts the draw calls with and without it). */
  setEnabled(on: boolean): void {
    this.enabled = on;
    this.mesh.visible = on && this.count > 0;
  }

  /** What the last rebuild drew (do not mutate). */
  drawn(): readonly DrawnHeli[] {
    return this.drawnList;
  }

  private rebuild(): void {
    this.dirty = false;
    const t = this.table;
    const palette = this.palette;
    if (t === null || palette === null) return;
    const list: DrawnHeli[] = [];
    let n = 0;
    const hw = t.highWater;
    for (let id = 0; id < hw && n < HELI_INSTANCE_CAP; id++) {
      const owner = t.owner[id] as number;
      const state = t.state[id] as number;
      if (owner === 0 || state === HELI_BUILDING || state === 0) {
        this.lastX[id] = -1;
        continue;
      }
      const qx = t.x[id] as number;
      const qy = t.y[id] as number;
      const ll = heliLatLon(qx, qy, this.gridWidth, this.gridHeight);
      // the heading: the way it moved since the last table (a recycled slot starts fresh)
      const px0 = this.lastX[id] as number;
      const py0 = this.lastY[id] as number;
      if (px0 < 0 || this.lastOwner[id] !== owner) this.yaws[id] = ((Math.imul(id + 1, 0x9e3779b1) >>> 0) / 4294967296) * TWO_PI;
      else if (qx !== px0 || qy !== py0) this.yaws[id] = Math.atan2(-(qy - py0), (qx - px0) * Math.cos((ll.lat * Math.PI) / 180));
      this.lastX[id] = qx;
      this.lastY[id] = qy;
      this.lastOwner[id] = owner;
      const parked = state === HELI_PAD;
      let aglM = 0;
      if (!parked) {
        const cx = Math.min(this.gridWidth - 1, Math.max(0, Math.floor(qx / 256)));
        const cy = Math.min(this.gridHeight - 1, Math.max(0, Math.floor(qy / 256)));
        const mean = this.meanElev === undefined ? 0 : Math.max(0, this.meanElev[cy * this.gridWidth + cx] as number);
        aglM = Math.max(0, (t.alt[id] as number) - GAMEPLAY_HEIGHT_EXAG * mean);
      }
      const ground = groundHeightAt(ll.lat, ll.lon);
      const radius = radiusAboveGround(1 + (this.exaggeration * ground) / (EARTH_RADIUS_KM * 1000), aglM);
      const d = latLonToVec(ll.lat, ll.lon);
      const px = d[0] * radius;
      const py = d[1] * radius;
      const pz = d[2] * radius;
      const hx = Math.fround(px);
      const hy = Math.fround(py);
      const hz = Math.fround(pz);
      const i = n++;
      this.hi[i * 3] = hx;
      this.hi[i * 3 + 1] = hy;
      this.hi[i * 3 + 2] = hz;
      this.lo[i * 3] = px - hx;
      this.lo[i * 3 + 1] = py - hy;
      this.lo[i * 3 + 2] = pz - hz;
      this.rgb[i * 3] = (palette[owner * 4] as number) / 255;
      this.rgb[i * 3 + 1] = (palette[owner * 4 + 1] as number) / 255;
      this.rgb[i * 3 + 2] = (palette[owner * 4 + 2] as number) / 255;
      this.info[i * 3] = this.yaws[id] as number;
      this.info[i * 3 + 1] = parked ? 1 : 0;
      this.info[i * 3 + 2] = state === HELI_DOWNED ? 1 : 0;
      list.push({ id, owner, state, cellX: qx / 256, cellY: qy / 256, lat: ll.lat, lon: ll.lon, aglM, radius, heightM: (radius - 1) * EARTH_RADIUS_KM * 1000, yaw: this.yaws[id] as number, parked });
    }
    this.count = n;
    this.drawnList = list;
    this.geometry.instanceCount = n;
    this.mesh.visible = this.enabled && n > 0;
    for (const a of this.attrs) a.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
