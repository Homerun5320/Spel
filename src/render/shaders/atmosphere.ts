// Atmosphere: one single-scattering function shared by the terrain shader (haze between the camera and the surface, the
// glow on the disc near the limb) and the back-face additive shell (the glow around the limb, in front of space).
// Everything is analytic or an 8-step march: no textures. World units are Earth radii, the planet is the unit sphere.

/** Uniforms and `atmosphereScatter`. The including shader must declare nothing else for it. */
export const GLSL_ATMOSPHERE = /* glsl */ `
uniform float uAtmoTop;
uniform float uAtmoScaleH;
uniform float uAtmoStrength;
uniform float uAtmoExtinction;
uniform vec3 uAtmoColor;
uniform vec3 uAtmoDusk;

// Single scattering along the ray ro + t * rd for t in [0, tMax] (clipped to the shell of radius uAtmoTop).
// Returns in-scattered radiance in rgb (linear) and the transmittance of the path in a.
vec4 atmosphereScatter(vec3 ro, vec3 rd, float tMax, vec3 sun, int steps) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - uAtmoTop * uAtmoTop;
  float disc = b * b - c;
  if (disc <= 0.0) return vec4(0.0, 0.0, 0.0, 1.0);
  float sq = sqrt(disc);
  float t0 = max(-b - sq, 0.0);
  float t1 = min(-b + sq, tMax);
  if (t1 <= t0) return vec4(0.0, 0.0, 0.0, 1.0);
  float dt = (t1 - t0) / float(steps);
  vec3 sum = vec3(0.0);
  float od = 0.0;
  for (int i = 0; i < 16; i++) {
    if (i >= steps) break;
    float t = t0 + (float(i) + 0.5) * dt;
    vec3 p = ro + rd * t;
    float r = length(p);
    float alt = max(r - 1.0, 0.0);
    float dens = exp(-alt / uAtmoScaleH);
    float up = dot(p, sun) / r;
    // Is the sun ray from p blocked by the planet? Distance of that ray to the centre against the unit sphere.
    float perp = r * sqrt(max(1.0 - up * up, 0.0));
    // Continuous across up = 0 (a hard step there would draw a line on the sea at dusk).
    float lit = max(smoothstep(0.985, 1.025, perp), smoothstep(-0.08, 0.06, up));
    float dusk = 1.0 - smoothstep(0.02, 0.5, up);
    vec3 tint = mix(uAtmoColor, uAtmoDusk, dusk * dusk);
    sum += tint * (dens * dt * lit * (0.55 + 0.45 * smoothstep(-0.2, 0.6, up)));
    od += dens * dt;
  }
  return vec4(sum * uAtmoStrength, exp(-od * uAtmoExtinction));
}
`;

export const atmosphereVertexShader = /* glsl */ `
varying vec3 vWorld;
void main() {
  vWorld = position;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;

/** The shell is drawn with BackSide and additive blending (ONE, ONE): what it adds is the glow, in display space. */
export const atmosphereFragmentShader = /* glsl */ `
uniform vec3 uSun;
varying vec3 vWorld;
${GLSL_ATMOSPHERE}

void main() {
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vWorld - ro);
  // Stop at the planet when the ray hits it (those fragments lie behind the globe and fail the depth test anyway).
  float b = dot(ro, rd);
  float c = dot(ro, ro) - 1.0;
  float disc = b * b - c;
  float tMax = 1.0e9;
  if (disc > 0.0) {
    float tp = -b - sqrt(disc);
    if (tp > 0.0) tMax = tp;
  }
  vec4 s = atmosphereScatter(ro, rd, tMax, normalize(uSun), 10);
  vec3 col = pow(clamp(s.rgb, 0.0, 1.0), vec3(1.0 / 2.2));
  gl_FragColor = vec4(col, 1.0);
}
`;
