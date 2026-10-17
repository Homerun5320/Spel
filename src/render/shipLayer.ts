// The ship layer (M13c-2): ONE instanced draw call for every ship of the table, none when the table is empty. It reads a `ShipView` (the page's copy of the sim table) and nothing
// else. A ship stands on the SEA SURFACE (radius 1 plus `SHIP_LIFT_M`: the ground height under a sea cell is 0, so the ground is not asked), its heading comes from the route (the next
// waypoint; `shipHeading`), its colour is the owner's, and a ship that unloads (SHIP_LAND) sits lower in the water (`aInfo.y`). EVERY ship is drawn for every viewer in v1 (the table is
// not masked; fog for ships is BACKLOG). The row going away from the table takes the instance away. The buffers are rewritten only when the table version, the palette or the exaggeration
// changed; `frame` sets uniforms and allocates nothing. Positions hop from snapshot to snapshot (BACKLOG: interpolation).
import { BufferAttribute, DoubleSide, DynamicDrawUsage, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, ShaderMaterial, Vector3, Vector4 } from 'three';
import { SHIP_LAND, SHIP_OFF, SHIP_RETURN, SHIP_SAIL, type ShipView } from '../sim/public';
import { AMBIENT_DAY, AMBIENT_NIGHT, EARTH_RADIUS_KM, SHIP_INSTANCE_CAP, SHIP_LIFT_M, SHIP_MIN_FRAC, SHIP_SINK_UNITS, SHIP_UNIT_M, SUN_COLOR } from './config';
import { latLonToVec } from './geo';
import { heliLatLon } from './heliLayer';
import { shipModel } from './shipModel';
import { shipVertexShader } from './shaders/ships';
import { structureFragmentShader } from './shaders/structures';

/** A ship as the layer drew it (float64, for tests and the `__test.ships()` hook). */
export interface DrawnShip {
  id: number;
  owner: number;
  state: number;
  cellX: number;
  cellY: number;
  lat: number;
  lon: number;
  /** Radius in Earth radii of the point the model stands on (the sea surface plus the lift). */
  radius: number;
  yaw: number;
  /** 1 when the hull sits lower (unloading). */
  sunk: number;
}

const EMPTY_DRAWN: DrawnShip[] = [];

/** Radius (Earth radii) a ship stands at: the sea-level sphere plus the lift. */
export const SHIP_RADIUS = 1 + SHIP_LIFT_M / (EARTH_RADIUS_KM * 1000);

/**
 * The heading of ship `id` in radians (0 = east, counter-clockwise towards north), from its route alone: sailing out it points at the waypoint it sails to, returning at the one it
 * sails back to, unloading along the last leg, docked back along the first. A route of one point (or none) gives 0. `gridW` x `gridH` is the sim grid.
 */
export function shipHeading(ships: ShipView, id: number, gridW: number, gridH: number): number {
  const len = ships.routeLen[id] as number;
  if (len < 2) return 0;
  const idx = ships.routeIdx[id] as number;
  const state = ships.state[id] as number;
  const qx = ships.x[id] as number;
  const qy = ships.y[id] as number;
  let fromX = qx;
  let fromY = qy;
  let to: number;
  if (state === SHIP_SAIL && idx < len) to = ships.routeCell(id, idx);
  else if (state === SHIP_RETURN && idx > 0) to = ships.routeCell(id, idx - 1);
  else {
    // unloading, docked, or at the end of a leg: along the nearest route leg
    const a = state === SHIP_OFF ? 1 : len - 2;
    const b = state === SHIP_OFF ? 0 : len - 1;
    const ca = ships.routeCell(id, a);
    fromX = (ca % gridW) * 256 + 128;
    fromY = Math.floor(ca / gridW) * 256 + 128;
    to = ships.routeCell(id, b);
  }
  const tx = (to % gridW) * 256 + 128;
  const ty = Math.floor(to / gridW) * 256 + 128;
  let dx = tx - fromX;
  const half = gridW * 128;
  if (dx > half) dx -= gridW * 256;
  else if (dx < -half) dx += gridW * 256;
  const dy = ty - fromY;
  if (dx === 0 && dy === 0) return 0;
  const lat = 90 - ((fromY / 256) * 180) / gridH;
  return Math.atan2(-dy, dx * Math.cos((lat * Math.PI) / 180));
}

export interface ShipLayerOptions {
  readonly gridWidth: number;
  readonly gridHeight: number;
  readonly sun: Vector3;
}

export class ShipLayer {
  readonly meshes: Mesh[] = [];
  /** Instances in the draw. */
  count = 0;
  /** Triangles of one instance. */
  readonly modelTriangles: number;
  /** Whether `rebuild` keeps the list of what it drew (read only by the test hooks; off in a live match so that no garbage is made per table). */
  recordDrawn = true;
  private enabled = true;
  private readonly mesh: Mesh;
  private readonly geometry: InstancedBufferGeometry;
  private readonly material: ShaderMaterial;
  private readonly hi = new Float32Array(SHIP_INSTANCE_CAP * 3);
  private readonly lo = new Float32Array(SHIP_INSTANCE_CAP * 3);
  private readonly rgb = new Float32Array(SHIP_INSTANCE_CAP * 3);
  private readonly info = new Float32Array(SHIP_INSTANCE_CAP * 3);
  private readonly attrs: InstancedBufferAttribute[] = [];
  private readonly camHi = new Vector3();
  private readonly camLo = new Vector3();
  private readonly gridWidth: number;
  private readonly gridHeight: number;
  private palette: Uint8Array | null = null;
  private table: ShipView | null = null;
  private version = -1;
  private dirty = true;
  private drawnList: DrawnShip[] = [];

  constructor(o: ShipLayerOptions) {
    this.gridWidth = o.gridWidth;
    this.gridHeight = o.gridHeight;
    const model = shipModel();
    this.modelTriangles = model.triangles;
    const geometry = new InstancedBufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(model.positions, 3));
    geometry.setAttribute('aColor', new BufferAttribute(model.colors, 3));
    geometry.setAttribute('aTint', new BufferAttribute(model.tints, 1));
    const add = (name: string, array: Float32Array): void => {
      const a = new InstancedBufferAttribute(array, 3);
      a.setUsage(DynamicDrawUsage);
      geometry.setAttribute(name, a);
      this.attrs.push(a);
    };
    add('aHi', this.hi);
    add('aLo', this.lo);
    add('aOwner', this.rgb);
    add('aInfo', this.info);
    geometry.instanceCount = 0;
    const v3 = (rgb: readonly number[]): Vector3 => new Vector3(rgb[0], rgb[1], rgb[2]);
    this.material = new ShaderMaterial({
      uniforms: {
        uCamHi: { value: this.camHi },
        uCamLo: { value: this.camLo },
        uSizeM: { value: SHIP_UNIT_M },
        uMinFrac: { value: SHIP_MIN_FRAC },
        uKmPerUnit: { value: EARTH_RADIUS_KM },
        uSink: { value: SHIP_SINK_UNITS },
        uSun: { value: o.sun },
        uSunColor: { value: v3(SUN_COLOR) },
        uAmbientDay: { value: v3(AMBIENT_DAY) },
        uAmbientNight: { value: v3(AMBIENT_NIGHT) },
        uGhost: { value: new Vector4(0, 0, 0, 0) },
        uAlpha: { value: 1 },
      },
      vertexShader: shipVertexShader,
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

  /** Hands the layer the page's ship table; the instances are rewritten when `version` moved. */
  setTable(table: ShipView, version: number): void {
    this.table = table;
    if (version !== this.version) {
      this.version = version;
      this.dirty = true;
    }
  }

  /** Per frame: the camera (float64, Earth radii). */
  frame(camera: ArrayLike<number>): void {
    const x = camera[0] as number;
    const y = camera[1] as number;
    const z = camera[2] as number;
    const hx = Math.fround(x);
    const hy = Math.fround(y);
    const hz = Math.fround(z);
    this.camHi.set(hx, hy, hz);
    this.camLo.set(x - hx, y - hy, z - hz);
    if (this.dirty) this.rebuild();
  }

  /** Switches the layer off or on (a test counts the draw calls with and without it). */
  setEnabled(on: boolean): void {
    this.enabled = on;
    this.mesh.visible = on && this.count > 0;
  }

  /** What the last rebuild drew (do not mutate). */
  drawn(): readonly DrawnShip[] {
    return this.drawnList;
  }

  private rebuild(): void {
    this.dirty = false;
    const t = this.table;
    const palette = this.palette;
    if (t === null || palette === null) {
      this.count = 0;
      this.geometry.instanceCount = 0;
      this.mesh.visible = false;
      return;
    }
    const list: DrawnShip[] = this.recordDrawn ? [] : EMPTY_DRAWN;
    let n = 0;
    for (let id = 0; id < t.capacity && n < SHIP_INSTANCE_CAP; id++) {
      const owner = t.owner[id] as number;
      if (owner === 0) continue;
      const state = t.state[id] as number;
      const qx = t.x[id] as number;
      const qy = t.y[id] as number;
      const ll = heliLatLon(qx, qy, this.gridWidth, this.gridHeight);
      const yaw = shipHeading(t, id, this.gridWidth, this.gridHeight);
      const d = latLonToVec(ll.lat, ll.lon);
      const px = d[0] * SHIP_RADIUS;
      const py = d[1] * SHIP_RADIUS;
      const pz = d[2] * SHIP_RADIUS;
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
      const sunk = state === SHIP_LAND ? 1 : 0;
      this.info[i * 3] = yaw;
      this.info[i * 3 + 1] = sunk;
      this.info[i * 3 + 2] = 0;
      if (this.recordDrawn) list.push({ id, owner, state, cellX: qx / 256, cellY: qy / 256, lat: ll.lat, lon: ll.lon, radius: SHIP_RADIUS, yaw, sunk });
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

