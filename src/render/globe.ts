// The stylised Earth: renderer, scene, globe mesh with the terrain ShaderMaterial, camera rig, picking and projection.
// This is the only module (besides the M00 spike and textureProbe) that talks to WebGL.
import { BufferAttribute, BufferGeometry, Color, Mesh, PerspectiveCamera, Points, Scene, type ShaderMaterial, SphereGeometry, type Vector3, WebGLRenderer } from 'three';
import { type City, type RenderPack, type SimGrid, type WorldMeta } from '../data';
import { CameraRig, clipPlanes, setViewAtAgl, viewFromGroundCamera, type GroundCameraSpec, type ViewState } from './camera';
import { ATMOSPHERE_TOP, DETAIL_BIAS_MIN, DETAIL_OCTAVES_MAX, FLY_GROUND_OCTAVES, MOTTLE_OFF_SCALE, OCTAVE_LAW_OFF_OFFSET, EARTH_RADIUS_KM, HEIGHT_EXAGGERATION, OCEAN_WAVE_SPEED } from './config';
import { fxNow } from './clock';
import { CameraFlight, type FlyOptions } from './flyTo';
import { BORDER_STRENGTH, COUNTRY_TINT } from './config';
import { selectionBytes } from './selection';
import { describeAt, type GlobePick } from './describe';
import { ChunkTerrain, type ChunkStats } from './chunkTerrain';
import { bindHeightSource, detailLod, type DetailLod } from './detail';
import { sunDirectionAt, vecToLatLon, type Vec3 } from './geo';
import { buildGlobeGeometry } from './globeMesh';
import { HeightField } from './heightField';
import { GpuTimer, type TimerGl } from './gpuTimer';
import { groundPickerOf, pickGround, type GroundHit } from './transforms';
import { OwnershipTexture } from './ownership';
import { StructureLayer } from './structures';
import { HeliLayer } from './heliLayer';
import { DistrictLayer } from './districts';
import { meshTriangles, type QualitySettings } from './quality';
import { buildStars } from './stars';
import { createTerrainMaterial, type TerrainMode } from './terrainMaterial';
import { probeEncoding, probeHashes, probeHeights, probeNoise, probeVertexHeights, type ProbeEncoding } from './detailProbe';
import { readTexels } from './textureProbe';
import {
  allTextureBytes,
  rgbaTextureBytes,
  createLookTextures,
  createWorldTextures,
  disposeLookTextures,
  disposeWorldTextures,
  type LookTextures,
  type WorldTextureName,
  type WorldTextures,
} from './textures';

export interface WorldData {
  render: RenderPack;
  sim: SimGrid;
  meta: WorldMeta;
  /** City list for the night lights (optional: without it the night side has no lights). */
  cities?: readonly City[];
}

export interface GlobeOptions {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  dpr: number;
  quality: QualitySettings;
  world: WorldData;
  preserveDrawingBuffer: boolean;
  /** `chunks` (default): the quadtree of instanced chunks; `fixed`: the M02 lat/lon mesh (`?terrain=fixed`). */
  terrain?: TerrainMode;
  /** `?chunks=1`: colour every chunk by its key instead of shading it. */
  chunkDebug?: boolean;
  /** M07b: the terrain detail of the chunk terrain (default true; `?detail=0` switches it off, the base heights only). The fixed mesh has none. */
  detail?: boolean;
  /** M07b audit: the near-view colour mottling of the fragment shader (default true; `?mottle=0` switches it off). A run-time lever: `Globe.setFineDetail`. */
  fineDetail?: boolean;
}

export interface GlobeInfo {
  renderer: string;
  vendor: string;
  glVersion: string;
  webgl2: boolean;
  drawCalls: number;
  triangles: number;
  textures: number;
  geometries: number;
  textureMB: number;
  width: number;
  height: number;
  dpr: number;
  tier: string;
  meshCols: number;
  meshRows: number;
  terrainMode: TerrainMode;
}

interface RendererGl {
  getExtension(name: string): { UNMASKED_RENDERER_WEBGL: number; UNMASKED_VENDOR_WEBGL: number } | null;
  getParameter(pname: number): unknown;
  readonly RENDERER: number;
  readonly VENDOR: number;
}

/** THE one place that reads the renderer and vendor strings of a GL context (the report, the F3 overlay and the default tier all use it). */
export function readGpuStrings(gl: RendererGl): { renderer: string; vendor: string } {
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    renderer: (ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '') || String(gl.getParameter(gl.RENDERER)),
    vendor: (ext ? String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)) : '') || String(gl.getParameter(gl.VENDOR)),
  };
}

/**
 * The strings of this machine's GL, read once at start BEFORE the globe's own context exists (the tier decides that context's
 * antialiasing): a throw-away canvas, released at once. Null when WebGL is unavailable.
 */
export function probeGpuStrings(): { renderer: string; vendor: string } | null {
  try {
    const gl = document.createElement('canvas').getContext('webgl2') ?? document.createElement('canvas').getContext('webgl');
    if (gl === null) return null;
    const strings = readGpuStrings(gl);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return strings;
  } catch {
    return null;
  }
}

/** What `__test.state().terrain` reports. */
export interface TerrainInfo extends ChunkStats {
  mode: TerrainMode;
}

export type { GlobePick } from './describe';

/** The height above ground the clip planes assume at the very least (Earth radii; 10 cm): a camera on or under the ground still gets a valid near plane. */
const CLIP_AGL_FLOOR = 1.6e-8;

export interface ScreenHit {
  x: number;
  y: number;
  inView: boolean;
  facing: boolean;
}

export class Globe {
  readonly rig: CameraRig;
  /** Camera flights (`flyTo`), stepped by `render` on the FX clock. */
  readonly flight: CameraFlight;
  readonly field: HeightField;
  /** Who owns each sim cell (RGBA8 texture, throttled full upload); the match writes into it. */
  readonly ownership: OwnershipTexture;
  /** The structures of the match (M10): instanced models standing on the ground, and the placement ghost. */
  readonly structures: StructureLayer;
  /** The helicopters of the match (M13a-1): one instanced draw call. */
  readonly helis: HeliLayer;
  /** Districts-2b: the districts on the Cities (one instanced draw call). */
  readonly districts: DistrictLayer;
  /** The sim tick as a fraction (set by the page every frame; drives the construction look of the structures). */
  private tickFraction = 0;
  readonly quality: QualitySettings;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly material: ShaderMaterial;
  private readonly mesh: Mesh;
  private readonly chunkTerrain: ChunkTerrain | null;
  readonly terrainMode: TerrainMode;
  /** True when the chunk terrain draws and picks the terrain detail. */
  readonly detail: boolean;
  private readonly chunked: boolean;
  private readonly shell: Mesh;
  private readonly stars: Points;
  private readonly starsMaterial: ShaderMaterial;
  private readonly textures: WorldTextures;
  private readonly look: LookTextures;
  private readonly sun: Vector3;
  private width: number;
  private height: number;
  private dpr: number;
  /** AutoTier-2: the scale of the drawing buffer against the tier's pixel ratio (1 = full); the CSS size, the camera and picking do not see it. */
  private renderScaleValue = 1;
  private readonly world: WorldData;
  /** The law of detail of the tier (offset of the distance law and level bias) before `setDetailBias` moved it. */
  private detailLodBase: DetailLod | null = null;
  private detailBiasOctaves = 0;
  private densityScale = 1;
  private octaveMode: 'law' | 'level' | 'none' = 'law';
  private gpuTimer: GpuTimer | null = null;
  private readonly syncBuf = new Uint8Array(4);
  private readonly counts = { calls: 0, triangles: 0, chunks: 0 };

  constructor(o: GlobeOptions) {
    this.quality = o.quality;
    this.world = o.world;
    this.width = o.width;
    this.height = o.height;
    this.dpr = o.dpr;
    this.renderer = new WebGLRenderer({
      canvas: o.canvas,
      antialias: o.quality.antialias,
      preserveDrawingBuffer: o.preserveDrawingBuffer,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(o.dpr);
    this.renderer.setSize(o.width, o.height, false);
    this.renderer.setClearColor(new Color(0x000000), 1);

    this.rig = new CameraRig(o.width, o.height);
    this.flight = new CameraFlight(this.rig);
    this.camera = new PerspectiveCamera(30, o.width / o.height, 0.01, 100);
    // The displaced surface of the chunk terrain includes the terrain detail (M07b): picking and the camera's ground see what the vertex shader draws.
    this.chunked = (o.terrain ?? 'chunks') === 'chunks';
    this.detail = this.chunked && o.detail !== false;
    this.field = new HeightField({
      height8: o.world.render.height8,
      width: o.world.render.width,
      height: o.world.render.height,
      maxM: o.world.meta.encoding.heightSqrt.maxM,
      exaggeration: HEIGHT_EXAGGERATION,
      ...(this.chunked ? { detail: { lod: detailLod(o.quality.chunkCells, Math.min(o.quality.chunkSplitK, o.quality.chunkDeepK)), octaves: this.detail } } : {}),
    });
    if (this.field.sampler) bindHeightSource(this.field.sampler);

    // The chunk terrain can be zoomed down to about 1 km above the ground (the fixed mesh cannot: it keeps the old minimum distance).
    // M08: the same ground serves the RTS camera (clearance, the height it keeps), flights (the smooth ground they keep their height over) and the grip / zoom picking.
    if ((o.terrain ?? 'chunks') === 'chunks') {
      this.rig.setGround(
        (lat, lon) => this.field.surfaceRadius(lat, lon),
        (lat, lon) => this.field.radiusOf(this.field.surfaceHeightM(lat, lon, FLY_GROUND_OCTAVES)),
      );
      this.rig.setPicker(groundPickerOf(this.field));
    }
    this.textures = createWorldTextures(o.world.render, o.world.sim);
    this.look = createLookTextures(o.world.cities ?? []);
    this.ownership = new OwnershipTexture(o.world.sim.width, o.world.sim.height, o.world.sim.terrainClass);
    this.terrainMode = o.terrain ?? 'chunks';
    const tm = createTerrainMaterial(this.textures, o.world.render, o.world.sim, o.world.meta, this.look, this.ownership, this.terrainMode, o.quality.chunkCells, { kMin: Math.min(o.quality.chunkSplitK, o.quality.chunkDeepK), on: this.detail, fineDetail: o.fineDetail !== false });
    this.detailLodBase = this.field.detailLod;
    this.material = tm.material;
    this.sun = tm.sun;
    if (this.terrainMode === 'chunks') {
      this.chunkTerrain = new ChunkTerrain({
        material: this.material,
        quality: o.quality,
        codes: o.world.render.height8,
        width: o.world.render.width,
        height: o.world.render.height,
        maxM: o.world.meta.encoding.heightSqrt.maxM,
        exaggeration: HEIGHT_EXAGGERATION,
        detail: this.detail,
      });
      this.mesh = this.chunkTerrain.mesh;
      if (o.chunkDebug) this.setChunkDebug(true);
    } else {
      this.chunkTerrain = null;
      this.mesh = new Mesh(buildGlobeGeometry(o.quality.meshCols, o.quality.meshRows), this.material);
      this.mesh.frustumCulled = false;
    }
    // Back-face additive atmosphere shell (drawn after the opaque globe) and the star points (drawn first).
    this.shell = new Mesh(new SphereGeometry(ATMOSPHERE_TOP, 96, 48), tm.atmosphere);
    this.shell.frustumCulled = false;
    this.shell.renderOrder = 10;
    const field = buildStars();
    const sg = new BufferGeometry();
    sg.setAttribute('position', new BufferAttribute(field.positions, 3));
    sg.setAttribute('aSize', new BufferAttribute(field.sizes, 1));
    sg.setAttribute('aColor', new BufferAttribute(field.colors, 3));
    this.starsMaterial = tm.stars;
    this.starsMaterial.uniforms.uPixelRatio = { value: o.dpr };
    this.stars = new Points(sg, this.starsMaterial);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -10;
    this.structures = new StructureLayer({ tier: o.quality.tier, gridWidth: o.world.sim.width, gridHeight: o.world.sim.height, sun: this.sun });
    this.districts = new DistrictLayer({ tier: o.quality.tier, gridWidth: o.world.sim.width, gridHeight: o.world.sim.height, sun: this.sun });
    this.helis = new HeliLayer({ gridWidth: o.world.sim.width, gridHeight: o.world.sim.height, sun: this.sun, meanElev: o.world.sim.meanElev });
    this.scene.add(this.stars, this.mesh, ...this.structures.meshes, ...this.districts.meshes, ...this.helis.meshes, this.shell);
  }

  /** The sim tick including the fraction of the tick in progress (the page sets it every frame). */
  setTickFraction(t: number): void {
    this.tickFraction = t;
  }

  get exaggeration(): number {
    return this.field.exaggeration;
  }

  /** Sets the height exaggeration of the shader and of picking (the flat control of the tests uses 0). */
  setExaggeration(x: number): void {
    this.field.exaggeration = x;
    this.structures.setExaggeration(x);
    this.helis.setExaggeration(x);
    this.districts.setExaggeration(x);
    (this.material.uniforms.uExag as { value: number }).value = x;
    this.chunkTerrain?.setExaggeration(x);
  }

  /**
   * RUN-TIME LEVERS of the terrain's cost (M07b audit, for M24a's quality regulator). The vertex octaves and the near-view mottling are the two costs the
   * detail added; both can be changed without rebuilding anything:
   *  - `setDetailBias(octaves)` moves the distance law of the octaves by that many octaves (0 = the tier's law, -1 = one octave fewer everywhere, down to
   *    `DETAIL_BIAS_MIN`; a positive value is clamped to 0: more than the tier's law would ask a chunk for octaves that its mesh cannot show). It writes the
   *    GPU uniform `uDetailLod.x` AND the law the CPU surface sees (`HeightField`, picking), so the drawn and the picked surface stay one. The quadtree and its
   *    node intervals do not depend on it (they use the octaves a LEVEL carries, `octavesForLevel`); the camera floor uses the finest surface.
   *  - `setChunkDensity(scale)` scales the quadtree's split distances (below).
   *  - `setFineDetail(on)` switches the mottling of the fragment shader (`uMottleScale`: 1 on, `MOTTLE_OFF_SCALE` off = every octave of it is faded out, no loop runs).
   */
  setDetailBias(octaves: number): void {
    this.detailBiasOctaves = Math.min(0, Math.max(DETAIL_BIAS_MIN, octaves));
    this.applyDetailLod();
  }

  /**
   * The chunk density lever: every split distance of the quadtree times `scale` (clamped to 0.5 .. 2; 1 = the tier's own, below 1 = fewer and coarser chunks,
   * above 1 = more). Below 1 the chunks are drawn nearer than the distance the octave law was set for (the tier's `deepK` sides), so the law moves with them
   * (`log2(scale)` octaves, the same offset on the GPU and on the CPU surface) and a chunk is never asked for more octaves than its level carries.
   * The cap on the chunks is the tier's and does not change.
   */
  setChunkDensity(scale: number): void {
    this.densityScale = Math.min(2, Math.max(0.5, scale));
    this.chunkTerrain?.setSplitScale(this.densityScale);
    this.applyDetailLod();
  }

  /**
   * The CONTROLS of the pop tests (D147, D154), never used by the game. `'law'` is the real thing: the octaves of a vertex are the smaller of its chunk's
   * level and the distance law. `'level'` switches the distance law off, so a vertex takes the octaves of its chunk's LEVEL alone and a vertex shared by a
   * level L and a level L + 1 chunk gets different octave sets (the pop the law removes). `'none'` switches every limit off: all 12 octaves everywhere,
   * aliased on the coarse chunks and different on the fine ones (the "no detail fade at all" mutant).
   */
  setOctaveLimit(mode: 'law' | 'level' | 'none'): void {
    this.octaveMode = mode;
    this.applyDetailLod();
  }

  get chunkDensity(): number {
    return this.densityScale;
  }

  private applyDetailLod(): void {
    const u = this.material.uniforms.uDetailLod as { value: { x: number; y: number } } | undefined;
    const base = this.detailLodBase;
    if (!u || !base) return;
    const lod: DetailLod = {
      offset: this.octaveMode === 'law' ? base.offset + this.detailBiasOctaves + Math.min(0, Math.log2(this.densityScale)) : OCTAVE_LAW_OFF_OFFSET,
      levelBias: this.octaveMode === 'none' ? DETAIL_OCTAVES_MAX : base.levelBias,
    };
    u.value.x = lod.offset;
    u.value.y = lod.levelBias;
    this.field.setDetailLod(lod);
  }

  get detailBias(): number {
    return this.detailBiasOctaves;
  }

  setFineDetail(on: boolean): void {
    const u = this.material.uniforms.uMottleScale as { value: number } | undefined;
    if (u) u.value = on ? 1 : MOTTLE_OFF_SCALE;
  }

  get fineDetail(): boolean {
    return ((this.material.uniforms.uMottleScale as { value: number } | undefined)?.value ?? MOTTLE_OFF_SCALE) < 1.5;
  }

  /** `?chunks=1`: colours every chunk by its key (chunk terrain only). */
  setChunkDebug(on: boolean): void {
    const u = this.material.uniforms.uChunkDebug as { value: number } | undefined;
    if (u) u.value = on ? 1 : 0;
  }

  /** Test switch: the skirts of the chunks (on by default). With them off every LOD seam is an open crack. */
  setSkirts(on: boolean): void {
    const u = this.material.uniforms.uSkirtsOn as { value: number } | undefined;
    if (u) u.value = on ? 1 : 0;
  }

  /** Test switch: the colour the frame is cleared to (the crack test clears to magenta so a hole in the terrain shows). */
  setClearColor(rgb: number): void {
    this.renderer.setClearColor(new Color(rgb), 1);
  }

  /** The chunk terrain's numbers (mode, chunk count, distinct levels, triangles, draw calls); all zero in the fixed mode except the mesh. */
  terrainInfo(): TerrainInfo {
    if (this.chunkTerrain) return { mode: 'chunks', ...this.chunkTerrain.getStats() };
    return { mode: 'fixed', chunkCount: 0, lodLevels: 0, levels: [], triangles: this.meshTriangleCount, drawCalls: 1, capped: false };
  }

  /** The chunk terrain itself (tests); null in the fixed mode. */
  get chunks(): ChunkTerrain | null {
    return this.chunkTerrain;
  }

  /** Forgets the LOD hysteresis (called when a test or the app jumps the camera, so the result does not depend on the path). */
  resetTerrain(): void {
    this.chunkTerrain?.reset();
  }

  /** The camera's height above the displaced ground under it, in metres (negative when it is below). */
  cameraAglM(): number {
    const p = this.rig.pose().position;
    return this.aglRadii(p) * EARTH_RADIUS_KM * 1000;
  }

  private aglRadii(p: Vec3): number {
    const { lat, lon } = vecToLatLon(p);
    return Math.hypot(p[0], p[1], p[2]) - this.field.surfaceRadius(lat, lon);
  }

  /** Test hook: the camera `altAglM` metres above the displaced ground under it, without the user's zoom limit and tilt clamp (see `setViewAtAgl`). */
  setViewAgl(v: Partial<ViewState>, altAglM: number): void {
    this.flight.cancel();
    setViewAtAgl(this.rig, (lat, lon) => this.field.surfaceRadius(lat, lon), v, altAglM);
  }

  /** The camera given by its own position, heading and pitch (see `viewFromGroundCamera`); the user's zoom and tilt limits do not apply. */
  setGroundView(spec: GroundCameraSpec): void {
    this.flight.cancel();
    this.rig.setViewUnclamped(viewFromGroundCamera(spec, (lat, lon) => this.field.surfaceRadius(lat, lon)));
  }

  /** Strength of the country border lines (0 = none); a test switch for the border acceptance. */
  setBorderStrength(x: number): void {
    (this.material.uniforms.uBorderStrength as { value: number }).value = x;
  }

  setView(v: Partial<ViewState>): void {
    this.flight.cancel();
    this.rig.setView(v);
  }

  /** Flies the camera to a place (great circle, eased, timed by the FX clock; see src/render/flyTo.ts). */
  flyTo(lat: number, lon: number, distKm: number, options?: FlyOptions): void {
    this.flight.flyTo(lat, lon, distKm, options);
  }

  /** Stops a flight under way (any grab of the camera does). */
  cancelFlight(): void {
    this.flight.cancel();
  }

  /**
   * Outlines a country on the globe (the setup screen): `ids` are the country ids of the id raster that make up the selection (a
   * country and the territories merged into it); an empty list clears it.
   */
  setSelection(ids: readonly number[]): void {
    const tex = (this.material.uniforms.uSelTex as { value: { image: { data: Uint8Array }; needsUpdate: boolean } }).value;
    selectionBytes(ids, tex.image.data);
    tex.needsUpdate = true;
    (this.material.uniforms.uSelActive as { value: number }).value = ids.length > 0 ? 1 : 0;
  }

  /** The "no real borders" mode (M06): no country border lines and no country tint; the territories of the match stay. */
  setCountryLines(on: boolean): void {
    (this.material.uniforms.uBorderStrength as { value: number }).value = on ? BORDER_STRENGTH : 0;
    (this.material.uniforms.uCountryTint as { value: number }).value = on ? COUNTRY_TINT : 0;
  }

  /** Replaces the owner colour table (256 RGBA entries from `buildOwnerPalette`), for a custom nation's own colour. */
  setOwnerPalette(rgba: Uint8Array): void {
    const tex = (this.material.uniforms.uOwnerPalette as { value: { image: { data: Uint8Array }; needsUpdate: boolean } }).value;
    tex.image.data.set(rgba);
    tex.needsUpdate = true;
    this.structures.setOwnerPalette(rgba);
    this.helis.setOwnerPalette(rgba);
    this.districts.setOwnerPalette(rgba);
  }

  resize(width: number, height: number, dpr: number): void {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.rig.setViewport(width, height);
    this.applyBuffer();
  }

  /**
   * AutoTier-2 (D160): scales the DRAWING BUFFER to `scale` times the tier's pixel ratio (0.25 .. 1). Only the buffer changes: `renderer.setSize(..., false)` leaves the CSS size,
   * and the camera rig, picking and projection keep working in CSS pixels. Call it when the scale changes, not per frame.
   */
  setRenderScale(scale: number): void {
    const s = Math.min(1, Math.max(0.25, scale));
    if (s === this.renderScaleValue) return;
    this.renderScaleValue = s;
    this.applyBuffer();
  }

  get renderScale(): number {
    return this.renderScaleValue;
  }

  private applyBuffer(): void {
    const ratio = this.dpr * this.renderScaleValue;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(this.width, this.height, false);
    (this.starsMaterial.uniforms.uPixelRatio as { value: number }).value = ratio;
  }

  /**
   * Renders one frame at the current fx time (camera inertia and the sun follow the fx clock). `draw` false runs every state update of the
   * frame (ownership flush, flight, camera, chunk LOD) but skips the GL draw: test hooks use it for frames nobody looks at.
   */
  render(draw = true): void {
    const now = fxNow();
    this.ownership.flush(now); // the one place that schedules the (throttled) full upload
    this.flight.update(now);
    this.rig.update(now);
    const sun = sunDirectionAt(now);
    this.sun.set(sun[0], sun[1], sun[2]);
    (this.material.uniforms.uTime as { value: number }).value = now * OCEAN_WAVE_SPEED;
    const p = this.rig.pose();
    const c = this.camera;
    c.position.set(p.position[0], p.position[1], p.position[2]);
    c.up.set(p.up[0], p.up[1], p.up[2]);
    if (this.chunkTerrain) {
      // Chunk terrain: the depth range follows the camera's height above the ground (near 10 % of it, far at the horizon plus the sky shell).
      const clip = clipPlanes(Math.hypot(p.position[0], p.position[1], p.position[2]), Math.max(this.aglRadii(p.position), CLIP_AGL_FLOOR));
      c.near = clip.near;
      c.far = clip.far;
    } else {
      c.near = p.near;
      c.far = p.far;
    }
    c.fov = p.fovDeg;
    c.aspect = p.aspect;
    c.updateProjectionMatrix();
    c.lookAt(p.target[0], p.target[1], p.target[2]);
    c.updateMatrixWorld();
    this.structures.frame(p.position, now, this.tickFraction, this.renderer.domElement.height);
    this.helis.frame(p.position, now);
    this.districts.frame(p.position, now, this.tickFraction, this.renderer.domElement.height, Math.tan((p.fovDeg * Math.PI) / 360));
    this.chunkTerrain?.update(p);
    if (draw) {
      const timer = this.gpuTimer;
      timer?.begin();
      this.renderer.render(this.scene, c);
      if (timer) {
        timer.end();
        timer.poll();
      }
    }
  }

  /**
   * The renderer's counters of the frame drawn last, in one reused object (no allocation per frame: the performance scene reads it every
   * frame). `chunks` is the number of terrain chunks of the last update (0 in the fixed mode).
   */
  frameCounters(): { calls: number; triangles: number; chunks: number } {
    const r = this.renderer.info.render;
    this.counts.calls = r.calls;
    this.counts.triangles = r.triangles;
    this.counts.chunks = this.chunkTerrain?.chunkCount ?? 0;
    return this.counts;
  }

  /**
   * Starts timing the draw call on the GPU (`EXT_disjoint_timer_query_webgl2`; the performance scene turns it on, nothing else). Returns
   * whether the browser offers the extension; the finished measurements come out of `takeGpuMs`.
   */
  enableGpuTimer(): boolean {
    this.gpuTimer ??= new GpuTimer(this.renderer.getContext() as unknown as TimerGl);
    return this.gpuTimer.available;
  }

  /** The next finished GPU time of the draw call in ms, or null (timer off, not offered, or nothing ready yet). */
  takeGpuMs(): number | null {
    return this.gpuTimer?.take() ?? null;
  }

  /**
   * Waits until the GPU has finished the frame drawn last (a one-pixel readback of the default framebuffer). `finish()` only flushes in Chromium;
   * the performance scene in test mode uses this so that the software renderer's queue never backs up and every frame interval includes the
   * drawing. Needs `preserveDrawingBuffer` (test mode); never called by the live page.
   */
  sync(): void {
    const gl = this.renderer.getContext();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.syncBuf);
  }

  /**
   * Waits for the queued GL commands. A frame loop needs no call (the browser presents every frame); the test hooks, which render many frames
   * in one JavaScript task without presenting, call it so that the driver's command queue (ANGLE warns "running out of reserved queue
   * serials" after a few dozen uploads in one task) never fills up.
   */
  finish(): void {
    this.renderer.getContext().finish();
  }

  /** Surface pick under a pixel: ray against the displaced heights, then the sim cell, class and country. */
  pick(px: number, py: number): GlobePick | null {
    const ray = this.rig.rayAt(px, py);
    const hit = this.field.pick(ray.origin, ray.dir);
    if (!hit) return null;
    return this.describe(hit.lat, hit.lon, hit.heightM);
  }

  /** The ground under a pixel (M08, `pickGround` of src/render/transforms.ts): the hit on the surface the camera sees, with its radius and seen height; null when the ray misses the globe. */
  pickGroundAt(px: number, py: number): GroundHit | null {
    const ray = this.rig.rayAt(px, py);
    return pickGround(this.field, ray);
  }

  /** The surface point under a pixel as the picking finds it: latitude, longitude and radius (Earth radii) of the displaced surface including the detail (tests). */
  pickSurface(px: number, py: number): { lat: number; lon: number; radius: number } | null {
    const ray = this.rig.rayAt(px, py);
    const hit = this.field.pick(ray.origin, ray.dir);
    return hit ? { lat: hit.lat, lon: hit.lon, radius: Math.hypot(hit.point[0], hit.point[1], hit.point[2]) } : null;
  }

  /** The camera position in Earth radii (tests). */
  cameraPosition(): [number, number, number] {
    const p = this.rig.pose().position;
    return [p[0], p[1], p[2]];
  }

  /** Cell, class, country and elevation of a position (the rules are in describe.ts). */
  describe(lat: number, lon: number, heightM: number = this.field.heightM(lat, lon)): GlobePick {
    return describeAt(this.world, lat, lon, heightM);
  }

  /** Screen position (canvas pixels) of the displaced surface point above a position. */
  project(lat: number, lon: number): ScreenHit {
    const s = this.rig.project(this.field.surfacePoint(lat, lon) as Vec3);
    return { x: s.x, y: s.y, inView: s.inView, facing: s.facing };
  }

  /** Texel values of a data texture as the GPU holds them (render-to-target readback). */
  readTexels(name: WorldTextureName, points: ReadonlyArray<readonly [number, number]>): Uint8Array {
    return readTexels(this.renderer, this.textures[name], points);
  }

  /** The encoding the detail probe uses on this renderer (float when EXT_color_buffer_float exists, else packed bytes). */
  probeEncoding(): ProbeEncoding {
    return probeEncoding(this.renderer);
  }

  /** The integer hash of each [ix, iy, iz, seed], computed by the GLSL function of the terrain detail (see detailProbe.ts). */
  probeHashes(items: ReadonlyArray<readonly [number, number, number, number]>, encoding?: ProbeEncoding): Uint32Array {
    return probeHashes(this.renderer, items, encoding);
  }

  /** The height in render metres of each [latitude, longitude, octaves], computed by the GLSL function of the terrain detail from the uploaded raster. */
  probeHeights(points: ReadonlyArray<readonly [number, number, number]>, encoding?: ProbeEncoding): Float32Array {
    const r = this.world.render;
    return probeHeights(this.renderer, { texture: this.textures.height, width: r.width, height: r.height, maxM: this.world.meta.encoding.heightSqrt.maxM }, points, encoding);
  }

  /** The local relief in metres of each [latitude, longitude] (-1 on sea) as the GLSL `detSample` computes it: the 3x3 rule, the floor and the polar fade. */
  probeReliefs(points: ReadonlyArray<readonly [number, number]>, encoding?: ProbeEncoding): Float32Array {
    const r = this.world.render;
    return probeHeights(this.renderer, { texture: this.textures.height, width: r.width, height: r.height, maxM: this.world.meta.encoding.heightSqrt.maxM }, points.map((p) => [p[0], p[1], 0] as const), encoding, 'relief');
  }

  /** The 3D value noise of the GLSL function at each [x, y, z, seed] (or its ridge value). */
  probeNoiseValues(items: ReadonlyArray<readonly [number, number, number, number]>, ridge: boolean, encoding?: ProbeEncoding): Float32Array {
    return probeNoise(this.renderer, items, ridge, encoding);
  }

  /** The law of detail of the chunk material (`uDetailLod`: the offset of the distance law, the level bias, 1 = detail on); null in the fixed mode. */
  detailLodUniform(): [number, number, number] | null {
    const u = this.material.uniforms.uDetailLod as { value: { x: number; y: number; z: number } } | undefined;
    return u ? [u.value.x, u.value.y, u.value.z] : null;
  }

  /** The height the chunk vertex shader draws at each [latitude, longitude, chunk level, camera x, y, z (Earth radii)] (the vertex path of the detail, see detailProbe.ts). */
  probeVertexHeights(points: ReadonlyArray<readonly [number, number, number, number, number, number]>, encoding?: ProbeEncoding): Float32Array {
    const lod = this.detailLodUniform();
    if (!lod) throw new Error('probeVertexHeights: the fixed mesh has no terrain detail');
    const r = this.world.render;
    return probeVertexHeights(this.renderer, { texture: this.textures.height, width: r.width, height: r.height, maxM: this.world.meta.encoding.heightSqrt.maxM }, points, lod, this.field.exaggeration, EARTH_RADIUS_KM * 1000, encoding);
  }

  /** The owners the GPU holds for a list of sim cells (R + 256 * G of the ownership texture), after forcing the pending upload. */
  readOwnership(cells: ReadonlyArray<number>): Uint16Array {
    this.ownership.flush(fxNow(), true);
    const w = this.ownership.width;
    const pts = cells.map((c) => [c % w, Math.floor(c / w)] as const);
    const lo = readTexels(this.renderer, this.ownership.texture, pts, 0);
    const hi = readTexels(this.renderer, this.ownership.texture, pts, 1);
    return Uint16Array.from(cells, (_, i) => (lo[i] as number) | ((hi[i] as number) << 8));
  }

  info(): GlobeInfo {
    const gl = this.renderer.getContext();
    const strings = readGpuStrings(gl);
    const info = this.renderer.info;
    // The world and look textures, plus the match's two: the 1024x512 RGBA8 ownership texture (2 MB) and the 256x1 owner palette.
    const palette = (this.material.uniforms.uOwnerPalette as { value: { image: unknown } }).value;
    const bytes = allTextureBytes(this.textures, this.look) + rgbaTextureBytes(this.ownership.texture) + rgbaTextureBytes(palette);
    return {
      renderer: strings.renderer,
      vendor: strings.vendor,
      glVersion: String(gl.getParameter(gl.VERSION)),
      webgl2: typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext,
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      textures: info.memory.textures,
      geometries: info.memory.geometries,
      textureMB: bytes / (1024 * 1024),
      width: this.width,
      height: this.height,
      dpr: this.dpr,
      tier: this.quality.tier,
      meshCols: this.quality.meshCols,
      meshRows: this.quality.meshRows,
      terrainMode: this.terrainMode,
    };
  }

  /** Triangles of the globe mesh alone (also what renderer.info reports for the globe scene in A). */
  get meshTriangleCount(): number {
    return meshTriangles(this.quality);
  }

  dispose(): void {
    this.structures.dispose();
    this.helis.dispose();
    this.districts.dispose();
    this.gpuTimer?.dispose();
    this.chunkTerrain?.dispose();
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.shell.geometry.dispose();
    (this.shell.material as ShaderMaterial).dispose();
    this.stars.geometry.dispose();
    this.starsMaterial.dispose();
    disposeWorldTextures(this.textures);
    disposeLookTextures(this.look);
    this.ownership.dispose();
    (this.material.uniforms.uOwnerPalette as { value: { dispose(): void } }).value.dispose();
    (this.material.uniforms.uSelTex as { value: { dispose(): void } }).value.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss(); // free the GL context: the app restarts the scene on hashchange
  }
}
