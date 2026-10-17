// The sea transport replay of M13c-1 (headless; lives in tools, never in src/sim):
//
//   npm run sim:scenario -- ship-landing --seed N
//
// A synthetic world (256 x 64 plains, a 48 cell wide sea between the west nation and the east nation, an island in the middle that the route has to go round): the west seat has a
// finished Port and sends one ship with 600 troops to the east coast. The program prints the tick and the events of the voyage (launch, landing, turning home, docking) and the
// final state hash. The output is a pure function of the seed: the same arguments print the same bytes. The seed moves the Port, the target and the island.
import { pathToFileURL } from 'node:url';
import { hex32 } from '../../src/sim/hash';
import { launchShipBody, withId } from '../../src/sim/intents';
import {
  OUTBOX_BEACHHEAD_FORMED,
  OUTBOX_REJECT,
  OUTBOX_SHIP_LANDED,
  OUTBOX_SHIP_LAUNCHED,
  OUTBOX_SHIP_RETURNED,
  OUTBOX_SHIP_RTB,
  OUTBOX_SHIP_SCRAPPED,
  type OutboxEvent,
} from '../../src/sim/outbox';
import { BUILD_TICKS, MILLI_GOLD_PER_GOLD, QT_PER_TROOP } from '../../src/sim/rules';
import { hashState } from '../../src/sim/serialize';
import { createState, rebuildAggregates, type GameState, type MatchConfig } from '../../src/sim/state';
import { step } from '../../src/sim/step';
import { STRUCT_PORT } from '../../src/sim/structureRules';
import { CLASS_DEEP_SEA, CLASS_PLAINS } from '../../src/sim/terrain';

export const SHIP_W = 256;
export const SHIP_H = 64;
const SEA_FROM = 96;
const SEA_TO = 144;

export interface ShipFixture {
  readonly state: GameState;
  /** The structure id of the west Port. */
  readonly port: number;
  /** The landing cell on the east coast. */
  readonly target: number;
  readonly troops: number;
}

/** Options of the fixture (tests): the match config, the seat count and whether the island is there (without it the route is a straight line along the Port's row, 46 cells for the target row of seed 0). */
export interface ShipFixtureOptions {
  readonly config?: MatchConfig;
  readonly seats?: number;
  readonly island?: boolean;
}

/** The synthetic crossing described in the header; `seed` moves the Port, the target and the island. */
export function shipFixture(seed: number, opts: ShipFixtureOptions = {}): ShipFixture {
  const W = SHIP_W;
  const H = SHIP_H;
  const terrain = new Uint8Array(W * H).fill(CLASS_PLAINS);
  const elevation = new Uint16Array(W * H).fill(5);
  const s0 = Math.abs(Math.trunc(seed));
  const islandTop = 18 + (s0 % 6);
  for (let y = 0; y < H; y++) for (let x = SEA_FROM; x < SEA_TO; x++) terrain[y * W + x] = CLASS_DEEP_SEA;
  if (opts.island !== false) for (let y = islandTop; y < islandTop + 26; y++) for (let x = 112; x < 128; x++) terrain[y * W + x] = CLASS_PLAINS;
  const state = createState({ width: W, height: H, seed, seats: opts.seats ?? 2, config: opts.config ?? { debugIntents: true }, terrain, elevation });
  for (let c = 0; c < W * H; c++) {
    const x = c % W;
    state.owner[c] = x < SEA_FROM ? 1 : x >= SEA_TO ? 2 : 0;
  }
  rebuildAggregates(state);
  state.gold[1] = 1000 * MILLI_GOLD_PER_GOLD;
  state.troops[1] = 2000 * QT_PER_TROOP;
  state.troops[2] = 500 * QT_PER_TROOP;
  const portY = 24 + (s0 % 16);
  const port = state.structures.add(STRUCT_PORT, 1, portY * W + (SEA_FROM - 1), 0);
  state.tick = BUILD_TICKS[STRUCT_PORT] as number; // the match starts when the Port is finished (it was laid down at tick 0)
  const target = (28 + ((s0 * 7) % 16)) * W + SEA_TO;
  return { state, port, target, troops: 600 };
}

const NAMES: Record<number, string> = {
  [OUTBOX_SHIP_LAUNCHED]: 'ship-launched',
  [OUTBOX_SHIP_LANDED]: 'ship-landed',
  [OUTBOX_SHIP_RETURNED]: 'ship-returned',
  [OUTBOX_SHIP_SCRAPPED]: 'ship-scrapped',
  [OUTBOX_SHIP_RTB]: 'ship-rtb',
  [OUTBOX_BEACHHEAD_FORMED]: 'beachhead-formed',
  [OUTBOX_REJECT]: 'reject',
};

export interface ShipLandingResult {
  readonly lines: string[];
  readonly hash: number;
  readonly events: OutboxEvent[];
  /** The tick of the step that announced the landing, -1 when none was. */
  readonly landedTick: number;
}

/** Runs the crossing until the ship has docked and cooled down (or 4000 ticks), collecting the events. */
export function runShipLanding(seed: number): ShipLandingResult {
  const fx = shipFixture(seed);
  const s = fx.state;
  const lines: string[] = [];
  const events: OutboxEvent[] = [];
  let landedTick = -1;
  let id = 1;
  for (let t = 0; t < 4000; t++) {
    const intents = t === 3 ? [withId(launchShipBody(0, fx.port, fx.target, fx.troops), id++)] : [];
    step(s, { turn: s.tick, intents });
    for (const e of s.outbox.drain()) {
      const name = NAMES[e.kind];
      if (name === undefined) continue;
      events.push(e);
      if (e.kind === OUTBOX_SHIP_LANDED) landedTick = e.tick;
      lines.push(`tick ${e.tick} ${name} a=${e.a} b=${e.b}`);
    }
    if (t > 10 && s.ships.liveCount === 0 && events.length > 0) break;
  }
  lines.push(`west land ${s.agg.area[1]} cells, east land ${s.agg.area[2]} cells, troops ${Math.floor((s.troops[1] as number) / QT_PER_TROOP)}`);
  return { lines, hash: hashState(s), events, landedTick };
}

export function parseShipLandingArgs(argv: readonly string[]): { seed: number } {
  let seed = 1;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--seed') {
      const v = Number(argv[++i]);
      if (!Number.isInteger(v) || v < 0) throw new Error('--seed needs a non-negative integer');
      seed = v;
    } else throw new Error(`unknown argument ${String(argv[i])}`);
  }
  return { seed };
}

/** Runs the command and returns the text it prints. */
export function shipLanding(args: { seed: number }): string {
  const r = runShipLanding(args.seed);
  return [`ship-landing seed=${args.seed}`, ...r.lines, `final state hash ${hex32(r.hash)}`].join('\n');
}

async function main(): Promise<void> {
  try {
    console.log(shipLanding(parseShipLandingArgs(process.argv.slice(2))));
  } catch (err) {
    console.error(String(err instanceof Error ? err.message : err));
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
