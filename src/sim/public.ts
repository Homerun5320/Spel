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
export { SAM_MOUNTAIN_PCT } from './rules';
// Sim-Levels2: the same tables, now generated for levels 1 to 999 from the concave curves of levelCurves.ts.
export { FACTORY_CITY_BONUS_PCT_BY_LEVEL, FACTORY_GOLD_MILLI_BY_LEVEL, FACTORY_RADIUS_CELLS_BY_LEVEL, PORT_GOLD_MILLI_BY_LEVEL, PORT_TRADE_PCT_BY_LEVEL } from './levelCurves';

// Districts-1 (append-only): the district kinds, the checks and reason codes, the effect numbers, the intent constructors and the constants of rules.ts the UI / AI read.
export type { BuildDistrictBody, RemoveDistrictBody, UpgradeDistrictBody } from './intents';
export { buildDistrictBody, removeDistrictBody, upgradeDistrictBody } from './intents';
export {
  REJECT_DISTRICT_CITY_BUILDING,
  REJECT_DISTRICT_EMPTY,
  REJECT_DISTRICT_KIND,
  REJECT_DISTRICT_NOT_CITY,
  REJECT_DISTRICT_OCCUPIED,
  REJECT_DISTRICT_SLOT,
} from './intents';
export type { DistrictEffect, DistrictView } from './districtRules';
export {
  DISTRICT_BARRACKS,
  DISTRICT_HOUSING,
  DISTRICT_KIND_SLOTS,
  DISTRICT_MARKET,
  DISTRICT_NONE,
  DISTRICT_WALLS,
  districtBuildPriceGold,
  districtBuildPriceMilli,
  districtEffect,
  districtIndex,
  districtSlotsOf,
  districtUpgradePriceGold,
  isDistrictKind,
  validateBuildDistrict,
  validateRemoveDistrict,
  validateUpgradeDistrict,
} from './districtRules';
export {
  AI_DISTRICT_MIN_CITIES,
  AI_DISTRICT_RETRY_TICKS,
  DISTRICT_BASE_GOLD,
  DISTRICT_BUILD_TICKS,
  DISTRICT_MAX_LEVEL,
  DISTRICT_MAX_SLOTS,
  DISTRICT_SLOTS_BY_LEVEL,
  DISTRICT_WALLS_RADIUS_CELLS,
} from './rules';

// M18-1 (append-only): the match end. The read-only `MatchView` (`SimView.match`), the result codes, the win block type, the overtime curve and the
// constants of rules.ts the UI and the AI read (the AI gang-up rule reads the same two LEADER_LAND_PCT_* thresholds as the conquest discount).
export type { MatchView } from './matchView';
export type { WinConfig } from './matchState';
export { WIN_REASON_LAND, WIN_REASON_LAST, WIN_REASON_NONE, WIN_REASON_SCORE } from './matchState';
export { requiredLandPct } from './win';
export {
  LEADER_COST_PCT_HIGH,
  LEADER_COST_PCT_MID,
  LEADER_LAND_PCT_HIGH,
  LEADER_LAND_PCT_MID,
  OVERTIME_MIN_PCT,
  OVERTIME_START_MINUTE,
  OVERTIME_STEP_PCT,
  SCORE_CITY_LEVEL_POINTS,
  SCORE_FACTORY_LEVEL_POINTS,
  TIME_LIMIT_SKIRMISH_TICKS,
  TIME_LIMIT_WORLD_TICKS,
  WIN_HOLD_TICKS,
  WIN_LAND_SHARE_PCT,
} from './rules';

// M11a (append-only): the exposure queries of the line-of-sight cache (src/sim/los). Read-only: the host builds a Los from the elevation layers and hands it in.
export { ALT_MODE_HIGH, ALT_MODE_LOW, EXPOSED_DETECTED, EXPOSED_NONE, EXPOSED_POST, type AltMode, type Los, type LosSource } from './los/cache';
export { exposure, fireControlExposed, isExposed } from './los/exposure';

// M11b (append-only): air navigation (src/sim/nav). The host builds a Nav from the elevation layers and a Los; planRoute and scoreLz are pure queries.
export { Nav, createNav, type NavSource } from './nav/grid';
export { ROUTE_NO_ROUTE, planRoute, type NavView, type RouteFail, type RouteOk, type RouteResult } from './nav/route';
export { LZ_ENEMY_CITY_NEAR, LZ_NO_ROUTE, LZ_OK, LZ_OUT_OF_FUEL, LZ_PEAK, LZ_REASON_NAMES, LZ_STEEP, LZ_TERRAIN_CLASS, LZ_TOO_HIGH, LZ_WATER, scoreLz, type LzReason, type LzResult } from './nav/lz';
export { AIR_EXPOSURE_LAMBDA, AIR_MODE_AGL_M, AIR_MODE_SPEED_MILLICELLS_S, HELI_FUEL_CELLS, LZ_MAX_ELEV_M, SERVICE_CEILING_M } from './rules';
export { createLos } from './los/cache';
export { createLosTerrain, type LosTerrain } from './los/terrain';
export { navFingerprint } from './nav/fingerprint';

// Sim-Growth (append-only): City levels 1 to 10 with small steps. The UI and the AI never hard-code a level count: maxLevelOf(type) is the top level,
// cityGoldMilli / cityTroopCap what a finished City of a level gives, upgradeTicksOf how long the upgrade to a level takes (upgradePriceGold is above).
export { cityGoldMilli, cityTroopCap, maxLevelOf, upgradeTicksOf } from './structureRules';
export { AI_CITY_UPGRADE_LEVELS_PER_CITY, CITY_MAX_LEVEL, SPACING_CELLS_BY_TYPE } from './rules';

// Sim-Levels2 (append-only): unlimited levels. STRUCT_LEVEL_HARD_CAP is the practical top level of every structure and district (maxLevelOf(type) returns it;
// CITY_MAX_LEVEL, STRUCT_MAX_LEVEL and DISTRICT_MAX_LEVEL are only the visual reference scale now), districtMaxLevel() the same for districts,
// levelAfterConquest(level) what a conquered structure or district keeps, satPermille(level) the saturation of the level curves.
export { AI_CITY_LEVEL_CAP, AI_DISTRICT_LEVEL_CAP, AI_STRUCT_LEVEL_CAP, STRUCT_LEVEL_HARD_CAP, LEVEL_CONQUEST_KEEP_PCT } from './rules';
export { districtMaxLevel } from './districtRules';
export { levelAfterConquest } from './structures';
export { satPermille } from './levelCurves';

// M12a-1 (append-only): helicopters, part 1. The read-only table type and the state numbers, the ProduceHeli check (the very function the sim runs), the fleet cap and
// count, the intent body, the refusal codes and the constants of rules.ts the UI and the AI read (each has a row in docs/BALANCE.md).
export type { HeliView } from './heliTable';
export { HELI_APPROACH, HELI_BUILDING, HELI_CRUISE, HELI_DOWNED, HELI_HOVER, HELI_LIFT, HELI_PAD, HELI_POS_ONE, HELI_RETURN, HELI_UNLOAD } from './heliTable';
export { HELI_PRICE_MILLI, fleetCapOf, fleetCountOf, validateProduceHeli } from './heliRules';
export type { ProduceHeliBody } from './intents';
export { produceHeliBody } from './intents';
export { REJECT_HELI_FACTORY_BUILDING, REJECT_HELI_FLEET_CAP, REJECT_HELI_NO_FACTORY, REJECT_HELI_NO_GOLD, REJECT_HELI_NOT_OWNER, REJECT_HELI_QUEUE_BUSY } from './intents';
export { HELI_BUILD_TICKS, HELI_FLEET_BASE, HELI_FLEET_MAX, HELI_HP_TENTHS, HELI_MAX_TROOPS, HELI_PRICE_GOLD, LZ_REASON_BASE } from './rules';

// M12a-2 (append-only): helicopters, part 2. The LaunchHeli / RecallHeli checks (the very functions the sim runs), their intent bodies, the refusal codes 51 to 54
// and the flight constants of rules.ts the UI reads (each has a row in docs/BALANCE.md).
export { validateLaunchHeli, validateRecallHeli } from './heliRules';
export type { LaunchHeliBody, RecallHeliBody } from './intents';
export { launchHeliBody, recallHeliBody } from './intents';
export { REJECT_HELI_BAD_TROOPS, REJECT_HELI_NO_PAD, REJECT_HELI_NO_ROUTE, REJECT_HELI_NOT_FLYING } from './intents';
export { HELI_CLEARANCE_GAME_M, HELI_DOWNED_TICKS, HELI_HOVER_TICKS, HELI_TAKEOFF_TICKS } from './rules';
