// Territory in the terrain shader: the owner of each sim cell comes from the RGBA8 ownership texture (R+G = ownerId, B =
// flags: bit 0 playable, bit 1 water), its colour from the owner palette LUT. Drawn as a tint of the land albedo, a soft inner
// glow just inside a border and a sharp dark border line about one pixel wide (`dFdx` / `dFdy` of the cell coordinate give the
// size of a pixel in cells, so the line has the same width at every zoom).
//
// Organic borders: the cell lookup position is moved by a domain warp (two octaves of value noise, 4 and 2 cells wide,
// amplitude OWNER_WARP_AMP cells) so that the borders between cells wiggle instead of following the grid. The noise is an
// INTEGER hash (no sin, no fract(sin) tricks: it gives the same value on every GPU) and periodic across the antimeridian.
//
// NIGHT (D108): the tint is multiplied by the lighting, so on the night side a territory would vanish. `applyTerritory` therefore also
// leaves an EMISSIVE term in the global `territoryGlow` (display colour in rgb, weight at full night in a) that terrain.ts mixes into the lit land
// after the lighting, scaled by how dark the pixel is: the interior keeps about a third of the owner's colour, the border line turns
// into a bright rim of that colour (it is dark by day) and a thin halo lights the unowned land just outside the border.
//
// The albedo is only changed here; the caller blends land and water with the land mask afterwards, so a territory is drawn
// only where the height texture says land. A sim cell that is water while the 10 km render raster is land (a coast) takes the
// owner of its nearest land neighbour, and a border is never drawn against sea.

export const GLSL_TERRITORY = /* glsl */ `
uniform sampler2D uOwnerTex;
uniform sampler2D uOwnerPalette;
uniform ivec2 uOwnerSize;
uniform vec4 uOwnerStyle; // x tint, y inner glow, z line strength, w line width in pixels
uniform vec2 uOwnerWarp;  // x warp amplitude in cells, y line darkening factor
uniform vec4 uOwnerNight; // x interior weight, y rim weight, z halo weight, w halo width in pixels
uniform float uOwnerNightLevel; // brightness (linear) of the owner colour where the weight is 1

float ownerHash(ivec2 i, int periodX) {
  uint x = uint(i.x & (periodX - 1));
  uint y = uint(i.y);
  uint h = x * 0x27d4eb2fu + y * 0x165667b1u;
  h ^= h >> 15;
  h *= 0x85ebca6bu;
  h ^= h >> 13;
  h *= 0xc2b2ae35u;
  h ^= h >> 16;
  return float(h & 0xffffu) / 65535.0;
}

float ownerNoise(vec2 p, int periodX) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  ivec2 ii = ivec2(i);
  float a = ownerHash(ii, periodX);
  float b = ownerHash(ii + ivec2(1, 0), periodX);
  float c = ownerHash(ii + ivec2(0, 1), periodX);
  float d = ownerHash(ii + ivec2(1, 1), periodX);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Warped lookup position in cells. Octave 1 has a period of 4 cells (256 noise units over the 1024 columns), octave 2 of 2 cells.
vec2 ownerWarp(vec2 p) {
  vec2 q1 = p * 0.25;
  vec2 q2 = p * 0.5;
  float w1x = ownerNoise(q1, 256) - 0.5;
  float w1y = ownerNoise(q1 + vec2(0.0, 137.0), 256) - 0.5;
  float w2x = ownerNoise(q2 + vec2(0.0, 59.0), 512) - 0.5;
  float w2y = ownerNoise(q2 + vec2(0.0, 211.0), 512) - 0.5;
  return p + uOwnerWarp.x * (vec2(w1x, w1y) * 1.2 + vec2(w2x, w2y) * 0.55);
}

// The ownerId of a cell (texel); flags in bit field out.
int ownerCell(ivec2 c, out int flags) {
  c.x = c.x - uOwnerSize.x * int(floor(float(c.x) / float(uOwnerSize.x)));
  c.y = clamp(c.y, 0, uOwnerSize.y - 1);
  vec4 t = texelFetch(uOwnerTex, c, 0);
  flags = int(t.b * 255.0 + 0.5);
  return int(t.r * 255.0 + 0.5) + 256 * int(t.g * 255.0 + 0.5);
}

// Owner under a (warped) position. isSea is true for a water cell with no land neighbour; a water cell next to land takes the
// owner of the land cell nearest to the position (the render raster is four times finer than the sim cells).
int territoryOwner(vec2 pw, out bool isSea) {
  ivec2 c = ivec2(floor(pw));
  int fl;
  int id = ownerCell(c, fl);
  isSea = false;
  if ((fl & 2) != 0) {
    vec2 f = fract(pw) - 0.5;
    ivec2 sx = ivec2(f.x >= 0.0 ? 1 : -1, 0);
    ivec2 sy = ivec2(0, f.y >= 0.0 ? 1 : -1);
    int fn;
    int n = ownerCell(c + sx, fn);
    if ((fn & 2) != 0) n = ownerCell(c + sy, fn);
    if ((fn & 2) != 0) n = ownerCell(c - sx, fn);
    if ((fn & 2) != 0) n = ownerCell(c - sy, fn);
    if ((fn & 2) != 0) {
      isSea = true;
      return 0;
    }
    return n;
  }
  return id;
}

// 0..1: the share of four taps (at +-offset along both screen axes) that lie in a different territory (sea does not count).
float territoryEdge(vec2 pw, vec2 dx, vec2 dy, int id) {
  bool s;
  float n = 0.0;
  int a = territoryOwner(pw + dx, s); n += (!s && a != id) ? 1.0 : 0.0;
  int b = territoryOwner(pw - dx, s); n += (!s && b != id) ? 1.0 : 0.0;
  int c = territoryOwner(pw + dy, s); n += (!s && c != id) ? 1.0 : 0.0;
  int d = territoryOwner(pw - dy, s); n += (!s && d != id) ? 1.0 : 0.0;
  return n * 0.25;
}

// Tints the land albedo (display space) with the territory under the uv and leaves the night glow in territoryGlow. Must be called from uniform control flow (derivatives); landMask is the land fraction of the pixel (0 = open sea skips all the work).
// (the glow is a file-scope variable, not an output parameter: the shader source test forbids our own declarations of that kind)
vec4 territoryGlow = vec4(0.0);
vec3 applyTerritory(vec3 albedo, vec2 uv, float landMask) {
  territoryGlow = vec4(0.0);
  vec2 p0 = uv * vec2(uOwnerSize);
  vec2 dx = dFdx(p0);
  vec2 dy = dFdy(p0);
  // the longitude jump of atan at the antimeridian must not look like a huge step
  float w = float(uOwnerSize.x);
  dx.x -= w * floor(dx.x / w + 0.5);
  dy.x -= w * floor(dy.x / w + 0.5);
  dx = clamp(dx, vec2(-8.0), vec2(8.0));
  dy = clamp(dy, vec2(-8.0), vec2(8.0));
  if (landMask < 0.001) return albedo; // open sea: nothing to tint (the derivatives above were taken in uniform control flow)
  vec2 pw = ownerWarp(p0);
  bool sea;
  int id = territoryOwner(pw, sea);
  if (id == 0) {
    // Unowned land: a thin halo of the colour of a territory within uOwnerNight.w pixels, visible at night only.
    vec2 hx = dx * uOwnerNight.w;
    vec2 hy = dy * uOwnerNight.w;
    bool s2;
    int a = territoryOwner(pw + hx, s2);
    int b = territoryOwner(pw - hx, s2);
    int c = territoryOwner(pw + hy, s2);
    int d = territoryOwner(pw - hy, s2);
    int near = a != 0 ? a : (b != 0 ? b : (c != 0 ? c : d));
    if (near != 0) {
      float cnt = float(a != 0) + float(b != 0) + float(c != 0) + float(d != 0);
      territoryGlow = vec4(texelFetch(uOwnerPalette, ivec2(near & 255, 0), 0).rgb, uOwnerNight.z * clamp(cnt * 0.5, 0.0, 1.0));
    }
    return albedo;
  }
  float line = territoryEdge(pw, dx * (0.5 * uOwnerStyle.w), dy * (0.5 * uOwnerStyle.w), id);
  float inner = 0.5 * (territoryEdge(pw, dx * 2.5, dy * 2.5, id) + territoryEdge(pw, dx * 5.0, dy * 5.0, id));
  vec3 col = texelFetch(uOwnerPalette, ivec2(id & 255, 0), 0).rgb;
  float fill = uOwnerStyle.x + uOwnerStyle.y * inner;
  vec3 outAlbedo = mix(albedo, col, fill);
  float lineW = clamp(line * 3.0, 0.0, 1.0) * uOwnerStyle.z;
  outAlbedo = mix(outAlbedo, col * uOwnerWarp.y, lineW);
  // night: interior colour, with a bright rim on the border line (a lightened owner colour)
  vec3 rim = mix(col, vec3(1.0), 0.45);
  territoryGlow = vec4(mix(col, rim, lineW), mix(uOwnerNight.x * (0.8 + 0.5 * inner), uOwnerNight.y, lineW));
  return outAlbedo;
}
`;
