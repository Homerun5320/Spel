// The deploy layer (M13b): what the deploy mode draws on the globe. THREE draw calls and no more: the route line twice (bright with the depth test, so the
// part in front of the terrain is crisp, and dim without it, so the part behind a ridge still shows through) and the landing-zone marker once (a ring and a
// pole that sit on the ground of the hovered cell). It reads plain numbers (the route's cells, the exposure per cell, the marker cell and state) and
// nothing from the sim; the page feeds it from the preview. The buffers are fixed in size, written only when the route or the marker CHANGES (at most 5 Hz,
// the preview's throttle); `frame` sets uniforms and allocates nothing. Colours are handed in (`setStyle`, from src/ui/uiConfig.ts).
import { BufferAttribute, BufferGeometry, DoubleSide, DynamicDrawUsage, Line, Mesh, ShaderMaterial, Vector3, type Object3D } from 'three';
import { EARTH_RADIUS_KM, HEIGHT_EXAGGERATION } from './config';
import { latLonToVec } from './geo';
import { markerFragmentShader, markerVertexShader, routeFragmentShader, routeVertexShader } from './shaders/deploy';
import { groundHeightAt, radiusAboveGround } from './transforms';

/** The most vertices of a drawn route (waypoints subdivided so that a long leg follows the curve of the globe). */
export const DEPLOY_ROUTE_CAP = 768;
/** A leg is cut into pieces of at most this many sim cells. */
export const DEPLOY_ROUTE_STEP_CELLS = 1.5;
/** The marker's states: 0 = waiting for the answer, 1 = a valid landing zone, 2 = a refused one. */
export type MarkerState = 0 | 1 | 2;
type Rgb = readonly [number, number, number];

export interface DeployStyle {
  /** RGB 0..1: the route where it is hidden and where it is seen, and the marker colours by state [pending, valid, refused]. */
  readonly routeCool: Rgb;
  readonly routeHot: Rgb;
  readonly marker: readonly [Rgb, Rgb, Rgb];
  /** Alpha of the dim pass (no depth test) and of the marker. */
  readonly dimAlpha: number;
  readonly markerAlpha: number;
  /** The marker radius as a share of the camera distance, and its smallest radius in metres. */
  readonly markerScreenFrac: number;
  readonly markerMinM: number;
}

const DEFAULT_STYLE: DeployStyle = {
  routeCool: [0.2, 0.95, 0.35],
  routeHot: [1, 0.2, 0.15],
  marker: [
    [1, 0.85, 0.3],
    [0.25, 1, 0.4],
    [1, 0.25, 0.2],
  ],
  dimAlpha: 0.35,
  markerAlpha: 0.9,
  markerScreenFrac: 0.012,
  markerMinM: 12000,
};

const RING_SEGMENTS = 40;
const POLE_HEIGHT = 3;

export class DeployLayer {
  readonly meshes: Object3D[] = [];
  /** Vertices of the route in the draw (0 = no route). */
  routeVertices = 0;
  /** The marker cell (-1 = none) and its state. */
  markerCell = -1;
  markerState: MarkerState = 0;
  private enabled = true;
  private readonly lines: Line[] = [];
  private readonly routeGeometry: BufferGeometry;
  private readonly hi = new Float32Array(DEPLOY_ROUTE_CAP * 3);
  private readonly lo = new Float32Array(DEPLOY_ROUTE_CAP * 3);
  private readonly exp = new Float32Array(DEPLOY_ROUTE_CAP);
  private readonly routeAttrs: BufferAttribute[] = [];
  private readonly routeMaterials: ShaderMaterial[] = [];
  private readonly markerMesh: Mesh;
  private readonly markerGeometry: BufferGeometry;
  private readonly markerMaterial: ShaderMaterial;
  private readonly camHi = new Vector3();
  private readonly camLo = new Vector3();
  private readonly centreHi = new Vector3();
  private readonly centreLo = new Vector3();
  private style: DeployStyle = DEFAULT_STYLE;
  private exaggeration = HEIGHT_EXAGGERATION;
  private routeCells: readonly number[] | null = null;
  private routeExposed: Uint8Array | null = null;
  private routeAglM = 300;

  constructor(
    private readonly gridWidth: number,
    private readonly gridHeight: number,
  ) {
    const g = new BufferGeometry();
    const position = new BufferAttribute(this.hi, 3);
    const aLo = new BufferAttribute(this.lo, 3);
    const aExp = new BufferAttribute(this.exp, 1);
    for (const a of [position, aLo, aExp]) {
      a.setUsage(DynamicDrawUsage);
      this.routeAttrs.push(a);
    }
    g.setAttribute('position', position);
    g.setAttribute('aLo', aLo);
    g.setAttribute('aExp', aExp);
    g.setDrawRange(0, 0);
    this.routeGeometry = g;
    const uniforms = (alpha: number): Record<string, { value: unknown }> => ({
      uCamHi: { value: this.camHi },
      uCamLo: { value: this.camLo },
      uCool: { value: new Vector3(...DEFAULT_STYLE.routeCool) },
      uHot: { value: new Vector3(...DEFAULT_STYLE.routeHot) },
      uAlpha: { value: alpha },
    });
    // the dim pass first (no depth test, see-through), the bright pass over it (depth test: only what is in front of the terrain)
    const dim = new ShaderMaterial({ uniforms: uniforms(DEFAULT_STYLE.dimAlpha), vertexShader: routeVertexShader, fragmentShader: routeFragmentShader, transparent: true, depthTest: false, depthWrite: false });
    const bright = new ShaderMaterial({ uniforms: uniforms(1), vertexShader: routeVertexShader, fragmentShader: routeFragmentShader, transparent: false, depthTest: true, depthWrite: false });
    this.routeMaterials.push(dim, bright);
    for (const [m, order] of [
      [dim, 40],
      [bright, 41],
    ] as const) {
      const line = new Line(g, m);
      line.frustumCulled = false;
      line.renderOrder = order;
      line.visible = false;
      this.lines.push(line);
      this.meshes.push(line);
    }
    // the marker: a flat ring (x, z) and a pole (two crossed quads), unit radius
    const pos: number[] = [];
    const r0 = 0.78;
    for (let i = 0; i < RING_SEGMENTS; i++) {
      const a0 = (i / RING_SEGMENTS) * Math.PI * 2;
      const a1 = ((i + 1) / RING_SEGMENTS) * Math.PI * 2;
      const c0 = Math.cos(a0);
      const s0 = Math.sin(a0);
      const c1 = Math.cos(a1);
      const s1 = Math.sin(a1);
      pos.push(c0 * r0, 0, s0 * r0, c0, 0, s0, c1, 0, s1, c0 * r0, 0, s0 * r0, c1, 0, s1, c1 * r0, 0, s1 * r0);
    }
    const w = 0.05;
    pos.push(-w, 0, 0, w, 0, 0, w, POLE_HEIGHT, 0, -w, 0, 0, w, POLE_HEIGHT, 0, -w, POLE_HEIGHT, 0);
    pos.push(0, 0, -w, 0, 0, w, 0, POLE_HEIGHT, w, 0, 0, -w, 0, POLE_HEIGHT, w, 0, POLE_HEIGHT, -w);
    const mg = new BufferGeometry();
    mg.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    this.markerGeometry = mg;
    this.markerMaterial = new ShaderMaterial({
      uniforms: {
        uCamHi: { value: this.camHi },
        uCamLo: { value: this.camLo },
        uCenterHi: { value: this.centreHi },
        uCenterLo: { value: this.centreLo },
        uKmPerUnit: { value: EARTH_RADIUS_KM },
        uPxK: { value: DEFAULT_STYLE.markerScreenFrac },
        uMinM: { value: DEFAULT_STYLE.markerMinM },
        uColor: { value: new Vector3(...DEFAULT_STYLE.marker[0]) },
        uAlpha: { value: DEFAULT_STYLE.markerAlpha },
      },
      vertexShader: markerVertexShader,
      fragmentShader: markerFragmentShader,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: DoubleSide,
    });
    this.markerMesh = new Mesh(mg, this.markerMaterial);
    this.markerMesh.frustumCulled = false;
    this.markerMesh.renderOrder = 42;
    this.markerMesh.visible = false;
    this.meshes.push(this.markerMesh);
  }

  /** Colours and sizes (from `src/ui/uiConfig.ts`). */
  setStyle(style: DeployStyle): void {
    this.style = style;
    for (const m of this.routeMaterials) {
      (m.uniforms.uCool as { value: Vector3 }).value.set(...style.routeCool);
      (m.uniforms.uHot as { value: Vector3 }).value.set(...style.routeHot);
    }
    ((this.routeMaterials[0] as ShaderMaterial).uniforms.uAlpha as { value: number }).value = style.dimAlpha;
    (this.markerMaterial.uniforms.uPxK as { value: number }).value = style.markerScreenFrac;
    (this.markerMaterial.uniforms.uMinM as { value: number }).value = style.markerMinM;
    (this.markerMaterial.uniforms.uAlpha as { value: number }).value = style.markerAlpha;
    this.setMarker(this.markerCell, this.markerState);
  }

  setExaggeration(x: number): void {
    this.exaggeration = x;
    if (this.routeCells !== null) this.setRoute(this.routeCells, this.routeExposed, this.routeAglM);
    this.setMarker(this.markerCell, this.markerState);
  }

  /** Draws the route: `cells` are sim cells (start, turning points, goal), `exposed` 0/1 per cell (null = all hidden), `aglM` the flight height above the ground. null clears it. */
  setRoute(cells: readonly number[] | null, exposed: Uint8Array | null, aglM: number): void {
    this.routeCells = cells;
    this.routeExposed = exposed;
    this.routeAglM = aglM;
    let n = 0;
    if (cells !== null && cells.length >= 2) {
      const w = this.gridWidth;
      const h = this.gridHeight;
      const put = (x: number, y: number, e: number): void => {
        if (n >= DEPLOY_ROUTE_CAP) return;
        const lat = ((h - 2 * y - 1) * 90) / h;
        const lon = ((2 * x + 1 - w) * 180) / w;
        const ground = groundHeightAt(lat, lon);
        const radius = radiusAboveGround(1 + (this.exaggeration * ground) / (EARTH_RADIUS_KM * 1000), aglM);
        const d = latLonToVec(lat, lon);
        const px = d[0] * radius;
        const py = d[1] * radius;
        const pz = d[2] * radius;
        const hx = Math.fround(px);
        const hy = Math.fround(py);
        const hz = Math.fround(pz);
        this.hi[n * 3] = hx;
        this.hi[n * 3 + 1] = hy;
        this.hi[n * 3 + 2] = hz;
        this.lo[n * 3] = px - hx;
        this.lo[n * 3 + 1] = py - hy;
        this.lo[n * 3 + 2] = pz - hz;
        this.exp[n] = e;
        n++;
      };
      for (let i = 0; i + 1 < cells.length; i++) {
        const a = cells[i] as number;
        const b = cells[i + 1] as number;
        const ax = a % w;
        const ay = (a - ax) / w;
        let bx = b % w;
        const by = (b - bx) / w;
        if (bx - ax > w / 2) bx -= w;
        else if (ax - bx > w / 2) bx += w; // the shortest way over the date line
        const len = Math.hypot(bx - ax, by - ay);
        const pieces = Math.max(1, Math.ceil(len / DEPLOY_ROUTE_STEP_CELLS));
        const ea = exposed === null ? 0 : (exposed[i] as number);
        const eb = exposed === null ? 0 : (exposed[i + 1] as number);
        for (let k = 0; k < pieces; k++) {
          const f = k / pieces;
          put(ax + (bx - ax) * f, ay + (by - ay) * f, ea + (eb - ea) * f);
        }
        if (i + 2 === cells.length) put(bx, by, eb);
      }
    }
    this.routeVertices = n;
    this.routeGeometry.setDrawRange(0, n);
    for (const a of this.routeAttrs) a.needsUpdate = true;
    for (const l of this.lines) l.visible = this.enabled && n >= 2;
  }

  /** Puts the marker on sim cell `cell` (-1 hides it) in state `state`. */
  setMarker(cell: number, state: MarkerState): void {
    this.markerCell = cell;
    this.markerState = state;
    this.markerMesh.visible = this.enabled && cell >= 0;
    if (cell < 0) return;
    const w = this.gridWidth;
    const h = this.gridHeight;
    const x = cell % w;
    const y = (cell - x) / w;
    const lat = ((h - 2 * y - 1) * 90) / h;
    const lon = ((2 * x + 1 - w) * 180) / w;
    const ground = groundHeightAt(lat, lon);
    const radius = radiusAboveGround(1 + (this.exaggeration * ground) / (EARTH_RADIUS_KM * 1000), 20);
    const d = latLonToVec(lat, lon);
    const px = d[0] * radius;
    const py = d[1] * radius;
    const pz = d[2] * radius;
    const hx = Math.fround(px);
    const hy = Math.fround(py);
    const hz = Math.fround(pz);
    this.centreHi.set(hx, hy, hz);
    this.centreLo.set(px - hx, py - hy, pz - hz);
    (this.markerMaterial.uniforms.uColor as { value: Vector3 }).value.set(...this.style.marker[state]);
  }

  /** Per frame: the camera (float64, Earth radii). Allocates nothing. */
  frame(camera: ArrayLike<number>): void {
    const x = camera[0] as number;
    const y = camera[1] as number;
    const z = camera[2] as number;
    const hx = Math.fround(x);
    const hy = Math.fround(y);
    const hz = Math.fround(z);
    this.camHi.set(hx, hy, hz);
    this.camLo.set(x - hx, y - hy, z - hz);
  }

  /** Switches the layer off or on (a test counts the draw calls with and without it). */
  setEnabled(on: boolean): void {
    this.enabled = on;
    for (const l of this.lines) l.visible = on && this.routeVertices >= 2;
    this.markerMesh.visible = on && this.markerCell >= 0;
  }

  /** What the layer shows (tests, the props hook). */
  info(): { routeVertices: number; markerCell: number; markerState: number; visibleMeshes: number } {
    let v = 0;
    for (const l of this.lines) if (l.visible) v++;
    if (this.markerMesh.visible) v++;
    return { routeVertices: this.routeVertices, markerCell: this.markerCell, markerState: this.markerState, visibleMeshes: v };
  }

  dispose(): void {
    this.routeGeometry.dispose();
    this.markerGeometry.dispose();
    for (const m of this.routeMaterials) m.dispose();
    this.markerMaterial.dispose();
  }
}
