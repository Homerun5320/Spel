// A small random world and a random intent stream for the property tests of the territory and the conquest. Everything is a
// function of (seed, tick): no Math.random, so a failing run can be replayed from its seed.
import { hash2 } from '../../../src/sim/fixture';
import { withId, type Intent, type IntentBody } from '../../../src/sim/intents';
import { createState, type GameState } from '../../../src/sim/state';
import { CLASS_DEEP_SEA, CLASS_FOREST, CLASS_HILLS, CLASS_MOUNTAIN, CLASS_PEAK, CLASS_PLAINS } from '../../../src/sim/terrain';

export const RW = 48;
export const RH = 32;
export const RSEATS = 6;
export const RPLAYERS = 3;

const CLASS_BY_ROLL = [CLASS_DEEP_SEA, CLASS_PEAK, CLASS_MOUNTAIN, CLASS_MOUNTAIN, CLASS_HILLS, CLASS_FOREST, CLASS_PLAINS, CLASS_PLAINS, CLASS_PLAINS, CLASS_PLAINS];

/** A world of blotchy land: the roll of a 3x3 block decides most of a cell, so lakes and ridges are more than one cell wide. */
export function randomMatchState(seed: number, debug = true, seats = RSEATS, players = RPLAYERS): GameState {
  const terrain = new Uint8Array(RW * RH);
  const elevation = new Uint16Array(RW * RH);
  for (let y = 0; y < RH; y++) {
    for (let x = 0; x < RW; x++) {
      const block = hash2(seed, (x / 3) | 0, (y / 3) | 0) % 10;
      const own = hash2(seed + 1, x, y) % 10;
      terrain[y * RW + x] = CLASS_BY_ROLL[own < 2 ? own : block] as number;
      elevation[y * RW + x] = hash2(seed + 2, x, y) % 3000;
    }
  }
  return createState({ width: RW, height: RH, seed, seats, players, config: { debugIntents: debug }, terrain, elevation });
}

/** The intent bodies of one tick of a random match (pure in (seed, tick)). */
export function randomBodies(seed: number, tick: number, seats = RSEATS, cells = RW * RH, debug = true): IntentBody[] {
  const out: IntentBody[] = [];
  if (tick < seats) out.push({ kind: 'Spawn', seat: tick, cell: hash2(seed, tick, 7) % cells });
  const n = hash2(seed, tick, 1) % 3;
  for (let j = 0; j < n; j++) {
    const g = hash2(seed, tick, 10 + j);
    const seat = g % seats;
    const roll = (g >>> 8) % 100;
    const target = hash2(seed, tick, 20 + j) % (seats + 1);
    if (roll < 15) out.push({ kind: 'Spawn', seat, cell: hash2(seed, tick, 30 + j) % cells });
    else if (roll < 70) out.push({ kind: 'Attack', seat, target, pct: 1 + (hash2(seed, tick, 40 + j) % 100) });
    else if (roll < 85) out.push({ kind: 'CancelAttack', seat, target });
    else if (debug) out.push({ kind: 'DebugPaint', seat, cell: hash2(seed, tick, 50 + j) % cells });
  }
  return out;
}

/** Ids per seat in submission order, replayed from tick 0 (a stream is a pure function of the seed). */
export class MatchDriver {
  readonly next = new Uint32Array(256);
  constructor(
    readonly state: GameState,
    readonly seed: number,
    readonly debug = true,
  ) {}

  intents(bodies: IntentBody[]): Intent[] {
    return bodies.map((b) => withId(b, (this.next[b.seat] = (this.next[b.seat] as number) + 1) - 1));
  }

  /** One tick of the random stream. */
  tick(): void {
    const s = this.state;
    const r = this.step(this.intents(randomBodies(this.seed, s.tick, s.header.seats, s.width * s.height, this.debug)));
    if (!r) throw new Error('step failed');
    s.outbox.clear();
  }

  step(intents: Intent[]): boolean {
    // imported lazily to keep this helper free of a cycle with the step under test
    return stepFn(this.state, intents);
  }
}

import { step } from '../../../src/sim/step';
function stepFn(state: GameState, intents: Intent[]): boolean {
  return step(state, { turn: state.tick, intents }).ok;
}
