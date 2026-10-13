// What one AI seat remembers between thoughts. Plain numbers and one typed array, so a snapshot of it is trivial to serialise
// (M24b); nothing in it refers to the sim. The driver (src/host/aiDriver.ts) owns one memory per AI seat.
import {
  AI_SPAWN_FIRST_TICK,
  AI_SPAWN_LAST_TICK,
  AI_SPAWN_SPACING_TICKS,
  AI_THINK_PERIOD_TICKS,
  AI_THINK_STAGGER_TICKS,
  nextBelow,
  type SimView,
} from '../sim/public';

export interface AiMemory {
  readonly seat: number;
  /** A tribe: a seat after the players. Tribes only expand, and commit what the sim gives them whatever pct they send. */
  readonly tribe: boolean;
  /** First tick at which the seat tries its Spawn (seeded, spread over the spawn phase; a tribe's is its tribe number times the spacing, so the tribes appear one by one). */
  readonly spawnAt: number;
  /** The seat thinks on the ticks where (tick + phase) is a multiple of AI_THINK_PERIOD_TICKS. */
  readonly phase: number;
  /** Earliest tick of the next Spawn try. */
  retryAt: number;
  /** Spawn tries so far (the clearance of the place search does not depend on it; it is a counter for the tests and the report). */
  attempts: number;
  /** Tick of the last Attack this seat sent per target ownerId, -1 = never. */
  readonly lastAttack: Int32Array;
}

/** The memory of `seat` in the match `view` describes. Draws from `rng` (a nation's spawn tick gets a seeded jitter). */
export function createAiMemory(view: SimView, seat: number, rng: Uint32Array): AiMemory {
  const tribe = seat >= view.players;
  let spawnAt: number;
  if (tribe) {
    spawnAt = (seat - view.players) * AI_SPAWN_SPACING_TICKS;
  } else {
    // The nations share the window evenly (nation n of N takes the n-th slice) and jitter inside their slice.
    const nations = Math.max(1, view.players - 1);
    const n = Math.max(0, seat - 1);
    const span = AI_SPAWN_LAST_TICK - AI_SPAWN_FIRST_TICK;
    const slice = Math.max(1, Math.floor(span / nations));
    // The jitter leaves a gap of AI_SPAWN_SPACING_TICKS to the next slice, so two nations never Spawn on the same or the next tick.
    spawnAt = AI_SPAWN_FIRST_TICK + Math.floor((span * n) / nations) + nextBelow(rng, Math.max(1, slice - AI_SPAWN_SPACING_TICKS + 1));
  }
  return {
    seat,
    tribe,
    spawnAt,
    phase: (seat * AI_THINK_STAGGER_TICKS) % AI_THINK_PERIOD_TICKS,
    retryAt: 0,
    attempts: 0,
    lastAttack: new Int32Array(view.seats + 1).fill(-1),
  };
}
