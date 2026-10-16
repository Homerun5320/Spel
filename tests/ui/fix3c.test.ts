// Fix-3C (audit 2, mutation lens): the pure UI view-models that had holes. Each test changes ONE input and expects the outcome; the mutants
// they kill are tabled in docs/DECISIONS.md "Fix-3C".
import { describe, expect, it } from 'vitest';
import { DISTRICT_BARRACKS, DISTRICT_BUILD_TICKS, DISTRICT_HOUSING, DISTRICT_MARKET, DISTRICT_MAX_SLOTS, districtIndex, maxLevelOf } from '../../src/sim/public';
import { applyBuildDistrict } from '../../src/sim/districts';
import { PHASE_IMMUNITY, PHASE_PLAY, PHASE_SPAWN } from '../../src/sim/flow';
import { MATCH_HEADER_WORDS, MATCH_SEAT_FIELDS, matchPackedLength, matchViewOf } from '../../src/sim/matchView';
import { BARRACKS_REGEN_PCT_MAX, MILLI_GOLD_PER_GOLD, WIN_HOLD_TICKS } from '../../src/sim/rules';
import { createState, type GameState } from '../../src/sim/state';
import { STRUCT_CITY } from '../../src/sim/structureRules';
import { setOwner } from '../../src/sim/territory';
import { CLASS_PLAINS } from '../../src/sim/terrain';
import { StateView } from '../../src/sim/view';
import { spawnPhaseBlocks } from '../../src/ui/buildReasons';
import { CITY_SIG_MAX, cityTotals, citySignature } from '../../src/ui/cityViewModel';
import { MatchWatcher, resultRows } from '../../src/ui/matchFlow';

const W = 256;
const H = 32;
const at = (x: number, y = 16): number => y * W + x;

function world(): GameState {
  const s = createState({ width: W, height: H, seed: 3, seats: 2, terrain: new Uint8Array(W * H).fill(CLASS_PLAINS), elevation: new Uint16Array(W * H) });
  for (let o = 1; o <= 2; o++) setOwner(s, at(o), o, 0);
  s.tick = 5000;
  s.gold[1] = 100000 * MILLI_GOLD_PER_GOLD;
  return s;
}
function city(s: GameState, x: number, level: number): number {
  const id = s.structures.add(STRUCT_CITY, 1, at(x), 0);
  s.structures.level[id] = level;
  s.structures.readyTick[id] = 0;
  s.structures.effDirty = true;
  return id;
}
/** Put a district straight into the tables (no intent): `readyIn` ticks of building left, `upgradeIn` ticks of upgrade left (0 = none). */
function setDistrict(s: GameState, id: number, slot: number, kind: number, level: number, readyIn: number, upgradeIn = 0): void {
  const d = s.structures;
  const i = districtIndex(id, slot);
  d.districtKind[i] = kind;
  d.districtLevel[i] = level;
  d.districtReadyTick[i] = readyIn === 0 ? 0 : s.tick + readyIn;
  d.districtUpgradeReadyTick[i] = upgradeIn === 0 ? 0 : s.tick + upgradeIn;
  s.structures.effDirty = true;
}
const sigOf = (s: GameState, id: number): number[] => {
  const out = new Int32Array(CITY_SIG_MAX);
  const n = citySignature(new StateView(s), 0, id, out);
  return Array.from(out.subarray(0, n));
};

describe('citySignature: one field at a time (the panel only rebuilds on a changed signature)', () => {
  it('the kind of a district alone changes the signature (two buildings with equal progress)', () => {
    const s = world();
    const id = city(s, 100, 3);
    setDistrict(s, id, 0, DISTRICT_HOUSING, 1, DISTRICT_BUILD_TICKS[DISTRICT_HOUSING] as number);
    const a = sigOf(s, id);
    setDistrict(s, id, 0, DISTRICT_BARRACKS, 1, DISTRICT_BUILD_TICKS[DISTRICT_BARRACKS] as number);
    expect(sigOf(s, id)).not.toEqual(a);
  });

  it('the level of a district alone changes it (a building does not count in the totals, so only the level field can tell)', () => {
    const s = world();
    const id = city(s, 100, 3);
    const total = DISTRICT_BUILD_TICKS[DISTRICT_HOUSING] as number;
    setDistrict(s, id, 0, DISTRICT_HOUSING, 1, total);
    const a = sigOf(s, id);
    setDistrict(s, id, 0, DISTRICT_HOUSING, 2, total);
    expect(sigOf(s, id)).not.toEqual(a);
  });

  it('the state (building against upgrading) changes it', () => {
    const s = world();
    const id = city(s, 100, 3);
    const total = DISTRICT_BUILD_TICKS[DISTRICT_HOUSING] as number;
    setDistrict(s, id, 0, DISTRICT_HOUSING, 1, total); // building, 0 percent
    const a = sigOf(s, id);
    setDistrict(s, id, 0, DISTRICT_HOUSING, 1, 0, total); // finished, upgrade running, 0 percent
    expect(sigOf(s, id)).not.toEqual(a);
  });

  it('the progress percent alone changes it', () => {
    const s = world();
    const id = city(s, 100, 3);
    const total = DISTRICT_BUILD_TICKS[DISTRICT_HOUSING] as number;
    setDistrict(s, id, 0, DISTRICT_HOUSING, 1, total);
    const a = sigOf(s, id);
    setDistrict(s, id, 0, DISTRICT_HOUSING, 1, Math.floor(total / 2));
    expect(sigOf(s, id)).not.toEqual(a);
  });

  it('the Delete wait alone changes it', () => {
    const s = world();
    const id = city(s, 100, 3);
    const a = sigOf(s, id);
    s.structures.deleteReady[1] = s.tick + 600;
    expect(sigOf(s, id)).not.toEqual(a);
  });

  it('the price of an empty tile alone changes it (a Market elsewhere makes the next one dearer)', () => {
    const s = world();
    const id = city(s, 100, 3);
    const other = city(s, 140, 3);
    const a = sigOf(s, id);
    expect(applyBuildDistrict(s, 0, other, 0, DISTRICT_MARKET)).toBe(0);
    expect(sigOf(s, id)).not.toEqual(a);
  });
});

describe('cityTotals: the Barracks sum is capped like the sim does', () => {
  it('five finished Barracks at a high level show at most BARRACKS_REGEN_PCT_MAX percent', () => {
    const s = world();
    const id = city(s, 100, maxLevelOf(STRUCT_CITY));
    for (let slot = 0; slot < DISTRICT_MAX_SLOTS; slot++) setDistrict(s, id, slot, DISTRICT_BARRACKS, 999, 0);
    expect(cityTotals(new StateView(s), id).regenPct).toBe(BARRACKS_REGEN_PCT_MAX);
  });
});

describe('spawnPhaseBlocks', () => {
  it('blocks only in the spawn phase of a flow match', () => {
    expect(spawnPhaseBlocks({ flow: true, phase: PHASE_SPAWN })).toBe(true);
    expect(spawnPhaseBlocks({ flow: true, phase: PHASE_IMMUNITY })).toBe(false);
    expect(spawnPhaseBlocks({ flow: true, phase: PHASE_PLAY })).toBe(false);
    expect(spawnPhaseBlocks({ flow: false, phase: PHASE_SPAWN })).toBe(false);
    expect(spawnPhaseBlocks({ flow: false, phase: PHASE_PLAY })).toBe(false);
  });
});

function matchView(seat: Partial<Record<(typeof MATCH_SEAT_FIELDS)[number], number[]>>, winner1 = 0) {
  const seats = 4;
  const p = new Uint32Array(matchPackedLength(seats));
  p[0] = 1;
  p[1] = winner1;
  p[4] = 7;
  p[5] = 7200;
  p[6] = 60;
  p[7] = WIN_HOLD_TICKS;
  MATCH_SEAT_FIELDS.forEach((name, i) => {
    const values = seat[name] ?? [];
    for (let k = 0; k < seats; k++) p[MATCH_HEADER_WORDS + i * seats + k] = values[k] ?? 0;
  });
  return { m: matchViewOf(seats, p), p };
}
const nameOf = (s: number): string => `n${s}`;
const colorOf = (s: number): string => `c${s}`;

describe('resultRows', () => {
  it('the winner is first even when another seat has the higher score and the most land', () => {
    const { m } = matchView({ score: [10, 50, 30], landStd: [1, 90, 5] }, 1 /* seat 0 won */);
    const rows = resultRows(m, 3, 0, nameOf, colorOf, () => 0);
    expect(rows.map((r) => r.seat)).toEqual([0, 1, 2]);
    expect(rows[0]?.winner).toBe(true);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it('the others follow by falling score, then falling land, then the lower seat', () => {
    const { m } = matchView({ score: [10, 20, 30], landStd: [0, 0, 0] }, 1);
    expect(resultRows(m, 3, 0, nameOf, colorOf, () => 0).map((r) => r.seat)).toEqual([0, 2, 1]);
    const tie = matchView({ score: [0, 5, 5], landStd: [0, 1, 9] }, 1);
    expect(resultRows(tie.m, 3, 0, nameOf, colorOf, () => 0).map((r) => r.seat)).toEqual([0, 2, 1]);
  });
});

describe('MatchWatcher', () => {
  it('an eliminated nation is reported as eliminated only, also when its capital flag is on', () => {
    const w = new MatchWatcher();
    const a = matchView({});
    w.scan(a.m, 3, 0);
    a.p[MATCH_HEADER_WORDS + 2] = 1; // eliminated, seat 2
    a.p[MATCH_HEADER_WORDS + 4 + 2] = 1; // capital lost, seat 2
    const ev = w.scan(a.m, 3, 0);
    expect(ev?.eliminated).toEqual([2]);
    expect(ev?.capitalLost).toEqual([]);
  });

  it('a nation that was already reported eliminated is not reported again as capital lost when that flag turns on later', () => {
    const w = new MatchWatcher();
    const a = matchView({});
    w.scan(a.m, 3, 0);
    a.p[MATCH_HEADER_WORDS + 2] = 1;
    expect(w.scan(a.m, 3, 0)?.eliminated).toEqual([2]);
    a.p[MATCH_HEADER_WORDS + 4 + 2] = 1;
    expect(w.scan(a.m, 3, 0)).toBeNull();
  });
});
