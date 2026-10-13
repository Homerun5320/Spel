// Country borders from the id raster: a neighbour comparison of the NEAREST-filtered ids at four taps around the pixel
// (half a pixel of screen-space derivative of the direction away, so the line is about one pixel wide at every zoom and
// there is no seam at the antimeridian). Coast against sea is not a border: id 0 (sea) never counts.

export const GLSL_BORDERS = /* glsl */ `
uniform sampler2D uCountry;
uniform sampler2D uPalette;
uniform ivec2 uCountrySize;
uniform float uBorderStrength;
uniform float uCountryTint;

int countryAt(vec3 d) {
  vec2 uv = dirToUv(d);
  ivec2 p = ivec2(floor(uv * vec2(uCountrySize)));
  p.x = p.x - uCountrySize.x * int(floor(float(p.x) / float(uCountrySize.x)));
  p.y = clamp(p.y, 0, uCountrySize.y - 1);
  return int(texelFetch(uCountry, p, 0).r * 255.0 + 0.5);
}

vec3 paletteColor(int id) {
  return texelFetch(uPalette, ivec2(id, 0), 0).rgb;
}

// 0..1: how much of the pixel lies on a land border (between two different non-zero ids).
float borderMask(vec3 dir, int centre) {
  if (centre == 0) return 0.0;
  vec3 dx = dFdx(dir) * 0.7;
  vec3 dy = dFdy(dir) * 0.7;
  int a = countryAt(normalize(dir + dx));
  int b = countryAt(normalize(dir - dx));
  int c = countryAt(normalize(dir + dy));
  int d = countryAt(normalize(dir - dy));
  float n = 0.0;
  n += (a != 0 && a != centre) ? 1.0 : 0.0;
  n += (b != 0 && b != centre) ? 1.0 : 0.0;
  n += (c != 0 && c != centre) ? 1.0 : 0.0;
  n += (d != 0 && d != centre) ? 1.0 : 0.0;
  return clamp(n * 0.5, 0.0, 1.0);
}
`;
