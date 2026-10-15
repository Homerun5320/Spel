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
export type { AttackBody, BuildBody, CancelAttackBody, DeleteBody, Intent, IntentBody, SpawnBody, UpgradeBody } from './intents';
export { attackBody, buildBody, cancelAttackBody, deleteBody, spawnBody, upgradeBody } from './intents';
export {
  REJECT_BUILD_FALLOUT,
  REJECT_BUILD_FOREST,
  REJECT_BUILD_FULL,
  REJECT_BUILD_GOLD,
  REJECT_BUILD_HILLS,
  REJECT_BUILD_MOUNTAIN,
  REJECT_BUILD_NO_COAST,
  REJECT_BUILD_NO_FACTORY,
  REJECT_BUILD_NOT_OWNED,
  REJECT_BUILD_OCCUPIED,
  REJECT_BUILD_PEAK,
  REJECT_BUILD_SPACING,
  REJECT_BUILD_TYPE,
  REJECT_NONE,
} from './intents';

// Structures (M09 part A): the read-only table type, the type numbers, the prices and the placement check (validateBuild first).
export type { StructureView } from './structureRules';
export {
  STRUCT_CITY,
  STRUCT_FACTORY,
  STRUCT_PORT,
  STRUCT_POST,
  STRUCT_SAM,
  STRUCT_SILO,
  buildPriceGold,
  buildPriceMilli,
  hasFinishedFactory,
  upgradePriceGold,
  validateBuild,
} from './structureRules';

// The generator the AI is handed (its own stream, never the sim's): the state is a Uint32Array of RNG_WORDS words.
export { RNG_WORDS, createRng, nextBelow, nextU32 } from './rng';

// The constants of src/sim/rules.ts the AI reads (each has a row in docs/BALANCE.md).
export {
  AI_ANCHOR_SEAT,
  AI_ATTACK_COOLDOWN_TICKS,
  AI_BUILD_CITIES_PER_FACTORY,
  AI_BUILD_CITIES_PER_PORT,
  AI_BUILD_CITIES_PER_POST,
  AI_BUILD_CITY_TROOP_PCT,
  AI_BUILD_RETRY_TICKS,
  AI_BUILD_RICH_PCT,
  AI_BUILD_TRIES,
  AI_BUILD_WINDOW_CELLS,
  AI_MIN_CONTACT_LENGTH,
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
  AI_EXPAND_MAX_SHARE_PCT,
  AI_WAR_COMMIT_PCT,
  AI_WAR_HUMAN_START_TICKS,
  AI_WAR_MAX_SHARE_PCT,
  AI_WAR_MIN_CONTACT_LENGTH,
  AI_WAR_MIN_RATIO_PCT,
  AI_WAR_START_TICKS,
  BUILD_BASE_GOLD,
  MILLI_GOLD_PER_GOLD,
  BUILD_TICKS,
  STRUCT_MAX_LEVEL,
  START_DISC_RADIUS_CELLS,
  WEIGHT_ONE,
} from './rules';

// M10-4: the Upgrade / Delete checks and reason codes, and the effect numbers the selection panel shows (each has a row in docs/BALANCE.md).
export { validateDelete, validateUpgrade } from './structureRules';
export { REJECT_DELETE_COOLDOWN, REJECT_STRUCT_BUSY, REJECT_STRUCT_ID, REJECT_STRUCT_MAX_LEVEL, REJECT_STRUCT_NOT_OWNER } from './intents';
export { samRadiusCells } from './structureEffects';
export {
  CAP_CITY_LEVEL_TROOPS,
  CITY_GOLD_MILLI_PER_SEC_PER_LEVEL,
  DELETE_COOLDOWN_TICKS,
  FACTORY_CITY_BONUS_PCT,
  FACTORY_GOLD_MILLI_PER_SEC,
  FACTORY_RADIUS_CELLS,
  PORT_GOLD_MILLI_PER_SEC,
  POST_COST_DEN,
  POST_COST_NUM,
  POST_RADIUS_CELLS,
  TICK_HZ,
} from './rules';

// Fix-UI: the level tables the selection panel shows (append-only; rules.ts is the source, each has a row in docs/BALANCE.md).
export {
  FACTORY_CITY_BONUS_PCT_BY_LEVEL,
  FACTORY_GOLD_MILLI_BY_LEVEL,
  FACTORY_RADIUS_CELLS_BY_LEVEL,
  PORT_GOLD_MILLI_BY_LEVEL,
  PORT_TRADE_PCT_BY_LEVEL,
  SAM_MOUNTAIN_PCT,
} from './rules';
