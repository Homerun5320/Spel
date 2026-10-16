// M13b: the launch preview. (1) PARITY: for 35+ landing-zone cells covering every LZ reason code and every launch refusal, `previewLaunch` (and
// `validateLaunchHeli` directly) says exactly what the sim's own LaunchHeli intent says, with the same `troops` everywhere. (2) THROTTLE: the previewer keeps at
// most one query out, throws away an answer for a request that is no longer wanted, and sends at most once per interval.
import { describe, expect, it } from 'vitest';
import { LaunchPreviewer, previewLaunch, requestKey, type PreviewRequest, type PreviewResult } from '../../src/app/launchPreview';
import { createLos, createLosTerrain, createNav, planRoute, validateLaunchHeli, validateProduceHeli, type Nav } from '../../src/sim/public';
import { launchHeliBody, produceHeliBody, REJECT_HELI_BAD_TROOPS, REJECT_HELI_NO_FACTORY, REJECT_HELI_NO_GOLD, REJECT_HELI_NO_PAD, REJECT_HELI_NOT_OWNER, withId, type IntentBody } from '../../src/sim/intents';
import { LZ_ENEMY_CITY_NEAR, LZ_NO_ROUTE, LZ_OUT_OF_FUEL, LZ_PEAK, LZ_STEEP, LZ_TERRAIN_CLASS, LZ_TOO_HIGH, LZ_WATER } from '../../src/sim/nav/lz';
import { BUILD_TICKS, HELI_BUILD_TICKS, HELI_FUEL_CELLS, HELI_MAX_TROOPS, MILLI_GOLD_PER_GOLD, QT_PER_TROOP, TICK_HZ } from '../../src/sim/rules';
import { deserialize, serialize } from '../../src/sim/serialize';
import { step } from '../../src/sim/step';
import { createState, rebuildAggregates, type GameState } from '../../src/sim/state';
import { STRUCT_CITY, STRUCT_FACTORY, STRUCT_POST } from '../../src/sim/structureRules';
import { CLASS_DEEP_SEA, CLASS_FOREST, CLASS_ICE, CLASS_MOUNTAIN, CLASS_PEAK, CLASS_PLAINS, CLASS_SHALLOWS } from '../../src/sim/terrain';
import { StateView } from '../../src/sim/view';

const W = 512;
const H = 128;
const at = (x: number, y: number): number => y * W + x;
const TROOPS = 300; // whole troops of seat 0

interface Fixture {
  s: GameState;
  maxElev: Int16Array;
  factory: number;
  second: number; // a finished Factory of seat 0 with NO helicopter on its pad
  enemyFactory: number;
  city: number;
  nav: Nav;
  view: StateView;
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

function build(): Fixture {
  const terrain = new Uint8Array(W * H).fill(CLASS_PLAINS);
  const elevation = new Uint16Array(W * H).fill(5);
  const set = (x: number, y: number, cls: number, elev?: number): void => {
    terrain[at(x, y)] = cls;
    if (elev !== undefined) elevation[at(x, y)] = elev;
  };
  set(120, 40, CLASS_DEEP_SEA);
  set(121, 40, CLASS_SHALLOWS);
  set(100, 70, CLASS_PEAK);
  set(100, 90, CLASS_MOUNTAIN);
  set(101, 90, CLASS_ICE);
  set(102, 90, CLASS_FOREST);
  elevation[at(100, 100)] = 900; // a lone tall cell: the 3x3 spread round (100, 100) is 895 m
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) elevation[at(110 + dx, 110 + dy)] = 4000; // above LZ_MAX_ELEV_M, flat inside
  // a sealed nav block (4x4 cells at 120..123, 80..83): every block round it holds Peaks
  for (let y = 76; y < 88; y++) for (let x = 116; x < 128; x++) if (x < 120 || x > 123 || y < 80 || y > 83) terrain[at(x, y)] = CLASS_PEAK;
  const maxElev = Int16Array.from(elevation);
  const s = createState({ width: W, height: H, seed: 5, seats: 2, config: { debugIntents: true }, terrain, elevation, maxElev });
  for (let c = 0; c < W * H; c++) s.owner[c] = c % W < W / 2 ? 1 : 2;
  rebuildAggregates(s);
  s.gold[1] = 100000 * MILLI_GOLD_PER_GOLD;
  s.gold[2] = 100000 * MILLI_GOLD_PER_GOLD;
  const factory = s.structures.add(STRUCT_FACTORY, 1, at(20, 60), s.tick);
  const second = s.structures.add(STRUCT_FACTORY, 1, at(30, 90), s.tick);
  const enemyFactory = s.structures.add(STRUCT_FACTORY, 2, at(400, 60), s.tick);
  const city = s.structures.add(STRUCT_CITY, 1, at(40, 30), s.tick);
  s.structures.add(STRUCT_CITY, 2, at(150, 60), s.tick); // an enemy city for ENEMY_CITY_NEAR
  for (let i = 0; i < (BUILD_TICKS[STRUCT_FACTORY] as number); i++) step(s, { turn: s.tick, intents: [] });
  expect(run(s, produceHeliBody(0, factory))).toEqual([]);
  for (let i = 0; i < HELI_BUILD_TICKS + 1; i++) step(s, { turn: s.tick, intents: [] });
  s.troops[1] = TROOPS * QT_PER_TROOP;
  const los = createLos(createLosTerrain(W, H, s.rowCos, elevation, maxElev));
  const nav = createNav({ width: W, height: H, terrainClass: s.terrain, meanElev: elevation }, los);
  return { s, maxElev, factory, second, enemyFactory, city, nav, view: new StateView(s) };
}

describe('previewLaunch against the real LaunchHeli intent', () => {
  it('35+ cells, every LZ reason code and every launch refusal: the same verdict, the same troops', () => {
    const f = build();
    interface Case {
      name: string;
      factory: number;
      lz: number;
      troops: number;
      mode: 0 | 1;
      want?: number;
    }
    const base = (name: string, lz: number, want?: number, mode: 0 | 1 = 0, troops = 100): Case => ({ name, factory: f.factory, lz, troops, mode, ...(want !== undefined ? { want } : {}) });
    const cases: Case[] = [];
    for (let i = 0; i < 12; i++) cases.push(base(`plains ${i}`, at(60 + i * 4, 58 + (i % 5)), 0, (i % 2) as 0 | 1, 1 + i * 20));
    cases.push(
      base('water deep', at(120, 40), LZ_WATER),
      base('water shallow', at(121, 40), LZ_WATER),
      base('peak', at(100, 70), LZ_PEAK),
      base('mountain', at(100, 90), LZ_TERRAIN_CLASS),
      base('ice', at(101, 90), LZ_TERRAIN_CLASS),
      base('forest', at(102, 90), LZ_TERRAIN_CLASS),
      base('steep', at(100, 100), LZ_STEEP),
      base('enemy city', at(151, 60), LZ_ENEMY_CITY_NEAR),
      base('too high', at(110, 110), LZ_TOO_HIGH),
      base('out of fuel (straight)', at(20 + HELI_FUEL_CELLS + 5, 60), LZ_OUT_OF_FUEL),
      base('out of fuel (High)', at(20 + HELI_FUEL_CELLS + 20, 61), LZ_OUT_OF_FUEL, 1),
      base('no route (sealed block)', at(121, 81), LZ_NO_ROUTE),
      base('no route (sealed, High)', at(122, 82), LZ_NO_ROUTE, 1),
      base('troops 0', at(80, 60), REJECT_HELI_BAD_TROOPS, 0, 0),
      base('troops over the cap', at(80, 60), REJECT_HELI_BAD_TROOPS, 0, HELI_MAX_TROOPS + 1),
      base('troops over the purse', at(80, 60), REJECT_HELI_BAD_TROOPS, 0, TROOPS + 1),
      base('troops exactly the purse', at(80, 60), 0, 0, TROOPS),
      base('troops 1', at(80, 60), 0, 1, 1),
      { name: 'no helicopter on the pad', factory: f.second, lz: at(80, 60), troops: 10, mode: 0, want: REJECT_HELI_NO_PAD },
      { name: "another seat's factory", factory: f.enemyFactory, lz: at(80, 60), troops: 10, mode: 0, want: REJECT_HELI_NOT_OWNER },
      { name: 'not a factory', factory: f.city, lz: at(80, 60), troops: 10, mode: 0, want: REJECT_HELI_NO_FACTORY },
    );
    expect(cases.length).toBeGreaterThanOrEqual(30);
    const seen = new Set<number>();
    for (const c of cases) {
      const twin = deserialize(serialize(f.s), { maxElev: f.maxElev });
      if (!twin.ok) throw new Error('twin');
      const sim = run(twin.state, launchHeliBody(0, c.factory, c.lz, c.troops, c.mode));
      const real = sim.length === 0 ? 0 : (sim[0] as number);
      const req: PreviewRequest = { factory: c.factory, lzCell: c.lz, troops: c.troops, mode: c.mode };
      const preview = previewLaunch(f.nav, f.view, 0, req);
      expect(validateLaunchHeli(f.view, f.nav, 0, c.factory, c.lz, c.troops, c.mode), `validate ${c.name}`).toBe(real);
      expect(preview.reason, `preview ${c.name}`).toBe(real);
      expect(preview.request.troops, `troops ${c.name}`).toBe(c.troops);
      if (c.want !== undefined) expect(real, `the case itself ${c.name}`).toBe(c.want);
      if (real === 0) {
        expect(preview.waypoints, c.name).not.toBeNull();
        expect(preview.exposed?.length).toBe(preview.waypoints?.length);
        expect(preview.etaSeconds).toBeGreaterThan(0);
        expect(preview.fuelCells).toBeGreaterThan(0);
        expect(twin.state.helis.liveCount, 'the intent really launched').toBeGreaterThan(0);
      }
      seen.add(real);
    }
    for (const code of [0, LZ_WATER, LZ_PEAK, LZ_TERRAIN_CLASS, LZ_STEEP, LZ_ENEMY_CITY_NEAR, LZ_TOO_HIGH, LZ_OUT_OF_FUEL, LZ_NO_ROUTE, REJECT_HELI_BAD_TROOPS, REJECT_HELI_NO_PAD, REJECT_HELI_NOT_OWNER, REJECT_HELI_NO_FACTORY]) {
      expect(seen.has(code), `reason ${code} was covered`).toBe(true);
    }
  });

  it('NO_GOLD: the production check the Factory panel shows is the sim answer too', () => {
    const f = build();
    const poor = deserialize(serialize(f.s), { maxElev: f.maxElev });
    if (!poor.ok) throw new Error('twin');
    poor.state.gold[1] = 0;
    const view = new StateView(poor.state);
    const real = run(poor.state, produceHeliBody(0, f.second));
    expect(real).toEqual([REJECT_HELI_NO_GOLD]);
    expect(validateProduceHeli(view, 0, f.second)).toBe(REJECT_HELI_NO_GOLD);
  });

  it('a refused zone still carries a route when one exists (the line shows where it would go)', () => {
    const f = build();
    const r = previewLaunch(f.nav, f.view, 0, { factory: f.factory, lzCell: at(20 + HELI_FUEL_CELLS - 20, 60), troops: HELI_MAX_TROOPS + 1, mode: 0 });
    expect(r.reason).toBe(REJECT_HELI_BAD_TROOPS);
    expect(r.waypoints).not.toBeNull();
  });
});

describe('LaunchPreviewer: one query out, stale answers dropped, five per second', () => {
  const req = (lz: number, troops = 1): PreviewRequest => ({ factory: 0, lzCell: lz, troops, mode: 0 });
  const answer = (r: PreviewRequest): PreviewResult => ({ request: r, reason: 0, waypoints: [r.lzCell], exposed: new Uint8Array(1), etaSeconds: 1, fuelCells: 1, exposedCells: 0 });
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 4; i++) await Promise.resolve();
  };
  function fake() {
    const out: Array<{ r: PreviewRequest; resolve(): void }> = [];
    let active = 0;
    let maxActive = 0;
    const query = (r: PreviewRequest): Promise<PreviewResult> => {
      active++;
      maxActive = Math.max(maxActive, active);
      return new Promise((resolve) => {
        out.push({
          r,
          resolve: () => {
            active--;
            resolve(answer(r));
          },
        });
      });
    };
    return { query, out, maxActive: () => maxActive };
  }

  it('never two queries at once; the answer to an old request is dropped; only the newest request is sent next', async () => {
    const fk = fake();
    const p = new LaunchPreviewer(fk.query, 0.2);
    p.want(req(1));
    p.poll(0);
    expect(p.sent).toBe(1);
    p.want(req(2));
    p.poll(0.5); // the first is still out: nothing is sent although the interval is over
    p.want(req(3));
    p.poll(0.6);
    expect(p.sent).toBe(1);
    expect(p.status()).toBe('pending');
    (fk.out[0] as { resolve(): void }).resolve();
    await flush();
    expect(p.dropped).toBe(1);
    expect(p.current()).toBeNull(); // the answer for lz 1 is NOT shown for lz 3
    p.poll(0.7);
    expect(p.sent).toBe(2);
    expect((fk.out[1] as { r: PreviewRequest }).r.lzCell).toBe(3); // lz 2 was replaced, never sent
    (fk.out[1] as { resolve(): void }).resolve();
    await flush();
    expect(p.current()?.request.lzCell).toBe(3);
    expect(p.status()).toBe('ready');
    expect(fk.maxActive()).toBe(1);
  });

  it('at most one query per interval, none for an answer it already holds, and the sliders count as a new request', async () => {
    const fk = fake();
    const p = new LaunchPreviewer(fk.query, 0.2);
    p.want(req(5));
    p.poll(1);
    (fk.out[0] as { resolve(): void }).resolve();
    await flush();
    p.want(req(6));
    p.poll(1.1); // 0.1 s after the last send
    expect(p.sent).toBe(1);
    p.poll(1.21);
    expect(p.sent).toBe(2);
    (fk.out[1] as { resolve(): void }).resolve();
    await flush();
    p.poll(5); // the held answer is the wanted one: nothing to ask
    expect(p.sent).toBe(2);
    p.want(req(6, 300)); // the same cell, another troop count: another question
    p.poll(5.1);
    expect(p.sent).toBe(3);
    expect(requestKey(req(6, 300))).not.toBe(requestKey(req(6)));
    // 25 frames at 60 Hz = 0.41 s of a cursor that keeps moving: at most 3 queries
    const g = fake();
    const q = new LaunchPreviewer(g.query, 0.2);
    for (let i = 0; i < 25; i++) {
      q.want(req(100 + i));
      q.poll(10 + i / 60);
      if (g.out.length > 0) (g.out[g.out.length - 1] as { resolve(): void }).resolve();
      await flush();
    }
    expect(q.sent).toBeLessThanOrEqual(3);
  });

  it('clear() throws away an answer that is still on its way, and the Promise of the real query resolves', async () => {
    const fk = fake();
    const p = new LaunchPreviewer(fk.query, 0.2);
    p.want(req(1));
    p.poll(0);
    p.clear();
    (fk.out[0] as { resolve(): void }).resolve();
    await flush();
    expect(p.current()).toBeNull();
    expect(p.status()).toBe('idle');
    const f = build();
    const real = new LaunchPreviewer((r) => Promise.resolve(previewLaunch(f.nav, f.view, 0, r)), 0);
    const r0 = { factory: f.factory, lzCell: at(80, 60), troops: 5, mode: 0 as const };
    real.want(r0);
    real.poll(0);
    expect(real.status()).toBe('pending'); // an answer is a Promise: never ready in the same call
    await flush();
    expect(real.current()?.reason).toBe(0);
  });
});

// ---- Fix-4B: the faults an independent review found open (audit 3, 1.6): each test was shown to fail against the mutant named in its title (docs/DECISIONS.md, Fix-4B) ----

describe('Fix-4B: previewLaunch details', () => {
  it('the flight time is rounded UP to whole seconds (mutant: Math.floor)', () => {
    const f = build();
    let checked = 0;
    for (let x = 60; x < 140 && checked < 3; x += 7) {
      const req: PreviewRequest = { factory: f.factory, lzCell: at(x, 60), troops: 5, mode: 0 };
      const route = planRoute(f.nav, f.view, 0, at(20, 60), req.lzCell, 0);
      if (!route.ok || route.etaTicks % TICK_HZ === 0) continue;
      expect(previewLaunch(f.nav, f.view, 0, req).etaSeconds).toBe(Math.ceil(route.etaTicks / TICK_HZ));
      checked++;
    }
    expect(checked, 'a zone whose flight is not a whole number of seconds').toBeGreaterThan(0);
  });

  it('only ENEMY sensors colour the route: an own Defense Post beside it exposes nothing, an enemy one does (mutant: the own seat is not skipped)', () => {
    const f = build();
    const req: PreviewRequest = { factory: f.factory, lzCell: at(100, 60), troops: 5, mode: 0 };
    expect(previewLaunch(f.nav, f.view, 0, req).exposed?.some((e) => e === 1)).toBe(false);
    const post = f.s.structures.add(STRUCT_POST, 1, at(60, 61), f.s.tick); // OUR post on the line
    for (let i = 0; i < (BUILD_TICKS[STRUCT_POST] as number) + 1; i++) step(f.s, { turn: f.s.tick, intents: [] });
    expect(previewLaunch(f.nav, f.view, 0, req).exposed?.some((e) => e === 1), 'own post').toBe(false);
    f.s.structures.remove(post);
    f.s.structures.add(STRUCT_POST, 2, at(60, 61), f.s.tick); // THEIR post on the same cell
    for (let i = 0; i < (BUILD_TICKS[STRUCT_POST] as number) + 1; i++) step(f.s, { turn: f.s.tick, intents: [] });
    expect(previewLaunch(f.nav, f.view, 0, req).exposed?.some((e) => e === 1), 'enemy post').toBe(true);
  });

  it('a Factory slot that was freed plans nothing (mutant: the owner test is dropped)', () => {
    const f = build();
    const req: PreviewRequest = { factory: f.second, lzCell: at(100, 60), troops: 5, mode: 0 };
    expect(previewLaunch(f.nav, f.view, 0, req).waypoints).not.toBeNull();
    f.s.structures.remove(f.second);
    const gone = previewLaunch(f.nav, f.view, 0, req);
    expect(gone.waypoints).toBeNull();
    expect(gone.reason).not.toBe(0);
  });
});

describe('Fix-4B: LaunchPreviewer faults', () => {
  const req = (lz: number, troops = 1, mode: 0 | 1 = 0): PreviewRequest => ({ factory: 0, lzCell: lz, troops, mode });
  const answer = (r: PreviewRequest): PreviewResult => ({ request: r, reason: 0, waypoints: [r.lzCell], exposed: new Uint8Array(1), etaSeconds: 1, fuelCells: 1, exposedCells: 0 });
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 4; i++) await Promise.resolve();
  };

  it('a failed query is not an answer and does not kill the previewer: the next poll asks again (mutant: `inflight` stays true)', async () => {
    let calls = 0;
    const p = new LaunchPreviewer((r) => (++calls === 1 ? Promise.reject(new Error('boom')) : Promise.resolve(answer(r))), 0);
    p.want(req(1));
    p.poll(0);
    await flush();
    expect(p.status()).toBe('pending');
    p.poll(1); // still wanted, no answer yet: it asks again
    await flush();
    expect(calls).toBe(2);
    expect(p.current()?.request.lzCell).toBe(1);
  });

  it('the flight mode is part of the question: the same cell with Low flipped to High is asked again and never shows the Low answer (mutant: `mode` missing from the comparison)', async () => {
    const asked: PreviewRequest[] = [];
    const p = new LaunchPreviewer((r) => (asked.push(r), Promise.resolve(answer(r))), 0);
    p.want(req(7, 5, 0));
    p.poll(0);
    await flush();
    expect(p.current()?.request.mode).toBe(0);
    p.want(req(7, 5, 1));
    expect(p.current()).toBeNull();
    p.poll(1);
    await flush();
    expect(asked.map((r) => r.mode)).toEqual([0, 1]);
    expect(p.current()?.request.mode).toBe(1);
    // the cell, the troops and the Factory are part of it too
    for (const other of [req(8, 5, 1), req(7, 6, 1), { ...req(7, 5, 1), factory: 1 }]) {
      p.want(other);
      expect(p.current(), JSON.stringify(other)).toBeNull();
      p.want(req(7, 5, 1));
      expect(p.current()?.request.mode).toBe(1);
    }
  });

  it('the same question in a NEW object keeps the answer and sends nothing (no churn per frame)', async () => {
    const sent: PreviewRequest[] = [];
    const p = new LaunchPreviewer((r) => (sent.push(r), Promise.resolve(answer(r))), 0);
    p.want(req(3, 4, 1));
    p.poll(0);
    await flush();
    p.want(req(3, 4, 1));
    p.poll(1);
    expect(sent.length).toBe(1);
    expect(p.status()).toBe('ready');
  });

  it('clear() throws away the answer of a query that was out, forgets the throttle and the wanted request (mutants: no epoch bump, `lastSent` kept)', async () => {
    let resolve: (() => void) | null = null;
    const asked: number[] = [];
    const p = new LaunchPreviewer(
      (r) =>
        new Promise((res) => {
          asked.push(r.lzCell);
          resolve = () => res(answer(r));
        }),
      5, // a long interval: only a cleared throttle lets the next query out at once
    );
    p.want(req(1));
    p.poll(100);
    p.clear();
    (resolve as unknown as () => void)();
    await flush();
    expect(p.current()).toBeNull();
    expect(p.status()).toBe('idle');
    // the same request again at once: the old answer is gone, and the new query goes out although 0.1 s < 5 s have passed
    p.want(req(1));
    p.poll(100.1);
    expect(asked).toEqual([1, 1]);
    (resolve as unknown as () => void)();
    await flush();
    expect(p.current()?.request.lzCell).toBe(1);
  });
});
