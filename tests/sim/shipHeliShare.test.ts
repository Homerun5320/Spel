// M13c-1: the two kinds of transport share the beachhead table. A ship on its way to a landing will want a row, so it counts against the free rows when a HELICOPTER is sent (the helicopter
// probe of src/sim/heliFlight.ts), exactly as another helicopter in the air does (Fix-4A1). The world is the one of tests/sim/fix4a1.test.ts: 512x128 plains, west seat 1, east seat 2.
import { describe, expect, it } from 'vitest';
import { applyLaunchHeli } from '../../src/sim/heliFlight';
import { BEACH_CUT_OFF } from '../../src/sim/heliTable';
import { produceHeliBody, REJECT_HELI_BEACHHEAD_FULL, REJECT_NONE, withId } from '../../src/sim/intents';
import { BEACHHEAD_CAPACITY, BUILD_TICKS, HELI_BUILD_TICKS, MILLI_GOLD_PER_GOLD, QT_PER_TROOP, SHIP_MIN_TROOPS } from '../../src/sim/rules';
import { SHIP_LAND, SHIP_OFF, SHIP_RETURN, SHIP_SAIL } from '../../src/sim/shipTable';
import { step } from '../../src/sim/step';
import { createState, rebuildAggregates, type GameState } from '../../src/sim/state';
import { STRUCT_FACTORY } from '../../src/sim/structureRules';
import { CLASS_PLAINS } from '../../src/sim/terrain';

const W = 512;
const H = 128;
const at = (x: number, y: number): number => y * W + x;
const NEUTRAL_LZ = at(300, 60);

function world(): GameState {
  const terrain = new Uint8Array(W * H).fill(CLASS_PLAINS);
  const s = createState({ width: W, height: H, seed: 5, seats: 2, config: { debugIntents: true }, terrain, elevation: new Uint16Array(W * H).fill(5), maxElev: new Int16Array(W * H).fill(5) });
  for (let c = 0; c < W * H; c++) {
    const x = c % W;
    s.owner[c] = x < 256 ? 1 : x >= 280 && x < 330 ? 0 : 2;
  }
  rebuildAggregates(s);
  s.gold[1] = 100000 * MILLI_GOLD_PER_GOLD;
  s.troops[1] = 5000 * QT_PER_TROOP;
  return s;
}

function readyHeli(s: GameState): number {
  const f = s.structures.add(STRUCT_FACTORY, 1, at(230, 60), s.tick);
  for (let i = 0; i < (BUILD_TICKS[STRUCT_FACTORY] as number); i++) step(s, { turn: s.tick, intents: [] });
  step(s, { turn: s.tick, intents: [withId(produceHeliBody(0, f), 1)] });
  for (let i = 0; i < HELI_BUILD_TICKS + 1; i++) step(s, { turn: s.tick, intents: [] });
  s.troops[1] = 5000 * QT_PER_TROOP;
  return f;
}

/** A world with one beachhead row free, one ship of seat 2 in state `st` and a helicopter ready on seat 1's pad: what LaunchHeli says. */
function launchWithShip(st: number): number {
  const s = world();
  const f = readyHeli(s);
  for (let i = 0; i < BEACHHEAD_CAPACITY - 1; i++) s.beachheads.add(2, at(400 + (i % 60), 10 + Math.floor(i / 60)), s.tick, BEACH_CUT_OFF);
  s.ships.add(0, 2, 9, at(300, 60), s.tick, SHIP_MIN_TROOPS, st === SHIP_SAIL || st === SHIP_LAND ? at(310, 60) + 1 : 0);
  s.ships.state[0] = st;
  return applyLaunchHeli(s, 0, f, NEUTRAL_LZ, 100, 0);
}

describe('a ship under way counts against the free beachhead rows of a helicopter launch', () => {
  it('one row free and a ship sailing or unloading: LaunchHeli is refused', () => {
    expect(launchWithShip(SHIP_SAIL)).toBe(REJECT_HELI_BEACHHEAD_FULL);
    expect(launchWithShip(SHIP_LAND)).toBe(REJECT_HELI_BEACHHEAD_FULL);
  });

  it('a returning or a docked ship wants no row: LaunchHeli is accepted', () => {
    expect(launchWithShip(SHIP_RETURN)).toBe(REJECT_NONE);
    expect(launchWithShip(SHIP_OFF)).toBe(REJECT_NONE);
  });
});
