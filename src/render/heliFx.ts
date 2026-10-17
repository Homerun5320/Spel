// The helicopter effects (M13a-2): a shadow blob under every airborne helicopter, rotor-wash dust, the troop ropes of a drop, landing dust, a flag on a fresh
// beachhead, smoke and a flash when one is shot down, and a far icon for a helicopter that is too small to see. FOUR draw calls at most: shadows (1), the
// particle pool (1: dust, ropes, troop dots, smoke, sparks), flags (1), icons (1); the first three are "the effects", the icon is counted apart.
//
// Everything is cosmetic and read-only: the layer reads the helicopter layer's per-slot data (`HeliLayer.slot*`, written when the table version moved), the
// snapshot's helicopter and beachhead tables, the camera and the fx clock (`fxNow()`, the one clock of effects). The randomness of the particles is a local
// seeded generator (`rng`) that never touches the sim's. Particles fly analytically from their birth time in the vertex shader, so nothing is written per frame for a
// particle in flight; a spawn rewrites the (small) pool buffers once. Pools are fixed typed arrays in two rings (dust 600, smoke 600): at most 1 200 particles
// in all, and nothing is allocated after the constructor. A test page has the layer OFF unless `fx=1` (the goldens).
import { BufferAttribute, DoubleSide, DynamicDrawUsage, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, ShaderMaterial, Vector3, Vector4 } from 'three';
import { HELI_BUILDING, HELI_DOWNED, HELI_HOVER, HELI_LIFT, HELI_PAD, HELI_UNLOAD, type BeachheadView, type HeliView } from '../sim/public';
import {
  EARTH_RADIUS_KM,
  HEIGHT_EXAGGERATION,
  HELI_DUST_AGL_M,
  HELI_DUST_RATE_LAND,
  HELI_DUST_RATE_LIFT,
  HELI_DUST_RATE_LOW,
  HELI_FLAG_HOIST_S,
  HELI_FLAG_POLE_M,
  HELI_FLASH_SPARKS,
  HELI_FX_DUST_POOL,
  HELI_FX_EMIT_MAX_M,
  HELI_FX_FLAG_CAP,
  HELI_FX_ICON_CAP,
  HELI_FX_PARTICLES_MAX,
  HELI_FX_SHADOW_CAP,
  HELI_FX_SMOKE_POOL,
  HELI_ICON_HALF_PX,
  HELI_ICON_MAX_M,
  HELI_MODEL_SCALE,
  HELI_POLICY_SIZE_M,
  HELI_ROPE_DOTS,
  HELI_ROPE_LIFE_S,
  HELI_ROPE_REFRESH_S,
  HELI_SHADOW_ALPHA,
  HELI_SHADOW_FADE_AGL_M,
  HELI_SHADOW_HALF_M,
  HELI_SMOKE_EMIT_S,
  HELI_SMOKE_LIFE_S,
  HELI_SMOKE_RATE,
  HELI_TROOP_DOT_S,
  ICON_FADE_PX_HI,
  ICON_FADE_PX_LO,
  STRUCT_CLOSE_FAR_M,
  STRUCT_CLOSE_MUL,
  STRUCT_CLOSE_RISE_HI_M,
  STRUCT_CLOSE_RISE_LO_M,
  STRUCT_MAX_SCALE,
  STRUCT_SCREEN_FRAC,
} from './config';
import { latLonToVec } from './geo';
import type { HeliLayer } from './heliLayer';
import { heliLatLon } from './heliLayer';
import { flagFragmentShader, flagVertexShader, iconFragmentShader, iconVertexShader, particleFragmentShader, particleVertexShader, shadowFragmentShader, shadowVertexShader } from './shaders/heliFx';
import { groundHeightAt } from './transforms';

const TAU = Math.PI * 2;
const R_M = EARTH_RADIUS_KM * 1000;
const RING_DUST = 0;
const RING_SMOKE = 1;
const SEED = 0x13a2;

/** What the effects have in the draw now (tests and the `__test.fx()` hook). */
export interface FxInfo {
  enabled: boolean;
  /** Particles alive at the fx time `now`. */
  particles: number;
  shadows: number;
  icons: number;
  flags: number;
  /** Meshes drawn this frame (the draw calls the effects cost, the icon included). */
  visibleMeshes: number;
}

interface QuadLayer {
  readonly mesh: Mesh;
  readonly geometry: InstancedBufferGeometry;
  readonly material: ShaderMaterial;
  readonly attrs: InstancedBufferAttribute[];
}

export interface HeliFxOptions {
  readonly gridWidth: number;
  readonly gridHeight: number;
}

export class HeliFx {
  readonly meshes: Mesh[] = [];
  /** The layers are drawn and fed only while this is on (a test page without `fx=1` leaves it off). */
  private on = false;

  private readonly camHi = new Vector3();
  private readonly camLo = new Vector3();
  private readonly shared: Record<string, { value: unknown }>;
  private readonly nowU = { value: 0 };
  private readonly viewHU = { value: 540 };

  // particles
  private readonly particles: QuadLayer;
  private readonly pHi = new Float32Array(HELI_FX_PARTICLES_MAX * 3);
  private readonly pLo = new Float32Array(HELI_FX_PARTICLES_MAX * 3);
  private readonly pVel = new Float32Array(HELI_FX_PARTICLES_MAX * 3);
  private readonly pTime = new Float32Array(HELI_FX_PARTICLES_MAX * 4);
  private readonly pCol = new Float32Array(HELI_FX_PARTICLES_MAX * 4);
  private readonly heads = new Int32Array(2);
  private pDirty = false;
  private maxDeath = 0;
  private rng = SEED;

  // shadows, icons, flags
  private readonly shadows: QuadLayer;
  private readonly sHi = new Float32Array(HELI_FX_SHADOW_CAP * 3);
  private readonly sLo = new Float32Array(HELI_FX_SHADOW_CAP * 3);
  private readonly sAgl = new Float32Array(HELI_FX_SHADOW_CAP);
  private readonly sDlt = new Float32Array(HELI_FX_SHADOW_CAP * 3);
  private readonly iDlt = new Float32Array(HELI_FX_ICON_CAP * 3);
  private readonly tickU = { value: 1 };
  /** 1 - the helicopter layer's alpha: how far the drawn helicopter still has to glide to the table's place. */
  private glide = 0;
  private shadowCount = 0;
  private readonly icons: QuadLayer;
  private readonly iHi = new Float32Array(HELI_FX_ICON_CAP * 3);
  private readonly iLo = new Float32Array(HELI_FX_ICON_CAP * 3);
  private readonly iRgb = new Float32Array(HELI_FX_ICON_CAP * 3);
  private iconCount = 0;
  private readonly flags: QuadLayer;
  private readonly fHi = new Float32Array(HELI_FX_FLAG_CAP * 3);
  private readonly fLo = new Float32Array(HELI_FX_FLAG_CAP * 3);
  private readonly fOwner = new Float32Array(HELI_FX_FLAG_CAP * 4);
  private flagCount = 0;
  private readonly flagTick = new Int32Array(HELI_FX_FLAG_CAP).fill(-1);
  private readonly flagStart = new Float32Array(HELI_FX_FLAG_CAP);
  private flagsSynced = false;
  private beachView: BeachheadView | null = null;
  private beachVersion = -1;
  private flagsDirty = true;

  // per slot of the helicopter table
  private readonly prevOwner = new Uint16Array(HELI_FX_SHADOW_CAP);
  private readonly prevState = new Uint8Array(HELI_FX_SHADOW_CAP);
  private readonly dustAcc = new Float32Array(HELI_FX_SHADOW_CAP);
  private readonly dotAcc = new Float32Array(HELI_FX_SHADOW_CAP);
  private readonly ropeAcc = new Float32Array(HELI_FX_SHADOW_CAP);
  private readonly smokeAcc = new Float32Array(HELI_FX_SHADOW_CAP);
  private readonly smokeUntil = new Float64Array(HELI_FX_SHADOW_CAP);
  private readonly smokePos = new Float64Array(HELI_FX_SHADOW_CAP * 3);
  private seenRebuilds = -1;
  private synced = false;
  private lastNow = -1;

  private palette: Uint8Array | null = null;
  private exaggeration = HEIGHT_EXAGGERATION;
  private readonly gridWidth: number;
  private readonly gridHeight: number;

  constructor(o: HeliFxOptions) {
    this.gridWidth = o.gridWidth;
    this.gridHeight = o.gridHeight;
    this.shared = {
      uCamHi: { value: this.camHi },
      uCamLo: { value: this.camLo },
      uKmPerUnit: { value: EARTH_RADIUS_KM },
      uSizeM: { value: HELI_POLICY_SIZE_M },
      uPxK: { value: STRUCT_SCREEN_FRAC },
      uMaxScale: { value: STRUCT_MAX_SCALE },
      uClose: { value: new Vector4(STRUCT_CLOSE_MUL, STRUCT_CLOSE_RISE_LO_M, STRUCT_CLOSE_RISE_HI_M, STRUCT_CLOSE_FAR_M) },
      uNow: this.nowU,
      uViewH: this.viewHU,
      uTick: this.tickU,
    };
    this.particles = this.quadLayer(
      [
        ['aHi', this.pHi, 3],
        ['aLo', this.pLo, 3],
        ['aVel', this.pVel, 3],
        ['aTime', this.pTime, 4],
        ['aColor', this.pCol, 4],
      ],
      particleVertexShader,
      particleFragmentShader,
      {},
      true,
      6,
    );
    this.particles.geometry.instanceCount = HELI_FX_PARTICLES_MAX;
    this.shadows = this.quadLayer(
      [
        ['aHi', this.sHi, 3],
        ['aLo', this.sLo, 3],
        ['aAgl', this.sAgl, 1],
        ['aDelta', this.sDlt, 3],
      ],
      shadowVertexShader,
      shadowFragmentShader,
      { uShadow: { value: new Vector3(HELI_SHADOW_HALF_M, HELI_SHADOW_FADE_AGL_M, HELI_SHADOW_ALPHA) } },
      true,
      3,
    );
    this.icons = this.quadLayer(
      [
        ['aHi', this.iHi, 3],
        ['aLo', this.iLo, 3],
        ['aOwner', this.iRgb, 3],
        ['aDelta', this.iDlt, 3],
      ],
      iconVertexShader,
      iconFragmentShader,
      {
        uFadeHi: { value: ICON_FADE_PX_HI },
        uFadeLo: { value: ICON_FADE_PX_LO },
        uHalfPx: { value: HELI_ICON_HALF_PX },
        uModelM: { value: HELI_POLICY_SIZE_M * HELI_MODEL_SCALE },
        uMaxM: { value: HELI_ICON_MAX_M },
      },
      true,
      7,
    );
    this.flags = this.flagLayer();
  }

  private instanced(geometry: InstancedBufferGeometry, name: string, array: Float32Array, size: number): InstancedBufferAttribute {
    const a = new InstancedBufferAttribute(array, size);
    a.setUsage(DynamicDrawUsage);
    geometry.setAttribute(name, a);
    return a;
  }

  private quadLayer(attrs: Array<[string, Float32Array, number]>, vs: string, fs: string, extra: Record<string, { value: unknown }>, transparent: boolean, order: number): QuadLayer {
    const geometry = new InstancedBufferGeometry();
    geometry.setAttribute('corner', new BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2));
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(12), 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    const list = attrs.map(([name, array, size]) => this.instanced(geometry, name, array, size));
    geometry.instanceCount = 0;
    const material = new ShaderMaterial({ uniforms: { ...this.shared, ...extra }, vertexShader: vs, fragmentShader: fs, side: DoubleSide, transparent, depthWrite: !transparent });
    const mesh = new Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.renderOrder = order;
    this.meshes.push(mesh);
    return { mesh, geometry, material, attrs: list };
  }

  /** The flag: a pole and a cloth, two quads (4 vertices each), instanced once per beachhead row. */
  private flagLayer(): QuadLayer {
    const geometry = new InstancedBufferGeometry();
    // pole: x -0.02..0.02, y 0..1; cloth: x 0.02..0.66, y 0.55..0.95 (part 1)
    geometry.setAttribute('position', new BufferAttribute(new Float32Array([-0.02, 0, 0, 0.02, 0, 0, 0.02, 1, 0, -0.02, 1, 0, 0.02, 0.55, 0, 0.66, 0.55, 0, 0.66, 0.95, 0, 0.02, 0.95, 0]), 3));
    geometry.setAttribute('aPart', new BufferAttribute(new Float32Array([0, 0, 0, 0, 1, 1, 1, 1]), 1));
    geometry.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
    const list = [this.instanced(geometry, 'aHi', this.fHi, 3), this.instanced(geometry, 'aLo', this.fLo, 3), this.instanced(geometry, 'aOwner', this.fOwner, 4)];
    geometry.instanceCount = 0;
    const material = new ShaderMaterial({
      uniforms: { ...this.shared, uHoist: { value: HELI_FLAG_HOIST_S }, uPoleM: { value: HELI_FLAG_POLE_M } },
      vertexShader: flagVertexShader,
      fragmentShader: flagFragmentShader,
      side: DoubleSide,
    });
    const mesh = new Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.visible = false;
    this.meshes.push(mesh);
    return { mesh, geometry, material, attrs: list };
  }

  setOwnerPalette(rgba: Uint8Array): void {
    this.palette = rgba;
    this.flagsDirty = true;
    this.seenRebuilds = -1; // the icons carry the owner colour: write them again
  }

  setExaggeration(x: number): void {
    this.exaggeration = x;
    this.flagsDirty = true;
    this.seenRebuilds = -1;
  }

  /** Switches the effects on or off (off: nothing is fed, nothing is drawn). */
  setEnabled(on: boolean): void {
    this.on = on;
    if (!on) for (const m of this.meshes) m.visible = false;
  }

  get enabled(): boolean {
    return this.on;
  }

  /** The beachhead table (read-only), for the flags; rewritten when `version` moved. */
  setBeachheads(view: BeachheadView, version: number): void {
    this.beachView = view;
    if (version !== this.beachVersion) {
      this.beachVersion = version;
      this.flagsDirty = true;
    }
  }

  /** Per frame: the camera (float64, Earth radii), the fx time, the drawing-buffer height; `layer` is the helicopter layer this frame's `frame` already ran for. */
  frame(layer: HeliLayer, view: HeliView | null, camera: ArrayLike<number>, now: number, viewH: number): void {
    if (!this.on) return;
    const x = camera[0] as number;
    const y = camera[1] as number;
    const z = camera[2] as number;
    const hx = Math.fround(x);
    const hy = Math.fround(y);
    const hz = Math.fround(z);
    this.camHi.set(hx, hy, hz);
    this.camLo.set(x - hx, y - hy, z - hz);
    this.nowU.value = now;
    this.viewHU.value = viewH;
    this.tickU.value = layer.alpha;
    this.glide = 1 - layer.alpha;
    let dt = this.lastNow < 0 ? 0 : now - this.lastNow;
    this.lastNow = now;
    if (!(dt > 0) || dt > 0.5) dt = dt > 0.5 ? 0.5 : 0;
    if (view !== null) {
      if (layer.rebuilds !== this.seenRebuilds) {
        this.seenRebuilds = layer.rebuilds;
        this.sync(layer, view, now);
      }
      if (dt > 0) this.emitAll(layer, view, now, dt, x, y, z);
    }
    if (this.flagsDirty) this.rebuildFlags(now);
    if (this.pDirty) {
      this.pDirty = false;
      for (const a of this.particles.attrs) a.needsUpdate = true;
    }
    this.particles.mesh.visible = now < this.maxDeath;
    this.shadows.mesh.visible = this.shadowCount > 0;
    this.icons.mesh.visible = this.iconCount > 0;
    this.flags.mesh.visible = this.flagCount > 0;
  }

  /** Counts for tests; `now` is the fx time. */
  info(now: number): FxInfo {
    let alive = 0;
    for (let i = 0; i < HELI_FX_PARTICLES_MAX; i++) {
      const age = now - (this.pTime[i * 4] as number);
      if (age >= -0.1 && age < (this.pTime[i * 4 + 1] as number)) alive++;
    }
    let visible = 0;
    for (const m of this.meshes) if (m.visible) visible++;
    return { enabled: this.on, particles: alive, shadows: this.shadowCount, icons: this.iconCount, flags: this.flagCount, visibleMeshes: visible };
  }

  // ---- the table moved: transitions, shadows, icons ----------------------------------------------------------------------------------------

  private sync(layer: HeliLayer, view: HeliView, now: number): void {
    let ns = 0;
    let ni = 0;
    const pal = this.palette;
    for (let id = 0; id < HELI_FX_SHADOW_CAP; id++) {
      const owner = id < view.highWater ? (view.owner[id] as number) : 0;
      const state = owner === 0 ? 0 : (view.state[id] as number);
      if (this.synced) {
        if (owner !== this.prevOwner[id]) {
          this.dustAcc[id] = this.dotAcc[id] = this.ropeAcc[id] = this.smokeAcc[id] = 0;
          this.smokeUntil[id] = 0;
        } else if (owner !== 0 && layer.slotOn[id] === 1) {
          const prev = this.prevState[id] as number;
          if (state === HELI_DOWNED && prev !== HELI_DOWNED) this.crash(id, layer, now);
          else if (state === HELI_LIFT && prev === HELI_PAD) this.dustBurst(layer, id, now, 22);
          else if (state === HELI_UNLOAD && prev !== HELI_UNLOAD) this.dustBurst(layer, id, now, 34);
        }
      }
      this.prevOwner[id] = owner;
      this.prevState[id] = state;
      if (layer.slotOn[id] !== 1 || state === HELI_PAD || state === HELI_BUILDING || owner === 0) continue;
      if (state === HELI_DOWNED) this.setSmokePos(id, layer);
      // shadow at the ground point, icon at the helicopter
      const gx = layer.slotGround[id * 3] as number;
      const gy = layer.slotGround[id * 3 + 1] as number;
      const gz = layer.slotGround[id * 3 + 2] as number;
      const fx = Math.fround(gx);
      const fy = Math.fround(gy);
      const fz = Math.fround(gz);
      this.sHi[ns * 3] = fx;
      this.sHi[ns * 3 + 1] = fy;
      this.sHi[ns * 3 + 2] = fz;
      this.sLo[ns * 3] = gx - fx;
      this.sLo[ns * 3 + 1] = gy - fy;
      this.sLo[ns * 3 + 2] = gz - fz;
      this.sAgl[ns] = layer.slotAgl[id] as number;
      this.sDlt[ns * 3] = layer.slotGroundDelta[id * 3] as number;
      this.sDlt[ns * 3 + 1] = layer.slotGroundDelta[id * 3 + 1] as number;
      this.sDlt[ns * 3 + 2] = layer.slotGroundDelta[id * 3 + 2] as number;
      ns++;
      if (state !== HELI_DOWNED && pal !== null) {
        const px = layer.slotPos[id * 3] as number;
        const py = layer.slotPos[id * 3 + 1] as number;
        const pz = layer.slotPos[id * 3 + 2] as number;
        const ix = Math.fround(px);
        const iy = Math.fround(py);
        const iz = Math.fround(pz);
        this.iHi[ni * 3] = ix;
        this.iHi[ni * 3 + 1] = iy;
        this.iHi[ni * 3 + 2] = iz;
        this.iLo[ni * 3] = px - ix;
        this.iLo[ni * 3 + 1] = py - iy;
        this.iLo[ni * 3 + 2] = pz - iz;
        this.iDlt[ni * 3] = layer.slotDelta[id * 3] as number;
        this.iDlt[ni * 3 + 1] = layer.slotDelta[id * 3 + 1] as number;
        this.iDlt[ni * 3 + 2] = layer.slotDelta[id * 3 + 2] as number;
        this.iRgb[ni * 3] = (pal[owner * 4] as number) / 255;
        this.iRgb[ni * 3 + 1] = (pal[owner * 4 + 1] as number) / 255;
        this.iRgb[ni * 3 + 2] = (pal[owner * 4 + 2] as number) / 255;
        ni++;
      }
    }
    this.synced = true;
    this.shadowCount = ns;
    this.iconCount = ni;
    this.shadows.geometry.instanceCount = ns;
    this.icons.geometry.instanceCount = ni;
    for (const a of this.shadows.attrs) a.needsUpdate = true;
    for (const a of this.icons.attrs) a.needsUpdate = true;
  }

  private setSmokePos(id: number, layer: HeliLayer): void {
    this.smokePos[id * 3] = (layer.slotPos[id * 3] as number) + (layer.slotDelta[id * 3] as number) * this.glide;
    this.smokePos[id * 3 + 1] = (layer.slotPos[id * 3 + 1] as number) + (layer.slotDelta[id * 3 + 1] as number) * this.glide;
    this.smokePos[id * 3 + 2] = (layer.slotPos[id * 3 + 2] as number) + (layer.slotDelta[id * 3 + 2] as number) * this.glide;
  }

  // ---- the flags ----------------------------------------------------------------------------------------------------------------------------

  private rebuildFlags(now: number): void {
    this.flagsDirty = false;
    const b = this.beachView;
    const pal = this.palette;
    if (b === null || pal === null) return;
    let n = 0;
    for (let slot = 0; slot < b.capacity && n < HELI_FX_FLAG_CAP; slot++) {
      const owner = b.owner[slot] as number;
      if (owner === 0) {
        this.flagTick[slot] = -1;
        continue;
      }
      const land = b.landTick[slot] as number;
      if (this.flagTick[slot] !== land) {
        this.flagTick[slot] = land;
        this.flagStart[slot] = this.flagsSynced ? now : -100;
      }
      const seed = b.seed[slot] as number;
      const cx = seed % this.gridWidth;
      const cy = (seed - cx) / this.gridWidth;
      const ll = heliLatLon(cx * 256 + 128, cy * 256 + 128, this.gridWidth, this.gridHeight);
      const r = 1 + (this.exaggeration * groundHeightAt(ll.lat, ll.lon)) / R_M;
      const d = latLonToVec(ll.lat, ll.lon);
      const px = d[0] * r;
      const py = d[1] * r;
      const pz = d[2] * r;
      const hx = Math.fround(px);
      const hy = Math.fround(py);
      const hz = Math.fround(pz);
      this.fHi[n * 3] = hx;
      this.fHi[n * 3 + 1] = hy;
      this.fHi[n * 3 + 2] = hz;
      this.fLo[n * 3] = px - hx;
      this.fLo[n * 3 + 1] = py - hy;
      this.fLo[n * 3 + 2] = pz - hz;
      this.fOwner[n * 4] = (pal[owner * 4] as number) / 255;
      this.fOwner[n * 4 + 1] = (pal[owner * 4 + 1] as number) / 255;
      this.fOwner[n * 4 + 2] = (pal[owner * 4 + 2] as number) / 255;
      this.fOwner[n * 4 + 3] = this.flagStart[slot] as number;
      n++;
    }
    this.flagsSynced = true;
    this.flagCount = n;
    this.flags.geometry.instanceCount = n;
    for (const a of this.flags.attrs) a.needsUpdate = true;
  }

  // ---- emission -----------------------------------------------------------------------------------------------------------------------------

  private rnd(): number {
    // mulberry32: a local seeded generator, the only randomness of the particles
    this.rng = (this.rng + 0x6d2b79f5) | 0;
    let t = Math.imul(this.rng ^ (this.rng >>> 15), 1 | this.rng);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  private emit(ring: number, px: number, py: number, pz: number, vx: number, vy: number, vz: number, birth: number, life: number, s0: number, s1: number, r: number, g: number, b: number, a: number): void {
    const base = ring === RING_DUST ? 0 : HELI_FX_DUST_POOL;
    const size = ring === RING_DUST ? HELI_FX_DUST_POOL : HELI_FX_SMOKE_POOL;
    const head = this.heads[ring] as number;
    this.heads[ring] = (head + 1) % size;
    const i = base + head;
    const hx = Math.fround(px);
    const hy = Math.fround(py);
    const hz = Math.fround(pz);
    this.pHi[i * 3] = hx;
    this.pHi[i * 3 + 1] = hy;
    this.pHi[i * 3 + 2] = hz;
    this.pLo[i * 3] = px - hx;
    this.pLo[i * 3 + 1] = py - hy;
    this.pLo[i * 3 + 2] = pz - hz;
    this.pVel[i * 3] = vx;
    this.pVel[i * 3 + 1] = vy;
    this.pVel[i * 3 + 2] = vz;
    this.pTime[i * 4] = birth;
    this.pTime[i * 4 + 1] = life;
    this.pTime[i * 4 + 2] = s0;
    this.pTime[i * 4 + 3] = s1;
    this.pCol[i * 4] = r;
    this.pCol[i * 4 + 1] = g;
    this.pCol[i * 4 + 2] = b;
    this.pCol[i * 4 + 3] = a;
    this.pDirty = true;
    if (birth + life > this.maxDeath) this.maxDeath = birth + life;
  }

  /** One puff of rotor-wash dust on the ground under helicopter `id`. */
  private dust(layer: HeliLayer, id: number, birth: number, strength: number): void {
    const a = this.rnd() * TAU;
    const sp = (5 + this.rnd() * 10) * strength;
    this.emit(RING_DUST, (layer.slotGround[id * 3] as number) + (layer.slotGroundDelta[id * 3] as number) * this.glide, (layer.slotGround[id * 3 + 1] as number) + (layer.slotGroundDelta[id * 3 + 1] as number) * this.glide, (layer.slotGround[id * 3 + 2] as number) + (layer.slotGroundDelta[id * 3 + 2] as number) * this.glide, Math.cos(a) * sp, 1 + this.rnd() * 3, Math.sin(a) * sp, birth, 1.1 + this.rnd() * 0.9, 16 + this.rnd() * 8, 62 + this.rnd() * 30, 0.66, 0.57, 0.42, 0.62);
  }

  private dustBurst(layer: HeliLayer, id: number, now: number, n: number): void {
    for (let k = 0; k < n; k++) this.dust(layer, id, now, 1.3);
  }

  /** A hit: a flash of sparks now, smoke for a few seconds (`smokeUntil`), a stored position that follows the falling helicopter. */
  private crash(id: number, layer: HeliLayer, now: number): void {
    this.setSmokePos(id, layer);
    this.smokeUntil[id] = now + HELI_SMOKE_EMIT_S;
    const px = this.smokePos[id * 3] as number;
    const py = this.smokePos[id * 3 + 1] as number;
    const pz = this.smokePos[id * 3 + 2] as number;
    this.emit(RING_SMOKE, px, py, pz, 0, 0, 0, now, 0.35, 70, 210, 1, 0.92, 0.6, 0.95);
    for (let k = 0; k < HELI_FLASH_SPARKS; k++) {
      const a = this.rnd() * TAU;
      const e = (this.rnd() - 0.35) * 1.4;
      const sp = 40 + this.rnd() * 55;
      const c = Math.cos(e);
      this.emit(RING_SMOKE, px, py, pz, Math.cos(a) * c * sp, Math.sin(e) * sp + 14, Math.sin(a) * c * sp, now, 0.5 + this.rnd() * 0.5, 26 + this.rnd() * 10, 70, 1, 0.55 + this.rnd() * 0.3, 0.12, 0.95);
    }
  }

  private emitAll(layer: HeliLayer, view: HeliView, now: number, dt: number, cx: number, cy: number, cz: number): void {
    const pal = this.palette;
    const maxD = HELI_FX_EMIT_MAX_M / R_M;
    for (let id = 0; id < HELI_FX_SHADOW_CAP; id++) {
      // smoke of a downed one goes on after the row is gone
      if (now < (this.smokeUntil[id] as number)) {
        this.smokeAcc[id] = (this.smokeAcc[id] as number) + HELI_SMOKE_RATE * dt;
        while ((this.smokeAcc[id] as number) >= 1) {
          this.smokeAcc[id] = (this.smokeAcc[id] as number) - 1;
          const a = this.rnd() * TAU;
          const sp = this.rnd() * 9;
          this.emit(
            RING_SMOKE,
            this.smokePos[id * 3] as number,
            this.smokePos[id * 3 + 1] as number,
            this.smokePos[id * 3 + 2] as number,
            Math.cos(a) * sp,
            24 + this.rnd() * 10,
            Math.sin(a) * sp,
            now - this.rnd() * dt,
            HELI_SMOKE_LIFE_S * (0.8 + this.rnd() * 0.4),
            38 + this.rnd() * 10,
            140 + this.rnd() * 50,
            0.17,
            0.17,
            0.19,
            0.78,
          );
        }
      }
      if (layer.slotOn[id] !== 1 || id >= view.highWater) continue;
      const owner = view.owner[id] as number;
      const state = view.state[id] as number;
      if (owner === 0 || state === HELI_PAD || state === HELI_BUILDING || state === HELI_DOWNED) continue;
      const px = (layer.slotPos[id * 3] as number) + (layer.slotDelta[id * 3] as number) * this.glide;
      const py = (layer.slotPos[id * 3 + 1] as number) + (layer.slotDelta[id * 3 + 1] as number) * this.glide;
      const pz = (layer.slotPos[id * 3 + 2] as number) + (layer.slotDelta[id * 3 + 2] as number) * this.glide;
      if (Math.abs(px - cx) + Math.abs(py - cy) + Math.abs(pz - cz) > maxD * 1.7) continue; // a cheap bound, no sqrt
      const agl = layer.slotAgl[id] as number;
      // rotor-wash dust
      let rate = 0;
      if (state === HELI_UNLOAD) rate = HELI_DUST_RATE_LAND;
      else if (agl < HELI_DUST_AGL_M) rate = (state === HELI_LIFT ? HELI_DUST_RATE_LIFT : state === HELI_HOVER ? HELI_DUST_RATE_LAND : HELI_DUST_RATE_LOW) * (1 - agl / HELI_DUST_AGL_M);
      if (rate > 0) {
        this.dustAcc[id] = (this.dustAcc[id] as number) + rate * dt;
        while ((this.dustAcc[id] as number) >= 1) {
          this.dustAcc[id] = (this.dustAcc[id] as number) - 1;
          this.dust(layer, id, now - this.rnd() * dt, 1);
        }
      }
      // the troop drop: a rope under the helicopter and dots sliding down it
      if ((state === HELI_HOVER || state === HELI_UNLOAD) && agl > 3 && pal !== null) {
        const ropeM = Math.min(agl, 220);
        const f = ropeM / agl;
        this.ropeAcc[id] = (this.ropeAcc[id] as number) + dt;
        if ((this.ropeAcc[id] as number) >= HELI_ROPE_REFRESH_S) {
          this.ropeAcc[id] = 0;
          const gx = (layer.slotGround[id * 3] as number) + (layer.slotGroundDelta[id * 3] as number) * this.glide;
          const gy = (layer.slotGround[id * 3 + 1] as number) + (layer.slotGroundDelta[id * 3 + 1] as number) * this.glide;
          const gz = (layer.slotGround[id * 3 + 2] as number) + (layer.slotGroundDelta[id * 3 + 2] as number) * this.glide;
          for (let j = 0; j < HELI_ROPE_DOTS; j++) {
            const q = (j / (HELI_ROPE_DOTS - 1)) * f;
            this.emit(RING_DUST, px + (gx - px) * q, py + (gy - py) * q, pz + (gz - pz) * q, 0, 0, 0, now, HELI_ROPE_LIFE_S, 6, 6, 0.93, 0.9, 0.8, 0.95);
          }
        }
        this.dotAcc[id] = (this.dotAcc[id] as number) + dt;
        while ((this.dotAcc[id] as number) >= HELI_TROOP_DOT_S) {
          this.dotAcc[id] = (this.dotAcc[id] as number) - HELI_TROOP_DOT_S;
          this.emit(RING_DUST, px, py, pz, 0, -ropeM / 0.8, 0, now - this.rnd() * dt, 0.8, 11, 11, (pal[owner * 4] as number) / 255, (pal[owner * 4 + 1] as number) / 255, (pal[owner * 4 + 2] as number) / 255, 1);
        }
      }
    }
  }

  dispose(): void {
    for (const l of [this.particles, this.shadows, this.icons, this.flags]) {
      l.geometry.dispose();
      l.material.dispose();
    }
  }
}
