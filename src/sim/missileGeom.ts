// The flight of a missile (M14a): pure integer geometry on the unit sphere. No trig, no asin: a cell becomes a unit vector through the Q15 sine table, the range is a CHORD compared
// with a table, the flight time comes from the arc length found by a search in a chord table, and the position walks the great circle at a constant angular speed (cos / sin of the angle flown).
//
// Units: a vector component is Q15 (32768 = 1). An angle is in angle units (65536 = a full turn, so the arc between two cells is at most 32768). `chord` is the Q15 length of the straight
// line between two unit vectors (0..65536). The reference cell of the plan (a 1024-cell equator) is MISSILE_REF_CELL_ANGLE = 64 units.
import { ANGLE_QUARTER, ANGLE_TURN, cosQ15, floorDiv, isqrt, mulQ15, sinQ15 } from './detmath';
import { MISSILE_RANGE_ANGLE, MISSILE_SPEED_ANGLE_PER_TICK } from './rules';

/** One reference cell in angle units. */
export const MISSILE_REF_CELL_ANGLE = 64;
/** Steps of the chord table: one per reference cell over half a turn. */
const CHORD_STEPS = 512;

/** CHORD_AT[k] = the chord of an arc of k reference cells = 2 sin(k x 32 units), Q15. Strictly increasing up to 65536. */
const CHORD_AT = new Int32Array(CHORD_STEPS + 1);
for (let k = 0; k <= CHORD_STEPS; k++) CHORD_AT[k] = 2 * sinQ15(k * (MISSILE_REF_CELL_ANGLE >> 1));

/** The chord of each class's range (0 = unlimited). */
export const RANGE_CHORD: readonly number[] = MISSILE_RANGE_ANGLE.map((a) => (a === 0 ? 0 : 2 * sinQ15(a >> 1)));

/** Writes the unit vector of the centre of `cell` (Q15 x, y, z) into out[o..o+2]. x points at lon 0, z at the north pole. */
export function cellVector(cell: number, width: number, height: number, out: Int32Array, o: number): void {
  const cx = cell % width;
  const cy = (cell - cx) / width;
  const lon = floorDiv((2 * cx + 1) * ANGLE_TURN, 2 * width);
  const lat = floorDiv((height - 2 * cy - 1) * ANGLE_QUARTER, height);
  const c = cosQ15(lat);
  out[o] = mulQ15(c, cosQ15(lon));
  out[o + 1] = mulQ15(c, sinQ15(lon));
  out[o + 2] = sinQ15(lat);
}

/**
 * The inverse of `cellVector` (M14b): the cell a unit vector (Q15 x, y, z) is over. Integer only, no trig: the row is the first one whose southern edge lies at or below z (a binary search in the
 * sine table of the edge latitudes), the column the last one whose western edge is at or before the direction of (x, y) (a binary search with the cross product against the edge direction, one
 * half-plane at a time). `cellOfVector(cellVector(c)) === c` for every cell outside the two rows at each pole, where the sine table has no resolution left to tell the rows apart.
 */
export function cellOfVector(x: number, y: number, z: number, width: number, height: number): number {
  let lo = 0;
  let hi = height - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const south = floorDiv((height - 2 * mid - 2) * ANGLE_QUARTER, height);
    if (z >= sinQ15(south)) hi = mid;
    else lo = mid + 1;
  }
  const row = lo;
  const upper = y >= 0;
  let a = 0;
  let b = width - 1;
  while (a < b) {
    const mid = (a + b + 1) >> 1;
    const e = floorDiv(mid * ANGLE_TURN, width);
    let atOrBefore: boolean;
    if (upper) atOrBefore = e <= ANGLE_TURN / 2 && cosQ15(e) * y - sinQ15(e) * x >= 0;
    else atOrBefore = e <= ANGLE_TURN / 2 || cosQ15(e) * y - sinQ15(e) * x >= 0;
    if (atOrBefore) a = mid;
    else b = mid - 1;
  }
  return row * width + a;
}

/** The Q15 chord of an arc of `angle` units (0..32768): the chord a point at that arc from another has. */
export function chordOfAngle(angle: number): number {
  return 2 * sinQ15(angle >> 1);
}

/** The Q15 chord between the unit vectors at a[ao..] and b[bo..]. */
export function chordQ15(a: Int32Array, ao: number, b: Int32Array, bo: number): number {
  const dx = (a[ao] as number) - (b[bo] as number);
  const dy = (a[ao + 1] as number) - (b[bo + 1] as number);
  const dz = (a[ao + 2] as number) - (b[bo + 2] as number);
  return isqrt(dx * dx + dy * dy + dz * dz);
}

/** The arc (angle units, 0..32768) whose chord is `chord`: a binary search in the chord table, linear inside the step (chord is nearly linear in the arc). */
export function angleOfChord(chord: number): number {
  if (chord <= 0) return 0;
  if (chord >= (CHORD_AT[CHORD_STEPS] as number)) return CHORD_STEPS * MISSILE_REF_CELL_ANGLE;
  let lo = 0;
  let hi = CHORD_STEPS;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((CHORD_AT[mid] as number) <= chord) lo = mid;
    else hi = mid;
  }
  const c0 = CHORD_AT[lo] as number;
  const c1 = CHORD_AT[hi] as number;
  return lo * MISSILE_REF_CELL_ANGLE + Math.floor(((chord - c0) * MISSILE_REF_CELL_ANGLE) / (c1 - c0));
}

/** The ticks a missile of class `cls` needs for an arc of `angle` units: ceil(angle / speed), at least 1. */
export function flightTicksOf(angle: number, cls: number): number {
  const speed = MISSILE_SPEED_ANGLE_PER_TICK[cls] as number;
  const t = Math.floor((angle + speed - 1) / speed);
  return t < 1 ? 1 : t;
}

const VEC = new Int32Array(6);

/** What `trackOf` found: the chord between the two cells, the arc and the flight time of the class. */
export interface Track {
  chord: number;
  angle: number;
  ticks: number;
}

/** A fresh track to pass to `trackOf`. */
export function newTrack(): Track {
  return { chord: 0, angle: 0, ticks: 0 };
}

/** Works out the chord, the arc and the flight time from `startCell` to `targetCell` for class `cls` (no range check) into `out`. */
export function trackOf(startCell: number, targetCell: number, width: number, height: number, cls: number, out: Track): Track {
  cellVector(startCell, width, height, VEC, 0);
  cellVector(targetCell, width, height, VEC, 3);
  out.chord = chordQ15(VEC, 0, VEC, 3);
  out.angle = angleOfChord(out.chord);
  out.ticks = flightTicksOf(out.angle, cls);
  return out;
}

/** True when the chord is within the range of the class (Fusion is unlimited). */
export function inRange(chord: number, cls: number): boolean {
  const r = RANGE_CHORD[cls] as number;
  return r === 0 || chord <= r;
}

/**
 * The position of a missile at `tick` as a Q15 unit vector in out[0..2], on the great circle at a CONSTANT angular speed (Fix-6A1, audit 5 [2.4]): with theta the arc between the cells
 * (`angleOfChord`), e = ticks since launch and F = the flight time, the warhead is at the angle phi = floor(theta x e / F) from the start: pos = cos(phi) a + sin(phi) t, where t is the unit
 * tangent at the start toward the target (the target's part perpendicular to a). It is the same point as the arc interpolation (sin((1-u) theta) a + sin(u theta) b) / sin(theta), but has no
 * division by sin(theta), so an arc of 180 degrees stays well defined: when the target is (nearly) antipodal t is a fixed perpendicular of a (north pole x a, else x axis x a), so the
 * route is a pure function of the two cells. Before the launch it is the start, after the blast the target.
 */
export function missilePosition(startCell: number, targetCell: number, launchTick: number, impactTick: number, tick: number, width: number, height: number, out: Int32Array): void {
  cellVector(startCell, width, height, VEC, 0);
  cellVector(targetCell, width, height, VEC, 3);
  const f = impactTick - launchTick;
  let e = tick - launchTick;
  if (e < 0) e = 0;
  if (e > f) e = f;
  if (e === 0 || e === f || f <= 0) {
    const o = e === 0 || f <= 0 ? 0 : 3; // exactly the start or exactly the target, not a computed copy of it
    out[0] = VEC[o] as number;
    out[1] = VEC[o + 1] as number;
    out[2] = VEC[o + 2] as number;
    return;
  }
  const ax = VEC[0] as number;
  const ay = VEC[1] as number;
  const az = VEC[2] as number;
  const bx = VEC[3] as number;
  const by = VEC[4] as number;
  const bz = VEC[5] as number;
  const theta = angleOfChord(chordQ15(VEC, 0, VEC, 3));
  const phi = Math.floor((theta * e) / f);
  // The tangent at a toward b: b minus its part along a (Q15), made a unit vector.
  const dot = floorDiv(ax * bx + ay * by + az * bz, 32768);
  let tx = floorDiv(bx * 32768 - dot * ax, 32768);
  let ty = floorDiv(by * 32768 - dot * ay, 32768);
  let tz = floorDiv(bz * 32768 - dot * az, 32768);
  let norm = isqrt(tx * tx + ty * ty + tz * tz);
  if (norm < PERP_MIN_NORM) {
    // (Nearly) the same cell or the antipode: no usable direction toward b. Take z x a, or x x a at a pole.
    tx = -ay;
    ty = ax;
    tz = 0;
    norm = isqrt(tx * tx + ty * ty);
    if (norm < PERP_MIN_NORM) {
      tx = 0;
      ty = -az;
      tz = ay;
      norm = isqrt(ty * ty + tz * tz);
    }
    if (norm === 0) {
      out[0] = ax;
      out[1] = ay;
      out[2] = az;
      return;
    }
  }
  const c = cosQ15(phi);
  const sn = sinQ15(phi);
  const px = floorDiv(c * ax + floorDiv(sn * tx * 32768, norm), 512); // Q21: its square still fits the isqrt range
  const py = floorDiv(c * ay + floorDiv(sn * ty * 32768, norm), 512);
  const pz = floorDiv(c * az + floorDiv(sn * tz * 32768, norm), 512);
  const len = isqrt(px * px + py * py + pz * pz); // the table roundings leave it up to 0.15 percent off unit length: put it back
  out[0] = floorDiv(px * 32768, len);
  out[1] = floorDiv(py * 32768, len);
  out[2] = floorDiv(pz * 32768, len);
}

/** A tangent shorter than this (Q15, 1/512 of a unit vector: an arc under 0.12 degrees or within 0.12 degrees of the antipode) is replaced by a fixed perpendicular. */
const PERP_MIN_NORM = 64;
