// Fix-Sim: crafted blobs with a VALID checksum (forged through serialize on a tampered state) must be refused by deserialize, one test per
// guard of the structure block (Z01 to Z11 of the audit), and a legal full table must round trip. M24b / M26 resync depend on these guards.
import { describe, expect, it } from 'vitest';
import { BUILD_TICKS, STRUCT_CAPACITY, STRUCT_MAX_LEVEL } from '../../src/sim/rules';
import { deserialize, serialize } from '../../src/sim/serialize';
import { createState, type GameState } from '../../src/sim/state';
import { STRUCT_CITY, STRUCT_FACTORY, STRUCT_PORT } from '../../src/sim/structureRules';
import { setOwner } from '../../src/sim/territory';
import { CLASS_PLAINS } from '../../src/sim/terrain';

const W = 128;
const H = 64;

/** Seats 2 (ownerIds 1 and 2), three structures with ids 0, 1, 2 where id 1 has been deleted again: highWater 3, recycled [1]. */
function base(): GameState {
  const s = createState({ width: W, height: H, seed: 4, seats: 2, terrain: new Uint8Array(W * H).fill(CLASS_PLAINS), elevation: new Uint16Array(W * H) });
  for (let c = 0; c < W * H; c++) setOwner(s, c, 1, 0);
  s.structures.add(STRUCT_CITY, 1, 10, 0);
  s.structures.add(STRUCT_FACTORY, 1, 5000, 0);
  s.structures.add(STRUCT_PORT, 2, 7000, 0);
  s.structures.remove(1);
  s.tick = 1000;
  return s;
}

function refused(tamper: (s: GameState) => void, error = 'structure-range'): void {
  const s = base();
  expect(deserialize(serialize(s)).ok, 'the untampered state round trips').toBe(true);
  tamper(s);
  const r = deserialize(serialize(s));
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error).toBe(error);
}

describe('deserialize refuses a forged structure block', () => {
  it('Z01 an embargo byte above 1', () => refused((s) => (s.structures.embargo[1 * 3 + 2] = 2)));
  it('Z02 readyTick other than buildTick + the build time', () => refused((s) => (s.structures.readyTick[0] = (s.structures.readyTick[0] as number) + 1)));
  it('Z03 two structures on one cell', () => refused((s) => (s.structures.cell[2] = s.structures.cell[0] as number)));
  it('Z04 an upgrade running at the top level', () =>
    refused((s) => {
      s.structures.level[0] = STRUCT_MAX_LEVEL;
      s.structures.upgradeReadyTick[0] = 500;
    }));
  it('Z06 live + recycled does not add up to highWater', () => refused((s) => (s.structures.highWater = 4)));
  it('Z08 an owner one past the seats', () => refused((s) => (s.structures.owner[2] = 3)));
  it('Z09 a level above the maximum', () => refused((s) => (s.structures.level[0] = STRUCT_MAX_LEVEL + 1)));
  it('Z11 a recycled id beyond highWater', () => refused((s) => (s.structures.recycled[0] = 7)));
  it('a recycled id that is also alive', () => refused((s) => (s.structures.recycled[0] = 2)));
  it('a structure type of 0 or beyond the six', () => refused((s) => (s.structures.type[0] = 7)));

  it('Z10 a completely full table (highWater == capacity) is a legal state and round trips', () => {
    const s = createState({ width: 128, height: 64, seed: 4, seats: 2, terrain: new Uint8Array(128 * 64).fill(CLASS_PLAINS), elevation: new Uint16Array(128 * 64) });
    for (let c = 0; c < STRUCT_CAPACITY; c++) {
      setOwner(s, c, 1, 0);
      s.structures.add(STRUCT_CITY, 1, c, 0);
    }
    expect(s.structures.highWater).toBe(STRUCT_CAPACITY);
    expect(s.structures.liveCount).toBe(STRUCT_CAPACITY);
    const r = deserialize(serialize(s));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.structures.liveCount).toBe(STRUCT_CAPACITY);
    expect(BUILD_TICKS[STRUCT_CITY]).toBeGreaterThan(0);
  });
});
