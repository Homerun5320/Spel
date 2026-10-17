// Fix-6A1 (audit 5): the rule fixes of the ships, the landing price, the interceptors and the missile arc, and the test holes the audit found in the ship and interception rules. Every test
// drives the real code (checkLaunchShip through validateLaunchShip / applyLaunchShip, shipPhase, landTroops / performLanding, interceptPhase, missilePosition); the mutant that each one
// kills is tabulated in the Fix-6A1 block of docs/DECISIONS.md.
import { describe, expect, it } from 'vitest';
import { applyDelete } from '../../src/sim/structures';
import { landingCostMilli, performLanding } from '../../src/sim/heliLanding';
import { launchMissileBody, REJECT_NONE, REJECT_SHIP_NO_ROUTE, withId } from '../../src/sim/intents';
import { cellOfVector, cellVector, chordQ15, angleOfChord, flightTicksOf, missilePosition, newTrack, trackOf } from '../../src/sim/missileGeom';
import { interceptPhase } from '../../src/sim/missilePhase';
import { MISSILE_FISSION, MISSILE_FUSION, MISSILE_TACTICAL } from '../../src/sim/missileTable';
import {
  OUTBOX_HELI_LANDED,
  OUTBOX_MISSILE_INTERCEPTED,
  OUTBOX_MISSILE_INTERCEPTOR_LAUNCHED,
  OUTBOX_SHIP_LANDED,
  OUTBOX_SHIP_RETURNED,
  type OutboxEvent,
} from '../../src/sim/outbox';
import { FALLOUT_COST_PCT, MISSILE_SPEED_ANGLE_PER_TICK, SAM_SALVO_PERIOD_TICKS, SHIP_ROUTE_MAX_CELLS } from '../../src/sim/rules';
import { QT_PER_TROOP, TECH_FX_CHANNELS } from '../../src/sim/rules';
import { applyLaunchShip, shipPhase } from '../../src/sim/shipPhase';
import { SHIP_ROUTE_NONE, SHIP_ROUTE_OK, ShipRoute, findPortRoute, findShipRoute, portWaterCell } from '../../src/sim/shipRoute';
import { validateLaunchShip } from '../../src/sim/shipRules';
import { rebuildAggregates, type GameState } from '../../src/sim/state';
import { step } from '../../src/sim/step';
import { STRUCT_POST, STRUCT_PORT, STRUCT_SAM } from '../../src/sim/structureRules';
import { TECH_FX_SAM_SALVO } from '../../src/sim/techTable';
import { CLASS_DEEP_SEA, CLASS_PLAINS, CLASS_SHALLOWS } from '../../src/sim/terrain';
import { StateView } from '../../src/sim/view';
import { missileFixture } from '../../tools/sim/missiles';
import { SHIP_W, shipFixture } from '../../tools/sim/shipLanding';

const SEA = CLASS_DEEP_SEA;
const LAND = CLASS_PLAINS;

/** A rectangular map of one class with a land column at both edges (no wrap) unless `wrap`. */
function grid(w: number, h: number, fill: number, wrap = false): { w: number; h: number; t: Uint8Array; at: (x: number, y: number) => number } {
  const t = new Uint8Array(w * h).fill(fill);
  if (!wrap) for (let y = 0; y < h; y++) {
    t[y * w] = LAND;
    t[y * w + w - 1] = LAND;
  }
  return { w, h, t, at: (x, y) => y * w + x };
}

describe('[0.0] a ship leaves a Port from the best of ALL its water neighbours', () => {
  it('a 1-cell pocket north of the Port and open sea east of it: the route is found from the east cell (findPortRoute), while the first neighbour alone has none', () => {
    const m = grid(64, 32, LAND);
    for (let y = 2; y < 30; y++) for (let x = 20; x < 60; x++) m.t[m.at(x, y)] = SEA;
    // The Port at (18, 10): north (18, 9) is a pocket (its only exits are land), east (19, 10) opens into the sea.
    m.t[m.at(18, 9)] = SEA;
    m.t[m.at(19, 9)] = LAND;
    m.t[m.at(19, 10)] = SEA;
    m.t[m.at(19, 11)] = SEA;
    m.t[m.at(20, 10)] = SEA;
    const port = m.at(18, 10);
    expect(portWaterCell(m.w, m.h, m.t, port), 'the old rule starts in the pocket').toBe(m.at(18, 9));
    const target = m.at(40, 10);
    const r = new ShipRoute();
    expect(findShipRoute(m.w, m.h, m.t, m.at(18, 9), target, r), 'from the pocket there is no way out').toBe(SHIP_ROUTE_NONE);
    expect(findPortRoute(m.w, m.h, m.t, port, target, r)).toBe(SHIP_ROUTE_OK);
    expect(r.cells[0], 'waypoint 0 is the water neighbour that works').toBe(m.at(19, 10));
  });

  it('LaunchShip: the page-side validateLaunchShip and the sim agree that a Port with a pocket on its north side can send a ship (REJECT_NONE, not REJECT_SHIP_NO_ROUTE)', () => {
    const fx = shipFixture(0, { island: false });
    const s = fx.state;
    const W = SHIP_W;
    const px = (s.structures.cell[fx.port] as number) % W;
    const py = ((s.structures.cell[fx.port] as number) - px) / W;
    s.terrain[(py - 1) * W + px] = SEA; // north of the Port: a pocket ...
    s.terrain[(py - 1) * W + px + 1] = LAND; // ... closed on its east side
    s.terrain[(py - 2) * W + px] = LAND;
    expect(portWaterCell(W, s.height, s.terrain, s.structures.cell[fx.port] as number), 'the first neighbour is the pocket').toBe((py - 1) * W + px);
    const page = validateLaunchShip(new StateView(s), 0, fx.port, fx.target, 100);
    expect(page).toBe(REJECT_NONE);
    expect(applyLaunchShip(s, 0, fx.port, fx.target, 100)).toBe(REJECT_NONE);
    expect(s.ships.liveCount).toBe(1);
    expect(s.ships.route[0], 'the ship starts from the east cell').toBe(py * W + px + 1);
  });

  it('a Port whose only water is a pocket still has no route (REJECT_SHIP_NO_ROUTE): the fix adds starts, it does not invent a way', () => {
    const fx = shipFixture(0, { island: false });
    const s = fx.state;
    const W = SHIP_W;
    const c = s.structures.cell[fx.port] as number;
    s.terrain[c + 1] = LAND; // the east neighbour (the sea) is land now
    s.terrain[c - W] = SEA;
    s.terrain[c - W + 1] = LAND;
    s.terrain[c - 2 * W] = LAND;
    s.terrain[c - W - 1] = LAND;
    s.terrain[c + W] = LAND;
    expect(validateLaunchShip(new StateView(s), 0, fx.port, fx.target, 100)).toBe(REJECT_SHIP_NO_ROUTE);
  });
});

describe('[0.1] the A* plateau: a clear sea voyage costs about its length in expansions, not dy x (dx - dy)', () => {
  it('open sea (300,150) to (550,250): routed with far fewer expansions than SHIP_ROUTE_MAX_CELLS, in one straight leg; (300,150) to (570,285) and (630,230) used to be refused and now route', () => {
    const m = grid(1024, 512, SEA, true);
    const r = new ShipRoute();
    for (const [tx, ty] of [[550, 250], [570, 285], [630, 230]] as const) {
      expect(findShipRoute(m.w, m.h, m.t, m.at(300, 150), m.at(tx, ty), r), `to ${tx},${ty}`).toBe(SHIP_ROUTE_OK);
      expect(r.expanded, `to ${tx},${ty}`).toBeLessThan(SHIP_ROUTE_MAX_CELLS / 8);
      expect(r.count, 'a clear sea is one straight leg').toBe(2);
    }
  });

  it('the answer is a pure function of the map: the same call twice gives the same waypoints and expansions', () => {
    const m = grid(256, 128, SEA, true);
    m.t[m.at(100, 60)] = LAND;
    const a = new ShipRoute();
    const b = new ShipRoute();
    findShipRoute(m.w, m.h, m.t, m.at(10, 10), m.at(200, 100), a);
    findShipRoute(m.w, m.h, m.t, m.at(10, 10), m.at(200, 100), b);
    expect(Array.from(a.cells.subarray(0, a.count))).toEqual(Array.from(b.cells.subarray(0, b.count)));
    expect(a.expanded).toBe(b.expanded);
  });
});

describe('[0.2] fallout makes a landing dearer, by sea and by air', () => {
  it('landingCostMilli: a fallout cell costs FALLOUT_COST_PCT percent, an expired one does not', () => {
    const s = missileFixture('fusion-silo', 1).state;
    const cell = 170 * 1024 + 200;
    const plain = landingCostMilli(s, cell, 0, 1);
    s.missiles.setFallout(cell, s.tick + 1000);
    expect(landingCostMilli(s, cell, 0, 1)).toBe(Math.floor((plain * FALLOUT_COST_PCT) / 100));
    s.missiles.setFallout(cell, s.tick); // ends at the tick: no longer fallout
    expect(landingCostMilli(s, cell, 0, 1)).toBe(plain);
  });

  /** Troops paid for a landing of 600 on the neutral 3 x 3 block round (145, 24), by helicopter (performLanding) or by ship (applyLaunchShip + shipPhase), with or without fallout on it. */
  function paid(by: 'heli' | 'ship', fallout: boolean): { paid: number; cells: number } {
    const fx = shipFixture(0, { island: false });
    const s = fx.state;
    const W = SHIP_W;
    for (let x = 144; x < 160; x++) for (let y = 0; y < 64; y++) s.owner[y * W + x] = 0;
    rebuildAggregates(s);
    if (fallout) for (let y = 22; y <= 26; y++) for (let x = 143; x <= 147; x++) s.missiles.setFallout(y * W + x, s.tick + 100000);
    const lz = 24 * W + 145;
    const before = s.troops[1] as number;
    const events: OutboxEvent[] = [];
    if (by === 'heli') {
      const h = s.helis.addBuilding(1, 0, s.tick, s.tick);
      s.helis.target[h] = lz + 1;
      s.helis.load[h] = 600;
      s.troops[1] = before - 600 * QT_PER_TROOP;
      performLanding(s, h);
      events.push(...s.outbox.drain());
    } else {
      expect(applyLaunchShip(s, 0, fx.port, lz, 600)).toBe(REJECT_NONE);
      for (let i = 0; i < 400 && !events.some((e) => e.kind === OUTBOX_SHIP_LANDED); i++) {
        shipPhase(s);
        s.tick++;
        events.push(...s.outbox.drain());
      }
    }
    const landed = events.find((e) => e.kind === (by === 'heli' ? OUTBOX_HELI_LANDED : OUTBOX_SHIP_LANDED)) as OutboxEvent;
    const left = (s.troops[1] as number) + s.attacks.list.reduce((n, a) => n + a.troops, 0);
    return { paid: before - left, cells: landed.b };
  }

  for (const by of ['heli', 'ship'] as const) {
    it(`${by}: the same landing on fallout pays about ${FALLOUT_COST_PCT} percent of the troops it pays without (all nine cells either way)`, () => {
      const clean = paid(by, false);
      const dirty = paid(by, true);
      expect(clean.cells).toBe(9);
      expect(dirty.cells).toBe(9);
      const ratio = dirty.paid / clean.paid;
      expect(ratio).toBeGreaterThan((FALLOUT_COST_PCT / 100) * 0.95);
      expect(ratio).toBeLessThan((FALLOUT_COST_PCT / 100) * 1.05);
    });
  }
});

/** The sam-stack fixture with the Fission warhead put in by hand next to a site, so the rows below are fully controlled: slot 0 = the missile, flying (280,250) -> (304,250). */
function manualRaid(): { fx: ReturnType<typeof missileFixture>; s: GameState; sam: number; samCell: number } {
  const fx = missileFixture('ridge-cruise', 1, false);
  const s = fx.state;
  const sam = fx.sams[0] as number;
  s.missiles.add(0, 1, MISSILE_FISSION, fx.silo, s.tick - 4, s.tick + 8, 250 * 1024 + 280, 250 * 1024 + 304);
  return { fx, s, sam, samCell: s.structures.cell[sam] as number };
}

describe('[0.3] interceptors and a recycled SAM id', () => {
  it('a site destroyed in flight (a real Delete) and rebuilt FINISHED in the same slot voids the hit; the new site can then fire at the warhead itself', () => {
    const { s, sam, samCell } = manualRaid();
    expect(s.missiles.addInterceptor(0, sam, s.tick, s.tick + 1, 1)).toBe(true);
    expect(applyDelete(s, 1, sam)).toBe(REJECT_NONE);
    expect(s.missiles.interceptorCount, 'the rows of the destroyed site are dropped at once').toBe(0);
    const id = s.structures.add(STRUCT_SAM, 2, samCell, 0); // finished long ago, takes the recycled id
    expect(id).toBe(sam);
    s.tick += 1;
    interceptPhase(s);
    const ev = s.outbox.drain();
    expect(ev.filter((e) => e.kind === OUTBOX_MISSILE_INTERCEPTED), 'the old hit is not credited to the new site').toHaveLength(0);
    expect(s.missiles.liveCount, 'the warhead flies on').toBe(1);
    expect(s.missiles.hasInterceptor(0, sam), 'the new site fired its own interceptor').toBe(true);
    expect(s.missiles.iFire[0]).toBe(s.tick);
  });

  it('a hit whose site is not finished at the meeting tick does not count (a table-level remove and add leaves the old row; the readyTick guard still voids it)', () => {
    const { s, sam, samCell } = manualRaid();
    expect(s.missiles.addInterceptor(0, sam, s.tick, s.tick + 1, 1)).toBe(true);
    s.structures.remove(sam); // bypasses the hooks: the row stays
    expect(s.structures.add(STRUCT_SAM, 2, samCell, s.tick + 1000)).toBe(sam); // unfinished
    s.tick += 1;
    interceptPhase(s);
    expect(s.outbox.drain().filter((e) => e.kind === OUTBOX_MISSILE_INTERCEPTED)).toHaveLength(0);
    expect(s.missiles.liveCount).toBe(1);
  });

  it('the control: the same row of a finished site that was never touched does shoot the warhead down', () => {
    const { s, sam } = manualRaid();
    expect(s.missiles.addInterceptor(0, sam, s.tick, s.tick + 1, 1)).toBe(true);
    s.tick += 1;
    interceptPhase(s);
    expect(s.outbox.drain().filter((e) => e.kind === OUTBOX_MISSILE_INTERCEPTED)).toHaveLength(1);
    expect(s.missiles.liveCount).toBe(0);
  });
});

describe('[2.4] a missile flies at a constant angular speed', () => {
  const W = 1024;
  const H = 512;
  const row = 256;
  /** The fraction of the arc (a to b) flown at `tick`, measured with real trigonometry. */
  function flown(start: number, target: number, f: number, tick: number): number {
    const a = new Int32Array(3);
    const b = new Int32Array(3);
    const p = new Int32Array(3);
    cellVector(start, W, H, a, 0);
    cellVector(target, W, H, b, 0);
    missilePosition(start, target, 0, f, tick, W, H, p);
    const ang = (u: Int32Array, v: Int32Array): number => {
      const d = ((u[0] as number) * (v[0] as number) + (u[1] as number) * (v[1] as number) + (u[2] as number) * (v[2] as number)) / (32768 * 32768);
      return Math.acos(Math.max(-1, Math.min(1, d)));
    };
    expect(Math.abs(Math.hypot(p[0] as number, p[1] as number, p[2] as number) - 32768), 'a unit vector').toBeLessThan(4);
    return ang(a, p) / Math.PI; // /pi: the arc of the antipode is 1
  }
  for (const d of [483, 512, 300]) {
    it(`a flight of ${d} cells along the equator row: the position at 25 / 50 / 75 percent of the time is 25 / 50 / 75 percent of the arc (+-1 percent of the arc)`, () => {
      const start = row * W + 100;
      const target = row * W + ((100 + d) % W);
      const track = trackOf(start, target, W, H, MISSILE_FUSION, newTrack());
      const f = track.ticks;
      expect(f, 'the flight time is the arc over the speed, as before').toBe(flightTicksOf(angleOfChord(chordQ15(Int32Array.from([...vec(start)]), 0, Int32Array.from([...vec(target)]), 0)), MISSILE_FUSION));
      const arc = (track.angle / 32768); // 1 = the antipode
      for (const u of [0.25, 0.5, 0.75]) {
        const tick = Math.round(f * u);
        const got = flown(start, target, f, tick) / arc;
        expect(Math.abs(got - tick / f), `d ${d} u ${u}`).toBeLessThan(0.012);
      }
    });
  }

  function vec(cell: number): Int32Array {
    const v = new Int32Array(3);
    cellVector(cell, W, H, v, 0);
    return v;
  }

  it('the start and the end are exactly the cell vectors, before the launch and after the blast too', () => {
    const start = row * W + 100;
    const target = row * W + 583;
    const p = new Int32Array(3);
    missilePosition(start, target, 10, 40, 0, W, H, p);
    expect(Array.from(p)).toEqual(Array.from(vec(start)));
    missilePosition(start, target, 10, 40, 40, W, H, p);
    expect(Array.from(p)).toEqual(Array.from(vec(target)));
    missilePosition(start, target, 10, 40, 99, W, H, p);
    expect(Array.from(p)).toEqual(Array.from(vec(target)));
  });

  it('an arc of exactly 180 degrees has a fixed, repeatable direction (same answer twice, never the noise of a rounding)', () => {
    const start = row * W + 100;
    const target = row * W + 612; // 512 cells of 1024: the antipode in longitude, latitude mirrored (a hair off 180)
    const a = new Int32Array(3);
    const b = new Int32Array(3);
    const tr = trackOf(start, target, W, H, MISSILE_FUSION, newTrack());
    for (let t = 1; t < tr.ticks; t++) {
      missilePosition(start, target, 0, tr.ticks, t, W, H, a);
      missilePosition(start, target, 0, tr.ticks, t, W, H, b);
      expect(Array.from(a)).toEqual(Array.from(b));
      // the position stays on the equatorial great circle plane or the fixed perpendicular: it is a unit vector, which the loop in `flown` checks for the other cases
      expect(Math.abs(Math.hypot(a[0] as number, a[1] as number, a[2] as number) - 32768)).toBeLessThan(4);
    }
    expect(cellOfVector(a[0] as number, a[1] as number, a[2] as number, W, H)).toBeGreaterThanOrEqual(0);
  });

  it('the Fusion missile over 170 degrees no longer sits near the Silo for 40 percent of the flight: after 40 percent of the time it has flown 35 to 45 percent of the arc', () => {
    const start = row * W + 100;
    const target = row * W + 583;
    const tr = trackOf(start, target, W, H, MISSILE_FUSION, newTrack());
    expect(tr.angle).toBeGreaterThan(30000);
    expect(tr.ticks).toBe(Math.floor((tr.angle + (MISSILE_SPEED_ANGLE_PER_TICK[MISSILE_FUSION] as number) - 1) / (MISSILE_SPEED_ANGLE_PER_TICK[MISSILE_FUSION] as number)));
    const got = flown(start, target, tr.ticks, Math.round(tr.ticks * 0.4)) / (tr.angle / 32768);
    expect(got).toBeGreaterThan(0.35);
    expect(got).toBeLessThan(0.45);
  });
});

describe('[1.3] the interception rules the audit found untested', () => {
  it('two interceptors that meet their warheads in the SAME tick both hit', () => {
    const { s, sam } = manualRaid();
    s.missiles.add(1, 1, MISSILE_FISSION, 0, s.tick - 4, s.tick + 8, 252 * 1024 + 280, 252 * 1024 + 304);
    expect(s.missiles.addInterceptor(0, sam, s.tick, s.tick, 1)).toBe(true);
    expect(s.missiles.addInterceptor(1, sam, s.tick, s.tick, 1)).toBe(true);
    interceptPhase(s);
    const hits = s.outbox.drain().filter((e) => e.kind === OUTBOX_MISSILE_INTERCEPTED);
    expect(hits).toHaveLength(2);
    expect(s.missiles.liveCount).toBe(0);
  });

  it('a Defense Post is in the AaIndex but never fires a missile interceptor; the same place with a SAM does', () => {
    const post = manualRaid();
    post.s.structures.remove(post.sam);
    post.s.structures.add(STRUCT_POST, 2, 250 * 1024 + 292, 0); // a Post right under the flight path
    interceptPhase(post.s);
    expect(post.s.missiles.interceptorCount).toBe(0);
    const sam = manualRaid();
    interceptPhase(sam.s);
    expect(sam.s.missiles.interceptorCount).toBe(1);
  });

  it('a SAM whose OWN mask is blocked does not fire at a cruise missile that another site of its owner detects', () => {
    let shots = 0;
    let blockedShots = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const fx = missileFixture('ridge-cruise', seed, true);
      const s = fx.state;
      const blocked = fx.sams[0] as number; // (310,250): behind the ridge x 300..304 seen from the missile
      const open = s.structures.add(STRUCT_SAM, 2, 252 * 1024 + 290, 0);
      expect(open).toBeGreaterThanOrEqual(0);
      step(s, { turn: s.tick, intents: [withId(launchMissileBody(0, fx.silo, MISSILE_TACTICAL, fx.target), 1)] });
      for (let i = 0; i < 60; i++) {
        step(s, { turn: s.tick, intents: [] });
        for (const e of s.outbox.drain()) {
          if (e.kind !== OUTBOX_MISSILE_INTERCEPTOR_LAUNCHED) continue;
          shots++;
          if (e.a >> 6 === blocked) blockedShots++;
        }
      }
    }
    expect(shots, 'the open site does shoot').toBeGreaterThan(0);
    expect(blockedShots, 'the blocked site never does').toBe(0);
  });

  it('TECH_FX_SAM_SALVO shortens the reload after a shot at a missile, and without it the period is the full SAM_SALVO_PERIOD_TICKS', () => {
    const plain = manualRaid();
    interceptPhase(plain.s);
    expect(plain.s.structures.salvoTick[plain.sam]).toBe(plain.s.tick + SAM_SALVO_PERIOD_TICKS);
    const tech = manualRaid();
    tech.s.match.techFx[2 * TECH_FX_CHANNELS + TECH_FX_SAM_SALVO] = 50;
    interceptPhase(tech.s);
    expect(tech.s.structures.salvoTick[tech.sam]).toBe(tech.s.tick + SAM_SALVO_PERIOD_TICKS - Math.floor((SAM_SALVO_PERIOD_TICKS * 50) / 100));
  });

  it('the INTERCEPTED event carries the cell the warhead is over AT the meeting tick (not the tick before)', () => {
    const { s, sam } = manualRaid();
    const meet = s.tick + 2;
    expect(s.missiles.addInterceptor(0, sam, s.tick, meet, 1)).toBe(true);
    s.tick = meet;
    const pos = new Int32Array(3);
    missilePosition(250 * 1024 + 280, 250 * 1024 + 304, s.missiles.launchTick[0] as number, s.missiles.impactTick[0] as number, meet, 1024, 512, pos);
    const want = cellOfVector(pos[0] as number, pos[1] as number, pos[2] as number, 1024, 512);
    missilePosition(250 * 1024 + 280, 250 * 1024 + 304, s.missiles.launchTick[0] as number, s.missiles.impactTick[0] as number, meet - 1, 1024, 512, pos);
    const before = cellOfVector(pos[0] as number, pos[1] as number, pos[2] as number, 1024, 512);
    expect(want, 'the warhead moves at least a cell per tick, so the two ticks differ').not.toBe(before);
    interceptPhase(s);
    const e = s.outbox.drain().find((x) => x.kind === OUTBOX_MISSILE_INTERCEPTED) as OutboxEvent;
    expect(e.a).toBe(want);
  });
});

describe('[1.4] ships over the date line, through the shallows, and the west neighbour of a Port', () => {
  /** The ship fixture re-made: all plains, the sea x 249..255 and 0..7 (the date line in the middle), a finished Port of seat 0 at (248, 24), seat 1 east of the sea. */
  function dateLine(sea: number = CLASS_DEEP_SEA): { s: GameState; port: number; target: number } {
    const fx = shipFixture(0, { island: false });
    const s = fx.state;
    const W = SHIP_W;
    s.structures.remove(fx.port);
    s.terrain.fill(CLASS_PLAINS);
    for (let y = 0; y < 64; y++) {
      for (let x = 249; x < 256; x++) s.terrain[y * W + x] = sea;
      for (let x = 0; x < 8; x++) s.terrain[y * W + x] = sea;
    }
    for (let c = 0; c < W * 64; c++) {
      const x = c % W;
      s.owner[c] = x >= 200 && x <= 248 ? 1 : x >= 8 && x <= 60 ? 2 : 0;
    }
    rebuildAggregates(s);
    const port = s.structures.add(STRUCT_PORT, 1, 24 * W + 248, 0);
    return { s, port, target: 24 * W + 8 };
  }

  it('a voyage over the date line: one straight leg east, landing in time, home in time, the ship x always inside the map', () => {
    const { s, port, target } = dateLine();
    const W = SHIP_W;
    const t0 = s.tick;
    expect(validateLaunchShip(new StateView(s), 0, port, target, 100)).toBe(REJECT_NONE);
    expect(applyLaunchShip(s, 0, port, target, 100)).toBe(REJECT_NONE);
    expect(s.ships.routeLen[0], 'the line over the date line is clear: two waypoints').toBe(2);
    let landed = -1;
    let home = -1;
    for (let i = 0; i < 400 && home < 0; i++) {
      shipPhase(s);
      s.tick++;
      if (s.ships.owner[0] !== 0) {
        const x = s.ships.x[0] as number;
        expect(x >= 0 && x < W * 256, `x ${x} at ${i}`).toBe(true);
      }
      for (const e of s.outbox.drain()) {
        if (e.kind === OUTBOX_SHIP_LANDED && landed < 0) landed = s.tick - t0;
        if (e.kind === OUTBOX_SHIP_RETURNED) home = s.tick - t0;
      }
    }
    expect(landed, 'the 13 cells cross in about 104 ticks, then the unloading').toBeGreaterThan(0);
    expect(landed).toBeLessThan(130);
    expect(home).toBeGreaterThan(landed);
    expect(home).toBeLessThan(280);
  });

  it('a voyage through a channel of Shallows only (the coast of most real Ports): routed and flown', () => {
    const { s, port, target } = dateLine(CLASS_SHALLOWS);
    expect(applyLaunchShip(s, 0, port, target, 100)).toBe(REJECT_NONE);
  });

  it('findShipRoute: Shallows are water', () => {
    const m = grid(64, 16, LAND);
    for (let x = 4; x < 60; x++) m.t[m.at(x, 8)] = CLASS_SHALLOWS;
    const r = new ShipRoute();
    expect(findShipRoute(m.w, m.h, m.t, m.at(4, 8), m.at(61, 8), r)).toBe(SHIP_ROUTE_OK);
  });

  it('findShipRoute: a one-row channel over the date line is sailed both ways (the search wraps east and west, the straight line wraps too: two waypoints)', () => {
    const m = grid(256, 16, LAND);
    for (let x = 249; x < 256; x++) m.t[m.at(x, 8)] = SEA;
    for (let x = 0; x < 8; x++) m.t[m.at(x, 8)] = SEA;
    const r = new ShipRoute();
    expect(findShipRoute(m.w, m.h, m.t, m.at(250, 8), m.at(9, 8), r)).toBe(SHIP_ROUTE_OK);
    expect(r.count).toBe(2);
    expect((r.cells[1] as number) % 256, 'the sea ends at x 7, two cells from the target').toBe(7);
    expect(findShipRoute(m.w, m.h, m.t, m.at(5, 8), m.at(247, 8), r)).toBe(SHIP_ROUTE_OK);
    expect(r.count).toBe(2);
    expect((r.cells[1] as number) % 256, 'west over x = 0: the sea ends at x 249').toBe(249);
  });

  it('a diagonal needs both orthogonal cells to be water: a staircase channel is sailed step by step (47 cells), a one-land-corner shortcut is not taken', () => {
    const m = grid(40, 40, LAND);
    for (let k = 0; k <= 24; k++) {
      m.t[m.at(3 + k, 3 + k)] = SEA;
      m.t[m.at(4 + k, 3 + k)] = SEA;
    }
    const r = new ShipRoute();
    expect(findShipRoute(m.w, m.h, m.t, m.at(3, 3), m.at(28, 28), r)).toBe(SHIP_ROUTE_OK);
    expect(r.pathCells).toBe(47);
  });

  it('a one-cell-thick diagonal wall of land cannot be crossed', () => {
    const m = grid(32, 32, SEA);
    for (let i = 0; i < 32; i++) m.t[m.at(i, i)] = LAND;
    const r = new ShipRoute();
    expect(findShipRoute(m.w, m.h, m.t, m.at(20, 5), m.at(5, 20), r)).toBe(SHIP_ROUTE_NONE);
  });

  it('portWaterCell: the west neighbour, also across x = 0 (the Port at x 0 finds the water at x width - 1) and the plain west neighbour of an inner cell', () => {
    const e = grid(16, 8, LAND, true);
    e.t.fill(LAND);
    e.t[e.at(15, 2)] = SEA;
    expect(portWaterCell(16, 8, e.t, e.at(0, 2))).toBe(e.at(15, 2));
    const w = grid(16, 8, LAND, true);
    w.t.fill(LAND);
    w.t[w.at(4, 3)] = SEA;
    expect(portWaterCell(16, 8, w.t, w.at(5, 3))).toBe(w.at(4, 3));
  });
});
