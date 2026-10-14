// The vertex shader of the terrain chunks (M07a). One shared grid mesh, drawn once per chunk instance. Every vertex is placed
// RELATIVE TO THE CAMERA and relative to its chunk's centre, never from absolute float32 world coordinates:
//
//   rel = originRel + offset * r + up * h          (originRel = chunk centre minus camera, formed in float64 on the CPU)
//
// where offset = (direction of the vertex) - (direction of the chunk centre), evaluated in a form that has no subtraction of two
// nearly equal numbers (half-angle sines), r = 1 + h, h = the radial displacement from the height texture in Earth radii. The
// view matrix is used for its rotation only (mat3), so the translation that float32 cannot carry at 300 m above the ground never
// enters. The fragment shader gets the same camera-relative position in `vRel` (its derivatives give the flat-shaded normal) and the
// direction of the point in `vDir` (the texture lookups; a float32 direction is good to about a metre, the rasters are 10 km).
// Pure maths of the offset lives in chunkMath.ts (`vertexRelFloat32` mirrors this code operation by operation).
import { POLE_HEIGHT_U } from '../geo';

function glslFloat(x: number): string {
  const t = String(x);
  return /[.e]/.test(t) ? t : `${t}.0`;
}

export const chunkVertexShader = /* glsl */ `
uniform sampler2D uHeight;
uniform float uHeightMaxM;
uniform float uExag;
uniform float uKmPerUnit;
uniform float uSkirtsOn;
uniform vec2 uSkirt; // x: depth, y: outward lean, both in grid cells of the chunk's own level (times 2^d where the neighbour is d levels coarser)

attribute vec4 aOrigin; // xyz: chunk centre (unit sphere) minus the camera; w: level
attribute vec4 aUp;     // xyz: centre direction; w: the size of one grid cell (Earth radii)
attribute vec4 aEast;   // xyz: east at the centre; w: debug hue
attribute vec4 aGeo;    // x: centre latitude, y: latitude extent, z: longitude extent, w: centre longitude (radians)
attribute vec4 aNeigh;  // levels the neighbour across the west, east, north, south edge is coarser

varying vec3 vDir;
varying vec3 vRel;
varying vec4 vChunk; // x hue, y level, zw grid position

const float TWO_PI = 6.283185307179586;
const float PI_ = 3.141592653589793;

void main() {
  vec2 g = position.xy;
  float skirt = position.z;
  float dlon = (g.x - 0.5) * aGeo.z;
  float dphi = (0.5 - g.y) * aGeo.y;
  float phi = aGeo.x + dphi;
  float cphi = cos(phi);
  float sdl = sin(0.5 * dlon);
  float sdp = sin(0.5 * dphi);
  float sinC = sin(aGeo.x);
  float cosC = cos(aGeo.x);
  // The offset of the vertex direction from the centre direction, in the centre's east / north / up frame.
  float oe = cphi * sin(dlon);
  float on = sin(dphi) + 2.0 * cphi * sinC * sdl * sdl;
  float ou = 2.0 * (sdp * sdp + cphi * cosC * sdl * sdl); // 1 - dot(direction, centre)
  vec3 east = aEast.xyz;
  vec3 up = aUp.xyz;
  vec3 north = cross(up, east);
  vec3 off = east * oe + north * on - up * ou;
  // Height at the vertex: the raster is addressed by longitude / latitude fractions; the pole rows read one common longitude.
  float u = aGeo.w / TWO_PI + 0.5 + (g.x - 0.5) * aGeo.z / TWO_PI;
  float v = 0.5 - phi / PI_;
  vec2 hUv = (v <= 1e-6 || v >= 1.0 - 1e-6) ? vec2(${glslFloat(POLE_HEIGHT_U)}, clamp(v, 0.0, 1.0)) : vec2(u, v);
  float code = textureLod(uHeight, hUv, 0.0).r;
  float hM = uHeightMaxM * code * code;
  float h = uExag * hM / (uKmPerUnit * 1000.0);
  float r = 1.0 + h;
  vec3 dir = up + off;
  vec3 rel = aOrigin.xyz + off * r + up * h;
  if (skirt > 0.5) {
    // The wall hangs under the rim and leans outward: deeper where the neighbour across this edge is coarser (its straight edge can
    // sit lower), and leaning so that a camera looking straight down still sees it (a hairline gap between two chunks is covered).
    float nd = 0.0;
    float sx = 0.0;
    float sy = 0.0;
    if (g.x < 0.001) { nd = max(nd, aNeigh.x); sx -= 1.0; }
    if (g.x > 0.999) { nd = max(nd, aNeigh.y); sx += 1.0; }
    if (g.y < 0.001) { nd = max(nd, aNeigh.z); sy += 1.0; }
    if (g.y > 0.999) { nd = max(nd, aNeigh.w); sy -= 1.0; }
    float k = aUp.w * exp2(nd) * uSkirtsOn;
    rel += (east * sx + north * sy) * (k * uSkirt.y) - dir * (k * uSkirt.x);
  }
  vDir = dir;
  vRel = rel;
  vChunk = vec4(aEast.w, aOrigin.w, g);
  gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * rel, 1.0);
}
`;
