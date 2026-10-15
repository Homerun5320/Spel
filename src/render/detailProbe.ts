// The readback probe of the terrain detail (M07b, a debug hook behind `__test.probeHash` and `__test.probeHeight`): runs the SAME GLSL
// functions as the chunk vertex shader (`src/render/shaders/detail.ts`) for given inputs in a small render-to-target pass and reads the
// results back, so a test can compare what the GPU computes with `src/render/detail.ts`.
//
// Results come back bit-exact in one of two encodings, chosen by the renderer's capabilities (the test can force either):
//   'float': an RGBA32F target when the EXT_color_buffer_float extension exists; a height is the red channel, a hash is two channels of
//            16 bits each (red = low half, green = high half; every integer below 2^24 is exact in a float32).
//   'bytes': an RGBA8 target otherwise; the 32 bits of the result (a hash, or `floatBitsToUint` of a height) are written as four bytes.
// Inputs travel in RGBA32F data textures read with texelFetch (no uniform array limit): a hash input is two texels (ix, iy, iz / the two
// 16-bit halves of the seed), a height input is two texels (latitude, longitude in degrees and octaves; the unit direction of the point). The
// direction is computed on the CPU in double precision and passed as float32: the GLSL sin and cos are only specified to 2^-11 and the noise
// multiplies a direction error by 326 x 2^k lattice cells, so a direction made on the GPU would test the driver's trigonometry, not our maths.
import {
  DataTexture,
  FloatType,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { POLE_HEIGHT_U, latLonToVec } from './geo';
import { GLSL_TEXELS } from './shaders/common';
import { GLSL_DETAIL } from './shaders/detail';

export type ProbeEncoding = 'float' | 'bytes';

const WIDTH = 256;

/** The encoding this renderer supports: float when EXT_color_buffer_float exists. */
export function probeEncoding(renderer: WebGLRenderer): ProbeEncoding {
  return renderer.extensions.has('EXT_color_buffer_float') ? 'float' : 'bytes';
}

const VERTEX = /* glsl */ `
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

/** Writes `bits` (a uint) to the target in the chosen encoding. */
function writeBits(enc: ProbeEncoding): string {
  return enc === 'float'
    ? 'gl_FragColor = vec4(float(bits & 0xffffu), float(bits >> 16u), 0.0, 1.0);'
    : 'gl_FragColor = vec4(float(bits & 255u), float((bits >> 8u) & 255u), float((bits >> 16u) & 255u), float(bits >> 24u)) / 255.0;';
}

const HASH_FRAGMENT = (enc: ProbeEncoding): string => /* glsl */ `
uniform sampler2D uHeight;
uniform ivec2 uHeightSize;
uniform float uHeightMaxM;
uniform sampler2D uIn;
${GLSL_TEXELS}
${GLSL_DETAIL}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 a = texelFetch(uIn, ivec2(p.x, 2 * p.y), 0);
  vec4 b = texelFetch(uIn, ivec2(p.x, 2 * p.y + 1), 0);
  uint seed = uint(b.x) | (uint(b.y) << 16u);
  uint bits = detHash3(int(a.x), int(a.y), int(a.z), seed);
  ${writeBits(enc)}
}
`;

const NOISE_FRAGMENT = (enc: ProbeEncoding): string => /* glsl */ `
uniform sampler2D uHeight;
uniform ivec2 uHeightSize;
uniform float uHeightMaxM;
uniform sampler2D uIn;
${GLSL_TEXELS}
${GLSL_DETAIL}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 a = texelFetch(uIn, ivec2(p.x, 2 * p.y), 0); // a point of the noise lattice space
  vec4 b = texelFetch(uIn, ivec2(p.x, 2 * p.y + 1), 0); // the two 16-bit halves of the seed, then 1 for the ridge value (else the plain noise)
  uint seed = uint(b.x) | (uint(b.y) << 16u);
  float n = detNoise(a.xyz, seed);
  float h = b.z > 0.5 ? 1.0 - abs(2.0 * n - 1.0) : n;
  ${enc === 'float' ? 'gl_FragColor = vec4(h, 0.0, 0.0, 1.0);' : `uint bits = floatBitsToUint(h);\n  ${writeBits(enc)}`}
}
`;

/** `quantity` 'height': the vertex height; 'relief': the local relief of the sample in metres (the 3x3 rule, the floor and the polar fade of `detSample`). */
const HEIGHT_FRAGMENT = (enc: ProbeEncoding, quantity: 'height' | 'relief' = 'height'): string => /* glsl */ `
uniform sampler2D uHeight;
uniform ivec2 uHeightSize;
uniform float uHeightMaxM;
uniform sampler2D uIn;
${GLSL_TEXELS}
${GLSL_DETAIL}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 a = texelFetch(uIn, ivec2(p.x, 2 * p.y), 0); // latitude, longitude (degrees), octaves
  vec4 b = texelFetch(uIn, ivec2(p.x, 2 * p.y + 1), 0); // the unit direction
  float v = (90.0 - a.x) / 180.0;
  float u = (v <= 0.0 || v >= 1.0) ? ${POLE_HEIGHT_U.toFixed(1)} : (a.y + 180.0) / 360.0;
  DetSample s = detSample(vec2(u, v), ${quantity === 'relief' ? 'true' : 'a.z > 0.0'});
  float h = ${quantity === 'relief' ? 's.land > 0.5 ? s.relief : -1.0' : 'detHeight(s, detRotate(b.xyz), a.z)'};
  ${enc === 'float' ? 'gl_FragColor = vec4(h, 0.0, 0.0, 1.0);' : `uint bits = floatBitsToUint(h);\n  ${writeBits(enc)}`}
}
`;

const VERTEX_FRAGMENT = (enc: ProbeEncoding): string => /* glsl */ `
uniform sampler2D uHeight;
uniform ivec2 uHeightSize;
uniform float uHeightMaxM;
uniform sampler2D uIn;
uniform vec3 uDetailLod;
uniform float uExagPerM;
${GLSL_TEXELS}
${GLSL_DETAIL}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 a = texelFetch(uIn, ivec2(p.x, 3 * p.y), 0); // latitude, longitude (degrees), chunk level
  vec4 b = texelFetch(uIn, ivec2(p.x, 3 * p.y + 1), 0); // camera position (Earth radii)
  vec4 c = texelFetch(uIn, ivec2(p.x, 3 * p.y + 2), 0); // the unit direction of the vertex
  float v = (90.0 - a.x) / 180.0;
  float u = (v <= 0.0 || v >= 1.0) ? ${POLE_HEIGHT_U.toFixed(1)} : (a.y + 180.0) / 360.0;
  float h = detVertexHeight(vec2(u, v), c.xyz, c.xyz - b.xyz, a.z, uDetailLod, uExagPerM);
  ${enc === 'float' ? 'gl_FragColor = vec4(h, 0.0, 0.0, 1.0);' : `uint bits = floatBitsToUint(h);\n  ${writeBits(enc)}`}
}
`;

interface Run {
  encoding: ProbeEncoding;
  /** The input texture (RGBA32F). */
  input: DataTexture;
  rows: number;
  fragment: string;
  heights?: { texture: Texture; size: [number, number]; maxM: number };
  /** The vertex probe's law of detail and exaggeration over the Earth radius in metres. */
  vertex?: { lod: readonly [number, number, number]; exagPerM: number };
}

/** Renders the probe pass over `rows` rows of 256 pixels and returns the raw pixels (Float32Array for 'float', Uint8Array for 'bytes'). */
function runPass(renderer: WebGLRenderer, r: Run): Float32Array | Uint8Array {
  const material = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: r.fragment,
    uniforms: {
      uIn: { value: r.input },
      uHeight: { value: r.heights?.texture ?? null },
      uHeightSize: { value: new Vector2(r.heights?.size[0] ?? 1, r.heights?.size[1] ?? 1) },
      uHeightMaxM: { value: r.heights?.maxM ?? 1 },
      uDetailLod: { value: new Vector3(...(r.vertex?.lod ?? [0, 0, 0])) },
      uExagPerM: { value: r.vertex?.exagPerM ?? 0 },
    },
    depthTest: false,
    depthWrite: false,
  });
  const geometry = new PlaneGeometry(2, 2);
  const scene = new Scene();
  scene.add(new Mesh(geometry, material));
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const float = r.encoding === 'float';
  const target = new WebGLRenderTarget(WIDTH, r.rows, { type: float ? FloatType : UnsignedByteType, format: RGBAFormat, minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: false });
  const out = float ? new Float32Array(WIDTH * r.rows * 4) : new Uint8Array(WIDTH * r.rows * 4);
  const previous = renderer.getRenderTarget();
  try {
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, WIDTH, r.rows, out);
  } finally {
    renderer.setRenderTarget(previous);
    target.dispose();
    geometry.dispose();
    material.dispose();
    r.input.dispose();
  }
  return out;
}

function inputTexture(data: Float32Array, rows: number): DataTexture {
  const t = new DataTexture(data, WIDTH, rows, RGBAFormat, FloatType);
  t.minFilter = NearestFilter;
  t.magFilter = NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

/** The hash `detHash3(ix, iy, iz, seed)` of each item, computed by the GLSL function (ix, iy, iz are lattice coordinates below 2^24 after the shift). */
export function probeHashes(renderer: WebGLRenderer, items: ReadonlyArray<readonly [number, number, number, number]>, encoding: ProbeEncoding = probeEncoding(renderer)): Uint32Array {
  const rows = Math.max(1, Math.ceil(items.length / WIDTH));
  const data = new Float32Array(WIDTH * rows * 2 * 4);
  items.forEach((it, i) => {
    const x = i % WIDTH;
    const y = Math.floor(i / WIDTH);
    const a = (2 * y * WIDTH + x) * 4;
    const b = ((2 * y + 1) * WIDTH + x) * 4;
    data[a] = it[0];
    data[a + 1] = it[1];
    data[a + 2] = it[2];
    data[b] = it[3] & 0xffff;
    data[b + 1] = it[3] >>> 16;
  });
  const px = runPass(renderer, { encoding, input: inputTexture(data, rows * 2), rows, fragment: HASH_FRAGMENT(encoding) });
  const out = new Uint32Array(items.length);
  for (let i = 0; i < items.length; i++) {
    const o = i * 4;
    out[i] = encoding === 'float' ? ((px[o] as number) | ((px[o + 1] as number) << 16)) >>> 0 : (((px[o] as number) | ((px[o + 1] as number) << 8) | ((px[o + 2] as number) << 16) | ((px[o + 3] as number) << 24)) >>> 0);
  }
  return out;
}

/**
 * The height (render metres, before the exaggeration) of the GLSL function for each point (latitude, longitude in degrees, octaves),
 * read from the very texture the terrain uploads. Latitude and longitude are float32 on the GPU: the caller compares against `heightAt`
 * evaluated at the same `Math.fround` values. With `quantity` 'relief' the result is the GLSL local relief in metres instead (-1 on sea): the
 * rule "max minus min of the 3x3 texels, floor 100 m, bilinear, polar fade" read back, not only its effect on a height.
 */
export function probeHeights(
  renderer: WebGLRenderer,
  height: { texture: Texture; width: number; height: number; maxM: number },
  points: ReadonlyArray<readonly [number, number, number]>,
  encoding: ProbeEncoding = probeEncoding(renderer),
  quantity: 'height' | 'relief' = 'height',
): Float32Array {
  const rows = Math.max(1, Math.ceil(points.length / WIDTH));
  const data = new Float32Array(WIDTH * rows * 2 * 4);
  points.forEach((p, i) => {
    const x = i % WIDTH;
    const y = Math.floor(i / WIDTH);
    const a = (2 * y * WIDTH + x) * 4;
    const d = latLonToVec(p[0], p[1]);
    data[a] = p[0];
    data[a + 1] = p[1];
    data[a + 2] = p[2];
    data[a + WIDTH * 4] = d[0];
    data[a + WIDTH * 4 + 1] = d[1];
    data[a + WIDTH * 4 + 2] = d[2];
  });
  const px = runPass(renderer, {
    encoding,
    input: inputTexture(data, rows * 2),
    rows,
    fragment: HEIGHT_FRAGMENT(encoding, quantity),
    heights: { texture: height.texture, size: [height.width, height.height], maxM: height.maxM },
  });
  return decodeFloats(px, points.length, encoding);
}

/**
 * The height (render metres) the chunk vertex shader draws at a vertex: `points` are [latitude, longitude, chunk level, camera x, y, z (Earth
 * radii)], `lod` is the material's `uDetailLod` (offset of the distance law, level bias, detail on) and `exaggeration` the height exaggeration.
 * Mirror: `HeightSampler.heightSeenM` with `octavesForLevel(level, cells)`.
 */
export function probeVertexHeights(
  renderer: WebGLRenderer,
  height: { texture: Texture; width: number; height: number; maxM: number },
  points: ReadonlyArray<readonly [number, number, number, number, number, number]>,
  lod: readonly [number, number, number],
  exaggeration: number,
  earthRadiusM: number,
  encoding: ProbeEncoding = probeEncoding(renderer),
): Float32Array {
  const rows = Math.max(1, Math.ceil(points.length / WIDTH));
  const data = new Float32Array(WIDTH * rows * 3 * 4);
  points.forEach((p, i) => {
    const x = i % WIDTH;
    const y = Math.floor(i / WIDTH);
    const a = (3 * y * WIDTH + x) * 4;
    const b = ((3 * y + 1) * WIDTH + x) * 4;
    const c = ((3 * y + 2) * WIDTH + x) * 4;
    const d = latLonToVec(p[0], p[1]);
    data[a] = p[0];
    data[a + 1] = p[1];
    data[a + 2] = p[2];
    data[b] = p[3];
    data[b + 1] = p[4];
    data[b + 2] = p[5];
    data[c] = d[0];
    data[c + 1] = d[1];
    data[c + 2] = d[2];
  });
  const px = runPass(renderer, {
    encoding,
    input: inputTexture(data, rows * 3),
    rows,
    fragment: VERTEX_FRAGMENT(encoding),
    heights: { texture: height.texture, size: [height.width, height.height], maxM: height.maxM },
    vertex: { lod, exagPerM: exaggeration / earthRadiusM },
  });
  return decodeFloats(px, points.length, encoding);
}

function decodeFloats(px: Float32Array | Uint8Array, n: number, encoding: ProbeEncoding): Float32Array {
  const out = new Float32Array(n);
  if (encoding === 'float') {
    for (let i = 0; i < n; i++) out[i] = px[i * 4] as number;
  } else {
    const bits = new Uint32Array(1);
    const asFloat = new Float32Array(bits.buffer);
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      bits[0] = ((px[o] as number) | ((px[o + 1] as number) << 8) | ((px[o + 2] as number) << 16) | ((px[o + 3] as number) << 24)) >>> 0;
      out[i] = asFloat[0] as number;
    }
  }
  return out;
}

/** The 3D value noise (or, with `ridge`, the ridge 1 - |2 n - 1|) of the GLSL function at each [x, y, z, seed] (x, y, z are float32 on the GPU). */
export function probeNoise(
  renderer: WebGLRenderer,
  items: ReadonlyArray<readonly [number, number, number, number]>,
  ridge = false,
  encoding: ProbeEncoding = probeEncoding(renderer),
): Float32Array {
  const rows = Math.max(1, Math.ceil(items.length / WIDTH));
  const data = new Float32Array(WIDTH * rows * 2 * 4);
  items.forEach((it, i) => {
    const x = i % WIDTH;
    const y = Math.floor(i / WIDTH);
    const a = (2 * y * WIDTH + x) * 4;
    const b = ((2 * y + 1) * WIDTH + x) * 4;
    data[a] = it[0];
    data[a + 1] = it[1];
    data[a + 2] = it[2];
    data[b] = it[3] & 0xffff;
    data[b + 1] = it[3] >>> 16;
    data[b + 2] = ridge ? 1 : 0;
  });
  const px = runPass(renderer, { encoding, input: inputTexture(data, rows * 2), rows, fragment: NOISE_FRAGMENT(encoding) });
  return decodeFloats(px, items.length, encoding);
}
