// The vertex shader of the district layer (Districts-2b). One instance = one district on one slot of a City. All four models share one geometry;
// `aKind` (per vertex) says which kind a vertex belongs to and an instance collapses the vertices of the other three (a clip-space point outside the
// view, so the rasteriser drops the triangle). The fragment shader is the structure layer's (night readability, the construction look, owner tint).
//
// PLACEMENT. The instance position is the CITY's centre (`aHi` + `aLo`, camera-relative like every layer); `aSlot.xyz` is the district's offset in
// the City's model space (units of `uSizeM` x the City's level scale, y = the ground difference between the slot and the City's cell), `aSlot.w`
// the angle the model faces. The offset is turned with the City's own yaw, so the districts follow the City. A district is drawn at TRUE size
// (no scale policy): it fades out between `uFadeLo` and `uFadeHi` projected pixels of radius (it shrinks to nothing, opaque: no blending).
export const districtVertexShader = /* glsl */ `
uniform vec3 uCamHi;
uniform vec3 uCamLo;
uniform float uSizeM;      // the City's metres per model unit
uniform float uModelUnit;  // a district's radius in City model units
uniform float uKmPerUnit;
uniform float uTime;
uniform float uTick;
uniform float uPopSeconds;
uniform float uBuildMin;
uniform float uViewH;
uniform float uFadeLo;
uniform float uFadeHi;
uniform vec3 uClose;       // Look-1: the City's close-range enlargement (see shaders/structures.ts), so the districts stay in proportion

attribute vec3 aColor;
attribute float aTint;
attribute float aKind;
attribute vec3 aHi;
attribute vec3 aLo;
attribute vec4 aParams;    // x: the City's level scale, y: the City's yaw, z: fx time of appearing, w: the district kind
attribute vec4 aSlot;      // xyz: offset in City model units (before the yaw), w: the angle the model faces
attribute vec3 aBuild;     // buildTick, readyTick, the district's level scale

varying vec3 vRel;
varying vec3 vColor;
varying vec3 vOwner;
varying float vTint;
varying float vUp;
varying float vProgress;
varying vec3 vUpDir;
varying float vLight;

attribute vec3 aOwner;

float easeOutBack(float x) {
  float c1 = 1.70158;
  float c3 = c1 + 1.0;
  float u = x - 1.0;
  return 1.0 + c3 * u * u * u + c1 * u * u;
}

void main() {
  vec3 centre = aHi + aLo;
  vec3 up = normalize(centre);
  vec3 east = cross(vec3(0.0, 1.0, 0.0), up);
  float el = length(east);
  east = el > 1e-4 ? east / el : vec3(1.0, 0.0, 0.0);
  vec3 north = cross(up, east);
  vec3 rel0 = (aHi - uCamHi) + (aLo - uCamLo);
  float distM = length(rel0) * uKmPerUnit * 1000.0;
  float unitM = uSizeM * aParams.x * mix(uClose.x, 1.0, smoothstep(uClose.y, uClose.z, distM));
  float pxPerRad = uViewH * 0.5 * projectionMatrix[1][1];
  float px = uModelUnit * aBuild.z * unitM / distM * pxPerRad;
  float t = clamp((px - uFadeLo) / (uFadeHi - uFadeLo), 0.0, 1.0);
  float fade = t * t * (3.0 - 2.0 * t);
  float mine = step(abs(aKind - aParams.w), 0.5);
  float age = uTime - aParams.z;
  float pop = age < 0.0 ? 1.0 : clamp(age / uPopSeconds, 0.0, 1.0);
  float popScale = pop >= 1.0 ? 1.0 : max(easeOutBack(pop), 0.0);
  float span = max(aBuild.y - aBuild.x, 1.0);
  float progress = clamp((uTick - aBuild.x) / span, 0.0, 1.0);
  float hs = mix(uBuildMin, 1.0, progress);
  float ca = cos(aSlot.w);
  float sa = sin(aSlot.w);
  vec3 p = position * (uModelUnit * aBuild.z);
  p = vec3(p.x * ca - p.z * sa, p.y * hs, p.x * sa + p.z * ca) * (popScale * fade);
  vec3 q = p + aSlot.xyz;
  float cy = cos(aParams.y);
  float sy = sin(aParams.y);
  vec3 local = vec3(q.x * cy - q.z * sy, q.y, q.x * sy + q.z * cy) * (unitM / (uKmPerUnit * 1000.0));
  vec3 rel = rel0 + east * local.x + up * local.y + north * local.z;
  vRel = rel;
  vColor = aColor;
  vOwner = aOwner;
  vTint = aTint;
  vLight = 0.0;
  vUp = position.y;
  vProgress = progress;
  vUpDir = up;
  gl_Position = (mine < 0.5 || fade < 0.01) ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * vec4(mat3(viewMatrix) * rel, 1.0);
}
`;
