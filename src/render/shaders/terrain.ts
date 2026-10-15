// The globe shader: displaced lat/lon grid, derivative flat shading, hypsometric colours with snow, biome tone from the
// sim class layer, coast colour from bathymetry and a coast line shaded from the land mask per fragment (so a coarse mesh
// never gives a wrong coast line; M07 replaces the mesh with an LOD). Item 3 and 4 pieces come from their own modules:
// ocean (waves, Fresnel, glitter), atmosphere (haze and limb glow), borders (id raster neighbour comparison). Night lights
// are an emissive term of the day/night terminator.
import * as C from '../config';
import { POLE_HEIGHT_U } from '../geo';
import { GLSL_ATMOSPHERE } from './atmosphere';
import { GLSL_BORDERS } from './borders';
import { GLSL_GEO, GLSL_TEXELS } from './common';
import { GLSL_OCEAN } from './ocean';
import { GLSL_TERRITORY } from './territory';

/** A number as a GLSL float literal (always with a decimal point). */
function glslFloat(x: number): string {
  const t = String(x);
  return /[.e]/.test(t) ? t : `${t}.0`;
}
const glslVec2 = (c: readonly [number, number]): string => `vec2(${glslFloat(c[0])}, ${glslFloat(c[1])})`;
const glslVec3 = (c: readonly [number, number, number]): string => `vec3(${glslFloat(c[0])}, ${glslFloat(c[1])}, ${glslFloat(c[2])})`;

/** The shading numbers of `src/render/config.ts` as GLSL constants (no uniforms: they never change at run time). */
const SHADING_CONSTS = `
const vec2 ROCK_SLOPE = ${glslVec2(C.SHADE_ROCK_SLOPE)};
const float ROCK_STRENGTH = ${glslFloat(C.SHADE_ROCK_STRENGTH)};
const float TREE_BELOW_SNOW = ${glslFloat(C.SHADE_TREE_BELOW_SNOW_M)};
const float TREE_FADE = ${glslFloat(C.SHADE_TREE_FADE_M)};
const vec3 SNOW_LINE = ${glslVec3(C.SHADE_SNOW_LINE_M)};
const vec3 SNOW_RAMP_A = ${glslVec3([C.SHADE_SNOW_RAMPS[0], C.SHADE_SNOW_RAMPS[1], C.SHADE_SNOW_RAMPS[2]])};
const vec3 SNOW_RAMP_B = ${glslVec3([C.SHADE_SNOW_RAMPS[3], C.SHADE_SNOW_RAMPS[4], C.SHADE_SNOW_RAMPS[5]])};
const float SNOW_POLAR_DROP = ${glslFloat(C.SHADE_SNOW_POLAR_DROP_M)};
const float SNOW_FADE = ${glslFloat(C.SHADE_SNOW_FADE_M)};
const float SNOW_SHED = ${glslFloat(C.SHADE_SNOW_SHED_M)};
const vec2 SNOW_SHED_SLOPE = ${glslVec2(C.SHADE_SNOW_SHED_SLOPE)};
const vec3 ROCK_WARM = ${glslVec3(C.SHADE_ROCK_WARM)};
const vec3 ROCK_COOL = ${glslVec3(C.SHADE_ROCK_COOL)};
const vec3 SNOW_COLOR = ${glslVec3(C.SHADE_SNOW_COLOR)};
const vec3 BOREAL_TINT = ${glslVec3(C.SHADE_BOREAL_TINT)};
const vec2 BOREAL_RAMP = ${glslVec2(C.SHADE_BOREAL_RAMP)};
const float MOTTLE_COLOR = ${glslFloat(C.SHADE_MOTTLE_COLOR)};
const vec2 MOTTLE_FADE = ${glslVec2(C.SHADE_MOTTLE_FADE_PX)};
const float MOTTLE_SNOW = ${glslFloat(C.SHADE_MOTTLE_SNOW_M)};
const float FOAM_FROM = ${glslFloat(C.FOAM_FROM)};
const float FOAM_BAND_M = ${glslFloat(C.FOAM_BAND_M)};
const float FOAM_STRENGTH = ${glslFloat(C.FOAM_STRENGTH)};
const vec3 FOAM_COLOR = ${glslVec3(C.FOAM_COLOR)};
const float SPECKLE_FINE = ${glslFloat(C.LIGHTS_SPECKLE_FINE)};
`;

export const terrainVertexShader = /* glsl */ `
uniform sampler2D uHeight;
uniform float uHeightMaxM;
uniform float uExag;
uniform float uKmPerUnit;

varying vec3 vDir;
varying vec3 vRel;

void main() {
  vec3 dir = normalize(position);
  // The pole rows (v = 0 or 1) collapse to one point: they all read the height at one common longitude, so the pole has
  // ONE radius (otherwise it tears into slivers). Same rule as heightLookupUv in geo.ts.
  vec2 hUv = (uv.y <= 0.0 || uv.y >= 1.0) ? vec2(${glslFloat(POLE_HEIGHT_U)}, uv.y) : uv;
  float code = textureLod(uHeight, hUv, 0.0).r; // R8, normalised: code / 255
  float hM = uHeightMaxM * code * code;
  float r = 1.0 + uExag * hM / (uKmPerUnit * 1000.0);
  vec3 p = dir * r;
  vDir = dir;
  vRel = p - cameraPosition; // camera-relative, like the chunk vertex shader (shaders/chunk.ts) produces it
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

/**
 * Fine mottling of the land colour for close views (the chunk terrain): two octaves of smooth value noise with lattice cells of 1/64 and 1/256 of a
 * sim cell (610 and 150 m), each faded in only when its wavelength is longer than a few pixels (the same rule as the territory's fine warp), so an
 * orbit view takes the first test and pays nothing. The position is the whole cell b plus the small offset o of the chunk shader (exact integer
 * lattice, no float32 cell coordinate), the same two-part form as ownerWarpFine. 0.5 when nothing is faded in.
 */
const FINE_MOTTLE = /* glsl */ `
// x: the mottling of the colours (five octaves: 2.4 km down to 10 m, each only where its wavelength is a few pixels or more), y: the coarse part only (the first two), for the edge of the snow, which must not look like camouflage.
vec2 fineMottle(ivec2 b, vec2 o, float pc, float hM) {
  // the height moves the lattice (1 / 610 m of height per lattice cell): on a cliff the pattern changes with the height instead of streaking down the wall
  vec2 hs = vec2(0.31, 1.0) * hM;
  float n = 0.5;
  float coarse = 0.5;
  float f1 = smoothstep(MOTTLE_FADE.x, MOTTLE_FADE.y, (1.0 / 16.0) / pc);
  if (f1 > 0.0) {
    vec2 q = o * 16.0 + hs * (1.0 / 2444.0);
    vec2 fl = floor(q);
    float d1 = (ownerNoise2(b * 16 + ivec2(fl) + ivec2(0, 131), q - fl, 16384).x - 0.5) * f1;
    n += d1 * 0.9;
    coarse += d1;
    float f2 = smoothstep(MOTTLE_FADE.x, MOTTLE_FADE.y, (1.0 / 64.0) / pc);
    if (f2 > 0.0) {
      vec2 q2 = o * 64.0 + hs * (1.0 / 611.0);
      vec2 fl2 = floor(q2);
      float d2 = (ownerNoise2(b * 64 + ivec2(fl2) + ivec2(0, 331), q2 - fl2, 65536).y - 0.5) * f2;
      n += d2 * 0.7;
      coarse += d2 * 0.4;
      float f3 = smoothstep(MOTTLE_FADE.x, MOTTLE_FADE.y, (1.0 / 256.0) / pc);
      if (f3 > 0.0) {
        vec2 q3 = o * 256.0 + hs * (1.0 / 153.0);
        vec2 fl3 = floor(q3);
        n += (ownerNoise2(b * 256 + ivec2(fl3) + ivec2(0, 977), q3 - fl3, 262144).x - 0.5) * f3 * 0.45;
        float f4 = smoothstep(MOTTLE_FADE.x, MOTTLE_FADE.y, (1.0 / 1024.0) / pc);
        if (f4 > 0.0) {
          vec2 q4 = o * 1024.0 + hs * (1.0 / 38.0);
          vec2 fl4 = floor(q4);
          vec2 v4 = ownerNoise2(b * 1024 + ivec2(fl4) + ivec2(0, 2713), q4 - fl4, 1048576);
          n += (v4.y - 0.5) * f4 * 0.4;
          float f5 = smoothstep(MOTTLE_FADE.x, MOTTLE_FADE.y, (1.0 / 4096.0) / pc);
          if (f5 > 0.0) {
            vec2 q5 = o * 4096.0 + hs * (1.0 / 9.5);
            vec2 fl5 = floor(q5);
            n += (ownerNoise2(b * 4096 + ivec2(fl5) + ivec2(0, 5003), q5 - fl5, 4194304).x - 0.5) * f5 * 0.3;
          }
        }
      }
    }
  }
  return clamp(vec2(n, coarse), 0.0, 1.0);
}
`;

/**
 * The terrain fragment shader. With `chunk` it also declares the debug colouring of the chunk terrain (`?chunks=1`: a flat colour
 * per chunk with a darker rim, so the chunks and their levels can be seen); the fixed mesh has no such uniform.
 */
export function buildTerrainFragmentShader(chunk: boolean): string {
  const chunkDecl = chunk ? 'uniform float uChunkDebug;\nuniform float uChunkCells;\nuniform vec3 uDetailLod;\nvarying vec4 vChunk;\nvarying float vWall;\nvarying float vH;\nflat varying vec2 vCellBase;\nvarying vec2 vCellOff;' : '';
  // The facet normal is the stylised flat shading of the mesh. A mesh cell much smaller than a raster texel only shows the texel
  // grid of the bilinear height field (blocky streaks), so the facet weight fades out below four texels per cell (the fixed mesh
  // and the orbit-level chunks have 8 or more and keep the full weight; the slope normal already carries the finer relief).
  const facetWeight = chunk
    ? `float cellTexels = (1.5707963 / exp2(vChunk.y) / uChunkCells) / (2.0 * PI / float(uHeightSize.x));
  // (the east-west width of a cell shrinks with the cosine of the latitude: near a pole the cells are slivers a hundredth of a texel wide)
  float facetW = uFacet * clamp(max(cellTexels * length(dir.xz) * 0.25, uDetailLod.z * capKeep), 0.0, 1.0);
  // M07b: with the terrain detail the mesh itself carries the fine relief that the raster's slope normal cannot, so the facet normal keeps its
  // full weight at every level (uDetailLod.z = 1) except poleward of the last real elevation row (capKeep, where the detail is faded out too and
  // the cells are slivers); without the detail (\`?detail=0\`) the old fade stays (the texel grid would show as streaks).
  // A skirt wall (seen through a hairline between two chunks, or a crack between two LOD levels) is shaded like level ground: it only
  // hides a gap, it is not a face of the terrain.
  if (vWall > 0.5) flatN = dir;`
    : 'float facetW = uFacet;';
  const chunkDebug = chunk
    ? `  if (uChunkDebug > 0.5) {
    vec3 hue = clamp(abs(fract(vChunk.x + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
    vec3 chunkCol = mix(vec3(1.0), hue, 0.75) * (0.55 + 0.4 * fract(vChunk.y * 0.37));
    vec2 rim = min(vChunk.zw, 1.0 - vChunk.zw);
    float edge = 1.0 - smoothstep(0.0, 0.035, min(rim.x, rim.y));
    gl_FragColor = vec4(mix(chunkCol, chunkCol * 0.35, edge) * (0.75 + 0.25 * max(dot(normalize(vDir), sun), 0.0)), 1.0);
  }`
    : '';
  // How big a pixel is on the ground, for the country border line and the selection outline: the fixed mesh differentiates the direction;
  // the chunk terrain differentiates the camera-relative position instead (precise to a fraction of a millimetre, where a float32 direction
  // has steps of 0.4 m: a line drawn a pixel wide from it would flicker in width when the camera is a few hundred metres up). The radial
  // part of that difference vanishes in every normalize() the borders module applies.
  const borders = chunk ? GLSL_BORDERS.replace(/\bdFdx\(dir\)/g, 'dFdx(vRel)').replace(/\bdFdy\(dir\)/g, 'dFdy(vRel)') : GLSL_BORDERS;
  // Territory: the chunk terrain takes the pixel size in cells from that footprint (cells per radian are the raster's width over 2 pi
  // and its height over pi, the east-west part divided by the cosine of the latitude).
  const territoryCall = chunk
    ? 'albedoLand = applyTerritoryAt(albedoLand, ivec2(floor(vCellBase + 0.5)), vCellOff, cpx, cpy, landMask);'
    : 'albedoLand = applyTerritory(albedoLand, uv, landMask);';
  // The pixel size in cells (the chunk terrain only: the footprint of its camera-relative position; cells per radian are the raster's width over
  // 2 pi and its height over pi, the east-west part divided by the cosine of the latitude) feeds the territory, the fine mottling and the foam.
  const footprint = chunk
    ? `vec3 tpx = dFdx(vRel);
  vec3 tpy = dFdy(vRel);
  vec2 ownerCells = vec2(uOwnerSize);
  float invCos = 1.0 / max(length(dir.xz), 1e-3);
  vec2 cpx = vec2(dot(tpx, east) * invCos, -dot(tpx, north)) * ownerCells * vec2(0.5 / PI, 1.0 / PI);
  vec2 cpy = vec2(dot(tpy, east) * invCos, -dot(tpy, north)) * ownerCells * vec2(0.5 / PI, 1.0 / PI);
  float pixCells = max(max(length(cpx), length(cpy)), 1e-7);
  vec2 mot2 = vec2(0.5);
  if (landMask > 0.001) mot2 = fineMottle(ivec2(floor(vCellBase + 0.5)), vCellOff, pixCells, vH);
  float mot = mot2.x;`
    : 'float mot = 0.5;\n  vec2 mot2 = vec2(0.5);';
  // The vertex height samples the raster only at the mesh's own vertices: where a cell is wider than a texel (an orbit view) it misses the narrow peaks
  // that the per-pixel raster height still has, so the snow would vanish from the Alps seen from afar; there the pixel's raster height takes over.
  const heightDetailed = chunk ? 'mix(vH, heightM, smoothstep(0.7, 2.0, cellTexels))' : 'heightM';
  return /* glsl */ `
uniform sampler2D uHeight;
uniform sampler2D uBathy;
uniform sampler2D uClass;
uniform ivec2 uHeightSize;
uniform ivec2 uBathySize;
uniform ivec2 uClassSize;
uniform float uHeightMaxM;
uniform float uDepthMaxM;
uniform float uExag;
uniform float uKmPerUnit;
uniform vec3 uSun;
uniform vec3 uSunColor;
uniform vec3 uSunColorLow;
uniform vec2 uTwilight; // x width (sin elevation), y strength
uniform sampler2D uLights;
uniform vec4 uLightsColor; // rgb colour (linear), a gain
uniform vec3 uAmbientNight;
uniform vec3 uAmbientDay;
uniform vec3 uClassAlbedo[8];
uniform float uFacet;
uniform vec3 uPolarCap; // x, y: |latitude| (degrees) where the polar-cap fade starts and ends; z: sea depth in metres inside the cap

varying vec3 vDir;
varying vec3 vRel; // surface point minus camera position (the vertex shaders form it without absolute float32 coordinates)
${chunkDecl}

${GLSL_GEO}
${GLSL_TEXELS}
${GLSL_ATMOSPHERE}
${GLSL_OCEAN}
${borders}
${GLSL_TERRITORY}
${SHADING_CONSTS}
${chunk ? FINE_MOTTLE : ''}

// Land fraction (bilinear over the binary mask) and the land-only mean height in metres at a position.
void sampleLand(vec2 uv, out float mask, out float heightM) {
  vec2 t = uv * vec2(uHeightSize) - 0.5;
  vec2 fl = floor(t);
  vec2 f = t - fl;
  ivec2 i0 = ivec2(fl);
  float c00 = fetchCode(uHeight, uHeightSize, i0);
  float c10 = fetchCode(uHeight, uHeightSize, i0 + ivec2(1, 0));
  float c01 = fetchCode(uHeight, uHeightSize, i0 + ivec2(0, 1));
  float c11 = fetchCode(uHeight, uHeightSize, i0 + ivec2(1, 1));
  float w00 = (1.0 - f.x) * (1.0 - f.y) * step(0.5, c00);
  float w10 = f.x * (1.0 - f.y) * step(0.5, c10);
  float w01 = (1.0 - f.x) * f.y * step(0.5, c01);
  float w11 = f.x * f.y * step(0.5, c11);
  mask = w00 + w10 + w01 + w11;
  float sum = w00 * decodeSqrt(c00, uHeightMaxM) + w10 * decodeSqrt(c10, uHeightMaxM)
            + w01 * decodeSqrt(c01, uHeightMaxM) + w11 * decodeSqrt(c11, uHeightMaxM);
  heightM = mask > 1e-4 ? sum / mask : 0.0;
}

// Sea depth in metres (water-only mean; a default shallow value where only land is near).
float sampleDepth(vec2 uv) {
  vec2 t = uv * vec2(uBathySize) - 0.5;
  vec2 fl = floor(t);
  vec2 f = t - fl;
  ivec2 i0 = ivec2(fl);
  float c00 = fetchCode(uBathy, uBathySize, i0);
  float c10 = fetchCode(uBathy, uBathySize, i0 + ivec2(1, 0));
  float c01 = fetchCode(uBathy, uBathySize, i0 + ivec2(0, 1));
  float c11 = fetchCode(uBathy, uBathySize, i0 + ivec2(1, 1));
  float w00 = (1.0 - f.x) * (1.0 - f.y) * step(0.5, c00);
  float w10 = f.x * (1.0 - f.y) * step(0.5, c10);
  float w01 = (1.0 - f.x) * f.y * step(0.5, c01);
  float w11 = f.x * f.y * step(0.5, c11);
  float ws = w00 + w10 + w01 + w11;
  float sum = w00 * decodeSqrt(c00, uDepthMaxM) + w10 * decodeSqrt(c10, uDepthMaxM)
            + w01 * decodeSqrt(c01, uDepthMaxM) + w11 * decodeSqrt(c11, uDepthMaxM);
  return ws > 1e-4 ? sum / ws : 30.0;
}

// Biome tone: smooth (cubic B-spline over 4 x 4 cells) mix of the albedo of the LAND cells of the sim class layer.
vec4 bsplineWeights(float f) {
  float f2 = f * f;
  float f3 = f2 * f;
  return vec4(1.0 - 3.0 * f + 3.0 * f2 - f3, 4.0 - 6.0 * f2 + 3.0 * f3, 1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3, f3) / 6.0;
}

vec3 biomeAlbedo(vec2 uv) {
  vec2 t = uv * vec2(uClassSize) - 0.5;
  vec2 fl = floor(t);
  vec2 f = t - fl;
  ivec2 i0 = ivec2(fl) - 1;
  vec4 wx = bsplineWeights(f.x);
  vec4 wy = bsplineWeights(f.y);
  vec3 col = vec3(0.0);
  float ws = 0.0;
  for (int j = 0; j < 4; j++) {
    for (int i = 0; i < 4; i++) {
      int cls = int(fetchCode(uClass, uClassSize, i0 + ivec2(i, j)) + 0.5);
      if (cls >= 2) {
        float w = wx[i] * wy[j];
        col += w * uClassAlbedo[cls];
        ws += w;
      }
    }
  }
  return ws > 1e-4 ? col / ws : uClassAlbedo[2];
}

// Height in Earth radii (exaggerated) of the filtered height texture at a direction.
float exagHeight(vec3 d) {
  float c = texture(uHeight, dirToUv(d)).r;
  return uExag * uHeightMaxM * c * c / (uKmPerUnit * 1000.0);
}

vec3 waterAlbedo(float depthM) {
  vec3 coast = vec3(0.16, 0.58, 0.62);
  vec3 shelf = vec3(0.06, 0.36, 0.58);
  vec3 mid = vec3(0.03, 0.18, 0.42);
  vec3 deep = vec3(0.015, 0.075, 0.27);
  vec3 c = mix(coast, shelf, smoothstep(0.0, 220.0, depthM));
  c = mix(c, mid, smoothstep(150.0, 2500.0, depthM));
  return mix(c, deep, smoothstep(2500.0, 6500.0, depthM));
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Smooth value noise on the hash (the night-light speckle).
float speckNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}

vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }
vec3 toDisplay(vec3 c) { return pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2)); }

void main() {
  vec3 dir = normalize(vDir);
  vec2 uv = dirToUv(dir);
  float latDeg = asin(clamp(dir.y, -1.0, 1.0)) * DEG_PER_RAD;

  float landMask;
  float heightM;
  sampleLand(uv, landMask, heightM);
  float aa = fwidth(landMask) * 0.75 + 0.002;
  float land = smoothstep(0.5 - aa, 0.5 + aa, landMask);

  // Shading normal: the true slope of the exaggerated height field at the resolution of the raster, plus the facet
  // normal from the screen-space derivatives of the displaced mesh (the stylised flat shading), weighted by uFacet.
  vec3 east = abs(dir.y) > 0.9999 ? vec3(1.0, 0.0, 0.0) : normalize(cross(vec3(0.0, 1.0, 0.0), dir));
  vec3 north = cross(dir, east);
  float pixelAngle = length(fwidth(dir));
  float st = max(1.5 * 2.0 * PI / float(uHeightSize.x), 1.5 * pixelAngle);
  // Poleward of the last real elevation row the rasters are radial streaks: their slope is dropped there (capKeep -> 0).
  float capKeep = 1.0 - smoothstep(uPolarCap.x, uPolarCap.y, abs(latDeg));
  float gE = capKeep * (exagHeight(normalize(dir + east * st)) - exagHeight(normalize(dir - east * st))) / (2.0 * st);
  float gN = capKeep * (exagHeight(normalize(dir + north * st)) - exagHeight(normalize(dir - north * st))) / (2.0 * st);
  vec3 detailN = normalize(dir - gE * east - gN * north);
  vec3 flatN = normalize(cross(dFdx(vRel), dFdy(vRel)));
  if (dot(flatN, dir) < 0.0) flatN = -flatN;
  ${facetWeight}
  vec3 shadeN = normalize(detailN + (flatN - dir) * facetW);
  float slope = 1.0 - clamp(dot(shadeN, dir), 0.0, 1.0);

  ${footprint}

  // Land colour (M07b part B): the biome tone (forest green from the Forest class), bare rock on steep faces and above the tree line, snow above a
  // snow line that depends on latitude, on the DETAILED height (vH: ridges catch snow, valleys do not) and on the slope (steep faces shed it,
  // so rock stays grey and ridges stand out). A few multiply-adds: the only noise is the faded fine mottling above (a single call, near views only).
  float hD = ${heightDetailed};
  float aLat = abs(latDeg);
  float snowLine = mix(mix(SNOW_LINE.x, SNOW_LINE.y, smoothstep(SNOW_RAMP_A.x, SNOW_RAMP_A.y, aLat)), SNOW_LINE.z, smoothstep(SNOW_RAMP_A.z, SNOW_RAMP_B.x, aLat))
                 - SNOW_POLAR_DROP * smoothstep(SNOW_RAMP_B.y, SNOW_RAMP_B.z, aLat);
  vec3 albedoLand = uClassAlbedo[2];
  if (landMask > 0.001) albedoLand = biomeAlbedo(uv); // open sea needs none of the 16 class fetches (the land is not drawn there: col = mix(water, land, 0))
  albedoLand *= 1.0 + MOTTLE_COLOR * (mot - 0.5);
  float treeLine = snowLine - TREE_BELOW_SNOW;
  // The REAL slope (tangent of the angle) of the shading normal: the displayed terrain is exaggerated, so its normal is far steeper than the ground
  // (a 17 degree slope is drawn at 74); dividing the tangent by the exaggeration gives back the slope the rock and snow rules are written for.
  float cosS = clamp(dot(shadeN, dir), 0.05, 1.0);
  float tanR = sqrt(max(1.0 - cosS * cosS, 0.0)) / (cosS * uExag);
  float steep = smoothstep(ROCK_SLOPE.x, ROCK_SLOPE.y, tanR);
  float alpine = smoothstep(treeLine - TREE_FADE, treeLine + TREE_FADE, hD);
  float iceKeep = 1.0 - smoothstep(0.82, 0.9, albedoLand.b); // a glacier class stays white: no rock streaks on an ice sheet
  albedoLand *= mix(vec3(1.0), BOREAL_TINT, smoothstep(BOREAL_RAMP.x, BOREAL_RAMP.y, aLat) * iceKeep);
  float bare = max(steep, alpine) * ROCK_STRENGTH * iceKeep;
  vec3 rock = mix(ROCK_WARM, ROCK_COOL, smoothstep(treeLine - 700.0, snowLine, hD));
  rock = mix(rock, albedoLand * 0.85, 0.3) * (1.0 + MOTTLE_COLOR * 0.8 * (mot - 0.5)); // a third of the biome's own tone: brown Mountain cells stay brown
  albedoLand = mix(albedoLand, rock, bare);
  float hSnow = hD - SNOW_SHED * smoothstep(SNOW_SHED_SLOPE.x, SNOW_SHED_SLOPE.y, tanR) + MOTTLE_SNOW * (mot2.y - 0.5);
  float snow = smoothstep(snowLine - SNOW_FADE, snowLine + SNOW_FADE, hSnow);
  albedoLand = mix(albedoLand, SNOW_COLOR, snow);
  float terrainLum = dot(albedoLand, vec3(0.2126, 0.7152, 0.0722)); // before the territory tint: it shades the territory's night glow

  float depthM = mix(uPolarCap.z, sampleDepth(uv), capKeep);
  vec3 albedoWater = waterAlbedo(depthM);
  // Soft shore foam (M07b part B): on the sea side of the coast line, where the land coverage of the raster runs from FOAM_FROM to 0.5; a band that is
  // narrower than a few pixels fades out (orbit views keep the old coast), a ragged edge from the fine mottling.
  float bandPx = FOAM_BAND_M / max(pixelAngle * uKmPerUnit * 1000.0, 1e-3);
  float foam = (1.0 - land) * smoothstep(FOAM_FROM, 0.5, landMask) * smoothstep(1.0, 4.0, bandPx) * FOAM_STRENGTH * (0.65 + 0.7 * mot);
  albedoWater = mix(albedoWater, FOAM_COLOR, clamp(foam, 0.0, 1.0));

  // Country: faint palette tint and a weak border line (between two different land ids; coast against sea is no border).
  int cid = countryAt(dir);
  vec3 pal = paletteColor(cid);
  albedoLand = mix(albedoLand, pal, uCountryTint * step(0.5, float(cid)));
  float border = borderMask(dir, cid);
  vec3 borderCol = mix(vec3(0.06, 0.05, 0.04), pal * 0.45, 0.35);
  albedoLand = mix(albedoLand, borderCol, border * uBorderStrength * (1.0 - snow * 0.5));
  // Territory of the match: tint, inner glow and a sharp organic border line (src/render/shaders/territory.ts).
  ${territoryCall}

  // Lighting (linear space): day factor from the sphere normal, diffuse from the flat normal on land.
  vec3 sun = normalize(uSun);
  float sunDot = dot(dir, sun);
  float day = smoothstep(-0.10, 0.20, sunDot);
  vec3 sunCol = mix(uSunColorLow, uSunColor, smoothstep(0.0, 0.5, sunDot));
  float twilight = exp(-pow(sunDot / uTwilight.x, 2.0)) * uTwilight.y;
  float diffLand = clamp(dot(shadeN, sun), 0.0, 1.0);
  float diffWater = clamp(sunDot, 0.0, 1.0);
  vec3 ambient = mix(uAmbientNight, uAmbientDay, day) + uSunColorLow * twilight * 0.35;

  vec3 viewDir = normalize(-vRel);
  vec3 litLand = toLinear(albedoLand) * (ambient + sunCol * day * (0.12 + 0.95 * diffLand));
  vec3 bodyWater = toLinear(albedoWater) * (ambient + sunCol * day * (0.10 + 0.9 * diffWater));
  // Territory at night: mix the owner's colour into the lit land after the lighting (see territory.ts), so it stays readable in the dark.
  // (M07b part B: the glow is shaded by the terrain colour and the slope, so rock, snow and forest still read at night)
  float nightShade = (0.55 + 0.9 * terrainLum) * clamp(1.15 - slope, 0.5, 1.0);
  litLand = mix(litLand, toLinear(territoryGlow.rgb) * (uOwnerNightLevel * nightShade), territoryGlow.a * (1.0 - day));
  vec3 litWater = oceanColor(bodyWater, dir, viewDir, pixelAngle, sun, day, sunCol);
  vec3 col = mix(litWater, litLand, land);

  // Night lights: emissive on land on the night side, from the CPU-drawn 1024x512 light texture (bilinear).
  float nightF = 1.0 - smoothstep(-0.14, 0.06, sunDot);
  float lightTex = texture(uLights, uv).r;
  // Street-light speckle: SMOOTH value noise (lattice cells of about 4.9 km, and 1.2 km for the close view) instead of the random squares of M02, which
  // showed as a hard checkerboard 2 km above the ground (M07b part B). Faded out when a pixel covers more than about one cell, so it never shimmers and
  // the far view is unchanged; skipped where there is no light to modulate.
  float cellsPerPixel = pixelAngle / (2.0 * PI) * 8192.0;
  float detail = 1.0;
  float speckFade = 1.0 - smoothstep(0.4, 1.6, cellsPerPixel);
  if (speckFade > 0.0 && nightF * land * lightTex > 0.001) {
    float s1 = speckNoise(uv * vec2(8192.0, 4096.0));
    float s2 = speckNoise(uv * vec2(32768.0, 16384.0) + 17.0);
    float sp = clamp(0.5 + 1.5 * (mix(s1, s2, SPECKLE_FINE * (1.0 - smoothstep(0.1, 0.4, cellsPerPixel))) - 0.5), 0.0, 1.0);
    detail = mix(1.0, 0.2 + 1.6 * sp * sp, speckFade);
  }
  col += uLightsColor.rgb * (uLightsColor.a * lightTex * lightTex * detail * nightF * land);

  // Country selection (setup screen): the rest of the world is dimmed a little, the selected country gets a bright outline and a glow.
  if (uSelActive > 0.5) {
    float inside = selectedAt(dir);
    vec3 sm = selectionMask(dir, inside);
    col = mix(col * (1.0 - uSelDim), col, inside);
    col += uSelColor * (sm.y * uSelStyle.w * (inside > 0.5 ? 0.55 : 0.35));
    col = mix(col, uSelColor * 1.6, sm.x * uSelStyle.z);
  }

  // Atmosphere: haze and glow between the camera and this surface point (in linear light).
  vec3 toSurf = vRel;
  float distSurf = length(toSurf);
  vec4 sc = atmosphereScatter(cameraPosition, toSurf / distSurf, distSurf, sun, 6);
  col = col * sc.a + sc.rgb;

  gl_FragColor = vec4(toDisplay(col), 1.0);
${chunkDebug}
}
`;
}

export const terrainFragmentShader = buildTerrainFragmentShader(false);
