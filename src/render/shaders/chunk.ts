// The vertex shader of the terrain chunks (M07a). One shared grid mesh, drawn once per chunk instance. Every vertex is placed
// RELATIVE TO THE CAMERA and relative to its chunk's centre, never from absolute float32 world coordinates:
//
//   rel = originRel + offset * r + up * h          (originRel = chunk centre minus camera, formed from high and low parts)
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
uniform vec3 uCamHi; // the camera position as a float32 and what it left out (the high and the low part)
uniform vec3 uCamLo;
uniform vec2 uSkirt; // x: depth, y: outward lean, both in grid cells of the chunk's own level (times 2^d where the neighbour is d levels coarser)

attribute vec4 aOrigin; // xyz: the low part of the chunk centre direction (what the float32 in aUp left out); w: level
attribute vec4 aUp;     // xyz: centre direction (the high part); w: the size of one grid cell (Earth radii)
attribute vec4 aEast;   // xyz: east at the centre; w: debug hue
attribute vec4 aGeo;    // x: centre latitude, y: latitude extent, z: longitude extent, w: centre longitude (radians)
attribute vec4 aNeigh;  // levels the neighbour across the west, east, north, south edge is coarser

varying vec3 vDir;
varying vec3 vRel;
varying vec4 vChunk; // x hue, y level, zw grid position
varying float vWall;  // 1 on a skirt wall, 0 on the grid

const float TWO_PI = 6.283185307179586;
const float PI_ = 3.141592653589793;

void main() {
  vec2 g = position.xy;
  float wallFlag = position.z; // 0 grid, 1 wall bottom (displaced), 2 wall top (stays at the rim)
  float dlon = (g.x - 0.5) * aGeo.z;
  float dphi = (0.5 - g.y) * aGeo.y;
  float phi = aGeo.x + dphi;
  // Two sines per vertex: the half angles. Everything else follows from them (the centre latitude's sine and cosine come from the
  // centre direction: its y and the length of its x / z).
  float sdl = sin(0.5 * dlon);
  float sdp = sin(0.5 * dphi);
  float cdl = sqrt(max(1.0 - sdl * sdl, 0.0));
  float cdp = sqrt(max(1.0 - sdp * sdp, 0.0));
  float sinC = aUp.y;
  float cosC = length(aUp.xz);
  float sdphi = 2.0 * sdp * cdp; // sin(dphi)
  float cphi = cosC * (1.0 - 2.0 * sdp * sdp) - sinC * sdphi; // cos(latitude of the vertex)
  // The offset of the vertex direction from the centre direction, in the centre's east / north / up frame.
  float oe = cphi * (2.0 * sdl * cdl);
  float on = sdphi + 2.0 * cphi * sinC * sdl * sdl;
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
  // chunk centre minus camera, in two parts: (hi - hi) is exact next to the camera, (lo - lo) carries the rest
  vec3 originRel = (aUp.xyz - uCamHi) + (aOrigin.xyz - uCamLo);
  vec3 rel = originRel + off * r + up * h;
  vec3 rim = rel; // where the terrain is: everything the fragment shader derives (view direction, haze, flat normal) is taken here, also on a wall
  if (wallFlag > 0.5 && wallFlag < 1.5) {
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
  vRel = rim;
  vWall = wallFlag > 0.5 ? 1.0 : 0.0;
  vChunk = vec4(aEast.w, aOrigin.w, g);
  gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * rel, 1.0); // the wall's own displacement moves only where it is drawn
}
`;
