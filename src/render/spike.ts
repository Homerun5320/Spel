// M00 WebGL spike: one sphere, one hand-written GLSL ShaderMaterial (a sun), one small
// DataTexture from a seeded PRNG. Everything here is a throwaway proof that headless WebGL2
// rendering works; real terrain comes in later milestones.
import {
  DataTexture,
  LinearFilter,
  Mesh,
  PerspectiveCamera,
  RGBAFormat,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  UnsignedByteType,
  Vector3,
  WebGLRenderer,
} from 'three';

/** Fixed test-view sun position: lon -40 deg, lat 20 deg (see docs/DECISIONS.md). */
export const TEST_SUN_LON_DEG = -40;
export const TEST_SUN_LAT_DEG = 20;
/** Camera distance from the origin; the vertical fov is derived so the globe diameter = image height. */
export const CAMERA_DISTANCE = 4;
export const NOISE_WIDTH = 64;
export const NOISE_HEIGHT = 32;

/** Unit vector pointing from the globe centre to the sun for a given lon/lat (degrees). +z faces the camera. */
export function sunDirection(lonDeg: number, latDeg: number): [number, number, number] {
  const lon = (lonDeg * Math.PI) / 180;
  const lat = (latDeg * Math.PI) / 180;
  return [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)];
}

/** Vertical field of view in degrees at which a unit sphere at CAMERA_DISTANCE spans the full image height. */
export function fitFovDeg(distance: number = CAMERA_DISTANCE): number {
  return (2 * Math.asin(1 / distance) * 180) / Math.PI;
}

/** sfc32 PRNG; returns floats in [0, 1). Deterministic for a given seed. */
export function makePrng(seed: number): () => number {
  let a = 0x9e3779b9 | 0;
  let b = 0x243f6a88 | 0;
  let c = 0xb7e15162 | 0;
  let d = seed | 0;
  const next = (): number => {
    a |= 0;
    b |= 0;
    c |= 0;
    d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 12; i++) next();
  return next;
}

/** RGBA8 noise field (smoothed so LinearFilter gives continent-like blobs). Deterministic per seed. */
export function makeNoiseData(seed: number, width = NOISE_WIDTH, height = NOISE_HEIGHT): Uint8Array {
  const rnd = makePrng(seed);
  const raw = new Float32Array(width * height);
  for (let i = 0; i < raw.length; i++) raw[i] = rnd();
  // Two box-blur passes with wrap-around on x give low-frequency structure.
  let src = raw;
  for (let pass = 0; pass < 2; pass++) {
    const dst = new Float32Array(src.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= height) continue;
          for (let dx = -1; dx <= 1; dx++) {
            sum += src[yy * width + ((x + dx + width) % width)] ?? 0;
            n++;
          }
        }
        dst[y * width + x] = sum / n;
      }
    }
    src = dst;
  }
  // Stretch to [0, 1] so the land/ocean threshold in the shader is meaningful.
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of src) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < src.length; i++) {
    const v = Math.round((((src[i] ?? 0) - lo) / (hi - lo || 1)) * 255);
    out[i * 4] = v;
    out[i * 4 + 1] = v;
    out[i * 4 + 2] = v;
    out[i * 4 + 3] = 255;
  }
  return out;
}

const VERTEX_SHADER = /* glsl */ `
varying vec3 vNormal;
varying vec3 vWorld;
varying vec2 vUv;
void main() {
  vUv = uv;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

// three r186: write to gl_FragColor; never declare your own `out vec4`.
const FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D uNoise;
uniform vec3 uSun;
varying vec3 vNormal;
varying vec3 vWorld;
varying vec2 vUv;
void main() {
  vec3 n = normalize(vNormal);
  vec3 sun = normalize(uSun);
  float h = texture2D(uNoise, vUv * vec2(2.0, 1.0)).r;
  float land = smoothstep(0.46, 0.54, h);
  vec3 ocean = vec3(0.04, 0.16, 0.42);
  vec3 grass = vec3(0.20, 0.46, 0.18);
  vec3 rock = vec3(0.52, 0.44, 0.32);
  vec3 albedo = mix(ocean, mix(grass, rock, smoothstep(0.62, 0.85, h)), land);
  float ndl = dot(n, sun);
  float diffuse = clamp(ndl, 0.0, 1.0);
  vec3 col = albedo * (vec3(0.012, 0.018, 0.04) + diffuse * vec3(1.0, 0.95, 0.85));
  vec3 v = normalize(cameraPosition - vWorld);
  vec3 hv = normalize(sun + v);
  col += vec3(1.0, 0.95, 0.85) * pow(max(dot(n, hv), 0.0), 48.0) * (1.0 - land) * step(0.0, ndl) * 0.5;
  float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  col += vec3(0.20, 0.40, 0.90) * rim * (0.10 + 0.90 * clamp(ndl + 0.2, 0.0, 1.0)) * 0.6;
  col = pow(col, vec3(1.0 / 2.2));
  gl_FragColor = vec4(col, 1.0);
}
`;

export interface SpikeOptions {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  dpr: number;
  antialias: boolean;
  preserveDrawingBuffer: boolean;
  seed: number;
  /** Debug: render a deliberately empty (cleared) canvas. Used by the negative e2e test. */
  blank?: boolean;
}

export interface SpikeInfo {
  renderer: string;
  vendor: string;
  glVersion: string;
  webgl2: boolean;
  drawCalls: number;
  triangles: number;
  textures: number;
  geometries: number;
  width: number;
  height: number;
  dpr: number;
}

export interface Spike {
  /** Render one frame. sunLonDeg/sunLatDeg place the sun; defaults to the fixed test-view sun. */
  render(sunLonDeg?: number, sunLatDeg?: number): void;
  resize(width: number, height: number, dpr: number): void;
  info(): SpikeInfo;
  dispose(): void;
}

export function createSpike(opts: SpikeOptions): Spike {
  const renderer = new WebGLRenderer({
    canvas: opts.canvas,
    antialias: opts.antialias,
    preserveDrawingBuffer: opts.preserveDrawingBuffer,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(opts.dpr);
  renderer.setSize(opts.width, opts.height, false);
  renderer.setClearColor(0x000000, 1);

  const scene = new Scene();
  const camera = new PerspectiveCamera(fitFovDeg(), opts.width / opts.height, 0.1, 100);
  camera.position.set(0, 0, CAMERA_DISTANCE);
  camera.lookAt(0, 0, 0);

  const noise = new DataTexture(makeNoiseData(opts.seed), NOISE_WIDTH, NOISE_HEIGHT, RGBAFormat, UnsignedByteType);
  noise.wrapS = RepeatWrapping;
  noise.wrapT = RepeatWrapping;
  noise.magFilter = LinearFilter;
  noise.minFilter = LinearFilter;
  noise.needsUpdate = true;

  const sunUniform = new Vector3(...sunDirection(TEST_SUN_LON_DEG, TEST_SUN_LAT_DEG));
  const material = new ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms: { uNoise: { value: noise }, uSun: { value: sunUniform } },
  });
  const geometry = new SphereGeometry(1, 96, 48);
  const globe = new Mesh(geometry, material);
  globe.visible = !opts.blank;
  scene.add(globe);

  let width = opts.width;
  let height = opts.height;
  let dpr = opts.dpr;

  return {
    render(sunLonDeg = TEST_SUN_LON_DEG, sunLatDeg = TEST_SUN_LAT_DEG): void {
      sunUniform.set(...sunDirection(sunLonDeg, sunLatDeg));
      renderer.render(scene, camera);
    },
    resize(w: number, h: number, ratio: number): void {
      width = w;
      height = h;
      dpr = ratio;
      renderer.setPixelRatio(ratio);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },
    info(): SpikeInfo {
      const gl = renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const unmaskedRenderer = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
      const unmaskedVendor = ext ? String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)) : '';
      return {
        renderer: unmaskedRenderer || String(gl.getParameter(gl.RENDERER)),
        vendor: unmaskedVendor || String(gl.getParameter(gl.VENDOR)),
        glVersion: String(gl.getParameter(gl.VERSION)),
        webgl2: typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext,
        drawCalls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        textures: renderer.info.memory.textures,
        geometries: renderer.info.memory.geometries,
        width,
        height,
        dpr,
      };
    },
    dispose(): void {
      geometry.dispose();
      material.dispose();
      noise.dispose();
      renderer.dispose();
    },
  };
}
