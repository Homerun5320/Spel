// M14a: what a blast does (src/sim/missileBlast.ts, missilePhase.ts): the shape against the sphere, the cell changes, the buildings, the troop loss, the fallout, the Tactical missile that
// changes no owner, the treaty that a spill breaks, and the derived structures (aggregates, contact lengths, boundary index) that must still equal a rebuild afterwards. Worlds are the
// fixtures of tools/sim/missiles.ts (1024 x 512, an island of plains).
import { describe, expect, it } from 'vitest';
import { RELATION_ALLIANCE, RELATION_TRUCE, RELATION_WAR } from '../../src/sim/diplomacyTable';
import { attackBody, launchMissileBody, withId } from '../../src/sim/intents';
import { blastRows, blastSpans } from '../../src/sim/missileBlast';
import { blastAt, interceptPhase, missilePhase } from '../../src/sim/missilePhase';
import { MISSILE_FISSION, MISSILE_FUSION, MISSILE_TACTICAL } from '../../src/sim/missileTable';
import { previewBlast } from '../../src/sim/missileRules';
import { OUTBOX_MISSILE_BUILDING_DESTROYED, OUTBOX_MISSILE_DETONATED } from '../../src/sim/outbox';
import {
  FALLOUT_COST_PCT,
  FALLOUT_TICKS,
  MISSILE_OUTER_HIT_PCT,
  MISSILE_R_IN_KM,
  MISSILE_R_OUT_KM,
  MISSILE_TROOP_LOSS_CAP_PCT,
  MISSILE_TROOP_LOSS_FACTOR,
  QT_PER_TROOP,
  TREATY_BREAK_COOLDOWN_TICKS,
} from '../../src/sim/rules';
import { hashState } from '../../src/sim/serialize';
import { rebuildAggregates, type GameState } from '../../src/sim/state';
import { step } from '../../src/sim/step';
import { STRUCT_CITY, STRUCT_POST, STRUCT_SILO } from '../../src/sim/structureRules';
import { StateView } from '../../src/sim/view';
import { applyBuild } from '../../src/sim/structures';
import { REJECT_BUILD_FALLOUT } from '../../src/sim/intents';
import { missileFixture, type MissileFixture } from '../../tools/sim/missiles';

const W = 1024;
const H = 512;
const at = (x: number, y: number): number => y * W + x;

/** The area in km2 of the cells of the disc (the cell widths of the rows come with the spans), and the spherical cap of the same radius. */
function areas(row: number, rKm: number): { area: number; cap: number; cells: number; cellKm: number } {
  const rows = blastRows(W, H, 500, row, rKm);
  const sp = blastSpans();
  const ch = 20003.931 / H;
  let area = 0;
  let cells = 0;
  let cellKm = 0;
  for (let i = 0; i < rows; i++) {
    const half = sp[i * 3 + 1] as number;
    const cw = (sp[i * 3 + 2] as number) / 1000;
    const n = half >= W ? W : 2 * half + 1;
    area += n * cw * ch;
    cells += n;
    cellKm = Math.max(cellKm, cw, ch);
  }
  const R = 6371;
  return { area, cap: 2 * Math.PI * R * R * (1 - Math.cos(rKm / R)), cells, cellKm };
}

describe('the blast area against the spherical cap', () => {
  // Rows of the equator (255), 45 N (127) and 60 N (85) of the 512-row world.
  for (const [lat, row] of [['the equator', 255], ['45 N', 127], ['60 N', 85]] as const) {
    for (const [name, r] of [
      ['Fusion r_in', MISSILE_R_IN_KM[2] as number],
      ['Fusion r_out', MISSILE_R_OUT_KM[2] as number],
      ['Fission r_out', MISSILE_R_OUT_KM[1] as number],
    ] as const) {
      it(`${name} at ${lat}: within 1.5 percent (a disc of under 1000 cells: within one ring of cells)`, () => {
        const a = areas(row, r);
        if (a.cells >= 1000) {
          expect(Math.abs(a.area / a.cap - 1), `${a.cells} cells`).toBeLessThan(0.015);
        } else {
          const R = 6371;
          const cap = (x: number): number => 2 * Math.PI * R * R * (1 - Math.cos(x / R));
          expect(a.area).toBeGreaterThan(cap(r - a.cellKm));
          expect(a.area).toBeLessThan(cap(r + a.cellKm));
        }
      });
    }
  }

  it('the whole row once when a polar disc is wider than the world', () => {
    const rows = blastRows(W, H, 500, 18, 3000);
    const sp = blastSpans();
    let sawFull = false;
    for (let i = 0; i < rows; i++) if ((sp[i * 3 + 1] as number) === W) sawFull = true;
    expect(sawFull).toBe(true);
  });
});

/** All the derived structures against a rebuild from the owner array. */
function expectDerivedConsistent(s: GameState): void {
  const area = Array.from(s.agg.area);
  const warea = Array.from(s.agg.warea);
  const edges = Array.from(s.borders.edges);
  const diff = Array.from(s.borders.diff);
  rebuildAggregates(s);
  expect(Array.from(s.agg.area)).toEqual(area);
  expect(Array.from(s.agg.warea)).toEqual(warea);
  expect(Array.from(s.borders.edges)).toEqual(edges);
  expect(Array.from(s.borders.diff)).toEqual(diff);
}

/** Fires the fixture's missile and steps to the tick after the blast; returns the fixture and the blast tick. */
function fire(name: 'plain-cruise' | 'fusion-silo', seed = 1, mutate?: (fx: MissileFixture) => void): { fx: MissileFixture; blast: number } {
  const fx = missileFixture(name, seed);
  mutate?.(fx);
  const s = fx.state;
  step(s, { turn: s.tick, intents: [withId(launchMissileBody(0, fx.silo, fx.cls, fx.target), 1)] });
  const blast = s.missiles.impactTick[0] as number;
  while (s.tick <= blast) step(s, { turn: s.tick, intents: [] });
  return { fx, blast };
}

describe('a Fusion blast', () => {
  it('turns the inner disc neutral, keeps the cells outside it, and leaves the derived structures equal to a rebuild', () => {
    const { fx } = fire('fusion-silo');
    const s = fx.state;
    const pv = previewBlast(new StateView(missileFixture('fusion-silo', 1).state), fx.target, MISSILE_FUSION);
    // the east nation held x 300..459 of rows 200..299 = 16000 cells; the inner disc took pv.cells of them
    expect(pv.cells).toBeGreaterThan(900);
    expect(s.agg.area[2]).toBe(16000 - pv.cells);
    expect(s.owner[fx.target]).toBe(0);
    expect(s.owner[at(400 + 19, 250)]).toBe(2); // 19 cells east of the centre: outside the 704 km disc (18 cells)
    expect(s.owner[at(400 + 17, 250)]).toBe(0); // 17 cells: inside
    expectDerivedConsistent(s);
  });

  it('keeps the derived structures consistent while attacks are running through the blast', () => {
    const fx = missileFixture('fusion-silo', 3);
    const s = fx.state;
    s.troops[1] = 100000 * QT_PER_TROOP;
    step(s, { turn: s.tick, intents: [withId(attackBody(0, 2, 60), 1), withId(launchMissileBody(0, fx.silo, fx.cls, fx.target), 2)] });
    for (let i = 0; i < 120; i++) step(s, { turn: s.tick, intents: [] });
    expect(s.missiles.liveCount).toBe(0);
    expect(s.missiles.falloutCount).toBeGreaterThan(0);
    expectDerivedConsistent(s);
  });

  it('fallout ends exactly FALLOUT_TICKS after the blast; a Build on it is refused until then', () => {
    const { fx, blast } = fire('fusion-silo');
    const s = fx.state;
    const view = new StateView(s);
    const cell = at(405, 250);
    const until = s.missiles.fallout[cell] as number;
    expect(until).toBe(blast + FALLOUT_TICKS);
    // the cell is neutral land now; give it to seat 1 so that a Build is only refused for the fallout
    s.owner[cell] = 1;
    s.tick = until - 1;
    expect(view.falloutUntilAt(cell) > s.tick).toBe(true);
    s.gold[1] = 1e9;
    expect(applyBuild(s, 0, STRUCT_CITY, cell)).toBe(REJECT_BUILD_FALLOUT);
    s.tick = until;
    expect(view.falloutUntilAt(cell) > s.tick).toBe(false);
    expect(applyBuild(s, 0, STRUCT_CITY, cell)).not.toBe(REJECT_BUILD_FALLOUT);
  });

  it('a fallout cell costs FALLOUT_COST_PCT percent to conquer', () => {
    // The troops an attack pays per cell it takes, on the neutral land round the east nation (the island of the fixture), with and without fallout on the whole island.
    const perCell = (fallout: boolean): number => {
      const fx = missileFixture('fusion-silo', 1);
      const s = fx.state;
      if (fallout) for (let y = 150; y < 350; y++) for (let x = 60; x < 500; x++) s.missiles.setFallout(at(x, y), s.tick + 100000);
      s.troops[2] = 3000 * QT_PER_TROOP;
      const committed = 3000 * QT_PER_TROOP;
      step(s, { turn: s.tick, intents: [withId(attackBody(1, 0, 100), 1)] });
      for (let i = 0; i < 40; i++) step(s, { turn: s.tick, intents: [] });
      let n = 0;
      for (let y = 150; y < 350; y++) for (let x = 300; x < 500; x++) if (s.owner[at(x, y)] === 2) n++;
      n -= 100 * 160;
      const left = (s.attacks.list[0]?.troops as number | undefined) ?? 0;
      expect(n).toBeGreaterThan(20);
      return (committed - left) / n;
    };
    const ratio = perCell(true) / perCell(false);
    expect(ratio).toBeGreaterThan((FALLOUT_COST_PCT / 100) * 0.9);
    expect(ratio).toBeLessThan((FALLOUT_COST_PCT / 100) * 1.1);
  });

  it('destroys every building of the inner disc and about half of the ring, one level each', () => {
    const fx = missileFixture('fusion-silo', 1);
    const s = fx.state;
    const centre = fx.target;
    const cy = 250;
    // 60 Cities on a circle of 24 cells round the centre (level 3) and 10 in the inner disc
    const ring: number[] = [];
    const inner: number[] = [];
    for (let i = 0; i < 60; i++) {
      const a = (i * 2 * Math.PI) / 60;
      ring.push(s.structures.add(STRUCT_CITY, 2, at(400 + Math.round(24 * Math.cos(a)), cy + Math.round(24 * Math.sin(a))), 0)); // 24 cells = 940 km: between the radii
    }
    for (let i = 0; i < 10; i++) inner.push(s.structures.add(STRUCT_CITY, 2, at(392 + i, cy + 5), 0));
    for (const id of ring) s.structures.level[id] = 3;
    s.outbox.drain();
    blastAt(s, 1, 7, MISSILE_FUSION, centre, MISSILE_R_IN_KM[2] as number, MISSILE_R_OUT_KM[2] as number);
    for (const id of inner) expect(s.structures.owner[id], 'inner disc').toBe(0);
    const hit = ring.filter((id) => s.structures.level[id] === 2).length;
    const untouched = ring.filter((id) => s.structures.level[id] === 3).length;
    expect(hit + untouched, 'nothing in the ring is destroyed outright, nothing loses two levels').toBe(ring.length);
    expect(hit / ring.length).toBeGreaterThan((MISSILE_OUTER_HIT_PCT - 20) / 100);
    expect(hit / ring.length).toBeLessThan((MISSILE_OUTER_HIT_PCT + 20) / 100);
    const destroyed = s.outbox.drain().filter((e) => e.kind === OUTBOX_MISSILE_BUILDING_DESTROYED);
    expect(destroyed.length).toBeGreaterThanOrEqual(inner.length);
  });
});

describe('a Fission blast', () => {
  it('troop loss is min(60 percent, 3 x T x cellsHit / N) of the owner\'s troops, and never more than 60 percent', () => {
    const fx = missileFixture('fusion-silo', 1);
    const s = fx.state;
    const t0 = s.troops[2] as number;
    const n0 = s.agg.area[2] as number;
    const pv = previewBlast(new StateView(s), fx.target, MISSILE_FISSION);
    expect(pv.hitCells).toBeGreaterThan(500);
    blastAt(s, 1, 0, MISSILE_FISSION, fx.target, MISSILE_R_IN_KM[1] as number, MISSILE_R_OUT_KM[1] as number);
    expect([MISSILE_TROOP_LOSS_CAP_PCT, MISSILE_TROOP_LOSS_FACTOR]).toEqual([60, 3]);
    const want = Math.min(Math.floor((t0 * 60) / 100), Math.floor((3 * t0 * pv.hitCells) / n0)); // literals: the rule of the plan, not the constants under test
    expect(t0 - (s.troops[2] as number)).toBe(want);
    expect(want).toBeLessThan(Math.floor(t0 * 0.6)); // the share binds here
    expect(want).toBeGreaterThan(0);
  });

  it('a nation that is mostly inside the blast loses exactly 60 percent', () => {
    const fx = missileFixture('fusion-silo', 1);
    const s = fx.state;
    // a tiny nation: seat 1 (ownerId 2) keeps only 30 cells, all inside the Fission blast
    for (let c = 0; c < s.owner.length; c++) if (s.owner[c] === 2) s.owner[c] = 0;
    for (let i = 0; i < 30; i++) s.owner[at(400 + (i % 6), 250 + Math.floor(i / 6))] = 2;
    rebuildAggregates(s);
    const t0 = s.troops[2] as number;
    blastAt(s, 1, 0, MISSILE_FISSION, fx.target, MISSILE_R_IN_KM[1] as number, MISSILE_R_OUT_KM[1] as number);
    expect(t0 - (s.troops[2] as number)).toBe(Math.floor((t0 * 60) / 100));
    expect(s.troops[2]).toBeGreaterThan(0);
  });
});

describe('a Tactical missile', () => {
  it('destroys buildings in the small disc only: no owner changes, no fallout, no troop loss', () => {
    const { fx, blast } = fire('plain-cruise');
    const s = fx.state;
    expect(s.missiles.falloutCount).toBe(0);
    expect(s.agg.area[2]).toBe(100 * 60); // 300..359 x 200..299 untouched
    expect(s.owner[fx.target]).toBe(2);
    expect((s.troops[2] as number) / QT_PER_TROOP).toBeGreaterThanOrEqual(1000);
    expect(s.structures.owner[fx.buildings[0] as number], 'the City at the centre').toBe(0);
    expect(s.structures.owner[fx.buildings[1] as number], 'the Factory 2 cells away').toBe(0);
    expect(s.structures.owner[fx.buildings[3] as number], 'the Post 30 cells away').toBe(2);
    void blast;
  });

  it('does the same on a StateView: previewBlast says no cells, no hit cells', () => {
    const fx = missileFixture('plain-cruise', 1);
    const pv = previewBlast(new StateView(fx.state), fx.target, MISSILE_TACTICAL);
    expect(pv.cells).toBe(0);
    expect(pv.hitCells).toBe(0);
    expect(pv.buildingsDestroyed).toBe(2); // the City and the Factory
    expect(pv.owners).toBe(1);
  });

  it('a Silo is a building like any other', () => {
    const fx = missileFixture('plain-cruise', 1);
    const s = fx.state;
    const silo = s.structures.add(STRUCT_SILO, 2, fx.target + 1, 0);
    blastAt(s, 1, 0, MISSILE_TACTICAL, fx.target, MISSILE_R_IN_KM[0] as number, MISSILE_R_OUT_KM[0] as number);
    expect(s.structures.owner[silo]).toBe(0);
  });
});

describe('a blast on land of a nation the launcher has a treaty with', () => {
  it('breaks a truce (war, the break cooldown, a betrayal on the statistics)', () => {
    const fx = missileFixture('plain-cruise', 1);
    const s = fx.state;
    s.diplo.setRelation(1, 2, RELATION_TRUCE, s.tick + 100000);
    const broken = s.match.treatiesBroken[1] as number;
    blastAt(s, 1, 0, MISSILE_TACTICAL, fx.target, MISSILE_R_IN_KM[0] as number, MISSILE_R_OUT_KM[0] as number);
    expect(s.diplo.relationOf(1, 2)).toBe(RELATION_WAR);
    expect(s.diplo.cooldownUntil[1]).toBe(s.tick + TREATY_BREAK_COOLDOWN_TICKS);
    expect(s.match.treatiesBroken[1]).toBe(broken + 1);
  });

  it('only dishonours a federation (it cannot be broken)', () => {
    const fx = missileFixture('plain-cruise', 1);
    const s = fx.state;
    s.diplo.setRelation(1, 2, RELATION_ALLIANCE, 1);
    const broken = s.match.treatiesBroken[1] as number;
    blastAt(s, 1, 0, MISSILE_TACTICAL, fx.target, MISSILE_R_IN_KM[0] as number, MISSILE_R_OUT_KM[0] as number);
    expect(s.diplo.relationOf(1, 2)).toBe(RELATION_ALLIANCE);
    expect(s.match.treatiesBroken[1]).toBe(broken + 1);
  });

  it('no betrayal when at war, or when only the launcher\'s own land is hit', () => {
    const fx = missileFixture('plain-cruise', 1);
    const s = fx.state;
    blastAt(s, 1, 0, MISSILE_TACTICAL, fx.target, MISSILE_R_IN_KM[0] as number, MISSILE_R_OUT_KM[0] as number);
    expect(s.match.treatiesBroken[1]).toBe(0);
    s.diplo.setRelation(1, 2, RELATION_TRUCE, s.tick + 100000);
    blastAt(s, 1, 0, MISSILE_TACTICAL, at(200, 250), MISSILE_R_IN_KM[0] as number, MISSILE_R_OUT_KM[0] as number);
    expect(s.match.treatiesBroken[1]).toBe(0);
    expect(s.diplo.relationOf(1, 2)).toBe(RELATION_TRUCE);
  });
});

describe('the phase', () => {
  it('the SAM hook exists and does nothing in M14a (M14b fills it in; it must run before the blasts of the tick)', () => {
    const fx = missileFixture('plain-cruise', 1);
    const s = fx.state;
    s.missiles.add(0, 1, MISSILE_TACTICAL, fx.silo, s.tick, s.tick + 10, at(250, 250), fx.target);
    const h = hashState(s);
    interceptPhase(s);
    expect(hashState(s)).toBe(h);
    expect(s.outbox.length).toBe(0);
  });

  it('detonates in the tick of impact and not a tick before, announces the class and the centre, and frees the slot', () => {
    const fx = missileFixture('plain-cruise', 1);
    const s = fx.state;
    s.missiles.add(5, 1, MISSILE_TACTICAL, fx.silo, s.tick, s.tick + 3, at(250, 250), fx.target);
    for (let i = 0; i < 3; i++) {
      missilePhase(s);
      expect(s.outbox.drain().filter((e) => e.kind === OUTBOX_MISSILE_DETONATED)).toEqual([]);
      s.tick++;
    }
    missilePhase(s);
    expect(s.outbox.drain().filter((e) => e.kind === OUTBOX_MISSILE_DETONATED)).toEqual([{ kind: OUTBOX_MISSILE_DETONATED, tick: s.tick, a: MISSILE_TACTICAL, b: fx.target }]);
    expect(s.missiles.owner[5]).toBe(0);
    expect(s.missiles.liveCount).toBe(0);
  });

  it('a Post in the inner disc of a Tactical missile goes too', () => {
    const fx = missileFixture('plain-cruise', 1);
    const s = fx.state;
    const post = s.structures.add(STRUCT_POST, 2, fx.target - 1, 0);
    blastAt(s, 1, 0, MISSILE_TACTICAL, fx.target, MISSILE_R_IN_KM[0] as number, MISSILE_R_OUT_KM[0] as number);
    expect(s.structures.owner[post]).toBe(0);
  });
});
