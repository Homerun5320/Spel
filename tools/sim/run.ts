// Command line runner of the golden scenario:
//
//   npm run sim:run -- --seed N --ticks T [--width W --height H --seats S --no-debug-intents] [--canary] [--json]
//
// Prints the hash at ticks 1, 10, 100, 1000 and 6000 (those not above T) and finally the hash at T. The default world is
// the 128x64 fixture world; with the default flags and --seed 1 --ticks 6000 the lines equal e2e/goldens/sim-hashes.json.
import { pathToFileURL } from 'node:url';
import { canaryHash } from '../../src/sim/canary';
import { hex32 } from '../../src/sim/hash';
import { GOLDEN_PARAMS, GOLDEN_TICKS, createScenarioState, runScenario, type ScenarioParams } from '../../src/sim/scenario';
import { hashState } from '../../src/sim/serialize';

export interface RunArgs {
  readonly params: ScenarioParams;
  readonly ticks: number;
  readonly canary: boolean;
  readonly json: boolean;
}

export interface RunReport {
  readonly seed: number;
  readonly width: number;
  readonly height: number;
  readonly seats: number;
  readonly debugIntents: boolean;
  readonly ticks: number;
  readonly mapHash: string;
  readonly hashes: Array<{ tick: number; hash: string }>;
  readonly final: { tick: number; hash: string };
  readonly rejects: number;
  readonly canary?: string;
}

function intArg(name: string, raw: string | undefined, lo: number, hi: number): number {
  const n = raw === undefined ? NaN : Number(raw);
  if (!Number.isInteger(n) || n < lo || n > hi) throw new Error(`${name} needs an integer in ${lo}..${hi}, got ${String(raw)}`);
  return n;
}

export function parseArgs(argv: readonly string[]): RunArgs {
  let seed = GOLDEN_PARAMS.seed;
  let width = GOLDEN_PARAMS.width;
  let height = GOLDEN_PARAMS.height;
  let seats = GOLDEN_PARAMS.seats;
  let debugIntents = GOLDEN_PARAMS.config.debugIntents;
  let ticks = 6000;
  let canary = false;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    const next = argv[i + 1];
    if (a === '--seed') {
      seed = intArg('--seed', next, -2147483648, 4294967295);
      i++;
    } else if (a === '--ticks') {
      ticks = intArg('--ticks', next, 0, 10_000_000);
      i++;
    } else if (a === '--width') {
      width = intArg('--width', next, 1, 4096);
      i++;
    } else if (a === '--height') {
      height = intArg('--height', next, 1, 4096);
      i++;
    } else if (a === '--seats') {
      seats = intArg('--seats', next, 1, 255);
      i++;
    } else if (a === '--no-debug-intents') debugIntents = false;
    else if (a === '--canary') canary = true;
    else if (a === '--json') json = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return { params: { seed, width, height, seats, config: { debugIntents } }, ticks, canary, json };
}

export function run(args: RunArgs): RunReport {
  const state = createScenarioState(args.params);
  const hashes: Array<{ tick: number; hash: string }> = [];
  for (const t of GOLDEN_TICKS) {
    if (t > args.ticks) break;
    runScenario(state, t);
    hashes.push({ tick: t, hash: hex32(hashState(state)) });
  }
  runScenario(state, args.ticks);
  return {
    seed: args.params.seed,
    width: args.params.width,
    height: args.params.height,
    seats: args.params.seats,
    debugIntents: args.params.config.debugIntents,
    ticks: args.ticks,
    mapHash: hex32(state.header.mapHash),
    hashes,
    final: { tick: state.tick, hash: hex32(hashState(state)) },
    rejects: state.rejects,
    ...(args.canary ? { canary: hex32(canaryHash()) } : {}),
  };
}

export function format(report: RunReport): string {
  const lines = [
    `sim:run seed=${report.seed} size=${report.width}x${report.height} seats=${report.seats} debugIntents=${report.debugIntents} mapHash=${report.mapHash}`,
    ...report.hashes.map((h) => `tick ${h.tick}: ${h.hash}`),
    `final tick ${report.final.tick}: ${report.final.hash} (rejects ${report.rejects})`,
  ];
  if (report.canary !== undefined) lines.push(`canary: ${report.canary}`);
  return lines.join('\n');
}

function main(): void {
  try {
    const args = parseArgs(process.argv.slice(2));
    const report = run(args);
    console.log(args.json ? JSON.stringify(report, null, 2) : format(report));
  } catch (err) {
    console.error(String(err instanceof Error ? err.message : err));
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main();
