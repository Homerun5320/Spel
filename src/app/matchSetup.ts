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
import { pickSpawnCell } from '../ai/place';
import type { Federations, SubNation } from '../data/federations';
import { isRegionId, type RegionId } from '../data/regions';
import { bindFederation } from '../sim/diplomacy';
import { traitMilli } from '../sim/homeRules';
import { validWinConfig, type WinConfig } from '../sim/matchState';
import { createRng, nextBelow } from '../sim/public';
import {
  AI_TRIBE_CLEARANCE_CELLS,
  AI_TRIBE_REACH_CELLS,
  FEDERATION_MIN_AI_NATIONS,
  MATCH_TRIBES,
  SETUP_AI_NATIONS_DEFAULT,
  SETUP_AI_NATIONS_MAX,
  SETUP_CAPITAL_MIN_DISTANCE_CELLS,
  START_DISC_CELLS,
  TRAIT_COAST_GAIN_PCT,
  TRAIT_COAST_MID_PERMILLE,
  TRAIT_MOUNTAIN_GAIN_PCT,
  TIME_LIMIT_SKIRMISH_TICKS,
  TIME_LIMIT_WORLD_TICKS,
  TRAIT_MOUNTAIN_MID_PERMILLE,
  WIN_HOLD_TICKS,
  WIN_LAND_SHARE_PCT,
} from '../sim/rules';
import { startSeats, type SeatStart } from '../sim/setup';
import { claimDisc, countDisc } from '../sim/spawn';
import type { GameState } from '../sim/state';
import { StateView } from '../sim/view';
import { createWorldState } from '../sim/world';
import { makeFlagSpec, type FlagSpec } from '../ui/flag';
import type { TextKey } from '../ui/i18n';
import { createSeatLabels, type FederationLabel, type SeatIdentity, type SeatLabels } from '../ui/seatLabels';
import { CUSTOM_NAME_MAX_CHARS } from '../ui/uiConfig';
import { countryWithName } from './countrySearch';
import { countryEligibility, startCellEligibility } from './eligibility';
import { membersOf, subNationName } from './federationSetup';
import { inventName } from './inventedNames';
import type { CountryInfo, PreparedWorld, RegionAnalysis } from './matchWorld';

export { FEDERATION_MIN_AI_NATIONS };

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
  /**
   * The win conditions of the match (M18-1): which of the three are on and their numbers. Absent = the defaults of `defaultWinConfig(region)`
   * (all three on; this is what a real match gets); `null` = the match never ends (tests, the pace tool and the selfplay scripts pin this).
   */
  readonly win?: WinConfig | null;
  /**
   * M18b-2 "Dela upp stormakter": a federation candidate (src/data/federations.ts) that you play or an AI nation picks is replaced by its sub-nations,
   * allied from tick 0 and unable to break it. Absent / false = the match of before (byte-identical).
   */
  readonly federations?: boolean;
  /** The sub-nation id (the federation raster value) you play when your country is split; 0 or absent = the one holding the capital, else the largest. */
  readonly subNation?: number;
}

/** The default win block of a region (M18-1): all three conditions on, 60 percent held for 300 ticks, the time limit of a Skirmish (12 min) or of the World (25 min). */
export function defaultWinConfig(region: RegionId): WinConfig {
  return {
    land: true,
    last: true,
    score: true,
    timeLimitTicks: region === 'world' ? TIME_LIMIT_WORLD_TICKS : TIME_LIMIT_SKIRMISH_TICKS,
    landSharePct: WIN_LAND_SHARE_PCT,
    holdTicks: WIN_HOLD_TICKS,
  };
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
    ...(options.win !== undefined ? { win: options.win } : {}),
    ...(options.federations === true ? { federations: true } : {}),
    ...(options.subNation !== undefined && options.subNation > 0 ? { subNation: options.subNation } : {}),
  };
}

export type SetupErrorCode = 'invalid' | 'neutralNeedsCustom' | 'unknownCountry' | 'notSelectable' | 'startCell' | 'notEnoughCountries' | 'nameTaken' | 'federationNeedsAi';

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
  /** M18b-2: the sub-nation id (federation raster value) the seat plays; absent for every other seat. Its country is `countryId`. */
  readonly subNation?: number;
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
  /** M18b-2: the seats of each federation (two or more allied sub-nations), in seat order; empty unless "Dela upp stormakter" split a country. */
  readonly federationGroups: readonly (readonly number[])[];
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
  if (c.win !== undefined && c.win !== null && !validWinConfig(c.win)) return 'win';
  if (c.federations !== undefined && typeof c.federations !== 'boolean') return 'federations';
  if (c.subNation !== undefined && !isInt(c.subNation, 0, 255)) return 'subNation';
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

/** How many cells of a sub-nation (nearest to its centre first, inland ones only) are tried as a capital before it is given up on. */
const START_TRIES = 400;
const RING: ReadonlyArray<readonly [number, number]> = [[4, 0], [-4, 0], [0, 4], [0, -4], [3, 3], [-3, 3], [3, -3], [-3, -3]];

/**
 * A capital cell for a sub-nation whose Spawn disc (the K nearest contiguous unowned land cells) lies WHOLLY inside the sub-nation, or -1 when no
 * cell near its centre gives one (the sub-nation is then left out). `prefer` (a cell, or -1) is tried first, then the cells in order of
 * their distance to the centre. Changes nothing (dry walk).
 */
function subNationStart(state: GameState, f: Federations, sub: SubNation, prefer: number): number {
  const width = f.width;
  const raster = f.federationRaster;
  const inside = (c: number): boolean => raster[c] === sub.id;
  const whole = (c: number): boolean => {
    if (state.grid.playable[c] !== 1 || state.owner[c] !== 0) return false;
    const claimed: number[] = [];
    if (claimDisc(state, c, 0, 0, claimed, true) !== START_DISC_CELLS) return false;
    for (const k of claimed) if (!inside(k)) return false;
    return true;
  };
  if (prefer >= 0 && inside(prefer) && whole(prefer)) return prefer;
  const cx = sub.centroid % width;
  const cy = Math.floor(sub.centroid / width);
  const list: Array<{ d: number; cell: number }> = [];
  for (let c = 0; c < raster.length; c++) {
    if (raster[c] !== sub.id || state.grid.playable[c] !== 1) continue;
    const dx = (c % width) - cx;
    const dy = Math.floor(c / width) - cy;
    list.push({ d: dx * dx + dy * dy, cell: c });
  }
  list.sort((a, b) => a.d - b.d || a.cell - b.cell);
  // Nearest to the centre first. A cheap look at eight points around the cell skips the ones near the edge before the (dearer) dry walk.
  const ring = (c: number): boolean => {
    const x = c % width;
    const y = Math.floor(c / width);
    for (const [dx, dy] of RING) {
      const yy = y + dy;
      if (yy < 0 || yy >= f.height || raster[yy * width + ((x + dx + width) % width)] !== sub.id) return false;
    }
    return true;
  };
  let tries = 0;
  for (const { cell } of list) {
    if (!ring(cell)) continue;
    if (whole(cell)) return cell;
    if (++tries >= START_TRIES) break;
  }
  return -1;
}

/**
 * M18b-2: how the player's federation candidate splits: the sub-nation you play, its capital cell and the partner sub-nations (cell each), or null when
 * the country stays whole (not a candidate, or fewer than two sub-nations can start). Their starts are found on an empty map.
 */
function planHumanSplit(
  analysis: RegionAnalysis,
  fed: Federations,
  config: MatchSetupConfig,
  playerCountry: CountryInfo,
): { sub: SubNation; cell: number; partners: Array<{ sub: SubNation; cell: number }> } | null {
  const members = membersOf(fed, playerCountry);
  if (members.length < 2) return null;
  const scratch = createWorldState(analysis.world, { seed: config.seed, seats: 1, players: 1, config: { debugIntents: false, spawnPhase: false, homeRules: false } });
  const starts: Array<{ sub: SubNation; cell: number }> = [];
  for (const m of members) {
    const cell = subNationStart(scratch, fed, m, fed.federationRaster[playerCountry.capitalCell] === m.id ? playerCountry.capitalCell : -1);
    if (cell >= 0) starts.push({ sub: m, cell });
  }
  if (starts.length < 2) return null;
  const wanted = config.subNation ?? 0;
  let me = starts.find((x) => x.sub.id === wanted);
  me ??= starts.find((x) => x.sub.id === fed.federationRaster[playerCountry.capitalCell]);
  me ??= starts.reduce((a, b) => (b.sub.cells > a.sub.cells ? b : a));
  return { sub: me.sub, cell: me.cell, partners: starts.filter((x) => x !== me) };
}

/**
 * Fix-5A2: the fewest AI nations a config may have. FEDERATION_MIN_AI_NATIONS when "Dela upp stormakter" is on and the chosen country really splits
 * (the same decision createMatch takes), else 0 (India and every non-candidate stay whole). A bad config gives 0 (createMatch refuses it itself).
 */
export function federationMinAiNations(world: PreparedWorld, config: MatchSetupConfig): number {
  if (config.federations !== true || badField(config) !== null || config.player.kind !== 'real' || config.neutral) return 0;
  const fed = world.data.federations ?? null;
  const country = world.byId.get(config.player.countryId) ?? null;
  if (fed === null || country === null) return 0;
  const analysis = world.analyse(config.region);
  if (!countryEligibility(analysis, country).ok) return 0;
  return planHumanSplit(analysis, fed, config, country) === null ? 0 : FEDERATION_MIN_AI_NATIONS;
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
  /** The sub-nation this seat plays (M18b-2), or null. */
  readonly sub: SubNation | null;
}

/**
 * The sim rules of a seat that stands for a real country in a match with home rules. A SUB-NATION of a federation keeps the country's coast and
 * mountain traits but has NO home land: a discount on the whole country's ground would be twelve times the discount of one nation (DECISIONS M18b-2).
 */
function seatRules(c: CountryInfo, subNation = false): SeatStart['rules'] {
  return {
    homeLand: subNation ? 0 : c.homeId,
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
  // A custom nation may not carry the name of a real country (every one of them can be an AI nation of this very match, and in the leaderboard
  // two nations with one name could not be told apart). The invented AI names of the neutral mode already skip the custom name.
  if (player.kind === 'custom') {
    const clash = countryWithName(world.countries, player.name);
    if (clash !== null) return fail('nameTaken', 'setup.error.nameTaken', { name: player.name.trim() });
  }

  // The player's place.
  let playerCountry: CountryInfo | null = null;
  let humanCell: number;  // reassigned by the federation split below
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

  // M18b-2: "Dela upp stormakter". The player's country, when it is a federation candidate, becomes its sub-nations: you play one, the others are AI
  // partners (allied from tick 0). Their starts are found on an empty map first, because the number of seats depends on how many sub-nations can start.
  const fed = config.federations === true ? (world.data.federations ?? null) : null;
  const split = fed !== null && playerCountry !== null ? planHumanSplit(analysis, fed, config, playerCountry) : null;
  const humanSub: SubNation | null = split === null ? null : split.sub;
  const partners: Array<{ sub: SubNation; cell: number }> = split === null ? [] : split.partners;
  if (split !== null) humanCell = split.cell;
  // Fix-5A2: a federation without an outsider would win "last alive" 20 s in (win.ts counts groups), so the match needs one AI nation.
  if (split !== null && config.aiNations < FEDERATION_MIN_AI_NATIONS) return fail('federationNeedsAi', 'setup.error.federationNeedsAi', { min: FEDERATION_MIN_AI_NATIONS });
  const aiOthers = Math.min(config.aiNations, SETUP_AI_NATIONS_MAX - partners.length);
  const players = 1 + partners.length + aiOthers;
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
    config: { debugIntents: config.debugIntents, spawnPhase: config.spawnPhase, homeRules, ...(config.win === null ? {} : { win: config.win ?? defaultWinConfig(config.region) }) },
    countryMap,
  });

  const placed: Placed[] = [];
  const groups: number[][] = [];
  const place = (seat: number, cell: number, country: CountryInfo | null, sub: SubNation | null = null): boolean => {
    const rules = homeRules && country !== null ? seatRules(country, sub !== null) : undefined;
    const codes = startSeats(state, [rules === undefined ? { seat, cell } : { seat, cell, rules }]);
    if (codes[0] !== 0) return false;
    placed.push({ seat, cell, country, sub });
    return true;
  };

  // You first, on an empty map: the land mass rule guarantees the whole disc.
  if (!place(config.humanSeat, humanCell, playerCountry, humanSub) || (state.agg.area[config.humanSeat + 1] as number) !== START_DISC_CELLS) {
    return fail('startCell', 'setup.start.terrain');
  }

  // The AI nations: a seeded order of the other selectable countries, the next candidate when one is too close or too short.
  const order = shuffled(nationPool(world, analysis, playerCountry?.id ?? 0), createRng(mix(config.seed, PICK_SALT)));
  const minD2 = SETUP_CAPITAL_MIN_DISTANCE_CELLS * SETUP_CAPITAL_MIN_DISTANCE_CELLS;
  const aiSeats: number[] = [];
  for (let seat = 0; seat < players; seat++) if (seat !== config.humanSeat) aiSeats.push(seat);
  let next = 0;
  let aiPlaced = 0;
  // The partners of your federation take the first AI seats.
  if (humanSub !== null) {
    const group = [config.humanSeat];
    partners.forEach((x, i) => {
      if (place(aiSeats[i] as number, x.cell, playerCountry, x.sub)) group.push(aiSeats[i] as number);
    });
    groups.push(group);
    aiPlaced += partners.length;
  }
  const rest = aiSeats.slice(partners.length);
  let si = 0;
  while (si < rest.length) {
    let done = false;
    while (next < order.length && !done) {
      const c = order[next++] as CountryInfo;
      // An AI candidate country is split too when all its sub-nations that can start fit in the seats that are left.
      const members = fed === null ? [] : membersOf(fed, c);
      if (fed !== null && members.length >= 2) {
        const starts: Array<{ sub: SubNation; cell: number }> = [];
        for (const m of members) {
          const at = subNationStart(state, fed, m, fed.federationRaster[c.capitalCell] === m.id ? c.capitalCell : -1);
          if (at >= 0) starts.push({ sub: m, cell: at });
        }
        if (starts.length >= 2 && starts.length <= rest.length - si) {
          const group: number[] = [];
          for (const x of starts) {
            const seat = rest[si++] as number;
            if (place(seat, x.cell, c, x.sub)) group.push(seat);
            aiPlaced++;
          }
          groups.push(group);
          done = true;
          continue;
        }
      }
      const cell = c.capitalCell;
      let far = true;
      for (const p of placed) {
        if (distance2(world.width, p.cell, cell) < minD2) {
          far = false;
          break;
        }
      }
      if (far && countDisc(state, cell) === START_DISC_CELLS) done = place(rest[si] as number, cell, c);
      if (done) {
        si++;
        aiPlaced++;
      }
    }
    if (!done) {
      if (!lenient) return fail('notEnoughCountries', 'setup.error.notEnoughCountries', { available: aiPlaced, wanted: config.aiNations });
      break;
    }
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
        if (humanSub !== null) {
          const name = subNationName(humanSub, c);
          seats.push({ seat, kind: 'human', identity: { kind: 'country', nameEn: name, nameSv: name }, flag: makeFlagSpec(mix(config.seed, FLAG_SALT + 3000 + humanSub.id)), capitalCell, countryId: c.id, subNation: humanSub.id });
          continue;
        }
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
      if (p.sub !== null) {
        const name = subNationName(p.sub, c);
        seats.push({ seat, kind: 'ai', identity: { kind: 'country', nameEn: name, nameSv: name }, flag: makeFlagSpec(mix(config.seed, FLAG_SALT + 3000 + p.sub.id)), capitalCell, countryId: c.id, subNation: p.sub.id });
        continue;
      }
      seats.push({ seat, kind: 'ai', identity: { kind: 'country', nameEn: c.nameEn, nameSv: c.nameSv }, flag: makeFlagSpec(mix(config.seed, FLAG_SALT + c.id)), capitalCell, countryId: c.id });
    }
  }

  // The federations are allied from tick 0, and that alliance cannot be broken (REJECT_DIPLO_FEDERATION).
  const federationGroups = groups.filter((g) => g.length >= 2);
  for (const g of federationGroups) for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) bindFederation(state, g[i] as number, g[j] as number);

  // M18b-3: ONE flag per federation (a pure function of the seed and the country), named like the country; the sub-nations keep their own names and flags.
  const federationLabels: FederationLabel[] = federationGroups.map((g) => {
    const c = placed.find((p) => p.seat === g[0])?.country ?? null;
    return { seats: g, nameEn: c?.nameEn ?? '', nameSv: c?.nameSv ?? '', flag: makeFlagSpec(mix(config.seed, FLAG_SALT + 5000 + (c?.id ?? 0))) };
  });

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
      federationLabels,
    ),
    federationGroups,
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
  const r = build(world, { ...config, aiNations: SETUP_AI_NATIONS_MAX, humanSeat: 0, tribes: false, federations: false }, true);
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
