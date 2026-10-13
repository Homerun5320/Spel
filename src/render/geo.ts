// Pure geometry helpers of the globe (no three, no DOM): lat/lon <-> vectors, the local east/north frame, the sun,
// the sim cell of a position. World convention: +y north, lon 0 faces +z, +x is east (same as the M00 spike).
import { SIM_HEIGHT, SIM_WIDTH } from '../data/format';
import { SUN_DAY_SECONDS, SUN_DECLINATION_DEG, SUN_LON_AT_T0_DEG } from './config';

export type Vec3 = [number, number, number];

export const DEG = Math.PI / 180;

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = (a: Vec3): number => Math.sqrt(dot(a, a));
export function normalize(a: Vec3): Vec3 {
  const l = length(a);
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 1];
}

/** Rotates `v` about the unit `axis` by `angle` radians (Rodrigues). */
export function rotateAbout(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const k = cross(axis, v);
  const d = dot(axis, v) * (1 - c);
  return [v[0] * c + k[0] * s + axis[0] * d, v[1] * c + k[1] * s + axis[1] * d, v[2] * c + k[2] * s + axis[2] * d];
}

/** Unit vector of a position (degrees). */
export function latLonToVec(latDeg: number, lonDeg: number): Vec3 {
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG;
  return [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)];
}

/** Latitude and longitude (degrees) of a vector; at the exact poles the longitude is 0. */
export function vecToLatLon(v: Vec3): { lat: number; lon: number } {
  const n = normalize(v);
  const lat = Math.asin(Math.max(-1, Math.min(1, n[1]))) / DEG;
  const lon = n[0] === 0 && n[2] === 0 ? 0 : Math.atan2(n[0], n[2]) / DEG;
  return { lat, lon };
}

/** Unit east vector at a longitude. Defined at the poles too (no division). */
export function eastAt(lonDeg: number): Vec3 {
  const lon = lonDeg * DEG;
  return [Math.cos(lon), 0, -Math.sin(lon)];
}

/** Unit north vector at a position. Defined at the poles too (no division). */
export function northAt(latDeg: number, lonDeg: number): Vec3 {
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG;
  return [-Math.sin(lat) * Math.sin(lon), Math.cos(lat), -Math.sin(lat) * Math.cos(lon)];
}

export function wrapLon(lonDeg: number): number {
  let l = (lonDeg + 180) % 360;
  if (l < 0) l += 360;
  return l - 180;
}

/** Sim cell of a position: x = floor((lon+180)/360*1024), y = floor((90-lat)/180*512), clamped to the grid. */
export function latLonToCell(latDeg: number, lonDeg: number): { x: number; y: number; index: number } {
  const x = Math.min(SIM_WIDTH - 1, Math.max(0, Math.floor(((wrapLon(lonDeg) + 180) / 360) * SIM_WIDTH)));
  const y = Math.min(SIM_HEIGHT - 1, Math.max(0, Math.floor(((90 - latDeg) / 180) * SIM_HEIGHT)));
  return { x, y, index: y * SIM_WIDTH + x };
}

/** Longitude of the sub-solar point at fx time `t` (seconds). The sun moves west. */
export function subsolarLonAt(t: number): number {
  return wrapLon(SUN_LON_AT_T0_DEG - (360 * t) / SUN_DAY_SECONDS);
}

/** Unit vector from the globe centre to the sun at fx time `t`. */
export function sunDirectionAt(t: number): Vec3 {
  return latLonToVec(SUN_DECLINATION_DEG, subsolarLonAt(t));
}

/** Fx time in [0, SUN_DAY_SECONDS) at which the sub-solar longitude equals `lonDeg` (for tests and canonical views). */
export function timeForSubsolarLon(lonDeg: number): number {
  let d = (SUN_LON_AT_T0_DEG - lonDeg) % 360;
  if (d < 0) d += 360;
  return (d / 360) * SUN_DAY_SECONDS;
}
