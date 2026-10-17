// The missile replay of M14a (headless; lives in tools, never in src/sim):
//
//   npm run sim:scenario -- missiles --fixture <plain-cruise|fusion-silo> --seed N
//
// A synthetic world (1024 x 512 cells, an island of plains x 60..499 y 150..349 in a deep sea, the west nation x 100..299, the east nation x 300 to 459) with the west Silo at (250, 250) and a few buildings in the east. The program
// fires one missile (a Tactical cruise missile at the east's first City for plain-cruise, a Fusion missile at the east's heartland from a level 2 Silo for fusion-silo), runs until the blast
// and some ticks after it, and prints the tick and the events and the final state hash. The output is a pure function of the fixture and the seed: the seed moves the target by a few
// cells. The SAM fixtures (ridge-cruise, sam-stack) are M14b.
import { pathToFileURL } from 'node:url';
import { hex32 } from '../../src/sim/hash';
import { launchMissileBody, withId } from '../../src/sim/intents';
import {
  OUTBOX_MISSILE_BUILDING_DESTROYED,
  OUTBOX_MISSILE_DETONATED,
  OUTBOX_MISSILE_LAUNCHED,
  OUTBOX_MISSILE_WARNING,
  OUTBOX_PAINT,
  OUTBOX_REJECT,
  type OutboxEvent,
} from '../../src/sim/outbox';
import { BUILD_TICKS, MILLI_GOLD_PER_GOLD, QT_PER_TROOP } from '../../src/sim/rules';
import { hashState } from '../../src/sim/serialize';
import { createState, rebuildAggregates, type GameState } from '../../src/sim/state';
import { step } from '../../src/sim/step';
import { STRUCT_CITY, STRUCT_FACTORY, STRUCT_POST, STRUCT_SILO } from '../../src/sim/structureRules';
import { CLASS_DEEP_SEA, CLASS_PLAINS } from '../../src/sim/terrain';
import { MISSILE_FUSION, MISSILE_TACTICAL } from '../../src/sim/missileTable';

export const MISSILE_W = 1024;
export const MISSILE_H = 512;
export type MissileFixtureName = 'plain-cruise' | 'fusion-silo';
export const MISSILE_FIXTURES: readonly MissileFixtureName[] = ['plain-cruise', 'fusion-silo'];

export interface MissileFixture {
  readonly state: GameState;
  readonly silo: number;
  readonly target: number;
  readonly cls: number;
  /** The structure ids of the east buildings, in the order they were laid down. */
  readonly buildings: readonly number[];
}

/** The synthetic world described in the header. */
export function missileFixture(name: MissileFixtureName, seed: number): MissileFixture {
  const W = MISSILE_W;
  const H = MISSILE_H;
  const terrain = new Uint8Array(W * H).fill(CLASS_DEEP_SEA);
  const elevation = new Uint16Array(W * H).fill(5);
  // One island of plains (the playable cells of a state may weigh 2^32 in Q15 at most, which a whole 1024 x 512 plain would not).
  for (let y = 150; y < 350; y++) for (let x = 60; x < 500; x++) terrain[y * W + x] = CLASS_PLAINS;
  const s0 = Math.abs(Math.trunc(seed));
  const fusion = name === 'fusion-silo';
  const state = createState({ width: W, height: H, seed, seats: 2, terrain, elevation });
  const eastTo = fusion ? 460 : 360;
  for (let y = 200; y < 300; y++) for (let x = 100; x < eastTo; x++) state.owner[y * W + x] = x < 300 ? 1 : 2;
  rebuildAggregates(state);
  state.gold[1] = 20000 * MILLI_GOLD_PER_GOLD;
  state.troops[1] = 1000 * QT_PER_TROOP;
  state.troops[2] = 1000 * QT_PER_TROOP;
  const at = (x: number, y: number): number => y * W + x;
  const silo = state.structures.add(STRUCT_SILO, 1, at(250, 250), 0);
  if (fusion) state.structures.level[silo] = 2;
  const row = 248 + (s0 % 5);
  const target = at(fusion ? 400 : 310, row);
  const buildings: number[] = [];
  const add = (type: number, x: number, y: number): void => {
    buildings.push(state.structures.add(type, 2, at(x, y), 0));
  };
  if (fusion) {
    add(STRUCT_CITY, 400, row);
    add(STRUCT_FACTORY, 410, row + 3);
    add(STRUCT_CITY, 420, row - 4);
    add(STRUCT_CITY, 428, row);
    add(STRUCT_POST, 445, row);
  } else {
    add(STRUCT_CITY, 310, row);
    add(STRUCT_FACTORY, 312, row + 2);
    add(STRUCT_CITY, 316, row);
    add(STRUCT_POST, 340, row);
  }
  state.tick = BUILD_TICKS[STRUCT_SILO] as number;
  return { state, silo, target, cls: fusion ? MISSILE_FUSION : MISSILE_TACTICAL, buildings };
}

const NAMES: Record<number, string> = {
  [OUTBOX_MISSILE_LAUNCHED]: 'missile-launched',
  [OUTBOX_MISSILE_WARNING]: 'missile-warning',
  [OUTBOX_MISSILE_DETONATED]: 'missile-detonated',
  [OUTBOX_MISSILE_BUILDING_DESTROYED]: 'building-destroyed',
  [OUTBOX_REJECT]: 'reject',
};

export interface MissileRun {
  readonly lines: string[];
  readonly hash: number;
  readonly events: OutboxEvent[];
  /** The tick of the step that announced the blast, -1 when none was. */
  readonly blastTick: number;
  /** Cells that changed owner in the run (paint events). */
  readonly painted: number;
}

/** Runs the fixture: the launch in turn 3, then until 20 ticks after the blast (or 600 ticks), collecting the events. */
export function runMissiles(name: MissileFixtureName, seed: number): MissileRun {
  const fx = missileFixture(name, seed);
  const s = fx.state;
  const lines: string[] = [];
  const events: OutboxEvent[] = [];
  let blastTick = -1;
  let painted = 0;
  let id = 1;
  for (let t = 0; t < 600; t++) {
    const intents = t === 3 ? [withId(launchMissileBody(0, fx.silo, fx.cls, fx.target), id++)] : [];
    step(s, { turn: s.tick, intents });
    for (const e of s.outbox.drain()) {
      if (e.kind === OUTBOX_PAINT) painted++;
      const label = NAMES[e.kind];
      if (label === undefined) continue;
      events.push(e);
      if (e.kind === OUTBOX_MISSILE_DETONATED) blastTick = e.tick;
      lines.push(`tick ${e.tick} ${label} a=${e.a} b=${e.b}`);
    }
    if (blastTick >= 0 && s.tick > blastTick + 20) break;
  }
  const fallout = s.missiles.falloutCount;
  lines.push(`west land ${s.agg.area[1]} cells, east land ${s.agg.area[2]} cells, fallout ${fallout} cells, east troops ${Math.floor((s.troops[2] as number) / QT_PER_TROOP)}`);
  return { lines, hash: hashState(s), events, blastTick, painted };
}

export function parseMissilesArgs(argv: readonly string[]): { fixture: MissileFixtureName; seed: number } {
  let seed = 1;
  let fixture: MissileFixtureName = 'plain-cruise';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--seed') {
      const v = Number(argv[++i]);
      if (!Number.isInteger(v) || v < 0) throw new Error('--seed needs a non-negative integer');
      seed = v;
    } else if (argv[i] === '--fixture') {
      const f = argv[++i];
      if (f !== 'plain-cruise' && f !== 'fusion-silo') throw new Error('--fixture is plain-cruise or fusion-silo (ridge-cruise and sam-stack come with M14b)');
      fixture = f;
    } else throw new Error(`unknown argument ${String(argv[i])}`);
  }
  return { fixture, seed };
}

/** Runs the command and returns the text it prints. */
export function missiles(args: { fixture: MissileFixtureName; seed: number }): string {
  const r = runMissiles(args.fixture, args.seed);
  return [`missiles fixture=${args.fixture} seed=${args.seed}`, ...r.lines, `final state hash ${hex32(r.hash)}`].join('\n');
}

async function main(): Promise<void> {
  try {
    console.log(missiles(parseMissilesArgs(process.argv.slice(2))));
  } catch (err) {
    console.error(String(err instanceof Error ? err.message : err));
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
