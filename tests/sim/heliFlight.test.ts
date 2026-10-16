// M12a-2: LaunchHeli, RecallHeli and the flight on a synthetic plains world (the real-terrain property test is tests/sim/heliFlightReal.test.ts).
// Every test drives the real sim path (step), so a rule removed from checkLaunchHeli, checkRecallHeli or heliFlight.ts fails here.
import { describe, expect, it } from 'vitest';
import { navOf, losOf } from '../../src/sim/access';
import { decodeIntent, encodeIntent } from '../../src/sim/codec';
import { checkRecallHeli, validateLaunchHeli, validateRecallHeli } from '../../src/sim/heliRules';
import { applyLaunchHeli, applyRecallHeli, heliStepQ8 } from '../../src/sim/heliFlight';
import { heliPhase } from '../../src/sim/heliPhase';
import { HELI_APPROACH, HELI_CRUISE, HELI_DOWNED, HELI_HOVER, HELI_LIFT, HELI_PAD, HELI_POS_ONE, HELI_RETURN } from '../../src/sim/heliTable';
import {
  compareIntents,
  copyBody,
  launchHeliBody,
  recallHeliBody,
  REJECT_CELL,
  REJECT_HELI_BAD_TROOPS,
  REJECT_HELI_NO_FACTORY,
  REJECT_HELI_NO_PAD,
  REJECT_HELI_NO_ROUTE,
  REJECT_HELI_NOT_FLYING,
  REJECT_HELI_NOT_OWNER,
  REJECT_NONE,
  REJECT_PHASE,
  validateIntent,
  withId,
  produceHeliBody,
  type IntentBody,
} from '../../src/sim/intents';
import { LZ_ENEMY_CITY_NEAR, LZ_OUT_OF_FUEL, LZ_WATER } from '../../src/sim/nav/lz';
import { OUTBOX_HELI_DOWNED, OUTBOX_HELI_HOME, OUTBOX_HELI_LANDED, OUTBOX_HELI_LAUNCHED, OUTBOX_HELI_RTB, OUTBOX_HELI_SCRAPPED, type OutboxEvent } from '../../src/sim/outbox';
import {
  BUILD_TICKS,
  HELI_BUILD_TICKS,
  HELI_DOWNED_TICKS,
  HELI_FUEL_MAX_Q8,
  HELI_HOVER_TICKS,
  HELI_MAX_TROOPS,
  HELI_TAKEOFF_TICKS,
  MILLI_GOLD_PER_GOLD,
  QT_PER_TROOP,
  TICK_HZ,
} from '../../src/sim/rules';
import { deserialize, hashState, serialize } from '../../src/sim/serialize';
import { step } from '../../src/sim/step';
import { createScenarioState, runScenario } from '../../src/sim/scenario';
import { createState, rebuildAggregates, type GameState } from '../../src/sim/state';
import { STRUCT_CITY, STRUCT_FACTORY } from '../../src/sim/structureRules';
import { CLASS_DEEP_SEA, CLASS_PLAINS } from '../../src/sim/terrain';
import { StateView } from '../../src/sim/view';

const W = 512;
const H = 128;
const at = (x: number, y: number): number => y * W + x;
const GOLD = 100000 * MILLI_GOLD_PER_GOLD;
const TROOPS_QT = 5000 * QT_PER_TROOP;

/** Plains at 5 m; seat 0 (ownerId 1) owns the left half, seat 1 the right half. `maxElev` can be left out (no Los / Nav). */
function world(opts: { spawnPhase?: boolean; maxElev?: boolean } = {}): GameState {
  const terrain = new Uint8Array(W * H).fill(CLASS_PLAINS);
  terrain[at(120, 40)] = CLASS_DEEP_SEA;
  const elevation = new Uint16Array(W * H).fill(5);
  const maxElev = new Int16Array(W * H).fill(5);
  const config = { debugIntents: true, ...(opts.spawnPhase === true ? { spawnPhase: true } : {}) };
  const s = createState({ width: W, height: H, seed: 5, seats: 2, config, terrain, elevation, ...(opts.maxElev === false ? {} : { maxElev }) });
  for (let c = 0; c < W * H; c++) s.owner[c] = c % W < W / 2 ? 1 : 2;
  rebuildAggregates(s);
  s.gold[1] = GOLD;
  s.gold[2] = GOLD;
  s.troops[1] = TROOPS_QT;
  s.troops[2] = TROOPS_QT;
  return s;
}

function idle(s: GameState, ticks: number): void {
  for (let i = 0; i < ticks; i++) expect(step(s, { turn: s.tick, intents: [] }).ok).toBe(true);
}

/** Flight only: the helicopter phase and the tick counter, WITHOUT the economy, so that the troop count moves only by what a helicopter does to it. */
function fly(s: GameState, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    heliPhase(s);
    s.tick++;
  }
}

let nextId = 1;
function run(s: GameState, ...bodies: IntentBody[]): number[] {
  s.outbox.clear();
  step(s, { turn: s.tick, intents: bodies.map((b) => withId(b, nextId++)) });
  return s.outbox
    .drain()
    .filter((e) => e.kind === 2)
    .map((e) => e.a);
}

/** A finished Factory of ownerId 1 at (x, y) with a parked helicopter. Returns the structure id; the helicopter is the lowest id of the state. */
function factoryWithHeli(s: GameState, x = 20, y = 60, ownerId = 1): number {
  const f = s.structures.add(STRUCT_FACTORY, ownerId, at(x, y), s.tick);
  idle(s, BUILD_TICKS[STRUCT_FACTORY] as number);
  expect(run(s, produceHeliBody(ownerId - 1, f))).toEqual([]);
  idle(s, HELI_BUILD_TICKS + 1);
  s.troops[ownerId] = TROOPS_QT; // the waiting regenerated some: the tests below count from a known figure
  return f;
}

function events(s: GameState, kind: number): OutboxEvent[] {
  return s.outbox.drain().filter((e) => e.kind === kind);
}

const LZ = at(80, 60); // 60 cells east of the Factory on the plains

describe('LaunchHeli: every reason code (the real step path)', () => {
  it('REJECT_PHASE in the spawn phase of a match with a start phase', () => {
    const s = world({ spawnPhase: true });
    const f = s.structures.add(STRUCT_FACTORY, 1, at(20, 60), 0);
    s.structures.readyTick[f] = 0;
    s.helis.addBuilding(1, f, 0, 0);
    s.helis.state[0] = HELI_PAD;
    expect(run(s, launchHeliBody(0, f, LZ, 100, 0))).toEqual([REJECT_PHASE]);
  });

  it('NO_FACTORY (a City, a free slot), NOT_OWNER (the other seat\'s Factory), NO_PAD (nothing parked, or only a queued helicopter)', () => {
    const s = world();
    const f = factoryWithHeli(s);
    const city = s.structures.add(STRUCT_CITY, 1, at(30, 30), s.tick);
    expect(run(s, launchHeliBody(0, city, LZ, 100, 0))).toEqual([REJECT_HELI_NO_FACTORY]);
    expect(run(s, launchHeliBody(0, 900, LZ, 100, 0))).toEqual([REJECT_HELI_NO_FACTORY]);
    expect(run(s, launchHeliBody(1, f, LZ, 100, 0))).toEqual([REJECT_HELI_NOT_OWNER]);
    const f2 = s.structures.add(STRUCT_FACTORY, 1, at(20, 90), s.tick);
    idle(s, BUILD_TICKS[STRUCT_FACTORY] as number);
    expect(run(s, launchHeliBody(0, f2, LZ, 100, 0))).toEqual([REJECT_HELI_NO_PAD]); // no helicopter at all
    expect(run(s, produceHeliBody(0, f2))).toEqual([]);
    expect(run(s, launchHeliBody(0, f2, LZ, 100, 0))).toEqual([REJECT_HELI_NO_PAD]); // one under production
    expect(s.helis.state[0]).toBe(HELI_PAD);
  });

  it('BAD_TROOPS: 0, one over the load, and more than the seat has; the shape (negative, fraction) is refused before the rules', () => {
    const s = world();
    const f = factoryWithHeli(s);
    expect(run(s, launchHeliBody(0, f, LZ, 0, 0))).toEqual([REJECT_HELI_BAD_TROOPS]);
    expect(run(s, launchHeliBody(0, f, LZ, HELI_MAX_TROOPS + 1, 0))).toEqual([REJECT_HELI_BAD_TROOPS]);
    s.troops[1] = 50 * QT_PER_TROOP + 3; // 50 whole troops and three quarters
    expect(run(s, launchHeliBody(0, f, LZ, 51, 0))).toEqual([REJECT_HELI_BAD_TROOPS]);
    expect(s.helis.state[0]).toBe(HELI_PAD);
    const ctx = { seats: 2, cells: W * H, debugIntents: true };
    expect(validateIntent(withId(launchHeliBody(0, f, LZ, -1, 0), 1), ctx)).not.toBe(REJECT_NONE);
    expect(validateIntent(withId(launchHeliBody(0, f, LZ, 1.5, 0), 1), ctx)).not.toBe(REJECT_NONE);
    expect(validateIntent(withId(launchHeliBody(0, f, LZ, 5, 2), 1), ctx)).not.toBe(REJECT_NONE);
    expect(validateIntent(withId(launchHeliBody(0, f, W * H, 5, 0), 1), ctx)).toBe(REJECT_CELL);
  });

  it('the landing-zone reason of scoreLz is the refusal: water, an enemy City next to it, too far for the fuel', () => {
    const s = world();
    const f = factoryWithHeli(s);
    expect(run(s, launchHeliBody(0, f, at(120, 40), 100, 0))).toEqual([LZ_WATER]);
    s.structures.add(STRUCT_CITY, 2, at(100, 100), s.tick);
    expect(run(s, launchHeliBody(0, f, at(101, 100), 100, 0))).toEqual([LZ_ENEMY_CITY_NEAR]);
    expect(run(s, launchHeliBody(0, f, at(300, 10), 100, 0))).toEqual([LZ_OUT_OF_FUEL]); // 280 cells away
    expect(s.helis.state[0]).toBe(HELI_PAD);
    s.troops[1] = TROOPS_QT;
    expect(applyLaunchHeli(s, 0, f, at(300, 10), 100, 0)).toBe(LZ_OUT_OF_FUEL);
    expect(s.troops[1]).toBe(TROOPS_QT); // a refused launch takes nothing
  });

  it('NO_ROUTE when the world has no occluder layer (it must refuse, not throw)', () => {
    const s = world({ maxElev: false });
    const f = factoryWithHeli(s);
    expect(run(s, launchHeliBody(0, f, LZ, 100, 0))).toEqual([REJECT_HELI_NO_ROUTE]);
    expect(s.helis.state[0]).toBe(HELI_PAD);
  });

  it('an accepted launch takes the troops at once and lifts off with the planned route', () => {
    const s = world();
    const f = factoryWithHeli(s);
    expect(applyLaunchHeli(s, 0, f, LZ, 300, 0)).toBe(REJECT_NONE);
    const t = s.helis;
    expect(t.state[0]).toBe(HELI_LIFT);
    expect(t.load[0]).toBe(300);
    expect(t.target[0]).toBe(LZ + 1);
    expect(s.troops[1]).toBe(TROOPS_QT - 300 * QT_PER_TROOP);
    expect(t.routeLen[0]).toBeGreaterThanOrEqual(2);
    expect(t.route[(t.routeIdx[0] as number) - 1]).toBe(at(20, 60));
    expect(t.route[(t.routeLen[0] as number) - 1]).toBe(LZ);
  });

  it('validateLaunchHeli (the public wrapper on a snapshot view) agrees with the sim for the same cases', () => {
    const s = world();
    const f = factoryWithHeli(s);
    const view = new StateView(s);
    const nav = navOf(s);
    const cases: [number, number, number, number, number][] = [
      [0, f, LZ, 100, 0],
      [0, f, LZ, 0, 0],
      [0, f, LZ, 100, 1],
      [0, f, at(120, 40), 100, 0],
      [1, f, LZ, 100, 0],
      [0, 777, LZ, 100, 0],
      [0, f, at(300, 10), 100, 0],
    ];
    for (const [seat, fac, lz, troops, mode] of cases) {
      const twin = deserialize(serialize(s), { maxElev: new Int16Array(W * H).fill(5) });
      if (!twin.ok) throw new Error('twin');
      const sim = run(twin.state, launchHeliBody(seat, fac, lz, troops, mode));
      expect(validateLaunchHeli(view, nav, seat, fac, lz, troops, mode), `case ${JSON.stringify([seat, fac, lz, troops, mode])}`).toBe(sim.length === 0 ? REJECT_NONE : sim[0]);
    }
  });
});

describe('RecallHeli: reason codes and the return', () => {
  it('NOT_FLYING for a parked helicopter, an unknown id, a helicopter under production and one already returning; NOT_OWNER for the other seat', () => {
    const s = world();
    const f = factoryWithHeli(s);
    expect(run(s, recallHeliBody(0, 0))).toEqual([REJECT_HELI_NOT_FLYING]); // parked
    expect(run(s, recallHeliBody(0, 33))).toEqual([REJECT_HELI_NOT_FLYING]); // no such helicopter
    expect(run(s, produceHeliBody(0, f))).toEqual([]);
    expect(run(s, recallHeliBody(0, 1))).toEqual([REJECT_HELI_NOT_FLYING]); // queued
    expect(run(s, launchHeliBody(0, f, LZ, 100, 0))).toEqual([]);
    expect(run(s, recallHeliBody(1, 0))).toEqual([REJECT_HELI_NOT_OWNER]);
    idle(s, 40);
    expect(run(s, recallHeliBody(0, 0))).toEqual([]);
    expect(s.helis.state[0]).toBe(HELI_RETURN);
    expect(run(s, recallHeliBody(0, 0))).toEqual([REJECT_HELI_NOT_FLYING]); // already returning
    expect(validateRecallHeli(new StateView(s), 0, 0)).toBe(REJECT_HELI_NOT_FLYING);
    expect(checkRecallHeli(s, 0, 0)).toBe(REJECT_HELI_NOT_FLYING);
  });

  it('a recalled helicopter sets down on its pad, refuelled, and the load goes back to the seat (no troops created or lost)', () => {
    const s = world();
    const f = factoryWithHeli(s);
    applyLaunchHeli(s, 0, f, LZ, 300, 0);
    fly(s, 120);
    expect(s.helis.state[0]).toBe(HELI_CRUISE);
    expect(s.troops[1]).toBe(TROOPS_QT - 300 * QT_PER_TROOP);
    s.outbox.clear();
    expect(applyRecallHeli(s, 0, 0)).toBe(REJECT_NONE);
    expect(events(s, OUTBOX_HELI_RTB).map((e) => e.b)).toEqual([1]);
    let guard = 0;
    while (s.helis.state[0] !== HELI_PAD && guard++ < 2000) fly(s, 1);
    expect(s.helis.state[0]).toBe(HELI_PAD);
    expect(s.helis.fuel[0]).toBe(HELI_FUEL_MAX_Q8);
    expect(s.helis.load[0]).toBe(0);
    expect(s.helis.x[0]).toBe(20 * HELI_POS_ONE + HELI_POS_ONE / 2);
    expect(s.helis.alt[0]).toBe(0);
    expect(s.troops[1]).toBe(TROOPS_QT);
    expect(s.helis.routeLen[0]).toBe(0);
  });
});

describe('the flight: tick-exact states, the whole mission, the speed', () => {
  it('TakeOff lasts HELI_TAKEOFF_TICKS: LIFT for the launch tick and the next 19, CRUISE from the 20th (and moving), tick-exact', () => {
    const s = world();
    const f = factoryWithHeli(s);
    const t0 = s.tick;
    run(s, launchHeliBody(0, f, LZ, 100, 0));
    const x0 = s.helis.x[0];
    for (let k = 0; k < HELI_TAKEOFF_TICKS; k++) {
      expect(s.helis.state[0], `after the step at tick ${t0 + k}`).toBe(HELI_LIFT);
      expect(s.helis.x[0]).toBe(x0); // lifting, not moving
      if (k < HELI_TAKEOFF_TICKS - 1) idle(s, 1);
    }
    idle(s, 1); // the step at tick t0 + 20
    expect(s.helis.state[0]).toBe(HELI_CRUISE);
    expect(s.helis.stateTick[0]).toBe(t0 + HELI_TAKEOFF_TICKS);
    expect(s.helis.x[0]).toBeGreaterThan(x0 as number);
    expect(s.helis.alt[0]).toBeGreaterThan(0);
  });

  it('Hover lasts HELI_HOVER_TICKS exactly, then HELI_LANDED (placeholder: the load as the figure) and the way home; the whole mission loses and creates no troops', () => {
    const s = world();
    const f = factoryWithHeli(s);
    const total = (): number => (s.troops[1] as number) + (s.helis.owner[0] === 0 ? 0 : (s.helis.load[0] as number) * QT_PER_TROOP);
    const before = total();
    expect(applyLaunchHeli(s, 0, f, LZ, 250, 0)).toBe(REJECT_NONE);
    let hoverStart = -1;
    let hoverEnd = -1;
    let landed: OutboxEvent[] = [];
    let sawApproach = false;
    for (let i = 0; i < 3000 && s.helis.state[0] !== HELI_PAD; i++) {
      fly(s, 1);
      expect(total()).toBe(before);
      const st = s.helis.state[0];
      if (st === HELI_APPROACH) sawApproach = true;
      if (st === HELI_HOVER && hoverStart < 0) hoverStart = s.tick - 1;
      if (st === HELI_RETURN && hoverEnd < 0) hoverEnd = s.tick - 1;
      landed = landed.concat(events(s, OUTBOX_HELI_LANDED));
      if (st === HELI_PAD) break;
    }
    expect(sawApproach).toBe(true);
    expect(hoverEnd - hoverStart).toBe(HELI_HOVER_TICKS);
    expect(s.helis.state[0]).toBe(HELI_PAD);
    expect(s.troops[1]).toBe(before);
    expect(s.helis.load[0]).toBe(0);
    expect(landed).toHaveLength(1);
    expect(landed[0]?.b).toBe(250);
  });

  it('flies at the mode speed: 60 cells Low takes at least 15 s one way, High is faster than Low, and no tick moves more than 1.05 x the speed', () => {
    const times: number[] = [];
    for (const mode of [0, 1]) {
      const s = world();
      const f = factoryWithHeli(s);
      run(s, launchHeliBody(0, f, LZ, 100, mode));
      const t0 = s.tick;
      let px = s.helis.x[0] as number;
      let py = s.helis.y[0] as number;
      let arrived = -1;
      let maxStep = 0;
      for (let i = 0; i < 2000 && arrived < 0; i++) {
        idle(s, 1);
        const x = s.helis.x[0] as number;
        const y = s.helis.y[0] as number;
        maxStep = Math.max(maxStep, Math.hypot(x - px, y - py));
        px = x;
        py = y;
        if (s.helis.state[0] === HELI_HOVER) arrived = s.tick - t0;
      }
      expect(arrived).toBeGreaterThan(0);
      times.push(arrived);
      const speedPerTick = (mode === 0 ? 2100 : 3000) * HELI_POS_ONE / (1000 * TICK_HZ);
      expect(maxStep).toBeLessThanOrEqual(1.05 * speedPerTick);
      expect(maxStep).toBeGreaterThan(0.9 * speedPerTick); // not a stub that crawls
      expect(heliStepQ8(mode)).toBeLessThanOrEqual(1.05 * speedPerTick);
    }
    expect(times[0]).toBeGreaterThanOrEqual(15 * TICK_HZ);
    expect(times[1]).toBeGreaterThanOrEqual(15 * TICK_HZ);
    expect(times[1]).toBeLessThan(times[0] as number);
  });
});

describe('fuel, Downed, a lost Factory', () => {
  it('running out of fuel makes the helicopter HELI_DOWNED for 50 ticks, then it is removed; the load is lost, HELI_DOWNED{fuel} is announced', () => {
    const s = world();
    const f = factoryWithHeli(s);
    applyLaunchHeli(s, 0, f, LZ, 400, 0);
    fly(s, 60);
    s.helis.fuel[0] = 3 * HELI_POS_ONE; // three cells left
    s.outbox.clear();
    let downTick = -1;
    for (let i = 0; i < 400 && downTick < 0; i++) {
      fly(s, 1);
      if (s.helis.state[0] === HELI_DOWNED) downTick = s.tick - 1;
    }
    expect(downTick).toBeGreaterThan(0);
    const down = events(s, OUTBOX_HELI_DOWNED);
    expect(down).toHaveLength(1);
    expect(down[0]?.b).toBe(1);
    expect(s.helis.load[0]).toBe(0);
    for (let k = 1; k < HELI_DOWNED_TICKS; k++) {
      fly(s, 1);
      expect(s.helis.state[0], `${k} ticks after`).toBe(HELI_DOWNED);
    }
    fly(s, 1);
    expect(s.helis.owner[0]).toBe(0); // gone after HELI_DOWNED_TICKS
    expect(s.troops[1]).toBe(TROOPS_QT - 400 * QT_PER_TROOP); // the load is lost, nothing came back
  });

  it('the fuel falls with the distance flown (about the Q8 distance), and is full again after landing', () => {
    const s = world();
    const f = factoryWithHeli(s);
    run(s, launchHeliBody(0, f, LZ, 100, 0));
    idle(s, HELI_TAKEOFF_TICKS + 100);
    const flown = HELI_FUEL_MAX_Q8 - (s.helis.fuel[0] as number);
    const expected = 100 * heliStepQ8(0);
    expect(Math.abs(flown - expected)).toBeLessThanOrEqual(2 * HELI_POS_ONE);
  });

  it('the home Factory is lost in the air: the helicopter flies the mission, then returns to the NEAREST remaining own Factory and sets down there', () => {
    const s = world();
    const f = factoryWithHeli(s);
    const f2 = s.structures.add(STRUCT_FACTORY, 1, at(60, 100), s.tick);
    idle(s, BUILD_TICKS[STRUCT_FACTORY] as number);
    s.troops[1] = TROOPS_QT;
    applyLaunchHeli(s, 0, f, LZ, 100, 0);
    fly(s, 30);
    s.structures.remove(f); // the home Factory is gone (destroyed)
    let guard = 0;
    while (s.helis.state[0] !== HELI_PAD && guard++ < 3000) fly(s, 1);
    expect(s.helis.state[0]).toBe(HELI_PAD);
    expect(s.helis.factory[0]).toBe(f2);
    expect(s.structures.cell[f2]).toBe(at(60, 100));
    expect(s.helis.x[0]).toBe(60 * HELI_POS_ONE + HELI_POS_ONE / 2);
    expect(s.troops[1]).toBe(TROOPS_QT);
  });

  it('the home Factory is lost and no other is left: the helicopter is scrapped when it turns for home, its load goes back to the seat', () => {
    const s = world();
    const f = factoryWithHeli(s);
    applyLaunchHeli(s, 0, f, LZ, 100, 0);
    fly(s, 30);
    s.structures.remove(f);
    s.outbox.clear();
    let scrapped: OutboxEvent[] = [];
    for (let i = 0; i < 3000 && s.helis.owner[0] !== 0; i++) {
      fly(s, 1);
      scrapped = scrapped.concat(events(s, OUTBOX_HELI_SCRAPPED));
    }
    expect(s.helis.owner[0]).toBe(0);
    expect(scrapped).toHaveLength(1);
    expect(s.troops[1]).toBe(TROOPS_QT);
    expect(s.helis.liveCount).toBe(0);
  });

  it('a Factory conquered away from under a helicopter that is lifting off does not stop it (scrapFactoryHelis only takes parked and queued ones)', () => {
    const s = world();
    const f = factoryWithHeli(s);
    run(s, launchHeliBody(0, f, LZ, 100, 0));
    idle(s, 5);
    s.structures.owner[f] = 2; // taken over in place
    expect(s.helis.state[0]).toBe(HELI_LIFT);
    idle(s, 40);
    expect(s.helis.state[0]).toBe(HELI_CRUISE);
  });
});

describe('the way home and the date line', () => {
  it('the return goes to the NEAREST own Factory (not the home one, not the lowest id) and the helicopter changes its home', () => {
    const s = world();
    const home = factoryWithHeli(s); // at (20, 60), id 0 in the structure table
    const far = s.structures.add(STRUCT_FACTORY, 1, at(10, 120), s.tick);
    const near = s.structures.add(STRUCT_FACTORY, 1, at(90, 62), s.tick); // 10 cells from the landing zone
    idle(s, BUILD_TICKS[STRUCT_FACTORY] as number);
    s.troops[1] = TROOPS_QT;
    expect(applyLaunchHeli(s, 0, home, LZ, 100, 0)).toBe(REJECT_NONE);
    let guard = 0;
    while (s.helis.state[0] !== HELI_PAD && guard++ < 3000) fly(s, 1);
    expect(s.helis.state[0]).toBe(HELI_PAD);
    expect(s.helis.factory[0]).toBe(near);
    expect(s.helis.factory[0]).not.toBe(far);
    expect(s.helis.x[0]).toBe(90 * HELI_POS_ONE + HELI_POS_ONE / 2);
    expect(s.troops[1]).toBe(TROOPS_QT);
  });

  it('a flight over the date line wraps x: the position stays inside the world on every tick and the helicopter arrives on the far side', () => {
    const s = world();
    const f = factoryWithHeli(s, 5, 60);
    s.troops[1] = TROOPS_QT;
    const lz = at(W - 40, 60); // 45 cells WEST of the Factory across the seam, 467 cells east the long way
    expect(applyLaunchHeli(s, 0, f, lz, 100, 0)).toBe(REJECT_NONE);
    let sawLow = false;
    let hovered = false;
    for (let i = 0; i < 2000 && !hovered; i++) {
      fly(s, 1);
      const x = s.helis.x[0] as number;
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(W * HELI_POS_ONE);
      if (x > (W - 5) * HELI_POS_ONE) sawLow = true;
      if (s.helis.state[0] === HELI_HOVER) hovered = true;
    }
    expect(sawLow).toBe(true); // it crossed the seam westwards
    expect(hovered).toBe(true);
    expect(s.helis.x[0]).toBe((W - 40) * HELI_POS_ONE + HELI_POS_ONE / 2);
  });
});

describe('events, codec and determinism with helicopters in the air', () => {
  it('HELI_LAUNCHED carries the id and the landing zone', () => {
    const s = world();
    const f = factoryWithHeli(s);
    s.outbox.clear();
    step(s, { turn: s.tick, intents: [withId(launchHeliBody(0, f, LZ, 100, 0), 9000)] });
    const ev = events(s, OUTBOX_HELI_LAUNCHED);
    expect(ev).toHaveLength(1);
    expect([ev[0]?.a, ev[0]?.b]).toEqual([0, LZ]);
  });

  it('HELI_HOME is announced with the Factory when it sets down', () => {
    const s = world();
    const f = factoryWithHeli(s);
    run(s, launchHeliBody(0, f, at(30, 62), 10, 0));
    s.outbox.clear();
    let home: OutboxEvent[] = [];
    for (let i = 0; i < 1500 && home.length === 0; i++) {
      idle(s, 1);
      home = home.concat(events(s, OUTBOX_HELI_HOME));
    }
    expect(home).toHaveLength(1);
    expect([home[0]?.a, home[0]?.b]).toEqual([0, f]);
  });

  it('the codec round-trips both intents and copyBody / compareIntents know them (wire kinds 13 and 14)', () => {
    const l = withId(launchHeliBody(1, 7, 123456, 600, 1), 3);
    const r = withId(recallHeliBody(1, 9), 4);
    for (const i of [l, r]) {
      const d = decodeIntent(encodeIntent(i));
      expect(d.ok && d.value).toEqual(i);
      const { id: _id, ...body } = i;
      expect(copyBody(body)).toEqual(body);
    }
    expect(encodeIntent(l)[0]).toBe(13);
    expect(encodeIntent(r)[0]).toBe(14);
    expect(compareIntents(withId(launchHeliBody(0, 1, 5, 5, 0), 1), withId(launchHeliBody(0, 1, 5, 6, 0), 1))).toBeLessThan(0);
    expect(compareIntents(withId(recallHeliBody(0, 2), 1), withId(recallHeliBody(0, 3), 1))).toBeLessThan(0);
    expect(validateIntent(withId(recallHeliBody(0, 64), 1), { seats: 2, cells: W * H, debugIntents: true })).not.toBe(REJECT_NONE);
  });

  it('a snapshot taken with helicopters in the air equals the straight run, and the table survives a round trip', () => {
    const s = world();
    const f = factoryWithHeli(s);
    run(s, launchHeliBody(0, f, LZ, 200, 0), launchHeliBody(0, f, LZ, 200, 1));
    idle(s, 150);
    const f2 = s.structures.add(STRUCT_FACTORY, 1, at(22, 90), s.tick);
    idle(s, BUILD_TICKS[STRUCT_FACTORY] as number);
    run(s, produceHeliBody(0, f2));
    idle(s, 140);
    run(s, launchHeliBody(0, f2, at(70, 80), 100, 1));
    idle(s, 90);
    const airborne = [0, 1, 2].filter((id) => (s.helis.state[id] as number) >= HELI_LIFT && (s.helis.state[id] as number) <= HELI_RETURN);
    expect(airborne.length).toBeGreaterThanOrEqual(2);
    const bytes = serialize(s);
    const back = deserialize(bytes, { maxElev: new Int16Array(W * H).fill(5) });
    if (!back.ok) throw new Error('round trip failed: ' + back.error);
    expect(hashState(back.state)).toBe(hashState(s));
    expect(Array.from(serialize(back.state))).toEqual(Array.from(bytes));
    for (let i = 0; i < 700; i++) {
      step(s, { turn: s.tick, intents: [] });
      step(back.state, { turn: back.state.tick, intents: [] });
      if (i % 50 === 0) expect(hashState(back.state), `tick ${s.tick}`).toBe(hashState(s));
    }
    expect(hashState(back.state)).toBe(hashState(s));
  });

  it('the altitude on flat ground is the AGL floor above the mean: 300 m Low, 3000 m High (and the loss of a Los object does not change it)', () => {
    for (const [mode, agl] of [[0, 300], [1, 3000]] as const) {
      const s = world();
      const f = factoryWithHeli(s);
      run(s, launchHeliBody(0, f, LZ, 100, mode));
      idle(s, HELI_TAKEOFF_TICKS + 40);
      // ground = EXAG * 5 m = 40 game metres; occluder = EXAG * 5 = 40, + clearance 100 < 40 + AGL
      expect(s.helis.alt[0]).toBe(40 + agl);
      expect(losOf(s).terrain.groundGm[at(40, 60)]).toBe(40);
    }
  });
});

describe('the golden scenario carries flights', () => {
  it('the scripted LaunchHeli / RecallHeli lines are part of the pinned run, and at least one launch is accepted in the two pinned seeds (so the golden hashes cover a helicopter in the air)', () => {
    let launched = 0;
    for (const seed of [1, 2]) {
      const s = createScenarioState({ seed });
      while (s.tick < 6000) {
        runScenario(s, s.tick + 100);
        launched += events(s, OUTBOX_HELI_LAUNCHED).length;
      }
    }
    expect(launched).toBeGreaterThanOrEqual(1);
  });
});
