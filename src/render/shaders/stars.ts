// Stars: seeded points on the celestial sphere. The vertex shader pins them at infinity (translation of the camera is
// ignored, depth at the far plane), the point size is in pixels. Drawn first; the globe and the glow cover them.

export const starsVertexShader = /* glsl */ `
attribute float aSize;
attribute vec3 aColor;
varying vec3 vColor;
uniform float uPixelRatio;

void main() {
  vColor = aColor;
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = p.xyww;
  gl_PointSize = aSize * uPixelRatio;
}
`;

export const starsFragmentShader = /* glsl */ `
varying vec3 vColor;

void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r = dot(q, q);
  float a = smoothstep(1.0, 0.15, r);
  gl_FragColor = vec4(vColor * a, 1.0);
}
`;
