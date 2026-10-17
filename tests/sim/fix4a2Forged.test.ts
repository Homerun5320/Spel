// Fix-4A2 (audit 3, findings 0.3, 0.4, 0.5): one test per guard of the air block and the diplomacy block of deserialize. A forged blob is a valid one with ONE
// field patched to the first illegal value (a byte patch: the guard answers before the checksum is read, so the control run of the neighbouring LEGAL value
// answers 'checksum' and the guard's own error proves that exactly this guard refused it). The cross checks (embargo flags, eliminated seats) tamper the
// in-memory state and serialise it, so the checksum is valid and only the guard can refuse it.
import { describe, expect, it } from 'vitest';
import { airLayout, diploLayout, saveLayout } from '../helpers/saveLayout';
import { RELATION_ALLIANCE, RELATION_TRUCE, TREATY_ALLIANCE, TREATY_TRUCE } from '../../src/sim/diplomacyTable';
import { HELI_BUILDING, HELI_CRUISE, HELI_DOWNED, HELI_LIFT, HELI_PAD } from '../../src/sim/heliTable';
import { BEACHHEAD_CAPACITY, BUILD_TICKS, HELI_BUILD_TICKS, HELI_CAPACITY, HELI_FUEL_MAX_Q8, HELI_HP_TENTHS, HELI_MAX_TROOPS, HELI_ROUTE_CAPACITY, PROPOSAL_CAPACITY, PROPOSAL_TTL_TICKS, STRUCT_CAPACITY, TECH_FX_CAP, TRUCE_TICKS, TREATY_BREAK_COOLDOWN_TICKS } from '../../src/sim/rules';
import { deserialize, serialize } from '../../src/sim/serialize';
import { createState, rebuildAggregates, type GameState } from '../../src/sim/state';
import { STRUCT_CITY, STRUCT_FACTORY } from '../../src/sim/structureRules';
import { CLASS_PLAINS } from '../../src/sim/terrain';

/** The largest load and tank a helicopter can have in a match where its owner has researched every AIR tech (M18d-1). */
const TECH_LOAD_MAX = HELI_MAX_TROOPS + Math.floor((HELI_MAX_TROOPS * (TECH_FX_CAP[5] as number)) / 100);
const TECH_FUEL_MAX = HELI_FUEL_MAX_Q8 + Math.floor((HELI_FUEL_MAX_Q8 * (TECH_FX_CAP[7] as number)) / 100);
const W = 64;
const H = 32;
const CELLS = W * H;
const SEATS = 4; // ownerIds 1..3 are players, 4 is a tribe
const PLAYERS = 3;
const TICK = 1000;
const at = (x: number, y: number): number => y * W + x;

/** A state with everything the two blocks can hold: four helicopters in four states and a hole, two beachheads, a truce, an alliance, two embargoes, two proposals, a cooldown. */
function full(): GameState {
  const terrain = new Uint8Array(CELLS).fill(CLASS_PLAINS);
  const s = createState({ width: W, height: H, seed: 5, seats: SEATS, players: PLAYERS, config: { debugIntents: true }, terrain, elevation: new Uint16Array(CELLS) });
  for (let c = 0; c < CELLS; c++) s.owner[c] = c % W < 20 ? 1 : c % W < 40 ? 2 : c % W < 60 ? 3 : 0;
  rebuildAggregates(s);
  s.tick = TICK;
  const f1 = s.structures.add(STRUCT_FACTORY, 1, at(2, 2), 0);
  s.structures.add(STRUCT_FACTORY, 2, at(25, 2), 0);
  s.structures.add(STRUCT_CITY, 1, at(5, 5), 0);
  const h = s.helis;
  const pad = h.addBuilding(1, f1, 800, 920);
  h.state[pad] = HELI_PAD;
  h.addBuilding(1, f1, 990, 990 + HELI_BUILD_TICKS);
  const c = h.addBuilding(2, 0, 950, 700);
  h.state[c] = HELI_CRUISE;
  h.x[c] = at(30, 10) * 0 + 30 * 256 + 128;
  h.y[c] = 10 * 256 + 128;
  h.alt[c] = 100;
  h.hp[c] = 800;
  h.load[c] = 100;
  h.fuel[c] = 20000;
  h.mode[c] = 1;
  h.target[c] = at(50, 20) + 1;
  h.routeLen[c] = 2;
  h.routeIdx[c] = 1;
  h.route[c * HELI_ROUTE_CAPACITY] = at(31, 10);
  h.route[c * HELI_ROUTE_CAPACITY + 1] = at(50, 20);
  const d = h.addBuilding(3, 0, 980, 0);
  h.state[d] = HELI_DOWNED;
  h.x[d] = 45 * 256 + 128;
  h.y[d] = 8 * 256 + 128;
  const hole = h.addBuilding(1, f1, 1, 2);
  h.remove(hole);
  s.beachheads.add(1, at(5, 5), 900, 1);
  s.beachheads.add(2, at(30, 5), 800, 2);
  const df = s.diplo;
  df.setRelation(1, 2, RELATION_TRUCE, TICK + 2000);
  df.setRelation(2, 3, RELATION_ALLIANCE, 0);
  df.embargoBy[1 * df.slots + 3] = 1;
  df.embargoBy[3 * df.slots + 1] = 1;
  s.structures.setEmbargo(1, 3, true);
  df.cooldownUntil[2] = TICK + 100;
  df.addProposal(1, 3, TREATY_ALLIANCE, TICK + 500);
  df.addProposal(2, 1, TREATY_TRUCE, TICK + 400);
  s.match.setTechMask(2, 0xf << 8); // Fix-5A2: owner 2 (the helicopter at index 2) has the four AIR techs, so its load and fuel may reach the researched maximum
  s.match.treatiesMade[1] = 2;
  s.match.treatiesBroken[2] = 1;
  return s;
}

const MAXELEV = new Int16Array(CELLS);
function load(bytes: Uint8Array, withLayer = true): string {
  const r = deserialize(bytes, withLayer ? { maxElev: MAXELEV } : undefined);
  return r.ok ? 'ok' : r.error;
}

const BASE = full();
const BYTES = serialize(BASE);
const AIR = airLayout(BASE, BYTES, SEATS);
const DIPLO = diploLayout(BYTES, SEATS);

/** [name, position, value, signed]: the field patched to the first illegal value, and the error that guard answers with. */
type Patch = readonly [name: string, at: number, value: number, signed?: boolean];

function patched(p: Patch): string {
  const b = BYTES.slice();
  const v = new DataView(b.buffer);
  if (p[3] === true) v.setInt32(p[1], p[2], true);
  else v.setUint32(p[1], p[2], true);
  return load(b);
}

/** The records: k = 0 PAD (owner 1), 1 BUILDING (owner 1), 2 CRUISE (owner 2), 3 DOWNED (owner 3). */
const HR = (k: number, off: number): number => AIR.heliAt(k) + off;
const BR = (k: number, off: number): number => AIR.beachAt(k) + off;

describe('the untouched blob loads, and one byte more or less does not (controls)', () => {
  it('the control blob loads with the occluder layer and the layout helper finds what it should', () => {
    expect(load(BYTES)).toBe('ok');
    const v = new DataView(BYTES.buffer);
    expect(v.getUint32(AIR.highWaterAt, true)).toBe(5);
    expect(v.getUint32(AIR.recycledCountAt, true)).toBe(1);
    expect(v.getUint32(AIR.liveCountAt, true)).toBe(4);
    expect([v.getUint32(HR(0, 8), true), v.getUint32(HR(1, 8), true), v.getUint32(HR(2, 8), true), v.getUint32(HR(3, 8), true)]).toEqual([HELI_PAD, HELI_BUILDING, HELI_CRUISE, HELI_DOWNED]);
    expect(v.getUint32(AIR.beachCountAt, true)).toBe(2);
    expect(v.getUint32(BR(1, 16), true)).toBe(2);
    expect(v.getUint32(DIPLO.pairCountAt, true)).toBe(2);
    expect(v.getUint32(DIPLO.embargoCountAt, true)).toBe(2);
    expect(v.getUint32(DIPLO.propCountAt, true)).toBe(2);
    expect(v.getUint32(DIPLO.lengthAt, true)).toBe(saveLayout(BYTES, SEATS).diploBytes);
    expect(v.getUint32(DIPLO.cooldownAt(2), true)).toBe(TICK + 100);
  });
  it('the legal edge values pass every range guard and fail only the checksum', () => {
    const edges: Patch[] = [
      ['stateTick = tick', HR(2, 20), TICK],
      ['readyTick = tick + build time', HR(2, 16), TICK + HELI_BUILD_TICKS],
      ['landTick = tick', BR(0, 12), TICK],
      ['target = cells', HR(2, 52), CELLS],
      ['routeIdx = routeLen', HR(2, 60), 2],
      ['hp = max', HR(2, 36), HELI_HP_TENTHS],
      ['load = max', HR(2, 40), HELI_MAX_TROOPS],
      ['fuel = max', HR(2, 44), HELI_FUEL_MAX_Q8],
      ['load = max with every AIR tech (M18d-1)', HR(2, 40), TECH_LOAD_MAX],
      ['fuel = tank with every AIR tech (M18d-1)', HR(2, 44), TECH_FUEL_MAX],
      ['alt = 65535', HR(2, 32), 65535, true],
      ['truce end = tick', DIPLO.pairAt(0) + 12, TICK],
      ['truce end = tick + TRUCE_TICKS', DIPLO.pairAt(0) + 12, TICK + TRUCE_TICKS],
      ['cooldown = tick + cooldown', DIPLO.cooldownAt(2), TICK + TREATY_BREAK_COOLDOWN_TICKS],
      ['proposal expire = tick', DIPLO.propAt(0) + 12, TICK],
      ['proposal expire = tick + ttl', DIPLO.propAt(0) + 12, TICK + PROPOSAL_TTL_TICKS],
    ];
    for (const e of edges) expect(patched(e), e[0]).toBe('checksum');
  });
});

describe('the air block: every guard refuses its own first illegal value (air-range)', () => {
  const PATCHES: Patch[] = [
    ['highWater above the table', AIR.highWaterAt, HELI_CAPACITY + 1],
    ['recycledCount above highWater', AIR.recycledCountAt, 6],
    ['a recycled id at highWater', AIR.recycledAt(0), 5],
    ['a recycled id that is alive', AIR.recycledAt(0), 0],
    ['live + recycled differ from highWater', AIR.highWaterAt, 6],
    ['live count that does not fill the table', AIR.liveCountAt, 5],
    ['an id that does not ascend', HR(1, 0), 0],
    ['an id at highWater', HR(3, 0), 5],
    ['owner 0', HR(2, 4), 0],
    ['owner above the seats', HR(2, 4), SEATS + 1],
    ['state 0', HR(2, 8), 0],
    ['state above the last', HR(2, 8), 10],
    ['factory at the structure capacity', HR(2, 12), STRUCT_CAPACITY],
    ['x below 0', HR(2, 24), -1, true],
    ['x at the world edge', HR(2, 24), W * 256, true],
    ['y below 0', HR(2, 28), -1, true],
    ['y at the world edge', HR(2, 28), H * 256, true],
    ['altitude below 0', HR(2, 32), -1, true],
    ['altitude above 65535', HR(2, 32), 65536, true],
    ['hp above the maximum', HR(2, 36), HELI_HP_TENTHS + 1],
    ['load above the maximum', HR(2, 40), TECH_LOAD_MAX + 1], // M18d-1: the AIR techs lift the maximum by TECH_FX_CAP percent (750)
    ['fuel above the tank', HR(2, 44), TECH_FUEL_MAX + 1], // M18d-1: and the tank (57600)
    ['mode 2', HR(2, 48), 2],
    ['target above the cells', HR(2, 52), CELLS + 1],
    ['route longer than the capacity', HR(2, 56), HELI_ROUTE_CAPACITY + 1],
    ['route index past the route', HR(2, 60), 3],
    ['a queued helicopter with the wrong ready tick', HR(1, 16), 990 + HELI_BUILD_TICKS + 1],
    ['a state entered in the future', HR(2, 20), TICK + 1],
    ['a ready tick beyond one production time ahead', HR(2, 16), TICK + HELI_BUILD_TICKS + 1],
    ['a route cell outside the world', AIR.routeAt(2, 1), CELLS],
    ['a parked helicopter at a Factory of another owner', HR(0, 12), 1],
    ['a parked helicopter at a structure that is no Factory', HR(0, 12), 2],
    ['a queued helicopter at a Factory of another owner', HR(1, 12), 1],
    ['beachhead count above the capacity', AIR.beachCountAt, BEACHHEAD_CAPACITY + 1],
    ['a beachhead index that does not ascend', BR(1, 0), 0],
    ['a beachhead index at the capacity', BR(1, 0), BEACHHEAD_CAPACITY],
    ['a beachhead of owner 0', BR(0, 4), 0],
    ['a beachhead of an owner above the seats', BR(0, 4), SEATS + 1],
    ['a beachhead seed outside the world', BR(0, 8), CELLS],
    ['a landing in the future', BR(0, 12), TICK + 1],
    ['beachhead status 0', BR(0, 16), 0],
    ['beachhead status above the last', BR(0, 16), 3],
  ];
  for (const p of PATCHES) {
    it(`${p[0]}`, () => {
      expect(patched(p)).toBe('air-range');
    });
  }

  it('a LIFT helicopter that entered its state in the future would overflow its altitude (the audit case)', () => {
    const b = BYTES.slice();
    const v = new DataView(b.buffer);
    v.setUint32(HR(2, 8), HELI_LIFT, true);
    v.setUint32(HR(2, 20), 4_000_000_000, true);
    expect(load(b)).toBe('air-range');
  });
});

describe('airborne helicopters need the occluder layer (no-occluders), the others do not', () => {
  it('a blob with a helicopter in the air is refused without maxElev, and loads with it', () => {
    expect(load(BYTES, false)).toBe('no-occluders');
    expect(load(BYTES, true)).toBe('ok');
  });
  it('each airborne state is enough on its own (LIFT .. RETURN)', () => {
    for (const st of [3, 4, 5, 6, 7, 8]) {
      const b = BYTES.slice();
      new DataView(b.buffer).setUint32(HR(2, 8), st, true);
      expect(load(b, false), `state ${st}`).toBe('no-occluders');
    }
  });
  it('parked, queued and downed helicopters load without it', () => {
    const s = full();
    s.helis.remove(2); // the only helicopter in the air
    const r = deserialize(serialize(s));
    expect(r.ok).toBe(true);
  });
});

describe('the diplomacy block: every guard refuses its own first illegal value (diplomacy-range)', () => {
  const P0 = DIPLO.pairAt(0);
  const P1 = DIPLO.pairAt(1);
  const PATCHES: Patch[] = [
    ['more pairs than the players can form', DIPLO.pairCountAt, (PLAYERS * (PLAYERS - 1)) / 2 + 1],
    ['a pair whose first player is 0', P0, 0],
    ['a pair whose players are equal', P0 + 4, 1],
    ['a pair with a second player above the players (a tribe)', P1 + 4, PLAYERS + 1],
    ['a relation 0 (war is not stored)', P1 + 8, 0],
    ['a relation above alliance', P1 + 8, 3],
    ['a truce that has already ended', P0 + 12, TICK - 1],
    ['a truce longer than the rules allow', P0 + 12, TICK + TRUCE_TICKS + 1],
    ['an alliance with an end tick', P1 + 12, 5],
    ['more embargoes than ordered pairs', DIPLO.embargoCountAt, PLAYERS * (PLAYERS - 1) + 1],
    ['a cooldown on the neutral owner', DIPLO.cooldownAt(0), 5],
    ['a cooldown on a tribe', DIPLO.cooldownAt(PLAYERS + 1), 5],
    ['a cooldown longer than the rules allow', DIPLO.cooldownAt(2), TICK + TREATY_BREAK_COOLDOWN_TICKS + 1],
    ['more proposals than the table holds', DIPLO.propCountAt, PROPOSAL_CAPACITY + 1],
    ['a proposal from owner 0', DIPLO.propAt(0), 0],
    ['a proposal from a tribe', DIPLO.propAt(0), PLAYERS + 1],
    ['a proposal to owner 0', DIPLO.propAt(0) + 4, 0],
    ['a proposal to a tribe', DIPLO.propAt(0) + 4, PLAYERS + 1],
    ['a proposal to oneself', DIPLO.propAt(0) + 4, 1],
    ['a proposal of kind 0', DIPLO.propAt(0) + 8, 0],
    ['a proposal of kind 3', DIPLO.propAt(0) + 8, 3],
    ['a proposal that has already run out', DIPLO.propAt(0) + 12, TICK - 1],
    ['a proposal that lives longer than the rules allow', DIPLO.propAt(0) + 12, TICK + PROPOSAL_TTL_TICKS + 1],
    ['treaties made on the neutral owner', DIPLO.madeAt(0), 1],
    ['treaties broken on the neutral owner', DIPLO.brokenAt(0), 1],
  ];
  for (const p of PATCHES) {
    it(`${p[0]}`, () => {
      expect(patched(p)).toBe('diplomacy-range');
    });
  }
  const twoWords = (edits: ReadonlyArray<readonly [number, number]>): string => {
    const b = BYTES.slice();
    for (const [pos, val] of edits) new DataView(b.buffer).setUint32(pos, val, true);
    return load(b);
  };
  it('pairs that repeat or do not ascend', () => {
    expect(twoWords([[P0, 2], [P0 + 4, 3]]), 'the same pair twice').toBe('diplomacy-range');
    expect(twoWords([[P0, 2], [P0 + 4, 3], [P1, 1], [P1 + 4, 2]]), 'a descending pair').toBe('diplomacy-range');
    expect(twoWords([[P0, 1], [P0 + 4, 2]]), 'control: the pair as it was').toBe('ok');
  });
  it('the same directed proposal twice', () => {
    expect(twoWords([[DIPLO.propAt(1), 1], [DIPLO.propAt(1) + 4, 3]])).toBe('diplomacy-range');
    expect(twoWords([[DIPLO.propAt(1), 1], [DIPLO.propAt(1) + 4, 2]]), 'control: another receiver').toBe('checksum');
  });
  it('embargo records that do not ascend (the same set of embargoes, written the other way round)', () => {
    expect(twoWords([[DIPLO.embargoAt(0), 3], [DIPLO.embargoAt(0) + 4, 1], [DIPLO.embargoAt(1), 1], [DIPLO.embargoAt(1) + 4, 3]])).toBe('diplomacy-range');
    expect(twoWords([[DIPLO.embargoAt(1), 1], [DIPLO.embargoAt(1) + 4, 3]]), 'a repeated record').toBe('diplomacy-range');
  });
  it('the length word closing the block is part of the layout: a wrong one is a size error', () => {
    const own = saveLayout(BYTES, SEATS).diploBytes;
    expect(twoWords([[DIPLO.lengthAt, own + 4]])).toBe('size');
    expect(twoWords([[DIPLO.lengthAt, own - 4]])).toBe('size');
  });
});

describe('the cross checks (an in-memory tamper, so the checksum is valid and only the guard can refuse)', () => {
  const forged = (edit: (s: GameState) => void): string => {
    const s = full();
    edit(s);
    return load(serialize(s));
  };
  it('control: the untampered state loads', () => {
    expect(forged(() => undefined)).toBe('ok');
  });
  it('a trade flag without an imposer, and an imposer without the trade flag (diplomacy-range)', () => {
    expect(forged((s) => s.structures.setEmbargo(2, 3, true))).toBe('diplomacy-range');
    expect(forged((s) => void (s.diplo.embargoBy[3 * s.diplo.slots + 2] = 1))).toBe('diplomacy-range');
    expect(forged((s) => void (s.diplo.embargoBy[2 * s.diplo.slots + 3] = 1))).toBe('diplomacy-range');
    expect(forged((s) => s.structures.setEmbargo(1, 3, false))).toBe('diplomacy-range');
  });
  it('an embargo by either side keeps the flag (the flag is the OR of both directions)', () => {
    expect(forged((s) => void (s.diplo.embargoBy[3 * s.diplo.slots + 1] = 0))).toBe('ok');
    expect(forged((s) => void (s.diplo.embargoBy[1 * s.diplo.slots + 3] = 0))).toBe('ok');
  });

  /** Seat 3 with nothing: no land, no helicopter, no treaty, no embargo, no proposal. */
  function bare3(s: GameState): void {
    for (let c = 0; c < CELLS; c++) if (s.owner[c] === 3) s.owner[c] = 0;
    rebuildAggregates(s);
    s.helis.remove(3);
    const d = s.diplo;
    d.setRelation(2, 3, 0, 0);
    d.embargoBy[1 * d.slots + 3] = 0;
    d.embargoBy[3 * d.slots + 1] = 0;
    s.structures.setEmbargo(1, 3, false);
    d.removeProposalAt(0);
  }
  it('control: an eliminated seat with nothing left loads', () => {
    expect(forged((s) => {
      bare3(s);
      s.match.eliminated[3] = 1;
    })).toBe('ok');
  });
  it('an embargo record naming a seat that cannot hold one (both tables agree, so only the record guard can refuse it)', () => {
    const embargo = (by: number, on: number): string =>
      forged((s) => {
        s.diplo.embargoBy[by * s.diplo.slots + on] = 1;
        s.structures.embargo[by * s.diplo.slots + on] = 1;
        s.structures.embargo[on * s.diplo.slots + by] = 1;
      });
    expect(embargo(2, 3), 'control: a legal embargo').toBe('ok');
    expect(embargo(0, 1), 'imposer 0').toBe('diplomacy-range');
    expect(embargo(PLAYERS + 1, 1), 'imposer is a tribe').toBe('diplomacy-range');
    expect(embargo(1, 0), 'target 0').toBe('diplomacy-range');
    expect(embargo(1, PLAYERS + 1), 'target is a tribe').toBe('diplomacy-range');
    expect(embargo(2, 2), 'oneself').toBe('diplomacy-range');
  });
  it('an eliminated seat with land, a helicopter, a treaty, an embargo or a proposal is refused (match-range), each on its own', () => {
    const elim = (extra: (s: GameState) => void): string =>
      forged((s) => {
        bare3(s);
        s.match.eliminated[3] = 1;
        extra(s);
      });
    expect(elim((s) => {
      s.owner[at(61, 0)] = 3;
      rebuildAggregates(s);
    }), 'land').toBe('match-range');
    expect(elim((s) => {
      const id = s.helis.addBuilding(3, 0, 980, 0);
      s.helis.state[id] = HELI_DOWNED;
    }), 'helicopter').toBe('match-range');
    expect(elim((s) => s.diplo.setRelation(2, 3, RELATION_ALLIANCE, 0)), 'alliance').toBe('match-range');
    expect(elim((s) => s.diplo.setRelation(1, 3, RELATION_TRUCE, TICK + 100)), 'truce with a lower number').toBe('match-range');
    expect(elim((s) => {
      s.diplo.embargoBy[3 * s.diplo.slots + 2] = 1;
      s.structures.setEmbargo(3, 2, true);
    }), 'embargo by the seat').toBe('match-range');
    expect(elim((s) => {
      s.diplo.embargoBy[2 * s.diplo.slots + 3] = 1;
      s.structures.setEmbargo(2, 3, true);
    }), 'embargo on the seat').toBe('match-range');
    expect(elim((s) => s.diplo.addProposal(3, 2, TREATY_TRUCE, TICK + 100)), 'proposal from the seat').toBe('match-range');
    expect(elim((s) => s.diplo.addProposal(2, 3, TREATY_TRUCE, TICK + 100)), 'proposal to the seat').toBe('match-range');
  });
});

describe('guards that only a very small or a very full table can reach', () => {
  it('a recycled count that does not fit the bytes that are left is refused, not read past the end (a seat-1 world has no room for 64 ids)', () => {
    const terrain = new Uint8Array(64).fill(CLASS_PLAINS);
    const t = createState({ width: 8, height: 8, seed: 1, seats: 1, players: 1, config: { debugIntents: true }, terrain, elevation: new Uint16Array(64) });
    const bytes = serialize(t);
    const lay = airLayout(t, bytes, 1);
    const b = bytes.slice();
    const v = new DataView(b.buffer);
    v.setUint32(lay.highWaterAt, HELI_CAPACITY, true);
    v.setUint32(lay.recycledCountAt, HELI_CAPACITY, true);
    const r = deserialize(b);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('air-range');
  });

  it('a table of 65 helicopters is refused even when the bytes for all of them are there', () => {
    const terrain = new Uint8Array(CELLS).fill(CLASS_PLAINS);
    const t = createState({ width: W, height: H, seed: 5, seats: 2, players: 2, config: { debugIntents: true }, terrain, elevation: new Uint16Array(CELLS) });
    for (let c = 0; c < CELLS; c++) t.owner[c] = 1;
    rebuildAggregates(t);
    t.tick = TICK;
    for (let i = 0; i < HELI_CAPACITY; i++) {
      const id = t.helis.addBuilding(1, 0, 10, 0);
      t.helis.state[id] = HELI_DOWNED;
    }
    const bytes = serialize(t);
    expect(load(bytes, false), 'control: a full table loads').toBe('ok');
    const lay = airLayout(t, bytes, 2);
    const last = lay.heliAt(HELI_CAPACITY - 1);
    const forged = new Uint8Array(bytes.length + 64);
    forged.set(bytes.subarray(0, last + 64), 0);
    forged.set(bytes.subarray(last, last + 64), last + 64); // a copy of the last record ...
    forged.set(bytes.subarray(last + 64), last + 128);
    const v = new DataView(forged.buffer);
    v.setUint32(last + 64, HELI_CAPACITY, true); // ... as id 64
    v.setUint32(lay.highWaterAt, HELI_CAPACITY + 1, true);
    v.setUint32(lay.liveCountAt, HELI_CAPACITY + 1, true);
    expect(load(forged, false)).toBe('air-range');
  });
});
