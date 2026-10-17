// The vertex shader of the ship layer (M13c-2). Placed like a helicopter: relative to the camera from a two-part float32 position (`aHi` + `aLo`, Earth radii) in the frame
// (up, east, north) of its own direction. SCALE POLICY: the model's true size is `uSizeM` metres per unit; the radius never falls below `uMinFrac` times the camera distance
// (a few pixels from the globe view) and has NO upper cap, so a ship reads from the earth view and keeps its true size close by. `aInfo.x` is the heading (radians, east to north),
// `aInfo.y` the sink (1 = unloading: the hull sits `uSink` model units lower). The fragment shader is the structures' (night readability, flat shading).
export const shipVertexShader = /* glsl */ `
uniform vec3 uCamHi;
uniform vec3 uCamLo;
uniform float uSizeM;      // metres per model unit at true size
uniform float uMinFrac;    // smallest radius as a share of the camera distance
uniform float uKmPerUnit;
uniform float uSink;       // model units a sunk hull goes down

attribute vec3 aColor;
attribute float aTint;     // part: 0 neutral, 1 owner colour
attribute vec3 aHi;
attribute vec3 aLo;
attribute vec3 aOwner;
attribute vec3 aInfo;      // x: heading (rad), y: sink 0..1

varying vec3 vRel;
varying vec3 vColor;
varying vec3 vOwner;
varying float vTint;
varying float vUp;
varying float vProgress;
varying vec3 vUpDir;
varying float vLight;

void main() {
  vec3 centre = aHi + aLo;
  vec3 up = normalize(centre);
  vec3 east = cross(vec3(0.0, 1.0, 0.0), up);
  float el = length(east);
  east = el > 1e-4 ? east / el : vec3(1.0, 0.0, 0.0);
  vec3 north = cross(up, east);
  vec3 rel0 = (aHi - uCamHi) + (aLo - uCamLo);
  float distM = length(rel0) * uKmPerUnit * 1000.0;
  float k = max(1.0, distM * uMinFrac / uSizeM) * uSizeM / (uKmPerUnit * 1000.0);
  float cy = cos(aInfo.x);
  float sy = sin(aInfo.x);
  vec3 p = position;
  p.y -= uSink * aInfo.y;
  vec3 body = vec3(p.x * cy - p.z * sy, p.y, p.x * sy + p.z * cy);
  vec3 rel = rel0 + (east * body.x + up * body.y + north * body.z) * k;
  vRel = rel;
  vColor = aColor;
  vOwner = aOwner;
  vTint = step(0.5, aTint) * (1.0 - step(1.5, aTint));
  vLight = 0.0;
  vUp = position.y;
  vProgress = 1.0;
  vUpDir = up;
  gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * rel, 1.0);
}
`;
