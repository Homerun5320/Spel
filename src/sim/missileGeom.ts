// The flight of a missile (M14a): pure integer geometry on the unit sphere. No trig, no asin: a cell becomes a unit vector through the Q15 sine table, the range is a CHORD compared
// with a table, the flight time comes from the arc length found by a search in a chord table, and the position is the normalised lerp of the two end vectors (isqrt).
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
 * The position of a missile at `tick` as a Q15 unit vector in out[0..2]: the normalised lerp of the end vectors at e / F, e = ticks since launch, F = the flight time. Before the
 * launch it is the start, after the blast the target. The arc of a flight is not walked at a constant rate (the lerp is slowest near the ends), which a renderer may smooth.
 */
export function missilePosition(startCell: number, targetCell: number, launchTick: number, impactTick: number, tick: number, width: number, height: number, out: Int32Array): void {
  cellVector(startCell, width, height, VEC, 0);
  cellVector(targetCell, width, height, VEC, 3);
  const f = impactTick - launchTick;
  let e = tick - launchTick;
  if (e < 0) e = 0;
  if (e > f) e = f;
  if (e === 0 || e === f) {
    const o = e === 0 ? 0 : 3; // exactly the start or exactly the target, not a normalised copy of it
    out[0] = VEC[o] as number;
    out[1] = VEC[o + 1] as number;
    out[2] = VEC[o + 2] as number;
    return;
  }
  const vx = (VEC[0] as number) * (f - e) + (VEC[3] as number) * e;
  const vy = (VEC[1] as number) * (f - e) + (VEC[4] as number) * e;
  const vz = (VEC[2] as number) * (f - e) + (VEC[5] as number) * e;
  const norm = f > 0 ? isqrt(vx * vx + vy * vy + vz * vz) : 0;
  if (norm === 0) {
    out[0] = VEC[0] as number;
    out[1] = VEC[1] as number;
    out[2] = VEC[2] as number;
    return;
  }
  out[0] = floorDiv(vx * 32768, norm);
  out[1] = floorDiv(vy * 32768, norm);
  out[2] = floorDiv(vz * 32768, norm);
}
