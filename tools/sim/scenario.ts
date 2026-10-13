// Headless scenario runner on the real 1024x512 world:
//
//   npm run sim:scenario -- --seed N --minutes 10 --players 12 --tribes 20      (the match: territory curves per minute)
//   npm run sim:scenario -- --solo [--minutes 10] [--country RUS]               (the calibration scenario: one expander)
//   flags: --json (machine readable), --fighters (players also attack neighbours), --ticks-log (per-tick work counters)
//
// Seats are placed on the capitals of the largest countries, the order shuffled by the seed (a hash, no Math.random).
// Bots are in tools/sim/bots.ts. The runner steps the state directly: an intent sent at tick T runs at tick T (no host).
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash2 } from '../../src/sim/fixture';
import { hex32 } from '../../src/sim/hash';
import { IdAllocator, withId, type Intent, type IntentBody } from '../../src/sim/intents';
import { TICK_HZ } from '../../src/sim/rules';
import { hashState } from '../../src/sim/serialize';
import { seatToOwner, type GameState } from '../../src/sim/state';
import { step } from '../../src/sim/step';
import { createWorldState, type SimWorld } from '../../src/sim/world';
import { botIntents, type BotKind } from './bots';
import { loadRealWorld } from './realWorld';

export interface ScenarioArgs {
  readonly seed: number;
  readonly minutes: number;
  readonly players: number;
  readonly tribes: number;
  readonly solo: boolean;
  readonly country: string | null;
  readonly fighters: boolean;
  readonly json: boolean;
}

export interface CountryPick {
  readonly a3: string;
  readonly name: string;
  readonly capitalCell: number;
}

export interface MinuteRow {
  readonly minute: number;
  /** Cells owned per seat (index = seat). */
  readonly cells: number[];
  readonly troops: number[];
  readonly attacks: number;
  readonly unownedLandShare: number;
}

export interface ScenarioReport {
  readonly args: ScenarioArgs;
  readonly seats: number;
  readonly countries: CountryPick[];
  readonly rows: MinuteRow[];
  readonly finalHash: string;
  readonly rejects: number;
  readonly work: { readonly ticks: number; readonly meanScanned: number; readonly maxScanned: number; readonly meanChanged: number; readonly maxChanged: number };
  readonly playableCells: number;
}

function intArg(name: string, raw: string | undefined, lo: number, hi: number): number {
  const n = raw === undefined ? NaN : Number(raw);
  if (!Number.isInteger(n) || n < lo || n > hi) throw new Error(`${name} needs an integer in ${lo}..${hi}, got ${String(raw)}`);
  return n;
}

export function parseArgs(argv: readonly string[]): ScenarioArgs {
  let seed = 1;
  let minutes = 10;
  let players = 12;
  let tribes = 20;
  let solo = false;
  let country: string | null = null;
  let fighters = false;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    const next = argv[i + 1];
    if (a === '--seed') {
      seed = intArg('--seed', next, -2147483648, 4294967295);
      i++;
    } else if (a === '--minutes') {
      minutes = intArg('--minutes', next, 1, 600);
      i++;
    } else if (a === '--players') {
      players = intArg('--players', next, 1, 255);
      i++;
    } else if (a === '--tribes') {
      tribes = intArg('--tribes', next, 0, 254);
      i++;
    } else if (a === '--country') {
      if (next === undefined) throw new Error('--country needs an ISO a3 code');
      country = next;
      i++;
    } else if (a === '--solo') solo = true;
    else if (a === '--fighters') fighters = true;
    else if (a === '--json') json = true;
    else throw new Error(`unknown argument ${a}`);
  }
  if (solo) {
    players = 1;
    tribes = 0;
  }
  if (players + tribes > 255) throw new Error('at most 255 seats');
  return { seed, minutes, players, tribes, solo, country, fighters, json };
}

interface MetaCountry {
  a3: string;
  name_en: string;
  capitalCell: number | null;
  weightedAreaKm2: number;
}

const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/data');

/** The countries whose capital cell is playable, largest first (weighted area, ties by a3). */
export function largestCountries(world: SimWorld): CountryPick[] {
  const meta = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'meta.json'), 'utf8')) as { countries: MetaCountry[] };
  const playable = (cell: number): boolean => {
    const c = world.terrain[cell] as number;
    return c >= 2 && c <= 5;
  };
  const list = meta.countries.filter((c) => c.capitalCell !== null && playable(c.capitalCell));
  list.sort((a, b) => b.weightedAreaKm2 - a.weightedAreaKm2 || (a.a3 < b.a3 ? -1 : a.a3 > b.a3 ? 1 : 0));
  return list.map((c) => ({ a3: c.a3, name: c.name_en, capitalCell: c.capitalCell as number }));
}

/** The seats' countries: the `n` largest, in an order the seed decides (a hash per country). */
export function pickCountries(all: CountryPick[], n: number, seed: number, only: string | null): CountryPick[] {
  if (only !== null) {
    const hit = all.find((c) => c.a3 === only);
    if (hit === undefined) throw new Error(`no playable capital for country ${only}`);
    return [hit];
  }
  if (n > all.length) throw new Error(`only ${all.length} countries have a playable capital`);
  const head = all.slice(0, n).map((c, i) => ({ c, k: hash2(seed, i, 0x77) * 256 + i }));
  head.sort((a, b) => a.k - b.k);
  return head.map((h) => h.c);
}

export function countCells(state: GameState): number[] {
  const out: number[] = [];
  for (let seat = 0; seat < state.header.seats; seat++) out.push(state.agg.area[seatToOwner(seat)] as number);
  return out;
}

/** Runs a scenario and reports the territory per minute. `onTick` (optional) sees the state after every step (the work counters live in state.work). */
export async function runScenario(args: ScenarioArgs, onTick?: (state: GameState) => void): Promise<{ report: ScenarioReport; state: GameState }> {
  const world = await loadRealWorld();
  const seats = args.players + args.tribes;
  const state = createWorldState(world, { seed: args.seed, seats, players: args.players });
  const countries = pickCountries(largestCountries(world), seats, args.seed, args.country);
  const alloc = new IdAllocator();
  const kinds: BotKind[] = [];
  for (let seat = 0; seat < seats; seat++) kinds.push(seat < args.players && args.fighters ? 'fighter' : 'expander');
  const rows: MinuteRow[] = [];
  const ticksPerMinute = TICK_HZ * 60;
  const total = args.minutes * ticksPerMinute;
  let scannedSum = 0;
  let scannedMax = 0;
  let changedSum = 0;
  let changedMax = 0;
  for (let t = 0; t < total; t++) {
    const bodies: IntentBody[] = [];
    if (t === 0) for (let seat = 0; seat < seats; seat++) bodies.push({ kind: 'Spawn', seat, cell: (countries[seat % countries.length] as CountryPick).capitalCell });
    else for (let seat = 0; seat < seats; seat++) bodies.push(...botIntents(state, seat, kinds[seat] as BotKind));
    const intents: Intent[] = bodies.map((b) => withId(b, alloc.alloc(b.seat)));
    const r = step(state, { turn: state.tick, intents });
    if (!r.ok) throw new Error(`step failed: ${r.error}`);
    state.outbox.clear();
    const w = state.work;
    scannedSum += w.scanned;
    changedSum += w.changed;
    if (w.scanned > scannedMax) scannedMax = w.scanned;
    if (w.changed > changedMax) changedMax = w.changed;
    onTick?.(state);
    if ((t + 1) % ticksPerMinute === 0) {
      const cells = countCells(state);
      const owned = cells.reduce((a, b) => a + b, 0);
      rows.push({
        minute: (t + 1) / ticksPerMinute,
        cells,
        troops: Array.from({ length: seats }, (_, seat) => Math.floor((state.troops[seatToOwner(seat)] as number) / 4)),
        attacks: state.attacks.list.length,
        unownedLandShare: Math.round((1000 * (state.grid.playableCells - owned)) / state.grid.playableCells) / 10,
      });
    }
  }
  const report: ScenarioReport = {
    args,
    seats,
    countries: countries.slice(0, seats),
    rows,
    finalHash: hex32(hashState(state)),
    rejects: state.rejects,
    work: { ticks: total, meanScanned: Math.round(scannedSum / total), maxScanned: scannedMax, meanChanged: Math.round((10 * changedSum) / total) / 10, maxChanged: changedMax },
    playableCells: state.grid.playableCells,
  };
  return { report, state };
}

export function format(report: ScenarioReport): string {
  const a = report.args;
  const lines: string[] = [];
  lines.push(`sim:scenario seed=${a.seed} minutes=${a.minutes} players=${a.players} tribes=${a.tribes}${a.solo ? ' (solo calibration)' : ''}${a.fighters ? ' fighters' : ''} playable cells=${report.playableCells}`);
  lines.push(`seats: ${report.countries.map((c, i) => `${i < a.players ? 'P' : 'T'}${i}=${c.a3}`).join(' ')}`);
  for (const r of report.rows) {
    const players = r.cells.slice(0, a.players);
    const tribes = r.cells.slice(a.players);
    const sum = (xs: number[]): number => xs.reduce((x, y) => x + y, 0);
    lines.push(
      `min ${String(r.minute).padStart(2)}: players ${players.join(',')} | tribes sum ${sum(tribes)} (max ${tribes.length > 0 ? Math.max(...tribes) : 0}) | players sum ${sum(players)} | attacks ${r.attacks} | free land ${r.unownedLandShare}%`,
    );
  }
  lines.push(`final hash ${report.finalHash} (rejects ${report.rejects}); scanned cells per tick: mean ${report.work.meanScanned}, max ${report.work.maxScanned}; changed per tick: mean ${report.work.meanChanged}, max ${report.work.maxChanged}`);
  return lines.join('\n');
}

async function main(): Promise<void> {
  try {
    const args = parseArgs(process.argv.slice(2));
    const { report } = await runScenario(args);
    console.log(args.json ? JSON.stringify(report) : format(report));
  } catch (err) {
    console.error(String(err instanceof Error ? err.message : err));
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
