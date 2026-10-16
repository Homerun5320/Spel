// M12a-1: the helicopter table and ProduceHeli. Every reason code, the price and the time tick-exact, the fleet cap (a helicopter under production
// counts), the free list and the reused id, the codec, the round trip and "a snapshot equals the straight run" with helicopters in the table, the
// ranges deserialize refuses, and what happens to the helicopters of a Factory that is conquered, deleted or destroyed. Each test drives the real
// sim path (step / applyIntent), so a rule removed from checkProduceHeli or heliPhase fails here.
import { describe, expect, it } from 'vitest';
import { decodeIntent, decodeTurn, encodeIntent, encodeTurn } from '../../src/sim/codec';
import { HELI_BUILDING, HELI_CRUISE, HELI_PAD, HELI_POS_ONE, HeliTable } from '../../src/sim/heliTable';
import { checkProduceHeli, fleetCapOf, fleetCountOf, HELI_PRICE_MILLI, validateProduceHeli } from '../../src/sim/heliRules';
import {
  compareIntents,
  copyBody,
  kindCode,
  produceHeliBody,
  REJECT_HELI_FACTORY_BUILDING,
  REJECT_HELI_FLEET_CAP,
  REJECT_HELI_NO_FACTORY,
  REJECT_HELI_NO_GOLD,
  REJECT_HELI_NOT_OWNER,
  REJECT_HELI_QUEUE_BUSY,
  REJECT_NONE,
  REJECT_PHASE,
  REJECT_STRUCT_ID,
  validateIntent,
  withId,
  type Intent,
} from '../../src/sim/intents';
import { OUTBOX_HELI_PRODUCED, OUTBOX_HELI_QUEUED, OUTBOX_HELI_SCRAPPED, type OutboxEvent } from '../../src/sim/outbox';
import { BEACHHEAD_CAPACITY, BUILD_TICKS, HELI_BUILD_TICKS, HELI_FLEET_BASE, HELI_FLEET_MAX, HELI_FUEL_CELLS, HELI_FUEL_MAX_Q8, HELI_HP_TENTHS, HELI_PRICE_GOLD, MILLI_GOLD_PER_GOLD, TICK_HZ } from '../../src/sim/rules';
import { createScenarioState, runScenario } from '../../src/sim/scenario';
import { deserialize, hashState, serialize } from '../../src/sim/serialize';
import { applyIntent, step } from '../../src/sim/step';
import { createState, rebuildAggregates, type GameState } from '../../src/sim/state';
import { STRUCT_CITY, STRUCT_FACTORY } from '../../src/sim/structureRules';
import { setOwner } from '../../src/sim/territory';
import { CLASS_PLAINS } from '../../src/sim/terrain';
import { StateView } from '../../src/sim/view';

const W = 128;
const H = 64;
const at = (x: number, y: number): number => y * W + x;
const GOLD = 100000 * MILLI_GOLD_PER_GOLD;

/** A plains world: the left half is seat 0's land (ownerId 1), the right half seat 1's (ownerId 2); both are rich. */
function world(config: { debugIntents: boolean; spawnPhase?: boolean } = { debugIntents: true }): GameState {
  const terrain = new Uint8Array(W * H).fill(CLASS_PLAINS);
  const s = createState({ width: W, height: H, seed: 5, seats: 2, config, terrain, elevation: new Uint16Array(W * H) });
  for (let c = 0; c < W * H; c++) s.owner[c] = c % W < W / 2 ? 1 : 2;
  rebuildAggregates(s);
  s.gold[1] = GOLD;
  s.gold[2] = GOLD;
  return s;
}

function idle(s: GameState, ticks: number): void {
  for (let i = 0; i < ticks; i++) expect(step(s, { turn: s.tick, intents: [] }).ok).toBe(true);
}

/** A Factory of `ownerId` at (x, y), finished (the world is stepped until its build time has run out). */
function addFactory(s: GameState, ownerId: number, x: number, y: number): number {
  const id = s.structures.add(STRUCT_FACTORY, ownerId, at(x, y), s.tick);
  idle(s, BUILD_TICKS[STRUCT_FACTORY]!);
  return id;
}

let nextId = 1;
/** What the last `order` took from the purse: the same step without the order, run on a copy, shows the income that the economy adds in that tick. NaN when the state cannot be copied. */
let lastSpent = 0;
/** Runs ONE step that carries a ProduceHeli; returns the refusal code (REJECT_NONE when it was accepted) by the outbox of that step. */
function order(s: GameState, seat: number, factory: number): number {
  const twin = deserialize(serialize(s));
  if (twin.ok) step(twin.state, { turn: s.tick, intents: [] });
  s.outbox.clear();
  step(s, { turn: s.tick, intents: [withId(produceHeliBody(seat, factory), nextId++)] });
  lastSpent = twin.ok ? (twin.state.gold[seat + 1] as number) - (s.gold[seat + 1] as number) : Number.NaN;
  const refused = s.outbox.drain().filter((e) => e.kind === 2);
  return refused.length === 0 ? REJECT_NONE : (refused[0] as OutboxEvent).a;
}

describe('ProduceHeli: every reason code (the real step path)', () => {
  it('REJECT_PHASE in the spawn phase of a match with a start phase', () => {
    const s = world({ debugIntents: true, spawnPhase: true });
    const f = s.structures.add(STRUCT_FACTORY, 1, at(10, 10), 0);
    s.structures.readyTick[f] = 0; // finished at once, so that only the phase can refuse
    expect(order(s, 0, f)).toBe(REJECT_PHASE);
    expect(s.helis.liveCount).toBe(0);
  });

  it('REJECT_HELI_NO_FACTORY: a free slot, a City, and an id beyond the used slots; an id outside the table is refused by the intent shape', () => {
    const s = world();
    const city = s.structures.add(STRUCT_CITY, 1, at(20, 20), 0);
    idle(s, 160);
    expect(order(s, 0, city)).toBe(REJECT_HELI_NO_FACTORY);
    expect(order(s, 0, 7)).toBe(REJECT_HELI_NO_FACTORY);
    expect(order(s, 0, 4095)).toBe(REJECT_HELI_NO_FACTORY);
    expect(validateIntent(withId(produceHeliBody(0, 4096), 1), { seats: 2, cells: W * H, debugIntents: true })).toBe(REJECT_STRUCT_ID);
    expect(validateIntent(withId(produceHeliBody(0, -1), 1), { seats: 2, cells: W * H, debugIntents: true })).toBe(REJECT_STRUCT_ID);
    expect(validateIntent(withId(produceHeliBody(0, 1.5), 1), { seats: 2, cells: W * H, debugIntents: true })).toBe(REJECT_STRUCT_ID);
    expect(s.helis.liveCount).toBe(0);
  });

  it('REJECT_HELI_NOT_OWNER: another seat\'s Factory', () => {
    const s = world();
    const theirs = addFactory(s, 2, 100, 10);
    expect(order(s, 0, theirs)).toBe(REJECT_HELI_NOT_OWNER);
    expect(s.helis.liveCount).toBe(0);
    expect(order(s, 1, theirs)).toBe(REJECT_NONE); // and its owner can
  });

  it('REJECT_HELI_FACTORY_BUILDING until the Factory is finished, then accepted at the exact tick', () => {
    const s = world();
    const f = s.structures.add(STRUCT_FACTORY, 1, at(10, 10), 0);
    const ready = s.structures.readyTick[f] as number;
    expect(ready).toBe(BUILD_TICKS[STRUCT_FACTORY]);
    idle(s, ready - 1);
    expect(s.tick).toBe(ready - 1);
    expect(order(s, 0, f)).toBe(REJECT_HELI_FACTORY_BUILDING); // this step ran at tick ready - 1
    expect(s.tick).toBe(ready);
    expect(order(s, 0, f)).toBe(REJECT_NONE); // this one at tick ready
    expect(s.helis.liveCount).toBe(1);
  });

  it('REJECT_HELI_QUEUE_BUSY: one at a time per Factory, another Factory is free, and the queue frees when the helicopter is on its pad', () => {
    const s = world();
    const a = addFactory(s, 1, 10, 10);
    const b = addFactory(s, 1, 20, 20);
    expect(order(s, 0, a)).toBe(REJECT_NONE);
    expect(order(s, 0, a)).toBe(REJECT_HELI_QUEUE_BUSY);
    expect(order(s, 0, b)).toBe(REJECT_NONE);
    idle(s, HELI_BUILD_TICKS);
    expect(s.helis.state[0]).toBe(HELI_PAD);
    expect(order(s, 0, a)).toBe(REJECT_NONE);
  });

  it('REJECT_HELI_NO_GOLD: one milli-gold short is refused, exactly the price is accepted and empties the purse', () => {
    const s = world();
    const f = addFactory(s, 1, 10, 10);
    s.gold[1] = HELI_PRICE_MILLI - 1;
    expect(order(s, 0, f)).toBe(REJECT_HELI_NO_GOLD);
    expect(lastSpent).toBe(0);
    s.gold[1] = HELI_PRICE_MILLI;
    expect(order(s, 0, f)).toBe(REJECT_NONE);
    expect(lastSpent).toBe(HELI_PRICE_MILLI);
  });

  it('REJECT_HELI_FLEET_CAP: 2 + the Factory levels, and a helicopter under production counts', () => {
    const s = world();
    const a = addFactory(s, 1, 10, 10);
    const b = addFactory(s, 1, 20, 20);
    expect(fleetCapOf(s, 0)).toBe(HELI_FLEET_BASE + 2); // two level-1 Factories
    for (let i = 0; i < 3; i++) {
      expect(order(s, 0, a)).toBe(REJECT_NONE);
      idle(s, HELI_BUILD_TICKS);
    }
    expect(fleetCountOf(s, 0)).toBe(3);
    expect(order(s, 0, b)).toBe(REJECT_NONE); // the fourth is under production now: it counts
    expect(fleetCountOf(s, 0)).toBe(4);
    expect(s.helis.state[s.helis.buildingAt(b)]).toBe(HELI_BUILDING);
    expect(order(s, 0, a)).toBe(REJECT_HELI_FLEET_CAP); // a is free and the purse is full: only the cap refuses
    expect(s.helis.liveCount).toBe(4);
    // Another seat has its own cap and count.
    const other = addFactory(s, 2, 100, 10);
    expect(fleetCountOf(s, 1)).toBe(0);
    expect(order(s, 1, other)).toBe(REJECT_NONE);
  });

  it('the cap is clamped to HELI_FLEET_MAX when Factory levels reach 999 (Sim-Levels2), and an unfinished Factory adds nothing', () => {
    const s = world();
    const a = addFactory(s, 1, 10, 10);
    s.structures.level[a] = 999;
    expect(fleetCapOf(s, 0)).toBe(HELI_FLEET_MAX);
    const young = s.structures.add(STRUCT_FACTORY, 1, at(30, 30), s.tick); // not finished
    s.structures.level[young] = 5;
    s.structures.level[a] = 3;
    expect(fleetCapOf(s, 0)).toBe(HELI_FLEET_BASE + 3);
    s.structures.level[a] = 999;
    for (let i = 0; i < HELI_FLEET_MAX; i++) s.helis.addBuilding(1, a, s.tick, s.tick + 1000);
    expect(s.helis.liveCount).toBe(HELI_FLEET_MAX);
    expect(order(s, 0, a)).toBe(REJECT_HELI_QUEUE_BUSY); // a builds one already; free the queue to see the cap
    for (let id = 0; id < s.helis.highWater; id++) s.helis.state[id] = HELI_PAD;
    expect(order(s, 0, a)).toBe(REJECT_HELI_FLEET_CAP);
  });
});

describe('ProduceHeli: price and time are tick-exact, and the helicopter appears on its pad', () => {
  it('200 gold at once, 120 ticks (12 s), PAD at the Factory with a full tank and 100.0 HP', () => {
    expect(HELI_PRICE_GOLD).toBe(200);
    expect(HELI_BUILD_TICKS / TICK_HZ).toBe(12);
    expect(HELI_FUEL_MAX_Q8).toBe(HELI_FUEL_CELLS * HELI_POS_ONE);
    const s = world();
    const f = addFactory(s, 1, 10, 12);
    const T = s.tick;
    expect(order(s, 0, f)).toBe(REJECT_NONE);
    expect(lastSpent).toBe(200 * MILLI_GOLD_PER_GOLD);
    expect(s.helis.state[0]).toBe(HELI_BUILDING);
    expect(s.helis.readyTick[0]).toBe(T + HELI_BUILD_TICKS);
    idle(s, HELI_BUILD_TICKS - 1);
    expect(s.tick).toBe(T + HELI_BUILD_TICKS);
    expect(s.helis.state[0]).toBe(HELI_BUILDING); // still queued when the clock reads T + 120
    s.outbox.clear();
    idle(s, 1); // the step that runs AT tick T + 120 finishes it
    expect(s.helis.state[0]).toBe(HELI_PAD);
    const events = s.outbox.drain();
    expect(events.find((e) => e.kind === OUTBOX_HELI_PRODUCED)).toEqual({ kind: OUTBOX_HELI_PRODUCED, tick: T + HELI_BUILD_TICKS, a: 0, b: f });
    expect(s.helis.x[0]).toBe(10 * HELI_POS_ONE + HELI_POS_ONE / 2);
    expect(s.helis.y[0]).toBe(12 * HELI_POS_ONE + HELI_POS_ONE / 2);
    expect(s.helis.hp[0]).toBe(HELI_HP_TENTHS);
    expect(s.helis.fuel[0]).toBe(HELI_FUEL_MAX_Q8);
    expect(s.helis.load[0]).toBe(0);
  });

  it('HeliQueued is pushed when the order is accepted (id and Factory), nothing when it is refused', () => {
    const s = world();
    const f = addFactory(s, 1, 10, 10);
    s.outbox.clear();
    step(s, { turn: s.tick, intents: [withId(produceHeliBody(0, f), nextId++)] });
    expect(s.outbox.drain().filter((e) => e.kind === OUTBOX_HELI_QUEUED)).toEqual([{ kind: OUTBOX_HELI_QUEUED, tick: s.tick - 1, a: 0, b: f }]);
    step(s, { turn: s.tick, intents: [withId(produceHeliBody(0, f), nextId++)] });
    expect(s.outbox.drain().filter((e) => e.kind === OUTBOX_HELI_QUEUED)).toEqual([]);
  });

  it('the shared check: validateProduceHeli on a StateView says what the sim does, for every reason', () => {
    const s = world({ debugIntents: true, spawnPhase: true });
    const f = s.structures.add(STRUCT_FACTORY, 1, at(10, 10), 0);
    const view = new StateView(s);
    expect(validateProduceHeli(view, 0, f)).toBe(REJECT_PHASE);
    s.tick = 300; // past the start phase
    view.refresh();
    expect(validateProduceHeli(view, 0, f)).toBe(REJECT_NONE);
    expect(validateProduceHeli(view, 1, f)).toBe(REJECT_HELI_NOT_OWNER);
    expect(validateProduceHeli(view, 0, 99)).toBe(REJECT_HELI_NO_FACTORY);
    s.gold[1] = 0;
    view.refresh();
    expect(validateProduceHeli(view, 0, f)).toBe(REJECT_HELI_NO_GOLD);
    expect(checkProduceHeli(s, GOLD, false, 0, f)).toBe(REJECT_NONE); // the same function the sim calls
    expect(checkProduceHeli(s, GOLD, true, 0, f)).toBe(REJECT_PHASE);
  });
});

describe('the helicopter table: free list, reused id', () => {
  it('a removed id is reused first (LIFO), then the next never-used slot; the whole free list is hashed', () => {
    const t = new HeliTable(3);
    expect([t.addBuilding(1, 0, 0, 120), t.addBuilding(1, 0, 0, 120), t.addBuilding(2, 0, 0, 120)]).toEqual([0, 1, 2]);
    t.remove(1);
    t.remove(0);
    expect(t.liveCount).toBe(1);
    expect(t.countOf(1)).toBe(0);
    expect(t.countOf(2)).toBe(1);
    expect(t.addBuilding(1, 0, 0, 120)).toBe(0); // the top of the stack is the last removed id
    expect(t.addBuilding(1, 0, 0, 120)).toBe(1);
    expect(t.addBuilding(1, 0, 0, 120)).toBe(3); // the stack is empty: the next unused slot
    expect(t.highWater).toBe(4);
  });

  it('through the sim: a scrapped helicopter\'s id goes to the next order, the route buffer of the old one is cleared, and the table is full only at HELI_CAPACITY', () => {
    const s = world();
    const a = addFactory(s, 1, 10, 10);
    const b = addFactory(s, 1, 20, 20);
    expect(order(s, 0, a)).toBe(REJECT_NONE);
    expect(order(s, 0, b)).toBe(REJECT_NONE); // ids 0 and 1
    s.helis.route[1 * 64] = 77;
    s.helis.routeLen[1] = 1;
    applyIntent(s, withId({ kind: 'Delete', seat: 0, structure: b }, nextId++)); // scraps id 1
    expect(s.helis.owner[1]).toBe(0);
    expect(s.helis.route[1 * 64]).toBe(0);
    expect(s.helis.routeLen[1]).toBe(0);
    s.structures.deleteReady[1] = 0;
    const c = addFactory(s, 1, 30, 30);
    expect(order(s, 0, c)).toBe(REJECT_NONE);
    expect(s.helis.factory[1]).toBe(c); // the reused id 1 is the new helicopter
    expect(s.helis.highWater).toBe(2);
    const full = new HeliTable(2);
    for (let i = 0; i < full.capacity; i++) expect(full.addBuilding(1, 0, 0, 1)).toBe(i);
    expect(full.addBuilding(1, 0, 0, 1)).toBe(-1);
  });
});

describe('the codec and the intent', () => {
  it('ProduceHeli is wire kind 12, round-trips through encodeIntent / encodeTurn, and orders by factory', () => {
    expect(kindCode('ProduceHeli')).toBe(12);
    const i = withId(produceHeliBody(3, 777), 4242);
    const back = decodeIntent(encodeIntent(i));
    expect(back.ok && back.value).toEqual(i);
    const turn = { turn: 9, intents: [i, withId(produceHeliBody(3, 5), 4243)] as Intent[] };
    const t = decodeTurn(encodeTurn(turn));
    expect(t.ok && t.value).toEqual(turn);
    expect(compareIntents(withId(produceHeliBody(0, 2), 1), withId(produceHeliBody(0, 9), 1))).toBeLessThan(0);
    expect(copyBody({ kind: 'ProduceHeli', seat: 1, factory: 8, junk: 1 })).toEqual({ kind: 'ProduceHeli', seat: 1, factory: 8 });
    expect(copyBody({ kind: 'ProduceHeli', seat: 1 })).toEqual({ kind: 'ProduceHeli', seat: 1, factory: -1 });
    expect(decodeIntent(new Uint8Array([12, 0, 0])).ok).toBe(false); // the factory varint is missing
  });
});

describe('serialisation and the hash with helicopters in the table', () => {
  /** A state whose air block is full of everything the later parts will use. */
  function furnished(): GameState {
    const s = world();
    const a = addFactory(s, 1, 10, 10);
    const b = addFactory(s, 2, 100, 10);
    expect(order(s, 0, a)).toBe(REJECT_NONE);
    expect(order(s, 1, b)).toBe(REJECT_NONE);
    idle(s, HELI_BUILD_TICKS + 1);
    expect(order(s, 0, a)).toBe(REJECT_NONE);
    // A helicopter in flight, the way part 2 will leave it, and two beachheads (part 3).
    const h = s.helis.addBuilding(1, a, s.tick, s.tick + 5);
    s.helis.state[h] = HELI_CRUISE;
    s.helis.x[h] = 300;
    s.helis.y[h] = 900;
    s.helis.alt[h] = 1234;
    s.helis.hp[h] = 800;
    s.helis.load[h] = 450;
    s.helis.fuel[h] = 12345;
    s.helis.mode[h] = 1;
    s.helis.target[h] = at(50, 20) + 1;
    s.helis.routeLen[h] = 3;
    s.helis.routeIdx[h] = 1;
    s.helis.route[h * 64] = at(11, 10);
    s.helis.route[h * 64 + 1] = at(30, 20);
    s.helis.route[h * 64 + 2] = at(50, 20);
    expect(s.beachheads.add(1, at(50, 20), s.tick, 1)).toBe(0);
    expect(s.beachheads.add(2, at(90, 40), s.tick - 3, 2)).toBe(1);
    s.helis.remove(1); // a hole: the recycle stack is not empty
    return s;
  }

  it('round trip: same hash, same bytes, same tables; the Los / Nav environment is not in the bytes', () => {
    const s = furnished();
    const bytes = serialize(s);
    const maxElev = new Int16Array(W * H); // Fix-4A2: a helicopter in the air needs the occluder layer on load ('no-occluders' otherwise)
    const r = deserialize(bytes, { maxElev });
    if (!r.ok) throw new Error(r.error);
    expect(hashState(r.state)).toBe(hashState(s));
    expect(Array.from(serialize(r.state))).toEqual(Array.from(bytes));
    const [t, u] = [r.state.helis, s.helis];
    expect(t.highWater).toBe(u.highWater);
    expect(t.recycledCount).toBe(u.recycledCount);
    expect(t.liveCount).toBe(u.liveCount);
    for (const name of ['owner', 'state', 'factory', 'readyTick', 'stateTick', 'x', 'y', 'alt', 'hp', 'load', 'fuel', 'mode', 'target', 'routeLen', 'routeIdx'] as const) {
      expect(Array.from(t[name]), name).toEqual(Array.from(u[name]));
    }
    expect(Array.from(t.route.subarray(0, 64 * 4))).toEqual(Array.from(u.route.subarray(0, 64 * 4)));
    expect(r.state.beachheads.liveCount).toBe(2);
    expect(r.state.beachheads.status[1]).toBe(2);
    expect(r.state.helis.countOf(1)).toBe(s.helis.countOf(1)); // the derived counts are rebuilt
    expect(Array.from(r.state.env.maxElev ?? [])).toEqual(Array.from(maxElev)); // the layer is the one handed in, never read from the bytes (same bytes as the state without it, above)
  });

  it('every field of both tables is in the hash', () => {
    const base = hashState(furnished());
    const mutate = (edit: (s: GameState) => void): number => {
      const s = furnished();
      edit(s);
      return hashState(s);
    };
    const edits: Array<[string, (s: GameState) => void]> = [
      ['owner', (s) => (s.helis.owner[0] = 2)],
      ['state', (s) => (s.helis.state[0] = HELI_BUILDING)],
      ['factory', (s) => (s.helis.factory[0] = 5)],
      ['readyTick', (s) => (s.helis.readyTick[0] = 1)],
      ['stateTick', (s) => (s.helis.stateTick[0] = 1)],
      ['x', (s) => (s.helis.x[0] = 1)],
      ['y', (s) => (s.helis.y[0] = 1)],
      ['alt', (s) => (s.helis.alt[0] = 1)],
      ['hp', (s) => (s.helis.hp[0] = 1)],
      ['load', (s) => (s.helis.load[0] = 1)],
      ['fuel', (s) => (s.helis.fuel[0] = 1)],
      ['mode', (s) => (s.helis.mode[0] = 1)],
      ['target', (s) => (s.helis.target[0] = 1)],
      ['routeLen', (s) => (s.helis.routeLen[0] = 1)],
      ['routeIdx', (s) => (s.helis.routeIdx[0] = 1)],
      ['route cell', (s) => (s.helis.route[3 * 64 + 1] = 1)],
      ['recycled stack', (s) => (s.helis.recycled[0] = 4)],
      ['beach owner', (s) => (s.beachheads.owner[0] = 2)],
      ['beach seed', (s) => (s.beachheads.seed[0] = 1)],
      ['beach landTick', (s) => (s.beachheads.landTick[0] = 1)],
      ['beach status', (s) => (s.beachheads.status[0] = 2)],
    ];
    for (const [name, edit] of edits) expect(mutate(edit), name).not.toBe(base);
  });

  it('a snapshot equals the straight run: a scenario with helicopters in the table, saved and restored mid-run, ends on the same hash', () => {
    const straight = createScenarioState({ seed: 2 });
    runScenario(straight, 3500);
    const first = createScenarioState({ seed: 2 });
    runScenario(first, 3000);
    expect(first.helis.liveCount).toBeGreaterThan(0); // the scenario really has helicopters at the save point
    const r = deserialize(serialize(first));
    if (!r.ok) throw new Error(r.error);
    runScenario(r.state, 3500);
    expect(hashState(r.state)).toBe(hashState(straight));
    expect(Array.from(serialize(r.state))).toEqual(Array.from(serialize(straight)));
  });

  it('the golden scenario exercises production, the pad and the scrapping of helicopters (the goldens would notice a change)', () => {
    const s = createScenarioState({ seed: 1 });
    let queued = 0;
    let produced = 0;
    let scrapped = 0;
    for (const t of [1000, 3000, 6000]) {
      runScenario(s, t);
      for (const e of s.outbox.drain()) {
        if (e.kind === OUTBOX_HELI_QUEUED) queued++;
        if (e.kind === OUTBOX_HELI_PRODUCED) produced++;
        if (e.kind === OUTBOX_HELI_SCRAPPED) scrapped++;
      }
    }
    expect(queued).toBeGreaterThan(0);
    expect(produced).toBeGreaterThan(0);
    expect(scrapped).toBeGreaterThan(0);
    expect(s.helis.recycledCount).toBeGreaterThan(0);
  });

  it('deserialize refuses a value no rule could have produced (air-range), with a valid checksum', () => {
    const forged = (edit: (s: GameState) => void): string => {
      const s = furnished();
      edit(s);
      const r = deserialize(serialize(s), { maxElev: new Int16Array(W * H) }); // serialize signs whatever is in the state; Fix-4A2: the airborne helicopter needs the occluder layer
      return r.ok ? 'ok' : r.error;
    };
    expect(forged(() => undefined)).toBe('ok');
    expect(forged((s) => (s.helis.owner[0] = 9))).toBe('air-range');
    expect(forged((s) => (s.helis.state[0] = 10))).toBe('air-range');
    expect(forged((s) => (s.helis.hp[0] = HELI_HP_TENTHS + 1))).toBe('air-range');
    expect(forged((s) => (s.helis.load[3] = 601))).toBe('air-range');
    expect(forged((s) => (s.helis.fuel[0] = HELI_FUEL_MAX_Q8 + 1))).toBe('air-range');
    expect(forged((s) => (s.helis.mode[0] = 2))).toBe('air-range');
    expect(forged((s) => (s.helis.x[0] = -1))).toBe('air-range');
    expect(forged((s) => (s.helis.y[0] = H * HELI_POS_ONE))).toBe('air-range');
    expect(forged((s) => (s.helis.routeIdx[3] = 4))).toBe('air-range');
    expect(forged((s) => (s.helis.route[3 * 64] = W * H))).toBe('air-range');
    expect(forged((s) => (s.helis.target[3] = W * H + 2))).toBe('air-range');
    expect(forged((s) => (s.helis.factory[0] = 3000))).toBe('air-range'); // a parked helicopter needs a live Factory of its owner
    expect(forged((s) => (s.helis.readyTick[2] = (s.helis.readyTick[2] as number) + 1))).toBe('air-range'); // a queued one needs the production time the rules set
    expect(forged((s) => (s.beachheads.status[0] = 3))).toBe('air-range');
    expect(forged((s) => (s.beachheads.owner[0] = 7))).toBe('air-range');
    expect(forged((s) => (s.beachheads.seed[0] = W * H))).toBe('air-range');
    expect(BEACHHEAD_CAPACITY).toBe(64);
    const s = furnished();
    const bytes = serialize(s);
    expect(deserialize(bytes.subarray(0, bytes.length - 9)).ok).toBe(false); // truncated: never throws
  });
});

describe('a Factory that changes hands or is destroyed scraps its queued and parked helicopters (provisional rule)', () => {
  function two(): { s: GameState; a: number; b: number; hA: number; hB: number } {
    const s = world();
    const a = addFactory(s, 1, 10, 10);
    const b = addFactory(s, 1, 20, 20);
    expect(order(s, 0, a)).toBe(REJECT_NONE);
    expect(order(s, 0, b)).toBe(REJECT_NONE);
    idle(s, HELI_BUILD_TICKS + 1); // both on their pads
    expect(order(s, 0, a)).toBe(REJECT_NONE); // a has one parked and one under production
    return { s, a, b, hA: 0, hB: 1 };
  }

  it('conquest: the parked and the queued helicopter are scrapped without a refund, the other Factory keeps its helicopter, an airborne one survives', () => {
    const { s, a, hB } = two();
    const air = s.helis.addBuilding(1, a, s.tick, s.tick + 1);
    s.helis.state[air] = HELI_CRUISE; // part 2 will have launched it from `a`
    const goldBefore = s.gold[1] as number;
    s.outbox.clear();
    step(s, { turn: s.tick, intents: [withId({ kind: 'DebugPaint', seat: 1, cell: at(10, 10) }, nextId++)] }); // seat 1 takes the Factory's cell
    expect(s.structures.owner[a]).toBe(2); // the Factory itself changed hands (one level lower, at least 1)
    const scrapped = s.outbox.drain().filter((e) => e.kind === OUTBOX_HELI_SCRAPPED);
    expect(scrapped.map((e) => e.a).sort()).toEqual([0, 2]);
    expect(scrapped.map((e) => e.b).sort()).toEqual([HELI_BUILDING, HELI_PAD].sort());
    expect(s.helis.owner[0]).toBe(0);
    expect(s.helis.owner[2]).toBe(0);
    expect(s.helis.owner[hB]).toBe(1); // the other Factory's helicopter is untouched
    expect(s.helis.owner[air]).toBe(1); // and the airborne one too
    expect(s.helis.countOf(1)).toBe(2);
    expect(s.gold[1]).toBeGreaterThanOrEqual(goldBefore); // no refund (income only)
    expect(s.gold[1]).toBeLessThan(goldBefore + 200 * MILLI_GOLD_PER_GOLD);
    // The new owner finds an empty queue and its own fleet count.
    expect(fleetCountOf(s, 1)).toBe(0);
    expect(order(s, 1, a)).toBe(REJECT_NONE);
  });

  it('destroyed (the cell goes to nobody) and Delete scrap them as well', () => {
    const { s, a, b } = two();
    s.outbox.clear();
    setOwner(s, at(10, 10), 0, nextId++);
    expect(s.structures.owner[a]).toBe(0); // freed land destroys the Factory
    expect(s.helis.countOf(1)).toBe(1);
    expect(s.outbox.drain().filter((e) => e.kind === OUTBOX_HELI_SCRAPPED).length).toBe(2);
    expect(applyIntent(s, withId({ kind: 'Delete', seat: 0, structure: b }, nextId++))).toBe(REJECT_NONE);
    expect(s.helis.countOf(1)).toBe(0);
    expect(s.helis.liveCount).toBe(0);
    expect(s.outbox.drain().filter((e) => e.kind === OUTBOX_HELI_SCRAPPED).length).toBe(1);
  });
});
