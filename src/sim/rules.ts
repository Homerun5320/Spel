// The ONE balance and schedule file of the simulation (docs/CHARTER.md section 2, invariant 4). Every tunable that
// the rules will ever read lives here as an UPPER_SNAKE_CASE export; M03 only holds the tick rate and the turn
// schedule. Anything that changes a value here changes the game: bump ENGINE_VERSION in state.ts with it.

/** Simulation ticks per second of game time at speed 1x. */
export const TICK_HZ = 10;
/** Milliseconds of game time per tick (integer, 1000 / TICK_HZ). */
export const TICK_MS = 100;

/**
 * Input delay of lockstep play in turns: an intent submitted while the state is at tick T runs in the step that
 * starts at tick T + INTENT_DELAY_TURNS. One turn is one tick in M03 (see src/sim/time.ts).
 */
export const INTENT_DELAY_TURNS = 2;

/** A turn that carries more intents than this is refused as a whole by step(); the host never builds a larger one. */
export const MAX_INTENTS_PER_TURN = 4096;

/** The host runs at most this many ticks per frame; the surplus time of a stalled frame is dropped, never queued. */
export const MAX_TICKS_PER_FRAME = 8;
