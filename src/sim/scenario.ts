// The golden scenario: a fixture world plus a scripted stream of intents, shared by the Node test, the CLI, the
// Chromium debug page (debug/sim.html) and the worker test, so all of them hash the same run.
//
// The script is a pure function of (seed, turn). It sends a few valid DebugPaints, some Noops and a share of deliberately
// invalid intents per turn (bad seat, bad cell) so that the reject path is part of every golden hash. The first
// INTENT_DELAY_TURNS turns are empty: nothing submitted at a tick can run earlier than T + 2, so a host driven run and a
// direct run of the script are the same run.
import { IdAllocator, withId, type Intent, type IntentBody } from './intents';
import { INTENT_DELAY_TURNS } from './rules';
import { hash2, buildFixtureWorld } from './fixture';
import { step, type StepFn } from './step';
import { createState, type GameState, type MatchConfig } from './state';
import { hashState } from './serialize';

export const GOLDEN_SEED = 1;
export const GOLDEN_WIDTH = 128;
export const GOLDEN_HEIGHT = 64;
export const GOLDEN_SEATS = 4;
export const GOLDEN_CONFIG: MatchConfig = Object.freeze({ debugIntents: true });
/** The tick points whose hashes are committed in e2e/goldens/sim-hashes.json. */
export const GOLDEN_TICKS: readonly number[] = Object.freeze([1, 10, 100, 1000, 6000]);

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
  return out;
}

/** The id counters a run has reached at tick `tick` (replays the script's submissions of turns 0..tick-1). */
export function allocatorAt(seed: number, seats: number, cells: number, tick: number): IdAllocator {
  const alloc = new IdAllocator();
  for (let t = 0; t < tick; t++) for (const b of scenarioBodies(seed, t, seats, cells)) alloc.alloc(b.seat);
  return alloc;
}

/** The intents of one turn with ids from `alloc`, in submission order. */
export function scenarioIntents(seed: number, turn: number, seats: number, cells: number, alloc: IdAllocator): Intent[] {
  return scenarioBodies(seed, turn, seats, cells).map((b) => withId(b, alloc.alloc(b.seat)));
}

/** Runs the script from the state's current tick up to `toTick`. Returns the number of steps that failed (0 for a sound run). */
export function runScenario(state: GameState, toTick: number, stepFn: StepFn = step): number {
  const seed = state.header.seed;
  const cells = state.width * state.height;
  const alloc = allocatorAt(seed, state.header.seats, cells, state.tick);
  let failed = 0;
  while (state.tick < toTick) {
    const turn = state.tick;
    const r = stepFn(state, { turn, intents: scenarioIntents(seed, turn, state.header.seats, cells, alloc) });
    if (!r.ok) {
      failed++;
      break;
    }
  }
  return failed;
}

/** Hashes of a fresh scenario run at the given ticks (ascending). */
export function scenarioHashes(p: Partial<ScenarioParams> = {}, ticks: readonly number[] = GOLDEN_TICKS, stepFn: StepFn = step): number[] {
  const state = createScenarioState(p);
  const out: number[] = [];
  for (const t of ticks) {
    runScenario(state, t, stepFn);
    out.push(hashState(state));
  }
  return out;
}
