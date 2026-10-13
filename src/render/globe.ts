// The stylised Earth: renderer, scene, globe mesh with the terrain ShaderMaterial, camera rig, picking and projection.
// This is the only module (besides the M00 spike and textureProbe) that talks to WebGL.
import { BufferAttribute, BufferGeometry, Color, Mesh, PerspectiveCamera, Points, Scene, type ShaderMaterial, SphereGeometry, type Vector3, WebGLRenderer } from 'three';
import { type City, decodeDepth, decodeLandHeight, type RenderPack, type SimGrid, type WorldMeta } from '../data';
import { CameraRig, type ViewState } from './camera';
import { ATMOSPHERE_TOP, HEIGHT_EXAGGERATION, OCEAN_WAVE_SPEED } from './config';
import { fxNow } from './clock';
import { latLonToCell, sunDirectionAt, type Vec3 } from './geo';
import { buildGlobeGeometry } from './globeMesh';
import { HeightField } from './heightField';
import { meshTriangles, type QualitySettings } from './quality';
import { buildStars } from './stars';
import { createTerrainMaterial } from './terrainMaterial';
import { readTexels } from './textureProbe';
import {
  allTextureBytes,
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
}

export interface GlobePick {
  lat: number;
  lon: number;
  /** Terrain height in metres at the hit (0 at sea). */
  heightM: number;
  /** Land height in metres, or minus the sea depth. */
  elevationM: number;
  cell: { x: number; y: number; index: number };
  /** TerrainClass value of the sim cell. */
  classId: number;
  /** Country id of the sim cell (0 = none). */
  countryId: number;
}

export interface ScreenHit {
  x: number;
  y: number;
  inView: boolean;
  facing: boolean;
}

export class Globe {
  readonly rig: CameraRig;
  readonly field: HeightField;
  readonly quality: QualitySettings;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly material: ShaderMaterial;
  private readonly mesh: Mesh;
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
    const tm = createTerrainMaterial(this.textures, o.world.render, o.world.sim, o.world.meta, this.look);
    this.material = tm.material;
    this.sun = tm.sun;
    this.mesh = new Mesh(buildGlobeGeometry(o.quality.meshCols, o.quality.meshRows), this.material);
    this.mesh.frustumCulled = false;
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
  }

  setView(v: Partial<ViewState>): void {
    this.rig.setView(v);
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
    this.rig.update(now);
    const sun = sunDirectionAt(now);
    this.sun.set(sun[0], sun[1], sun[2]);
    (this.material.uniforms.uTime as { value: number }).value = now * OCEAN_WAVE_SPEED;
    const p = this.rig.pose();
    const c = this.camera;
    c.position.set(p.position[0], p.position[1], p.position[2]);
    c.up.set(p.up[0], p.up[1], p.up[2]);
    c.near = p.near;
    c.far = p.far;
    c.fov = p.fovDeg;
    c.aspect = p.aspect;
    c.updateProjectionMatrix();
    c.lookAt(p.target[0], p.target[1], p.target[2]);
    c.updateMatrixWorld();
    this.renderer.render(this.scene, c);
  }

  /** Surface pick under a pixel: ray against the displaced heights, then the sim cell, class and country. */
  pick(px: number, py: number): GlobePick | null {
    const ray = this.rig.rayAt(px, py);
    const hit = this.field.pick(ray.origin, ray.dir);
    if (!hit) return null;
    return this.describe(hit.lat, hit.lon, hit.heightM);
  }

  /** Cell, class, country and elevation of a position. */
  describe(lat: number, lon: number, heightM: number = this.field.heightM(lat, lon)): GlobePick {
    const cell = latLonToCell(lat, lon);
    const { sim, render } = this.world;
    let elevationM: number;
    if (heightM <= 0) {
      // Sea: depth from the half resolution bathymetry raster.
      const bx = Math.min(render.bathyWidth - 1, Math.max(0, Math.floor(((lon + 180) / 360) * render.bathyWidth)));
      const by = Math.min(render.bathyHeight - 1, Math.max(0, Math.floor(((90 - lat) / 180) * render.bathyHeight)));
      const code = render.bathy8[by * render.bathyWidth + bx] as number;
      elevationM = code === 0 ? 0 : -decodeDepth(code);
    } else {
      // Use the nearest raster pixel (not the filtered value) for what the tooltip shows.
      const px = Math.min(render.width - 1, Math.max(0, Math.floor(((lon + 180) / 360) * render.width)));
      const py = Math.min(render.height - 1, Math.max(0, Math.floor(((90 - lat) / 180) * render.height)));
      const code = render.height8[py * render.width + px] as number;
      elevationM = code === 0 ? heightM : decodeLandHeight(code);
    }
    return {
      lat,
      lon,
      heightM,
      elevationM,
      cell,
      classId: sim.terrainClass[cell.index] as number,
      countryId: sim.country[cell.index] as number,
    };
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

  info(): GlobeInfo {
    const gl = this.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const info = this.renderer.info;
    const bytes = allTextureBytes(this.textures, this.look);
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
    };
  }

  /** Triangles of the globe mesh alone (also what renderer.info reports for the globe scene in A). */
  get meshTriangleCount(): number {
    return meshTriangles(this.quality);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.shell.geometry.dispose();
    (this.shell.material as ShaderMaterial).dispose();
    this.stars.geometry.dispose();
    this.starsMaterial.dispose();
    disposeWorldTextures(this.textures);
    disposeLookTextures(this.look);
    this.renderer.dispose();
    this.renderer.forceContextLoss(); // free the GL context: the app restarts the scene on hashchange
  }
}
