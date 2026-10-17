// The shaders of the front arrows (M20a-2). One instanced arrow per attack: the position arrives as a two-part float32 pair (hi + lo, Earth radii) and is made camera-relative
// in the shader (docs/ARCHITECTURE.md "Rules for layers", (1)); the arrow lies in the tangent plane, its tip on the front cell and its tail towards the attacker's land.
// A front behind the horizon is moved out of the clip volume here, so the CPU does nothing per frame but set uniforms.

export const frontVertexShader = /* glsl */ `
uniform vec3 uCamHi;
uniform vec3 uCamLo;
uniform float uTime;
uniform float uFade;
uniform float uKmPerUnit;
uniform float uPxK;
uniform float uMinM;
uniform float uPulseRate;
uniform float uPulseDepth;
attribute vec3 aHi;
attribute vec3 aLo;
attribute vec2 aDir;
attribute vec4 aStyle;
attribute float aPart;
varying vec4 vColor;
void main() {
  vec3 centre = aHi + aLo;
  vec3 cam = uCamHi + uCamLo;
  vec3 up = normalize(centre);
  float seen = step(1.0, dot(up, cam));
  vec3 east = cross(vec3(0.0, 1.0, 0.0), up);
  float el = length(east);
  east = el > 1e-4 ? east / el : vec3(1.0, 0.0, 0.0);
  vec3 north = cross(up, east);
  vec3 fwd = east * aDir.x + north * aDir.y;
  vec3 side = cross(up, fwd);
  vec3 rel0 = (aHi - uCamHi) + (aLo - uCamLo);
  float distM = length(rel0) * uKmPerUnit * 1000.0;
  float size = max(uMinM, distM * uPxK) * mix(0.7, 1.0, aStyle.w) / (uKmPerUnit * 1000.0);
  vec3 rel = rel0 + (side * position.x + fwd * position.z) * size;
  float pulse = 1.0 - uPulseDepth + uPulseDepth * sin(uTime * uPulseRate + dot(centre, vec3(31.0, 17.0, 5.0)) * 100.0);
  float alpha = uFade * aStyle.w * pulse * seen;
  // the first nine vertices are the dark outline, the next nine the fill (an arrow of the owner's colour would vanish on that owner's own land)
  vColor = aPart < 0.5 ? vec4(0.03, 0.05, 0.1, alpha * 0.9) : vec4(mix(aStyle.rgb, vec3(1.0), 0.45), alpha);
  gl_Position = seen > 0.5 ? projectionMatrix * vec4(mat3(viewMatrix) * rel, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
}
`;

export const frontFragmentShader = /* glsl */ `
varying vec4 vColor;
void main() {
  gl_FragColor = vColor;
}
`;
