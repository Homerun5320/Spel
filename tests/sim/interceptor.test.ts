// M14b: SAM interception of missiles. Every test drives the real phase (`interceptPhase`, `missilePhase` or `step`) on the fixtures of tools/sim/missiles.ts, so a rule removed from
// src/sim/interceptor.ts, src/sim/missileGeom.ts (cellOfVector) or src/sim/missileRules.ts (previewThreat) fails here (the mutants are tabulated in the M14b block of docs/DECISIONS.md).
import { describe, expect, it } from 'vitest';
import { MainThreadHost } from '../../src/host/mainThreadHost';
import { ViewMirror } from '../../src/host/viewMirror';
import { RELATION_TRUCE } from '../../src/sim/diplomacyTable';
import { interceptPct, interceptRoll, meetingTick } from '../../src/sim/interceptor';
import { launchMissileBody, withId } from '../../src/sim/intents';
import { cellOfVector, cellVector } from '../../src/sim/missileGeom';
import { previewThreat } from '../../src/sim/missileRules';
import { interceptPhase } from '../../src/sim/missilePhase';
import { MISSILE_FISSION, MISSILE_FUSION, MISSILE_TACTICAL } from '../../src/sim/missileTable';
import { OUTBOX_MISSILE_DETONATED, OUTBOX_MISSILE_INTERCEPTED, OUTBOX_MISSILE_INTERCEPTOR_LAUNCHED, type OutboxEvent } from '../../src/sim/outbox';
import { INTERCEPTOR_CAPACITY, MISSILE_SAM_HIT_PCT, SAM_SALVO_PERIOD_TICKS } from '../../src/sim/rules';
import { deserialize, hashState, serialize } from '../../src/sim/serialize';
import type { GameState } from '../../src/sim/state';
import { step } from '../../src/sim/step';
import { samRadiusCells } from '../../src/sim/structureEffects';
import { StateView } from '../../src/sim/view';
import { saveLayout } from '../helpers/saveLayout';
import { missileFixture, runMissiles, type MissileFixture } from '../../tools/sim/missiles';

const W = 1024;
const at = (x: number, y: number): number => y * W + x;

/** Launches the fixture's missile in the current tick and steps until `n` ticks have passed, collecting the events. */
function fly(fx: MissileFixture, ticks: number, cls = fx.cls): OutboxEvent[] {
  const s = fx.state;
  const out: OutboxEvent[] = [];
  step(s, { turn: s.tick, intents: [withId(launchMissileBody(0, fx.silo, cls, fx.target), 1)] });
  for (let t = 0; t < ticks; t++) {
    out.push(...s.outbox.drain());
    step(s, { turn: s.tick, intents: [] });
  }
  out.push(...s.outbox.drain());
  return out;
}
const kinds = (ev: readonly OutboxEvent[], k: number): OutboxEvent[] => ev.filter((e) => e.kind === k);

describe('cellOfVector: the inverse of cellVector, integer only', () => {
  it('returns the cell for the vector of every cell (every 3rd column, all rows but the two at each pole) on three grids', () => {
    for (const [w, h] of [[1024, 512], [360, 180], [97, 61]] as const) {
      const v = new Int32Array(3);
      let bad = 0;
      for (let y = 2; y < h - 2; y++) {
        for (let x = (y % 3); x < w; x += 3) {
          cellVector(y * w + x, w, h, v, 0);
          if (cellOfVector(v[0] as number, v[1] as number, v[2] as number, w, h) !== y * w + x) bad++;
        }
      }
      expect(bad, `${w}x${h}`).toBe(0);
    }
  });

  it('puts a vector near a cell edge on the right side (a point between two cells of the equator row goes to the nearer)', () => {
    const w = 1024;
    const h = 512;
    const a = new Int32Array(3);
    const b = new Int32Array(3);
    cellVector(256 * w + 100, w, h, a, 0);
    cellVector(256 * w + 101, w, h, b, 0);
    const quarter = (n: number): number => Math.floor(((a[n] as number) * 3 + (b[n] as number)) / 4);
    const third = (n: number): number => Math.floor(((a[n] as number) + (b[n] as number) * 3) / 4);
    expect(cellOfVector(quarter(0), quarter(1), quarter(2), w, h)).toBe(256 * w + 100);
    expect(cellOfVector(third(0), third(1), third(2), w, h)).toBe(256 * w + 101);
    // the date line: x = -1 (just west of lon 0) is the last column
    cellVector(256 * w + (w - 1), w, h, a, 0);
    expect(cellOfVector(a[0] as number, a[1] as number, a[2] as number, w, h)).toBe(256 * w + (w - 1));
  });
});

describe('cellOfVector rows', () => {
  it('a vector a quarter row north or south of a row centre is in that row (the row edges are halfway between the centres)', () => {
    const w = 1024;
    const h = 512;
    const a = new Int32Array(3);
    const b = new Int32Array(3);
    const cell = (y: number): number => y * w + 300;
    cellVector(cell(100), w, h, a, 0);
    cellVector(cell(101), w, h, b, 0);
    const at4 = (n: number, k: number): number => Math.floor(((a[n] as number) * (4 - k) + (b[n] as number) * k) / 4); // k quarters of the way from row 100 to row 101 (a straight chord: close enough)
    expect(cellOfVector(at4(0, 1), at4(1, 1), at4(2, 1), w, h)).toBe(cell(100));
    expect(cellOfVector(at4(0, 3), at4(1, 3), at4(2, 3), w, h)).toBe(cell(101));
  });
});

describe('the hit roll and the kill chance', () => {
  it('Pk Monte-Carlo: 10 000 seeded trials give 75 / 60 / 40 percent within 2 points; two overlapping sites match 1 - (1 - p)^2 within 2 points', () => {
    const s = missileFixture('sam-stack', 1).state;
    expect([0, 1, 2].map((c) => interceptPct(s, 2, c))).toEqual([75, 60, 40]);
    expect(MISSILE_SAM_HIT_PCT).toEqual([75, 60, 40]);
    for (const cls of [0, 1, 2]) {
      const p = MISSILE_SAM_HIT_PCT[cls] as number;
      let hits = 0;
      let either = 0;
      for (let seed = 1; seed <= 10000; seed++) {
        const a = interceptRoll(seed, 300, 7, 3) < p;
        const b = interceptRoll(seed, 300, 8, 3) < p;
        if (a) hits++;
        if (a || b) either++;
      }
      expect(Math.abs(hits / 100 - p), `class ${cls}`).toBeLessThan(2);
      const stacked = (1 - (1 - p / 100) * (1 - p / 100)) * 100;
      expect(Math.abs(either / 100 - stacked), `class ${cls} stacked`).toBeLessThan(2);
    }
  });

  it('the same through the phase: one SAM and two SAMs round a Fission warhead, 4000 trials each, the table rows decide', () => {
    const fx = missileFixture('sam-stack', 1);
    const s = fx.state;
    s.structures.remove(fx.sams[2] as number); // two overlapping sites remain: (322, 244) and (326, 256)
    const [a, b] = [fx.sams[0] as number, fx.sams[1] as number];
    let one = 0;
    let two = 0;
    const N = 4000;
    const t0 = s.tick;
    for (let i = 1; i <= N; i++) {
      s.tick = t0 + i; // the roll is keyed on the tick, the site and the missile: a new tick is a new trial
      s.missiles.remove(0);
      s.missiles.add(0, 1, MISSILE_FISSION, fx.silo, s.tick - 10, s.tick + 20, at(296, 250), fx.target);
      s.structures.salvoTick[a] = 0;
      s.structures.salvoTick[b] = 0;
      interceptPhase(s);
      const m = s.missiles;
      expect(m.interceptorCount, 'both sites fire at once').toBe(2);
      if (m.iHit[0] === 1) one++;
      if (m.iHit[0] === 1 || m.iHit[1] === 1) two++;
    }
    expect(Math.abs((one / N) * 100 - 60)).toBeLessThan(2.5);
    expect(Math.abs((two / N) * 100 - 84)).toBeLessThan(2.5);
  });

  it('the SAM techs of the site owner add points to the chance, at most 100', () => {
    const s = missileFixture('sam-stack', 1).state;
    s.match.setTechMask(2, 0xffff);
    const bonus = s.match.fx(2, 9);
    expect(bonus).toBeGreaterThan(0);
    expect(interceptPct(s, 2, MISSILE_TACTICAL)).toBe(75 + bonus);
    expect(interceptPct(s, 1, MISSILE_TACTICAL)).toBe(75);
    s.match.techFx[2 * 12 + 9] = 90;
    expect(interceptPct(s, 2, MISSILE_TACTICAL)).toBe(100);
  });
});

describe('who can be engaged', () => {
  it('a cruise missile behind the ridge cannot be engaged; over plains the same flight is (the site sees it)', () => {
    const hidden = fly(missileFixture('ridge-cruise', 1), 60);
    expect(kinds(hidden, OUTBOX_MISSILE_INTERCEPTOR_LAUNCHED)).toHaveLength(0);
    expect(kinds(hidden, OUTBOX_MISSILE_DETONATED)).toHaveLength(1);
    const open = fly(missileFixture('ridge-cruise', 1, false), 60);
    expect(kinds(open, OUTBOX_MISSILE_INTERCEPTOR_LAUNCHED).length).toBeGreaterThanOrEqual(1);
  });

  it('a ballistic missile is always visible inside the radius: the ridge does not hide a Fission or a Fusion warhead', () => {
    for (const cls of [MISSILE_FISSION, MISSILE_FUSION]) {
      const fx = missileFixture('ridge-cruise', 1, true);
      fx.state.structures.level[fx.silo] = 2;
      const ev = fly(fx, 80, cls);
      expect(kinds(ev, OUTBOX_MISSILE_INTERCEPTOR_LAUNCHED).length, `class ${cls}`).toBeGreaterThanOrEqual(1);
    }
  });

  it('a Tactical missile on a world without an occluder layer is never engaged (the rule of a Low helicopter), a ballistic one is', () => {
    const fx = missileFixture('ridge-cruise', 1, false);
    (fx.state.env as { maxElev: Int16Array | null }).maxElev = null;
    (fx.state.env as { los: unknown }).los = null;
    expect(kinds(fly(fx, 60), OUTBOX_MISSILE_INTERCEPTOR_LAUNCHED)).toHaveLength(0);
    const fy = missileFixture('ridge-cruise', 1, false);
    (fy.state.env as { maxElev: Int16Array | null }).maxElev = null;
    (fy.state.env as { los: unknown }).los = null;
    expect(kinds(fly(fy, 60, MISSILE_FISSION), OUTBOX_MISSILE_INTERCEPTOR_LAUNCHED).length).toBeGreaterThanOrEqual(1);
  });

  it('a site that is not finished, outside its radius or the missile owner\'s own does not fire', () => {
    const base = (): MissileFixture => missileFixture('ridge-cruise', 1, false);
    const count = (fx: MissileFixture): number => kinds(fly(fx, 60), OUTBOX_MISSILE_INTERCEPTOR_LAUNCHED).length;
    expect(count(base())).toBeGreaterThanOrEqual(1);
    const unfinished = base();
    unfinished.state.structures.readyTick[unfinished.sams[0] as number] = unfinished.state.tick + 5000;
    expect(count(unfinished)).toBe(0);
    const far = base();
    far.state.structures.cell[far.sams[0] as number] = at(400, 250); // 100 cells from the flight
    expect(count(far)).toBe(0);
    const own = base();
    own.state.structures.owner[own.sams[0] as number] = 1; // the launcher's own SAM
    expect(count(own)).toBe(0);
  });

  it('too late: a warhead whose blast comes before an interceptor could reach it is not fired at; the same site fires when there is time', () => {
    const fx = missileFixture('ridge-cruise', 1, false);
    const s = fx.state;
    const sam = fx.sams[0] as number; // (310, 250), radius 24
    const samCell = s.structures.cell[sam] as number;
    // time enough: 22 cells from the site, closing at 2 cells a tick with 8 ticks left; the interceptor flies 6 cells a tick
    s.missiles.add(0, 1, MISSILE_FISSION, fx.silo, s.tick - 4, s.tick + 8, at(280, 250), at(304, 250));
    expect(meetingTick(s, 0, samCell, 24, s.tick)).toBeGreaterThan(s.tick);
    interceptPhase(s);
    expect(s.missiles.interceptorCount).toBe(1);
    s.missiles.remove(0);
    s.missiles.interceptorCount = 0;
    s.structures.salvoTick[sam] = 0;
    // no time: 22 cells from the site with one tick left (the interceptor would have flown 6)
    s.missiles.add(0, 1, MISSILE_FISSION, fx.silo, s.tick - 9, s.tick + 1, at(270, 250), at(290, 250));
    expect(meetingTick(s, 0, samCell, 24, s.tick)).toBe(0);
    interceptPhase(s);
    expect(s.missiles.interceptorCount).toBe(0);
    expect(s.structures.salvoTick[sam], 'a salvo that was not fired is not spent').toBe(0);
  });
});

describe('radius and order', () => {
  it('a warhead flying away from a site is not chased beyond its radius (a level 999 site, 17 cells from a Fission warhead that moves away; a warhead that comes closer is engaged)', () => {
    const fx = missileFixture('ridge-cruise', 1, false);
    const s = fx.state;
    const sam = fx.sams[0] as number;
    s.structures.level[sam] = 999;
    const r = samRadiusCells(999, false);
    expect(r, 'the radius is the top of the curve').toBeGreaterThan(30);
    s.missiles.add(0, 1, MISSILE_FISSION, fx.silo, s.tick, s.tick + 15, at(293, 250), at(250, 250)); // away from (310, 250)
    interceptPhase(s);
    expect(s.missiles.interceptorCount, 'it would catch the warhead only outside the radius').toBe(0);
    s.missiles.remove(0);
    s.missiles.add(0, 1, MISSILE_FISSION, fx.silo, s.tick, s.tick + 15, at(293, 250), at(305, 250)); // towards it
    interceptPhase(s);
    expect(s.missiles.interceptorCount).toBe(1);
  });

  it('the rows of one warhead come out by ascending site id whatever the order of the buckets (a lower id in a southern bucket still comes first)', () => {
    const fx = missileFixture('sam-stack', 1);
    const s = fx.state;
    const [a, b] = [fx.sams[0] as number, fx.sams[1] as number];
    s.structures.remove(fx.sams[2] as number);
    s.structures.cell[a] = at(326, 256); // bucket row 8
    s.structures.cell[b] = at(322, 244); // bucket row 7, visited first
    s.missiles.add(0, 1, MISSILE_FISSION, fx.silo, s.tick - 10, s.tick + 20, at(296, 250), fx.target);
    interceptPhase(s);
    expect(s.missiles.interceptorCount).toBe(2);
    expect([s.missiles.iSam[0], s.missiles.iSam[1]]).toEqual([a, b]);
  });
});

describe('the shared salvo clock, one interceptor per warhead and site', () => {
  it('a site fires once, spends the salvo (the helicopter clock and period) and does not fire again at the same warhead; a spent clock holds it back', () => {
    const fx = missileFixture('ridge-cruise', 1, false);
    const s = fx.state;
    const sam = fx.sams[0] as number;
    const samCell = s.structures.cell[sam] as number;
    s.missiles.add(0, 1, MISSILE_FISSION, fx.silo, s.tick - 4, s.tick + 8, at(280, 250), at(304, 250));
    expect(meetingTick(s, 0, samCell, 24, s.tick), 'the geometry allows a shot now').toBeGreaterThan(0);
    s.structures.salvoTick[sam] = s.tick + 1; // busy with a helicopter salvo
    interceptPhase(s);
    expect(s.missiles.interceptorCount, 'the clock holds it back').toBe(0);
    s.tick += 1;
    interceptPhase(s);
    expect(s.missiles.interceptorCount).toBe(1);
    expect(s.structures.salvoTick[sam]).toBe(s.tick + SAM_SALVO_PERIOD_TICKS);
    s.structures.salvoTick[sam] = 0; // even with a free clock it never fires a second interceptor at the same warhead
    s.tick += 1;
    interceptPhase(s);
    expect(s.missiles.interceptorCount).toBe(1);
    // a second warhead takes the next salvo
    s.missiles.add(1, 1, MISSILE_FISSION, fx.silo, s.tick - 4, s.tick + 8, at(280, 252), at(304, 252));
    interceptPhase(s);
    expect(s.missiles.interceptorCount).toBe(2);
    expect([s.missiles.iMissile[0], s.missiles.iMissile[1]]).toEqual([0, 1]);
  });

  it('the interceptor table is bounded and a removed missile takes its rows with it', () => {
    const fx = missileFixture('ridge-cruise', 1, false);
    const s = fx.state;
    const m = s.missiles;
    for (let i = 0; i < INTERCEPTOR_CAPACITY; i++) expect(m.addInterceptor(i % 64, i, 0, 5, 0)).toBe(true);
    expect(m.addInterceptor(0, 999, 0, 5, 0)).toBe(false);
    m.interceptorCount = 0;
    m.add(2, 1, MISSILE_FISSION, fx.silo, 0, 40, at(250, 250), at(298, 250));
    m.add(3, 1, MISSILE_FISSION, fx.silo, 0, 40, at(250, 250), at(298, 250));
    m.addInterceptor(2, 10, 0, 5, 1);
    m.addInterceptor(3, 10, 0, 6, 0);
    m.addInterceptor(2, 11, 0, 7, 0);
    m.remove(2);
    expect([m.interceptorCount, m.iMissile[0], m.iSam[0], m.iMeet[0]]).toEqual([1, 3, 10, 6]);
  });
});

describe('outcomes: applied at the meeting tick, a shot-down warhead never blows up', () => {
  it('over 20 seeds of sam-stack: shot down iff no blast; the interception happens exactly at the earliest meeting tick of a hit; both outcomes occur; nothing changes owner when shot down', () => {
    let down = 0;
    let through = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const r = runMissiles('sam-stack', seed);
      const launches = kinds(r.events, OUTBOX_MISSILE_INTERCEPTOR_LAUNCHED);
      const shot = kinds(r.events, OUTBOX_MISSILE_INTERCEPTED);
      const blast = kinds(r.events, OUTBOX_MISSILE_DETONATED);
      expect(shot.length + blast.length, `seed ${seed}: exactly one end`).toBe(1);
      const hitMeets = launches.filter((e) => (e.b & 1) === 1).map((e) => e.b >> 1);
      if (shot.length === 1) {
        down++;
        expect(hitMeets.length).toBeGreaterThan(0);
        expect(shot[0]?.tick, `seed ${seed}`).toBe(Math.min(...hitMeets));
        expect(r.painted, 'no cell changed owner').toBe(0);
        expect(r.lines.at(-1)).toContain('fallout 0 cells');
      } else {
        through++;
        expect(blast[0]?.tick, `seed ${seed}`).toBeGreaterThanOrEqual(Math.max(0, ...launches.map((e) => e.b >> 1)));
        expect(r.painted).toBeGreaterThan(0);
      }
    }
    expect(down).toBeGreaterThan(5);
    expect(through).toBeGreaterThanOrEqual(1);
  });

  it('a hit whose meeting tick is the blast tick itself still saves the target (the interception runs before the blast); a miss does not', () => {
    for (const hit of [1, 0]) {
      const fx = missileFixture('ridge-cruise', 1, false);
      const s = fx.state;
      s.missiles.add(0, 1, MISSILE_FISSION, fx.silo, s.tick - 5, s.tick, at(280, 250), at(298, 250));
      s.missiles.addInterceptor(0, fx.sams[0] as number, s.tick - 2, s.tick, hit);
      s.structures.salvoTick[fx.sams[0] as number] = s.tick + 50;
      step(s, { turn: s.tick, intents: [] });
      const ev = s.outbox.drain();
      expect(kinds(ev, OUTBOX_MISSILE_INTERCEPTED), `hit ${hit}`).toHaveLength(hit);
      expect(kinds(ev, OUTBOX_MISSILE_DETONATED), `hit ${hit}`).toHaveLength(1 - hit);
      expect(s.missiles.liveCount).toBe(0);
    }
  });

  it('events 25 and 26 carry the missile, the site and the meeting facts', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const fx = missileFixture('sam-stack', seed);
      const ev = fly(fx, 60);
      const shot = kinds(ev, OUTBOX_MISSILE_INTERCEPTED)[0];
      if (shot === undefined) continue;
      const sam = shot.b >> 6;
      expect(fx.sams).toContain(sam);
      expect(shot.b & 63).toBe(0); // the missile slot
      const own = kinds(ev, OUTBOX_MISSILE_INTERCEPTOR_LAUNCHED).find((e) => (e.a >> 6) === sam);
      expect((own?.a ?? -1) & 63).toBe(0);
      expect(((own?.b ?? 0) & 1)).toBe(1);
      expect((own?.b ?? 0) >> 1).toBe(shot.tick);
      const x = shot.a % W;
      expect(x, 'over the flight, west of the target').toBeLessThan(fx.target % W);
      expect(x).toBeGreaterThan(250);
      return;
    }
    throw new Error('no seed shot the warhead down');
  });
});

describe('relations during the flight', () => {
  /** A seed of sam-stack in which a site\'s interceptor is rolled to hit. */
  function hitSeed(): number {
    for (let seed = 1; seed <= 40; seed++) {
      const r = runMissiles('sam-stack', seed);
      if (kinds(r.events, OUTBOX_MISSILE_INTERCEPTED).length === 1) return seed;
    }
    throw new Error('no seed');
  }

  it('a truce signed before the warhead is in reach: nobody fires', () => {
    const fx = missileFixture('sam-stack', hitSeed());
    const s = fx.state;
    step(s, { turn: s.tick, intents: [withId(launchMissileBody(0, fx.silo, fx.cls, fx.target), 1)] });
    for (let i = 0; i < 5; i++) step(s, { turn: s.tick, intents: [] });
    s.diplo.setRelation(1, 2, RELATION_TRUCE, s.tick + 100000);
    const ev: OutboxEvent[] = [];
    for (let i = 0; i < 40; i++) {
      step(s, { turn: s.tick, intents: [] });
      ev.push(...s.outbox.drain());
    }
    expect(kinds(ev, OUTBOX_MISSILE_INTERCEPTOR_LAUNCHED)).toHaveLength(0);
    expect(kinds(ev, OUTBOX_MISSILE_DETONATED)).toHaveLength(1);
  });

  it('a truce signed while an interceptor is in the air voids its hit; without the truce the same run shoots the warhead down', () => {
    const seed = hitSeed();
    const run = (truce: boolean): OutboxEvent[] => {
      const fx = missileFixture('sam-stack', seed);
      const s = fx.state;
      step(s, { turn: s.tick, intents: [withId(launchMissileBody(0, fx.silo, fx.cls, fx.target), 1)] });
      const ev: OutboxEvent[] = [];
      for (let i = 0; i < 80; i++) {
        step(s, { turn: s.tick, intents: [] });
        ev.push(...s.outbox.drain());
        if (truce && s.missiles.interceptorCount > 0 && s.diplo.relationOf(1, 2) !== RELATION_TRUCE) s.diplo.setRelation(1, 2, RELATION_TRUCE, s.tick + 100000);
      }
      return ev;
    };
    expect(kinds(run(false), OUTBOX_MISSILE_INTERCEPTED)).toHaveLength(1);
    const treaty = run(true);
    expect(kinds(treaty, OUTBOX_MISSILE_INTERCEPTED)).toHaveLength(0);
    expect(kinds(treaty, OUTBOX_MISSILE_DETONATED)).toHaveLength(1);
  });

  it('a site that is lost before the meeting tick loses its hit', () => {
    const seed = hitSeed();
    const fx = missileFixture('sam-stack', seed);
    const s = fx.state;
    step(s, { turn: s.tick, intents: [withId(launchMissileBody(0, fx.silo, fx.cls, fx.target), 1)] });
    let removed = false;
    const ev: OutboxEvent[] = [];
    for (let i = 0; i < 80; i++) {
      step(s, { turn: s.tick, intents: [] });
      ev.push(...s.outbox.drain());
      if (!removed && s.missiles.interceptorCount > 0) {
        removed = true;
        for (const sam of fx.sams) s.structures.remove(sam);
      }
    }
    expect(removed).toBe(true);
    expect(kinds(ev, OUTBOX_MISSILE_INTERCEPTED)).toHaveLength(0);
    expect(kinds(ev, OUTBOX_MISSILE_DETONATED)).toHaveLength(1);
  });
});

describe('previewThreat', () => {
  const view = (fx: MissileFixture): StateView => new StateView(fx.state);

  it('lists the hostile finished SAM sites whose radius the flight crosses, by id, with the class chance and the tick of entry', () => {
    const fx = missileFixture('ridge-cruise', 1);
    const sites = previewThreat(view(fx), at(250, 250), fx.target, MISSILE_TACTICAL);
    expect(sites.map((x) => x.structure)).toEqual([fx.sams[0]]);
    expect(sites[0]?.pct).toBe(75);
    expect(sites[0]?.fromTick).toBeGreaterThan(5);
    expect(sites[0]?.fromTick).toBeLessThan(25);
    expect(previewThreat(view(fx), at(250, 250), fx.target, MISSILE_FISSION)[0]?.pct).toBe(60);
    expect(previewThreat(view(fx), at(250, 250), fx.target, MISSILE_FUSION)[0]?.pct).toBe(40);
    // a flight that stays 50 cells from the site
    expect(previewThreat(view(fx), at(250, 250), at(250, 205), MISSILE_TACTICAL)).toEqual([]);
  });

  it('leaves out an ally\'s or a truce partner\'s site, the launcher\'s own site and an unfinished site', () => {
    const fx = missileFixture('ridge-cruise', 1);
    const s = fx.state;
    const sam = fx.sams[0] as number;
    s.diplo.setRelation(1, 2, RELATION_TRUCE, s.tick + 100000);
    expect(previewThreat(view(fx), at(250, 250), fx.target, MISSILE_TACTICAL)).toEqual([]);
    s.diplo.setRelation(1, 2, 0, 0);
    expect(previewThreat(view(fx), at(250, 250), fx.target, MISSILE_TACTICAL)).toHaveLength(1);
    s.structures.owner[sam] = 1;
    expect(previewThreat(view(fx), at(250, 250), fx.target, MISSILE_TACTICAL)).toEqual([]);
    s.structures.owner[sam] = 2;
    s.structures.readyTick[sam] = s.tick + 100;
    expect(previewThreat(view(fx), at(250, 250), fx.target, MISSILE_TACTICAL)).toEqual([]);
  });

  it('sam-stack: three sites, in id order', () => {
    const fx = missileFixture('sam-stack', 1);
    expect(previewThreat(view(fx), at(250, 250), fx.target, MISSILE_FISSION).map((x) => x.structure)).toEqual([...fx.sams]);
  });
});

describe('state: interceptors in the air', () => {
  /** sam-stack run until an interceptor is in the air whose meeting tick is still ahead. */
  function withInterceptor(seed: number): GameState {
    const fx = missileFixture('sam-stack', seed);
    const s = fx.state;
    step(s, { turn: s.tick, intents: [withId(launchMissileBody(0, fx.silo, fx.cls, fx.target), 1)] });
    for (let i = 0; i < 60; i++) {
      step(s, { turn: s.tick, intents: [] });
      const m = s.missiles;
      if (m.interceptorCount > 0 && (m.iMeet[0] as number) > s.tick) return s;
    }
    throw new Error('no interceptor in the air');
  }

  it('serialize / deserialize with interceptors in the air continues exactly like a straight run (the hit included)', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const a = withInterceptor(seed);
      const bytes = serialize(a);
      const r = deserialize(bytes);
      expect(r.ok, `seed ${seed}`).toBe(true);
      if (!r.ok) return;
      const m = r.state.missiles;
      expect(m.interceptorCount).toBe(a.missiles.interceptorCount);
      expect(Array.from(m.iMeet.slice(0, m.interceptorCount))).toEqual(Array.from(a.missiles.iMeet.slice(0, m.interceptorCount)));
      expect(hashState(r.state)).toBe(hashState(a));
      for (let i = 0; i < 40; i++) {
        step(a, { turn: a.tick, intents: [] });
        step(r.state, { turn: r.state.tick, intents: [] });
      }
      expect(hashState(r.state), `seed ${seed}`).toBe(hashState(a));
    }
  });

  it('every field of an interceptor row is in the hash', () => {
    const s = withInterceptor(1);
    const h = hashState(s);
    const m = s.missiles;
    for (const f of ['iMissile', 'iSam', 'iFire', 'iMeet', 'iHit'] as const) {
      const old = m[f][0] as number;
      m[f][0] = old + 1;
      expect(hashState(s), f).not.toBe(h);
      m[f][0] = old;
    }
    expect(hashState(s)).toBe(h);
    m.interceptorCount--;
    expect(hashState(s), 'the count').not.toBe(h);
  });

  it('deserialize refuses an interceptor row that cannot be real (each with the control)', () => {
    const s = withInterceptor(1);
    const bytes = serialize(s);
    const lay = saveLayout(bytes, 2);
    const m = s.missiles;
    const end = lay.emptyAirBlockAt(s.structures.liveCount, s.structures.districtCount);
    const countAt = end - 4 - m.interceptorCount * 20;
    const v = new DataView(bytes.buffer, bytes.byteOffset);
    expect(v.getUint32(countAt, true)).toBe(m.interceptorCount);
    const failOf = (b: Uint8Array): string => {
      const r = deserialize(b);
      return r.ok ? 'ok' : r.error;
    };
    const patch = (edits: Array<[number, number]>): Uint8Array => {
      const out = bytes.slice();
      const dv = new DataView(out.buffer);
      for (const [p, val] of edits) dv.setUint32(p, val, true);
      return out;
    };
    expect(failOf(bytes)).toBe('ok');
    const row = countAt + 4;
    const fire = v.getUint32(row + 8, true);
    const cases: Array<[string, Array<[number, number]>]> = [
      ['a count beyond the capacity', [[countAt, INTERCEPTOR_CAPACITY + 1]]],
      ['a missile slot that is not live', [[row, 63]]],
      ['a missile slot beyond the table', [[row, 64]]],
      ['a site id beyond the structure table', [[row + 4, 4096]]],
      ['a fire tick in the future', [[row + 8, s.tick + 1]]],
      ['a fire tick before the launch', [[row + 8, 0]]],
      ['a meeting tick not after the fire tick', [[row + 12, fire]]],
      ['a meeting tick after the blast', [[row + 12, (m.impactTick[0] as number) + 1]]],
      ['a hit flag of 2', [[row + 16, 2]]],
    ];
    for (const [name, edits] of cases) expect(failOf(patch(edits)), name).toBe('air-range');
  });
});

describe('the events reach the page', () => {
  it('25 and 26 arrive in ViewSnapshot.events exactly once each, in order', async () => {
    let seed = 1;
    for (; seed <= 40; seed++) if (kinds(runMissiles('sam-stack', seed).events, OUTBOX_MISSILE_INTERCEPTED).length === 1) break;
    const fx = missileFixture('sam-stack', seed);
    const host = new MainThreadHost(fx.state);
    const { mirror } = await ViewMirror.attach(host);
    host.submitIntent(launchMissileBody(0, fx.silo, fx.cls, fx.target));
    const seen: number[] = [];
    for (let i = 0; i < 60; i++) {
      host.advance(100);
      for (let k = 0; k < mirror.events.length; k++) seen.push(mirror.events.kindAt(k));
      mirror.clearEvents();
    }
    const launched = seen.filter((k) => k === OUTBOX_MISSILE_INTERCEPTOR_LAUNCHED).length;
    expect(launched).toBeGreaterThanOrEqual(1);
    expect(seen.filter((k) => k === OUTBOX_MISSILE_INTERCEPTED)).toHaveLength(1);
    expect(seen.filter((k) => k === OUTBOX_MISSILE_DETONATED)).toHaveLength(0);
    expect(seen.indexOf(OUTBOX_MISSILE_INTERCEPTOR_LAUNCHED)).toBeLessThan(seen.indexOf(OUTBOX_MISSILE_INTERCEPTED));
    expect(mirror.missiles.liveCount).toBe(0);
  });
});
