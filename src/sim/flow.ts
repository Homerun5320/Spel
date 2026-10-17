// The match flow of M05: spawn phase, immunity, play. Pure functions of the tick, shared by the rules (spawn.ts, conquest.ts)
// and by the read-only view (view.ts), so that the UI shows exactly the phase the sim enforces.
import { IMMUNITY_TICKS, SPAWN_PHASE_TICKS } from './rules';

/** 0 = spawn phase (Spawn legal, Attack not), 1 = immunity (Attack legal on unowned land only), 2 = play. */
export const PHASE_SPAWN = 0;
export const PHASE_IMMUNITY = 1;
export const PHASE_PLAY = 2;
export type MatchPhase = typeof PHASE_SPAWN | typeof PHASE_IMMUNITY | typeof PHASE_PLAY;

/** The phase the step that starts at `tick` runs in. */
export function phaseAt(tick: number): MatchPhase {
  if (tick < SPAWN_PHASE_TICKS) return PHASE_SPAWN;
  return tick < SPAWN_PHASE_TICKS + IMMUNITY_TICKS ? PHASE_IMMUNITY : PHASE_PLAY;
}

/** Ticks left of the current phase (0 in play). */
export function phaseTicksLeft(tick: number): number {
  const phase = phaseAt(tick);
  if (phase === PHASE_SPAWN) return SPAWN_PHASE_TICKS - tick;
  return phase === PHASE_IMMUNITY ? SPAWN_PHASE_TICKS + IMMUNITY_TICKS - tick : 0;
}
