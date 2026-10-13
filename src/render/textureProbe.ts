// Texel readback: a small render-to-target pass that fetches single texels of a data texture with texelFetch and
// writes them to an RGBA8 target, so a test can compare what the GPU holds with the source bytes.
import {
  Mesh,
  NearestFilter,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  WebGLRenderTarget,
  type Texture,
  type WebGLRenderer,
} from 'three';

const BATCH = 64;

const VERTEX = /* glsl */ `
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const FRAGMENT = /* glsl */ `
uniform sampler2D uTex;
uniform vec2 uPts[${BATCH}];
void main() {
  int i = int(gl_FragCoord.x);
  ivec2 p = ivec2(uPts[i]);
  gl_FragColor = vec4(texelFetch(uTex, p, 0).r, 0.0, 0.0, 1.0);
}
`;

/** Returns the red byte of each texel `[x, y]` (row 0 = first uploaded row) as the GPU holds it. */
export function readTexels(renderer: WebGLRenderer, texture: Texture, points: ReadonlyArray<readonly [number, number]>): Uint8Array {
  const out = new Uint8Array(points.length);
  const pts = Array.from({ length: BATCH }, () => new Vector2());
  const material = new ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FRAGMENT, uniforms: { uTex: { value: texture }, uPts: { value: pts } }, depthTest: false, depthWrite: false });
  const geometry = new PlaneGeometry(2, 2);
  const scene = new Scene();
  scene.add(new Mesh(geometry, material));
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const target = new WebGLRenderTarget(BATCH, 1, { type: UnsignedByteType, format: RGBAFormat, minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: false });
  const buffer = new Uint8Array(BATCH * 4);
  const previous = renderer.getRenderTarget();
  try {
    for (let start = 0; start < points.length; start += BATCH) {
      const n = Math.min(BATCH, points.length - start);
      for (let i = 0; i < BATCH; i++) {
        const p = points[start + (i < n ? i : 0)] as readonly [number, number];
        (pts[i] as Vector2).set(p[0], p[1]);
      }
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.readRenderTargetPixels(target, 0, 0, BATCH, 1, buffer);
      for (let i = 0; i < n; i++) out[start + i] = buffer[i * 4] as number;
    }
  } finally {
    renderer.setRenderTarget(previous);
    target.dispose();
    geometry.dispose();
    material.dispose();
  }
  return out;
}
