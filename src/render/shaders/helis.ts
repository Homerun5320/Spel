// The vertex shader of the helicopter layer (M13a-1). Like the structures a helicopter is placed relative to the camera from a two-part float32 position
// (`aHi` + `aLo`, Earth radii, docs/ARCHITECTURE.md rules for layers (1)) and its frame (up, east, north) comes from its own direction. The scale
// policy is the structures' (a share of the camera distance, `uSizeM` = the Factory's unit) so a parked helicopter keeps its place beside the Factory at
// every zoom: `uPad` (Factory model units) is added to the position of an instance flagged as parked (`aInfo.y`). The rotors turn here from ONE uniform
// (`uSpin`, the fx time x speed wrapped to 2 pi): no CPU work per instance. The fragment shader is the structures' (night readability, flat shading).
export const heliVertexShader = /* glsl */ `
uniform vec3 uCamHi;
uniform vec3 uCamLo;
uniform float uSizeM;
uniform float uPxK;
uniform float uMaxScale;
uniform vec4 uClose;
uniform float uKmPerUnit;
uniform float uModelScale; // helicopter unit in Factory units
uniform vec3 uPad;         // where a parked helicopter stands, Factory model units (east, up, north)
uniform float uSpin;       // main rotor angle, rad
uniform float uTick;       // 0..1: how far between the previous table's position and this one's the picture is
uniform float uTailMul;
uniform vec3 uTailHub;

attribute vec3 aColor;
attribute float aTint;     // part: 0 neutral, 1 owner colour, 2 main rotor, 4 tail rotor
attribute vec3 aHi;
attribute vec3 aLo;
attribute vec3 aOwner;
attribute vec3 aDelta;     // previous position minus this one (Earth radii), 0 for a parked or new one
attribute vec3 aInfo;      // x: yaw (rad, east -> north), y: 1 = parked on the pad, z: 1 = downed (rotors stand still)

varying vec3 vRel;
varying vec3 vColor;
varying vec3 vOwner;
varying float vTint;
varying float vUp;
varying float vProgress;
varying vec3 vUpDir;
varying float vLight;

void main() {
  vec3 centre = aHi + aLo + aDelta * (1.0 - uTick);
  vec3 up = normalize(centre);
  vec3 east = cross(vec3(0.0, 1.0, 0.0), up);
  float el = length(east);
  east = el > 1e-4 ? east / el : vec3(1.0, 0.0, 0.0);
  vec3 north = cross(up, east);
  vec3 rel0 = (aHi - uCamHi) + (aLo - uCamLo) + aDelta * (1.0 - uTick);
  float distM = length(rel0) * uKmPerUnit * 1000.0;
  float closeK = mix(1.0, uClose.x, smoothstep(uClose.y, uClose.z, distM) * (1.0 - smoothstep(uClose.z * 1.6, uClose.w, distM)));
  float k = max(clamp(distM * uPxK / uSizeM, 1.0, uMaxScale), closeK) * uSizeM / (uKmPerUnit * 1000.0);
  vec3 p = position;
  float isMain = step(1.5, aTint) * (1.0 - step(2.5, aTint));
  float isTail = step(3.5, aTint);
  float turn = 1.0 - aInfo.z;
  float sa = uSpin * turn * isMain;
  float cs = cos(sa);
  float ss = sin(sa);
  p = vec3(p.x * cs - p.z * ss, p.y, p.x * ss + p.z * cs);
  float ta = uSpin * uTailMul * turn;
  vec3 d = p - uTailHub;
  float ct = cos(ta);
  float st = sin(ta);
  p = mix(p, uTailHub + vec3(d.x * ct - d.y * st, d.x * st + d.y * ct, d.z), isTail);
  float cy = cos(aInfo.x);
  float sy = sin(aInfo.x);
  vec3 body = vec3(p.x * cy - p.z * sy, p.y, p.x * sy + p.z * cy) * uModelScale;
  vec3 local = (body + uPad * aInfo.y) * k;
  vec3 rel = rel0 + east * local.x + up * local.y + north * local.z;
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
