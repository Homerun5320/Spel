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
export const REGEN_BASE_TROOPS_PER_SEC = 24;
/** The 0.35 of the plan, in thousandths. */
export const REGEN_SQRT_COEF_MILLI = 1000;
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
export const CAPTURE_K_MILLI = 420;
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
export const AI_EXPAND_TROOP_PCT = 32;
/** Percent of its troops an AI nation commits to an attack on unowned land / on a neighbour. A tribe commits troops / TRIBE_ATTACK_DIV whatever this says. */
export const AI_EXPAND_COMMIT_PCT = 70;
export const AI_WAR_COMMIT_PCT = 50;
/** A nation attacks a neighbour only when its troops are at least this many percent of the neighbour's. */
export const AI_WAR_MIN_RATIO_PCT = 130;
/** No AI nation attacks a neighbour before this tick (tempo pass, D142: with the faster conquest the land grab comes first and the first war is a few minutes in). Expansion into unowned land is not held back. */
export const AI_WAR_START_TICKS = 2000;
/** An AI nation that owns this share of all land (percent, cos-weighted) attacks no neighbour any more: nobody runs away with the match, the leader sits on its land. */
export const AI_WAR_MAX_SHARE_PCT = 15;
/** A nation starts a war on a neighbour only with at least this much contact (adjacencies, sim cells): a single cell of contact is gone (or the target eaten by another nation) before the intent runs 2 ticks later, which the sim refuses (D143). */
export const AI_WAR_MIN_CONTACT_LENGTH = 2;
/** An AI nation that owns this share of all land (percent, cos-weighted) expands into no more unowned land and calls off its expansion attack (D143: the war cap alone let a nation run on through free land to 26 to 29 % after 15 minutes). A nation between the two caps still answers a neighbour that attacks it. */
export const AI_EXPAND_MAX_SHARE_PCT = 20;
/** No AI nation STARTS a war on a human seat before this tick (D143: a passive player was dead 25 to 170 s after the general grace in a 12-AI Skirmish). A human who attacks is answered at once, whatever the tick. */
export const AI_WAR_HUMAN_START_TICKS = 3600;
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


// ---------------------------------------------------------------------------------------------------------------
// Structures (M09 part A): the table, the prices, the build times and the placement rules. The structure types are numbered 1..6
// in this order (src/sim/structureRules.ts: CITY, FACTORY, PORT, SILO, SAM, POST); the arrays below are indexed by that number
// (index 0 is the empty type and holds 0). Prices are PROVISIONAL (the M09a block of docs/DECISIONS.md): they are measured against the income of the solo scenario.

/** Slots of the structure table (a structural limit, not a tunable): ids 0..STRUCT_CAPACITY - 1. */
export const STRUCT_CAPACITY = 4096;
/** Sim-Levels2: LEGACY visual reference level of Factory, Port, Silo, SAM and Post (models reach full size here). NOT a limit any more: every level up to STRUCT_LEVEL_HARD_CAP can be bought (use maxLevelOf(type)). */
export const STRUCT_MAX_LEVEL = 3;
/** Sim-Levels2: a conquered Factory, Port, City or district keeps this percent of its level, rounded down, at least level 1 (the City's districts likewise). */
export const LEVEL_CONQUEST_KEEP_PCT = 75;
/** Sim-Levels2: the practical hard cap of every structure and district level (u16 in the tables). The dearest price, base 1000 * 999 gold = 999 000 000 milli, fits both Int32 and the Uint32 purse. */
export const STRUCT_LEVEL_HARD_CAP = 999;
/** Base price in gold per type (City, Factory, Port, Silo, SAM, Post). */
export const BUILD_BASE_GOLD = [0, 400, 500, 400, 1000, 600, 250];
/** Build time in ticks per type (tick = 0.1 s): City 15 s, Factory 20 s, Port 12 s, Silo 25 s, SAM 20 s, Post 8 s. An upgrade of ANY level takes the same time (Sim-Levels2: one rule for all types). */
export const BUILD_TICKS = [0, 150, 200, 120, 250, 200, 80];
/** Price escalation in halves: the price of the next structure of a type is base * min(PRICE_ESCALATION_MAX_HALVES, PRICE_ESCALATION_ONE_HALVES + n) / PRICE_ESCALATION_ONE_HALVES, n = structures of that type the seat owns (also unfinished ones). */
export const PRICE_ESCALATION_ONE_HALVES = 2;
/** The cap of the escalation in halves (12 halves = x6). */
export const PRICE_ESCALATION_MAX_HALVES = 12;
/** After a Delete the same seat may not Delete again for this many ticks (30 s). */
export const DELETE_COOLDOWN_TICKS = 300;
/** Two structures of a type in the spacing scope must be at least this many sim cells apart (a Euclidean distance, x wrapping, no latitude weight), by type (City, Factory, Port, Silo, SAM, Post). A cell is about 39 km: towns, not countries (Sim-Growth: was 16 for every type). */
export const SPACING_CELLS_BY_TYPE = [0, 3, 3, 3, 6, 5, 3];
/** Which structures the spacing applies between: 0 = the same type, any owner; 1 = the same type, same owner; 2 = any type, any owner. M19 may change it. */
export const SPACING_SCOPE = 0;

// ---------------------------------------------------------------------------------------------------------------
// Structure effects (M09 part B). Gold is counted in milli-gold per second here (the economy turns it into milli-gold per tick).
// Only FINISHED structures count. Provisional numbers (the M09b block of docs/DECISIONS.md); each has a row in docs/BALANCE.md.

/** A level 1 City pays this (1.5 gold/s); each further level adds CITY_GOLD_STEP_MILLI_PER_LEVEL (cityGoldMilli(level) in structureRules.ts). Its troop cap at level 1 is CAP_CITY_LEVEL_TROOPS. */
export const CITY_GOLD_MILLI_PER_SEC_PER_LEVEL = 1500;
/** LEGACY (Sim-Growth) visual reference level of a City. NOT a limit any more (Sim-Levels2): use maxLevelOf(type). */
export const CITY_MAX_LEVEL = 10;
/**
 * Sim-Levels2: the shape of every level curve (src/sim/levelCurves.ts). value(L) = base + floor(extra * sat(L) / 1000), sat(L) = 1000 * (L - 1) / (L - 1 + LEVEL_SAT_K):
 * concave, level 1 = base, level 10 = base + 75 percent of extra, level 100 = base + 97 percent, never more than base + extra.
 */
export const LEVEL_SAT_K = 3;
/** Sim-Levels2: a City gains up to this much gold per second (milli) above the level 1 value of 1.5 (asymptote 3.0 gold/s). */
export const CITY_GOLD_EXTRA_MILLI = 1500;
/** Sim-Levels2: a City adds up to this many troops to the cap above CAP_CITY_LEVEL_TROOPS (asymptote 2400). */
export const CITY_TROOP_EXTRA_TROOPS = 1600;
/** A level 1 Factory pays this (2 gold/s); higher levels rise towards it plus FACTORY_GOLD_EXTRA_MILLI (Sim-Levels2). */
export const FACTORY_GOLD_MILLI_PER_SEC = 2000;
/** A level-1 Factory raises the income of the owner's Cities within FACTORY_RADIUS_CELLS by this many percent (once: Factories do not stack). */
export const FACTORY_CITY_BONUS_PCT = 25;
/** The reach of a Factory's bonus in sim cells (Euclidean, x wrapping). */
export const FACTORY_RADIUS_CELLS = 20;
/** A Port pays this flat before trade (2 gold/s) at level 1. */
export const PORT_GOLD_MILLI_PER_SEC = 2000;

// Level effects of the Factory and the Port (M09c, Sim-Levels2: the concave curves of src/sim/levelCurves.ts instead of three-entry tables).
/** Extra own gold of a Factory at the asymptote (4.0 gold/s in all). */
export const FACTORY_GOLD_EXTRA_MILLI = 2000;
/** Extra percent a Factory adds to the Cities it boosts at the asymptote (25 to 35). */
export const FACTORY_CITY_BONUS_EXTRA_PCT = 10;
/** Extra reach of a Factory at the asymptote in sim cells (20 to 24). */
export const FACTORY_RADIUS_EXTRA_CELLS = 4;
/** A Factory boosts at most this many Cities (the lowest ids first); it keeps the sum a single Factory gives under the limit of 10 level-1 Cities. */
export const FACTORY_BONUS_MAX_CITIES = 3;
/** Extra own gold of a Port at the asymptote (4.0 gold/s in all). */
export const PORT_GOLD_EXTRA_MILLI = 2000;
/** Extra percent of its trade value a Port earns at the asymptote (100 to 120). */
export const PORT_TRADE_EXTRA_PCT = 20;
/** One Port (own gold plus trade, before the +-10 % trait) never pays more than this: 13 gold/s, so that with the +10 % trait it stays under 10 level-1 Cities (15 gold/s). */
export const PORT_INCOME_MAX_MILLI_PER_SEC = 13000;
/** Each Port trades with at most this many nearest partner Ports (nearest first, the lowest id on a tie). */
export const TRADE_MAX_PARTNERS = 3;
/** A partner must be at least this far away (sim cells). */
export const TRADE_MIN_DIST_CELLS = 40;
/** The trade value per Port of a pair is TRADE_BASE_MILLI * (100 + min(distance, TRADE_DIST_CAP_CELLS)) / 100 milli-gold per second (1.5 * (1 + min(d, 120) / 100) gold/s, at most 3.3). */
export const TRADE_BASE_MILLI = 1500;
export const TRADE_DIST_CAP_CELLS = 120;
/** A pair with the same owner trades at this percent; a pair under embargo at 0. */
export const TRADE_SAME_OWNER_PCT = 50;
/** A finished Defense Post multiplies the cell price of an attacker that takes a cell of its owner within POST_RADIUS_CELLS by POST_COST_NUM / POST_COST_DEN (2.5). */
export const POST_RADIUS_CELLS = 12;
export const POST_COST_NUM = 5;
export const POST_COST_DEN = 2;
/** SAM and Silo radius in sim cells on flat ground at level 1, and the extra at the asymptote (24 to 32; Sim-Levels2). Nothing reads it before M14. */
export const SAM_RADIUS_BASE_CELLS = 24;
export const SAM_RADIUS_EXTRA_CELLS = 8;
/** A SAM (or Silo) on a Mountain cell reaches this percent further. */
export const SAM_MOUNTAIN_PCT = 120;

// AI build move (M09 part B). The AI emits Build intents like anybody; these only steer when and where it asks.
/** One Factory per this many Cities (the AI builds a Factory when it has fewer than cities / this). The "build ratio" of the economy tuning. */
export const AI_BUILD_CITIES_PER_FACTORY = 2;
/** A new City needs troops of at least this percent of the cap (0 = no gate: a gate of 50 %, even of 20 %, never opens while the AI spends its troops on a long attack and a City is bought with gold, not troops: tuning round 1). */
export const AI_BUILD_CITY_TROOP_PCT = 0;
/** Cells around the capital (a square) in which the AI looks for a build place. */
export const AI_BUILD_WINDOW_CELLS = 56;
/** Random places tried per think. */
export const AI_BUILD_TRIES = 24;
/** After a think that found no place the AI does not look again for this many ticks. */
export const AI_BUILD_RETRY_TICKS = 50;
/** The AI upgrades its lowest finished City / Factory / Port (the best gain first) instead of waiting, when its purse is at least this percent of the next wanted structure's price AND pays the upgrade (M09c: gold that would otherwise sit idle). */
export const AI_BUILD_RICH_PCT = 100;
/** Sim-Growth: the AI upgrades a City to at most level 1 + (Cities it owns) * this, so cheap City upgrades never starve the building of new Cities (round 1 of the Sim-Growth tuning: without it the AI upgraded every City before it built the next one and fell under the band). */
export const AI_CITY_UPGRADE_LEVELS_PER_CITY = 5;
/** Sim-Levels2: the AI lets a City rise to at most this level (it buys the level, the price base * L is the same as for the human), a Factory or Port to at most AI_STRUCT_LEVEL_CAP and a district to at most AI_DISTRICT_LEVEL_CAP: the human can go on, the AI stops where upgrades no longer pay back. */
export const AI_CITY_LEVEL_CAP = 10;
export const AI_STRUCT_LEVEL_CAP = 3;
export const AI_DISTRICT_LEVEL_CAP = 3;
/** One Port per this many Cities (from the second City on); one Post per this many Cities (from the fourth). */
export const AI_BUILD_CITIES_PER_PORT = 3;
export const AI_BUILD_CITIES_PER_POST = 4;

// ---------------------------------------------------------------------------------------------------------------
// City districts (Districts-1). A City of level L has DISTRICT_SLOTS_BY_LEVEL[L] slots, each holds one district of a kind (1 Housing, 2 Market,
// 3 Barracks, 4 Walls, src/sim/districtRules.ts). Arrays are indexed by the kind number (0 = none) or by the level (0 unused). Prices, times and
// effects are PROVISIONAL (the Districts-1 block of docs/DECISIONS.md); each has a row in docs/BALANCE.md. Only FINISHED districts have effects.

/** The slots of the highest level City: the row length of the district table (a structural limit, not a tunable). */
export const DISTRICT_MAX_SLOTS = 5;
/** LEGACY visual reference level of a district. NOT a limit any more (Sim-Levels2): districts rise to STRUCT_LEVEL_HARD_CAP. */
export const DISTRICT_MAX_LEVEL = 3;
/** Slots of a City by its (finished) level (Sim-Growth): 2 at levels 1 to 2, 3 at 3 to 5, 4 at 6 to 8, 5 at 9 to 10; every level above 10 keeps 5 (districtSlotsOf). */
export const DISTRICT_SLOTS_BY_LEVEL = [0, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5];
/** Base price in gold per kind (Housing, Market, Barracks, Walls); the n-th district of a kind costs the same escalation as a structure (PRICE_ESCALATION_*), n = districts of that kind the seat owns. An upgrade to level L costs base * L. */
export const DISTRICT_BASE_GOLD = [0, 150, 40, 250, 300];
/** Build (and upgrade, of any level) time in ticks per kind: Housing 8 s, Market 10 s, Barracks 12 s, Walls 12 s. */
export const DISTRICT_BUILD_TICKS = [0, 80, 100, 120, 120];
/** Housing: troop cap added at level 1 (400) and the extra at the asymptote (Sim-Levels2: towards 1200 troops). */
export const HOUSING_TROOPS_BASE = 400;
export const HOUSING_TROOPS_EXTRA = 800;
/** Market: gold per second (milli) at level 1 (0.3) and the extra at the asymptote (towards 0.6). Chosen so that the worst single City (asymptote City, five asymptote Markets, a Factory at the asymptote) stays under 15 gold/s (tests/sim/levels2.test.ts). */
export const MARKET_GOLD_MILLI_BASE = 300;
export const MARKET_GOLD_EXTRA_MILLI = 300;
/** Barracks: percent added to the owner's troop regeneration at level 1 (5) and the extra at the asymptote (towards 15). */
export const BARRACKS_REGEN_PCT_BASE = 5;
export const BARRACKS_REGEN_EXTRA_PCT = 10;
/** The most all Barracks of one owner add together, in percent. */
export const BARRACKS_REGEN_PCT_MAX = 50;
/** Walls: the attacker's cell price in percent on the City's cell and the cells within DISTRICT_WALLS_RADIUS_CELLS, 150 at level 1, towards 200 (extra 50). Does not stack with a Defense Post: the larger percent applies. */
export const WALLS_COST_PCT_BASE = 150;
export const WALLS_COST_EXTRA_PCT = 50;
/** Reach of the Walls round the City in sim cells (Euclidean, x wrapping). */
export const DISTRICT_WALLS_RADIUS_CELLS = 2;
/** The AI's back-off after a think that found no district to build or upgrade, in ticks. */
export const AI_DISTRICT_RETRY_TICKS = 100;
/** The AI builds districts only once it owns this many Cities (round 1 of the Districts-1 tuning: the first Cities come first). */
export const AI_DISTRICT_MIN_CITIES = 3;

// ---------------------------------------------------------------------------------------------------------------
// M18-1: the match end (src/sim/win.ts), the anti-snowball discount and the statistics. The win conditions are switched on per match by
// `config.win` (a match without it never ends). Land is counted in WEIGHTED STANDARD CELLS (Q15 weight sum / (WEIGHT_ONE * STD_CELL_AREA), floored);
// the land-share rule compares the exact weights, so the unit of the score and the unit of the percent rule are the same land.

/** Condition (a): the share of all playable weighted land a nation must hold, in percent (before the overtime curve). */
export const WIN_LAND_SHARE_PCT = 60;
/** Condition (a): ticks the share must be held without a break (300 = 30 s); a dip below the requirement resets the timer. */
export const WIN_HOLD_TICKS = 300;
/** Condition (c): the time limit in ticks counted from the end of the spawn phase, Skirmish (7200 = 12 min). */
export const TIME_LIMIT_SKIRMISH_TICKS = 7200;
/** Condition (c): the time limit in ticks, World (15000 = 25 min). */
export const TIME_LIMIT_WORLD_TICKS = 15000;
/** Overtime: the land requirement falls by OVERTIME_STEP_PCT percentage points for every whole minute after this minute of play (60 percent up to minute 21, 59 from there). */
export const OVERTIME_START_MINUTE = 20;
/** Overtime: percentage points per whole minute after OVERTIME_START_MINUTE. */
export const OVERTIME_STEP_PCT = 1;
/** The overtime curve never asks for less than this share (percent). Structural floor, so the requirement stays a real share. */
export const OVERTIME_MIN_PCT = 1;
/** Score = land (weighted std-cells) + SCORE_CITY_LEVEL_POINTS per finished City level + SCORE_FACTORY_LEVEL_POINTS per finished Factory level. */
export const SCORE_CITY_LEVEL_POINTS = 25;
export const SCORE_FACTORY_LEVEL_POINTS = 10;

/** Anti-snowball: an attacker pays LEADER_COST_PCT_MID percent of the cell price against a NATION that holds MORE than this share of the weighted land (strictly greater). The AI gang-up rule reads the same two thresholds. */
export const LEADER_LAND_PCT_MID = 25;
/** Anti-snowball: the higher threshold (strictly greater than 40 percent). */
export const LEADER_LAND_PCT_HIGH = 40;
/** The attacker's price in percent against a target above LEADER_LAND_PCT_MID (x0.85). */
export const LEADER_COST_PCT_MID = 85;
/** The attacker's price in percent against a target above LEADER_LAND_PCT_HIGH (x0.7); it replaces the mid discount, they never stack. */
export const LEADER_COST_PCT_HIGH = 70;

// M11a: the line-of-sight (LOS) and exposure rules (src/sim/los). Heights in the LOS maths are GAME metres: the real height times GAMEPLAY_HEIGHT_EXAG.
// The ground or ridge is exaggerated, an aircraft's altitude above it (AGL) and an antenna are not. Each constant has a row in docs/BALANCE.md.

/** Height exaggeration of the LOS maths (allowed 6 to 10): a ridge counts this many times its real height. */
export const GAMEPLAY_HEIGHT_EXAG = 8;
/** The effective occluder height of a cell is mean + this percent of (max - mean) (allowed 20 to 60), times GAMEPLAY_HEIGHT_EXAG. Integer percent, not a fraction, so the maths stays in integers. */
export const OCCLUDER_MAX_WEIGHT_PCT = 60;
/** The antenna of a SAM or radar site above its ground, in game metres (not exaggerated). */
export const SITE_ANTENNA_M = 30;
/** Altitude above ground level of the Low flight mode in metres (not exaggerated). */
export const ALT_LOW_AGL_M = 300;
/** Altitude above ground level of the High flight mode in metres (not exaggerated); High ignores the mask, so only M11b's service ceiling reads it. */
export const ALT_HIGH_AGL_M = 3000;
/** The side of a composite tile in cells. */
export const LOS_TILE_CELLS = 64;
/** One step of a mask value in game metres (a Uint16 holds up to 131 070 game metres). */
export const LOS_MASK_UNIT_GM = 2;
/** The rays of a mask are cast to the perimeter of its box at this many targets per cell (1 = one per perimeter cell). */
export const LOS_RAY_OVERSAMPLE = 2;
/** Every mask value is lowered by this many game metres before it is rounded down: the discretisation of the rays may err only in the radar's favour (measured: zero such cells on the eight fixture sites, but 47 of 786376 cells in 17 of 300 random real-world sites (5.7 % of sites) are hidden by the mask and visible by the exact line, M11a owner decision: accepted, finer grid = alternative C in docs/BACKLOG.md). */
export const LOS_MASK_SLACK_GM = 48;
/** Masks of a larger radius than this cast one ray per perimeter cell instead of LOS_RAY_OVERSAMPLE (the ring estimate carries the accuracy; this keeps a R=64 mask under 2 ms). The SAM radii are at most 34 cells. */
export const LOS_RAY_OVERSAMPLE_MAX_RADIUS = 40;

// M11b: air navigation (src/sim/nav). The flight modes are DATA: the arrays below are indexed by the LOS altitude mode (ALT_MODE_LOW = 0, ALT_MODE_HIGH = 1 in src/sim/los/cache.ts).
// Distances and speeds are in SIM cells (1024x512 grid), time-compressed game values (a 60-cell flight takes 20 to 29 s). Each constant has a row in docs/BALANCE.md.

/** Side of a nav cell in sim cells: the 256x128 nav grid of a 1024x512 world (a nav cell = 16 sim cells). */
export const NAV_BLOCK_CELLS = 4;
/** Altitude above ground level per flight mode in real metres [Low, High] (the M11a constants; the service ceiling reads REAL altitude). */
export const AIR_MODE_AGL_M = [ALT_LOW_AGL_M, ALT_HIGH_AGL_M];
/** Helicopter speed per flight mode in thousandths of a sim cell per second [Low, High]: Low (NOE, masked) 2.1, High (visible) 3. */
export const AIR_MODE_SPEED_MILLICELLS_S = [2100, 3000];
/** Fuel of a helicopter in sim cells of flown distance. */
export const HELI_FUEL_CELLS = 180;
/** Service ceiling in REAL metres: a nav cell is closed to a mode when its real mean height plus the mode's real AGL is above this, and always when one of its 16 sim cells is Peak. */
export const SERVICE_CEILING_M = 6000;
/** Weight of the A* heuristic in percent (1.3). */
export const AIR_ROUTE_WEIGHT_PCT = 130;
/** Route cost per step: km * (1 + climb + ceiling + AIR_EXPOSURE_LAMBDA * exposed). An exposed nav cell (radar-seen or inside a Post radius) costs this many extra steps' worth. */
export const AIR_EXPOSURE_LAMBDA = 3;
/** Climb term of the route cost: percent of the step's km per 1000 real metres of height difference between the two nav cells. */
export const AIR_CLIMB_COST_PCT_PER_KM_M = 25;
/** Ceiling term: percent of the step's km added when the cell's altitude is within AIR_CEILING_MARGIN_M of the service ceiling. */
export const AIR_CEILING_COST_PCT = 50;
/** See AIR_CEILING_COST_PCT, real metres. */
export const AIR_CEILING_MARGIN_M = 1000;
/** Landing-zone refusal codes are LZ_REASON_BASE + n (n = 1..8), a range of their own above every REJECT_* code of the intents (Fix-3A2): one integer can never mean both. */
export const LZ_REASON_BASE = 64;
/** A landing zone must stand on a cell whose real mean height is at most this (real metres). */
export const LZ_MAX_ELEV_M = 3500;
/** A landing zone is too steep when the real mean heights of its 3x3 sim cells differ by more than this (real metres). */
export const LZ_STEEP_SPREAD_M = 200;
/** A landing zone within this many sim cells (Euclidean) of an enemy city is refused. */
export const LZ_ENEMY_CITY_CELLS = 2;
/** LZ score: base, minus this per metre of 3x3 height spread, minus this per exposed nav cell of the approach (floor 1). */
export const LZ_SCORE_BASE = 1000;
export const LZ_SCORE_SPREAD_PER_M = 2;
export const LZ_SCORE_EXPOSED_PER_CELL = 60;

// ---------------------------------------------------------------------------------------------------------------
// M12a-1: the helicopter table, production and the fleet cap (src/sim/helis.ts, src/sim/heliRules.ts). The flight numbers of part 2 are the
// M11b mode table above; every constant has a row in docs/BALANCE.md. Provisional: the M12a-1 block of docs/DECISIONS.md.

/** Slots of the helicopter table (a structural limit): ids 0..HELI_CAPACITY - 1. The fleet cap (HELI_FLEET_MAX) is far below it, so the table never fills. */
export const HELI_CAPACITY = 64;
/** Slots of the beachhead table (a structural limit): at most this many landings are tracked at once. */
export const BEACHHEAD_CAPACITY = 64;
/** Waypoints one helicopter can store for its route (a structural limit of the fixed per-helicopter route buffer; part 2 refuses a longer route with NO_ROUTE). */
export const HELI_ROUTE_CAPACITY = 64;
/** Price of one helicopter in whole gold, taken when ProduceHeli is applied. */
export const HELI_PRICE_GOLD = 200;
/** Production time of a helicopter in ticks (12 s), one at a time per Factory. */
export const HELI_BUILD_TICKS = 120;
/** Fleet cap = HELI_FLEET_BASE + the sum of the levels of the seat's finished Factories, at most HELI_FLEET_MAX; a helicopter under production counts. */
export const HELI_FLEET_BASE = 2;
/** The hard top of the fleet cap (Sim-Levels2 lets Factory levels reach 999, so this clamps). */
export const HELI_FLEET_MAX = 12;
/** Most troops one helicopter carries. */
export const HELI_MAX_TROOPS = 600;
/** Hit points of a helicopter in tenths (100.0 HP). */
export const HELI_HP_TENTHS = 1000;
/** Fuel of a full tank in Q8 sim cells (HELI_FUEL_CELLS * 256): the fuel field of the table counts down from this as the helicopter flies. */
export const HELI_FUEL_MAX_Q8 = 46080;

// ---------------------------------------------------------------------------------------------------------------
// M12a-2: the flight (src/sim/heliFlight.ts). Speeds, AGL and fuel are the M11b mode table above; these are the timings and the terrain-following
// numbers. Every constant has a row in docs/BALANCE.md. Provisional: the M12a-2 block of docs/DECISIONS.md.

/** Ticks a helicopter spends lifting off before it cruises (2 s). */
export const HELI_TAKEOFF_TICKS = 20;
/** Ticks it hovers over the landing zone before it unloads (3 s). */
export const HELI_HOVER_TICKS = 30;
/** Ticks a downed helicopter stays in the table before it is removed (5 s). */
export const HELI_DOWNED_TICKS = 50;
/** Clearance in GAME metres above the occluder height of the cell it flies over: alt = max(EXAG * mean + AGL, occluder + this). Not exaggerated. */
export const HELI_CLEARANCE_GAME_M = 100;
/** The most the altitude may change per sim cell flown, in game metres (rises are planned over HELI_LOOKAHEAD_CELLS cells; the floor above wins when the ground is steeper). */
export const HELI_VERT_GM_PER_CELL = 4000;
/** A helicopter on the last leg is APPROACHING (a state of its own) when it is this many cells or fewer from the landing zone. */
export const HELI_APPROACH_CELLS = 5;
/** Terrain-following look-ahead in cells along the heading (samples at 1..this). */
export const HELI_LOOKAHEAD_CELLS = 4;
