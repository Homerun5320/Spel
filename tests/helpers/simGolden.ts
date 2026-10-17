// Shared by the Node golden test, the e2e test of debug/sim.html and the worker test: where the committed hashes live,
// how to read and write them, and how to compute a report from a step function.
import fs from 'node:fs';
import path from 'node:path';
import { canaryHash, CANARY_VALUES } from '../../src/sim/canary';
import { hex32 } from '../../src/sim/hash';
import { ALT_SEED, ALT_TICKS, GOLDEN_PARAMS, GOLDEN_TICKS, createScenarioState, runScenario, type ScenarioParams } from '../../src/sim/scenario';
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
  /** A second seed (ALT_SEED) through the plain script: world hash and hashes at ALT_TICKS. */
  alt: { seed: number; mapHash: string; ticks: number[]; hashes: Record<string, string> };
  /** Seed 1 again with raw turn lists (reversed order, repeated (seat, id)); hashes at GOLDEN_TICKS. */
  adversarial: { hashes: Record<string, string> };
}

function hashesAt(stepFn: StepFn, params: Partial<ScenarioParams>, ticks: readonly number[], adversarial: boolean): { hashes: Record<string, string>; mapHash: string } {
  const state = createScenarioState(params);
  const hashes: Record<string, string> = {};
  for (const t of ticks) {
    runScenario(state, t, stepFn, adversarial);
    hashes[String(t)] = hex32(hashState(state));
  }
  return { hashes, mapHash: hex32(state.header.mapHash) };
}

/** Computes the golden report for a scenario with a given step function. */
export function computeGolden(stepFn: StepFn = step, params: Partial<ScenarioParams> = {}): SimGolden {
  const p = { ...GOLDEN_PARAMS, ...params };
  const main = hashesAt(stepFn, p, GOLDEN_TICKS, false);
  const alt = hashesAt(stepFn, { ...p, seed: ALT_SEED }, ALT_TICKS, false);
  const adversarial = hashesAt(stepFn, p, GOLDEN_TICKS, true);
  return {
    schema: 1,
    engineVersion: ENGINE_VERSION,
    formatVersion: FORMAT_VERSION,
    seed: p.seed,
    width: p.width,
    height: p.height,
    seats: p.seats,
    debugIntents: p.config.debugIntents,
    mapHash: main.mapHash,
    ticks: [...GOLDEN_TICKS],
    hashes: main.hashes,
    canary: { values: CANARY_VALUES, hash: hex32(canaryHash()) },
    alt: { seed: ALT_SEED, mapHash: alt.mapHash, ticks: [...ALT_TICKS], hashes: alt.hashes },
    adversarial: { hashes: adversarial.hashes },
  };
}

export function readGolden(): SimGolden {
  if (!fs.existsSync(SIM_GOLDEN_PATH)) throw new Error(`golden e2e/goldens/sim-hashes.json is missing: ${SIM_GOLDEN_MISSING}`);
  return JSON.parse(fs.readFileSync(SIM_GOLDEN_PATH, 'utf8')) as SimGolden;
}

export function writeGolden(g: SimGolden): void {
  fs.writeFileSync(SIM_GOLDEN_PATH, `${JSON.stringify(g, null, 2)}\n`);
}
