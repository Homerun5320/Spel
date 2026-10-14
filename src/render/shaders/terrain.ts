// The globe shader: displaced lat/lon grid, derivative flat shading, hypsometric colours with snow, biome tone from the
// sim class layer, coast colour from bathymetry and a coast line shaded from the land mask per fragment (so a coarse mesh
// never gives a wrong coast line; M07 replaces the mesh with an LOD). Item 3 and 4 pieces come from their own modules:
// ocean (waves, Fresnel, glitter), atmosphere (haze and limb glow), borders (id raster neighbour comparison). Night lights
// are an emissive term of the day/night terminator.
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
 * The terrain fragment shader. With `chunk` it also declares the debug colouring of the chunk terrain (`?chunks=1`: a flat colour
 * per chunk with a darker rim, so the chunks and their levels can be seen); the fixed mesh has no such uniform.
 */
export function buildTerrainFragmentShader(chunk: boolean): string {
  const chunkDecl = chunk ? 'uniform float uChunkDebug;\nuniform float uChunkCells;\nvarying vec4 vChunk;\nvarying float vWall;\nflat varying vec2 vCellBase;\nvarying vec2 vCellOff;' : '';
  // The facet normal is the stylised flat shading of the mesh. A mesh cell much smaller than a raster texel only shows the texel
  // grid of the bilinear height field (blocky streaks), so the facet weight fades out below four texels per cell (the fixed mesh
  // and the orbit-level chunks have 8 or more and keep the full weight; the slope normal already carries the finer relief).
  const facetWeight = chunk
    ? `float cellTexels = (1.5707963 / exp2(vChunk.y) / uChunkCells) / (2.0 * PI / float(uHeightSize.x));
  // (the east-west width of a cell shrinks with the cosine of the latitude: near a pole the cells are slivers a hundredth of a texel wide)
  float facetW = uFacet * clamp(cellTexels * length(dir.xz) * 0.25, 0.0, 1.0);
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
    ? `vec2 ownerCells = vec2(uOwnerSize);
  float invCos = 1.0 / max(length(dir.xz), 1e-3);
  vec3 tpx = dFdx(vRel);
  vec3 tpy = dFdy(vRel);
  vec2 cpx = vec2(dot(tpx, east) * invCos, -dot(tpx, north)) * ownerCells * vec2(0.5 / PI, 1.0 / PI);
  vec2 cpy = vec2(dot(tpy, east) * invCos, -dot(tpy, north)) * ownerCells * vec2(0.5 / PI, 1.0 / PI);
  albedoLand = applyTerritoryAt(albedoLand, ivec2(floor(vCellBase + 0.5)), vCellOff, cpx, cpy, landMask);`
    : 'albedoLand = applyTerritory(albedoLand, uv, landMask);';
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

  // Land colour: biome tone, bare rock on steep faces and high ground, snow above a latitude dependent snow line.
  vec3 rock = vec3(0.42, 0.38, 0.34);
  vec3 albedoLand = biomeAlbedo(uv);
  albedoLand = mix(albedoLand, rock, smoothstep(0.05, 0.30, slope) * 0.65);
  albedoLand = mix(albedoLand, rock * 1.15, smoothstep(1800.0, 4200.0, heightM) * 0.7);
  float snowLine = mix(6900.0, 1300.0, smoothstep(8.0, 65.0, abs(latDeg)));
  float snow = smoothstep(snowLine - 350.0, snowLine + 350.0, heightM) * (1.0 - smoothstep(0.25, 0.6, slope) * 0.5);
  albedoLand = mix(albedoLand, vec3(0.94, 0.96, 1.0), snow);

  float depthM = mix(uPolarCap.z, sampleDepth(uv), capKeep);
  vec3 albedoWater = waterAlbedo(depthM);

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
  litLand = mix(litLand, toLinear(territoryGlow.rgb) * uOwnerNightLevel, territoryGlow.a * (1.0 - day));
  vec3 litWater = oceanColor(bodyWater, dir, viewDir, pixelAngle, sun, day, sunCol);
  vec3 col = mix(litWater, litLand, land);

  // Night lights: emissive on land on the night side, from the CPU-drawn 1024x512 light texture (bilinear).
  float nightF = 1.0 - smoothstep(-0.14, 0.06, sunDot);
  float lightTex = texture(uLights, uv).r;
  // Street-light speckle (about 5 km cells), faded out when a pixel covers more than about one cell so it never shimmers.
  float cellsPerPixel = pixelAngle / (2.0 * PI) * 8192.0;
  float speck = hash12(floor(uv * vec2(8192.0, 4096.0)));
  float detail = mix(1.0, 0.2 + 1.6 * speck * speck, 1.0 - smoothstep(0.4, 1.6, cellsPerPixel));
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
