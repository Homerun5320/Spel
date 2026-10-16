// M12a-1: Los / Nav inside `step` (the decision "M12 preparation: Los/Nav access inside step"). The occluder layer `maxElev` rides on SimWorld but is NOT
// part of the map hash; the Los / Nav caches hang lazily on `state.env`, are never hashed or serialised, and a deserialized state builds its own and
// answers the same questions. Synthetic world: flat plains with a high ridge and a SAM site behind it.
import { describe, expect, it } from 'vitest';
import { MissingOccluderError, exposureOf, hasOccluders, losOf, navOf, navViewOf, planRouteOf, scoreLzOf } from '../../src/sim/access';
import { rowCosFromLut } from '../../src/sim/grid';
import { ALT_MODE_HIGH, ALT_MODE_LOW, createLos } from '../../src/sim/los/cache';
import { exposure } from '../../src/sim/los/exposure';
import { createLosTerrain } from '../../src/sim/los/terrain';
import { createNav } from '../../src/sim/nav/grid';
import { scoreLz } from '../../src/sim/nav/lz';
import { planRoute, type NavView } from '../../src/sim/nav/route';
import { deserialize, hashState, serialize } from '../../src/sim/serialize';
import { step, type StepFn } from '../../src/sim/step';
import { createState, type GameState } from '../../src/sim/state';
import { STRUCT_SAM } from '../../src/sim/structureRules';
import { CLASS_HILLS, CLASS_PLAINS } from '../../src/sim/terrain';
import { createSimWorld, createWorldState } from '../../src/sim/world';
import { loadRealWorld } from '../../tools/sim/realWorld';
import { createWorldLoader } from '../../src/data/world';

const W = 512;
const H = 128;
const at = (x: number, y: number): number => y * W + x;

interface Arrays {
  terrain: Uint8Array;
  mean: Int16Array;
  max: Int16Array;
}

/** Plains at 5 m with a tall ridge across x 214..219 (mean 20, max 5200: only the occluder layer makes it a wall; it hides what stands behind it from a SAM on its east side). */
function arrays(): Arrays {
  const terrain = new Uint8Array(W * H).fill(CLASS_PLAINS);
  const mean = new Int16Array(W * H).fill(5);
  const max = new Int16Array(W * H).fill(5);
  for (let y = 0; y < H; y++)
    for (let x = 214; x < 220; x++) {
      terrain[at(x, y)] = CLASS_HILLS;
      mean[at(x, y)] = 20;
      max[at(x, y)] = 5200;
    }
  return { terrain, mean, max };
}

/** A state on the arrays (elevation = the clamped mean), a finished SAM of seat 1 at x 225 and a finished one of seat 0 far away, at tick 1000. */
function make(a: Arrays, withMax = true): GameState {
  const s = createState({ width: W, height: H, seed: 3, seats: 2, terrain: a.terrain, elevation: Uint16Array.from(a.mean), ...(withMax ? { maxElev: a.max } : {}) });
  s.structures.add(STRUCT_SAM, 2, at(225, 64), 0);
  s.structures.add(STRUCT_SAM, 1, at(40, 20), 0);
  s.tick = 1000;
  return s;
}

const CELLS = [at(200, 64), at(205, 64), at(235, 64), at(260, 64), at(150, 30), at(226, 63)];

/** Everything the three queries answer for a state, as JSON (compared between a live state and a restored one). */
function answers(s: GameState): string {
  const out: unknown[] = [];
  for (const mode of [ALT_MODE_LOW, ALT_MODE_HIGH] as const) {
    for (const c of CELLS) out.push(exposureOf(s, 1, c, mode)); // seat 1 is the defender whose SAM stands at x 225
    out.push(planRouteOf(s, 0, at(150, 64), at(260, 64), mode));
    out.push(planRouteOf(s, 0, at(150, 30), at(180, 40), mode));
    out.push(scoreLzOf(s, 0, at(260, 64), at(150, 64), mode));
    out.push(scoreLzOf(s, 0, at(216, 64), at(150, 64), mode)); // on the ridge
  }
  return JSON.stringify(out);
}

describe('maxElev on the world', () => {
  it('createSimWorld copies it, checks its length, and the map hash does not depend on it', () => {
    const a = arrays();
    const input = { width: W, height: H, terrainClass: a.terrain, meanElev: a.mean, cosQ15: Array.from(rowCosFromLut(H)) };
    const without = createSimWorld(input);
    const withMax = createSimWorld({ ...input, maxElev: a.max });
    expect(without.maxElev).toBeUndefined();
    expect(withMax.maxElev).toBeInstanceOf(Int16Array);
    a.max[0] = 999; // the world holds a copy
    expect(withMax.maxElev?.[0]).toBe(5);
    expect(() => createSimWorld({ ...input, maxElev: new Int16Array(10) })).toThrow(RangeError);
    const [s0, s1] = [createWorldState(without, { seed: 4, seats: 2 }), createWorldState(withMax, { seed: 4, seats: 2 })];
    expect(s1.header.mapHash).toBe(s0.header.mapHash);
    expect(hashState(s1)).toBe(hashState(s0));
    expect(Array.from(serialize(s1))).toEqual(Array.from(serialize(s0)));
    expect(hasOccluders(s0)).toBe(false);
    expect(hasOccluders(s1)).toBe(true);
    expect(() => createState({ width: W, height: H, seed: 1, seats: 2, terrain: a.terrain, elevation: new Uint16Array(W * H), maxElev: new Int16Array(3) })).toThrow(RangeError);
  });

  it('the real world loader fills it (loadSim reads the maxElev layer), and it leaves the real map hash alone', async () => {
    const world = await loadRealWorld();
    expect(world.maxElev).toBeInstanceOf(Int16Array);
    expect(world.maxElev?.length).toBe(world.width * world.height);
    const loader = createWorldLoader({
      manifestUrl: 'http://sim.invalid/data/manifest.json',
      readBytes: async (url: string): Promise<Uint8Array> => new Uint8Array((await import('node:fs')).readFileSync(`public/data/${decodeURIComponent(new URL(url).pathname.replace(/^\/data\//, ''))}`)),
    });
    const sim = await loader.loadSim();
    expect(Array.from(world.maxElev!.subarray(0, 4096))).toEqual(Array.from(sim.maxElev.subarray(0, 4096)));
    const bare = createSimWorld({ width: world.width, height: world.height, terrainClass: world.terrain, meanElev: world.elevation, cosQ15: Array.from(world.rowCos) });
    expect(createWorldState(world, { seed: 1, seats: 2 }).header.mapHash).toBe(createWorldState(bare, { seed: 1, seats: 2 }).header.mapHash);
  });
});

describe('Los / Nav from a state', () => {
  it('building them changes neither the hash nor the bytes (they are derived, lazy, never serialised)', () => {
    const s = make(arrays());
    const [hash, bytes] = [hashState(s), Array.from(serialize(s))];
    expect(s.env.los).toBeNull();
    expect(s.env.nav).toBeNull();
    answers(s);
    expect(s.env.los).not.toBeNull();
    expect(s.env.nav).not.toBeNull();
    expect(losOf(s)).toBe(s.env.los);
    expect(navViewOf(s)).toBe(navViewOf(s)); // one reused window per state, no allocation per question
    expect(navOf(s)).toBe(s.env.nav);
    expect(hashState(s)).toBe(hash);
    expect(Array.from(serialize(s))).toEqual(bytes);
  });

  it('the ridge matters: a SAM behind it sees a low flier over the ridge less than one in the open (the layer reaches the maths)', () => {
    const s = make(arrays());
    const flat = make({ ...arrays(), max: new Int16Array(W * H).fill(5), mean: new Int16Array(W * H).fill(5) });
    // The defender is seat 1 (SAM at x 225). A low flier over x 235 is in the open; one over x 210 is behind the ridge (214..219); without the ridge it is seen.
    expect(exposureOf(s, 1, at(235, 64), ALT_MODE_LOW)).not.toBe(0);
    expect(exposureOf(s, 1, at(210, 64), ALT_MODE_LOW)).toBe(0);
    expect(exposureOf(flat, 1, at(210, 64), ALT_MODE_LOW)).not.toBe(0);
    expect(exposureOf(s, 1, at(210, 64), ALT_MODE_HIGH)).not.toBe(0); // a high flier is seen over the ridge
  });

  it('a state answers exactly like a Los / Nav built by hand from the same arrays (the state adapter is the same view)', () => {
    const a = arrays();
    const s = make(a);
    const los = createLos(createLosTerrain(W, H, rowCosFromLut(H), a.mean, a.max));
    const nav = createNav({ width: W, height: H, terrainClass: a.terrain, meanElev: a.mean }, los);
    const view: NavView = { tick: s.tick, structures: s.structures, terrainClass: a.terrain, seats: 2 };
    for (const mode of [ALT_MODE_LOW, ALT_MODE_HIGH] as const) {
      for (const c of CELLS) expect(exposureOf(s, 0, c, mode), `cell ${c}`).toBe(exposure(los, view, 0, c, mode));
      expect(planRouteOf(s, 0, at(150, 64), at(260, 64), mode)).toEqual(planRoute(nav, view, 0, at(150, 64), at(260, 64), mode));
      expect(scoreLzOf(s, 0, at(260, 64), at(150, 64), mode)).toEqual(scoreLz(nav, view, 0, at(260, 64), at(150, 64), mode));
    }
  });

  it('a world without maxElev plays on, and the first Los / Nav question throws a clear error (not before)', () => {
    const s = make(arrays(), false);
    expect(hasOccluders(s)).toBe(false);
    for (let i = 0; i < 5; i++) expect(step(s, { turn: s.tick, intents: [] }).ok).toBe(true);
    expect(() => losOf(s)).toThrow(MissingOccluderError);
    expect(() => exposureOf(s, 0, at(1, 1))).toThrow(/maxElev/);
    expect(() => planRouteOf(s, 0, at(1, 1), at(5, 5))).toThrow(MissingOccluderError);
    expect(() => scoreLzOf(s, 0, at(1, 1), at(5, 5))).toThrow(MissingOccluderError);
    expect(s.env.los).toBeNull();
  });

  it('a deserialized state answers the same questions as the live one when the layer is handed in again, and says so clearly when it is not', () => {
    const a = arrays();
    const s = make(a);
    const live = answers(s);
    const r = deserialize(serialize(s), { maxElev: a.max });
    if (!r.ok) throw new Error(r.error);
    expect(r.state.env.los).toBeNull(); // dropped: built on demand
    expect(answers(r.state)).toBe(live);
    expect(hashState(r.state)).toBe(hashState(s));
    const bare = deserialize(serialize(s));
    if (!bare.ok) throw new Error(bare.error);
    expect(() => exposureOf(bare.state, 0, at(1, 1))).toThrow(MissingOccluderError);
    expect(deserialize(serialize(s), { maxElev: new Int16Array(5) })).toEqual({ ok: false, error: 'header' });
  });

  it('Los.sync memoises against the state: one scan per tick and per change of the structure table, a new tick scans again', () => {
    const s = make(arrays());
    const los = losOf(s);
    exposureOf(s, 1, at(235, 64));
    exposureOf(s, 1, at(200, 64), ALT_MODE_HIGH);
    planRouteOf(s, 0, at(150, 64), at(260, 64));
    expect(los.syncScans).toBe(1); // many questions in one tick: one scan
    s.structures.add(STRUCT_SAM, 2, at(236, 70), 0); // a change of the table (liveCount moves)
    exposureOf(s, 1, at(235, 64));
    expect(los.syncScans).toBe(2);
    step(s, { turn: s.tick, intents: [] }); // the tick moves
    exposureOf(s, 1, at(235, 64));
    exposureOf(s, 1, at(200, 64));
    expect(los.syncScans).toBe(3);
  });

  it('the queries can be made from inside step: a step function that asks before every step runs the same match', () => {
    const [plain, asking] = [make(arrays()), make(arrays())];
    const ask: StepFn = (st, turn) => {
      exposureOf(st, 1, at(235, 64));
      scoreLzOf(st, 0, at(260, 64), at(150, 64));
      return step(st, turn);
    };
    for (let i = 0; i < 20; i++) {
      step(plain, { turn: plain.tick, intents: [] });
      expect(ask(asking, { turn: asking.tick, intents: [] }).ok).toBe(true);
    }
    expect(hashState(asking)).toBe(hashState(plain));
    expect(losOf(asking).syncScans).toBe(20); // one scan per tick, however many questions
  });
});
