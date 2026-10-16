// Fix-3A1 (audit 2): holes in the tests of the effects cache, Housing regeneration, win scoring and match clock, and district boundaries.
// Every test reads through the ordinary public path (no helper that forces effDirty). The mutants each test kills are in DECISIONS.md (Fix-3A1).
import { describe, expect, it } from 'vitest';
import { applyBuildDistrict, applyRemoveDistrict, applyUpgradeDistrict } from '../../src/sim/districts';
import { DISTRICT_BARRACKS, DISTRICT_HOUSING, DISTRICT_MARKET, DISTRICT_WALLS, districtEffect } from '../../src/sim/districtRules';
import { ownerCapQt } from '../../src/sim/economy';
import { REJECT_DELETE_COOLDOWN, REJECT_DISTRICT_CITY_BUILDING, REJECT_NONE, withId } from '../../src/sim/intents';
import { WIN_REASON_LAST, WIN_REASON_NONE, WIN_REASON_SCORE, type WinConfig } from '../../src/sim/matchState';
import { DISTRICT_BUILD_TICKS, MILLI_GOLD_PER_GOLD, QT_PER_TROOP, SCORE_CITY_LEVEL_POINTS, SCORE_FACTORY_LEVEL_POINTS, SPAWN_PHASE_TICKS, WEIGHT_ONE } from '../../src/sim/rules';
import { deserialize, serialize } from '../../src/sim/serialize';
import { createState, type GameState } from '../../src/sim/state';
import { step } from '../../src/sim/step';
import { barracksPctOf, collectWalls, structGoldMilliPerSec, wallAdjustedCost } from '../../src/sim/structureEffects';
import { STRUCT_CITY, STRUCT_FACTORY } from '../../src/sim/structureRules';
import { setOwner } from '../../src/sim/territory';
import { CLASS_PLAINS } from '../../src/sim/terrain';
import { fillScores, landStdOf } from '../../src/sim/win';

const GOLD = MILLI_GOLD_PER_GOLD;

// ---------------------------------------------------------------------------------------------------------------------------------------
// A wide strip (one cell per seat, structures finished at tick 5000) for the effects cache, Housing and district boundary tests.
const SW = 1024;
const SH = 64;
const at = (x: number, y = 32): number => y * SW + x;
function strip(): GameState {
  const s = createState({ width: SW, height: SH, seed: 5, seats: 2, terrain: new Uint8Array(SW * SH).fill(CLASS_PLAINS), elevation: new Uint16Array(SW * SH) });
  setOwner(s, at(1), 1, 0);
  setOwner(s, at(2), 2, 0);
  s.tick = 5000;
  return s;
}
function city(s: GameState, x: number, level = 6): number {
  const id = s.structures.add(STRUCT_CITY, 1, at(x), 0);
  s.structures.level[id] = level;
  return id;
}
const idle = (s: GameState, n: number): void => {
  for (let i = 0; i < n; i++) expect(step(s, { turn: s.tick, intents: [] }).ok).toBe(true);
};
/** The three derived effects the cache feeds, read through the public getters only. */
const eff = (s: GameState): { gold: number; cap: number; barracks: number } => ({ gold: structGoldMilliPerSec(s, 1), cap: ownerCapQt(s, 1), barracks: barracksPctOf(s, 1) });

describe('the effects cache is invalidated by RemoveDistrict and by a finished district upgrade (no forced effDirty)', () => {
  const KINDS: Array<[string, number, keyof ReturnType<typeof eff>]> = [
    ['Market', DISTRICT_MARKET, 'gold'],
    ['Housing', DISTRICT_HOUSING, 'cap'],
    ['Barracks', DISTRICT_BARRACKS, 'barracks'],
  ];
  for (const [name, kind, field] of KINDS) {
    it(`${name}: removing a finished district through a step lowers the effect at once`, () => {
      const s = strip();
      const id = city(s, 100);
      const before = eff(s); // fills the cache of the City alone
      s.structures.setDistrict(id, 0, kind, 3, 1000, 0);
      const with3 = eff(s);
      expect(with3[field]).toBeGreaterThan(before[field]);
      // the removal goes through the intent path; the effect must be read from the cache the removal had to invalidate
      const r = step(s, { turn: s.tick, intents: [withId({ kind: 'RemoveDistrict', seat: 0, structure: id, slot: 0 }, 1)] });
      expect(r.ok).toBe(true);
      expect(s.structures.districtKind[id * 5]).toBe(0);
      expect(eff(s)[field]).toBe(before[field]);
    });
    it(`${name}: a district upgrade that finishes through step() raises the effect to the next level without any other change`, () => {
      const s = strip();
      const id = city(s, 100);
      s.structures.setDistrict(id, 0, kind, 1, 1000, 0);
      s.gold[1] = 100000 * GOLD;
      const l1 = eff(s);
      expect(applyUpgradeDistrict(s, 0, id, 0)).toBe(REJECT_NONE);
      idle(s, (DISTRICT_BUILD_TICKS[kind] as number) + 2);
      expect(s.structures.districtLevel[id * 5]).toBe(2);
      const l2 = eff(s);
      expect(l2[field]).toBeGreaterThan(l1[field]);
      // and it equals what a fresh build of a level 2 district gives
      const fresh = strip();
      const fid = city(fresh, 100);
      fresh.structures.setDistrict(fid, 0, kind, 2, 1000, 0);
      expect(l2[field]).toBe(eff(fresh)[field]);
    });
  }
});

describe('Housing raises the cap the regeneration grows towards', () => {
  it('troops sitting at the old cap grow past it with a level 3 Housing and do not without', () => {
    const plain = strip();
    city(plain, 100);
    const housed = strip();
    const hid = city(housed, 100);
    housed.structures.setDistrict(hid, 0, DISTRICT_HOUSING, 3, 1000, 0);
    const oldCap = ownerCapQt(plain, 1);
    const newCap = ownerCapQt(housed, 1);
    expect(newCap - oldCap).toBe(districtEffect(DISTRICT_HOUSING, 3).capTroops * QT_PER_TROOP);
    for (const s of [plain, housed]) {
      s.troops[1] = oldCap;
      s.troopFrac[1] = 0;
      idle(s, 100);
    }
    expect(housed.troops[1] as number).toBeGreaterThan(oldCap + QT_PER_TROOP);
    expect(housed.troops[1] as number).toBeLessThanOrEqual(newCap);
    expect(plain.troops[1] as number).toBeLessThanOrEqual(oldCap);
    // a full house keeps its troops at the raised cap (a lower cap in the regeneration would make them decay)
    housed.troops[1] = newCap;
    housed.troopFrac[1] = 0;
    idle(housed, 100);
    expect(housed.troops[1] as number).toBeGreaterThanOrEqual(newCap - 1);
  });
});

describe('district boundaries at the exact tick', () => {
  it('BuildDistrict is refused one tick before the City is finished and accepted on the ready tick', () => {
    const s = strip();
    const id = city(s, 100, 3);
    s.structures.readyTick[id] = 6000;
    s.gold[1] = 100000 * GOLD;
    s.tick = 5999;
    expect(applyBuildDistrict(s, 0, id, 0, DISTRICT_MARKET)).toBe(REJECT_DISTRICT_CITY_BUILDING);
    s.tick = 6000;
    expect(applyBuildDistrict(s, 0, id, 0, DISTRICT_MARKET)).toBe(REJECT_NONE);
  });
  it('RemoveDistrict is refused one tick before the Delete cooldown ends and accepted when it ends', () => {
    const s = strip();
    const id = city(s, 100, 6);
    s.structures.setDistrict(id, 0, DISTRICT_MARKET, 1, 1000, 0);
    s.structures.deleteReady[1] = 5100;
    s.tick = 5099;
    expect(applyRemoveDistrict(s, 0, id, 0)).toBe(REJECT_DELETE_COOLDOWN);
    s.tick = 5100;
    expect(applyRemoveDistrict(s, 0, id, 0)).toBe(REJECT_NONE);
  });
  it('a district that is ready exactly on the tick of the conquest is kept (one level lower), one tick short is lost', () => {
    for (const [tick, kept] of [[1000, true], [999, false]] as const) {
      const s = strip();
      const id = city(s, 100, 6);
      s.structures.setDistrict(id, 0, DISTRICT_MARKET, 4, 1000, 0);
      s.structures.conquerDistricts(id, 2, 5, tick);
      expect(s.structures.districtKind[id * 5] !== 0, `tick ${tick}`).toBe(kept);
    }
  });
  it('two overlapping Walls: the largest percent applies, not the last one found and not the sum', () => {
    const s = strip();
    const a = city(s, 100, 6); // the lower id gets the stronger Walls
    const b = city(s, 102, 6);
    s.structures.setDistrict(a, 0, DISTRICT_WALLS, 3, 1000, 0);
    s.structures.setDistrict(b, 0, DISTRICT_WALLS, 1, 1000, 0);
    const p3 = districtEffect(DISTRICT_WALLS, 3).wallsCostPct;
    const p1 = districtEffect(DISTRICT_WALLS, 1).wallsCostPct;
    expect(p3).toBeGreaterThan(p1);
    expect(collectWalls(s, 1)).toBe(2);
    const cell = at(101); // within the radius of both Cities
    expect(wallAdjustedCost(s.structures, SW, cell, 100000)).toBe(Math.floor((100000 * p3) / 100));
    // the order of the table does not matter: swapping the levels gives the same largest percent
    s.structures.districtLevel[a * 5] = 1;
    s.structures.districtLevel[b * 5] = 3;
    collectWalls(s, 1);
    expect(wallAdjustedCost(s.structures, SW, cell, 100000)).toBe(Math.floor((100000 * p3) / 100));
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------
// Win rules on the 20 x 20 uniform world of win.test.ts.
const W = 20;
const H = 20;
const CELLS = W * H;
const only = (k: 'land' | 'last' | 'score', extra: Partial<WinConfig> = {}): WinConfig => ({ land: false, last: false, score: false, timeLimitTicks: 1000, landSharePct: 60, holdTicks: 300, ...extra, [k]: true });
function world(seats: number, players: number, win: WinConfig, flow = false): GameState {
  return createState({
    width: W,
    height: H,
    seed: 5,
    seats,
    players,
    rowCos: new Uint16Array(H).fill(WEIGHT_ONE),
    config: { debugIntents: true, spawnPhase: flow, win },
    terrain: new Uint8Array(CELLS).fill(CLASS_PLAINS),
    elevation: new Uint16Array(CELLS),
  });
}
const paint = (s: GameState, owner: number, from: number, to: number): void => {
  for (let c = from; c < to; c++) setOwner(s, c, owner, 0);
};

describe('win rules: score per structure LEVEL, draw, hold restart, hold pick, match clock', () => {
  it('score = land + 25 per City level + 10 per Factory level (levels above 1 count, not a flat value)', () => {
    expect([SCORE_CITY_LEVEL_POINTS, SCORE_FACTORY_LEVEL_POINTS]).toEqual([25, 10]);
    const s = world(2, 2, only('score'));
    paint(s, 1, 0, 100);
    paint(s, 2, 200, 300);
    const c = s.structures.add(STRUCT_CITY, 1, 5, 0);
    s.structures.level[c] = 40; // Sim-Levels2: levels go on far past 10
    const f = s.structures.add(STRUCT_FACTORY, 1, 60, 0);
    s.structures.level[f] = 3;
    const unfinished = s.structures.add(STRUCT_CITY, 1, 61, 0); // not finished yet: no points
    s.structures.level[unfinished] = 9;
    s.structures.readyTick[unfinished] = 9999;
    s.tick = 5000;
    const out = new Uint32Array(3);
    fillScores(s, out);
    expect(out[1]).toBe(landStdOf(s, 1) + 25 * 40 + 10 * 3);
    expect(out[2]).toBe(landStdOf(s, 2));
  });

  it('everybody eliminated in the same tick is a draw (ended, winner 0, reason NONE) and the snapshot still loads', () => {
    const s = world(2, 2, only('last'));
    paint(s, 1, 0, 50);
    paint(s, 2, 200, 250);
    idle(s, 2);
    expect(s.match.ended).toBe(0);
    paint(s, 0, 0, CELLS);
    idle(s, 1);
    expect([s.match.ended, s.match.winner, s.match.reason]).toEqual([1, 0, WIN_REASON_NONE]);
    expect(deserialize(serialize(s)).ok).toBe(true);
  });

  it('the last nation alive wins the tick the other is eliminated, with reason LAST and the winner set', () => {
    const s = world(2, 2, only('last'));
    paint(s, 1, 0, 50);
    paint(s, 2, 200, 250);
    idle(s, 2);
    paint(s, 1, 200, 250);
    idle(s, 1);
    expect([s.match.ended, s.match.winner, s.match.reason]).toEqual([1, 1, WIN_REASON_LAST]);
  });

  it('when the holder drops out and another nation qualifies in the same tick the hold count restarts at 1', () => {
    const s = world(3, 3, only('land', { landSharePct: 30, holdTicks: 100 }));
    paint(s, 1, 0, 120);
    idle(s, 50);
    expect([s.match.holdOwner, s.match.holdCount]).toEqual([1, 50]);
    paint(s, 0, 10, 120);
    paint(s, 2, 200, 320);
    idle(s, 1);
    expect([s.match.holdOwner, s.match.holdCount]).toEqual([2, 1]);
  });

  it('with no holder and two nations above the share the larger one becomes the holder', () => {
    const s = world(3, 3, only('land', { landSharePct: 30, holdTicks: 100 }));
    paint(s, 1, 0, 130);
    paint(s, 2, 130, 330);
    idle(s, 1);
    expect(s.match.holdOwner).toBe(2);
  });

  it('the match clock starts after the spawn phase: a last-alive end that is true AT the first play tick waits one tick', () => {
    const s = world(2, 2, only('last'), true);
    paint(s, 1, 0, 50);
    paint(s, 2, 200, 250);
    s.tick = SPAWN_PHASE_TICKS - 2;
    idle(s, 1); // peak land of both is recorded
    paint(s, 0, 200, 250);
    idle(s, 1); // state.tick === SPAWN_PHASE_TICKS: the seat is flagged eliminated, but the rules do not run yet
    expect(s.tick).toBe(SPAWN_PHASE_TICKS);
    expect(s.match.eliminated[2]).toBe(1);
    expect(s.match.ended).toBe(0);
    idle(s, 1);
    expect([s.match.ended, s.match.winner, s.match.endTick]).toEqual([1, 1, SPAWN_PHASE_TICKS + 1]);
  });

  it('the score condition decides at exactly timeLimitTicks of play after the spawn phase', () => {
    const s = world(2, 2, only('score', { timeLimitTicks: 30 }), true);
    paint(s, 1, 0, 60);
    paint(s, 2, 200, 230);
    s.tick = SPAWN_PHASE_TICKS;
    idle(s, 29);
    expect(s.match.ended).toBe(0);
    idle(s, 1);
    expect([s.match.ended, s.match.winner, s.match.reason, s.match.endTick]).toEqual([1, 1, WIN_REASON_SCORE, SPAWN_PHASE_TICKS + 30]);
  });
});
