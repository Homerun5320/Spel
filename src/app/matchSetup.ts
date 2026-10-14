// The match setup (M06, items 3, 4, 6 and 7): the options of a match as one plain config, and `createMatch(world, config)`, the PURE,
// SEEDED function that turns a config into the state at tick 0 plus who is who. The same world, config and seed give the same state
// (same hash); an invalid config gives an error result with an i18n key, never an exception and never a half-built match.
//
// What a match is (D112 to D118):
//  - The FAIR START: every nation (you and each AI nation) is placed at tick 0 by the sim's own Spawn (the K = START_DISC_CELLS
//    nearest contiguous unowned land cells around its capital, hash tie-break) and gets the same start troops and gold. A country (or a
//    custom start cell) is allowed only if its connected land mass has at least K cells (src/app/eligibility.ts), so the disc is
//    always whole; an AI nation whose disc would come out short because earlier discs took its land is replaced by the next candidate.
//  - The AI nations take OTHER selectable real countries from a SEEDED order; their capitals are at least
//    SETUP_CAPITAL_MIN_DISTANCE_CELLS apart. In the neutral "no real borders" mode they get invented names and nobody gets a home land.
//  - The tribes (when on) are placed at tick 0 as well, on whole discs of clear land near your capital, by the AI's own place search.
//  - The REGION is a playable mask (src/data/regions.ts); cells outside it are unplayable in the match world, so no cell outside is
//    ever owned.
//  - HOME RULES (the home-land discount for the owner, the coast and mountain traits) are on when you play a real country and not in the
//    neutral mode; a custom nation is a match on equal footing without them (D112).
// This file builds a sim state, so it is one of the files the front-end import rule exempts (eslint.config.js, D117).
import { pickSpawnCell } from '../ai';
import { isRegionId, type RegionId } from '../data/regions';
import { traitMilli } from '../sim/homeRules';
import { createRng, nextBelow } from '../sim/public';
import {
  AI_TRIBE_CLEARANCE_CELLS,
  AI_TRIBE_REACH_CELLS,
  MATCH_TRIBES,
  SETUP_AI_NATIONS_DEFAULT,
  SETUP_AI_NATIONS_MAX,
  SETUP_CAPITAL_MIN_DISTANCE_CELLS,
  START_DISC_CELLS,
  TRAIT_COAST_GAIN_PCT,
  TRAIT_COAST_MID_PERMILLE,
  TRAIT_MOUNTAIN_GAIN_PCT,
  TRAIT_MOUNTAIN_MID_PERMILLE,
} from '../sim/rules';
import { startSeats, type SeatStart } from '../sim/setup';
import { countDisc } from '../sim/spawn';
import type { GameState } from '../sim/state';
import { StateView } from '../sim/view';
import { createWorldState } from '../sim/world';
import { makeFlagSpec, type FlagSpec } from '../ui/flag';
import type { TextKey } from '../ui/i18n';
import { createSeatLabels, type SeatIdentity, type SeatLabels } from '../ui/seatLabels';
import { CUSTOM_NAME_MAX_CHARS } from '../ui/uiConfig';
import { countryEligibility, startCellEligibility } from './eligibility';
import { inventName } from './inventedNames';
import type { CountryInfo, PreparedWorld, RegionAnalysis } from './matchWorld';

export type Difficulty = 'easy' | 'normal' | 'hard';
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];

/** You play a real country: you start on its capital. */
export interface RealPlayer {
  readonly kind: 'real';
  readonly countryId: number;
}

/** You play an invented nation: a name, a colour (0xRRGGBB), a flag seed and a free start cell. */
export interface CustomPlayer {
  readonly kind: 'custom';
  readonly name: string;
  readonly color: number;
  readonly flagSeed: number;
  readonly cell: number;
}

export type PlayerChoice = RealPlayer | CustomPlayer;

/** The options of a match. Plain data: the menu builds it, the address hash and the preferences may carry parts of it. */
export interface MatchSetupConfig {
  readonly seed: number;
  /** World or a Skirmish cut-out (src/data/regions.ts). */
  readonly region: RegionId;
  readonly player: PlayerChoice;
  /** AI nations besides you, 0 .. SETUP_AI_NATIONS_MAX. */
  readonly aiNations: number;
  /** Tribes on or off (MATCH_TRIBES when on). */
  readonly tribes: boolean;
  /** Stored for the AI (M16); nothing reads it yet. */
  readonly difficulty: Difficulty;
  /** "No real borders": no borders or country names are drawn, the AI nations get invented names, nobody gets a home land. Needs a custom player. */
  readonly neutral: boolean;
  /** Your seat among the players (0 .. aiNations); the AI plays every other player seat. */
  readonly humanSeat: number;
  /** The 20 s spawn phase and 5 s immunity of M05 (all capitals are placed at tick 0 already, so this only delays the first attack). */
  readonly spawnPhase: boolean;
  /** Allows the test-only intents. */
  readonly debugIntents: boolean;
}

/** A config with the defaults of the options (12 AI nations, tribes on, normal difficulty, the whole world, seed 1). */
export function matchSetupConfig(player: PlayerChoice, options: Partial<Omit<MatchSetupConfig, 'player'>> = {}): MatchSetupConfig {
  return {
    seed: options.seed ?? 1,
    region: options.region ?? 'world',
    player,
    aiNations: options.aiNations ?? SETUP_AI_NATIONS_DEFAULT,
    tribes: options.tribes ?? true,
    difficulty: options.difficulty ?? 'normal',
    neutral: options.neutral ?? false,
    humanSeat: options.humanSeat ?? 0,
    spawnPhase: options.spawnPhase ?? true,
    debugIntents: options.debugIntents ?? false,
  };
}

export type SetupErrorCode = 'invalid' | 'neutralNeedsCustom' | 'unknownCountry' | 'notSelectable' | 'startCell' | 'notEnoughCountries';

/** Why a config was refused: a code for the tests and an i18n key with its parameters for the player. */
export interface SetupError {
  readonly code: SetupErrorCode;
  readonly key: TextKey;
  readonly params: Readonly<Record<string, string | number>>;
}

/** One seat of the built match. */
export interface SeatInfo {
  readonly seat: number;
  readonly kind: 'human' | 'ai' | 'tribe';
  readonly identity: SeatIdentity;
  readonly flag: FlagSpec | null;
  /** The capital cell, or -1 for a tribe that found no place. */
  readonly capitalCell: number;
  /** The real country the seat stands for (0 = none). */
  readonly countryId: number;
}

export interface BuiltMatch {
  /** The state at tick 0 with every placed seat spawned. Fresh: shares nothing with the world or another match. */
  readonly state: GameState;
  readonly config: MatchSetupConfig;
  readonly region: RegionId;
  readonly humanSeat: number;
  /** Players = you + the AI nations; the tribes are the seats after them. */
  readonly players: number;
  readonly seats: readonly SeatInfo[];
  /** Tribes that found a place (at most MATCH_TRIBES, 0 when tribes are off). */
  readonly tribesPlaced: number;
  /** Is the home-land rule in this match? */
  readonly homeRules: boolean;
  /** The colour a custom nation chose (0xRRGGBB), else null. */
  readonly humanColor: number | null;
  /** Names and flags of the seats for the HUD and the leaderboard. */
  readonly labels: SeatLabels;
}

export type CreateMatchResult = { readonly ok: true; readonly match: BuiltMatch } | { readonly ok: false; readonly error: SetupError };

// ---------------------------------------------------------------------------------------------------------------------

const PICK_SALT = 0x5049434b; // 'PICK'
const NAME_SALT = 0x4e414d45; // 'NAME'
const TRIBE_SALT = 0x54524942; // 'TRIB'
const FLAG_SALT = 0x464c4731; // 'FLG1'

/** A 32-bit mix of a seed and a number (deterministic, no floats). */
function mix(seed: number, n: number): number {
  let h = (Math.imul(n | 0, 0x27d4eb2d) ^ Math.imul(seed | 0, 0x9e3779b1)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) | 0;
}

function fail(code: SetupErrorCode, key: TextKey, params: Readonly<Record<string, string | number>> = {}): CreateMatchResult {
  return { ok: false, error: { code, key, params } };
}

function invalid(field: string): CreateMatchResult {
  return fail('invalid', 'setup.error.invalid', { field });
}

function isInt(x: unknown, lo: number, hi: number): x is number {
  return typeof x === 'number' && Number.isInteger(x) && x >= lo && x <= hi;
}

/** Runtime check of a config (it may come from an address or a stored preference): the name of the first bad field, or null. */
function badField(c: MatchSetupConfig): string | null {
  if (typeof c !== 'object' || c === null) return 'config';
  if (!isInt(c.seed, -2147483648, 4294967295)) return 'seed';
  if (!isRegionId(c.region)) return 'region';
  if (!isInt(c.aiNations, 0, SETUP_AI_NATIONS_MAX)) return 'aiNations';
  if (typeof c.tribes !== 'boolean') return 'tribes';
  if (!DIFFICULTIES.includes(c.difficulty)) return 'difficulty';
  if (typeof c.neutral !== 'boolean') return 'neutral';
  if (!isInt(c.humanSeat, 0, typeof c.aiNations === 'number' ? c.aiNations : 0)) return 'humanSeat';
  if (typeof c.spawnPhase !== 'boolean') return 'spawnPhase';
  if (typeof c.debugIntents !== 'boolean') return 'debugIntents';
  const p = c.player as PlayerChoice | null | undefined;
  if (typeof p !== 'object' || p === null) return 'player';
  if (p.kind === 'real') return isInt(p.countryId, 1, 255) ? null : 'player.countryId';
  if (p.kind === 'custom') {
    if (typeof p.name !== 'string' || p.name.trim().length === 0 || p.name.trim().length > CUSTOM_NAME_MAX_CHARS) return 'player.name';
    if (!isInt(p.color, 0, 0xffffff)) return 'player.color';
    if (!isInt(p.flagSeed, -2147483648, 4294967295)) return 'player.flagSeed';
    return isInt(p.cell, 0, Number.MAX_SAFE_INTEGER) ? null : 'player.cell';
  }
  return 'player.kind';
}

/** Squared distance of two cells on the cylinder (x wraps). */
function distance2(width: number, a: number, b: number): number {
  const ax = a % width;
  const bx = b % width;
  const dx0 = Math.abs(ax - bx);
  const dx = Math.min(dx0, width - dx0);
  const dy = (a - ax) / width - (b - bx) / width;
  return dx * dx + dy * dy;
}

/** The countries an AI nation may take: selectable in the region, not the player's own, in table order. */
function nationPool(world: PreparedWorld, analysis: RegionAnalysis, playerCountry: number): CountryInfo[] {
  return world.countries.filter((c) => c.id !== playerCountry && countryEligibility(analysis, c).ok);
}

/** A Fisher-Yates shuffle with the given stream (a new array). */
function shuffled<T>(items: readonly T[], rng: Uint32Array): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = nextBelow(rng, i + 1);
    const t = a[i] as T;
    a[i] = a[j] as T;
    a[j] = t;
  }
  return a;
}

interface Placed {
  readonly seat: number;
  readonly cell: number;
  readonly country: CountryInfo | null;
}

/** The sim rules of a seat that stands for a real country in a match with home rules. */
function seatRules(c: CountryInfo): SeatStart['rules'] {
  return {
    homeLand: c.homeId,
    portMilli: traitMilli(c.coastPermille, TRAIT_COAST_MID_PERMILLE, TRAIT_COAST_GAIN_PCT),
    defenceMilli: traitMilli(c.mountainPermille, TRAIT_MOUNTAIN_MID_PERMILLE, TRAIT_MOUNTAIN_GAIN_PCT),
  };
}

/**
 * Builds the match. `lenient` (used by `maxAiNations`) returns the match with as many AI nations as could be placed instead of the
 * error 'notEnoughCountries'; the seats that found no country stay unplaced.
 */
function build(world: PreparedWorld, config: MatchSetupConfig, lenient: boolean): CreateMatchResult {
  const bad = badField(config);
  if (bad !== null) return invalid(bad);
  const analysis = world.analyse(config.region);
  const player = config.player;

  // The player's place.
  let playerCountry: CountryInfo | null = null;
  let humanCell: number;
  if (player.kind === 'real') {
    if (config.neutral) return fail('neutralNeedsCustom', 'setup.error.neutralNeedsCustom');
    playerCountry = world.byId.get(player.countryId) ?? null;
    if (playerCountry === null) return invalid('player.countryId');
    const e = countryEligibility(analysis, playerCountry);
    if (!e.ok) return fail('notSelectable', e.key as TextKey, e.params === null ? {} : { cells: e.params.cells, need: e.params.need });
    humanCell = playerCountry.capitalCell;
  } else {
    const e = startCellEligibility(world, analysis, player.cell);
    if (!e.ok) return fail('startCell', e.key as TextKey, e.params === null ? {} : { cells: e.params.cells, need: e.params.need });
    humanCell = player.cell;
  }

  const homeRules = player.kind === 'real' && !config.neutral;
  const players = 1 + config.aiNations;
  const tribeSeats = config.tribes ? MATCH_TRIBES : 0;
  const countryMap = homeRules ? new Uint8Array(world.width * world.height) : undefined;
  if (countryMap !== undefined) {
    const homeOf = new Uint8Array(256);
    for (const c of world.countries) homeOf[c.id] = c.homeId;
    for (let i = 0; i < countryMap.length; i++) countryMap[i] = homeOf[world.data.country[i] as number] as number;
  }
  const state = createWorldState(analysis.world, {
    seed: config.seed,
    seats: players + tribeSeats,
    players,
    config: { debugIntents: config.debugIntents, spawnPhase: config.spawnPhase, homeRules },
    countryMap,
  });

  const placed: Placed[] = [];
  const place = (seat: number, cell: number, country: CountryInfo | null): boolean => {
    const rules = homeRules && country !== null ? seatRules(country) : undefined;
    const codes = startSeats(state, [rules === undefined ? { seat, cell } : { seat, cell, rules }]);
    if (codes[0] !== 0) return false;
    placed.push({ seat, cell, country });
    return true;
  };

  // You first, on an empty map: the land mass rule guarantees the whole disc.
  if (!place(config.humanSeat, humanCell, playerCountry) || (state.agg.area[config.humanSeat + 1] as number) !== START_DISC_CELLS) {
    return fail('startCell', 'setup.start.terrain');
  }

  // The AI nations: a seeded order of the other selectable countries, the next candidate when one is too close or too short.
  const order = shuffled(nationPool(world, analysis, playerCountry?.id ?? 0), createRng(mix(config.seed, PICK_SALT)));
  const minD2 = SETUP_CAPITAL_MIN_DISTANCE_CELLS * SETUP_CAPITAL_MIN_DISTANCE_CELLS;
  const aiSeats: number[] = [];
  for (let seat = 0; seat < players; seat++) if (seat !== config.humanSeat) aiSeats.push(seat);
  let next = 0;
  let aiPlaced = 0;
  for (const seat of aiSeats) {
    let done = false;
    while (next < order.length && !done) {
      const c = order[next++] as CountryInfo;
      const cell = c.capitalCell;
      let far = true;
      for (const p of placed) {
        if (distance2(world.width, p.cell, cell) < minD2) {
          far = false;
          break;
        }
      }
      if (far && countDisc(state, cell) === START_DISC_CELLS) done = place(seat, cell, c);
    }
    if (!done && !lenient) return fail('notEnoughCountries', 'setup.error.notEnoughCountries', { available: aiPlaced, wanted: config.aiNations });
    if (done) aiPlaced++;
  }

  // The tribes: whole discs of clear land near the player, by the AI's place search (a tribe with no place stays unplaced).
  let tribesPlaced = 0;
  const humanCapital = (placed[0] as Placed).cell;
  if (tribeSeats > 0) {
    const view = new StateView(state);
    for (let t = 0; t < tribeSeats; t++) {
      const seat = players + t;
      const rng = createRng(mix(config.seed, TRIBE_SALT + seat));
      const cell = pickSpawnCell(view, rng, AI_TRIBE_CLEARANCE_CELLS, humanCapital, AI_TRIBE_REACH_CELLS);
      if (cell >= 0 && countDisc(state, cell) === START_DISC_CELLS && place(seat, cell, null)) tribesPlaced++;
    }
  }

  // Who is who: names and flags.
  const names = createRng(mix(config.seed, NAME_SALT));
  const taken = new Set<string>(player.kind === 'custom' ? [player.name.trim()] : []);
  const cellOf = new Map<number, Placed>();
  for (const p of placed) cellOf.set(p.seat, p);
  const seats: SeatInfo[] = [];
  for (let seat = 0; seat < players + tribeSeats; seat++) {
    const p = cellOf.get(seat);
    const capitalCell = p === undefined ? -1 : p.cell;
    if (seat >= players) {
      seats.push({ seat, kind: 'tribe', identity: { kind: 'generic' }, flag: null, capitalCell, countryId: 0 });
      continue;
    }
    if (seat === config.humanSeat) {
      if (player.kind === 'custom') {
        seats.push({ seat, kind: 'human', identity: { kind: 'custom', name: player.name.trim() }, flag: makeFlagSpec(player.flagSeed, { primary: player.color }), capitalCell, countryId: 0 });
      } else {
        const c = playerCountry as CountryInfo;
        seats.push({ seat, kind: 'human', identity: { kind: 'country', nameEn: c.nameEn, nameSv: c.nameSv }, flag: makeFlagSpec(mix(config.seed, FLAG_SALT + c.id)), capitalCell, countryId: c.id });
      }
      continue;
    }
    if (p === undefined) {
      // A nation that found no country (only in the lenient count): no identity, no flag.
      seats.push({ seat, kind: 'ai', identity: { kind: 'generic' }, flag: null, capitalCell, countryId: 0 });
    } else if (config.neutral || p.country === null) {
      const name = inventName(names, taken);
      taken.add(name);
      seats.push({ seat, kind: 'ai', identity: { kind: 'invented', name }, flag: makeFlagSpec(mix(config.seed, FLAG_SALT + 1000 + seat)), capitalCell, countryId: 0 });
    } else {
      const c = p.country;
      seats.push({ seat, kind: 'ai', identity: { kind: 'country', nameEn: c.nameEn, nameSv: c.nameSv }, flag: makeFlagSpec(mix(config.seed, FLAG_SALT + c.id)), capitalCell, countryId: c.id });
    }
  }

  const match: BuiltMatch = {
    state,
    config,
    region: config.region,
    humanSeat: config.humanSeat,
    players,
    seats,
    tribesPlaced,
    homeRules,
    humanColor: player.kind === 'custom' ? player.color : null,
    labels: createSeatLabels(
      seats.map((s) => ({ identity: s.identity, flag: s.flag })),
      players,
      config.humanSeat,
    ),
  };
  return { ok: true, match };
}

/** Builds the match of a config: pure and seeded (the same world, config and seed always give the same state), an error result for an invalid config. */
export function createMatch(world: PreparedWorld, config: MatchSetupConfig): CreateMatchResult {
  return build(world, config, false);
}

/**
 * How many AI nations this config (its region, player and seed) can really have, 0 .. SETUP_AI_NATIONS_MAX: the number the menu offers as
 * the upper end of the slider. It builds the match with the most nations and counts the ones that found a country.
 */
export function maxAiNations(world: PreparedWorld, config: MatchSetupConfig): number {
  const r = build(world, { ...config, aiNations: SETUP_AI_NATIONS_MAX, humanSeat: 0, tribes: false }, true);
  if (!r.ok) return 0;
  return r.match.seats.filter((s) => s.kind === 'ai' && s.capitalCell >= 0).length;
}

/**
 * The colours a custom nation can choose as its own (the menu's swatches). Not the whole flag palette: a territory must be readable on
 * the globe, so every swatch is at least 38 dE76 from the sea and land colours (no blue, green, teal, brown, grey or sand; D108), and
 * the owner palette keeps every other seat at least OWN_SEPARATION_DE away from the chosen one (tests/render/ownerPalette.test.ts).
 */
export const CUSTOM_COLORS: readonly number[] = Object.freeze([
  0xc8102e, // red
  0xf26b21, // orange
  0xfcd116, // yellow
  0xd1318f, // magenta
  0x6a2d91, // purple
  0xf08aa8, // pink
]);
