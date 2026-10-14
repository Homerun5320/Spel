// The ONE balance and schedule file of the simulation (docs/CHARTER.md section 2, invariant 4). Every tunable that
// the rules read lives here as an UPPER_SNAKE_CASE export, and docs/BALANCE.md has one table row per export (a test
// keeps the two in step). Nothing else is exported from this file, and there are no decimal literals: fractions are
// integers with a named scale (_MILLI = thousandths, _PCT = hundredths). Anything that changes a value here changes the
// game: bump ENGINE_VERSION in state.ts with it.
//
// UNIT SYSTEM (decided in M04, see docs/DECISIONS.md D73)
//  - The rule set was written for a 512x256 design. A STD-CELL is 2x2 sim cells of the 1024x512 world: a distance in
//    std-cells times STD_CELL_SIDE is a distance in sim cells, an area times STD_CELL_AREA is an area in sim cells, a
//    linear speed times STD_CELL_SIDE is a speed in sim cells. A rate of captured cells (cells per second) is an AREA
//    rate: it converts with STD_CELL_AREA, not STD_CELL_SIDE.
//  - Troops are stored in QUARTER TROOPS (QT): 4 QT = 1 troop, so a Plains sim cell, a quarter of a std-cell, costs
//    3 QT = 0.75 troop with no rounding. Gold is stored in milli-gold. Remainders of per-tick amounts are carried in
//    integer remainders (micro-QT for troops), never in floats.
//  - Constants whose name ends in _STD are in std-cell units, the others are in sim units.

// ---------------------------------------------------------------------------------------------------------------
// Time and turn schedule (M03)

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

// ---------------------------------------------------------------------------------------------------------------
// Units (M04)

/** Sim cells along one side of a std-cell (distances: std times this). */
export const STD_CELL_SIDE = 2;
/** Sim cells in one std-cell (areas and area rates: std times this). */
export const STD_CELL_AREA = STD_CELL_SIDE * STD_CELL_SIDE;
/** Quarter troops per troop. Chosen equal to STD_CELL_AREA so that a std-cell cost in troops divides into whole QT per sim cell. */
export const QT_PER_TROOP = 4;
/** Milli-gold per gold: gold is stored in thousandths. */
export const MILLI_GOLD_PER_GOLD = 1000;
/** Micro-QT per QT: the scale of the troop remainder carried between ticks. */
export const MICRO_QT_PER_QT = 1000000;
/** 1.0 as a Q15 cell weight (the committed cos(lat) row table has 32768 at the equator). */
export const WEIGHT_ONE = 32768;
/** sqrt(T in troops) * 1000 equals isqrt(T in QT * this): 1000000 / QT_PER_TROOP. */
export const SQRT_MILLI_PER_QT = 250000;

// ---------------------------------------------------------------------------------------------------------------
// World geometry (facts about the planet, not tunables; they feed cellKm in src/sim/grid.ts)

/** Length of the equator in metres (WGS84). */
export const EARTH_EQUATOR_M = 40075017;
/** Length of a meridian from pole to pole in metres (WGS84: half of the 40007863 m meridian circumference). */
export const EARTH_POLE_TO_POLE_M = 20003931;

// ---------------------------------------------------------------------------------------------------------------
// Terrain

/**
 * What entering a cell of a terrain class costs the attacker, in percent of a Plains cell, indexed by the class number of
 * the baked sim pack (0 DeepSea, 1 Shallows, 2 Plains, 3 Forest, 4 Hills, 5 Mountain, 6 Peak, 7 Ice). 0 means the class is
 * unplayable and impassable: nobody owns it, spawns on it or attacks into it.
 */
export const TERRAIN_COST_PCT = [0, 0, 100, 130, 160, 250, 0, 0];

// ---------------------------------------------------------------------------------------------------------------
// Start, troops and gold

/** Troops a seat starts with (clamped to its cap). */
export const START_TROOPS = 1200;
/** Gold a seat starts with. */
export const START_GOLD = 500;
/** Radius in SIM cells of the capital disc (D75: the 197 of the plan are counted in sim cells). */
export const START_DISC_RADIUS_CELLS = 8;
/** Integer points (dx, dy) with dx*dx + dy*dy <= START_DISC_RADIUS_CELLS squared; a test recounts it. The number of cells a Spawn claims. */
export const START_DISC_CELLS = 197;

/** Troop cap = CAP_BASE_TROOPS + CAP_N_COEF_TROOPS * N^0.75 + CAP_CITY_LEVEL_TROOPS * cityLevels, N = owned area in std-cells (cos-weighted). */
export const CAP_BASE_TROOPS = 2000;
export const CAP_N_COEF_TROOPS = 120;
/** Cap per city level (cities arrive in M09; the level count is 0 until then). */
export const CAP_CITY_LEVEL_TROOPS = 800;

/** Regeneration per second = max((REGEN_BASE + REGEN_SQRT_COEF * sqrt(T)) * (1 - T / Tmax), -MAX_DECAY), T in troops. */
export const REGEN_BASE_TROOPS_PER_SEC = 8;
/** The 0.35 of the plan, in thousandths. */
export const REGEN_SQRT_COEF_MILLI = 350;
/** The most a seat above its cap loses per second (own choice: the plan names MAX_DECAY but gives no number). */
export const MAX_DECAY_TROOPS_PER_SEC = 40;

/** Gold income: milli-gold per second per std-cell of cos-weighted land (50 = 0.05 gold per second per std-cell). */
export const GOLD_PER_STD_CELL_MILLI_PER_SEC = 50;

/** Tribes (bots): cap divided by this. */
export const TRIBE_CAP_DIV = 3;
/** Tribes: regeneration in percent of a player's. */
export const TRIBE_REGEN_PCT = 50;
/** Tribes: an attack commits troops / this (used by the conquest, M04 part B). */
export const TRIBE_ATTACK_DIV = 20;

// Derived constants in sim units (pure functions of the ones above, listed so that the balance table is complete).
export const START_TROOPS_QT = START_TROOPS * QT_PER_TROOP;
export const START_GOLD_MILLI = START_GOLD * MILLI_GOLD_PER_GOLD;
export const CAP_BASE_QT = CAP_BASE_TROOPS * QT_PER_TROOP;
export const CAP_N_COEF_QT = CAP_N_COEF_TROOPS * QT_PER_TROOP;
export const CAP_CITY_LEVEL_QT = CAP_CITY_LEVEL_TROOPS * QT_PER_TROOP;
/** micro-troops per second times QT_PER_TROOP over TICK_HZ is micro-QT per tick; this is the clamp of that rate. */
export const MAX_DECAY_MICRO_QT_PER_TICK = (MAX_DECAY_TROOPS_PER_SEC * MICRO_QT_PER_QT * QT_PER_TROOP) / TICK_HZ;

// ---------------------------------------------------------------------------------------------------------------
// Conquest (wired in M04 part B; the numbers are the plan's starting values, calibrated in D88)

/** Capture speed = CAPTURE_K * sqrt(L) * 2F / (F + Td), in std-cells per second; this is CAPTURE_K in thousandths (80 = 0.08). */
export const CAPTURE_K_MILLI = 123;
/** Troops to take one std-cell of Plains with the attacker's depth term 0, before the multipliers. */
export const BASE_COST_TROOPS = 3;
/** The same per SIM cell in QT: BASE_COST_TROOPS * QT_PER_TROOP / STD_CELL_AREA (3 QT = 0.75 troop). */
export const BASE_COST_QT_PER_SIM_CELL = (BASE_COST_TROOPS * QT_PER_TROOP) / STD_CELL_AREA;
/** The depth of a target cell in the defender's land counts at most this far (std-cells). */
export const D_MAX_STD = 40;
/** Cost grows by 1 + d / DEPTH_COST_DIV_STD (std-cells). */
export const DEPTH_COST_DIV_STD = 20;
/** D_MAX_STD and DEPTH_COST_DIV_STD in sim cells (distances: times STD_CELL_SIDE). */
export const D_MAX_CELLS = D_MAX_STD * STD_CELL_SIDE;
export const DEPTH_COST_DIV_CELLS = DEPTH_COST_DIV_STD * STD_CELL_SIDE;
/** The unit of the height difference dh between two cells, in metres (the plan's "dh/32" counts in these units). */
export const HEIGHT_UNIT_M = 16;
/** Uphill factor = 1 + UPHILL_PER_STEP * dh / UPHILL_STEP_UNITS, capped; downhill is 1. This is UPHILL_PER_STEP in thousandths (250 = 0.25). */
export const UPHILL_PER_STEP_MILLI = 250;
export const UPHILL_STEP_UNITS = 32;
/** The uphill factor never exceeds this many percent (200 = x2). */
export const UPHILL_MAX_PCT = 200;
/** An enclave (land fully surrounded by one seat) flips to the surrounding seat every this many ticks, offset by hash(id). */
export const ENCLAVE_FLIP_TICKS = 20;

// ---------------------------------------------------------------------------------------------------------------
// Conquest mechanics (M04 part B, D82 to D90)

/** Micro-cells per cell: the unit of the capture progress an attack carries from tick to tick. */
export const MICRO_CELLS_PER_CELL = 1000000;
/** The most terrain debt (negative capture progress, in micro-cells) an attack can owe: 1000 cells' worth. */
export const PROGRESS_DEBT_MAX = 1000 * MICRO_CELLS_PER_CELL;
/** Milli-QT per QT: the unit of the cost of one cell; the part of a QT that is not yet paid is carried in the attack. */
export const MILLI_QT_PER_QT = 1000;
/** BASE_COST_QT_PER_SIM_CELL in milli-QT (3000 = 3 QT = 0.75 troop per Plains sim cell). */
export const BASE_COST_MILLI_QT_PER_SIM_CELL = BASE_COST_QT_PER_SIM_CELL * MILLI_QT_PER_QT;
/** sqrt(L in std-cells) * 1000 equals isqrt(L in sim cells * this): 10^6 / STD_CELL_SIDE (the contact length is a distance, so it converts with the SIDE). */
export const CAPTURE_SQRT_SCALE = 1000000 / STD_CELL_SIDE;
/** The troop ratio 2F / (F + Td) of the capture formula is kept in millionths (2000000 = 2.0, the value against unowned land). */
export const CAPTURE_RATIO_TWO = 2000000;
/** An enclave fill gives up (the region is not an enclave) beyond this many sim cells. Own choice: 64 sim cells = 16 std-cells (the work of a failed fill is bounded by it). */
export const ENCLAVE_MAX_CELLS = 64;
/** The cells one enclave pass may visit in a tick; candidates beyond it wait for the next pass (20 ticks later). Own choice. */
export const ENCLAVE_PASS_BUDGET_CELLS = 4096;
/** A frontier (or a boundary list) is purged of stale entries when it reaches this many entries (and then at twice its purged size). Engine limit. */
export const FRONT_COMPACT_MIN = 256;

// ---------------------------------------------------------------------------------------------------------------
// Match flow (M05). The spawn phase and the immunity are rules of the SIM, switched on by the match config (`spawnPhase`).

/** Length of the spawn phase in ticks (20 s). While it runs a seat may Spawn and nobody may Attack; a Spawn after it is refused. */
export const SPAWN_PHASE_TICKS = 200;
/** Immunity after the spawn phase in ticks (5 s): nobody may Attack a seat's land (target not 0) while it runs. */
export const IMMUNITY_TICKS = 50;
/** AI nations of a standard match besides the human (seats 1..5). */
export const MATCH_AI_NATIONS = 5;
/** Tribes (bots with a weaker economy) of a standard match; they are the seats after the players. */
export const MATCH_TRIBES = 20;

// ---------------------------------------------------------------------------------------------------------------
// AI v0 (M05 part C). The AI is a pure function of a SimView (src/ai); these are its tunables. They do not change the sim
// step (the AI only emits intents), so they need no ENGINE_VERSION bump. src/ai reads them through src/sim/public.ts.

/** Ticks between two thoughts of one seat (1 s). */
export const AI_THINK_PERIOD_TICKS = 10;
/** The thought of seat s happens when (tick + s * this) is a multiple of the period: the seats think on different ticks. */
export const AI_THINK_STAGGER_TICKS = 3;
/** The seat the AI places its capitals around: the human's (seat 0). */
export const AI_ANCHOR_SEAT = 0;
/**
 * The AI seats wait for the anchor seat's Spawn so that the world fills in around the player; if it has not spawned by this tick
 * (15 s of the 20 s phase: a player who reads the banner first still gets the AI around them) they go ahead with places spread over the whole map.
 */
export const AI_SPAWN_WAIT_TICKS = 150;
/** From its release the AI seats Spawn one by one, the nations first, this many ticks apart. The driver tells each seat which Spawns are still in flight (they run 2 ticks after they were sent), so consecutive ticks are safe. */
export const AI_SPAWN_SPACING_TICKS = 1;
/** Ticks to wait for the capital to show up (a Spawn runs 2 ticks after it was sent) before the Spawn is tried at another place. */
export const AI_SPAWN_RETRY_TICKS = 6;
/** A nation's capital is at least this many sim cells from every owned cell (about 1100 km at the equator); tribes use the smaller one. */
export const AI_NATION_CLEARANCE_CELLS = 28;
export const AI_TRIBE_CLEARANCE_CELLS = 14;
/** With an anchor, a capital is at most this many sim cells from it (a square, x wrapping): nations farther out than tribes. */
export const AI_NATION_REACH_CELLS = 90;
export const AI_TRIBE_REACH_CELLS = 90;
/** Random places tried for one Spawn; the clearance is halved after every quarter of them, and the second half ignores the reach, so a crowded map still finds a place. */
export const AI_SPAWN_TRIES = 400;
/** An AI seat expands or attacks only with at least this share of its troop cap (percent). */
export const AI_EXPAND_TROOP_PCT = 40;
/** Percent of its troops an AI nation commits to an attack on unowned land / on a neighbour. A tribe commits troops / TRIBE_ATTACK_DIV whatever this says. */
export const AI_EXPAND_COMMIT_PCT = 70;
export const AI_WAR_COMMIT_PCT = 50;
/** A nation attacks a neighbour only when its troops are at least this many percent of the neighbour's. */
export const AI_WAR_MIN_RATIO_PCT = 130;
/** An AI seat expands into unowned land only when its contact length with it (adjacencies, sim cells) is at least this: a sliver of one or two cells is usually gone (taken by the running attack or by another seat) by the time the intent runs 2 ticks later, which the sim would refuse. */
export const AI_MIN_CONTACT_LENGTH = 4;
/** Ticks before a seat attacks the same target again (a second Attack on a target adds troops to the running one). */
export const AI_ATTACK_COOLDOWN_TICKS = 40;
/** The same for a tribe's expansion into unowned land. */
export const AI_TRIBE_COOLDOWN_TICKS = 100;
/** A tribe stops expanding at this many cells (three times its capital disc): a tribe is a small, defended prize, not a rival. */
export const AI_TRIBE_MAX_CELLS = 600;

// ---------------------------------------------------------------------------------------------------------------
// Match setup, the fair start and the home land (M06, D112 to D118). The sim rules among these (HOME_COST_PCT, the trait cap) apply
// only to a match whose config has `homeRules`; the others are read by the match setup in src/app and change no step.

/** A country is selectable (as your nation or as an AI nation) only with at least this many cells of its own. */
export const SETUP_MIN_COUNTRY_CELLS = 8;
/** Capitals of two nations at the start are at least this many sim cells apart (a Euclidean distance, x wrapping): two capital discs of radius 8 never touch. */
export const SETUP_CAPITAL_MIN_DISTANCE_CELLS = 17;
/** AI nations of a new match unless the options say otherwise. */
export const SETUP_AI_NATIONS_DEFAULT = 12;
/** The most AI nations the options allow (seats: you + this + the tribes stay far below the 255 seats of the wire format). */
export const SETUP_AI_NATIONS_MAX = 24;
/** Conquering a cell of its OWN home country costs the owner of that home land this percent of the normal price (50 = half). Nobody else gets it. */
export const HOME_COST_PCT = 50;
/** A trait multiplier (port income, defence) stays within 1000 +- this many thousandths: the +-10 % cap. */
export const TRAIT_CAP_MILLI = 100;
/** The neutral value of a trait multiplier in thousandths (x1). */
export const TRAIT_NEUTRAL_MILLI = 1000;
/** Coast share (thousandths of a country's land cells that touch water) at which the port income multiplier is x1. */
export const TRAIT_COAST_MID_PERMILLE = 150;
/** Port income multiplier change in thousandths per thousandth of coast share, as a percent (50 = 0.5): +200 permille above the middle reaches the cap. */
export const TRAIT_COAST_GAIN_PCT = 50;
/** Mountain share (thousandths of a country's land cells that are Mountain or Peak) at which the defence multiplier is x1. */
export const TRAIT_MOUNTAIN_MID_PERMILLE = 150;
/** Defence multiplier change in thousandths per thousandth of mountain share, as a percent. A defence multiplier above 1000 makes an attacker pay more. */
export const TRAIT_MOUNTAIN_GAIN_PCT = 50;

