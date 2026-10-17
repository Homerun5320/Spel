// The front arrows (M20a-2): ONE instanced draw call for the attacks running (at most ATTACK_VIEW_CAP arrows). The layer reads an `AttackView` (the snapshot's copy of the fronts)
// and nothing else. Each arrow lies in the tangent plane at the front cell with its tip on the front and points the way the attack pushes (from the attacker's land into the
// target's); the colour is the attacker's owner colour, the attacks the local player is part of are the brightest. The buffers are rewritten only when the table version, the
// palette, the local owner or the exaggeration changed; `frame` sets uniforms and allocates nothing. The arrow fades out with the camera altitude (gone at globe distance, then
// the draw call is skipped), and a front behind the horizon is moved out of the clip volume in the vertex shader.
import { BufferAttribute, DoubleSide, DynamicDrawUsage, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, ShaderMaterial, Vector3 } from 'three';
import { ATTACK_VIEW_CAP, type AttackView } from '../sim/public';
import { EARTH_RADIUS_KM, FRONT_ARROW_MIN_M, FRONT_ARROW_SCREEN_FRAC, FRONT_FADE_FULL_ALT_R, FRONT_FADE_GONE_ALT_R, FRONT_LIFT_M, FRONT_OTHER_EMPHASIS, FRONT_PULSE_DEPTH, FRONT_PULSE_RAD_PER_S, HEIGHT_EXAGGERATION } from './config';
import { latLonToVec } from './geo';
import { frontFragmentShader, frontVertexShader } from './shaders/fronts';
import { groundHeightAt, radiusAboveGround } from './transforms';

/** An arrow as the layer drew it (float64; for tests and `__test.fronts()`). */
export interface DrawnFront {
  id: number;
  attacker: number;
  target: number;
  cell: number;
  lat: number;
  lon: number;
  /** East and north components of the unit direction the arrow points in. */
  dirEast: number;
  dirNorth: number;
  own: boolean;
}

/** The share (0..1) of the arrow's alpha that a camera altitude (Earth radii above the sea-level sphere) leaves: 1 below FRONT_FADE_FULL_ALT_R, 0 from FRONT_FADE_GONE_ALT_R, smooth between. */
export function frontFade(altR: number): number {
  const t = Math.min(1, Math.max(0, (altR - FRONT_FADE_FULL_ALT_R) / (FRONT_FADE_GONE_ALT_R - FRONT_FADE_FULL_ALT_R)));
  return 1 - t * t * (3 - 2 * t);
}

export interface FrontLayerOptions {
  readonly gridWidth: number;
  readonly gridHeight: number;
}

/** The arrow: a dark outline and, over it, the fill (a shaft and a head in a unit model: x across, z along; the tip at z = 0, the tail at z = -1). Six triangles in one draw call. */
const ARROW = new Float32Array([
  // outline (a little larger, tip a little further)
  -0.16, 0, -1.06, 0.16, 0, -1.06, 0.16, 0, -0.34, -0.16, 0, -1.06, 0.16, 0, -0.34, -0.16, 0, -0.34,
  -0.46, 0, -0.34, 0.46, 0, -0.34, 0, 0, 0.12,
  // fill
  -0.1, 0, -1, 0.1, 0, -1, 0.1, 0, -0.38, -0.1, 0, -1, 0.1, 0, -0.38, -0.1, 0, -0.38,
  -0.34, 0, -0.38, 0.34, 0, -0.38, 0, 0, 0,
]);
const ARROW_PART = new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1]);

export class FrontLayer {
  readonly meshes: Mesh[] = [];
  /** Arrows in the draw. */
  count = 0;
  /** The fade of the last frame (0 = the draw call is skipped). */
  fade = 0;
  private enabled = true;
  private readonly mesh: Mesh;
  private readonly geometry: InstancedBufferGeometry;
  private readonly material: ShaderMaterial;
  private readonly hi = new Float32Array(ATTACK_VIEW_CAP * 3);
  private readonly lo = new Float32Array(ATTACK_VIEW_CAP * 3);
  private readonly dir = new Float32Array(ATTACK_VIEW_CAP * 2);
  private readonly style = new Float32Array(ATTACK_VIEW_CAP * 4);
  private readonly attrs: InstancedBufferAttribute[] = [];
  private readonly camHi = new Vector3();
  private readonly camLo = new Vector3();
  private readonly gridWidth: number;
  private readonly gridHeight: number;
  private exaggeration = HEIGHT_EXAGGERATION;
  private palette: Uint8Array | null = null;
  private table: AttackView | null = null;
  private version = -1;
  private localOwner = 1;
  private dirty = true;
  private readonly drawn: DrawnFront[] = [];
  private drawnCount = 0;

  constructor(o: FrontLayerOptions) {
    this.gridWidth = o.gridWidth;
    this.gridHeight = o.gridHeight;
    for (let i = 0; i < ATTACK_VIEW_CAP; i++) this.drawn.push({ id: 0, attacker: 0, target: 0, cell: 0, lat: 0, lon: 0, dirEast: 0, dirNorth: 0, own: false });
    const g = new InstancedBufferGeometry();
    g.setAttribute('position', new BufferAttribute(ARROW, 3));
    g.setAttribute('aPart', new BufferAttribute(ARROW_PART, 1));
    const add = (name: string, array: Float32Array, size: number): void => {
      const a = new InstancedBufferAttribute(array, size);
      a.setUsage(DynamicDrawUsage);
      g.setAttribute(name, a);
      this.attrs.push(a);
    };
    add('aHi', this.hi, 3);
    add('aLo', this.lo, 3);
    add('aDir', this.dir, 2);
    add('aStyle', this.style, 4);
    g.instanceCount = 0;
    this.geometry = g;
    this.material = new ShaderMaterial({
      uniforms: {
        uCamHi: { value: this.camHi },
        uCamLo: { value: this.camLo },
        uTime: { value: 0 },
        uFade: { value: 0 },
        uKmPerUnit: { value: EARTH_RADIUS_KM },
        uPxK: { value: FRONT_ARROW_SCREEN_FRAC },
        uMinM: { value: FRONT_ARROW_MIN_M },
        uPulseRate: { value: FRONT_PULSE_RAD_PER_S },
        uPulseDepth: { value: FRONT_PULSE_DEPTH },
      },
      vertexShader: frontVertexShader,
      fragmentShader: frontFragmentShader,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: DoubleSide,
    });
    this.mesh = new Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 45;
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

  /** The ownerId of the local player: the attacks it is part of (either side) are drawn brightest. */
  setLocalOwner(ownerId: number): void {
    if (ownerId !== this.localOwner) {
      this.localOwner = ownerId;
      this.dirty = true;
    }
  }

  /** Hands the layer the snapshot's fronts; the instances are rewritten when `version` moved (or the palette, the owner or the exaggeration did). */
  setTable(table: AttackView, version: number): void {
    this.table = table;
    if (version !== this.version) {
      this.version = version;
      this.dirty = true;
    }
    if (this.dirty) this.rebuild();
  }

  private rebuild(): void {
    this.dirty = false;
    const t = this.table;
    const palette = this.palette;
    if (t === null || palette === null) return;
    const w = this.gridWidth;
    const h = this.gridHeight;
    const n = t.count < ATTACK_VIEW_CAP ? t.count : ATTACK_VIEW_CAP;
    for (let i = 0; i < n; i++) {
      const cell = t.cell[i] as number;
      const x = cell % w;
      const y = (cell - x) / w;
      const lat = ((h - 2 * y - 1) * 90) / h;
      const lon = ((2 * x + 1 - w) * 180) / w;
      const ground = groundHeightAt(lat, lon);
      const radius = radiusAboveGround(1 + (this.exaggeration * ground) / (EARTH_RADIUS_KM * 1000), FRONT_LIFT_M);
      const d = latLonToVec(lat, lon);
      const px = d[0] * radius;
      const py = d[1] * radius;
      const pz = d[2] * radius;
      const hx = Math.fround(px);
      const hy = Math.fround(py);
      const hz = Math.fround(pz);
      this.hi[i * 3] = hx;
      this.hi[i * 3 + 1] = hy;
      this.hi[i * 3 + 2] = hz;
      this.lo[i * 3] = px - hx;
      this.lo[i * 3 + 1] = py - hy;
      this.lo[i * 3 + 2] = pz - hz;
      // the grid direction (east, south) in true distances: a cell is narrower in the east-west direction by cos(latitude)
      const east = ((t.dirX[i] as number) / 100) * Math.max(0.05, Math.cos((lat * Math.PI) / 180));
      const north = -(t.dirY[i] as number) / 100;
      const len = Math.hypot(east, north);
      const ue = len < 1e-6 ? 0 : east / len;
      const un = len < 1e-6 ? 1 : north / len;
      this.dir[i * 2] = ue;
      this.dir[i * 2 + 1] = un;
      const attacker = t.attacker[i] as number;
      const target = t.target[i] as number;
      const own = attacker === this.localOwner || target === this.localOwner;
      this.style[i * 4] = (palette[attacker * 4] as number) / 255;
      this.style[i * 4 + 1] = (palette[attacker * 4 + 1] as number) / 255;
      this.style[i * 4 + 2] = (palette[attacker * 4 + 2] as number) / 255;
      this.style[i * 4 + 3] = own ? 1 : FRONT_OTHER_EMPHASIS;
      const rec = this.drawn[i] as DrawnFront;
      rec.id = t.id[i] as number;
      rec.attacker = attacker;
      rec.target = target;
      rec.cell = cell;
      rec.lat = lat;
      rec.lon = lon;
      rec.dirEast = ue;
      rec.dirNorth = un;
      rec.own = own;
    }
    this.count = n;
    this.drawnCount = n;
    this.geometry.instanceCount = n;
    for (const a of this.attrs) a.needsUpdate = true;
    this.mesh.visible = this.enabled && n > 0 && this.fade > 0.003;
  }

  /** Per frame: the camera (float64, Earth radii) and the fx clock. Allocates nothing. */
  frame(camera: ArrayLike<number>, now: number): void {
    const x = camera[0] as number;
    const y = camera[1] as number;
    const z = camera[2] as number;
    const hx = Math.fround(x);
    const hy = Math.fround(y);
    const hz = Math.fround(z);
    this.camHi.set(hx, hy, hz);
    this.camLo.set(x - hx, y - hy, z - hz);
    this.fade = frontFade(Math.hypot(x, y, z) - 1);
    const u = this.material.uniforms;
    (u.uTime as { value: number }).value = now;
    (u.uFade as { value: number }).value = this.fade;
    this.mesh.visible = this.enabled && this.count > 0 && this.fade > 0.003;
  }

  /** Switches the layer off or on (a test counts the draw calls with and without it). */
  setEnabled(on: boolean): void {
    this.enabled = on;
    this.mesh.visible = on && this.count > 0 && this.fade > 0.003;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Whether the draw call is made now. */
  get visible(): boolean {
    return this.mesh.visible;
  }

  /** The arrows as the layer drew them (a view of reused records: valid until the next rebuild). */
  info(): readonly DrawnFront[] {
    return this.drawn.slice(0, this.drawnCount);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
