// Fix-6A2: audit 5 mutation holes. Each test fails on the one-line mutant named in docs/DECISIONS.md (Fix-6A2).
import { describe, expect, it } from 'vitest';
import { RELATION_TRUCE, RELATION_WAR } from '../../src/sim/diplomacyTable';
import { REJECT_NONE, launchMissileBody, withId } from '../../src/sim/intents';
import { forEachInBlast, inBlast } from '../../src/sim/missileBlast';
import { cellOfVector, missilePosition } from '../../src/sim/missileGeom';
import { previewThreat, validateMissileLaunch } from '../../src/sim/missileRules';
import { applyLaunchMissile, blastAt, interceptPhase } from '../../src/sim/missilePhase';
import { MISSILE_FISSION, MISSILE_TACTICAL } from '../../src/sim/missileTable';
import { OUTBOX_MISSILE_INTERCEPTED, OUTBOX_MISSILE_INTERCEPTOR_LAUNCHED } from '../../src/sim/outbox';
import { SAM_SALVO_PERIOD_TICKS } from '../../src/sim/rules';
import { deserialize, serialize } from '../../src/sim/serialize';
import { step } from '../../src/sim/step';
import { STRUCT_CITY, STRUCT_FACTORY, STRUCT_POST, STRUCT_SAM } from '../../src/sim/structureRules';
import { CLASS_MOUNTAIN } from '../../src/sim/terrain';
import { StateView } from '../../src/sim/view';
import { DISTRICT_HOUSING } from '../../src/sim/districtRules';
import { TECH_FX_SAM_SALVO } from '../../src/sim/techTable';
import { missileFixture } from '../../tools/sim/missiles';

const W = 1024;
const H = 512;
const at = (x: number, y: number): number => y * W + x;

describe('launch rules at their exact boundaries', () => {
  it('a seat with EXACTLY the price (300 gold) can fire its first Tactical missile', () => {
    const fx = missileFixture('plain-cruise', 1);
    fx.state.gold[1] = 300 * 1000;
    expect(validateMissileLaunch(new StateView(fx.state), 0, fx.silo, MISSILE_TACTICAL, fx.target)).toBe(REJECT_NONE);
    expect(applyLaunchMissile(fx.state, 0, fx.silo, MISSILE_TACTICAL, fx.target)).toBe(REJECT_NONE);
    expect(fx.state.gold[1]).toBe(0);
  });

  it('UNOWNED land is a legal target (DECISIONS M14a point 7: "unowned or owned by a nation the seat is at war with")', () => {
    const fx = missileFixture('plain-cruise', 1);
    const s = fx.state;
    const cell = at(250, 190);
    expect(s.owner[cell]).toBe(0);
    expect(validateMissileLaunch(new StateView(s), 0, fx.silo, MISSILE_TACTICAL, cell)).toBe(REJECT_NONE);
    expect(applyLaunchMissile(s, 0, fx.silo, MISSILE_TACTICAL, cell)).toBe(REJECT_NONE);
  });
});

describe('previewThreat uses the same radius as the sim (a SAM on a mountain is 20 percent larger)', () => {
  it('a mountain SAM 25 cells off the aim point is listed, the same SAM on plains is not', () => {
    const run = (mountain: boolean): number => {
      const fx = missileFixture('plain-cruise', 1);
      const s = fx.state;
      if (mountain) s.terrain[at(312, 224)] = CLASS_MOUNTAIN;
      s.structures.add(STRUCT_SAM, 2, at(312, 224), 0);
      return previewThreat(new StateView(s), at(250, 250), fx.target, MISSILE_TACTICAL).length;
    };
    expect(run(false)).toBe(0);
    expect(run(true)).toBe(1);
  });
});

describe('the blast disc wraps over the east edge exactly like inBlast says', () => {
  it('forEachInBlast at x = 1022 visits exactly the cells inBlast accepts', () => {
    const centre = at(1022, 256);
    const seen = new Set<number>();
    let calls = 0;
    forEachInBlast(W, H, centre, 235, (c) => { seen.add(c); calls++; });
    const brute = new Set<number>();
    for (let y = 200; y < 312; y++) for (let x = 0; x < W; x++) if (inBlast(W, H, centre, 235, y * W + x)) brute.add(y * W + x);
    expect(calls).toBe(seen.size);
    expect(seen.size).toBe(brute.size);
    for (const c of brute) expect(seen.has(c)).toBe(true);
  });
});

/** Tries missile slots 0.. until the outer-ring roll hits the City (its level drops); returns the slot. */
function hitCity(s: ReturnType<typeof missileFixture>['state'], id: number): number {
  const before = s.structures.level[id] as number;
  const centre = (s.structures.cell[id] as number) + 3;
  for (let slot = 0; slot < 200; slot++) {
    blastAt(s, 1, slot, MISSILE_TACTICAL, centre, 1, 313);
    if ((s.structures.level[id] as number) < before) return slot;
  }
  throw new Error('the ring never hit');
}

describe('an outer-ring hit on a City (DECISIONS M14a point 9)', () => {
  it('drops one level, and a District above the new slot count is lost', () => {
    const fx = missileFixture('plain-cruise', 1);
    const s = fx.state;
    const id = s.structures.add(STRUCT_CITY, 2, at(200, 300), 0);
    s.structures.level[id] = 3; // 3 slots
    for (let slot = 0; slot < 3; slot++) s.structures.setDistrict(id, slot, DISTRICT_HOUSING, 1, 0, 0);
    hitCity(s, id);
    expect(s.structures.level[id]).toBe(2); // 2 slots
    expect(s.structures.districtKind[id * 5 + 2]).toBe(0);
    expect(s.structures.districtCount).toBe(2);
  });

  it('the effect cache is marked dirty (income follows the new level) and a running upgrade is cancelled', () => {
    const fx = missileFixture('plain-cruise', 1);
    const s = fx.state;
    const id = s.structures.add(STRUCT_CITY, 2, at(200, 300), 0);
    s.structures.level[id] = 3;
    s.structures.upgradeReadyTick[id] = s.tick + 500;
    s.structures.effDirty = false;
    let hitSlot = -1;
    const centre = at(203, 300);
    for (let slot = 0; slot < 200 && hitSlot < 0; slot++) {
      s.structures.effDirty = false;
      blastAt(s, 1, slot, MISSILE_TACTICAL, centre, 1, 313);
      if ((s.structures.level[id] as number) < 3) hitSlot = slot;
    }
    expect(hitSlot).toBeGreaterThanOrEqual(0);
    expect(s.structures.effDirty).toBe(true);
    expect(s.structures.upgradeReadyTick[id]).toBe(0);
  });
});

describe('a blast that spills onto a truce partner breaks the trade cache', () => {
  it('the trade effect is recomputed after the betrayal', () => {
    const fx = missileFixture('plain-cruise', 1);
    const s = fx.state;
    s.diplo.setRelation(1, 2, RELATION_TRUCE, s.tick + 1000);
    s.structures.effDirty = false;
    blastAt(s, 1, 0, MISSILE_FISSION, at(340, 290), 235, 626);
    expect(s.diplo.relationOf(1, 2)).toBe(RELATION_WAR);
    expect(s.structures.effDirty).toBe(true);
  });
});

describe('a Factory destroyed by a missile takes its helicopters with it (DECISIONS M14a point 9)', () => {
  it('no helicopter is left pointing at the dead Factory, and the state still round-trips', () => {
    const fx = missileFixture('plain-cruise', 1);
    const s = fx.state;
    const factory = fx.buildings[1] as number;
    expect(s.structures.type[factory]).toBe(STRUCT_FACTORY);
    s.helis.addBuilding(2, factory, s.tick, s.tick + 120);
    blastAt(s, 1, 0, MISSILE_TACTICAL, s.structures.cell[factory] as number, 157, 313);
    expect(s.structures.owner[factory]).toBe(0);
    expect(s.helis.countOf(2)).toBe(0);
    expect(deserialize(serialize(s)).ok).toBe(true);
  });
});

describe('interception details', () => {
  const addMissile = (s: ReturnType<typeof missileFixture>['state'], slot: number, cls = MISSILE_FISSION): void => {
    s.missiles.add(slot, 1, cls, 0, s.tick - 10, s.tick + 20, at(296, 250), at(330, 249));
  };

  it('two interceptors that meet their warheads in the same tick BOTH take their warhead out (resolveDue must not skip the shifted row)', () => {
    const fx = missileFixture('sam-stack', 1);
    const s = fx.state;
    for (const id of fx.sams) s.structures.remove(id);
    const a = s.structures.add(STRUCT_SAM, 2, at(322, 244), 0);
    const b = s.structures.add(STRUCT_SAM, 2, at(326, 256), 0);
    addMissile(s, 0);
    addMissile(s, 1);
    s.missiles.addInterceptor(0, a, s.tick - 3, s.tick, 1);
    s.missiles.addInterceptor(1, b, s.tick - 3, s.tick, 1);
    interceptPhase(s);
    expect(s.missiles.owner[0]).toBe(0);
    expect(s.missiles.owner[1]).toBe(0);
  });

  it('the event of an interception carries the cell the warhead is over AT the meeting tick', () => {
    const fx = missileFixture('sam-stack', 1);
    const s = fx.state;
    for (const id of fx.sams) s.structures.remove(id);
    const a = s.structures.add(STRUCT_SAM, 2, at(322, 244), 0);
    addMissile(s, 0);
    s.missiles.addInterceptor(0, a, s.tick - 3, s.tick, 1);
    s.outbox.clear();
    interceptPhase(s);
    const ev = s.outbox.drain().filter((e) => e.kind === OUTBOX_MISSILE_INTERCEPTED);
    expect(ev).toHaveLength(1);
    const p = new Int32Array(3);
    missilePosition(at(296, 250), at(330, 249), s.tick - 10, s.tick + 20, s.tick, W, H, p);
    expect(ev[0]?.a).toBe(cellOfVector(p[0] as number, p[1] as number, p[2] as number, W, H));
  });

  it('a Defense Post (it is in the air-defence index) never fires at a missile', () => {
    const fx = missileFixture('sam-stack', 1);
    const s = fx.state;
    for (const id of fx.sams) s.structures.remove(id);
    s.structures.add(STRUCT_POST, 2, at(305, 251), 0);
    addMissile(s, 0);
    interceptPhase(s);
    expect(s.missiles.interceptorCount).toBe(0);
  });

  it('the AA tech that shortens the salvo also shortens the reload after a shot at a missile', () => {
    const fx = missileFixture('sam-stack', 1);
    const s = fx.state;
    s.match.setTechMask(2, 0xffff);
    const cut = s.match.fx(2, TECH_FX_SAM_SALVO);
    expect(cut).toBeGreaterThan(0);
    for (const id of fx.sams.slice(1)) s.structures.remove(id);
    const a = fx.sams[0] as number;
    addMissile(s, 0);
    s.structures.salvoTick[a] = 0;
    interceptPhase(s);
    expect(s.missiles.interceptorCount).toBe(1);
    expect(s.structures.salvoTick[a]).toBe(s.tick + SAM_SALVO_PERIOD_TICKS - Math.floor((SAM_SALVO_PERIOD_TICKS * cut) / 100));
  });

  it('a SAM whose own mask is blocked by a ridge does not fire although ANOTHER site of its owner sees the cruise missile (30 seeds: some interceptors of the open site miss)', () => {
    let missesOfOpen = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const fx = missileFixture('ridge-cruise', seed);
      const s = fx.state;
      const blocked = fx.sams[0] as number; // (310, 250), behind the ridge x 300..304
      const open = s.structures.add(STRUCT_SAM, 2, at(290, 252), 0);
      const fired: number[] = [];
      let openHit = -1;
      step(s, { turn: s.tick, intents: [withId(launchMissileBody(0, fx.silo, MISSILE_TACTICAL, fx.target), 1)] });
      for (let t = 0; t < 40; t++) {
        for (const e of s.outbox.drain()) if (e.kind === OUTBOX_MISSILE_INTERCEPTOR_LAUNCHED) { fired.push(e.a >> 6); if ((e.a >> 6) === open && openHit < 0) openHit = e.b & 1; }
        step(s, { turn: s.tick, intents: [] });
      }
      if (openHit === 0) missesOfOpen++;
      expect(fired, `seed ${seed}`).not.toContain(blocked);
    }
    expect(missesOfOpen).toBeGreaterThan(0);
  });
});
