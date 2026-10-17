// Ocean: animated wave normals (a sum of plane waves on the sphere, faded out when their wavelength gets close to the
// pixel size), Fresnel reflection of a simple sky, and sun glitter (a broad stylised patch plus tight sparkles).
// The animation time is the fx clock, so in `?test=1` the normals are frozen.

export const GLSL_OCEAN = /* glsl */ `
uniform float uTime;
uniform float uWaveSlope;
uniform float uOceanF0;
uniform vec4 uSpec; // x broad strength, y broad exponent, z tight strength, w tight exponent
uniform vec3 uSkyHorizon;
uniform vec3 uSkyZenith;
uniform vec3 uSkyNight;

const int WAVE_COUNT = 8;

// Perturbed surface normal of the sea at a direction. pixelAngle = angle in radians covered by one pixel.
vec3 oceanNormal(vec3 dir, float pixelAngle, float t) {
  vec3 g = vec3(0.0);
  float amp = uWaveSlope;
  float k = 260.0;
  for (int i = 0; i < WAVE_COUNT; i++) {
    float fi = float(i);
    float a = fi * 2.399963;
    float bb = fi * 1.31 + 0.7;
    vec3 kd = vec3(cos(a) * sin(bb), cos(bb), sin(a) * sin(bb));
    float omega = (0.25 + 0.04 * sqrt(k)) * (mod(fi, 2.0) < 0.5 ? 1.0 : -0.8);
    // A slow warp of the phase breaks the plane waves into irregular crests.
    float warp = 2.2 * sin(k * 0.21 * dot(kd.zxy, dir) + 1.3 * fi) + 1.4 * sin(k * 0.13 * dot(kd.yzx, dir) + 0.4 * omega * t);
    float phase = k * dot(kd, dir) + omega * t + fi * 1.7 + warp;
    float periodPx = 6.2831853 / (k * max(pixelAngle, 1.0e-7));
    float fade = smoothstep(16.0, 56.0, periodPx);
    g += kd * (amp * fade * cos(phase));
    amp *= 0.8;
    k *= 1.75;
  }
  g -= dot(g, dir) * dir;
  return normalize(dir - g);
}

// Colour of the sky seen in the direction r above the local horizon of a surface point (linear).
vec3 skyColor(vec3 r, vec3 dir, float day) {
  float up = clamp(dot(r, dir), 0.0, 1.0);
  vec3 daySky = mix(uSkyHorizon, uSkyZenith, smoothstep(0.0, 0.75, up));
  return mix(uSkyNight, daySky, day);
}

// Water surface colour. body = lit water body colour (linear), V = unit vector to the camera, sun = unit sun vector,
// day = 0..1 daylight factor, sunColor = light colour. Returns the final linear colour.
vec3 oceanColor(vec3 body, vec3 dir, vec3 V, float pixelAngle, vec3 sun, float day, vec3 sunColor) {
  vec3 n = oceanNormal(dir, pixelAngle, uTime);
  float cosv = clamp(dot(n, V), 0.0, 1.0);
  float fres = uOceanF0 + (1.0 - uOceanF0) * pow(1.0 - cosv, 5.0);
  vec3 r = reflect(-V, n);
  vec3 sky = skyColor(r, dir, day);
  float rl = max(dot(r, sun), 0.0);
  float glint = uSpec.x * pow(rl, uSpec.y) + uSpec.z * pow(rl, uSpec.w);
  glint *= smoothstep(0.0, 0.12, dot(dir, sun)) * mix(0.45, 1.0, fres);
  return mix(body, sky, fres) + sunColor * glint;
}
`;
