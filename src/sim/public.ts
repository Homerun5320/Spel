// The barrel of the pure, read-only helpers that UI and AI may import from the sim (CHARTER section 2, invariant 6). It
// re-exports no mutator, no step function and no writable array. `src/ai` may import ONLY `SimView` (src/sim/view.ts) and
// this file. Part C of M05 adds the type-only intent exports and the rules constants the AI reads; later milestones add
// `validateBuild`, `planRoute`, `previewBlast` and the other pure helpers.
export { NO_OWNER, NO_SEAT, ownerSlots, ownerToSeat, seatToOwner } from './state';
export { PHASE_IMMUNITY, PHASE_PLAY, PHASE_SPAWN, phaseAt, phaseTicksLeft, type MatchPhase } from './flow';
export { STAT_COUNT, STAT_FIELDS, type ReadonlyNumbers, type SeatStatsView, type SimView, type StatField } from './view';
