// Fix-4A1 (audit 3): the helicopter, beachhead and treaty fixes and the mutation killers of the findings [0.0] [0.1] [0.2] [0.6] [1.1] [1.2] [1.3] [1.4].
// World: 512x128 plains at 5 m; ownerId 1 (seat 0) owns x < 256, ownerId 2 owns x >= 256 except a neutral band x in [280, 330). The mutant that each test kills is
// named in its title (the table is in docs/DECISIONS.md, block Fix-4A1).
import { describe, expect, it } from 'vitest';
import { navOf } from '../../src/sim/access';
import { applyLaunchHeli, applyRecallHeli, heliStepQ8 } from '../../src/sim/heliFlight';
import { landingCell, landingCostMilli } from '../../src/sim/heliLanding';
import { applyProduceHeli, heliPhase } from '../../src/sim/heliPhase';
import { fleetCapOf, validateLaunchHeli, validateProduceHeli } from '../../src/sim/heliRules';
import { RELATION_ALLIANCE, RELATION_TRUCE } from '../../src/sim/diplomacyTable';
import { BEACH_CUT_OFF, HELI_CRUISE, HELI_HOVER, HELI_LIFT, HELI_PAD } from '../../src/sim/heliTable';
import { DISTRICT_WALLS } from '../../src/sim/districtRules';
import {
  produceHeliBody,
  REJECT_DIPLO_TREATY_BOUND,
  REJECT_HELI_BEACHHEAD_FULL,
  REJECT_HELI_FLEET_CAP,
  REJECT_HELI_TABLE_FULL,
  REJECT_NONE,
  withId,
  type IntentBody,
} from '../../src/sim/intents';
import { OUTBOX_BEACHHEAD_REVERTED, OUTBOX_HELI_LANDED, type OutboxEvent } from '../../src/sim/outbox';
import {
  AIR_MODE_SPEED_MILLICELLS_S,
  TICK_HZ,
  BEACHHEAD_CAPACITY,
  BEACHHEAD_REVERT_TICKS,
  BUILD_TICKS,
  HELI_BUILD_TICKS,
  HELI_CAPACITY,
  HELI_FLEET_BASE,
  MILLI_GOLD_PER_GOLD,
  MILLI_QT_PER_QT,
  QT_PER_TROOP,
} from '../../src/sim/rules';
import { step } from '../../src/sim/step';
import { createState, rebuildAggregates, type GameState } from '../../src/sim/state';
import { STRUCT_CITY, STRUCT_FACTORY, STRUCT_POST } from '../../src/sim/structureRules';
import { CLASS_FOREST, CLASS_PLAINS } from '../../src/sim/terrain';
import { setOwner } from '../../src/sim/territory';
import { StateView } from '../../src/sim/view';

const W = 512;
const H = 128;
const at = (x: number, y: number): number => y * W + x;
const GOLD = 100000 * MILLI_GOLD_PER_GOLD;
const TROOPS_QT = 5000 * QT_PER_TROOP;
const NEUTRAL_LZ = at(300, 60);

function world(): GameState {
  const terrain = new Uint8Array(W * H).fill(CLASS_PLAINS);
  const elevation = new Uint16Array(W * H).fill(5);
  const maxElev = new Int16Array(W * H).fill(5);
  const s = createState({ width: W, height: H, seed: 5, seats: 2, config: { debugIntents: true }, terrain, elevation, maxElev });
  for (let c = 0; c < W * H; c++) {
    const x = c % W;
    s.owner[c] = x < 256 ? 1 : x >= 280 && x < 330 ? 0 : 2;
  }
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
/** Flight and landing only (no economy). */
function fly(s: GameState, ticks = 1): void {
  for (let i = 0; i < ticks; i++) {
    heliPhase(s);
    s.tick++;
  }
}
let nextId = 1;
function run(s: GameState, ...bodies: IntentBody[]): void {
  step(s, { turn: s.tick, intents: bodies.map((b) => withId(b, nextId++)) });
}
function factoryWithHeli(s: GameState, x = 230, y = 60): number {
  const f = s.structures.add(STRUCT_FACTORY, 1, at(x, y), s.tick);
  idle(s, BUILD_TICKS[STRUCT_FACTORY] as number);
  run(s, produceHeliBody(0, f));
  idle(s, HELI_BUILD_TICKS + 1);
  s.troops[1] = TROOPS_QT;
  return f;
}
function flyUntilLanded(s: GameState): OutboxEvent {
  for (let i = 0; i < 3000; i++) {
    fly(s);
    const e = s.outbox.drain().find((x) => x.kind === OUTBOX_HELI_LANDED);
    if (e !== undefined) return e;
  }
  throw new Error('never landed');
}
const owned = (s: GameState, o: number): number => s.agg.area[o] as number;

describe('[0.0] an eliminated seat gets no land back from a helicopter in the air', () => {
  it('the elimination scraps its helicopters in the same tick (kills: no scrapOwnerHelis in winPhase) and nothing lands afterwards', () => {
    const s = world();
    const f = factoryWithHeli(s);
    expect(applyLaunchHeli(s, 0, f, NEUTRAL_LZ, 100, 0)).toBe(REJECT_NONE);
    idle(s, 1); // peakLand is recorded
    s.outbox.clear();
    for (let c = 0; c < W * H; c++) if (s.owner[c] === 1) setOwner(s, c, 2, 0); // the seat loses everything while the helicopter is up
    idle(s, 1);
    expect(s.match.eliminated[1]).toBe(1);
    expect(s.helis.countOf(1)).toBe(0);
    idle(s, 600);
    expect(owned(s, 1)).toBe(0);
    expect(s.beachheads.liveCount).toBe(0);
    expect(s.match.eliminated[1]).toBe(1);
  });

  it('performLanding does nothing for an eliminated owner (kills: the guard removed), the load is lost: HELI_LANDED b = -1', () => {
    const s = world();
    const f = factoryWithHeli(s);
    expect(applyLaunchHeli(s, 0, f, NEUTRAL_LZ, 100, 0)).toBe(REJECT_NONE);
    s.match.eliminated[1] = 1; // set by hand: winPhase does not run in fly(), so only the guard in performLanding can stop the landing
    const before = owned(s, 1);
    const e = flyUntilLanded(s);
    expect(e.b).toBe(-1);
    expect(owned(s, 1)).toBe(before);
    expect(s.beachheads.liveCount).toBe(0);
  });
});

describe('[0.1] a landing next to the own land is no beachhead', () => {
  function small(): { s: GameState; f: number } {
    const s = world();
    for (let c = 0; c < W * H; c++) if (s.owner[c] === 1) s.owner[c] = 0;
    for (let y = 58; y <= 62; y++) for (let x = 230; x <= 234; x++) s.owner[at(x, y)] = 1;
    rebuildAggregates(s);
    expect(owned(s, 1)).toBe(25);
    const f = factoryWithHeli(s, 232, 60);
    return { s, f };
  }

  it('a 25-cell nation lands beside its land and still owns all 25 cells at landing + 451 (kills: whole-territory cluster)', () => {
    const { s, f } = small();
    expect(applyLaunchHeli(s, 0, f, at(236, 60), 40, 0)).toBe(REJECT_NONE);
    s.outbox.clear();
    const e = flyUntilLanded(s);
    expect(e.b).toBeGreaterThan(0);
    const landTick = e.tick;
    const gained = owned(s, 1) - 25;
    expect(gained).toBe(e.b);
    let reverted = 0;
    while (s.tick <= landTick + 451) {
      fly(s);
      for (const x of s.outbox.drain()) if (x.kind === OUTBOX_BEACHHEAD_REVERTED) reverted++;
    }
    expect(reverted).toBe(0);
    expect(owned(s, 1)).toBe(25 + gained);
    expect(s.structures.owner[f]).toBe(1);
    expect(s.match.eliminated[1]).toBe(0);
  });

  it('a landing that does NOT touch own land is still a beachhead and still reverts after 450 ticks', () => {
    const { s, f } = small();
    expect(applyLaunchHeli(s, 0, f, at(300, 60), 40, 0)).toBe(REJECT_NONE);
    s.outbox.clear();
    const e = flyUntilLanded(s);
    expect(s.beachheads.liveCount).toBe(1);
    while (s.tick <= e.tick + BEACHHEAD_REVERT_TICKS) fly(s);
    expect(s.beachheads.liveCount).toBe(0);
    expect(owned(s, 1)).toBe(25);
  });

  it('a cut-off cluster that holds the capital cell is established at its check (kills: no capital rule), the nation keeps its land', () => {
    const { s } = small();
    s.capital[1] = at(232, 60) + 1;
    s.beachheads.add(1, at(231, 60), s.tick, BEACH_CUT_OFF);
    fly(s, BEACHHEAD_REVERT_TICKS + 20);
    expect(s.beachheads.liveCount).toBe(0);
    expect(owned(s, 1)).toBe(25);
  });
});

describe('[0.2] the treaty ban on landings', () => {
  // The zone (280, 60) is neutral; its west neighbours (279, y) belong to ownerId 2.
  const ZONE = at(280, 60);
  for (const [name, rel] of [['truce', RELATION_TRUCE], ['alliance', RELATION_ALLIANCE]] as const) {
    it(`${name}: the neighbours that belong to the partner are skipped, keep their owner, and the price carry goes on (kills: the neighbour guard deleted)`, () => {
      const s = world();
      const f = factoryWithHeli(s);
      s.diplo.setRelation(1, 2, rel, rel === RELATION_TRUCE ? s.tick + 100000 : 0);
      expect(applyLaunchHeli(s, 0, f, ZONE, 600, 0)).toBe(REJECT_NONE);
      const partnerBefore = owned(s, 2);
      const e = flyUntilLanded(s);
      expect(e.b).toBe(6); // the zone and the five neutral neighbours (x = 280 and 281)
      expect(owned(s, 2)).toBe(partnerBefore);
      for (const k of [4, 7, 8]) expect(s.owner[landingCell(W, H, ZONE, k)]).toBe(2); // W, SW, NW
      for (const k of [0, 1, 2, 3, 5, 6]) expect(s.owner[landingCell(W, H, ZONE, k)]).toBe(1);
      expect(s.match.conquered[1]).toBe(6); // [1.2] N19: the conquered statistic counts the landed cells
    });
  }

  it('validateLaunchHeli (the page side) refuses a partner\'s zone with REJECT_DIPLO_TREATY_BOUND and agrees with the sim (kills: zoneBound returns false)', () => {
    for (const rel of [RELATION_TRUCE, RELATION_ALLIANCE]) {
      const s = world();
      const f = factoryWithHeli(s);
      s.diplo.setRelation(1, 2, rel, rel === RELATION_TRUCE ? s.tick + 100000 : 0);
      const lz = at(270, 60);
      const view = new StateView(s);
      expect(validateLaunchHeli(view, navOf(s), 0, f, lz, 100, 0)).toBe(REJECT_DIPLO_TREATY_BOUND);
      expect(applyLaunchHeli(s, 0, f, lz, 100, 0)).toBe(REJECT_DIPLO_TREATY_BOUND);
      expect(validateLaunchHeli(view, navOf(s), 0, f, NEUTRAL_LZ, 100, 0)).toBe(applyLaunchHeli(s, 0, f, NEUTRAL_LZ, 100, 0));
    }
  });
});

describe('[0.6] the two global tables', () => {
  it('a full beachhead table refuses LaunchHeli with its own code BEFORE the departure: no troops drawn, the helicopter stays on the pad', () => {
    const s = world();
    const f = factoryWithHeli(s);
    for (let i = 0; i < BEACHHEAD_CAPACITY; i++) s.beachheads.add(2, at(400 + (i % 60), 10 + Math.floor(i / 60)), s.tick, BEACH_CUT_OFF);
    const troops = s.troops[1] as number;
    expect(applyLaunchHeli(s, 0, f, NEUTRAL_LZ, 100, 0)).toBe(REJECT_HELI_BEACHHEAD_FULL);
    expect(s.troops[1]).toBe(troops);
    expect(s.helis.state[0]).toBe(HELI_PAD);
    s.beachheads.remove(5);
    expect(applyLaunchHeli(s, 0, f, NEUTRAL_LZ, 100, 0)).toBe(REJECT_NONE);
  });

  it('a helicopter on its way counts against the free rows (one row free, one helicopter flying: the next launch is refused)', () => {
    const s = world();
    const f = factoryWithHeli(s);
    const f2 = factoryWithHeli(s, 220, 70);
    for (let i = 0; i < BEACHHEAD_CAPACITY - 1; i++) s.beachheads.add(2, at(400 + (i % 60), 10 + Math.floor(i / 60)), s.tick, BEACH_CUT_OFF);
    expect(applyLaunchHeli(s, 0, f, NEUTRAL_LZ, 100, 0)).toBe(REJECT_NONE);
    expect(applyLaunchHeli(s, 0, f2, at(305, 70), 100, 0)).toBe(REJECT_HELI_BEACHHEAD_FULL);
  });

  it('a full helicopter table refuses ProduceHeli with REJECT_HELI_TABLE_FULL, not FLEET_CAP; the per-seat cap still answers FLEET_CAP', () => {
    const s = world();
    const f = s.structures.add(STRUCT_FACTORY, 1, at(230, 60), s.tick);
    idle(s, BUILD_TICKS[STRUCT_FACTORY] as number);
    const foreign = s.structures.add(STRUCT_FACTORY, 2, at(400, 60), 0);
    for (let i = 0; i < HELI_CAPACITY; i++) s.helis.addBuilding(2, foreign, s.tick, s.tick + 100000);
    expect(s.helis.liveCount).toBe(HELI_CAPACITY);
    expect(s.helis.countOf(1)).toBe(0);
    const gold = s.gold[1];
    expect(validateProduceHeli(new StateView(s), 0, f)).toBe(REJECT_HELI_TABLE_FULL); // the page-side check, same function
    expect(applyProduceHeli(s, 0, f)).toBe(REJECT_HELI_TABLE_FULL);
    expect(s.gold[1]).toBe(gold);
    // the per-seat cap: remove the foreign helicopters, fill the seat's own cap
    for (let id = 0; id < HELI_CAPACITY; id++) s.helis.remove(id);
    const g = s.structures.add(STRUCT_FACTORY, 1, at(220, 70), 0); // the queue of `f` stays free, so only the cap can refuse
    for (let i = 0; i < fleetCapOf(s, 0); i++) s.helis.addBuilding(1, g, s.tick, s.tick + 100000);
    expect(applyProduceHeli(s, 0, f)).toBe(REJECT_HELI_FLEET_CAP);
  });
});

describe('[1.1] helicopter rules', () => {
  it('H03: the fleet cap counts only the seat\'s own Factories', () => {
    const s = world();
    factoryWithHeli(s);
    const cap = fleetCapOf(s, 0);
    const other = s.structures.add(STRUCT_FACTORY, 2, at(400, 60), 0);
    s.structures.level[other] = 3;
    expect(fleetCapOf(s, 0)).toBe(cap);
    expect(fleetCapOf(s, 1)).toBe(HELI_FLEET_BASE + 3);
  });

  it('H16: a launch with exactly all of the seat\'s troops is accepted', () => {
    const s = world();
    const f = factoryWithHeli(s);
    s.troops[1] = 300 * QT_PER_TROOP;
    expect(applyLaunchHeli(s, 0, f, NEUTRAL_LZ, 300, 0)).toBe(REJECT_NONE);
    expect(s.troops[1]).toBe(0);
  });

  it('H23 / H24: a helicopter can be recalled while it lifts and while it hovers', () => {
    const s = world();
    const f = factoryWithHeli(s);
    expect(applyLaunchHeli(s, 0, f, NEUTRAL_LZ, 100, 0)).toBe(REJECT_NONE);
    expect(s.helis.state[0]).toBe(HELI_LIFT);
    const twin = world();
    const f2 = factoryWithHeli(twin);
    applyLaunchHeli(twin, 0, f2, NEUTRAL_LZ, 100, 0);
    expect(applyRecallHeli(twin, 0, 0)).toBe(REJECT_NONE); // LIFT
    for (let i = 0; i < 3000 && s.helis.state[0] !== HELI_HOVER; i++) fly(s);
    expect(s.helis.state[0]).toBe(HELI_HOVER);
    expect(applyRecallHeli(s, 0, 0)).toBe(REJECT_NONE);
  });

  it('G11: the way home leads to a FINISHED Factory even when an unfinished one is nearer', () => {
    const s = world();
    const f = factoryWithHeli(s);
    expect(applyLaunchHeli(s, 0, f, NEUTRAL_LZ, 100, 0)).toBe(REJECT_NONE);
    for (let i = 0; i < 3000 && s.helis.state[0] !== HELI_CRUISE; i++) fly(s);
    fly(s, 60);
    const x = (s.helis.x[0] as number) >> 8;
    const y = (s.helis.y[0] as number) >> 8;
    const unfinished = s.structures.add(STRUCT_FACTORY, 1, at(x, y), s.tick);
    expect(s.tick).toBeLessThan(s.structures.readyTick[unfinished] as number);
    expect(applyRecallHeli(s, 0, 0)).toBe(REJECT_NONE);
    const last = (s.helis.routeLen[0] as number) - 1;
    expect(s.helis.route[last]).toBe(at(230, 60));
  });

  it('G01: the cruise speed is exactly the step of the mode, not within 5 percent of it', () => {
    const s = world();
    const f = factoryWithHeli(s);
    expect(applyLaunchHeli(s, 0, f, at(300, 60), 100, 0)).toBe(REJECT_NONE);
    for (let i = 0; i < 3000 && s.helis.state[0] !== HELI_CRUISE; i++) fly(s);
    fly(s, 2);
    const x0 = s.helis.x[0] as number;
    fly(s, 20);
    expect(((s.helis.x[0] as number) - x0) / 20).toBe(heliStepQ8(0));
    expect(heliStepQ8(0)).toBe(Math.round(((AIR_MODE_SPEED_MILLICELLS_S[0] as number) * 256) / (1000 * TICK_HZ))); // rounded to the nearest step, not floored (G01)
  });
});

describe('[1.2] the landing price', () => {
  const ZONE = at(270, 60);
  function priced(posts: boolean, walls: boolean): number {
    const s = world();
    if (posts) {
      const p = s.structures.add(STRUCT_POST, 2, at(272, 60), 0);
      s.structures.readyTick[p] = 0;
    }
    if (walls) {
      const c = s.structures.add(STRUCT_CITY, 2, at(270, 61), 0);
      s.structures.readyTick[c] = 0;
      s.structures.setDistrict(c, 0, DISTRICT_WALLS, 1, 0, 0);
    }
    s.tick = 10;
    return landingCostMilli(s, ZONE, 2, 1);
  }
  it('N10 / N09 / N11: a Defense Post and Walls raise the price, and together they do not stack (the larger applies)', () => {
    const base = priced(false, false);
    const post = priced(true, false);
    const walls = priced(false, true);
    const both = priced(true, true);
    expect(post).toBe(Math.floor((base * 5) / 2)); // N10
    expect(walls).toBe(Math.floor((base * 150) / 100)); // N09
    expect(both).toBe(Math.max(post, walls)); // N11
    expect(both).toBeGreaterThan(walls);
  });

  it('N15 / N16: the unpaid fraction of the last cell is paid, rounded up; the carry between cells is kept', () => {
    const s = world();
    const f = factoryWithHeli(s);
    for (let k = 1; k < 9; k++) s.terrain[landingCell(W, H, NEUTRAL_LZ, k)] = CLASS_FOREST; // a price that is not a whole number of quarter troops
    const load = 200;
    expect(applyLaunchHeli(s, 0, f, NEUTRAL_LZ, load, 0)).toBe(REJECT_NONE);
    const afterLaunch = s.troops[1] as number;
    const e = flyUntilLanded(s);
    expect(e.b).toBe(9);
    let milli = 0;
    for (let k = 0; k < 9; k++) milli += landingCostMilli(s, landingCell(W, H, NEUTRAL_LZ, k), 0, 1);
    expect(milli % MILLI_QT_PER_QT).not.toBe(0); // the test needs a fraction
    const attack = s.attacks.find(1, 0);
    const back = (s.troops[1] as number) - afterLaunch + (attack?.troops ?? 0);
    expect(load * QT_PER_TROOP - back).toBe(Math.ceil(milli / MILLI_QT_PER_QT));
  });
});
