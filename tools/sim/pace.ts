// The pace report (tempo pass, D142): how fast the game FEELS, in game seconds at speed 1x, measured headless and deterministic.
//
//   npm run sim:pace                                   all three parts, 5 seeds
//   npm run sim:pace -- --part solo|conquest|match     one part (comma separated)
//   npm run sim:pace -- --seeds 1,2,3 --minutes 25 --setup play,skirmish,asia --prices 2400,7000 --json
//
// Part "solo": one free-land expander (the calibration scenario of tools/sim/scenario.ts) on several capitals: land cells per minute, the
//   gold income per second and the earliest minute at which it could pay each price of --prices (D143: later milestones price things in gold).
// Part "conquest": two seats on a real border at TROOP PARITY (the attacker's troops are set equal to the defender's before the attack).
//   "disc"    both seats own their 197-cell start disc, 17 cells apart (the closest a match ever places two capitals); the attacker
//             commits 100 % or 40 % at tick 0; the number is the seconds until the defender owns nothing.
//   "country" the defender first expands alone until it owns 500 cells, then the attacker (disc only) attacks; the number is the
//             seconds until the defender has lost 500 cells.
//   The attacker re-issues its Attack every 15 s (a human who clicks again adds the commitment to the running attack). Each is run
//   against a PASSIVE defender and against a COUNTER-ATTACKING one (60 % of its troops at the attacker, every 4 s, like the AI cooldown).
//   The median over the locations is printed; ">900" means the goal was not reached in 15 game minutes.
// Part "match": the default Play match (you + 5 AI nations + 20 tribes, the world) and a Skirmish (you + 12 AI + 20 tribes, Europe)
//   built through createMatch and played at 1x with the real AiDriver and a scripted sane human (tools/sim/humanBot.ts); per seed and as
//   the median of the seeds: the land share of the biggest nation, of the human, the nations and tribes alive and the free land share at
//   minutes 1, 3, 6, 10, 15, 20, 25; then a PASSIVE human (nobody plays seat 0) for GUARD_PASSIVE_MINUTE minutes. The guard rails of paceMath.ts are checked.
// The sim is stepped directly (conquest part) or through MainThreadHost (match part, like the page); no clock, no Math.random.
import { pathToFileURL } from 'node:url';
import { createMatch, matchSetupConfig } from '../../src/app/matchSetup';
import { AiDriver } from '../../src/host/aiDriver';
import { MainThreadHost, type TickDriver } from '../../src/host/mainThreadHost';
import { hash2 } from '../../src/sim/fixture';
import { IdAllocator, withId, type Intent, type IntentBody } from '../../src/sim/intents';
import { START_DISC_CELLS, SETUP_CAPITAL_MIN_DISTANCE_CELLS, TICK_HZ } from '../../src/sim/rules';
import { startSeats } from '../../src/sim/setup';
import { countDisc } from '../../src/sim/spawn';
import { seatToOwner, type GameState } from '../../src/sim/state';
import { step } from '../../src/sim/step';
import { ownerCapQt } from '../../src/sim/economy';
import { StateView } from '../../src/sim/view';
import { createWorldState, type SimWorld } from '../../src/sim/world';
import { CompositeDriver, DEFAULT_HUMAN_BOT, HumanBot } from './humanBot';
import {
  DEFAULT_PRICE_MARKS,
  GUARD_PASSIVE_MINUTE,
  evaluateMatchGuards,
  evaluatePassiveGuard,
  formatTable,
  median,
  medianOrNull,
  minuteReaching,
  parseArgs,
  secondsText,
  secondsToReach,
  sharePct,
  type Guard,
  type MatchSample,
  type MatchSetupName,
  type PaceArgs,
  type Sample,
} from './paceMath';
import { loadPreparedWorld, loadRealWorld } from './realWorld';
import { largestCountries, parseArgs as parseScenarioArgs, runScenario } from './scenario';

/** Game seconds after which a conquest run gives up. */
export const CONQUEST_CAP_SECONDS = 900;
/** The locations of the conquest part: countries whose capital has a whole disc of land around it (different terrain). */
export const CONQUEST_LOCATIONS: readonly string[] = ['POL', 'FRA', 'TUR', 'THA', 'UKR'];
/** The solo curves: the calibration country first, then others. */
export const SOLO_COUNTRIES: readonly string[] = ['RUS', 'CHN', 'USA', 'BRA', 'AUS', 'IND'];
export const SOLO_MINUTES: readonly number[] = [1, 2, 3, 5, 10];
/** Cells the "country" goal asks for. */
export const COUNTRY_CELLS = 500;
/** Sampled minutes printed by the match part. */
export const MATCH_PRINT_MINUTES: readonly number[] = [1, 3, 6, 10, 15, 20, 25];
/** The countries the human plays in the match part (by seed index). */
export const HUMAN_COUNTRIES: Record<MatchSetupName, readonly string[]> = {
  play: ['SWE', 'DEU', 'BRA', 'IND', 'USA', 'FRA', 'JPN'],
  skirmish: ['DEU', 'SWE', 'FRA', 'POL', 'ESP', 'ITA', 'GBR'],
  asia: ['CHN', 'JPN', 'KOR', 'VNM', 'THA', 'MNG', 'LAO'],
};

// ---------------------------------------------------------------------------------------------------------------------
// Part 1: solo

export interface SoloRow {
  readonly country: string;
  /** Land cells at SOLO_MINUTES. */
  readonly cells: readonly number[];
  /** Gold per second at the end of minutes 1 to 10 (whole gold), and the gold stock then if nothing is ever bought (D143: land arrives sooner, so every gold-priced timing of later milestones moves with it). */
  readonly goldPerSec: readonly number[];
  readonly goldStock: readonly number[];
}

export async function runSolo(countries: readonly string[] = SOLO_COUNTRIES): Promise<SoloRow[]> {
  const rows: SoloRow[] = [];
  const last = SOLO_MINUTES[SOLO_MINUTES.length - 1] as number;
  for (const country of countries) {
    const perSec: number[] = [];
    const stock: number[] = [];
    let view: StateView | null = null;
    const { report } = await runScenario(parseScenarioArgs(['--solo', '--minutes', String(last), '--country', country, '--seed', '1']), (state) => {
      if (state.tick === 0 || state.tick % (60 * TICK_HZ) !== 0) return;
      view ??= new StateView(state);
      view.refresh();
      perSec.push(Math.round((view.stats.goldPerSecMilli[0] as number) / 1000));
      stock.push(Math.round((view.stats.goldMilli[0] as number) / 1000));
    });
    rows.push({ country, cells: SOLO_MINUTES.map((m) => (report.rows[m - 1]?.cells[0] as number)), goldPerSec: perSec, goldStock: stock });
  }
  return rows;
}

export function formatSolo(rows: readonly SoloRow[], prices: readonly number[] = DEFAULT_PRICE_MARKS): string {
  const header = ['solo (land cells)', ...SOLO_MINUTES.map((m) => `min ${m}`)];
  const body = rows.map((r) => [r.country, ...r.cells.map(String)]);
  const med = SOLO_MINUTES.map((_, i) => String(median(rows.map((r) => r.cells[i] as number))));
  const land = formatTable(header, [...body, ['median', ...med]]);
  const income = formatTable(
    ['solo income (gold/s)', ...SOLO_MINUTES.map((m) => `min ${m}`)],
    rows.map((r) => [r.country, ...SOLO_MINUTES.map((m) => String(r.goldPerSec[m - 1] ?? '-'))]),
  );
  const marks = formatTable(
    ['earliest minute with the gold if nothing is bought', ...prices.map((p) => `${p} gold`)],
    rows.map((r) => [r.country, ...prices.map((p) => String(minuteReaching(r.goldStock, p) ?? '>10'))]),
  );
  return `${land}\n\n${income}\n\n${marks}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Part 2: contested conquest at troop parity

export type ConquestMode = 'disc' | 'country';
export type DefenderKind = 'passive' | 'counter';

export interface ConquestSpec {
  readonly location: string;
  readonly mode: ConquestMode;
  readonly commitPct: number;
  readonly defender: DefenderKind;
  readonly seed: number;
  /** Ticks between the attacker's clicks (default REISSUE_TICKS); 0 = one single click and no more. */
  readonly reissueTicks?: number;
}

export interface ConquestResult {
  readonly spec: ConquestSpec;
  /** Game seconds from the start of the attack to the goal, null = not reached within CONQUEST_CAP_SECONDS. */
  readonly seconds: number | null;
  /** Cells the defender had when the attack began and the contact length of the two seats then. */
  readonly defenderCells: number;
  readonly contact: number;
  /** Troops (whole) of the attacker and the defender when the attack began (parity: equal unless the attacker's cap is lower). */
  readonly attackerTroops: number;
  readonly defenderTroops: number;
  /** Cells the defender has to lose for the run to count: its whole disc ('disc') or COUNTRY_CELLS ('country'). */
  readonly goal: number;
}

/** The attacker clicks again every 15 s (an Attack on a target that is already attacked adds the commitment to the running attack). */
const REISSUE_TICKS = 150;
/** The counter-attacking defender attacks every 4 s (AI_ATTACK_COOLDOWN_TICKS). */
const COUNTER_TICKS = 40;
const ATTACKER_SEAT = 0;
const DEFENDER_SEAT = 1;
const ATTACKER = seatToOwner(ATTACKER_SEAT);
const DEFENDER = seatToOwner(DEFENDER_SEAT);

function stepWith(state: GameState, alloc: IdAllocator, bodies: IntentBody[]): void {
  const intents: Intent[] = bodies.map((b) => withId(b, alloc.alloc(b.seat)));
  const r = step(state, { turn: state.tick, intents });
  if (!r.ok) throw new Error(`step failed: ${r.error}`);
  state.outbox.clear();
}

/** Two seats on the real world: the attacker on `capital`, the defender on the nearest cell (at least the capital distance away) that gives a whole disc and touches. */
function twoSeats(world: SimWorld, seed: number, capital: number): GameState {
  const w = world.width;
  const cx = capital % w;
  const cy = (capital - cx) / w;
  const min2 = SETUP_CAPITAL_MIN_DISTANCE_CELLS * SETUP_CAPITAL_MIN_DISTANCE_CELLS;
  const cands: Array<{ cell: number; d2: number; k: number }> = [];
  for (let dy = -30; dy <= 30; dy++) {
    const y = cy + dy;
    if (y < 0 || y >= world.height) continue;
    for (let dx = -30; dx <= 30; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 < min2) continue;
      const x = (((cx + dx) % w) + w) % w;
      const cell = y * w + x;
      cands.push({ cell, d2, k: hash2(seed, cell, 0x9ace) });
    }
  }
  cands.sort((a, b) => a.d2 - b.d2 || a.k - b.k || a.cell - b.cell);
  for (const c of cands) {
    const state = createWorldState(world, { seed, seats: 2, players: 2 });
    if (startSeats(state, [{ seat: ATTACKER_SEAT, cell: capital }])[0] !== 0) throw new Error('the attacker cannot spawn');
    if (countDisc(state, c.cell) !== START_DISC_CELLS) continue;
    if (startSeats(state, [{ seat: DEFENDER_SEAT, cell: c.cell }])[0] !== 0) continue;
    if (state.borders.contact(ATTACKER, DEFENDER) > 0) return state;
  }
  throw new Error(`no place for a neighbour of the capital cell ${capital}`);
}

export async function runConquest(spec: ConquestSpec, trace?: (line: string) => void): Promise<ConquestResult> {
  const world = await loadRealWorld();
  const pick = largestCountries(world).find((c) => c.a3 === spec.location);
  if (pick === undefined) throw new Error(`no playable capital for ${spec.location}`);
  const state = twoSeats(world, spec.seed, pick.capitalCell);
  const alloc = new IdAllocator();
  const cap = CONQUEST_CAP_SECONDS * TICK_HZ;

  if (spec.mode === 'country') {
    // The defender grows alone until it holds COUNTRY_CELLS (the attacker waits on its disc).
    for (let t = 0; t < cap && (state.agg.area[DEFENDER] as number) < COUNTRY_CELLS; t++) {
      const bodies: IntentBody[] = [];
      if (t % 10 === 3 && state.borders.contact(DEFENDER, 0) > 0 && state.attacks.find(DEFENDER, 0) === null) bodies.push({ kind: 'Attack', seat: DEFENDER_SEAT, target: 0, pct: 100 });
      stepWith(state, alloc, bodies);
    }
    if ((state.agg.area[DEFENDER] as number) < COUNTRY_CELLS) throw new Error('the defender could not reach the country size');
    if (state.attacks.find(DEFENDER, 0) !== null) stepWith(state, alloc, [{ kind: 'CancelAttack', seat: DEFENDER_SEAT, target: 0 }]);
    if (state.borders.contact(ATTACKER, DEFENDER) === 0) throw new Error('the two seats lost contact');
  }
  // Troop parity: the attacker has what the defender has (up to its own cap).
  const attackerCap = ownerCapQt(state, ATTACKER);
  const parity = Math.min(state.troops[DEFENDER] as number, attackerCap);
  state.troops[ATTACKER] = parity;
  const defenderCells = state.agg.area[DEFENDER] as number;
  const goal = spec.mode === 'disc' ? defenderCells : COUNTRY_CELLS;
  const contactAtStart = state.borders.contact(ATTACKER, DEFENDER);
  const attackerTroops = Math.floor(parity / 4);
  const defenderTroops = Math.floor((state.troops[DEFENDER] as number) / 4);
  const reissue = spec.reissueTicks ?? REISSUE_TICKS;
  const series: Sample[] = [{ t: 0, v: 0 }];
  const start = state.tick;
  for (let n = 0; n < cap; n++) {
    const bodies: IntentBody[] = [];
    if (n === 0 || (reissue > 0 && n % reissue === 0)) bodies.push({ kind: 'Attack', seat: ATTACKER_SEAT, target: DEFENDER, pct: spec.commitPct });
    if (spec.defender === 'counter' && n % COUNTER_TICKS === 5 && state.borders.contact(ATTACKER, DEFENDER) > 0) {
      bodies.push({ kind: 'Attack', seat: DEFENDER_SEAT, target: ATTACKER, pct: 60 });
    }
    stepWith(state, alloc, bodies);
    const lost = defenderCells - (state.agg.area[DEFENDER] as number);
    if (trace !== undefined && n % 200 === 0) {
      const a = state.attacks.find(ATTACKER, DEFENDER);
      trace(`t=${n / TICK_HZ}s lost=${lost} A=${state.agg.area[ATTACKER]} troops A=${Math.floor((state.troops[ATTACKER] as number) / 4)} B=${Math.floor((state.troops[DEFENDER] as number) / 4)} committed=${a === null ? 0 : Math.floor(a.troops / 4)} contact=${state.borders.contact(ATTACKER, DEFENDER)}`);
    }
    if ((n + 1) % 5 === 0 || lost >= goal) series.push({ t: (state.tick - start) / TICK_HZ, v: lost });
    if (lost >= goal) break;
  }
  return { spec, seconds: secondsToReach(series, goal), defenderCells, contact: contactAtStart, attackerTroops, defenderTroops, goal };
}

export interface ConquestRow {
  readonly mode: ConquestMode;
  readonly commitPct: number;
  readonly defender: DefenderKind;
  /** 'repeat' = the attacker clicks again every 15 s, 'single' = one click only. */
  readonly clicks: 'repeat' | 'single';
  /** Seconds per location (null = not reached). */
  readonly seconds: ReadonlyArray<number | null>;
  readonly median: number | null;
  /** The contact length (sim cells) of the two seats when the attack began, per location. */
  readonly contacts: readonly number[];
}

export async function runConquestTable(seed: number): Promise<ConquestRow[]> {
  const rows: ConquestRow[] = [];
  const variants: Array<[number, DefenderKind, 'repeat' | 'single']> = [
    [100, 'passive', 'repeat'],
    [100, 'counter', 'repeat'],
    [40, 'passive', 'repeat'],
    [40, 'counter', 'repeat'],
    [40, 'passive', 'single'],
  ];
  for (const mode of ['disc', 'country'] as const) {
    for (const [commitPct, defender, clicks] of variants) {
      const seconds: Array<number | null> = [];
      const contacts: number[] = [];
      for (const location of CONQUEST_LOCATIONS) {
        const r = await runConquest({ location, mode, commitPct, defender, seed, reissueTicks: clicks === 'single' ? 0 : REISSUE_TICKS });
        seconds.push(r.seconds);
        contacts.push(r.contact);
      }
      rows.push({ mode, commitPct, defender, clicks, seconds, median: medianOrNull(seconds), contacts });
    }
  }
  return rows;
}

export function formatConquest(rows: readonly ConquestRow[]): string {
  const header = ['conquest at parity (s)', 'commit', 'clicks', 'defender', ...CONQUEST_LOCATIONS, 'median'];
  const body = rows.map((r) => [r.mode === 'disc' ? 'whole 197-cell disc' : '500 cells of a country', `${r.commitPct} %`, r.clicks, r.defender, ...r.seconds.map((s) => secondsText(s, CONQUEST_CAP_SECONDS)), secondsText(r.median, CONQUEST_CAP_SECONDS)]);
  const contact = (mode: ConquestMode): string => `start contact (sim cells) of the ${mode} runs per location: ${(rows.find((r) => r.mode === mode)?.contacts ?? []).join(' ')}`;
  return `${formatTable(header, body)}\n${contact('disc')}\n${contact('country')}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Part 3: whole matches

export interface MatchRun {
  readonly setup: MatchSetupName;
  readonly seed: number;
  readonly human: string;
  readonly passive: boolean;
  readonly samples: MatchSample[];
}

function countryId(world: Awaited<ReturnType<typeof loadPreparedWorld>>, a3: string): number {
  const c = world.countries.find((x) => x.a3 === a3);
  if (c === undefined) throw new Error(`unknown country ${a3}`);
  return c.id;
}

/** The match options of each setup. */
export const MATCH_OPTIONS: Record<MatchSetupName, (seed: number) => { seed: number; aiNations: number; region?: 'europe' | 'eastAsia' }> = {
  play: (seed) => ({ seed, aiNations: 5 }),
  skirmish: (seed) => ({ seed, aiNations: 12, region: 'europe' }),
  asia: (seed) => ({ seed, aiNations: 5, region: 'eastAsia' }),
};

/** Plays one match at 1x for `minutes` and samples it at every whole minute. `passive`: nobody plays the human seat. */
export async function runMatch(setup: MatchSetupName, seed: number, minutes: number, passive: boolean): Promise<MatchRun> {
  const world = await loadPreparedWorld();
  const list = HUMAN_COUNTRIES[setup];
  const human = list[Math.abs(seed) % list.length] as string;
  const options = MATCH_OPTIONS[setup](seed);
  // win: null = the pace report measures the economy and the board, so no win condition may end the match (M18-1).
  const built = createMatch(world, matchSetupConfig({ kind: 'real', countryId: countryId(world, human) }, { ...options, win: null }));
  if (!built.ok) throw new Error(`${setup} seed ${seed} (${human}): ${built.error.code}`);
  const match = built.match;
  const state = match.state;
  const ai = new AiDriver(seed, { humanSeats: [match.humanSeat] });
  const driver: TickDriver = passive ? ai : new CompositeDriver([ai, new HumanBot({ seat: match.humanSeat, ...DEFAULT_HUMAN_BOT })]);
  const host = new MainThreadHost(state, { speed: 1, driver });
  const total = state.grid.totalWeight;
  const nations = match.players - 1;
  const samples: MatchSample[] = [];
  const run = minutes;
  for (let minute = 1; minute <= run; minute++) {
    host.runTicks(60 * TICK_HZ);
    let top = 0;
    let topAi = 0;
    let owned = 0;
    let nationsAlive = 0;
    let tribesAlive = 0;
    for (let seat = 0; seat < state.header.seats; seat++) {
      const weighted = state.agg.warea[seatToOwner(seat)] as number;
      owned += weighted;
      if (weighted > top) top = weighted;
      if (seat !== match.humanSeat && weighted > topAi) topAi = weighted;
      if ((state.agg.area[seatToOwner(seat)] as number) > 0 && seat !== match.humanSeat) {
        if (seat < match.players) nationsAlive++;
        else tribesAlive++;
      }
    }
    const humanWeighted = state.agg.warea[seatToOwner(match.humanSeat)] as number;
    samples.push({
      minute,
      topShare: sharePct(top, total),
      topAiShare: sharePct(topAi, total),
      humanShare: sharePct(humanWeighted, total),
      nationsAlive,
      nations,
      tribesAlive,
      tribes: match.tribesPlaced,
      humanAlive: (state.agg.area[seatToOwner(match.humanSeat)] as number) > 0,
      freeShare: sharePct(total - owned, total),
    });
  }
  host.dispose();
  return { setup, seed, human, passive, samples };
}

/** True when the passive human of a run still owns land at GUARD_PASSIVE_MINUTE (false when that minute was not sampled). */
export function passiveAlive(run: MatchRun): boolean {
  return run.samples.find((s) => s.minute === GUARD_PASSIVE_MINUTE)?.humanAlive ?? false;
}

export function formatMatch(setup: MatchSetupName, runs: readonly MatchRun[]): string {
  const lines: string[] = [];
  const header = [`${setup}: seed (human)`, ...MATCH_PRINT_MINUTES.map((m) => `min ${m}`)];
  const cell = (r: MatchRun, minute: number): string => {
    const s = r.samples.find((x) => x.minute === minute);
    return s === undefined ? '-' : `${s.topAiShare}/${s.humanShare}/${s.nationsAlive}+${s.tribesAlive}/${s.freeShare}`;
  };
  const rows = runs.map((r) => [`${r.seed} (${r.human})`, ...MATCH_PRINT_MINUTES.map((m) => cell(r, m))]);
  const med = (pick: (s: MatchSample) => number): string[] =>
    MATCH_PRINT_MINUTES.map((m) => String(median(runs.map((r) => r.samples.find((x) => x.minute === m)).filter((s): s is MatchSample => s !== undefined).map(pick))));
  lines.push('land share (cos-weighted): top AI share % / human share % / AI nations alive + tribes alive / free land %');
  lines.push(formatTable(header, rows));
  lines.push(formatTable(['median over seeds', ...MATCH_PRINT_MINUTES.map((m) => `min ${m}`)], [['top share % (any seat)', ...med((s) => s.topShare)], ['top AI share %', ...med((s) => s.topAiShare)], ['human share %', ...med((s) => s.humanShare)], ['nations alive', ...med((s) => s.nationsAlive)], ['tribes alive', ...med((s) => s.tribesAlive)], ['free land %', ...med((s) => s.freeShare)]]));
  return lines.join('\n');
}

export function formatGuards(title: string, guards: readonly Guard[]): string {
  return [title, ...guards.map((g) => `  ${g.pass ? 'PASS' : 'FAIL'}  ${g.name} (${g.detail})`)].join('\n');
}

// ---------------------------------------------------------------------------------------------------------------------

export interface PaceReport {
  readonly solo?: SoloRow[];
  readonly conquest?: Array<{ seed: number; rows: ConquestRow[] }>;
  readonly matches?: Array<{ setup: MatchSetupName; runs: MatchRun[]; passive: MatchRun[]; guards: Guard[] }>;
}

export async function runPace(args: PaceArgs, log: (line: string) => void = console.log): Promise<PaceReport> {
  const report: { solo?: SoloRow[]; conquest?: Array<{ seed: number; rows: ConquestRow[] }>; matches?: Array<{ setup: MatchSetupName; runs: MatchRun[]; passive: MatchRun[]; guards: Guard[] }> } = {};
  if (args.parts.includes('solo')) {
    const rows = await runSolo();
    report.solo = rows;
    if (!args.json) log(`${formatSolo(rows, args.prices)}\n`);
  }
  if (args.parts.includes('conquest')) {
    report.conquest = [];
    for (const seed of args.seeds.slice(0, 1)) {
      const rows = await runConquestTable(seed);
      report.conquest.push({ seed, rows });
      if (!args.json) log(`seed ${seed}\n${formatConquest(rows)}\n`);
    }
  }
  if (args.parts.includes('match')) {
    report.matches = [];
    for (const setup of args.setups) {
      const runs: MatchRun[] = [];
      const passive: MatchRun[] = [];
      for (const seed of args.seeds) {
        runs.push(await runMatch(setup, seed, args.minutes, false));
        passive.push(await runMatch(setup, seed, GUARD_PASSIVE_MINUTE, true));
      }
      const guards = [...evaluateMatchGuards(runs.map((r) => r.samples)), evaluatePassiveGuard(passive.map(passiveAlive))];
      report.matches.push({ setup, runs, passive, guards });
      if (!args.json) log(`${formatMatch(setup, runs)}\n${formatGuards(`guard rails (${setup})`, guards)}\n`);
    }
  }
  if (args.json) log(JSON.stringify(report));
  return report;
}

async function main(): Promise<void> {
  try {
    await runPace(parseArgs(process.argv.slice(2)));
  } catch (err) {
    console.error(String(err instanceof Error ? err.stack ?? err.message : err));
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
