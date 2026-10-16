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
uniform float uMaxLevel;   // Look-1: the top City level (cityTiers.ts); a model part of a higher band than the City's is collapsed
uniform vec4 uClose;       // Look-1: x: the mid-range enlargement, y/z: the camera distances (m) where it rises from 1x and reaches full, w: where it is gone again (cityTiers closeMul in rings.ts)
uniform float uKmPerUnit;  // kilometres per Earth radius
uniform float uTime;       // fx seconds
uniform float uTick;       // the sim tick as a fraction
uniform float uPopSeconds;
uniform float uBuildMin;
uniform vec3 uSun;
uniform float uSpin;       // the angle (rad, 0..2pi) of a part flagged to turn (aTint >= 2: the SAM dish); the layer wraps fx time x speed so the sine stays precise

attribute vec3 aColor;
attribute float aTint;
attribute float aBand;     // Look-1: the first City band a vertex is drawn in (0 = always)
attribute vec3 aHi;
attribute vec3 aLo;
attribute vec4 aParams;    // x: level scale, y: yaw (radians), z: fx time of appearing, w: level (1..10 for a City; the City lights follow it)
attribute vec3 aOwner;     // owner colour, sRGB 0..1
attribute vec2 aBuild;     // buildTick, readyTick

varying vec3 vRel;
varying vec3 vColor;
varying vec3 vOwner;
varying float vTint;
varying float vUp;         // the vertex's height in model units (a gradient for the construction look)
varying float vProgress;
varying vec3 vUpDir;
varying float vLight;      // 1 on a city light vertex (M10-4)

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
  float closeK = mix(1.0, uClose.x, smoothstep(uClose.y, uClose.z, distM) * (1.0 - smoothstep(uClose.z * 1.6, uClose.w, distM)));
  float k = max(clamp(distM * uPxK / uSizeM, 1.0, uMaxScale), closeK) * uSizeM * aParams.x / (uKmPerUnit * 1000.0);
  float age = uTime - aParams.z;
  float pop = age < 0.0 ? 1.0 : clamp(age / uPopSeconds, 0.0, 1.0); // a clock set back by a test hook shows the finished model
  float popScale = pop >= 1.0 ? 1.0 : max(easeOutBack(pop), 0.0);
  float span = max(aBuild.y - aBuild.x, 1.0);
  float progress = clamp((uTick - aBuild.x) / span, 0.0, 1.0);
  float hs = mix(uBuildMin, 1.0, progress);
  float cy = cos(aParams.y);
  float sy = sin(aParams.y);
  vec3 p = position;
  float ib = min(4.0, floor(clamp((max(aParams.w, 1.0) - 1.0) / max(uMaxLevel - 1.0, 1.0), 0.0, 1.0) * 5.0 + 0.0001));
  p *= step(aBand - 0.5, ib);
  // aTint = owner tint (0/1) + 2 x spinning part + 4 x city light number (1..3, M10-4): a light is lit on the night side when the city's level reaches its number
  float lightIdx = floor(aTint * 0.25 + 0.01);
  float rem = aTint - 4.0 * lightIdx;
  float spins = step(1.5, rem);
  float isLight = step(0.5, lightIdx);
  float night = 1.0 - smoothstep(-0.10, 0.20, dot(up, normalize(uSun)));
  float lit = step(lightIdx - 0.5, aParams.w) * night * step(0.999, progress);
  p *= mix(1.0, lit, isLight);
  float sa = uSpin * spins; // the turning part (flag in aTint) sweeps round the model's y axis; the instance's yaw is its phase
  float cs = cos(sa);
  float ss = sin(sa);
  p = vec3(p.x * cs - p.z * ss, p.y, p.x * ss + p.z * cs);
  vec3 local = vec3(p.x * cy - p.z * sy, p.y * hs, p.x * sy + p.z * cy) * (k * popScale);
  vec3 rel = rel0 + east * local.x + up * local.y + north * local.z;
  vRel = rel;
  vColor = aColor;
  vOwner = aOwner;
  vTint = rem - 2.0 * spins;
  vLight = isLight * lit;
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
varying float vLight;

vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }
vec3 toDisplay(vec3 c) { return pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2)); }

void main() {
  if (vLight > 0.5) { gl_FragColor = vec4(1.0, 0.88, 0.55, uAlpha); return; } // a lit city light: emissive, no shading
  // under construction: a see-through look (a screen-door pattern that thins out as it is finished)
  if (vProgress < 0.999) { // not "< 1.0": an interpolated varying of a finished model can come out a hair under 1.0 and would speckle it with holes
    float h = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
    if (h < (1.0 - vProgress) * 0.45) discard;
  }
  vec3 n = normalize(cross(dFdx(vRel), dFdy(vRel)));
  vec3 viewDir = normalize(-vRel);
  if (dot(n, viewDir) < 0.0) n = -n;
  vec3 own = mix(vColor, vOwner, vTint);
  if (vProgress < 0.999) own = mix(own, vec3(dot(own, vec3(0.33))) * 0.8 + vec3(0.12, 0.16, 0.22), 0.45 * (1.0 - vProgress));
  if (uGhost.a > 0.0) own = mix(own, uGhost.rgb, uGhost.a);
  vec3 sun = normalize(uSun);
  float sunDot = dot(normalize(vUpDir), sun);
  float day = smoothstep(-0.10, 0.20, sunDot);
  float diff = clamp(dot(n, sun), 0.0, 1.0);
  vec3 ambient = mix(uAmbientNight, uAmbientDay, day) + vec3(0.05);
  vec3 lit = toLinear(own) * (ambient * 2.2 + uSunColor * day * (0.12 + 0.95 * diff));
  // Polish-1: night-side readability. The model keeps a floor of its own colour (a dark blob on dark territory becomes a lit shape), the owner colour
  // glows on tinted parts and a rim of the owner colour outlines the silhouette against the dark ground; all maths on values the shader already has.
  float nightK = 1.0 - day;
  lit = max(lit, toLinear(mix(own, vOwner, 0.3) + vec3(0.12)) * (0.55 * nightK));
  float rim = pow(1.0 - clamp(dot(n, viewDir), 0.0, 1.0), 2.0);
  lit += toLinear(vOwner) * ((0.16 * vTint + 0.22 * rim) * nightK);
  gl_FragColor = vec4(toDisplay(lit), uAlpha);
}
`;

// ---- M10-4: the ring mesh (selection ring + range ring in ONE draw call) -----------------------------------------------------------------
// A ring is a strip of quads. A vertex has a point (`aHi` + `aLo`, camera-relative like everything here), an outward direction in the tangent plane
// (`aDir`), a side (-1 / +1) and a kind: kind 0 = a range ring (the point is already on the ground, from groundHeightAt on the CPU), kind 1 = the
// selection ring (the point is the structure's centre and the ring stands `uSelR` away, which the layer recomputes per frame from the scale policy).
export const ringVertexShader = /* glsl */ `
uniform vec3 uCamHi;
uniform vec3 uCamLo;
uniform float uSelR;       // Earth radii: the selection ring's radius
uniform float uHalfMin;    // Earth radii: the smallest half width of the line
uniform float uHalfFrac;   // the half width as a share of the camera distance
attribute vec3 aHi;
attribute vec3 aLo;
attribute vec3 aDir;
attribute vec2 aSideKind;  // x: side (-1 / +1), y: kind (0 range, 1 select)
attribute float aLift;     // Polish-1: Earth radii the selection ring's vertex stands above the structure's ground (the ring follows a slope)
varying float vKind;
void main() {
  vec3 base = aHi + aLo;
  vec3 up = normalize(base);
  vec3 rel0 = (aHi - uCamHi) + (aLo - uCamLo);
  float dist = length(rel0);
  float hw = max(uHalfMin, dist * uHalfFrac);
  float kind = aSideKind.y;
  vec3 rel = rel0 + aDir * (kind * uSelR + aSideKind.x * hw) + up * (hw * 2.0 + aLift);
  vKind = kind;
  gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * rel, 1.0);
}
`;

export const ringFragmentShader = /* glsl */ `
uniform vec3 uSelectRgb;
uniform vec3 uRangeRgb;
varying float vKind;
void main() {
  gl_FragColor = vec4(mix(uRangeRgb, uSelectRgb, vKind), 0.92);
}
`;

// ---- M10-4: far icons (ONE draw call for every type) --------------------------------------------------------------------------------------
// Where a model projects to fewer than a few pixels, a flat owner-coloured badge of constant screen size takes over (a shape per type, drawn from a
// signed distance in the fragment shader: no texture). The fade is a function of the model's projected radius, so the model and the badge cross-fade
// without a pop. The instance buffers are filled with the models' (position, owner colour), type and size in `aInfo`.
export const iconVertexShader = /* glsl */ `
uniform vec3 uCamHi;
uniform vec3 uCamLo;
uniform float uKmPerUnit;
uniform float uPxK;
uniform float uMaxScale;
uniform vec4 uClose;
uniform float uViewH;      // drawing-buffer height in pixels
uniform float uFadeHi;     // projected model radius (px) above which there is no icon
uniform float uFadeLo;     // ... and below which the icon is full
uniform float uHalfPx;     // the icon's half size in pixels
attribute vec2 corner;     // (-1..1, -1..1)
attribute vec3 aHi;
attribute vec3 aLo;
attribute vec4 aInfo;      // x: type, y: model size in metres, z: level scale, w: level share (level / top level; Look-1: the City's progress arc)
attribute vec3 aOwner;
varying vec2 vUv;
varying vec3 vOwner;
varying float vType;
varying float vAlpha;
varying float vFrac;
void main() {
  vec3 centre = aHi + aLo;
  vec3 up = normalize(centre);
  vec3 rel0 = (aHi - uCamHi) + (aLo - uCamLo);
  float distM = length(rel0) * uKmPerUnit * 1000.0;
  float k = max(clamp(distM * uPxK / aInfo.y, 1.0, uMaxScale), mix(1.0, uClose.x, smoothstep(uClose.y, uClose.z, distM) * (1.0 - smoothstep(uClose.z * 1.6, uClose.w, distM))));
  float pxPerRad = uViewH * 0.5 * projectionMatrix[1][1];
  float modelPx = k * aInfo.y * aInfo.z / distM * pxPerRad;
  float a = 1.0 - smoothstep(uFadeLo, uFadeHi, modelPx);
  vAlpha = a;
  vUv = corner;
  vOwner = aOwner;
  vType = aInfo.x;
  vFrac = aInfo.w;
  vec3 v = mat3(viewMatrix) * rel0;
  float worldHalf = uHalfPx * 2.0 * max(-v.z, 1e-6) / (uViewH * projectionMatrix[1][1]);
  v += mat3(viewMatrix) * up * worldHalf; // sits one half size above the ground
  v.xy += corner * worldHalf;
  gl_Position = a < 0.01 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * vec4(v, 1.0);
}
`;

export const iconFragmentShader = /* glsl */ `
varying vec2 vUv;
varying vec3 vOwner;
varying float vType;
varying float vAlpha;
varying float vFrac;
float shape(vec2 p, float t) {
  if (t < 1.5) return length(p) - 0.9;                                          // City: disc
  if (t < 2.5) return max(abs(p.x), abs(p.y)) - 0.8;                            // Factory: square
  if (t < 3.5) return abs(p.x) + abs(p.y) - 1.05;                               // Port: diamond
  if (t < 4.5) return max(-p.y - 0.75, (abs(p.x) * 1.7 + p.y - 0.95) * 0.5);    // Silo: triangle up
  if (t < 5.5) return max(p.y - 0.75, (abs(p.x) * 1.7 - p.y - 0.95) * 0.5);     // SAM: triangle down
  return max(abs(p.x) * 0.866 + abs(p.y) * 0.5, abs(p.y)) - 0.88;              // Post: hexagon
}
void main() {
  float d = shape(vUv, vType);
  if (d > 0.0) discard;
  vec3 rim = vec3(0.96, 0.96, 0.94);
  // Look-1: the City's rim is a progress arc, clockwise from the top: lit up to level / top level, dim after it (the level at a glance from far away)
  if (vType < 1.5 && d > -0.28) {
    float fr = fract(atan(vUv.x, vUv.y) / 6.2831853 + 1.0);
    rim = fr <= vFrac + 0.001 ? rim : vec3(0.42, 0.42, 0.44);
  }
  vec3 c = d > -0.28 ? rim : vOwner;
  gl_FragColor = vec4(c, vAlpha);
}
`;
