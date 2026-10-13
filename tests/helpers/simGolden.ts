// Shared by the Node golden test, the e2e test of debug/sim.html and the worker test: where the committed hashes live,
// how to read and write them, and how to compute a report from a step function.
import fs from 'node:fs';
import path from 'node:path';
import { canaryHash, CANARY_VALUES } from '../../src/sim/canary';
import { hex32 } from '../../src/sim/hash';
import { GOLDEN_PARAMS, GOLDEN_TICKS, createScenarioState, runScenario, type ScenarioParams } from '../../src/sim/scenario';
import { hashState, FORMAT_VERSION } from '../../src/sim/serialize';
import { ENGINE_VERSION } from '../../src/sim/state';
import { step, type StepFn } from '../../src/sim/step';

export const SIM_GOLDEN_PATH = path.resolve(__dirname, '../../e2e/goldens/sim-hashes.json');
export const SIM_GOLDEN_MISSING = 'kör UPDATE_GOLDENS=1 och committa e2e/goldens/sim-hashes.json';

export interface SimGolden {
  schema: 1;
  engineVersion: number;
  formatVersion: number;
  seed: number;
  width: number;
  height: number;
  seats: number;
  debugIntents: boolean;
  mapHash: string;
  ticks: number[];
  hashes: Record<string, string>;
  canary: { values: number; hash: string };
}

/** Computes the golden report for a scenario with a given step function. */
export function computeGolden(stepFn: StepFn = step, params: Partial<ScenarioParams> = {}): SimGolden {
  const p = { ...GOLDEN_PARAMS, ...params };
  const state = createScenarioState(p);
  const hashes: Record<string, string> = {};
  for (const t of GOLDEN_TICKS) {
    runScenario(state, t, stepFn);
    hashes[String(t)] = hex32(hashState(state));
  }
  return {
    schema: 1,
    engineVersion: ENGINE_VERSION,
    formatVersion: FORMAT_VERSION,
    seed: p.seed,
    width: p.width,
    height: p.height,
    seats: p.seats,
    debugIntents: p.config.debugIntents,
    mapHash: hex32(state.header.mapHash),
    ticks: [...GOLDEN_TICKS],
    hashes,
    canary: { values: CANARY_VALUES, hash: hex32(canaryHash()) },
  };
}

export function readGolden(): SimGolden {
  if (!fs.existsSync(SIM_GOLDEN_PATH)) throw new Error(`golden e2e/goldens/sim-hashes.json is missing: ${SIM_GOLDEN_MISSING}`);
  return JSON.parse(fs.readFileSync(SIM_GOLDEN_PATH, 'utf8')) as SimGolden;
}

export function writeGolden(g: SimGolden): void {
  fs.writeFileSync(SIM_GOLDEN_PATH, `${JSON.stringify(g, null, 2)}\n`);
}
