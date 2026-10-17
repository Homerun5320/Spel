// M14a: the missile table, the launch counters and the fallout layer as game state: hashed, serialised (FORMAT 18) and guarded in deserialize like the ship and helicopter tables. Every guard
// has a forged blob and a control run (the unpatched blob loads), so a guard that is removed fails here. A save in the middle of a flight continues exactly like a straight run.
import { describe, expect, it } from 'vitest';
import { launchMissileBody, withId } from '../../src/sim/intents';
import { MISSILE_CAPACITY, MISSILE_COOLDOWN_TICKS, MISSILE_MAX_FLIGHT_TICKS, FALLOUT_TICKS, STRUCT_CAPACITY } from '../../src/sim/rules';
import { MISSILE_TACTICAL } from '../../src/sim/missileTable';
import { FORMAT_VERSION, deserialize, hashState, serialize, serializedLengthOf } from '../../src/sim/serialize';
import { ENGINE_VERSION, type GameState } from '../../src/sim/state';
import { step } from '../../src/sim/step';
import { STRUCT_SILO } from '../../src/sim/structureRules';
import { saveLayout } from '../helpers/saveLayout';
import { missileFixture } from '../../tools/sim/missiles';

const W = 1024;
const at = (x: number, y: number): number => y * W + x;
const SEATS = 2;
const SLOTS = SEATS + 1;

/** Two Tactical missiles in the air from two Silos, a launch counter of 2, and a patch of old fallout. */
function inFlight(): { s: GameState; silo2: number } {
  const fx = missileFixture('plain-cruise', 1);
  const s = fx.state;
  const silo2 = s.structures.add(STRUCT_SILO, 1, at(251, 250), 0);
  s.missiles.setFallout(at(100, 210), s.tick + 700);
  s.missiles.setFallout(at(101, 210), s.tick + 900);
  step(s, { turn: s.tick, intents: [withId(launchMissileBody(0, fx.silo, MISSILE_TACTICAL, fx.target), 1), withId(launchMissileBody(0, silo2, MISSILE_TACTICAL, fx.target + 1), 2)] });
  for (let i = 0; i < 9; i++) step(s, { turn: s.tick, intents: [] });
  expect(s.missiles.liveCount).toBe(2);
  return { s, silo2 };
}

const F = { id: 0, owner: 4, cls: 8, silo: 12, launchTick: 16, impactTick: 20, startCell: 24, targetCell: 28 } as const;
const REC = 32;

/** Offsets in a saved state without helicopters, beachheads and ships: the missile block ends where the air block starts. */
function layoutOf(bytes: Uint8Array, s: GameState): { countAt: number; rec: (k: number) => number; launchesAt: number; falloutCountAt: number; falloutAt: (k: number) => number } {
  const lay = saveLayout(bytes, SEATS);
  const m = s.missiles;
  const size = 4 + m.liveCount * REC + SLOTS * 3 * 4 + 4 + m.falloutCount * 8;
  const countAt = lay.emptyAirBlockAt(s.structures.liveCount, s.structures.districtCount) - size;
  const launchesAt = countAt + 4 + m.liveCount * REC;
  const falloutCountAt = launchesAt + SLOTS * 3 * 4;
  return { countAt, rec: (k) => countAt + 4 + k * REC, launchesAt, falloutCountAt, falloutAt: (k) => falloutCountAt + 4 + k * 8 };
}

function patched(bytes: Uint8Array, edits: Array<[number, number]>): Uint8Array {
  const out = bytes.slice();
  const v = new DataView(out.buffer);
  for (const [at0, val] of edits) v.setUint32(at0, val, true);
  return out;
}

describe('the missile table in the state', () => {
  it('ENGINE 27 and FORMAT 18', () => {
    expect(ENGINE_VERSION).toBe(27);
    expect(FORMAT_VERSION).toBe(18);
  });

  it('round trip: same rows, counters, fallout, hash and length; the derived counts are rebuilt', () => {
    const { s } = inFlight();
    const bytes = serialize(s);
    expect(bytes.length).toBe(serializedLengthOf(s));
    const r = deserialize(bytes);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const t = r.state.missiles;
    for (const f of ['owner', 'cls', 'silo', 'launchTick', 'impactTick', 'startCell', 'targetCell', 'launches'] as const) expect(Array.from(t[f]), f).toEqual(Array.from(s.missiles[f]));
    expect(Array.from(t.fallout)).toEqual(Array.from(s.missiles.fallout));
    expect([t.liveCount, t.falloutCount]).toEqual([2, 2]);
    expect(t.launchesOf(1, MISSILE_TACTICAL)).toBe(2);
    expect(hashState(r.state)).toBe(hashState(s));
  });

  it('a save in the middle of a flight continues exactly like a straight run (blast included)', () => {
    const a = inFlight().s;
    const b = deserialize(serialize(a));
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    for (let i = 0; i < 80; i++) {
      step(a, { turn: a.tick, intents: [] });
      step(b.state, { turn: b.state.tick, intents: [] });
    }
    expect(a.missiles.liveCount).toBe(0);
    expect(hashState(b.state)).toBe(hashState(a));
    const c = inFlight().s;
    for (let i = 0; i < 80; i++) step(c, { turn: c.tick, intents: [] });
    expect(hashState(c)).toBe(hashState(a));
  });

  it('every field of every live row, every launch counter and every fallout entry is in the hash; a free slot is not', () => {
    const { s } = inFlight();
    const h0 = hashState(s);
    const t = s.missiles;
    for (const f of ['owner', 'cls', 'silo', 'launchTick', 'impactTick', 'startCell', 'targetCell'] as const) {
      const old = t[f][0] as number;
      t[f][0] = f === 'owner' ? 2 : old + 1;
      expect(hashState(s), f).not.toBe(h0);
      t[f][0] = old;
    }
    expect(hashState(s)).toBe(h0);
    t.launches[3] = 5;
    expect(hashState(s), 'launches').not.toBe(h0);
    t.launches[3] = 2;
    const c = at(100, 210);
    t.fallout[c] = (t.fallout[c] as number) + 1;
    expect(hashState(s), 'fallout until').not.toBe(h0);
    t.fallout[c] = (t.fallout[c] as number) - 1;
    t.setFallout(at(102, 210), s.tick + 5);
    expect(hashState(s), 'a new fallout cell').not.toBe(h0);
    t.setFallout(at(102, 210), 0);
    expect(hashState(s)).toBe(h0);
    // a slot that is free does not count, whatever its stale fields say
    t.silo[40] = 77;
    expect(hashState(s)).toBe(h0);
  });
});

/** The error a forged blob gives. 'checksum' means every guard let it through (the patch broke only the checksum, which is checked last). */
function failOf(bytes: Uint8Array): string {
  const r = deserialize(bytes);
  return r.ok ? 'ok' : r.error;
}

describe('deserialize refuses a missile block that cannot be a real one (each with a control)', () => {
  const { s } = inFlight();
  const bytes = serialize(s);
  const L = layoutOf(bytes, s);

  it('the control: the unpatched blob loads', () => {
    expect(deserialize(bytes).ok).toBe(true);
    expect(L.countAt).toBeGreaterThan(0);
    expect(new DataView(bytes.buffer, bytes.byteOffset).getUint32(L.countAt, true)).toBe(2);
    expect(new DataView(bytes.buffer, bytes.byteOffset).getUint32(L.falloutCountAt, true)).toBe(2);
  });

  const now = s.tick;
  const cases: Array<[string, Array<[number, number]>]> = [
    ['a count beyond the capacity', [[L.countAt, MISSILE_CAPACITY + 1]]],
    ['ids not ascending', [[L.rec(1) + F.id, 0]]],
    ['an id beyond the table', [[L.rec(1) + F.id, MISSILE_CAPACITY]]],
    ['owner 0', [[L.rec(0) + F.owner, 0]]],
    ['an owner beyond the seats', [[L.rec(0) + F.owner, SEATS + 1]]],
    ['a class that does not exist', [[L.rec(0) + F.cls, 3]]],
    ['a Silo id beyond the structure table', [[L.rec(0) + F.silo, STRUCT_CAPACITY]]],
    ['a start cell off the map', [[L.rec(0) + F.startCell, 1024 * 512]]],
    ['a target cell off the map', [[L.rec(0) + F.targetCell, 1024 * 512]]],
    ['a launch in the future', [[L.rec(0) + F.launchTick, now + 1]]],
    ['a blast already past', [[L.rec(0) + F.impactTick, now - 1]]],
    ['a blast not after the launch', [[L.rec(0) + F.impactTick, s.missiles.launchTick[0] as number]]],
    // (now is 262 here, so a flight from tick 0 to now is 262 ticks, above MISSILE_MAX_FLIGHT_TICKS = 200, and the blast is not yet past)
    ['a flight longer than the longest real one', [[L.rec(0) + F.launchTick, 0], [L.rec(0) + F.impactTick, now]]],
    ['a launch counter beyond 16 bits', [[L.launchesAt + 4 * 3 + 0, 65536]]],
    ['fallout cells not ascending', [[L.falloutAt(1), at(100, 210)]]],
    ['a fallout cell off the map', [[L.falloutAt(1), 1024 * 512]]],
    ['a fallout entry that is zero', [[L.falloutAt(0) + 4, 0]]],
    ['fallout that lasts longer than FALLOUT_TICKS from now', [[L.falloutAt(0) + 4, now + FALLOUT_TICKS + 1]]],
    ['a fallout count beyond the map', [[L.falloutCountAt, 1024 * 512 + 1]]],
  ];
  for (const [name, edits] of cases) {
    it(`refuses ${name}`, () => {
      expect(failOf(patched(bytes, edits))).toBe('air-range');
    });
  }

  it('accepts the limits (a flight of exactly MISSILE_MAX_FLIGHT_TICKS ending now, fallout lasting exactly FALLOUT_TICKS from now)', () => {
    const ok = patched(bytes, [[L.rec(0) + F.launchTick, now - 5], [L.rec(0) + F.impactTick, now - 5 + MISSILE_MAX_FLIGHT_TICKS], [L.falloutAt(0) + 4, now + FALLOUT_TICKS]]);
    expect(failOf(ok), 'every guard lets the limits through').toBe('checksum');
  });

  it('the Silo cooldown word: a Silo may carry up to MISSILE_COOLDOWN_TICKS ahead of now, a City nothing', () => {
    const structAt = saveLayout(bytes, SEATS).structureRecordsAt(s.structures.liveCount, s.structures.districtCount);
    // the record of structure k is 36 bytes: id type owner cell level buildTick readyTick upgradeReadyTick salvoTick
    let siloRec = -1;
    let cityRec = -1;
    let k = 0;
    for (let id = 0; id < s.structures.highWater; id++) {
      if (s.structures.owner[id] === 0) continue;
      if (s.structures.type[id] === STRUCT_SILO && siloRec < 0) siloRec = structAt + k * 36;
      if (s.structures.type[id] === 1 && cityRec < 0) cityRec = structAt + k * 36;
      k++;
    }
    expect(siloRec).toBeGreaterThan(0);
    expect(failOf(patched(bytes, [[siloRec + 32, now + MISSILE_COOLDOWN_TICKS]]))).toBe('checksum');
    expect(failOf(patched(bytes, [[siloRec + 32, now + MISSILE_COOLDOWN_TICKS + 1]]))).toBe('structure-range');
    expect(cityRec).toBeGreaterThan(0);
    expect(failOf(patched(bytes, [[cityRec + 32, now + 1]]))).toBe('structure-range');
  });
});
