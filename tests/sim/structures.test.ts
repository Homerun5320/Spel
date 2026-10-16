// M09 part A: the structure table, its intents, the placement rules (one test per rule, each with its reason code) and the prices.
// Every test drives the real sim path (applyIntent / step), so a rule removed from checkBuild fails here.
import { describe, expect, it } from 'vitest';
import { decodeIntent, encodeIntent } from '../../src/sim/codec';
import {
  copyBody,
  kindCode,
  REJECT_BUILD_FALLOUT,
  REJECT_BUILD_FOREST,
  REJECT_BUILD_GOLD,
  REJECT_BUILD_HILLS,
  REJECT_BUILD_MOUNTAIN,
  REJECT_BUILD_NO_COAST,
  REJECT_BUILD_NO_FACTORY,
  REJECT_BUILD_NOT_OWNED,
  REJECT_BUILD_OCCUPIED,
  REJECT_BUILD_PEAK,
  REJECT_BUILD_SPACING,
  REJECT_BUILD_TYPE,
  REJECT_DELETE_COOLDOWN,
  REJECT_NONE,
  REJECT_STRUCT_BUSY,
  REJECT_STRUCT_ID,
  REJECT_STRUCT_MAX_LEVEL,
  REJECT_STRUCT_NOT_OWNER,
  validateIntent,
  withId,
  type Intent,
  type IntentBody,
} from '../../src/sim/intents';
import { OUTBOX_REJECT } from '../../src/sim/outbox';
import { BUILD_TICKS, DELETE_COOLDOWN_TICKS, MILLI_GOLD_PER_GOLD, SPACING_CELLS_BY_TYPE, STRUCT_CAPACITY, STRUCT_LEVEL_HARD_CAP } from '../../src/sim/rules';
import { createScenarioState, runScenario } from '../../src/sim/scenario';
import { deserialize, hashState, serialize } from '../../src/sim/serialize';
import { applyIntent, step } from '../../src/sim/step';
import { rebuildAggregates, createState, type GameState } from '../../src/sim/state';
import {
  STRUCT_CITY,
  STRUCT_FACTORY,
  STRUCT_PORT,
  STRUCT_POST,
  STRUCT_SAM,
  STRUCT_SILO,
  buildPriceGold,
  checkBuild,
  upgradePriceGold,
  validateBuild,
} from '../../src/sim/structureRules';
import { StructureTable } from '../../src/sim/structures';
import { CLASS_DEEP_SEA, CLASS_FOREST, CLASS_HILLS, CLASS_MOUNTAIN, CLASS_PEAK, CLASS_PLAINS } from '../../src/sim/terrain';
import { StateView, type SimView } from '../../src/sim/view';

const W = 128;
const H = 64;
const at = (x: number, y: number): number => y * W + x;
const GOLD = 1000000;

/** A plains world owned entirely by seat 0, with a few special cells; seat 0 is rich. */
function world(): GameState {
  const terrain = new Uint8Array(W * H).fill(CLASS_PLAINS);
  terrain[at(50, 10)] = CLASS_MOUNTAIN;
  terrain[at(52, 10)] = CLASS_PEAK;
  terrain[at(54, 10)] = CLASS_HILLS;
  terrain[at(56, 10)] = CLASS_FOREST;
  terrain[at(100, 20)] = CLASS_DEEP_SEA; // (99, 20) is a coast cell, (80, 20) is not
  const s = createState({ width: W, height: H, seed: 3, seats: 2, config: { debugIntents: true }, terrain, elevation: new Uint16Array(W * H) });
  for (let c = 0; c < W * H; c++) if (terrain[c] !== CLASS_DEEP_SEA) s.owner[c] = 1;
  rebuildAggregates(s);
  s.gold[1] = GOLD * MILLI_GOLD_PER_GOLD;
  s.gold[2] = GOLD * MILLI_GOLD_PER_GOLD;
  return s;
}

let nextId = 0;
const build = (s: GameState, type: number, cell: number, seat = 0): number => applyIntent(s, withId({ kind: 'Build', seat, type, cell }, nextId++));
function idle(s: GameState, ticks: number): void {
  for (let i = 0; i < ticks; i++) expect(step(s, { turn: s.tick, intents: [] }).ok).toBe(true);
}
/** Builds a structure and returns its id (fails the test when refused). */
function mustBuild(s: GameState, type: number, cell: number, seat = 0): number {
  expect(build(s, type, cell, seat)).toBe(REJECT_NONE);
  return s.structures.idAt(cell);
}

describe('prices', () => {
  it('escalate by half a base price per structure owned, from x1 to the cap x6 (integers)', () => {
    expect([0, 1, 2, 3, 9, 10, 11, 40].map((n) => buildPriceGold(STRUCT_CITY, n))).toEqual([400, 600, 800, 1000, 2200, 2400, 2400, 2400]);
    expect(buildPriceGold(STRUCT_POST, 1)).toBe(375);
    expect(buildPriceGold(STRUCT_SILO, 0)).toBe(1000);
  });

  it('are taken from the purse by Build, and the next one of the type costs more (unfinished ones count too)', () => {
    const s = world();
    s.gold[1] = 1000 * MILLI_GOLD_PER_GOLD;
    mustBuild(s, STRUCT_CITY, at(10, 30));
    expect(s.gold[1]).toBe(600 * MILLI_GOLD_PER_GOLD);
    mustBuild(s, STRUCT_CITY, at(40, 30));
    expect(s.gold[1]).toBe(0); // 400 + 600
    expect(build(s, STRUCT_CITY, at(70, 30))).toBe(REJECT_BUILD_GOLD);
    expect(s.structures.ownedCount(1, STRUCT_CITY)).toBe(2);
  });

  it('an upgrade to level L costs base * L for EVERY type (the City too), with no escalation, starts at once and raises the level when the build time has run out', () => {
    expect(upgradePriceGold(STRUCT_CITY, 2)).toBe(800);
    expect(upgradePriceGold(STRUCT_CITY, 3)).toBe(1200);
    expect(upgradePriceGold(STRUCT_FACTORY, 2)).toBe(1000);
    const s = world();
    const id = mustBuild(s, STRUCT_CITY, at(10, 30));
    const up = (): number => applyIntent(s, withId({ kind: 'Upgrade', seat: 0, structure: id }, nextId++));
    expect(up()).toBe(REJECT_STRUCT_BUSY); // still being built
    idle(s, BUILD_TICKS[STRUCT_CITY] as number);
    const before = s.gold[1] as number;
    expect(up()).toBe(REJECT_NONE);
    expect(before - (s.gold[1] as number)).toBe(800 * MILLI_GOLD_PER_GOLD);
    expect(up()).toBe(REJECT_STRUCT_BUSY); // upgrading
    expect(s.structures.level[id]).toBe(1);
    idle(s, (BUILD_TICKS[STRUCT_CITY] as number) + 1);
    expect(s.structures.level[id]).toBe(2);
    const before3 = s.gold[1] as number;
    expect(up()).toBe(REJECT_NONE);
    expect(before3 - (s.gold[1] as number)).toBe(1200 * MILLI_GOLD_PER_GOLD); // not escalated by the two Cities-to-be
    idle(s, (BUILD_TICKS[STRUCT_CITY] as number) + 1);
    expect(s.structures.level[id]).toBe(3);
    s.structures.level[id] = STRUCT_LEVEL_HARD_CAP; // the top level of every type (Sim-Levels2)
    expect(up()).toBe(REJECT_STRUCT_MAX_LEVEL);
  });

  it('Upgrade and Delete refuse an unknown id and another seat\'s structure', () => {
    const s = world();
    const id = mustBuild(s, STRUCT_CITY, at(10, 30));
    expect(applyIntent(s, withId({ kind: 'Upgrade', seat: 1, structure: id }, nextId++))).toBe(REJECT_STRUCT_NOT_OWNER);
    expect(applyIntent(s, withId({ kind: 'Delete', seat: 1, structure: id }, nextId++))).toBe(REJECT_STRUCT_NOT_OWNER);
    expect(applyIntent(s, withId({ kind: 'Delete', seat: 0, structure: id + 5 }, nextId++))).toBe(REJECT_STRUCT_ID);
  });

  it('Delete has a 30 s cooldown per seat (and the freed id is reused first)', () => {
    const s = world();
    const a = mustBuild(s, STRUCT_CITY, at(10, 30));
    const b = mustBuild(s, STRUCT_CITY, at(40, 30));
    const del = (id: number, seat = 0): number => applyIntent(s, withId({ kind: 'Delete', seat, structure: id }, nextId++));
    expect(del(a)).toBe(REJECT_NONE);
    expect(s.structures.idAt(at(10, 30))).toBe(-1);
    expect(del(b)).toBe(REJECT_DELETE_COOLDOWN);
    idle(s, DELETE_COOLDOWN_TICKS - 1);
    expect(del(b)).toBe(REJECT_DELETE_COOLDOWN);
    idle(s, 1);
    expect(del(b)).toBe(REJECT_NONE);
    // the free list is a stack: the id deleted last is handed out first
    expect(mustBuild(s, STRUCT_CITY, at(70, 30))).toBe(b);
    expect(mustBuild(s, STRUCT_CITY, at(100, 40))).toBe(a);
    expect(mustBuild(s, STRUCT_CITY, at(20, 50))).toBe(2);
  });
});

describe('placement rules', () => {
  it('a type outside 1..6 is refused', () => {
    const s = world();
    expect(build(s, 0, at(10, 30))).toBe(REJECT_BUILD_TYPE);
    expect(build(s, 7, at(10, 30))).toBe(REJECT_BUILD_TYPE);
  });

  it('only on the seat\'s own cells', () => {
    const s = world();
    expect(build(s, STRUCT_CITY, at(10, 30), 1)).toBe(REJECT_BUILD_NOT_OWNED);
    s.owner[at(10, 30)] = 0;
    expect(build(s, STRUCT_CITY, at(10, 30))).toBe(REJECT_BUILD_NOT_OWNED);
  });

  it('nothing on a Peak, whoever owns it', () => {
    const s = world();
    s.owner[at(52, 10)] = 1;
    for (const t of [STRUCT_CITY, STRUCT_SAM, STRUCT_POST, STRUCT_SILO]) expect(build(s, t, at(52, 10)), `type ${t}`).toBe(REJECT_BUILD_PEAK);
  });

  it('a Mountain allows only SAM, Post and Silo', () => {
    const s = world();
    const m = at(50, 10);
    expect(build(s, STRUCT_CITY, m)).toBe(REJECT_BUILD_MOUNTAIN);
    expect(build(s, STRUCT_FACTORY, m)).toBe(REJECT_BUILD_MOUNTAIN);
    expect(build(s, STRUCT_PORT, m)).toBe(REJECT_BUILD_MOUNTAIN);
    mustBuild(s, STRUCT_FACTORY, at(5, 5));
    idle(s, BUILD_TICKS[STRUCT_FACTORY] as number);
    s.terrain[at(50, 30)] = CLASS_MOUNTAIN;
    s.terrain[at(50, 50)] = CLASS_MOUNTAIN;
    expect(build(s, STRUCT_SILO, m)).toBe(REJECT_NONE);
    expect(build(s, STRUCT_SAM, at(50, 30))).toBe(REJECT_NONE);
    expect(build(s, STRUCT_POST, at(50, 50))).toBe(REJECT_NONE);
  });

  it('no Port on Hills and no Silo in Forest', () => {
    const s = world();
    s.terrain[at(99, 20)] = CLASS_HILLS; // a coast cell (the sea is at (100, 20))
    expect(build(s, STRUCT_PORT, at(99, 20))).toBe(REJECT_BUILD_HILLS);
    s.terrain[at(99, 20)] = CLASS_PLAINS;
    expect(build(s, STRUCT_PORT, at(99, 20))).toBe(REJECT_NONE);
    mustBuild(s, STRUCT_FACTORY, at(5, 5));
    idle(s, BUILD_TICKS[STRUCT_FACTORY] as number);
    expect(build(s, STRUCT_SILO, at(56, 10))).toBe(REJECT_BUILD_FOREST);
    expect(build(s, STRUCT_CITY, at(56, 10))).toBe(REJECT_NONE);
    expect(build(s, STRUCT_SILO, at(54, 10))).toBe(REJECT_NONE); // hills are fine for a Silo
  });

  it('a Port only on a coast cell, also across the x seam', () => {
    const s = world();
    expect(build(s, STRUCT_PORT, at(80, 20))).toBe(REJECT_BUILD_NO_COAST);
    expect(build(s, STRUCT_PORT, at(99, 20))).toBe(REJECT_NONE);
    // sea at x = 0 makes x = W - 1 a coast cell
    s.terrain[at(0, 40)] = CLASS_DEEP_SEA;
    expect(build(s, STRUCT_PORT, at(W - 1, 40))).toBe(REJECT_NONE);
  });

  it('one structure per cell', () => {
    const s = world();
    mustBuild(s, STRUCT_CITY, at(10, 30));
    expect(build(s, STRUCT_POST, at(10, 30))).toBe(REJECT_BUILD_OCCUPIED);
  });

  it('spacing: structures of the same type must be SPACING_CELLS_BY_TYPE apart (any owner, x wrapping); other types are free', () => {
    expect(SPACING_CELLS_BY_TYPE).toEqual([0, 3, 3, 3, 6, 5, 3]);
    const s = world();
    mustBuild(s, STRUCT_CITY, at(10, 30));
    expect(build(s, STRUCT_CITY, at(10 + 2, 30))).toBe(REJECT_BUILD_SPACING);
    expect(build(s, STRUCT_CITY, at(10 + 2, 30 + 2))).toBe(REJECT_BUILD_SPACING); // Euclidean: 2.83 < 3
    expect(build(s, STRUCT_CITY, at(10 + 3, 30))).toBe(REJECT_NONE); // exactly 3 is allowed
    expect(build(s, STRUCT_POST, at(11, 30))).toBe(REJECT_NONE);
    // another owner counts too; a SAM needs 5
    s.owner[at(60, 5)] = 2;
    mustBuild(s, STRUCT_SAM, at(60, 5), 1);
    expect(build(s, STRUCT_SAM, at(64, 5))).toBe(REJECT_BUILD_SPACING);
    expect(build(s, STRUCT_SAM, at(65, 5))).toBe(REJECT_NONE);
    // across the seam (the world is 128 wide)
    mustBuild(s, STRUCT_CITY, at(126, 50));
    expect(build(s, STRUCT_CITY, at(0, 50))).toBe(REJECT_BUILD_SPACING); // 2 apart over the seam
    expect(build(s, STRUCT_CITY, at(1, 50))).toBe(REJECT_NONE); // 3 apart over the seam
  });

  it('fallout blocks (the layer is zero until M14, so the rule is shown through a source with fallout)', () => {
    const s = world();
    const view = new StateView(s);
    const cell = at(10, 30);
    const fallout = { width: W, height: H, tick: s.tick, owner: s.owner, terrainClass: s.terrain, structures: s.structures, falloutUntilAt: (c: number) => (c === cell ? s.tick + 5 : 0) };
    expect(checkBuild(fallout, GOLD, 0, STRUCT_CITY, cell)).toBe(REJECT_BUILD_FALLOUT);
    expect(checkBuild({ ...fallout, falloutUntilAt: (c: number) => (c === cell ? s.tick : 0) }, GOLD, 0, STRUCT_CITY, cell)).toBe(REJECT_NONE); // burnt out
    expect((view as SimView).falloutUntilAt(cell)).toBe(0);
  });

  it('a Silo needs a FINISHED Factory of the same seat', () => {
    const s = world();
    const silo = at(30, 40);
    expect(build(s, STRUCT_SILO, silo)).toBe(REJECT_BUILD_NO_FACTORY);
    s.owner[at(5, 5)] = 2;
    mustBuild(s, STRUCT_FACTORY, at(5, 5), 1);
    idle(s, BUILD_TICKS[STRUCT_FACTORY] as number);
    expect(build(s, STRUCT_SILO, silo)).toBe(REJECT_BUILD_NO_FACTORY); // somebody else's
    mustBuild(s, STRUCT_FACTORY, at(5, 40));
    expect(build(s, STRUCT_SILO, silo)).toBe(REJECT_BUILD_NO_FACTORY); // not finished
    idle(s, (BUILD_TICKS[STRUCT_FACTORY] as number) - 1);
    expect(build(s, STRUCT_SILO, silo)).toBe(REJECT_BUILD_NO_FACTORY);
    idle(s, 1);
    expect(build(s, STRUCT_SILO, silo)).toBe(REJECT_NONE);
  });

  it('the public validateBuild (on a SimView) answers exactly what the sim answers', () => {
    const s = world();
    s.gold[1] = 450 * MILLI_GOLD_PER_GOLD;
    mustBuild(s, STRUCT_CITY, at(10, 30));
    const view = new StateView(s);
    for (const [t, c] of [
      [STRUCT_CITY, at(10 + 2, 30)],
      [STRUCT_PORT, at(80, 20)],
      [STRUCT_CITY, at(60, 30)],
      [STRUCT_POST, at(60, 30)],
      [STRUCT_SILO, at(70, 30)],
      [9, at(1, 1)],
    ] as Array<[number, number]>) {
      const expected = validateBuild(view, 0, t, c);
      expect(build(s, t, c), `type ${t} cell ${c}`).toBe(expected);
      if (expected === REJECT_NONE) break; // the state has changed
    }
    expect(validateBuild(view, 0, STRUCT_CITY, at(10 + 2, 30))).toBe(REJECT_BUILD_SPACING);
    expect(validateBuild(view, 0, STRUCT_CITY, at(60, 30))).toBe(REJECT_BUILD_GOLD); // 450 gold left, a second City costs 600
  });
});

describe('the intents', () => {
  const bodies: IntentBody[] = [
    { kind: 'Build', seat: 1, type: 4, cell: 8191 },
    { kind: 'Upgrade', seat: 0, structure: 4095 },
    { kind: 'Delete', seat: 2, structure: 0 },
  ];

  it('are wire kinds 6, 7, 8 and round trip through the codec and copyBody', () => {
    expect([kindCode('Build'), kindCode('Upgrade'), kindCode('Delete')]).toEqual([6, 7, 8]);
    bodies.forEach((b, n) => {
      const i = withId(b, 100 + n);
      expect(decodeIntent(encodeIntent(i))).toEqual({ ok: true, value: i });
      expect(copyBody({ ...b, extra: 1 })).toEqual(b);
    });
  });

  it('are validated for shape', () => {
    const ctx = { seats: 3, cells: W * H, debugIntents: false };
    const ok = bodies.map((b, n) => withId(b, n));
    for (const i of ok) expect(validateIntent(i, ctx)).toBe(REJECT_NONE);
    expect(validateIntent({ ...ok[0], type: 0 }, ctx)).toBe(REJECT_BUILD_TYPE);
    expect(validateIntent({ ...ok[0], type: 7 }, ctx)).toBe(REJECT_BUILD_TYPE);
    expect(validateIntent({ ...ok[0], type: 1.5 }, ctx)).toBe(REJECT_BUILD_TYPE);
    expect(validateIntent({ ...ok[0], cell: W * H }, ctx)).not.toBe(REJECT_NONE);
    expect(validateIntent({ ...ok[1], structure: STRUCT_CAPACITY }, ctx)).toBe(REJECT_STRUCT_ID);
    expect(validateIntent({ ...ok[2], structure: -1 }, ctx)).toBe(REJECT_STRUCT_ID);
  });

  it('run through step(): a refusal lands in the outbox with its reason and counts in rejects', () => {
    const s = world();
    const intents: Intent[] = [withId({ kind: 'Build', seat: 0, type: STRUCT_PORT, cell: at(80, 20) }, 0), withId({ kind: 'Build', seat: 0, type: STRUCT_CITY, cell: at(80, 20) }, 1)];
    const r = step(s, { turn: s.tick, intents });
    expect(r).toEqual({ ok: true, applied: 1, rejected: 1 });
    expect(s.structures.liveCount).toBe(1);
    expect(s.outbox.drain().some((e) => e.kind === OUTBOX_REJECT && e.a === REJECT_BUILD_NO_COAST)).toBe(true);
  });
});

describe('the table', () => {
  function busy(): GameState {
    const s = world();
    for (let i = 0; i < 6; i++) mustBuild(s, STRUCT_CITY, at(i * 20, 5));
    for (let i = 0; i < 3; i++) mustBuild(s, STRUCT_POST, at(i * 20, 25));
    idle(s, 200);
    applyIntent(s, withId({ kind: 'Upgrade', seat: 0, structure: 1 }, nextId++));
    applyIntent(s, withId({ kind: 'Delete', seat: 0, structure: 2 }, nextId++));
    return s;
  }

  it('round trips through serialize with the cell index rebuilt (hash equal), free list included', () => {
    const s = busy();
    expect(s.structures.recycledCount).toBe(1);
    const r = deserialize(serialize(s));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(hashState(r.state)).toBe(hashState(s));
    expect(Array.from(r.state.structures.byCell)).toEqual(Array.from(s.structures.byCell));
    expect(Array.from(r.state.structures.counts)).toEqual(Array.from(s.structures.counts));
    expect(r.state.structures.liveCount).toBe(s.structures.liveCount);
    // the incremental index equals one rebuilt from the arrays
    const t = new StructureTable(W * H, 3);
    for (const k of ['type', 'owner', 'cell', 'level', 'buildTick', 'readyTick', 'upgradeReadyTick'] as const) t[k].set(s.structures[k]);
    t.highWater = s.structures.highWater;
    t.rebuildIndex();
    expect(Array.from(t.byCell)).toEqual(Array.from(s.structures.byCell));
    expect(Array.from(t.counts)).toEqual(Array.from(s.structures.counts));
  });

  it('a restored state carries on exactly like the straight run (ids come from the same free list)', () => {
    const a = busy();
    const b = deserialize(serialize(a));
    if (!b.ok) throw new Error('deserialize');
    for (const s of [a, b.state]) {
      idle(s, 31);
      mustBuild(s, STRUCT_CITY, at(100, 50));
      mustBuild(s, STRUCT_SAM, at(100, 10));
      applyIntent(s, withId({ kind: 'Upgrade', seat: 0, structure: 0 }, 9000));
      idle(s, 400);
    }
    expect(hashState(b.state)).toBe(hashState(a));
    expect(b.state.structures.idAt(at(100, 50))).toBe(a.structures.idAt(at(100, 50)));
  });

  it('the structures are part of the hash, and a corrupt block is refused by deserialize', () => {
    const s = busy();
    const h = hashState(s);
    s.structures.level[0] = 3;
    expect(hashState(s)).not.toBe(h);
    s.structures.level[0] = 1;
    s.structures.deleteReady[1] = 1;
    expect(hashState(s)).not.toBe(h);
    s.structures.deleteReady[1] = 0;
    const bytes = serialize(s);
    expect(deserialize(bytes).ok).toBe(true);
    // the first live record starts after highWater, recycledCount, recycled[], deleteReady[], liveCount: flip its type to 0
    const view = new DataView(bytes.buffer);
    // M18c-1: the diplomacy block (16 + 12 per ownerId) and the match block (40 + 24 per ownerId) and the district count (4, no districts here) sit between the records and the checksum
    const slots = s.header.seats + 1;
    const live = bytes.length - 4 - (16 + 12 * slots) - (40 + 24 * slots) - 4 - s.structures.liveCount * 32;
    view.setUint32(live + 4, 0, true);
    const bad = deserialize(bytes);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toBe('structure-range');
  });

  it('the golden scenario really builds: after 3000 ticks the table is not empty and its index matches', () => {
    const s = createScenarioState();
    runScenario(s, 3000);
    expect(s.structures.liveCount).toBeGreaterThan(0);
    const r = deserialize(serialize(s));
    expect(r.ok && hashState(r.state) === hashState(s)).toBe(true);
  });
});
