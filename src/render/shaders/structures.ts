// The shaders of the structure layer (M10). A structure is one INSTANCE of its type's model. Like the terrain chunks it is placed relative to
// the camera and never from absolute float32 world coordinates (docs/ARCHITECTURE.md, rules for layers (1)): the instance position is two float32 parts,
// `aHi` (the float32 nearest to the true position, Earth radii) and `aLo` (what that left out), and `(aHi - uCamHi) + (aLo - uCamLo)` is exact
// next to the camera. The instance's frame (up, east, north) comes from its own direction, so there is no instance matrix at all.
//
// SCALE POLICY. The model's true size is `uSizeM` metres per unit times the level scale. Its radius never falls below `uPxK` times the distance to
// the camera (a roughly constant share of the screen), up to `uMaxScale` times the true size: a city is a visible mark from high up and its true
// size close by. Pop-in (`aParams.z` is the fx time it appeared) and construction (`aBuild` = the sim ticks it started and finishes; `uTick` is the
// current tick as a fraction) are shader maths on the fx clock and the interpolated tick: nothing is rewritten per frame on the CPU.
export const structureVertexShader = /* glsl */ `
uniform vec3 uCamHi;
uniform vec3 uCamLo;
uniform float uSizeM;      // metres per model unit at true size
uniform float uPxK;        // minimum radius as a share of the camera distance
uniform float uMaxScale;
uniform float uKmPerUnit;  // kilometres per Earth radius
uniform float uTime;       // fx seconds
uniform float uTick;       // the sim tick as a fraction
uniform float uPopSeconds;
uniform float uBuildMin;
uniform float uSpin;       // the angle (rad, 0..2pi) of a part flagged to turn (aTint >= 2: the SAM dish); the layer wraps fx time x speed so the sine stays precise

attribute vec3 aColor;
attribute float aTint;
attribute vec3 aHi;
attribute vec3 aLo;
attribute vec4 aParams;    // x: level scale, y: yaw (radians), z: fx time of appearing, w: unused
attribute vec3 aOwner;     // owner colour, sRGB 0..1
attribute vec2 aBuild;     // buildTick, readyTick

varying vec3 vRel;
varying vec3 vColor;
varying vec3 vOwner;
varying float vTint;
varying float vUp;         // the vertex's height in model units (a gradient for the construction look)
varying float vProgress;
varying vec3 vUpDir;

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
  float k = clamp(distM * uPxK / uSizeM, 1.0, uMaxScale) * uSizeM * aParams.x / (uKmPerUnit * 1000.0);
  float age = uTime - aParams.z;
  float pop = age < 0.0 ? 1.0 : clamp(age / uPopSeconds, 0.0, 1.0); // a clock set back by a test hook shows the finished model
  float popScale = pop >= 1.0 ? 1.0 : max(easeOutBack(pop), 0.0);
  float span = max(aBuild.y - aBuild.x, 1.0);
  float progress = clamp((uTick - aBuild.x) / span, 0.0, 1.0);
  float hs = mix(uBuildMin, 1.0, progress);
  float cy = cos(aParams.y);
  float sy = sin(aParams.y);
  vec3 p = position;
  float spins = step(1.5, aTint);
  float sa = uSpin * spins; // the turning part (flag in aTint) sweeps round the model's y axis; the instance's yaw is its phase
  float cs = cos(sa);
  float ss = sin(sa);
  p = vec3(p.x * cs - p.z * ss, p.y, p.x * ss + p.z * cs);
  vec3 local = vec3(p.x * cy - p.z * sy, p.y * hs, p.x * sy + p.z * cy) * (k * popScale);
  vec3 rel = rel0 + east * local.x + up * local.y + north * local.z;
  vRel = rel;
  vColor = aColor;
  vOwner = aOwner;
  vTint = aTint - 2.0 * spins;
  vUp = position.y;
  vProgress = progress;
  vUpDir = up;
  gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * rel, 1.0);
}
`;

export const structureFragmentShader = /* glsl */ `
uniform vec3 uSun;
uniform vec3 uSunColor;
uniform vec3 uAmbientDay;
uniform vec3 uAmbientNight;
uniform vec4 uGhost;       // rgb: the ghost colour (sRGB), a: how far it pulls the model's colours (0 = not a ghost)
uniform float uAlpha;

varying vec3 vRel;
varying vec3 vColor;
varying vec3 vOwner;
varying float vTint;
varying float vUp;
varying float vProgress;
varying vec3 vUpDir;

vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }
vec3 toDisplay(vec3 c) { return pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2)); }

void main() {
  // under construction: a see-through look (a screen-door pattern that thins out as it is finished)
  if (vProgress < 1.0) {
    float h = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
    if (h < (1.0 - vProgress) * 0.45) discard;
  }
  vec3 n = normalize(cross(dFdx(vRel), dFdy(vRel)));
  vec3 viewDir = normalize(-vRel);
  if (dot(n, viewDir) < 0.0) n = -n;
  vec3 own = mix(vColor, vOwner, vTint);
  if (vProgress < 1.0) own = mix(own, vec3(dot(own, vec3(0.33))) * 0.8 + vec3(0.12, 0.16, 0.22), 0.45 * (1.0 - vProgress));
  if (uGhost.a > 0.0) own = mix(own, uGhost.rgb, uGhost.a);
  vec3 sun = normalize(uSun);
  float sunDot = dot(normalize(vUpDir), sun);
  float day = smoothstep(-0.10, 0.20, sunDot);
  float diff = clamp(dot(n, sun), 0.0, 1.0);
  vec3 ambient = mix(uAmbientNight, uAmbientDay, day) + vec3(0.05);
  vec3 lit = toLinear(own) * (ambient * 2.2 + uSunColor * day * (0.12 + 0.95 * diff));
  // the owner's colour keeps a faint glow on the night side so a base stays readable
  lit += toLinear(vOwner) * (0.05 * vTint * (1.0 - day));
  gl_FragColor = vec4(toDisplay(lit), uAlpha);
}
`;
