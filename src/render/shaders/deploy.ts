// The shaders of the deploy layer (M13b): the route line and the landing-zone marker. Like every layer that sits on the terrain, positions arrive as a
// two-part float32 pair (hi + lo, Earth radii) and are made camera-relative in the shader (docs/ARCHITECTURE.md "Rules for layers", (1)); nothing is
// rewritten per frame except uniforms.

/** The route: a line strip of vertices (hi in `position`, lo in `aLo`) with an exposure value per vertex (0 hidden .. 1 seen). */
export const routeVertexShader = /* glsl */ `
uniform vec3 uCamHi;
uniform vec3 uCamLo;
attribute vec3 aLo;
attribute float aExp;
varying float vExp;
void main() {
  vec3 rel = (position - uCamHi) + (aLo - uCamLo);
  vExp = aExp;
  gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * rel, 1.0);
}
`;

export const routeFragmentShader = /* glsl */ `
uniform vec3 uCool;
uniform vec3 uHot;
uniform float uAlpha;
varying float vExp;
void main() {
  gl_FragColor = vec4(mix(uCool, uHot, clamp(vExp, 0.0, 1.0)), uAlpha);
}
`;

/** The marker: a ring and a pole in a unit model (x east, y up, z north), scaled to the larger of a share of the camera distance and a minimum in metres. */
export const markerVertexShader = /* glsl */ `
uniform vec3 uCamHi;
uniform vec3 uCamLo;
uniform vec3 uCenterHi;
uniform vec3 uCenterLo;
uniform float uKmPerUnit;
uniform float uPxK;
uniform float uMinM;
void main() {
  vec3 centre = uCenterHi + uCenterLo;
  vec3 up = normalize(centre);
  vec3 east = cross(vec3(0.0, 1.0, 0.0), up);
  float el = length(east);
  east = el > 1e-4 ? east / el : vec3(1.0, 0.0, 0.0);
  vec3 north = cross(up, east);
  vec3 rel0 = (uCenterHi - uCamHi) + (uCenterLo - uCamLo);
  float distM = length(rel0) * uKmPerUnit * 1000.0;
  float radius = max(uMinM, distM * uPxK) / (uKmPerUnit * 1000.0);
  vec3 rel = rel0 + (east * position.x + up * position.y + north * position.z) * radius;
  gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * rel, 1.0);
}
`;

export const markerFragmentShader = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
void main() {
  gl_FragColor = vec4(uColor, uAlpha);
}
`;
