// The golden scenario: a fixture world plus a scripted stream of intents, shared by the Node test, the CLI, the
// Chromium debug page (debug/sim.html) and the worker test, so all of them hash the same run.
//
// The script is a pure function of (seed, turn). It sends a few valid DebugPaints, some Noops, Spawns, Attacks and
// CancelAttacks (M04) and a share of deliberately invalid intents per turn (bad seat, bad cell, bad target, bad pct) so that
// the reject path is part of every golden hash. On one turn in
// eight it also sends two paints of the SAME cell from two seats, the higher seat first (so the canonical order
// (seat, id) decides who owns the cell), and on another one in eight two paints of one cell from one seat (the later id
// must stay in `stamp`); a step without the sort lands on another hash. The first
// INTENT_DELAY_TURNS turns are empty: nothing submitted at a tick can run earlier than T + 2, so a host driven run and a
// direct run of the script are the same run.
//
// The ADVERSARIAL variant (direct runs only) additionally hands step() raw turn lists that no host can build: on a
// share of the turns the list is reversed (so same-seat paints of one cell arrive with ids in reverse submission order)
// and on a share of the turns one intent is repeated (a repeated (seat, id)). A correct step sorts the reversal away
// and refuses the repeat, so the adversarial run of a correct step differs from the plain run only by the rejects the
// repeats add; a step without the sort or without the duplicate check lands on another hash.
import { IdAllocator, withId, type Intent, type IntentBody } from './intents';
import { INTENT_DELAY_TURNS } from './rules';
import { hash2, buildFixtureWorld } from './fixture';
import { step, type StepFn } from './step';
import { createState, ownerSlots, type GameState, type MatchConfig } from './state';
import { hashState } from './serialize';

export const GOLDEN_SEED = 1;
export const GOLDEN_WIDTH = 128;
export const GOLDEN_HEIGHT = 64;
export const GOLDEN_SEATS = 4;
export const GOLDEN_CONFIG: MatchConfig = Object.freeze({ debugIntents: true });
/** The tick points whose hashes are committed in e2e/goldens/sim-hashes.json. */
export const GOLDEN_TICKS: readonly number[] = Object.freeze([1, 10, 100, 1000, 6000]);
/** The second pinned seed: proves that the seed reaches both the fixture world and the script. */
export const ALT_SEED = 2;
/** The tick points pinned for ALT_SEED. */
export const ALT_TICKS: readonly number[] = Object.freeze([10, 100, 1000]);

export interface ScenarioParams {
  readonly seed: number;
  readonly width: number;
  readonly height: number;
  readonly seats: number;
  readonly config: MatchConfig;
}

export const GOLDEN_PARAMS: ScenarioParams = Object.freeze({
  seed: GOLDEN_SEED,
  width: GOLDEN_WIDTH,
  height: GOLDEN_HEIGHT,
  seats: GOLDEN_SEATS,
  config: GOLDEN_CONFIG,
});

/** A state at tick 0 of the scenario world for a seed (other parameters default to the golden ones). */
export function createScenarioState(p: Partial<ScenarioParams> = {}): GameState {
  const q = { ...GOLDEN_PARAMS, ...p };
  const world = buildFixtureWorld(q.seed, q.width, q.height);
  return createState({ width: q.width, height: q.height, seed: q.seed, seats: q.seats, config: q.config, terrain: world.terrain, elevation: world.elevation });
}

/** The bodies the script submits for the turn that runs at `turn` (before ids are handed out). Pure in (seed, turn). */
export function scenarioBodies(seed: number, turn: number, seats: number, cells: number): IntentBody[] {
  if (turn < INTENT_DELAY_TURNS) return [];
  const out: IntentBody[] = [];
  const count = hash2(seed, turn, 0) & 3;
  for (let j = 0; j < count; j++) {
    const g = hash2(seed, turn, j + 1);
    const seat = (g >>> 8) % seats;
    const cell = hash2(seed, turn, 100 + j) % cells;
    const roll = g & 15;
    if (roll === 0) out.push({ kind: 'Noop', seat });
    else if (roll === 1) out.push({ kind: 'DebugPaint', seat: seats + (g >>> 4) % 3, cell });
    else if (roll === 2) out.push({ kind: 'DebugPaint', seat, cell: cells + (g >>> 4) % 5 });
    else out.push({ kind: 'DebugPaint', seat, cell });
  }
  // Spawns: every seat tries twice in the first turns (some land on water or on a disc that is already taken, and are
  // refused), and about one turn in 25 afterwards a random seat tries again (mostly refused: it has spawned already).
  if (cells > 0) {
    const early = turn < INTENT_DELAY_TURNS + 2 * seats;
    if (early || hash2(seed, turn, 400) % 25 === 0) {
      const seat = early ? (turn - INTENT_DELAY_TURNS) % seats : hash2(seed, turn, 401) % seats;
      out.push({ kind: 'Spawn', seat, cell: hash2(seed, turn, 402) % cells });
    }
  }
  // Attacks: about one turn in 4 a random seat attacks a random target (0 = unowned land, or any seat's ownerId; most are
  // refused early on: no land yet, no border), one turn in 40 it cancels one, and a few have a target or pct out of range.
  if (hash2(seed, turn, 500) % 4 === 0) {
    const seat = hash2(seed, turn, 501) % seats;
    const target = hash2(seed, turn, 502) % ownerSlots(seats);
    const pct = 1 + (hash2(seed, turn, 503) % 100);
    const roll = hash2(seed, turn, 504) % 32;
    if (roll === 0) out.push({ kind: 'Attack', seat, target: ownerSlots(seats) + (roll % 3), pct });
    else if (roll === 1) out.push({ kind: 'Attack', seat, target, pct: 101 + (roll % 5) });
    else out.push({ kind: 'Attack', seat, target, pct });
  }
  if (hash2(seed, turn, 510) % 40 === 0) out.push({ kind: 'CancelAttack', seat: hash2(seed, turn, 511) % seats, target: hash2(seed, turn, 512) % ownerSlots(seats) });
  // Structures (M09 part A): a Build of a random type on a random cell about one turn in 3 (most are refused: not the seat's land, the
  // terrain rules, spacing, the purse), an Upgrade of a low id about one turn in 31, a Delete about one turn in 97, and a few with a
  // type or id out of range.
  if (cells > 0 && hash2(seed, turn, 600) % 3 === 0) {
    const seat = hash2(seed, turn, 601) % seats;
    const type = hash2(seed, turn, 602) % 8;
    out.push({ kind: 'Build', seat, type, cell: hash2(seed, turn, 603) % cells });
  }
  if (hash2(seed, turn, 610) % 31 === 0) out.push({ kind: 'Upgrade', seat: hash2(seed, turn, 611) % seats, structure: hash2(seed, turn, 612) % 12 });
  if (hash2(seed, turn, 620) % 97 === 0) out.push({ kind: 'Delete', seat: hash2(seed, turn, 621) % seats, structure: hash2(seed, turn, 622) % 12 });
  if (seats >= 2 && cells > 0 && hash2(seed, turn, 200) % 8 === 0) {
    const cell = hash2(seed, turn, 201) % cells;
    const high = 1 + (hash2(seed, turn, 202) % (seats - 1));
    const low = hash2(seed, turn, 203) % high;
    out.push({ kind: 'DebugPaint', seat: high, cell });
    out.push({ kind: 'DebugPaint', seat: low, cell });
  }
  if (cells > 0 && hash2(seed, turn, 204) % 8 === 0) {
    // One seat paints one cell twice: the later id must be the one that stays in `stamp`.
    const seat = hash2(seed, turn, 205) % seats;
    const cell = hash2(seed, turn, 206) % cells;
    out.push({ kind: 'DebugPaint', seat, cell });
    out.push({ kind: 'DebugPaint', seat, cell });
  }
  return out;
}

/** The id counters a run has reached at tick `tick` (replays the script's submissions of turns 0..tick-1). */
export function allocatorAt(seed: number, seats: number, cells: number, tick: number): IdAllocator {
  const alloc = new IdAllocator();
  for (let t = 0; t < tick; t++) for (const b of scenarioBodies(seed, t, seats, cells)) alloc.alloc(b.seat);
  return alloc;
}

/** The intents of one turn with ids from `alloc`, in submission order (adversarial: see the header of this file). */
export function scenarioIntents(seed: number, turn: number, seats: number, cells: number, alloc: IdAllocator, adversarial = false): Intent[] {
  const list = scenarioBodies(seed, turn, seats, cells).map((b) => withId(b, alloc.alloc(b.seat)));
  if (!adversarial || list.length === 0) return list;
  if (hash2(seed, turn, 300) % 4 === 0) list.push({ ...(list[hash2(seed, turn, 301) % list.length] as Intent) });
  if (hash2(seed, turn, 302) % 2 === 0) list.reverse();
  return list;
}

/** Runs the script from the state's current tick up to `toTick`. Returns the number of steps that failed (0 for a sound run). */
export function runScenario(state: GameState, toTick: number, stepFn: StepFn = step, adversarial = false): number {
  const seed = state.header.seed;
  const cells = state.width * state.height;
  const alloc = allocatorAt(seed, state.header.seats, cells, state.tick);
  let failed = 0;
  while (state.tick < toTick) {
    const turn = state.tick;
    const r = stepFn(state, { turn, intents: scenarioIntents(seed, turn, state.header.seats, cells, alloc, adversarial) });
    if (!r.ok) {
      failed++;
      break;
    }
  }
  return failed;
}

/** Hashes of a fresh scenario run at the given ticks (ascending). */
export function scenarioHashes(p: Partial<ScenarioParams> = {}, ticks: readonly number[] = GOLDEN_TICKS, stepFn: StepFn = step, adversarial = false): number[] {
  const state = createScenarioState(p);
  const out: number[] = [];
  for (const t of ticks) {
    runScenario(state, t, stepFn, adversarial);
    out.push(hashState(state));
  }
  return out;
}
