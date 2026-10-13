// The barrel of the pure, read-only helpers that UI and AI may import from the sim (CHARTER section 2, invariant 6). It
// re-exports no mutator, no step function, no state type and no writable array. `src/ai` may import NOTHING from the sim but this
// file (ESLint allow-list in eslint.config.js plus the type test in tests/ai). `SimView` itself is exported from here, so the
// AI's whole view of the world is this file's export list. Later milestones add `validateBuild`, `planRoute`, `previewBlast` and
// the other pure helpers.

// Seats, owners, the match flow and the view types.
export { NO_OWNER, NO_SEAT, ownerSlots, ownerToSeat, seatToOwner } from './state';
export { PHASE_IMMUNITY, PHASE_PLAY, PHASE_SPAWN, phaseAt, phaseTicksLeft, type MatchPhase } from './flow';
export { STAT_COUNT, STAT_FIELDS, type ReadonlyNumbers, type SeatStatsView, type SimView, type StatField } from './view';
export { isPlayableClass } from './terrain';

// Intents: the types (type-only, so the AI cannot construct an intent by hand that the sim does not know) and the constructors.
export type { AttackBody, CancelAttackBody, Intent, IntentBody, SpawnBody } from './intents';
export { attackBody, cancelAttackBody, spawnBody } from './intents';

// The generator the AI is handed (its own stream, never the sim's): the state is a Uint32Array of RNG_WORDS words.
export { RNG_WORDS, createRng, nextBelow, nextU32 } from './rng';

// The constants of src/sim/rules.ts the AI reads (each has a row in docs/BALANCE.md).
export {
  AI_ANCHOR_SEAT,
  AI_ATTACK_COOLDOWN_TICKS,
  AI_EXPAND_COMMIT_PCT,
  AI_EXPAND_TROOP_PCT,
  AI_NATION_CLEARANCE_CELLS,
  AI_NATION_REACH_CELLS,
  AI_SPAWN_RETRY_TICKS,
  AI_SPAWN_SPACING_TICKS,
  AI_SPAWN_WAIT_TICKS,
  AI_SPAWN_TRIES,
  AI_THINK_PERIOD_TICKS,
  AI_THINK_STAGGER_TICKS,
  AI_TRIBE_CLEARANCE_CELLS,
  AI_TRIBE_REACH_CELLS,
  AI_TRIBE_COOLDOWN_TICKS,
  AI_TRIBE_MAX_CELLS,
  AI_WAR_COMMIT_PCT,
  AI_WAR_MIN_RATIO_PCT,
  START_DISC_RADIUS_CELLS,
} from './rules';
