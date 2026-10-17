// M13c-1: the LaunchShip intent: wire codec, shape check, every refusal code ONE BY ONE, and the parity between the page-side `validateLaunchShip` (on a StateView) and the sim's own
// `applyLaunchShip` (both run `checkLaunchShip`: the same code answers the same question for every case below). The world is tools/sim/shipLanding.ts `shipFixture`: 256x64 plains,
// a 48 cell sea in x 96..143, the west seat (ownerId 1) with a finished Port on the shore, the east seat (ownerId 2) on the far shore.
import { describe, expect, it } from 'vitest';
import { decodeIntent, encodeIntent } from '../../src/sim/codec';
import { RELATION_ALLIANCE } from '../../src/sim/diplomacyTable';
import {
  REJECT_AMOUNT,
  REJECT_CELL,
  REJECT_DIPLO_TREATY_BOUND,
  REJECT_HELI_BEACHHEAD_FULL,
  REJECT_NONE,
  REJECT_PHASE,
  REJECT_SHIP_BAD_TARGET,
  REJECT_SHIP_COOLDOWN,
  REJECT_SHIP_FLEET_CAP,
  REJECT_SHIP_NOT_OWNER,
  REJECT_SHIP_NO_GOLD,
  REJECT_SHIP_NO_PORT,
  REJECT_SHIP_NO_ROUTE,
  REJECT_SHIP_NO_TROOPS,
  REJECT_SHIP_PORT_BUILDING,
  REJECT_SHIP_PORT_BUSY,
  REJECT_SHIP_TABLE_FULL,
  REJECT_SHIP_TROOPS_HIGH,
  REJECT_SHIP_TROOPS_LOW,
  REJECT_STRUCT_ID,
  compareIntents,
  launchShipBody,
  validateIntent,
  withId,
  type Intent,
} from '../../src/sim/intents';
import { OUTBOX_REJECT, OUTBOX_SHIP_LAUNCHED } from '../../src/sim/outbox';
import {
  BEACHHEAD_CAPACITY,
  MILLI_GOLD_PER_GOLD,
  QT_PER_TROOP,
  SHIP_CAPACITY,
  SHIP_CELLS_PER_TICK_Q,
  SHIP_COOLDOWN_TICKS,
  SHIP_FLEET_MAX,
  SHIP_LAND_REACH_CELLS,
  SHIP_LAND_TICKS,
  SHIP_LAUNCH_GOLD,
  SHIP_MAX_TROOPS,
  SHIP_MIN_TROOPS,
  SHIP_REASON_BASE,
  SHIP_ROUTE_CAPACITY,
  SHIP_ROUTE_MAX_CELLS,
} from '../../src/sim/rules';
import { applyLaunchShip } from '../../src/sim/shipPhase';
import { validateLaunchShip } from '../../src/sim/shipRules';
import { SHIP_OFF, SHIP_SAIL } from '../../src/sim/shipTable';
import { step } from '../../src/sim/step';
import { rebuildAggregates, type GameState } from '../../src/sim/state';
import { STRUCT_FACTORY } from '../../src/sim/structureRules';
import { CLASS_DEEP_SEA, CLASS_PEAK } from '../../src/sim/terrain';
import { BEACH_CUT_OFF } from '../../src/sim/heliTable';
import { StateView } from '../../src/sim/view';
import { SHIP_W as W, shipFixture } from '../../tools/sim/shipLanding';

const at = (x: number, y: number): number => y * W + x;
const TROOPS = 100;

interface Case {
  readonly s: GameState;
  readonly port: number;
  readonly target: number;
}

/** A launch that is legal: seed 0 puts the Port at (95, 24) and the east target at (144, 28); the island is left out (it is only the route's business). */
function base(opts: Parameters<typeof shipFixture>[1] = {}): Case {
  const fx = shipFixture(0, { island: false, ...opts });
  return { s: fx.state, port: fx.port, target: fx.target };
}

/** The refusal the page-side check gives and the one the sim gives (on the same state, the sim last: it may change it) - they must agree. */
function both(c: Case, seat = 0, troops = TROOPS, port = c.port, target = c.target): number {
  const view = new StateView(c.s);
  const page = validateLaunchShip(view, seat, port, target, troops);
  const sim = applyLaunchShip(c.s, seat, port, target, troops);
  expect(sim, 'the page-side check and the sim agree').toBe(page);
  return sim;
}

describe('LaunchShip: the intent', () => {
  it('has wire kind 23 and a codec that round-trips', () => {
    const i: Intent = withId(launchShipBody(1, 77, 9104, 600), 5);
    const bytes = encodeIntent(i);
    expect(bytes[0]).toBe(23);
    const back = decodeIntent(bytes);
    expect(back.ok && back.value).toEqual(i);
  });

  it('shape: a port out of range is REJECT_STRUCT_ID, a cell out of range REJECT_CELL, troops out of range REJECT_AMOUNT', () => {
    const ctx = { seats: 2, cells: 100, debugIntents: false };
    const ok = withId(launchShipBody(0, 3, 50, 100), 0);
    expect(validateIntent(ok, ctx)).toBe(REJECT_NONE);
    expect(validateIntent({ ...ok, port: 4096 }, ctx)).toBe(REJECT_STRUCT_ID);
    expect(validateIntent({ ...ok, targetCell: 100 }, ctx)).toBe(REJECT_CELL);
    expect(validateIntent({ ...ok, troops: -1 }, ctx)).toBe(REJECT_AMOUNT);
    expect(validateIntent({ ...ok, troops: 1.5 }, ctx)).toBe(REJECT_AMOUNT);
  });

  it('is ordered by port, then target cell, then troops', () => {
    const a = withId(launchShipBody(0, 1, 5, 9), 0);
    expect(compareIntents(a, withId(launchShipBody(0, 2, 1, 1), 0))).toBeLessThan(0);
    expect(compareIntents(a, withId(launchShipBody(0, 1, 6, 1), 0))).toBeLessThan(0);
    expect(compareIntents(a, withId(launchShipBody(0, 1, 5, 10), 0))).toBeLessThan(0);
    expect(compareIntents(a, withId(launchShipBody(0, 1, 5, 9), 0))).toBe(0);
  });

  it('the numbers of the rules are the ones of docs/BALANCE.md (a literal pin: the tests above use the constants)', () => {
    expect([SHIP_CAPACITY, SHIP_FLEET_MAX, SHIP_MIN_TROOPS, SHIP_MAX_TROOPS, SHIP_LAUNCH_GOLD, SHIP_LAND_REACH_CELLS, SHIP_ROUTE_CAPACITY, SHIP_ROUTE_MAX_CELLS]).toEqual([32, 4, 20, 1200, 100, 2, 48, 16384]);
    expect([SHIP_CELLS_PER_TICK_Q, SHIP_LAND_TICKS, SHIP_COOLDOWN_TICKS]).toEqual([32, 20, 300]);
  });

  it('the refusal codes are a block of their own above every older code, all different', () => {
    const codes = [REJECT_SHIP_NO_PORT, REJECT_SHIP_NOT_OWNER, REJECT_SHIP_PORT_BUILDING, REJECT_SHIP_PORT_BUSY, REJECT_SHIP_COOLDOWN, REJECT_SHIP_FLEET_CAP, REJECT_SHIP_TROOPS_LOW, REJECT_SHIP_TROOPS_HIGH, REJECT_SHIP_NO_TROOPS, REJECT_SHIP_NO_GOLD, REJECT_SHIP_BAD_TARGET, REJECT_SHIP_NO_ROUTE, REJECT_SHIP_TABLE_FULL];
    expect(new Set(codes).size).toBe(13);
    expect(SHIP_REASON_BASE).toBe(120);
    for (const c of codes) expect(c).toBeGreaterThan(SHIP_REASON_BASE);
  });
});

describe('LaunchShip: a legal launch', () => {
  it('draws the troops and the gold, makes the row and announces it; step() applies the same intent', () => {
    const c = base();
    const view = new StateView(c.s);
    expect(validateLaunchShip(view, 0, c.port, c.target, TROOPS)).toBe(REJECT_NONE);
    const troopsBefore = c.s.troops[1] as number;
    const goldBefore = c.s.gold[1] as number;
    c.s.outbox.clear();
    expect(applyLaunchShip(c.s, 0, c.port, c.target, TROOPS)).toBe(REJECT_NONE);
    expect(c.s.troops[1]).toBe(troopsBefore - TROOPS * QT_PER_TROOP);
    expect(c.s.gold[1]).toBe(goldBefore - SHIP_LAUNCH_GOLD * MILLI_GOLD_PER_GOLD);
    const t = c.s.ships;
    expect([t.liveCount, t.owner[0], t.state[0], t.port[0], t.load[0], t.target[0]]).toEqual([1, 1, SHIP_SAIL, c.port, TROOPS, c.target + 1]);
    expect(t.routeCell(0, 0)).toBe(at(96, 24)); // the water cell next to the Port
    expect(t.countOf(1)).toBe(1);
    expect(c.s.outbox.drain().filter((e) => e.kind === OUTBOX_SHIP_LAUNCHED)).toEqual([{ kind: OUTBOX_SHIP_LAUNCHED, tick: c.s.tick, a: 0, b: c.target }]);
    // through step(): the second launch from the same Port is refused as busy, the refusal is reported in the outbox
    const d = base();
    const r = step(d.s, { turn: d.s.tick, intents: [withId(launchShipBody(0, d.port, d.target, TROOPS), 0), withId(launchShipBody(0, d.port, d.target, TROOPS), 1)] });
    expect(r.ok && r.applied).toBe(1);
    expect(d.s.outbox.drain().filter((e) => e.kind === OUTBOX_REJECT).map((e) => e.a)).toEqual([REJECT_SHIP_PORT_BUSY]);
  });
});

describe('LaunchShip: every refusal, one by one (page check == sim check)', () => {
  it('REJECT_PHASE in the spawn phase', () => {
    expect(both(base({ config: { debugIntents: true, spawnPhase: true } }))).toBe(REJECT_PHASE);
  });

  it('REJECT_SHIP_NO_PORT: no such structure, a free slot, a Factory', () => {
    expect(both(base(), 0, TROOPS, 99)).toBe(REJECT_SHIP_NO_PORT);
    const c = base();
    const f = c.s.structures.add(STRUCT_FACTORY, 1, at(50, 30), 0);
    expect(both(c, 0, TROOPS, f)).toBe(REJECT_SHIP_NO_PORT);
    expect(both(base(), 0, TROOPS, 4095)).toBe(REJECT_SHIP_NO_PORT);
  });

  it('REJECT_SHIP_NOT_OWNER: the other seat cannot use the Port', () => {
    const c = base();
    c.s.gold[2] = 1000 * MILLI_GOLD_PER_GOLD;
    expect(both(c, 1)).toBe(REJECT_SHIP_NOT_OWNER);
  });

  it('REJECT_SHIP_PORT_BUILDING: the Port is not finished', () => {
    const c = base();
    const ready = c.s.structures.readyTick[c.port] as number;
    c.s.tick = ready - 1;
    expect(both(c)).toBe(REJECT_SHIP_PORT_BUILDING);
    c.s.tick = ready; // finished at its ready tick
    expect(both(c)).toBe(REJECT_NONE);
  });

  it('REJECT_SHIP_PORT_BUSY while the ship is out, REJECT_SHIP_COOLDOWN while it is docked and cooling down', () => {
    const c = base();
    expect(both(c)).toBe(REJECT_NONE);
    expect(both(c)).toBe(REJECT_SHIP_PORT_BUSY);
    c.s.ships.state[0] = SHIP_OFF;
    expect(both(c)).toBe(REJECT_SHIP_COOLDOWN);
  });

  it('REJECT_SHIP_FLEET_CAP at SHIP_FLEET_MAX ships of the owner (a docked one counts)', () => {
    const c = base();
    for (let i = 0; i < SHIP_FLEET_MAX - 1; i++) c.s.ships.add(i, 1, 50 + i, 0, 0, SHIP_MIN_TROOPS, 1);
    c.s.ships.state[0] = SHIP_OFF;
    expect(both(c)).toBe(REJECT_NONE); // one below the cap: this launch is the last allowed
    const d = base();
    for (let i = 0; i < SHIP_FLEET_MAX; i++) d.s.ships.add(i, 1, 50 + i, 0, 0, SHIP_MIN_TROOPS, 1);
    d.s.ships.state[0] = SHIP_OFF;
    expect(both(d)).toBe(REJECT_SHIP_FLEET_CAP);
  });

  it('REJECT_SHIP_TROOPS_LOW below SHIP_MIN_TROOPS (also a fraction), REJECT_SHIP_TROOPS_HIGH above SHIP_MAX_TROOPS', () => {
    expect(both(base(), 0, SHIP_MIN_TROOPS - 1)).toBe(REJECT_SHIP_TROOPS_LOW);
    expect(both(base(), 0, 0)).toBe(REJECT_SHIP_TROOPS_LOW);
    expect(both(base(), 0, SHIP_MIN_TROOPS + 0.5)).toBe(REJECT_SHIP_TROOPS_LOW);
    expect(both(base(), 0, SHIP_MIN_TROOPS)).toBe(REJECT_NONE);
    expect(both(base(), 0, SHIP_MAX_TROOPS + 1)).toBe(REJECT_SHIP_TROOPS_HIGH);
    expect(both(base(), 0, SHIP_MAX_TROOPS)).toBe(REJECT_NONE);
  });

  it('REJECT_SHIP_NO_TROOPS when the seat has fewer troops than it asks for', () => {
    const c = base();
    c.s.troops[1] = 99 * QT_PER_TROOP + 3; // 99 whole troops
    expect(both(c, 0, 100)).toBe(REJECT_SHIP_NO_TROOPS);
    expect(both(c, 0, 99)).toBe(REJECT_NONE);
  });

  it('REJECT_SHIP_NO_GOLD below SHIP_LAUNCH_GOLD', () => {
    const c = base();
    c.s.gold[1] = SHIP_LAUNCH_GOLD * MILLI_GOLD_PER_GOLD - 1;
    expect(both(c)).toBe(REJECT_SHIP_NO_GOLD);
    c.s.gold[1] = SHIP_LAUNCH_GOLD * MILLI_GOLD_PER_GOLD;
    expect(both(c)).toBe(REJECT_NONE);
  });

  it('REJECT_SHIP_TABLE_FULL when all SHIP_CAPACITY slots are used (by other owners)', () => {
    const c = base({ seats: 10 });
    for (let i = 0; i < SHIP_CAPACITY; i++) c.s.ships.add(i, 3 + (i % 8), 100 + i, 0, 0, SHIP_MIN_TROOPS, 1);
    expect(both(c)).toBe(REJECT_SHIP_TABLE_FULL);
    const d = base({ seats: 10 });
    for (let i = 0; i < SHIP_CAPACITY - 1; i++) d.s.ships.add(i, 3 + (i % 8), 100 + i, 0, 0, SHIP_MIN_TROOPS, 1);
    expect(both(d)).toBe(REJECT_NONE); // the last free slot
  });

  it('REJECT_HELI_BEACHHEAD_FULL when the beachhead rows and the landings under way fill the table (a ship on its way counts)', () => {
    const c = base();
    for (let i = 0; i < BEACHHEAD_CAPACITY; i++) c.s.beachheads.add(2, at(150 + (i % 50), 5 + Math.floor(i / 50)), 0, BEACH_CUT_OFF);
    expect(both(c)).toBe(REJECT_HELI_BEACHHEAD_FULL);
    const d = base();
    for (let i = 0; i < BEACHHEAD_CAPACITY - 1; i++) d.s.beachheads.add(2, at(150 + (i % 50), 5 + Math.floor(i / 50)), 0, BEACH_CUT_OFF);
    d.s.ships.add(5, 2, 60, 0, 0, SHIP_MIN_TROOPS, 1); // a ship of the other seat that will want the last row
    d.s.ships.state[5] = SHIP_SAIL;
    expect(both(d)).toBe(REJECT_HELI_BEACHHEAD_FULL);
    const e = base();
    for (let i = 0; i < BEACHHEAD_CAPACITY - 1; i++) e.s.beachheads.add(2, at(150 + (i % 50), 5 + Math.floor(i / 50)), 0, BEACH_CUT_OFF);
    expect(both(e)).toBe(REJECT_NONE); // one row left
  });

  it('REJECT_SHIP_BAD_TARGET: sea, own land, a peak, inland, and the reach of SHIP_LAND_REACH_CELLS (2 cells from the water is fine, 3 is not)', () => {
    const c = base();
    expect(both(c, 0, TROOPS, c.port, at(110, 28))).toBe(REJECT_SHIP_BAD_TARGET); // open sea
    expect(both(c, 0, TROOPS, c.port, at(10, 28))).toBe(REJECT_SHIP_BAD_TARGET); // own land, inland
    c.s.owner[at(144, 40)] = 1; // an own cell ON the far coast (somebody's attack took it): nothing to land on
    rebuildAggregates(c.s);
    expect(both(c, 0, TROOPS, c.port, at(144, 40))).toBe(REJECT_SHIP_BAD_TARGET);
    expect(both(c, 0, TROOPS, c.port, at(200, 28))).toBe(REJECT_SHIP_BAD_TARGET); // inland, far from the water
    c.s.terrain[at(145, 20)] = CLASS_PEAK;
    expect(both(c, 0, TROOPS, c.port, at(145, 20))).toBe(REJECT_SHIP_BAD_TARGET); // a peak cannot be owned
    expect(both(c, 0, TROOPS, c.port, at(146, 28))).toBe(REJECT_SHIP_BAD_TARGET); // 3 cells from the water (x 143)
    const d = base();
    expect(both(d, 0, TROOPS, d.port, at(145, 28))).toBe(REJECT_NONE); // 2 cells from the water
  });

  it('REJECT_DIPLO_TREATY_BOUND when an alliance or a truce binds the seat to the owner of the landing cell', () => {
    const c = base();
    c.s.diplo.setRelation(1, 2, RELATION_ALLIANCE, 0);
    expect(both(c)).toBe(REJECT_DIPLO_TREATY_BOUND);
    const d = base();
    expect(both(d)).toBe(REJECT_NONE); // at war: allowed
    // neutral land has no owner to be bound to
    const e = base();
    for (let x = 144; x < 160; x++) for (let y = 0; y < 64; y++) e.s.owner[at(x, y)] = 0;
    rebuildAggregates(e.s);
    e.s.diplo.setRelation(1, 2, RELATION_ALLIANCE, 0);
    expect(both(e)).toBe(REJECT_NONE);
  });

  it('REJECT_SHIP_NO_ROUTE: a wall of land across the sea, and a Port with no water next to it', () => {
    const c = base();
    for (let y = 0; y < 64; y++) c.s.terrain[at(120, y)] = 2;
    expect(both(c)).toBe(REJECT_SHIP_NO_ROUTE);
    const d = base();
    const inland = d.s.structures.add(STRUCT_FACTORY, 1, at(40, 30), 0);
    // the structure slot becomes a Port by type (the table holds no placement rules)
    d.s.structures.type[inland] = d.s.structures.type[d.port] as number;
    d.s.structures.readyTick[inland] = 0;
    expect(both(d, 0, TROOPS, inland)).toBe(REJECT_SHIP_NO_ROUTE);
  });

  it('a refused launch changes nothing (no troops or gold drawn, no row)', () => {
    const c = base();
    const troops = c.s.troops[1] as number;
    const gold = c.s.gold[1] as number;
    expect(both(c, 0, SHIP_MAX_TROOPS + 1)).toBe(REJECT_SHIP_TROOPS_HIGH);
    expect(both(c, 0, TROOPS, c.port, at(110, 28))).toBe(REJECT_SHIP_BAD_TARGET);
    expect([c.s.troops[1], c.s.gold[1], c.s.ships.liveCount]).toEqual([troops, gold, 0]);
  });

  it('the sea is DEEP_SEA in the fixture (a guard for the cases above)', () => {
    expect(base().s.terrain[at(110, 28)]).toBe(CLASS_DEEP_SEA);
  });
});
