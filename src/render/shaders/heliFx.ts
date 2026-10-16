// The shaders of the helicopter effects (M13a-2): the particle pool, the shadow blobs, the beachhead flags and the far icons. Every layer places its instances
// relative to the camera from a two-part float32 position (docs/ARCHITECTURE.md rules for layers (1)) and uses the structures' scale policy (`policyK`), so
// an effect keeps the proportions of the helicopter it belongs to at every zoom. Particles move analytically from their birth time (`uNow`, the fx clock):
// nothing is written per frame for a particle in flight.
const COMMON = /* glsl */ `
uniform vec3 uCamHi;
uniform vec3 uCamLo;
uniform float uKmPerUnit;
uniform float uSizeM;
uniform float uPxK;
uniform float uMaxScale;
uniform vec4 uClose;
uniform float uTick; // 0..1 between the previous table's place and this one's (helicopters glide: shadows and icons follow)
float policyK(float distM) {
  return max(clamp(distM * uPxK / uSizeM, 1.0, uMaxScale), mix(1.0, uClose.x, smoothstep(uClose.y, uClose.z, distM) * (1.0 - smoothstep(uClose.z * 1.6, uClose.w, distM))));
}
void frameOf(vec3 centre, out vec3 up, out vec3 east, out vec3 north) {
  up = normalize(centre);
  east = cross(vec3(0.0, 1.0, 0.0), up);
  float el = length(east);
  east = el > 1e-4 ? east / el : vec3(1.0, 0.0, 0.0);
  north = cross(up, east);
}
`;

const OFF = 'gl_Position = vec4(2.0, 2.0, 2.0, 1.0);';

export const particleVertexShader = /* glsl */ `
${COMMON}
uniform float uNow;
attribute vec2 corner;
attribute vec3 aHi;
attribute vec3 aLo;
attribute vec3 aVel;   // east, up, north in metres per second (true size)
attribute vec4 aTime;  // birth, life, size at birth, size at death (metres, true size)
attribute vec4 aColor; // rgb, peak alpha
varying vec2 vUv;
varying vec4 vCol;
void main() {
  float age = uNow - aTime.x; // the birth is a float32: a particle born this very frame can read a hair in the future
  vUv = corner;
  vCol = vec4(0.0);
  if (age < -0.1 || age >= aTime.y) { ${OFF} return; }
  age = max(age, 0.0);
  float t = age / max(aTime.y, 1e-3);
  vec3 up; vec3 east; vec3 north;
  frameOf(aHi + aLo, up, east, north);
  vec3 rel0 = (aHi - uCamHi) + (aLo - uCamLo);
  float distM = length(rel0) * uKmPerUnit * 1000.0;
  float s = policyK(distM) / (uKmPerUnit * 1000.0);
  vec3 rel = rel0 + (east * aVel.x + up * aVel.y + north * aVel.z) * (age * s);
  vec3 v = mat3(viewMatrix) * rel;
  v.xy += corner * (mix(aTime.z, aTime.w, t) * s);
  vCol = vec4(aColor.rgb, aColor.a * smoothstep(0.0, 0.08, t) * (1.0 - t));
  gl_Position = projectionMatrix * vec4(v, 1.0);
}
`;

export const particleFragmentShader = /* glsl */ `
varying vec2 vUv;
varying vec4 vCol;
void main() {
  float a = vCol.a * (1.0 - smoothstep(0.3, 1.0, length(vUv)));
  if (a < 0.01) discard;
  gl_FragColor = vec4(vCol.rgb, a);
}
`;

export const shadowVertexShader = /* glsl */ `
${COMMON}
uniform vec3 uShadow; // half size m, fade height m, peak alpha
attribute vec2 corner;
attribute vec3 aHi;
attribute vec3 aLo;
attribute float aAgl;
attribute vec3 aDelta;
varying vec2 vUv;
varying float vAlpha;
void main() {
  vec3 up; vec3 east; vec3 north;
  vec3 glide = aDelta * (1.0 - uTick);
  frameOf(aHi + aLo + glide, up, east, north);
  vec3 rel0 = (aHi - uCamHi) + (aLo - uCamLo) + glide;
  float distM = length(rel0) * uKmPerUnit * 1000.0;
  float k = policyK(distM);
  float unit = k / (uKmPerUnit * 1000.0);
  float halfM = uShadow.x * unit * (1.0 + aAgl * 0.0004);
  vec3 rel = rel0 + up * (3.0 * unit) + (east * corner.x + north * corner.y) * halfM;
  vUv = corner;
  vAlpha = uShadow.z * (1.0 - 0.55 * smoothstep(30.0, uShadow.y, aAgl));
  gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * rel, 1.0);
}
`;

export const shadowFragmentShader = /* glsl */ `
varying vec2 vUv;
varying float vAlpha;
void main() {
  float a = vAlpha * (1.0 - smoothstep(0.15, 1.0, length(vUv)));
  if (a < 0.01) discard;
  gl_FragColor = vec4(0.02, 0.02, 0.04, a);
}
`;

export const flagVertexShader = /* glsl */ `
${COMMON}
uniform float uNow;
uniform float uHoist;  // seconds the flag takes to rise
uniform float uPoleM;  // pole height in metres at true size
attribute float aPart;   // 0 pole, 1 cloth
attribute vec3 aHi;
attribute vec3 aLo;
attribute vec4 aOwner;   // rgb, hoist start (fx s)
varying vec3 vColor;
varying float vShade;
void main() {
  vec3 up; vec3 east; vec3 north;
  frameOf(aHi + aLo, up, east, north);
  vec3 rel0 = (aHi - uCamHi) + (aLo - uCamLo);
  float distM = length(rel0) * uKmPerUnit * 1000.0;
  float unit = policyK(distM) * uPoleM / (uKmPerUnit * 1000.0);
  float prog = clamp((uNow - aOwner.w) / uHoist, 0.0, 1.0);
  prog = prog * prog * (3.0 - 2.0 * prog);
  vec3 p = position;
  float cloth = aPart;
  p.y -= cloth * (1.0 - prog) * 0.5;
  p.y *= mix(0.25 + 0.75 * prog, 1.0, 1.0 - cloth);
  p.z = cloth * sin(uNow * 5.0 + p.x * 7.0) * 0.05 * p.x;
  vec3 rel = rel0 + (east * p.x + up * p.y + north * p.z) * unit;
  vColor = mix(vec3(0.86, 0.86, 0.84), aOwner.rgb, cloth);
  vShade = 0.82 + 0.18 * cloth * sin(uNow * 5.0 + p.x * 7.0);
  gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * rel, 1.0);
}
`;

export const flagFragmentShader = /* glsl */ `
varying vec3 vColor;
varying float vShade;
void main() {
  gl_FragColor = vec4(vColor * vShade, 1.0);
}
`;

export const iconVertexShader = /* glsl */ `
${COMMON}
uniform float uViewH;
uniform float uFadeHi;
uniform float uFadeLo;
uniform float uHalfPx;
uniform float uModelM;  // radius of the helicopter model at true size, metres
uniform float uMaxM;    // no icon from this camera distance
attribute vec2 corner;
attribute vec3 aHi;
attribute vec3 aLo;
attribute vec3 aOwner;
attribute vec3 aDelta;
varying vec2 vUv;
varying vec3 vOwner;
void main() {
  vec3 glide = aDelta * (1.0 - uTick);
  vec3 up = normalize(aHi + aLo + glide);
  vec3 rel0 = (aHi - uCamHi) + (aLo - uCamLo) + glide;
  float distM = length(rel0) * uKmPerUnit * 1000.0;
  float pxPerRad = uViewH * 0.5 * projectionMatrix[1][1];
  float modelPx = policyK(distM) * uModelM / max(distM, 1.0) * pxPerRad;
  float a = (1.0 - smoothstep(uFadeLo, uFadeHi, modelPx)) * (1.0 - step(uMaxM, distM));
  vUv = corner;
  vOwner = aOwner;
  vec3 v = mat3(viewMatrix) * rel0;
  float worldHalf = uHalfPx * 2.0 * max(-v.z, 1e-6) / (uViewH * projectionMatrix[1][1]);
  v += mat3(viewMatrix) * up * worldHalf;
  v.xy += corner * worldHalf;
  gl_Position = a < 0.01 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * vec4(v, 1.0);
}
`;

export const iconFragmentShader = /* glsl */ `
varying vec2 vUv;
varying vec3 vOwner;
void main() {
  float d = pow(abs(vUv.x), 0.6) + pow(abs(vUv.y), 0.6) - 1.15; // a four-pointed rotor star, apart from the structures' discs, squares and triangles
  if (d > 0.0) discard;
  vec3 c = d > -0.22 ? vec3(0.96, 0.96, 0.94) : vOwner;
  gl_FragColor = vec4(c, 1.0);
}
`;
