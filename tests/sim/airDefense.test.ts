// M12b: air defence against helicopters. Every test drives the real phase (`airDefensePhase`, `heliPhase` or `step`), so a rule removed from src/sim/airDefense.ts,
// src/sim/hostile.ts or the nav code fails here (the mutants are tabulated in the M12b block of docs/DECISIONS.md).
import { describe, expect, it } from 'vitest';
import { previewLaunch } from '../../src/app/launchPreview';
import { navOf, planRouteOf, scoreLzOf } from '../../src/sim/access';
import { airDefensePhase, samRoll } from '../../src/sim/airDefense';
import { RELATION_ALLIANCE, RELATION_TRUCE, RELATION_WAR } from '../../src/sim/diplomacyTable';
import { heliPhase } from '../../src/sim/heliPhase';
import { HELI_DOWNED, HELI_DOWN_POST, HELI_DOWN_SAM, HELI_HOVER, cellCentreQ8 } from '../../src/sim/heliTable';
import { hostileOwners, hostileSeats } from '../../src/sim/hostile';
import { LZ_ENEMY_CITY_NEAR, LZ_OK } from '../../src/sim/nav/lz';
import { OUTBOX_HELI_DOWNED } from '../../src/sim/outbox';
import { HELI_HP_TENTHS, POST_AA_DPS, QT_PER_TROOP, SAM_HIT_PCT, SAM_SALVO_PERIOD_TICKS, TICK_HZ } from '../../src/sim/rules';
import { deserialize, hashState, serialize } from '../../src/sim/serialize';
import type { GameState } from '../../src/sim/state';
import { step } from '../../src/sim/step';
import { StateView } from '../../src/sim/view';
import { STRUCT_CITY, STRUCT_POST, STRUCT_SAM } from '../../src/sim/structureRules';
import { launchHeliBody, withId } from '../../src/sim/intents';
import { syntheticFixture, flyRaid, raidStats, type Fixture } from '../../tools/sim/heliRaid';

const W = 256;
const at = (x: number, y: number): number => y * W + x;

/** Parks the fixture's helicopter in the air as a hovering one at (x, y) in flight mode `mode` (the flight phase is NOT run: the helicopter stands still). */
function hover(fx: Fixture, x: number, y: number, mode: 0 | 1): number {
  const s = fx.state;
  const t = s.helis;
  const id = fx.heli;
  t.state[id] = HELI_HOVER;
  t.x[id] = cellCentreQ8(x);
  t.y[id] = cellCentreQ8(y);
  t.mode[id] = mode;
  t.hp[id] = HELI_HP_TENTHS;
  t.load[id] = 100;
  t.alt[id] = 400;
  t.stateTick[id] = s.tick;
  t.target[id] = 0;
  return id;
}

/** A finished structure of ownerId 2 at (x, y). */
function finished(s: GameState, type: number, x: number, y: number, ownerId = 2): number {
  const id = s.structures.add(type, ownerId, at(x, y), s.tick);
  s.structures.readyTick[id] = s.tick;
  return id;
}

/** Runs the air-defence phase for `ticks` ticks; returns the tick count at which the helicopter went down (1-based), or 0. */
function ticksToDown(s: GameState, id: number, ticks: number): number {
  for (let i = 1; i <= ticks; i++) {
    airDefensePhase(s);
    s.tick++;
    if (s.helis.state[id] === HELI_DOWNED) return i;
  }
  return 0;
}

describe('hostile(a, b): one predicate', () => {
  const relationOf = (table: Record<string, number>) => ({ relation: (a: number, b: number) => table[`${Math.min(a, b)}-${Math.max(a, b)}`] ?? RELATION_WAR }) as never;

  it('is false for the same party, false for a truce or an alliance, true for war, for a tribe and for a view without diplomacy', () => {
    const d = { diplomacy: relationOf({ '0-1': RELATION_ALLIANCE, '0-2': RELATION_TRUCE }) };
    expect(hostileSeats(d, 0, 0)).toBe(false);
    expect(hostileSeats(d, 0, 1)).toBe(false);
    expect(hostileSeats(d, 1, 0)).toBe(false);
    expect(hostileSeats(d, 0, 2)).toBe(false);
    expect(hostileSeats(d, 1, 2)).toBe(true);
    expect(hostileSeats({}, 0, 1)).toBe(true);
    expect(hostileSeats({}, 3, 3)).toBe(false);
    expect(hostileOwners(d, 1, 2)).toBe(false); // owners are seats + 1
    expect(hostileOwners(d, 2, 3)).toBe(true);
    expect(hostileOwners(d, 0, 2)).toBe(true); // nobody's land is nobody's friend
    expect(hostileOwners(d, 2, 2)).toBe(false);
  });

  it('the route planner does not avoid an ally\'s or a truce partner\'s SAM sites (and does avoid an enemy\'s)', () => {
    for (const rel of [RELATION_ALLIANCE, RELATION_TRUCE]) {
      const fx = syntheticFixture('plains-sam', 1);
      const s = fx.state;
      const from = at(40, 48);
      const to = at(150, 48); // the zone between both SAM sites (the map wraps: a goal at x 200 would be reached the short way round)
      const war = planRouteOf(s, 0, from, to, 0);
      s.diplo.setRelation(1, 2, rel, rel === RELATION_TRUCE ? s.tick + 100000 : 0);
      const peace = planRouteOf(s, 0, from, to, 0);
      expect(war.ok && peace.ok).toBe(true);
      if (!war.ok || !peace.ok) return;
      expect(peace.exposedCells).toBe(0);
      expect(war.exposedCells).toBeGreaterThan(0);
      s.diplo.setRelation(1, 2, RELATION_WAR, 0);
      const again = planRouteOf(s, 0, from, to, 0);
      expect(again.ok && again.exposedCells === war.exposedCells && again.fuelCells === war.fuelCells).toBe(true);
    }
  });

  it('scoreLz: only a hostile City makes a zone ENEMY_CITY_NEAR', () => {
    const fx = syntheticFixture('plains-sam', 1);
    const s = fx.state;
    s.structures.add(STRUCT_CITY, 2, at(151, 48), s.tick);
    const lz = at(150, 48);
    const from = at(40, 48);
    expect(scoreLzOf(s, 0, lz, from, 0).reason).toBe(LZ_ENEMY_CITY_NEAR);
    s.diplo.setRelation(1, 2, RELATION_ALLIANCE, 0);
    expect(scoreLzOf(s, 0, lz, from, 0).reason).toBe(LZ_OK);
    s.diplo.setRelation(1, 2, RELATION_TRUCE, s.tick + 100000);
    expect(scoreLzOf(s, 0, lz, from, 0).reason).toBe(LZ_OK);
  });

  it('the route preview colours a waypoint red only under a hostile sensor', () => {
    const fx = syntheticFixture('plains-sam', 1);
    const s = fx.state;
    const view = new StateView(s);
    const req = { factory: fx.factory, lzCell: fx.lz, troops: 100, mode: 0 as const };
    const war = previewLaunch(navOf(s), view, 0, req);
    expect(war.reason).toBe(0);
    expect(Array.from(war.exposed as Uint8Array).some((v) => v === 1)).toBe(true);
    s.diplo.setRelation(1, 2, RELATION_ALLIANCE, 0);
    const peace = previewLaunch(navOf(s), view, 0, req);
    expect(Array.from(peace.exposed as Uint8Array).every((v) => v === 0)).toBe(true);
    expect(peace.exposedCells).toBe(0);
  });
});

describe('the SAM site behind the ridge', () => {
  it('Low is never engaged behind the ridge; High is engaged and a salvo hits with SAM_HIT_PCT (10 000 seeded rolls inside +-3 points)', () => {
    const fx = syntheticFixture('ridge-sam', 7);
    const s = fx.state;
    const sam = fx.sams[0] as number;
    const id = hover(fx, 92, 48, 0);
    let engaged = 0;
    for (let i = 0; i < 10000; i++) {
      s.structures.salvoTick[sam] = 0;
      airDefensePhase(s);
      s.tick++;
      if ((s.structures.salvoTick[sam] as number) !== 0) engaged++;
      if (s.helis.state[id] === HELI_DOWNED) throw new Error('a Low helicopter behind the ridge was shot');
    }
    expect(engaged).toBe(0);
    hover(fx, 92, 48, 1);
    let hits = 0;
    s.outbox.clear();
    for (let i = 0; i < 10000; i++) {
      s.structures.salvoTick[sam] = 0;
      airDefensePhase(s);
      s.tick++;
      if (s.helis.state[id] === HELI_DOWNED) {
        hits++;
        hover(fx, 92, 48, 1); // stand it up again: the next salvo is another independent trial
      }
    }
    expect(SAM_HIT_PCT).toBe(55);
    expect(hits / 10000).toBeGreaterThan(0.52); // the literals of the plan: 55 % per salva, +-3 points
    expect(hits / 10000).toBeLessThan(0.58);
    const causes = s.outbox.drain().filter((e) => e.kind === OUTBOX_HELI_DOWNED).map((e) => e.b);
    expect(causes.length).toBe(hits);
    expect(new Set(causes)).toEqual(new Set([HELI_DOWN_SAM]));
  });

  it('fire control is the SAM\'s OWN mask: a site behind the ridge stays silent even when another site of the same owner sees the helicopter', () => {
    const fx = syntheticFixture('ridge-sam', 7);
    const s = fx.state;
    const hidden = fx.sams[0] as number; // behind the ridge: cannot see a Low helicopter over the zone
    const open = finished(s, STRUCT_SAM, 75, 48); // in the open on the helicopter's side: sees it
    hover(fx, 92, 48, 0);
    airDefensePhase(s);
    expect(s.structures.salvoTick[open]).not.toBe(0); // control: the layer detects it and the open site fires
    expect(s.structures.salvoTick[hidden]).toBe(0); // the composite coverage sees it, but this site's own mask does not
  });

  it('the salvo period: one salvo per SAM_SALVO_PERIOD_TICKS, the first as soon as the target is valid', () => {
    const fx = syntheticFixture('ridge-sam', 7);
    const s = fx.state;
    const sam = fx.sams[0] as number;
    const id = hover(fx, 92, 48, 1);
    const first = s.tick;
    const fired: number[] = [];
    let last = 0;
    for (let i = 0; i < 400; i++) {
      airDefensePhase(s);
      const sal = s.structures.salvoTick[sam] as number;
      if (sal !== last) {
        fired.push(s.tick);
        last = sal;
      }
      s.tick++;
      if (s.helis.state[id] === HELI_DOWNED) hover(fx, 92, 48, 1);
    }
    expect(fired[0]).toBe(first);
    for (let i = 1; i < fired.length; i++) expect((fired[i] as number) - (fired[i - 1] as number)).toBe(SAM_SALVO_PERIOD_TICKS);
    expect(fired.length).toBe(Math.floor(399 / SAM_SALVO_PERIOD_TICKS) + 1);
  });

  it('out of range and a destroyed site never fire; a hostile SAM in range does', () => {
    const fx = syntheticFixture('ridge-sam', 7);
    const s = fx.state;
    const sam = fx.sams[0] as number;
    hover(fx, 60, 48, 1); // 55 cells from the site: far outside its radius
    for (let i = 0; i < 200; i++) {
      airDefensePhase(s);
      s.tick++;
    }
    expect(s.structures.salvoTick[sam]).toBe(0);
    hover(fx, 92, 48, 1);
    airDefensePhase(s);
    expect(s.structures.salvoTick[sam]).not.toBe(0); // control: in range it fires
    s.structures.salvoTick[sam] = 0;
    s.structures.remove(sam);
    for (let i = 0; i < 200; i++) {
      airDefensePhase(s);
      s.tick++;
    }
    expect(s.helis.state[fx.heli]).toBe(HELI_HOVER);
  });

  it('a site still under construction does not fire', () => {
    const fx = syntheticFixture('ridge-sam', 7);
    const s = fx.state;
    s.structures.readyTick[fx.sams[0] as number] = s.tick + 50;
    hover(fx, 92, 48, 1);
    for (let i = 0; i < 49; i++) {
      airDefensePhase(s);
      s.tick++;
    }
    expect(s.structures.salvoTick[fx.sams[0] as number]).toBe(0);
  });

  it('the same result with the sites visited in reverse order (the state hash is equal tick by tick)', () => {
    const run = (reverse: boolean): number[] => {
      const fx = syntheticFixture('plains-sam', 11);
      const s = fx.state;
      finished(s, STRUCT_SAM, 150, 30);
      finished(s, STRUCT_SAM, 152, 66);
      finished(s, STRUCT_POST, 140, 48);
      const hashes: number[] = [];
      const id = hover(fx, 150, 48, 1);
      let kills = 0;
      for (let i = 0; i < 600; i++) {
        airDefensePhase(s, reverse);
        s.tick++;
        hashes.push(hashState(s));
        if (s.helis.state[id] === HELI_DOWNED) {
          kills++;
          hover(fx, 150, 48, 1); // stand it up again: many salvos and kills go through the hash
        }
      }
      expect(kills).toBeGreaterThan(3);
      return hashes;
    };
    const a = run(false);
    expect(a.length).toBe(600);
    expect(run(true)).toEqual(a);
  });

  it('samRoll is a pure function of (seed, tick, SAM id) and spreads over 0..99', () => {
    expect(samRoll(5, 100, 3)).toBe(samRoll(5, 100, 3));
    const seen = new Set<number>();
    for (let t = 0; t < 2000; t++) seen.add(samRoll(5, t, 3));
    expect(seen.size).toBeGreaterThan(95);
    expect(samRoll(5, 100, 3) === samRoll(5, 100, 4) && samRoll(5, 101, 3) === samRoll(5, 100, 3) && samRoll(6, 100, 3) === samRoll(5, 100, 3)).toBe(false);
  });
});

describe('treaties silence the guns, and a change is felt on the next tick', () => {
  it('an allied or truce-bound SAM and Post do not shoot; a relation that turns to war in mid-flight bites at once', () => {
    for (const rel of [RELATION_ALLIANCE, RELATION_TRUCE]) {
      const fx = syntheticFixture('plains-sam', 3);
      const s = fx.state;
      const post = finished(s, STRUCT_POST, 150, 52);
      void post;
      const id = hover(fx, 150, 48, 0);
      s.diplo.setRelation(1, 2, rel, rel === RELATION_TRUCE ? s.tick + 100000 : 0);
      for (let i = 0; i < 300; i++) {
        airDefensePhase(s);
        s.tick++;
      }
      expect(s.helis.state[id]).toBe(HELI_HOVER);
      expect(s.helis.hp[id]).toBe(HELI_HP_TENTHS);
      for (const sam of fx.sams) expect(s.structures.salvoTick[sam]).toBe(0);
      s.diplo.setRelation(1, 2, RELATION_WAR, 0); // the treaty is broken
      airDefensePhase(s);
      expect((s.helis.hp[id] as number) < HELI_HP_TENTHS || s.helis.state[id] === HELI_DOWNED).toBe(true); // the Post bit in that very tick
      expect(fx.sams.some((sam) => (s.structures.salvoTick[sam] as number) !== 0)).toBe(true);
    }
  });
});

describe('the Defense Post', () => {
  it('fells a helicopter in 7 s +-1 in both flight modes; two Posts stack and take about half; the cause is the Post', () => {
    const solo: Record<number, number> = {};
    for (const mode of [0, 1] as const) {
      const fx = syntheticFixture('plains-sam', 3);
      const s = fx.state;
      finished(s, STRUCT_POST, 60, 50);
      const id = hover(fx, 62, 48, mode);
      s.outbox.clear();
      const n = ticksToDown(s, id, 200);
      solo[mode] = n;
      expect(n).toBeGreaterThanOrEqual(6 * TICK_HZ);
      expect(n).toBeLessThanOrEqual(8 * TICK_HZ);
      expect(n).toBe(Math.ceil(HELI_HP_TENTHS / ((POST_AA_DPS * 10) / TICK_HZ)));
      expect(s.outbox.drain().filter((e) => e.kind === OUTBOX_HELI_DOWNED).map((e) => e.b)).toEqual([HELI_DOWN_POST]);
    }
    const fx = syntheticFixture('plains-sam', 3);
    const s = fx.state;
    finished(s, STRUCT_POST, 60, 50);
    finished(s, STRUCT_POST, 64, 46);
    const id = hover(fx, 62, 48, 1);
    const two = ticksToDown(s, id, 200);
    expect(two).toBe(Math.ceil((solo[1] as number) / 2));
  });

  it('only inside the radius, only for a hostile helicopter, only a finished Post', () => {
    const fx = syntheticFixture('plains-sam', 3);
    const s = fx.state;
    const post = finished(s, STRUCT_POST, 60, 50);
    const id = hover(fx, 60 + 13, 50, 0); // one cell outside the 12-cell radius
    expect(ticksToDown(s, id, 100)).toBe(0);
    expect(s.helis.hp[id]).toBe(HELI_HP_TENTHS);
    hover(fx, 60 + 12, 50, 0);
    airDefensePhase(s);
    expect(s.helis.hp[id]).toBeLessThan(HELI_HP_TENTHS);
    hover(fx, 60 + 12, 50, 0);
    s.structures.readyTick[post] = s.tick + 10;
    airDefensePhase(s);
    expect(s.helis.hp[id]).toBe(HELI_HP_TENTHS);
    s.structures.readyTick[post] = s.tick;
    s.structures.owner[post] = 1; // the helicopter's own Post
    airDefensePhase(s);
    expect(s.helis.hp[id]).toBe(HELI_HP_TENTHS);
  });
});

describe('a shot-down helicopter', () => {
  it('takes no territory and its load is gone: the troops are the troops before minus the load, nothing is given back', () => {
    const fx = syntheticFixture('plains-sam', 3);
    const s = fx.state;
    const lz = fx.lz;
    const ownersBefore = s.owner.slice();
    s.troops[1] = 5000 * QT_PER_TROOP;
    const control = syntheticFixture('plains-sam', 3).state; // the same tick without the launch: the regeneration of that one tick is the same
    control.troops[1] = 5000 * QT_PER_TROOP;
    step(control, { turn: control.tick, intents: [] });
    s.outbox.clear();
    step(s, { turn: s.tick, intents: [withId(launchHeliBody(0, fx.factory, lz, 100, 0), 1)] });
    const afterLaunch = s.troops[1] as number;
    expect(afterLaunch).toBe((control.troops[1] as number) - 100 * QT_PER_TROOP);
    let down = -1;
    for (let i = 0; i < 1500 && down < 0; i++) {
      heliPhase(s); // the helicopter phase only: no economy, so the troop count moves only by what the helicopter does to it
      s.tick++;
      if (s.helis.state[fx.heli] === HELI_DOWNED) down = i;
    }
    expect(down).toBeGreaterThan(0);
    for (let i = 0; i < 200; i++) {
      heliPhase(s);
      s.tick++;
    }
    expect(s.helis.owner[fx.heli]).toBe(0); // removed from the table after HELI_DOWNED_TICKS
    expect(s.troops[1]).toBe(afterLaunch); // before minus the load: nothing came back
    expect(s.owner).toEqual(ownersBefore);
    expect(s.beachheads.liveCount).toBe(0);
  });
});

describe('the scripted raids and the replay command', () => {
  it('liveness: every raid of the SAM fixtures ends in a landing or a shoot-down within 2 x ETA, in both flight modes', () => {
    for (const name of ['plains-sam', 'ridge-sam'] as const) {
      for (const mode of [0, 1] as const) {
        for (let seed = 1; seed <= 6; seed++) {
          const r = flyRaid(syntheticFixture(name, seed), seed, 0, mode, false);
          expect(['landed', 'downed'], `${name} mode ${mode} seed ${seed}: ${r.outcome}`).toContain(r.outcome);
          expect(r.ticks, `${name} mode ${mode} seed ${seed}`).toBeLessThanOrEqual(2 * r.etaTicks);
        }
      }
    }
  });

  it('the 50-trial statistics: at least 80 % against the undefended Alps, at most 30 % over the plains with two SAM sites, 30 points more through the ridge', async () => {
    const alps = await raidStats('alps', 1, 50, 0);
    const plains = await raidStats('plains-sam', 1, 50, 0);
    const ridge = await raidStats('ridge-sam', 1, 50, 0);
    console.log(`[heli raids, 50 trials, Low] alps ${alps.successes}/${alps.trials} = ${alps.pct}% | plains-sam ${plains.successes}/50 = ${plains.pct}% (SAM downed ${plains.downedSam}) | ridge-sam ${ridge.successes}/50 = ${ridge.pct}% (SAM downed ${ridge.downedSam})`);
    expect(alps.trials).toBe(50);
    expect(alps.pct).toBeGreaterThanOrEqual(80);
    expect(plains.pct).toBeLessThanOrEqual(30);
    expect(ridge.pct - plains.pct).toBeGreaterThanOrEqual(30);
    expect(ridge.downedSam).toBe(0); // Low is never engaged behind the ridge
  }, 60_000);
});

describe('state: serialisation and the straight run', () => {
  it('a snapshot taken in the middle of an engagement continues exactly like the straight run, including the shoot-down', () => {
    const fx = syntheticFixture('plains-sam', 3);
    const s = fx.state;
    s.troops[1] = 5000 * QT_PER_TROOP;
    step(s, { turn: s.tick, intents: [withId(launchHeliBody(0, fx.factory, fx.lz, 100, 0), 1)] });
    let guard = 0;
    while (!fx.sams.some((sam) => (s.structures.salvoTick[sam] as number) !== 0) && guard++ < 1500) step(s, { turn: s.tick, intents: [] });
    expect(guard).toBeLessThan(1500);
    const bytes = serialize(s);
    const r = deserialize(bytes, { maxElev: s.env.maxElev as Int16Array });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const t = r.state;
    expect(hashState(t)).toBe(hashState(s));
    expect(fx.sams.map((sam) => t.structures.salvoTick[sam])).toEqual(fx.sams.map((sam) => s.structures.salvoTick[sam]));
    let downedAt = -1;
    for (let i = 0; i < 400; i++) {
      step(s, { turn: s.tick, intents: [] });
      step(t, { turn: t.tick, intents: [] });
      expect(hashState(t)).toBe(hashState(s));
      if (downedAt < 0 && s.helis.state[fx.heli] === HELI_DOWNED) downedAt = i;
    }
    expect(downedAt).toBeGreaterThanOrEqual(0); // the run did contain the shoot-down
  });

  it('a forged blob with a salvo clock on a Factory, or one that runs far ahead, is refused', () => {
    const fx = syntheticFixture('plains-sam', 3);
    const s = fx.state;
    const maxElev = s.env.maxElev as Int16Array;
    const sam = fx.sams[0] as number;
    s.structures.salvoTick[sam] = s.tick + SAM_SALVO_PERIOD_TICKS;
    expect(deserialize(serialize(s), { maxElev }).ok).toBe(true);
    s.structures.salvoTick[sam] = s.tick + SAM_SALVO_PERIOD_TICKS + 1;
    const bad = deserialize(serialize(s), { maxElev });
    expect(bad.ok ? 'ok' : bad.error).toBe('structure-range');
    s.structures.salvoTick[sam] = 0;
    s.structures.salvoTick[fx.factory] = 5;
    const bad2 = deserialize(serialize(s), { maxElev });
    expect(bad2.ok ? 'ok' : bad2.error).toBe('structure-range');
  });

  it('the replay of a fixture is a fixed history: the hash of plains-sam seed 3 after the raid does not move', () => {
    const fx = syntheticFixture('plains-sam', 3);
    const r = flyRaid(fx, 3, 0, 0, true);
    expect(r.outcome).toBe('downed');
    expect(hashState(fx.state)).toBe(PLAINS_SAM_SEED3_HASH);
  });
});

/** Pinned (M12b): the state hash after the replay of `heli-raid --fixture plains-sam --seed 3`. */
const PLAINS_SAM_SEED3_HASH = 86601476; // ENGINE 28 / FORMAT 19 (M14b: the engine version word and the interceptor fold move the hash, the raid itself is unchanged); 3676042738 on ENGINE 27 / FORMAT 18 (M14a: the engine version word and the missile fold move the hash, the raid itself is unchanged); 1339748540 on ENGINE 26 / FORMAT 17 (M13c-1: the engine version word and the ship fold move the hash, the raid itself is unchanged); 1146553041 on ENGINE 25; 59485615 on ENGINE 22 / FORMAT 16, 3353160779 on ENGINE 23, 336496879 on ENGINE 24; set again for ENGINE 25 (M18e-1: only the engine version word moves, the raid itself is unchanged)
