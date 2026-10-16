// The helicopter raid replay and the scripted raid statistics of M12b (headless; lives in tools, never in src/sim):
//
//   npm run sim:scenario -- heli-raid --fixture <alps|plains-sam|ridge-sam> --seed N [--mode low|high] [--trials 50]
//
// Without --trials it flies ONE raid and prints, once per second of game time and at every event: tick, state, position, altitude, the defender's exposure of
// the cell (D = a SAM covers it, P = inside a Defense Post, - = hidden) and the events. With --trials T it flies T seeded raids and prints the statistics.
// The output is a pure function of (fixture, seed, mode, trials): the same arguments print the same bytes.
//
// Fixtures (the attacker is seat 0 with a Factory and one helicopter, the defender is seat 1):
//  - alps:       the REAL world over the Alps, no air defence (the "undefended target": each trial draws its own Factory and landing zone from the seed);
//  - plains-sam: flat synthetic plains, two level-1 SAM sites that both cover the landing zone and the last 12 cells of the way in (nothing hides the approach);
//  - ridge-sam:  flat synthetic land with a 2000 m ridge between the landing zone and a SAM site that covers it: Low is hidden behind the ridge, High is not.
// A raid is a success when the load comes down on land: a landing that took at least one cell, or a beachhead formed.
import { pathToFileURL } from 'node:url';
import { exposureOf, planRouteOf, scoreLzOf } from '../../src/sim/access';
import { HELI_PAD } from '../../src/sim/heliTable';
import { launchHeliBody, withId } from '../../src/sim/intents';
import { OUTBOX_BEACHHEAD_FORMED, OUTBOX_HELI_DOWNED, OUTBOX_HELI_LANDED, OUTBOX_HELI_LAUNCHED, OUTBOX_REJECT, type OutboxEvent } from '../../src/sim/outbox';
import { BUILD_TICKS, HELI_BUILD_TICKS, TICK_HZ } from '../../src/sim/rules';
import { hashState } from '../../src/sim/serialize';
import { hex32 } from '../../src/sim/hash';
import { rebuildAggregates, createState, type GameState } from '../../src/sim/state';
import { step } from '../../src/sim/step';
import { STRUCT_FACTORY, STRUCT_SAM } from '../../src/sim/structureRules';
import { CLASS_HILLS, CLASS_MOUNTAIN, CLASS_PLAINS } from '../../src/sim/terrain';
import { createWorldState } from '../../src/sim/world';
import { loadRealWorld } from './realWorld';

export type FixtureName = 'alps' | 'plains-sam' | 'ridge-sam';
export const FIXTURES: readonly FixtureName[] = ['alps', 'plains-sam', 'ridge-sam'];

/** Everything one raid needs: the state at the moment the helicopter stands on its pad, and where it should go. */
export interface Fixture {
  readonly name: FixtureName;
  readonly state: GameState;
  /** Factory structure id and helicopter id of the attacker. */
  readonly factory: number;
  readonly heli: number;
  readonly lz: number;
  /** Structure ids of the defender's SAM sites. */
  readonly sams: readonly number[];
}

export interface RaidResult {
  readonly fixture: FixtureName;
  readonly seed: number;
  readonly trial: number;
  readonly mode: 0 | 1;
  readonly success: boolean;
  /** 'landed' | 'downed' | 'home' (back on the pad without landing) | 'timeout' | 'refused'. */
  readonly outcome: string;
  /** Cells the landing took (0 when it did not land). */
  readonly cells: number;
  /** Cause of the HELI_DOWNED event (1 fuel, 2 SAM, 3 Post), 0 when it did not go down. */
  readonly cause: number;
  readonly ticks: number;
  readonly etaTicks: number;
  readonly log: string[];
}

const W = 256;
const H = 96;
const SYNTH_FACTORY_X = 40;
const SYNTH_Y = 48;
const DEFENDER_SEAT = 1;

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function idle(s: GameState, ticks: number): void {
  for (let i = 0; i < ticks; i++) step(s, { turn: s.tick, intents: [] });
}

/** The synthetic land: plains at 5 m; the attacker owns x < 50, the defender x >= `defenderFrom`; a 2000 m ridge across x 100..106 when `ridge`. */
function synth(seed: number, ridge: boolean, defenderFrom: number): GameState {
  const terrain = new Uint8Array(W * H).fill(CLASS_PLAINS);
  const elevation = new Uint16Array(W * H).fill(5);
  const maxElev = new Int16Array(W * H).fill(5);
  if (ridge) {
    for (let y = 0; y < H; y++) {
      for (let x = 100; x <= 106; x++) {
        terrain[y * W + x] = CLASS_MOUNTAIN;
        elevation[y * W + x] = 2000;
        maxElev[y * W + x] = 2200;
      }
    }
  }
  const s = createState({ width: W, height: H, seed, seats: 2, config: { debugIntents: true }, terrain, elevation, maxElev });
  for (let c = 0; c < W * H; c++) {
    const x = c % W;
    s.owner[c] = x < 50 ? 1 : x >= defenderFrom ? 2 : 0;
  }
  rebuildAggregates(s);
  s.gold[1] = 1e9;
  s.troops[1] = 4_000_000;
  s.troops[2] = 4_000_000;
  return s;
}

/** Builds the synthetic fixture `name` (plains-sam or ridge-sam) for a match seed. */
export function syntheticFixture(name: 'plains-sam' | 'ridge-sam', seed: number): Fixture {
  const ridge = name === 'ridge-sam';
  const s = synth(seed, ridge, ridge ? 110 : 153);
  const at = (x: number, y: number): number => y * W + x;
  const factory = s.structures.add(STRUCT_FACTORY, 1, at(SYNTH_FACTORY_X, SYNTH_Y), s.tick);
  const sams: number[] = [];
  if (ridge) sams.push(s.structures.add(STRUCT_SAM, 2, at(115, SYNTH_Y), s.tick));
  else sams.push(s.structures.add(STRUCT_SAM, 2, at(158, 40), s.tick), s.structures.add(STRUCT_SAM, 2, at(158, 56), s.tick));
  idle(s, BUILD_TICKS[STRUCT_SAM] as number + 1);
  const heli = s.helis.addBuilding(1, factory, s.tick, s.tick + HELI_BUILD_TICKS);
  idle(s, HELI_BUILD_TICKS + 1);
  return { name, state: s, factory, heli, lz: ridge ? at(92, SYNTH_Y) : at(150, SYNTH_Y), sams };
}

/** Where the seeded trials of the alps fixture start and land: `n` pairs (start cell, landing zone) that the planner and the zone rules accept. */
/** Is cell `c` within the 3x3 ground round the Factory cell `f`? */
function near(f: number, c: number): boolean {
  return Math.abs((f % 1024) - (c % 1024)) <= 2 && Math.abs(Math.floor(f / 1024) - Math.floor(c / 1024)) <= 2;
}

function alpsPairs(s: GameState, rnd: () => number, n: number, mode: 0 | 1): Array<{ start: number; lz: number }> {
  const out: Array<{ start: number; lz: number }> = [];
  const cellOf = (lat: number, lon: number): number => Math.min(511, Math.floor(((90 - lat) / 180) * 512)) * 1024 + Math.min(1023, Math.floor(((lon + 180) / 360) * 1024));
  for (let attempt = 0; attempt < 20000 && out.length < n; attempt++) {
    const start = cellOf(43.5 + rnd() * 4, 5.5 + rnd() * 10);
    const cls = s.terrain[start] as number;
    if (cls !== CLASS_PLAINS && cls !== CLASS_HILLS) continue;
    const ang = rnd() * 2 * Math.PI;
    const dist = 30 + rnd() * 40;
    const lx = Math.round((start % 1024) + Math.cos(ang) * dist);
    const ly = Math.round(Math.floor(start / 1024) + Math.sin(ang) * dist);
    if (lx < 0 || lx >= 1024 || ly < 1 || ly >= 511) continue;
    const lz = ly * 1024 + lx;
    if (out.some((p) => p.lz === lz || p.start === start || near(p.start, lz) || near(start, p.lz))) continue;
    if (near(start, lz)) continue;
    const sc = scoreLzOf(s, 0, lz, start, mode);
    if (sc.reason !== 0 || sc.fuelCells > 85) continue;
    const route = planRouteOf(s, 0, start, lz, mode);
    if (!route.ok || route.waypoints.length < 2) continue;
    out.push({ start, lz });
  }
  return out;
}

/** The real-world state of the alps fixture with `n` Factories and helicopters on their pads (one per trial). Slow to build (the world); build it once per process. */
export async function alpsWorld(seed: number, n: number, mode: 0 | 1): Promise<{ state: GameState; trials: Array<{ factory: number; heli: number; lz: number }>; base: number[] }> {
  const world = await loadRealWorld();
  const s = createWorldState(world, { seed, seats: 2, config: { debugIntents: true } });
  const pairs = alpsPairs(s, lcg(seed ^ 0x5bd1e995), n, mode);
  const trials: Array<{ factory: number; heli: number; lz: number }> = [];
  const base: number[] = [];
  for (const p of pairs) {
    // The attacker owns the 3x3 cells around its Factory (a Factory on land nobody owns would be scrapped by the first ownership pass).
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      s.owner[p.start + dy * s.width + dx] = 1;
      base.push(p.start + dy * s.width + dx);
    }
    trials.push({ factory: s.structures.add(STRUCT_FACTORY, 1, p.start, s.tick), heli: -1, lz: p.lz });
  }
  rebuildAggregates(s);
  idle(s, (BUILD_TICKS[STRUCT_FACTORY] as number) + 1);
  for (const t of trials) t.heli = s.helis.addBuilding(1, t.factory, s.tick, s.tick + HELI_BUILD_TICKS);
  idle(s, HELI_BUILD_TICKS + 1);
  s.troops[1] = 4_000_000;
  return { state: s, trials, base };
}

const STATE_NAMES = ['free', 'building', 'pad', 'lift', 'cruise', 'approach', 'hover', 'unload', 'return', 'downed'];
const CAUSE_NAMES = ['-', 'fuel', 'SAM', 'Post'];

/** Flies one raid of the helicopter `heli` of `factory` to `lz` and describes it. The state is advanced (a raid is a history, not a query). */
export function flyRaid(fx: { name: FixtureName; state: GameState; factory: number; heli: number; lz: number }, seed: number, trial: number, mode: 0 | 1, wantLog: boolean): RaidResult {
  const s = fx.state;
  const t = s.helis;
  const log: string[] = [];
  const route = planRouteOf(s, 0, s.structures.cell[fx.factory] as number, fx.lz, mode);
  const eta = route.ok ? route.etaTicks : 0;
  const launchTick = s.tick;
  s.outbox.clear();
  step(s, { turn: s.tick, intents: [withId(launchHeliBody(0, fx.factory, fx.lz, 100, mode), 1_000_000 + trial)] });
  let events = s.outbox.drain();
  // The launch takes the lowest-id helicopter on the pad of the Factory; a helicopter of an earlier trial may have come home to this pad first, so the flier is read from the event.
  const launched = events.find((e) => e.kind === OUTBOX_HELI_LAUNCHED);
  const hid = launched === undefined ? fx.heli : launched.a;
  let cells = 0;
  let cause = 0;
  let formed = false;
  let outcome = 'timeout';
  if (launched === undefined || events.some((e) => e.kind === OUTBOX_REJECT)) outcome = 'refused';
  if (outcome === 'refused') log.push(`launch refused: ${events.map((e) => `${e.kind}:${e.a}:${e.b}`).join(' ')}`);
  const deadline = launchTick + 2 * eta + 400;
  const describe = (e: OutboxEvent): string => {
    if (e.kind === OUTBOX_HELI_LAUNCHED) return 'launched';
    if (e.kind === OUTBOX_HELI_LANDED) return `landed cells=${e.b}`;
    if (e.kind === OUTBOX_BEACHHEAD_FORMED) return `beachhead formed at ${e.b}`;
    if (e.kind === OUTBOX_HELI_DOWNED) return `DOWNED cause=${CAUSE_NAMES[e.b] ?? e.b}`;
    return `event ${e.kind}`;
  };
  const line = (evs: OutboxEvent[]): void => {
    if (!wantLog) return;
    const st = t.state[hid] as number;
    const x = (t.x[hid] as number) / 256;
    const y = (t.y[hid] as number) / 256;
    const cell = Math.floor(y) * s.width + Math.floor(x);
    const ex = st >= 3 && st <= 8 ? exposureOf(s, DEFENDER_SEAT, cell, mode) : 0;
    const marks = `${(ex & 1) !== 0 ? 'D' : '-'}${(ex & 2) !== 0 ? 'P' : '-'}`;
    const names = evs.map(describe);
    if (evs.length > 0 || (s.tick - launchTick) % TICK_HZ === 0) log.push(`tick ${s.tick - launchTick} ${STATE_NAMES[st] ?? st} pos=(${x.toFixed(1)},${y.toFixed(1)}) alt=${t.alt[hid]}m hp=${(t.hp[hid] as number) / 10} exp=${marks}${names.length > 0 ? ' | ' + names.join('; ') : ''}`);
  };
  line(events);
  for (;;) {
    for (const e of events) {
      if (e.kind === OUTBOX_HELI_LANDED && e.a === hid) cells = Math.max(cells, e.b);
      if (e.kind === OUTBOX_BEACHHEAD_FORMED && e.b === fx.lz) formed = true;
      if (e.kind === OUTBOX_HELI_DOWNED && e.a === hid) cause = e.b;
    }
    if (outcome === 'refused' || cause !== 0 || t.owner[hid] === 0 || s.tick >= deadline) break;
    if (!wantLog && (cells > 0 || formed)) break; // the statistics stop at the landing; the replay flies on to the pad
    if (t.state[hid] === HELI_PAD && s.tick > launchTick + 1) break;
    s.outbox.clear();
    step(s, { turn: s.tick, intents: [] });
    events = s.outbox.drain();
    line(events);
  }
  if (outcome !== 'refused') outcome = cause !== 0 ? 'downed' : cells > 0 || formed ? 'landed' : t.state[hid] === HELI_PAD ? 'home' : 'timeout';
  const success = cells >= 1 || formed;
  return { fixture: fx.name, seed, trial, mode, success, outcome, cells, cause, ticks: s.tick - launchTick, etaTicks: eta, log };
}

/** Puts the land of an alps landing back (the 5x5 cells around the zone neutral again except the attacker's own ground, the beachhead rows gone) so the next trial lands on fresh ground. */
export function undoLanding(s: GameState, lz: number, base: readonly number[]): void {
  const x0 = lz % s.width;
  const y0 = Math.floor(lz / s.width);
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) s.owner[Math.min(s.height - 1, Math.max(0, y0 + dy)) * s.width + ((x0 + dx + s.width) % s.width)] = 0;
  for (const c of base) s.owner[c] = 1; // the attacker's own ground round its Factories stays
  rebuildAggregates(s);
  for (let i = 0; i < s.beachheads.capacity; i++) s.beachheads.remove(i);
  s.attacks.list.length = 0; // the rest of a load goes on as an Attack from the beachhead; it must not eat the next trial's zone
  s.attacks.reindex();
  s.troops[1] = 4_000_000;
}

export interface RaidStats {
  readonly fixture: FixtureName;
  readonly seed: number;
  readonly mode: 0 | 1;
  readonly trials: number;
  readonly successes: number;
  readonly pct: number;
  readonly downedSam: number;
  readonly downedPost: number;
  readonly downedFuel: number;
  readonly lines: string[];
}

/** Flies `trials` seeded raids of a fixture in the flight mode `mode` and counts. Same arguments, same numbers. */
export async function raidStats(fixture: FixtureName, seed: number, trials: number, mode: 0 | 1): Promise<RaidStats> {
  const lines: string[] = [];
  let successes = 0;
  let downedSam = 0;
  let downedPost = 0;
  let downedFuel = 0;
  const run = (r: RaidResult): void => {
    if (r.success) successes++;
    if (r.cause === 2) downedSam++;
    else if (r.cause === 3) downedPost++;
    else if (r.cause === 1) downedFuel++;
    lines.push(`trial ${String(r.trial).padStart(2)}: ${r.outcome}${r.cause !== 0 ? ` (${CAUSE_NAMES[r.cause]})` : ''} cells=${r.cells} ticks=${r.ticks}/${r.etaTicks}`);
  };
  if (fixture === 'alps') {
    const w = await alpsWorld(seed, trials, mode);
    for (let i = 0; i < w.trials.length; i++) {
      const tr = w.trials[i] as { factory: number; heli: number; lz: number };
      run(flyRaid({ name: fixture, state: w.state, factory: tr.factory, heli: tr.heli, lz: tr.lz }, seed, i, mode, false));
      undoLanding(w.state, tr.lz, w.base);
    }
    const planned = w.trials.length;
    if (planned < trials) lines.push(`only ${planned} of ${trials} trials found a valid landing zone`);
    return { fixture, seed, mode, trials: planned, successes, pct: planned === 0 ? 0 : Math.round((1000 * successes) / planned) / 10, downedSam, downedPost, downedFuel, lines };
  }
  for (let i = 0; i < trials; i++) {
    const fx = syntheticFixture(fixture, Math.imul(seed, 1000) + i);
    run(flyRaid(fx, seed, i, mode, false));
  }
  return { fixture, seed, mode, trials, successes, pct: Math.round((1000 * successes) / trials) / 10, downedSam, downedPost, downedFuel, lines };
}

export interface HeliRaidArgs {
  readonly fixture: FixtureName;
  readonly seed: number;
  readonly mode: 0 | 1;
  readonly trials: number;
}

export function parseHeliRaidArgs(argv: readonly string[]): HeliRaidArgs {
  let fixture: FixtureName | null = null;
  let seed = 1;
  let mode: 0 | 1 = 0;
  let trials = 0;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    const next = argv[i + 1];
    if (a === '--fixture') {
      if (next === undefined || !(FIXTURES as readonly string[]).includes(next)) throw new Error(`--fixture needs one of ${FIXTURES.join(', ')}, got ${String(next)}`);
      fixture = next as FixtureName;
      i++;
    } else if (a === '--seed') {
      const n = next === undefined ? NaN : Number(next);
      if (!Number.isInteger(n) || n < 0 || n > 1_000_000) throw new Error(`--seed needs an integer in 0..1000000, got ${String(next)}`);
      seed = n;
      i++;
    } else if (a === '--mode') {
      if (next !== 'low' && next !== 'high') throw new Error(`--mode needs low or high, got ${String(next)}`);
      mode = next === 'high' ? 1 : 0;
      i++;
    } else if (a === '--trials') {
      const n = next === undefined ? NaN : Number(next);
      if (!Number.isInteger(n) || n < 1 || n > 500) throw new Error(`--trials needs an integer in 1..500, got ${String(next)}`);
      trials = n;
      i++;
    } else throw new Error(`unknown argument ${a}`);
  }
  if (fixture === null) throw new Error(`--fixture is required (${FIXTURES.join(', ')})`);
  return { fixture, seed, mode, trials };
}

/** Runs the command and returns the text it prints. */
export async function heliRaid(args: HeliRaidArgs): Promise<string> {
  const head = `heli-raid fixture=${args.fixture} seed=${args.seed} mode=${args.mode === 0 ? 'low' : 'high'}`;
  if (args.trials > 0) {
    const st = await raidStats(args.fixture, args.seed, args.trials, args.mode);
    return [head + ` trials=${st.trials}`, ...st.lines, `success ${st.successes}/${st.trials} = ${st.pct}% | downed by SAM ${st.downedSam}, Post ${st.downedPost}, fuel ${st.downedFuel}`].join('\n');
  }
  if (args.fixture === 'alps') {
    const w = await alpsWorld(args.seed, 1, args.mode);
    const tr = w.trials[0];
    if (tr === undefined) throw new Error('no valid landing zone for this seed');
    const r = flyRaid({ name: 'alps', state: w.state, factory: tr.factory, heli: tr.heli, lz: tr.lz }, args.seed, 0, args.mode, true);
    return [head, ...r.log, `result: ${r.outcome} cells=${r.cells} cause=${CAUSE_NAMES[r.cause]} | state hash ${hex32(hashState(w.state))}`].join('\n');
  }
  const fx = syntheticFixture(args.fixture, args.seed);
  const r = flyRaid(fx, args.seed, 0, args.mode, true);
  return [head, ...r.log, `result: ${r.outcome} cells=${r.cells} cause=${CAUSE_NAMES[r.cause]} | state hash ${hex32(hashState(fx.state))}`].join('\n');
}

async function main(): Promise<void> {
  try {
    console.log(await heliRaid(parseHeliRaidArgs(process.argv.slice(2))));
  } catch (err) {
    console.error(String(err instanceof Error ? err.message : err));
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
