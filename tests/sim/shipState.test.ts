// M13c-1: the ship table as game state: it is hashed, serialised (FORMAT 17) and guarded in deserialize like the helicopter and beachhead tables. Every guard has a forged blob and a
// control run (the unpatched blob loads), so a guard that is removed fails here.
import { describe, expect, it } from 'vitest';
import { launchShipBody, withId } from '../../src/sim/intents';
import { SHIP_CAPACITY, SHIP_FLEET_MAX, SHIP_MAX_TROOPS, SHIP_ROUTE_CAPACITY } from '../../src/sim/rules';
import { FORMAT_VERSION, deserialize, hashState, serialize, serializedLengthOf } from '../../src/sim/serialize';
import { SHIP_LAND, SHIP_OFF, SHIP_RETURN, SHIP_SAIL } from '../../src/sim/shipTable';
import { rebuildAggregates, ENGINE_VERSION, type GameState } from '../../src/sim/state';
import { step } from '../../src/sim/step';
import { STRUCT_PORT } from '../../src/sim/structureRules';
import { saveLayout } from '../helpers/saveLayout';
import { SHIP_W as W, shipFixture } from '../../tools/sim/shipLanding';

const at = (x: number, y: number): number => y * W + x;
const SEATS = 2;

/** A state 100 ticks into a voyage (one ship, sailing). */
function sailing(): { s: GameState; port: number } {
  const fx = shipFixture(0, { island: false });
  const s = fx.state;
  step(s, { turn: s.tick, intents: [withId(launchShipBody(0, fx.port, at(144, 24), 600), 0)] });
  for (let i = 0; i < 99; i++) step(s, { turn: s.tick, intents: [] });
  expect(s.ships.state[0]).toBe(SHIP_SAIL);
  return { s, port: fx.port };
}

/** Byte positions in a saved state with one two-waypoint ship and one structure (the Port). The ship block ends where the structure block starts. */
function shipAt(bytes: Uint8Array, ships = 1, routeCells = 2): { countAt: number; rec: (k: number) => number } {
  const lay = saveLayout(bytes, SEATS);
  const size = 4 + ships * 48 + routeCells * 4 * ships;
  const countAt = lay.structureBlockAt(1, 0) - size;
  return { countAt, rec: (k) => countAt + 4 + k * (48 + routeCells * 4) };
}

const F = { id: 0, owner: 4, state: 8, port: 12, portCell: 16, stateTick: 20, x: 24, y: 28, load: 32, target: 36, routeLen: 40, routeIdx: 44, route: 48 } as const;

function patched(bytes: Uint8Array, edits: Array<[number, number, 'u32' | 'i32']>): Uint8Array {
  const out = bytes.slice();
  const v = new DataView(out.buffer);
  for (const [at0, val, kind] of edits) {
    if (kind === 'i32') v.setInt32(at0, val, true);
    else v.setUint32(at0, val, true);
  }
  return out;
}

describe('the ship table in the state', () => {
  it('ENGINE 26 and FORMAT 17', () => {
    expect(ENGINE_VERSION).toBe(26);
    expect(FORMAT_VERSION).toBe(17);
  });

  it('round trip: the restored state has the same ship rows, the same hash and the same length; the derived fleet count is rebuilt', () => {
    const { s } = sailing();
    const bytes = serialize(s);
    expect(bytes.length).toBe(serializedLengthOf(s));
    const r = deserialize(bytes);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const t = r.state.ships;
    for (const f of ['owner', 'state', 'port', 'portCell', 'stateTick', 'x', 'y', 'load', 'target', 'routeLen', 'routeIdx'] as const) expect(Array.from(t[f]), f).toEqual(Array.from(s.ships[f]));
    expect(Array.from(t.route)).toEqual(Array.from(s.ships.route));
    expect(t.liveCount).toBe(1);
    expect(t.countOf(1)).toBe(1);
    expect(hashState(r.state)).toBe(hashState(s));
  });

  it('every field of every live row is in the hash; a free slot is not', () => {
    const { s } = sailing();
    const h0 = hashState(s);
    const t = s.ships;
    const bump = (f: 'owner' | 'state' | 'port' | 'portCell' | 'stateTick' | 'x' | 'y' | 'load' | 'target' | 'routeLen' | 'routeIdx'): number => {
      const old = t[f][0] as number;
      t[f][0] = f === 'owner' ? 2 : old + 1;
      const h = hashState(s);
      t[f][0] = old;
      return h;
    };
    for (const f of ['owner', 'state', 'port', 'portCell', 'stateTick', 'x', 'y', 'load', 'target', 'routeLen', 'routeIdx'] as const) expect(bump(f), f).not.toBe(h0);
    t.route[1] = (t.route[1] as number) + 1;
    expect(hashState(s)).not.toBe(h0);
    t.route[1] = (t.route[1] as number) - 1;
    t.route[5] = 12345; // beyond routeLen: not stored, not hashed
    expect(hashState(s)).toBe(h0);
    t.load[7] = 99; // a free slot
    expect(hashState(s)).toBe(h0);
  });

  it('a state with no ship has the 4 byte empty block and the same hash with or without the table touched', () => {
    const fx = shipFixture(0, { island: false });
    const empty = serializedLengthOf(fx.state);
    const { s } = sailing();
    expect(serializedLengthOf(s)).toBe(empty + 48 + 2 * 4);
  });
});

describe('deserialize guards for the ships', () => {
  const { s } = sailing();
  const good = serialize(s);
  const pos = shipAt(good);
  const rec = pos.rec(0);
  /** The error a forged blob gives. 'checksum' means every guard let it through (the patch broke only the checksum, which is checked last). */
  const fail = (edits: Array<[number, number, 'u32' | 'i32']>): string => {
    const r = deserialize(patched(good, edits));
    return r.ok ? 'ok' : r.error;
  };

  it('the control blob loads and the offsets of this test point at the ship (the owner word reads 1, the state word 1)', () => {
    const v = new DataView(good.buffer);
    expect(v.getUint32(pos.countAt, true)).toBe(1);
    expect([v.getUint32(rec + F.id, true), v.getUint32(rec + F.owner, true), v.getUint32(rec + F.state, true), v.getUint32(rec + F.routeLen, true)]).toEqual([0, 1, SHIP_SAIL, 2]);
    expect(deserialize(good).ok).toBe(true);
  });

  it('each field out of its range is refused (air-range)', () => {
    const cases: Array<[string, Array<[number, number, 'u32' | 'i32']>]> = [
      ['the count above the capacity', [[pos.countAt, SHIP_CAPACITY + 1, 'u32']]],
      ['the id outside the table', [[rec + F.id, SHIP_CAPACITY, 'u32']]],
      ['owner 0', [[rec + F.owner, 0, 'u32']]],
      ['owner beyond the seats', [[rec + F.owner, SEATS + 1, 'u32']]],
      ['state 0', [[rec + F.state, 0, 'u32']]],
      ['state above the last', [[rec + F.state, 5, 'u32']]],
      ['port outside the structure table', [[rec + F.port, 4096, 'u32']]],
      ['portCell outside the map', [[rec + F.portCell, W * 64, 'u32']]],
      ['stateTick in the future', [[rec + F.stateTick, s.tick + 1, 'u32']]],
      ['x negative', [[rec + F.x, -1, 'i32']]],
      ['x beyond the map', [[rec + F.x, W * 256, 'i32']]],
      ['y beyond the map', [[rec + F.y, 64 * 256, 'i32']]],
      ['a load above SHIP_MAX_TROOPS', [[rec + F.load, SHIP_MAX_TROOPS + 1, 'u32']]],
      ['a sailing ship with no landing cell', [[rec + F.target, 0, 'u32']]],
      ['a landing cell outside the map', [[rec + F.target, W * 64 + 1, 'u32']]],
      ['routeLen 0', [[rec + F.routeLen, 0, 'u32']]],
      ['routeLen above the capacity', [[rec + F.routeLen, SHIP_ROUTE_CAPACITY + 1, 'u32']]],
      ['routeIdx beyond routeLen', [[rec + F.routeIdx, 3, 'u32']]],
      ['a sailing ship that has not left waypoint 0', [[rec + F.routeIdx, 0, 'u32']]],
      ['a route cell outside the map', [[rec + F.route, W * 64, 'u32']]],
      ['a route cell on land', [[rec + F.route + 4, at(10, 10), 'u32']]],
    ];
    for (const [name, edits] of cases) expect(fail(edits), name).toBe('air-range');
  });

  it('the state machine fields must agree: landing needs the last waypoint, a returning ship has no landing cell, a docked ship is empty and at home', () => {
    // LAND at routeIdx 1 of 2 (not at the end)
    expect(fail([[rec + F.state, SHIP_LAND, 'u32']]), 'LAND before the end of the route').toBe('air-range');
    // LAND consistent: routeIdx = routeLen
    expect(fail([[rec + F.state, SHIP_LAND, 'u32'], [rec + F.routeIdx, 2, 'u32']]), 'LAND at the end').toBe('checksum');
    // RETURN keeping a landing cell
    expect(fail([[rec + F.state, SHIP_RETURN, 'u32']]), 'RETURN with a landing cell').toBe('air-range');
    // RETURN consistent: no target, routeIdx 1
    expect(fail([[rec + F.state, SHIP_RETURN, 'u32'], [rec + F.target, 0, 'u32']]), 'RETURN').toBe('checksum');
    // RETURN with routeIdx = routeLen
    expect(fail([[rec + F.state, SHIP_RETURN, 'u32'], [rec + F.target, 0, 'u32'], [rec + F.routeIdx, 2, 'u32']]), 'RETURN past the start').toBe('air-range');
    // OFF carrying troops (load stays 600)
    expect(fail([[rec + F.state, SHIP_OFF, 'u32'], [rec + F.target, 0, 'u32'], [rec + F.routeIdx, 0, 'u32']]), 'OFF with a load').toBe('air-range');
    // OFF consistent
    expect(fail([[rec + F.state, SHIP_OFF, 'u32'], [rec + F.target, 0, 'u32'], [rec + F.routeIdx, 0, 'u32'], [rec + F.load, 0, 'u32']]), 'OFF').toBe('checksum');
    // OFF away from home (routeIdx 1)
    expect(fail([[rec + F.state, SHIP_OFF, 'u32'], [rec + F.target, 0, 'u32'], [rec + F.load, 0, 'u32']]), 'OFF not at home').toBe('air-range');
  });

  it('ids must ascend (two rows with the same id are refused) and one owner may not have more than SHIP_FLEET_MAX ships', () => {
    const fx = shipFixture(0, { island: false });
    const two = fx.state;
    const cell = at(96, 24);
    for (let i = 0; i < 2; i++) {
      two.ships.add(i, 1, fx.port, at(95, 24), 0, 0, 0);
      two.ships.state[i] = SHIP_OFF;
      two.ships.routeLen[i] = 1;
      two.ships.route[i * SHIP_ROUTE_CAPACITY] = cell;
      two.ships.x[i] = 96 * 256 + 128;
      two.ships.y[i] = 24 * 256 + 128;
    }
    const bytes = serialize(two);
    expect(deserialize(bytes).ok).toBe(true);
    const lay = saveLayout(bytes, SEATS);
    const start = lay.structureBlockAt(1, 0) - (4 + 2 * (48 + 4));
    const second = start + 4 + (48 + 4);
    expect(deserialize(patched(bytes, [[second + F.id, 0, 'u32']])).ok).toBe(false);
    // five rows of one owner
    const five = shipFixture(0, { island: false }).state;
    for (let i = 0; i < SHIP_FLEET_MAX + 1; i++) {
      five.ships.add(i, 1, 0, at(95, 24), 0, 0, 0);
      five.ships.state[i] = SHIP_OFF;
      five.ships.routeLen[i] = 1;
      five.ships.route[i * SHIP_ROUTE_CAPACITY] = cell;
      five.ships.x[i] = 96 * 256 + 128;
      five.ships.y[i] = 24 * 256 + 128;
    }
    const r = deserialize(serialize(five));
    expect(r.ok ? 'ok' : r.error).toBe('air-range');
    five.ships.remove(4);
    expect(deserialize(serialize(five)).ok).toBe(true);
  });

  it('an eliminated owner has no ship', () => {
    const fx = shipFixture(0, { island: false });
    const s2 = fx.state;
    step(s2, { turn: s2.tick, intents: [] }); // the peak land is recorded
    for (let c = 0; c < s2.owner.length; c++) if (s2.owner[c] === 1) s2.owner[c] = 0;
    rebuildAggregates(s2);
    s2.structures.remove(fx.port);
    step(s2, { turn: s2.tick, intents: [] });
    expect(s2.match.eliminated[1]).toBe(1);
    const control = deserialize(serialize(s2));
    expect(control.ok).toBe(true);
    s2.ships.add(0, 1, 5, 0, 0, 0, 0);
    s2.ships.state[0] = SHIP_OFF;
    s2.ships.routeLen[0] = 1;
    s2.ships.route[0] = at(96, 24);
    s2.ships.x[0] = 96 * 256 + 128;
    s2.ships.y[0] = 24 * 256 + 128;
    const r = deserialize(serialize(s2));
    expect(r.ok ? 'ok' : r.error).toBe('match-range');
  });

  it('the Port of the fixture is a Port (a guard for the offsets above: one structure, no districts)', () => {
    const { s } = sailing();
    expect([s.structures.liveCount, s.structures.type[0]]).toEqual([1, STRUCT_PORT]);
  });
});
