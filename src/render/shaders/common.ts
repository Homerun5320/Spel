// GLSL chunks shared by the shader modules. GLSL ES 3.00 through three's ShaderMaterial: write `gl_FragColor`
// (three maps it to its own output), never declare an `out vec4`; `texture2D` is mapped to `texture` by three, but this
// code uses the 3.00 names (`texelFetch`, `textureLod`) directly.

/** Mapping between a unit direction and the equirectangular rasters (row 0 = north, column 0 = longitude -180). */
export const GLSL_GEO = /* glsl */ `
const float PI = 3.14159265359;
const float DEG_PER_RAD = 57.29577951308232;

vec2 dirToUv(vec3 d) {
  float lon = atan(d.x, d.z);
  float lat = asin(clamp(d.y, -1.0, 1.0));
  return vec2(lon / (2.0 * PI) + 0.5, 0.5 - lat / PI);
}
`;

/** Texel access with longitude wrap and latitude clamp, plus the sqrt decode of the packs (maxima come from meta.json). */
export const GLSL_TEXELS = /* glsl */ `
float fetchCode(sampler2D tex, ivec2 size, ivec2 p) {
  p.x = p.x - size.x * int(floor(float(p.x) / float(size.x)));
  p.y = clamp(p.y, 0, size.y - 1);
  return texelFetch(tex, p, 0).r * 255.0;
}

float decodeSqrt(float code, float maxM) {
  float f = code / 255.0;
  return maxM * f * f;
}
`;
