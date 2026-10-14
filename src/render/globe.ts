// The stylised Earth: renderer, scene, globe mesh with the terrain ShaderMaterial, camera rig, picking and projection.
// This is the only module (besides the M00 spike and textureProbe) that talks to WebGL.
import { BufferAttribute, BufferGeometry, Color, Mesh, PerspectiveCamera, Points, Scene, type ShaderMaterial, SphereGeometry, type Vector3, WebGLRenderer } from 'three';
import { type City, type RenderPack, type SimGrid, type WorldMeta } from '../data';
import { CameraRig, clipPlanes, setViewAtAgl, type ViewState } from './camera';
import { ATMOSPHERE_TOP, EARTH_RADIUS_KM, HEIGHT_EXAGGERATION, OCEAN_WAVE_SPEED } from './config';
import { fxNow } from './clock';
import { CameraFlight, type FlyOptions } from './flyTo';
import { BORDER_STRENGTH, COUNTRY_TINT } from './config';
import { selectionBytes } from './selection';
import { describeAt, type GlobePick } from './describe';
import { ChunkTerrain, type ChunkStats } from './chunkTerrain';
import { sunDirectionAt, vecToLatLon, type Vec3 } from './geo';
import { buildGlobeGeometry } from './globeMesh';
import { HeightField } from './heightField';
import { OwnershipTexture } from './ownership';
import { meshTriangles, type QualitySettings } from './quality';
import { buildStars } from './stars';
import { createTerrainMaterial, type TerrainMode } from './terrainMaterial';
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
  readonly quality: QualitySettings;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly material: ShaderMaterial;
  private readonly mesh: Mesh;
  private readonly chunkTerrain: ChunkTerrain | null;
  readonly terrainMode: TerrainMode;
  private readonly shell: Mesh;
  private readonly stars: Points;
  private readonly starsMaterial: ShaderMaterial;
  private readonly textures: WorldTextures;
  private readonly look: LookTextures;
  private readonly sun: Vector3;
  private width: number;
  private height: number;
  private dpr: number;
  private readonly world: WorldData;

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
    this.field = new HeightField({
      height8: o.world.render.height8,
      width: o.world.render.width,
      height: o.world.render.height,
      maxM: o.world.meta.encoding.heightSqrt.maxM,
      exaggeration: HEIGHT_EXAGGERATION,
    });

    this.textures = createWorldTextures(o.world.render, o.world.sim);
    this.look = createLookTextures(o.world.cities ?? []);
    this.ownership = new OwnershipTexture(o.world.sim.width, o.world.sim.height, o.world.sim.terrainClass);
    this.terrainMode = o.terrain ?? 'chunks';
    const tm = createTerrainMaterial(this.textures, o.world.render, o.world.sim, o.world.meta, this.look, this.ownership, this.terrainMode, o.quality.chunkCells);
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
    this.scene.add(this.stars, this.mesh, this.shell);
  }

  get exaggeration(): number {
    return this.field.exaggeration;
  }

  /** Sets the height exaggeration of the shader and of picking (the flat control of the tests uses 0). */
  setExaggeration(x: number): void {
    this.field.exaggeration = x;
    (this.material.uniforms.uExag as { value: number }).value = x;
    this.chunkTerrain?.setExaggeration(x);
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
  }

  resize(width: number, height: number, dpr: number): void {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    this.rig.setViewport(width, height);
    (this.starsMaterial.uniforms.uPixelRatio as { value: number }).value = dpr;
  }

  /** Renders one frame at the current fx time (camera inertia and the sun follow the fx clock). */
  render(): void {
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
    this.chunkTerrain?.update(p);
    this.renderer.render(this.scene, c);
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
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const info = this.renderer.info;
    // The world and look textures, plus the match's two: the 1024x512 RGBA8 ownership texture (2 MB) and the 256x1 owner palette.
    const palette = (this.material.uniforms.uOwnerPalette as { value: { image: unknown } }).value;
    const bytes = allTextureBytes(this.textures, this.look) + rgbaTextureBytes(this.ownership.texture) + rgbaTextureBytes(palette);
    return {
      renderer: (ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '') || String(gl.getParameter(gl.RENDERER)),
      vendor: (ext ? String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)) : '') || String(gl.getParameter(gl.VENDOR)),
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
