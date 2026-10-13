// The std-cell converter: the plan's numbers are in std-cells (2x2 sim cells), the simulation runs on sim cells. The
// factors are constants in rules.ts; these functions only apply them, so that no call site multiplies by a literal.
import { QT_PER_TROOP, STD_CELL_AREA, STD_CELL_SIDE } from './rules';

/** A distance in std-cells as a distance in sim cells (x2). */
export function stdToSimDistance(std: number): number {
  return std * STD_CELL_SIDE;
}

/** An area in std-cells as an area in sim cells (x4). */
export function stdToSimArea(std: number): number {
  return std * STD_CELL_AREA;
}

/** A linear speed in std-cells per second as sim cells per second (x2). */
export function stdToSimSpeed(std: number): number {
  return std * STD_CELL_SIDE;
}

/**
 * A rate of captured cells (cells per second, an AREA per time) in std-cell units as sim cells per second: x4, NOT x2.
 * Per tick divide by TICK_HZ.
 */
export function stdToSimCellRate(std: number): number {
  return std * STD_CELL_AREA;
}

/** Troops as quarter troops. */
export function troopsToQt(troops: number): number {
  return troops * QT_PER_TROOP;
}

/** Quarter troops as (fractional) troops, for display and tests only. */
export function qtToTroops(qt: number): number {
  return qt / QT_PER_TROOP;
}

/** A cos-weighted sim-cell sum (Q15 weights) as an area in std-cells, Q15: the N of the troop cap formula. Floors. */
export function weightedSimToStdQ15(weightedSim: number): number {
  return Math.floor(weightedSim / STD_CELL_AREA);
}
