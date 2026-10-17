// M13c-1: the voyage of a ship (src/sim/shipPhase.ts): the exact flight time, the landing that is the helicopter's landing, a treaty that begins under way, an eliminated owner, a
// lost Port, and a save in the middle of the voyage. The world is tools/sim/shipLanding.ts `shipFixture` without the island: the west Port at (95, 24), the sea x 96..143, the east
// coast at x 144. The voyage is driven by `shipPhase` + the tick counter (no economy), so troops move only by what the ship does.
import { describe, expect, it } from 'vitest';
import { RELATION_ALLIANCE } from '../../src/sim/diplomacyTable';
import { performLanding } from '../../src/sim/heliLanding';
import { BEACH_CUT_OFF } from '../../src/sim/heliTable';
import { launchShipBody, withId } from '../../src/sim/intents';
import {
  OUTBOX_HELI_LANDED,
  OUTBOX_SHIP_LANDED,
  OUTBOX_SHIP_LAUNCHED,
  OUTBOX_SHIP_RETURNED,
  OUTBOX_SHIP_RTB,
  OUTBOX_SHIP_SCRAPPED,
  type OutboxEvent,
} from '../../src/sim/outbox';
import { MILLI_GOLD_PER_GOLD, QT_PER_TROOP, SHIP_LAUNCH_GOLD } from '../../src/sim/rules';
import { deserialize, hashState, serialize } from '../../src/sim/serialize';
import { applyLaunchShip, shipPhase } from '../../src/sim/shipPhase';
import { SHIP_LAND, SHIP_OFF, SHIP_RETURN, SHIP_SAIL } from '../../src/sim/shipTable';
import { step } from '../../src/sim/step';
import { rebuildAggregates, type GameState } from '../../src/sim/state';
import { STRUCT_PORT } from '../../src/sim/structureRules';
import { SHIP_W as W, shipFixture } from '../../tools/sim/shipLanding';

const at = (x: number, y: number): number => y * W + x;
const LOAD = 600;
const TROOPS_BEFORE = 2000 * QT_PER_TROOP;

interface Voyage {
  readonly s: GameState;
  readonly port: number;
  readonly target: number;
  readonly events: OutboxEvent[];
  /** The tick of the launch (the fixture starts when the Port is finished). */
  readonly t0: number;
}

/** Seed 0: Port (95, 24), start cell (96, 24); the target is on the same row so that the route is a straight line of 46 cells (96 -> 142). */
function voyage(targetX = 144, opts: Parameters<typeof shipFixture>[1] = {}): Voyage {
  const fx = shipFixture(0, { island: false, ...opts });
  return { s: fx.state, port: fx.port, target: at(targetX, 24), events: [], t0: fx.state.tick };
}

function launch(v: Voyage, load = LOAD): void {
  expect(applyLaunchShip(v.s, 0, v.port, v.target, load)).toBe(0);
  v.events.push(...v.s.outbox.drain());
}

/** `n` ticks of the ship phase alone, collecting the events. */
function phases(v: Voyage, n: number): void {
  for (let i = 0; i < n; i++) {
    shipPhase(v.s);
    v.s.tick++;
    v.events.push(...v.s.outbox.drain());
  }
}

const eventsOf = (v: Voyage, kind: number): OutboxEvent[] => v.events.filter((e) => e.kind === kind);

describe('the flight time is exact', () => {
  it('46 cells at 32 Q8 per tick: arrives after 368 phases, lands 20 ticks later (tick 387), docks at 756 and the row is gone at 1056', () => {
    const v = voyage();
    launch(v);
    const t = v.s.ships;
    expect(eventsOf(v, OUTBOX_SHIP_LAUNCHED)).toEqual([{ kind: OUTBOX_SHIP_LAUNCHED, tick: v.t0, a: 0, b: v.target }]);
    expect([t.routeLen[0], t.routeCell(0, 0), t.routeCell(0, 1)]).toEqual([2, at(96, 24), at(142, 24)]);
    expect([t.x[0], t.y[0]]).toEqual([96 * 256 + 128, 24 * 256 + 128]);
    phases(v, 367);
    expect(t.state[0]).toBe(SHIP_SAIL);
    expect(t.x[0]).toBe(96 * 256 + 128 + 367 * 32); // 32 Q8 per tick, in a straight line
    phases(v, 1);
    expect([t.state[0], t.x[0], t.stateTick[0]]).toEqual([SHIP_LAND, 142 * 256 + 128, v.t0 + 367]);
    phases(v, 19); // up to tick 386
    expect(eventsOf(v, OUTBOX_SHIP_LANDED)).toEqual([]);
    phases(v, 1); // tick 387: SHIP_LAND_TICKS after the arrival
    const landed = eventsOf(v, OUTBOX_SHIP_LANDED);
    expect(landed.map((e) => e.tick)).toEqual([v.t0 + 387]);
    expect(landed[0]?.b).toBeGreaterThan(0);
    expect(eventsOf(v, OUTBOX_SHIP_RTB)).toEqual([{ kind: OUTBOX_SHIP_RTB, tick: v.t0 + 387, a: 0, b: 0 }]);
    expect(t.state[0]).toBe(SHIP_RETURN);
    phases(v, 756 - 387);
    expect(eventsOf(v, OUTBOX_SHIP_RETURNED)).toEqual([{ kind: OUTBOX_SHIP_RETURNED, tick: v.t0 + 756, a: 0, b: v.port }]);
    expect([t.state[0], t.routeIdx[0]]).toEqual([SHIP_OFF, 0]);
    expect(t.x[0]).toBe(96 * 256 + 128); // home at the start cell
    phases(v, 299); // up to tick 1055
    expect(t.liveCount).toBe(1);
    phases(v, 1); // tick 1056: SHIP_COOLDOWN_TICKS after the docking
    expect(t.liveCount).toBe(0);
    expect(t.countOf(1)).toBe(0);
  });

  it('a longer crossing takes proportionally longer (the target 20 cells further: 66 cells -> 528 phases)', () => {
    const w = voyage(164, { island: false });
    for (let y = 0; y < 64; y++) for (let x = 144; x < 164; x++) w.s.terrain[at(x, y)] = 0; // the sea reaches x 163
    launch(w);
    phases(w, 527);
    expect(w.s.ships.state[0]).toBe(SHIP_SAIL);
    phases(w, 1);
    expect(w.s.ships.state[0]).toBe(SHIP_LAND);
    expect(w.s.ships.stateTick[0]).toBe(w.t0 + 527);
  });
});

/** What a landing of `load` troops at `lz` leaves behind, from the ship (world A, run to the landing) and from a helicopter's `performLanding` on an identical world (B). */
function compareLanding(lzX: number, lzY: number, prepare: (s: GameState) => void, load = LOAD): { cellsA: number; a: GameState; b: GameState } {
  const mk = (): Voyage => {
    const v = voyage(lzX);
    prepare(v.s);
    return v;
  };
  const a = mk();
  const target = at(lzX, lzY);
  expect(applyLaunchShip(a.s, 0, a.port, target, load)).toBe(0);
  a.events.push(...a.s.outbox.drain());
  for (let i = 0; i < 2000 && eventsOf(a, OUTBOX_SHIP_LANDED).length === 0; i++) phases(a, 1);
  const landed = eventsOf(a, OUTBOX_SHIP_LANDED)[0] as OutboxEvent;
  // B: the same world at the same tick, the same troops and gold drawn, and a helicopter that sets the same load down on the same cell
  const b = mk();
  b.s.tick = landed.tick;
  b.s.troops[1] = (b.s.troops[1] as number) - load * QT_PER_TROOP;
  b.s.gold[1] = (b.s.gold[1] as number) - SHIP_LAUNCH_GOLD * MILLI_GOLD_PER_GOLD;
  const h = b.s.helis.addBuilding(1, 0, landed.tick, landed.tick);
  b.s.helis.target[h] = target + 1;
  b.s.helis.load[h] = load;
  b.s.outbox.clear();
  performLanding(b.s, h);
  const heli = b.s.outbox.drain().find((e) => e.kind === OUTBOX_HELI_LANDED) as OutboxEvent;
  expect(heli.b, 'the same number of cells taken').toBe(landed.b);
  return { cellsA: landed.b, a: a.s, b: b.s };
}

function expectSameLanding(a: GameState, b: GameState): void {
  expect(Array.from(a.owner)).toEqual(Array.from(b.owner));
  expect(Array.from(a.troops)).toEqual(Array.from(b.troops));
  expect(Array.from(a.troopFrac)).toEqual(Array.from(b.troopFrac));
  expect(Array.from(a.gold)).toEqual(Array.from(b.gold));
  expect(Array.from(a.match.conquered)).toEqual(Array.from(b.match.conquered));
  for (const f of ['owner', 'seed', 'landTick', 'status'] as const) expect(Array.from(a.beachheads[f]), f).toEqual(Array.from(b.beachheads[f]));
  expect(a.beachheads.liveCount).toBe(b.beachheads.liveCount);
  expect(a.attacks.list.length).toBe(b.attacks.list.length);
}

describe('the landing is the helicopter landing', () => {
  it('on an enemy coast: the same cells, price, beachhead row and left-over troops as performLanding of a helicopter with the same load', () => {
    const { cellsA, a, b } = compareLanding(144, 24, () => undefined);
    expectSameLanding(a, b);
    expect(cellsA).toBeGreaterThanOrEqual(1);
    expect(cellsA).toBeLessThan(9); // 600 troops cannot buy all nine cells of enemy land (the price is doubled)
    expect(a.beachheads.liveCount).toBe(1);
    expect([a.beachheads.owner[0], a.beachheads.seed[0], a.beachheads.status[0]]).toEqual([1, at(144, 24), BEACH_CUT_OFF]);
    expect(a.owner[at(144, 24)]).toBe(1);
  });

  it('on neutral land (cheaper: not doubled): the same again, with more cells for the same load', () => {
    const neutral = (s: GameState): void => {
      for (let x = 144; x < 160; x++) for (let y = 0; y < 64; y++) s.owner[at(x, y)] = 0;
      rebuildAggregates(s);
    };
    const { cellsA, a, b } = compareLanding(145, 24, neutral);
    expectSameLanding(a, b);
    expect(cellsA).toBe(9); // the whole 3 x 3 block (the zone is 2 cells from the water, so all nine are land)
    const enemy = compareLanding(145, 24, () => undefined);
    expectSameLanding(enemy.a, enemy.b);
    expect(enemy.cellsA).toBe(9);
    // the troops that are not spent on the cells go on as an Attack: the enemy coast costs more (LANDING_ENEMY_COST_PCT), so less is left
    const left = (s: GameState): number => (s.troops[1] as number) + s.attacks.list.reduce((n, at0) => n + at0.troops, 0);
    expect(left(a)).toBeGreaterThan(left(enemy.a));
    expect(left(a)).toBeLessThan(TROOPS_BEFORE); // something was paid
  });

  it('next to land the owner already holds, the landing makes no beachhead row (it is ordinary land at once)', () => {
    const own = (s: GameState): void => {
      s.owner[at(146, 23)] = 1; // an own cell next to the landing block
      rebuildAggregates(s);
    };
    const { cellsA, a, b } = compareLanding(145, 24, own);
    expectSameLanding(a, b);
    expect(cellsA).toBeGreaterThanOrEqual(1);
    expect(a.beachheads.liveCount).toBe(0);
  });
});

describe('a landing that cannot be made', () => {
  it('a landing cell that has become the owner\'s own land: nothing is landed (event b = 0), the load sails home with the ship and is handed back at the Port', () => {
    const v = voyage();
    launch(v);
    phases(v, 100);
    for (let dy = -2; dy <= 2; dy++) for (let dx = 0; dx <= 3; dx++) v.s.owner[at(144 + dx, 24 + dy)] = 1; // somebody else's attack took the coast meanwhile
    rebuildAggregates(v.s);
    const area = v.s.agg.area[1] as number;
    phases(v, 300);
    expect(eventsOf(v, OUTBOX_SHIP_LANDED).map((e) => e.b)).toEqual([0]);
    expect(v.s.beachheads.liveCount).toBe(0);
    expect(v.s.agg.area[1]).toBe(area);
    expect(eventsOf(v, OUTBOX_SHIP_RTB).map((e) => e.b)).toEqual([0]);
    phases(v, 400);
    expect(eventsOf(v, OUTBOX_SHIP_RETURNED).length).toBe(1);
    expect(v.s.troops[1]).toBe(TROOPS_BEFORE); // the whole load is back
  });

  it('a landing zone that cannot be taken: the load is lost (event b = -1), the ship still goes home empty', () => {
    const v = voyage();
    launch(v, 20);
    v.s.troops[1] = 0;
    v.s.grid.playable[v.target] = 0; // the zone is no playable cell when the ship gets there (the launch looked at the terrain class, the landing at the grid)
    phases(v, 400);
    expect(eventsOf(v, OUTBOX_SHIP_LANDED).map((e) => e.b)).toEqual([-1]);
    phases(v, 400);
    expect(eventsOf(v, OUTBOX_SHIP_RETURNED).length).toBe(1);
    expect(v.s.troops[1]).toBe(0); // nothing came back
  });
});

describe('a treaty that begins under way', () => {
  it('turns the ship back at once with its load, which is handed back in the Port; nothing is landed', () => {
    const v = voyage();
    const owners = Array.from(v.s.owner);
    launch(v);
    phases(v, 100);
    expect(v.s.ships.state[0]).toBe(SHIP_SAIL);
    v.s.diplo.setRelation(1, 2, RELATION_ALLIANCE, 0);
    phases(v, 1);
    expect(v.s.ships.state[0]).toBe(SHIP_RETURN);
    expect(eventsOf(v, OUTBOX_SHIP_RTB)).toEqual([{ kind: OUTBOX_SHIP_RTB, tick: v.t0 + 100, a: 0, b: 1 }]); // b = 1: a treaty
    expect(v.s.ships.load[0]).toBe(LOAD);
    expect(v.s.troops[1]).toBe(TROOPS_BEFORE - LOAD * QT_PER_TROOP);
    phases(v, 200);
    expect(eventsOf(v, OUTBOX_SHIP_RETURNED).length).toBe(1);
    expect(v.s.troops[1]).toBe(TROOPS_BEFORE); // all troops are back
    expect(v.s.ships.state[0]).toBe(SHIP_OFF);
    expect(eventsOf(v, OUTBOX_SHIP_LANDED)).toEqual([]);
    expect(Array.from(v.s.owner)).toEqual(owners);
    expect(v.s.beachheads.liveCount).toBe(0);
  });

  it('also while it unloads (state LAND)', () => {
    const v = voyage();
    launch(v);
    phases(v, 370);
    expect(v.s.ships.state[0]).toBe(SHIP_LAND);
    v.s.diplo.setRelation(1, 2, RELATION_ALLIANCE, 0);
    phases(v, 1);
    expect(v.s.ships.state[0]).toBe(SHIP_RETURN);
    expect(eventsOf(v, OUTBOX_SHIP_RTB).map((e) => e.b)).toEqual([1]);
    expect(eventsOf(v, OUTBOX_SHIP_LANDED)).toEqual([]);
  });

  it('a truce or an alliance with somebody else changes nothing', () => {
    const v = voyage(144, { seats: 3 });
    launch(v);
    v.s.diplo.setRelation(1, 3, RELATION_ALLIANCE, 0);
    phases(v, 390);
    expect(eventsOf(v, OUTBOX_SHIP_LANDED).length).toBe(1);
  });
});

describe('an eliminated owner and a lost Port', () => {
  it('a ship of an owner that is knocked out is scrapped in the same step (load lost, event cause 1)', () => {
    const v = voyage();
    step(v.s, { turn: v.s.tick, intents: [withId(launchShipBody(0, v.port, v.target, LOAD), 0)] });
    expect(v.s.ships.liveCount).toBe(1);
    for (let c = 0; c < v.s.owner.length; c++) if (v.s.owner[c] === 1) v.s.owner[c] = 0;
    rebuildAggregates(v.s);
    v.s.outbox.clear();
    step(v.s, { turn: v.s.tick, intents: [] });
    expect(v.s.match.eliminated[1]).toBe(1);
    expect(v.s.ships.liveCount).toBe(0);
    expect(v.s.outbox.drain().filter((e) => e.kind === OUTBOX_SHIP_SCRAPPED)).toEqual([{ kind: OUTBOX_SHIP_SCRAPPED, tick: v.s.tick, a: 0, b: 1 }]);
  });

  it('a Port conquered or deleted under way: the ship sails on and lands, but does not return - it is scrapped (cause 2)', () => {
    for (const how of ['conquered', 'deleted'] as const) {
      const v = voyage();
      launch(v);
      phases(v, 50);
      if (how === 'conquered') v.s.structures.owner[v.port] = 2;
      else v.s.structures.remove(v.port);
      phases(v, 340);
      expect(eventsOf(v, OUTBOX_SHIP_LANDED).length, how).toBe(1);
      expect(eventsOf(v, OUTBOX_SHIP_SCRAPPED), how).toEqual([{ kind: OUTBOX_SHIP_SCRAPPED, tick: v.t0 + 387, a: 0, b: 2 }]);
      expect(eventsOf(v, OUTBOX_SHIP_RTB), how).toEqual([]);
      expect(v.s.ships.liveCount, how).toBe(0);
    }
  });

  it('a Port lost while the ship is on its way home: scrapped on arrival and the load that was still aboard is lost', () => {
    const v = voyage();
    launch(v);
    phases(v, 100);
    v.s.diplo.setRelation(1, 2, RELATION_ALLIANCE, 0);
    phases(v, 1); // turned back at 100 with the whole load
    v.s.structures.owner[v.port] = 2;
    phases(v, 200);
    expect(eventsOf(v, OUTBOX_SHIP_RETURNED)).toEqual([]);
    expect(eventsOf(v, OUTBOX_SHIP_SCRAPPED).map((e) => e.b)).toEqual([2]);
    expect(v.s.ships.liveCount).toBe(0);
    expect(v.s.troops[1]).toBe(TROOPS_BEFORE - LOAD * QT_PER_TROOP); // the load is gone
  });

  it('a Port that stands on the same cell but belongs to somebody else does not take the ship in', () => {
    const v = voyage();
    launch(v);
    phases(v, 100);
    v.s.diplo.setRelation(1, 2, RELATION_ALLIANCE, 0);
    phases(v, 1);
    const cell = v.s.structures.cell[v.port] as number;
    v.s.structures.remove(v.port);
    const other = v.s.structures.add(STRUCT_PORT, 1, at(60, 5), 0); // a Port of the same owner somewhere else
    v.s.structures.readyTick[other] = 0;
    expect(cell).toBe(at(95, 24));
    phases(v, 200);
    expect(eventsOf(v, OUTBOX_SHIP_RETURNED)).toEqual([]);
    expect(eventsOf(v, OUTBOX_SHIP_SCRAPPED).map((e) => e.b)).toEqual([2]);
  });
});

describe('save in the middle of a voyage', () => {
  /** The whole game through step(): the launch at tick 3, then idle turns. Returns the hash after every tick. */
  function run(ticks: number, saveAt: number | null): { hashes: number[]; end: number } {
    let v = voyage();
    let id = 1;
    const hashes: number[] = [];
    for (let t = 0; t < ticks; t++) {
      if (saveAt !== null && t === saveAt) {
        const r = deserialize(serialize(v.s));
        expect(r.ok).toBe(true);
        if (r.ok) v = { ...v, s: r.state };
      }
      const intents = t === 3 ? [withId(launchShipBody(0, v.port, v.target, LOAD), id++)] : [];
      step(v.s, { turn: v.s.tick, intents });
      hashes.push(hashState(v.s));
    }
    return { hashes, end: hashState(v.s) };
  }

  it('restoring at the start of the sail, in the landing, on the way home, docked and after the cooldown gives the straight run hash at every later tick', () => {
    const straight = run(1500, null);
    expect(new Set(straight.hashes).size).toBeGreaterThan(1000);
    for (const at0 of [100, 385, 600, 900, 1400]) {
      const r = run(1500, at0);
      expect(r.hashes.slice(at0), `restored at ${at0}`).toEqual(straight.hashes.slice(at0));
    }
  });

  it('the states at those moments really are sail, landing, return, docked, gone', () => {
    const v = voyage();
    let id = 1;
    const seen: number[] = [];
    for (let t = 0; t < 1500; t++) {
      step(v.s, { turn: v.s.tick, intents: t === 3 ? [withId(launchShipBody(0, v.port, v.target, LOAD), id++)] : [] });
      if ([100, 385, 600, 900, 1400].includes(t)) seen.push(v.s.ships.liveCount === 0 ? 0 : (v.s.ships.state[0] as number));
    }
    expect(seen).toEqual([SHIP_SAIL, SHIP_LAND, SHIP_RETURN, SHIP_OFF, 0]);
  });
});
