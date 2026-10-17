// createMatch (M06): pure and seeded, the fair start, the AI nations' countries, the region masks, the neutral mode, the custom nation,
// the human seat as a parameter, and the refusals. Real data: the committed world, countries chosen from meta.json by property.
import { beforeAll, describe, expect, it } from 'vitest';
import { listCountries, type CountryChoice } from '../../src/app/eligibility';
import { prepareWorld, type PreparedWorld } from '../../src/app/matchWorld';
import {
  CUSTOM_COLORS,
  DIFFICULTIES,
  createMatch,
  matchSetupConfig,
  maxAiNations,
  type BuiltMatch,
  type MatchSetupConfig,
  type PlayerChoice,
} from '../../src/app/matchSetup';
import { MainThreadHost } from '../../src/host/mainThreadHost';
import { AiDriver } from '../../src/host/aiDriver';
import { regionMask } from '../../src/data/regions';
import { adjustedCostMilliQt, traitMilli, TRAIT_MAX_MILLI, TRAIT_MIN_MILLI } from '../../src/sim/homeRules';
import { HOME_COST_PCT, MATCH_TRIBES, SETUP_AI_NATIONS_DEFAULT, SETUP_AI_NATIONS_MAX, SETUP_CAPITAL_MIN_DISTANCE_CELLS, START_DISC_CELLS, START_GOLD_MILLI, START_TROOPS_QT, TRAIT_COAST_GAIN_PCT, TRAIT_COAST_MID_PERMILLE, TRAIT_MOUNTAIN_GAIN_PCT, TRAIT_MOUNTAIN_MID_PERMILLE } from '../../src/sim/rules';
import { ownerCapQt } from '../../src/sim/economy';
import { deserialize, hashState, serialize } from '../../src/sim/serialize';
import { applySpawn } from '../../src/sim/spawn';
import { REJECT_TERRAIN } from '../../src/sim/intents';
import { createWorldState } from '../../src/sim/world';
import { isPlayableClass } from '../../src/sim/terrain';
import { hex32 } from '../../src/sim/hash';
import { loadPreparedWorld } from '../../tools/sim/realWorld';
import { MINI_CAPITALS, MINI_W, miniWorld } from '../helpers/miniWorld';
import { dist2, isConnected, maxDistanceFrom, ownedCells } from '../helpers/matchChecks';

let world: PreparedWorld;
let list: CountryChoice[];
beforeAll(async () => {
  world = await loadPreparedWorld();
  list = listCountries(world, 'world');
});

const real = (id: number): PlayerChoice => ({ kind: 'real', countryId: id });
const byA3 = (a3: string): number => world.countries.find((c) => c.a3 === a3)?.id as number;
const cellAt = (lat: number, lon: number): number => Math.floor(((90 - lat) / 180) * 512) * 1024 + Math.floor(((lon + 180) / 360) * 1024);

function build(config: MatchSetupConfig): BuiltMatch {
  const r = createMatch(world, config);
  if (!r.ok) throw new Error(`createMatch refused: ${r.error.code} ${r.error.key} ${JSON.stringify(r.error.params)}`);
  return r.match;
}

/** Selectable countries in id order. */
const selectable = (): CountryChoice[] => list.filter((x) => x.eligibility.ok);

/** A seeded sample (a tiny integer generator of the TEST, not of the game): the same sample on every run. */
function sample<T>(items: readonly T[], n: number, seed: number): T[] {
  const a = items.slice();
  let s = seed >>> 0;
  const out: T[] = [];
  while (out.length < n && a.length > 0) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out.push(a.splice(s % a.length, 1)[0] as T);
  }
  return out;
}

describe('createMatch is pure and seeded', () => {
  it('the same world, config and seed give the same state (same hash, same bytes); another seed gives another match', () => {
    const swe = byA3('SWE');
    const a = build(matchSetupConfig(real(swe), { seed: 11 }));
    const b = build(matchSetupConfig(real(swe), { seed: 11 }));
    expect(hashState(a.state)).toBe(hashState(b.state));
    expect(Buffer.from(serialize(a.state)).equals(Buffer.from(serialize(b.state)))).toBe(true);
    expect(a.seats.map((s) => s.capitalCell)).toEqual(b.seats.map((s) => s.capitalCell));
    expect(a.seats.map((s) => s.identity)).toEqual(b.seats.map((s) => s.identity));
    const c = build(matchSetupConfig(real(swe), { seed: 12 }));
    expect(hashState(c.state)).not.toBe(hashState(a.state));
    expect(c.seats.map((s) => s.capitalCell)).not.toEqual(a.seats.map((s) => s.capitalCell));
    expect(a.state.tick).toBe(0);
  });

  it('every option is part of the state: tribes, regions, the number of nations and the player change the hash', () => {
    const swe = byA3('SWE');
    const base = hex32(hashState(build(matchSetupConfig(real(swe), { seed: 3 })).state));
    const others = [
      matchSetupConfig(real(swe), { seed: 3, tribes: false }),
      matchSetupConfig(real(swe), { seed: 3, aiNations: 5 }),
      matchSetupConfig(real(byA3('DEU')), { seed: 3 }),
      matchSetupConfig(real(swe), { seed: 3, spawnPhase: false }),
      matchSetupConfig(real(swe), { seed: 3, debugIntents: true }),
      matchSetupConfig(real(swe), { seed: 3, region: 'europe' }),
    ];
    const hashes = new Set([base, ...others.map((c) => hex32(hashState(build(c).state)))]);
    expect(hashes.size).toBe(others.length + 1);
    // the difficulty is stored in the config only: it does not touch the sim yet
    for (const difficulty of DIFFICULTIES) expect(hex32(hashState(build(matchSetupConfig(real(swe), { seed: 3, difficulty })).state))).toBe(base);
  });

  it('does not touch the world it is given, and two matches share no memory', () => {
    const data = world.data.sim.terrainClass;
    const first = (n: number): number[] => Array.from({ length: n }, (_, i) => data[i] as number);
    const before = first(5000);
    const m1 = build(matchSetupConfig(real(byA3('FRA')), { seed: 2 }));
    expect(first(5000)).toEqual(before);
    const m2 = build(matchSetupConfig(real(byA3('FRA')), { seed: 2 }));
    expect(m1.state.owner === m2.state.owner).toBe(false);
    expect(m1.state.terrain === m2.state.terrain).toBe(false);
    const h = hashState(m2.state);
    m1.state.owner.fill(0);
    m1.state.troops.fill(0);
    expect(hashState(m2.state)).toBe(h);
  });

  it('round-trips through serialize and deserialize', () => {
    const m = build(matchSetupConfig(real(byA3('JPN')), { seed: 4 }));
    const r = deserialize(serialize(m.state));
    expect(r.ok).toBe(true);
    if (r.ok) expect(hashState(r.state)).toBe(hashState(m.state));
  });
});

describe('the fair start', () => {
  it('a default match: 12 AI nations, 20 tribes, and EVERY seat holds exactly K contiguous cells, the same troops and the same gold at tick 0', () => {
    const swe = byA3('SWE');
    const m = build(matchSetupConfig(real(swe)));
    expect(m.config.aiNations).toBe(SETUP_AI_NATIONS_DEFAULT);
    expect(m.players).toBe(13);
    expect(m.state.header.seats).toBe(13 + MATCH_TRIBES);
    expect(m.tribesPlaced).toBe(MATCH_TRIBES);
    for (const seat of m.seats) {
      const owner = seat.seat + 1;
      expect(seat.capitalCell, `seat ${seat.seat}`).toBeGreaterThanOrEqual(0);
      expect(m.state.agg.area[owner], `seat ${seat.seat} (${seat.kind})`).toBe(START_DISC_CELLS);
      expect(isConnected(m.state, owner), `seat ${seat.seat} contiguous`).toBe(true);
      expect(m.state.owner[seat.capitalCell], `seat ${seat.seat} capital`).toBe(owner);
      expect(m.state.capital[owner]).toBe(seat.capitalCell + 1);
      // nations start with the same troops; a tribe starts with what its (smaller, cap / 3) cap allows
      expect(m.state.troops[owner], `seat ${seat.seat} troops`).toBe(seat.kind === 'tribe' ? Math.min(START_TROOPS_QT, ownerCapQt(m.state, owner)) : START_TROOPS_QT);
      expect(m.state.gold[owner], `seat ${seat.seat} gold`).toBe(START_GOLD_MILLI);
      // the disc is the K nearest land cells: round on open land, it stretches along a coast or a strip, but stays near its capital
      expect(maxDistanceFrom(m.state, owner, seat.capitalCell), `seat ${seat.seat}`).toBeLessThanOrEqual(40);
    }
    let owned = 0;
    for (const o of m.state.owner) if (o !== 0) owned++;
    expect(owned).toBe(START_DISC_CELLS * m.state.header.seats);
  });

  it('equal start over 20 country choices: the 5 first in id order with fewer than 400 cells (but land mass >= K) and 15 seeded samples', () => {
    const small = selectable().filter((x) => x.country.cells < 400).slice(0, 5);
    expect(small.length).toBe(5);
    const picked = [...small, ...sample(selectable().filter((x) => !small.includes(x)), 15, 20260601)];
    expect(picked.length).toBe(20);
    let reference: { troops: number; gold: number; cells: number } | null = null;
    for (const choice of picked) {
      const m = build(matchSetupConfig(real(choice.country.id), { seed: 5, tribes: false, aiNations: 3 }));
      const owner = m.humanSeat + 1;
      const cells = ownedCells(m.state, owner);
      const here = { troops: m.state.troops[owner] as number, gold: m.state.gold[owner] as number, cells: cells.length };
      expect(here.cells, choice.country.a3).toBe(START_DISC_CELLS);
      expect(isConnected(m.state, owner), choice.country.a3).toBe(true);
      expect(m.state.capital[owner], choice.country.a3).toBe(choice.country.capitalCell + 1);
      expect(m.state.owner[choice.country.capitalCell]).toBe(owner);
      reference ??= here;
      expect(here, choice.country.a3).toEqual(reference);
    }
  });

  it('the capitals of the nations are at least 17 cells apart, and two countries never share a capital', () => {
    for (const seed of [1, 2, 3]) {
      const m = build(matchSetupConfig(real(byA3('IND')), { seed, tribes: false }));
      const nations = m.seats.filter((s) => s.kind !== 'tribe');
      for (let i = 0; i < nations.length; i++) {
        for (let j = i + 1; j < nations.length; j++) {
          const d = dist2(1024, (nations[i] as { capitalCell: number }).capitalCell, (nations[j] as { capitalCell: number }).capitalCell);
          expect(d, `seed ${seed} seats ${i} ${j}`).toBeGreaterThanOrEqual(SETUP_CAPITAL_MIN_DISTANCE_CELLS ** 2);
        }
      }
    }
  });

  it('the AI nations take OTHER selectable real countries, each once, in an order that follows the seed', () => {
    const swe = byA3('SWE');
    const ok = new Set(selectable().map((x) => x.country.id));
    const orders = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const m = build(matchSetupConfig(real(swe), { seed, tribes: false }));
      const ids = m.seats.filter((s) => s.kind === 'ai').map((s) => s.countryId);
      expect(ids.length).toBe(SETUP_AI_NATIONS_DEFAULT);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).not.toContain(swe);
      for (const id of ids) expect(ok.has(id), `country ${id}`).toBe(true);
      expect(m.seats[0]?.countryId).toBe(swe);
      orders.add(ids.join(','));
    }
    expect(orders.size).toBeGreaterThanOrEqual(5);
  });

  it('a nation whose disc would come out short is replaced by the next candidate (a hand-made world with a shared strip)', () => {
    const mini = prepareWorld(miniWorld());
    for (let seed = 1; seed <= 25; seed++) {
      // Alpha is yours and spawns first on the strip; Beta's capital is 18 cells away (far enough) but its disc is cut by yours
      const r = createMatch(mini, matchSetupConfig({ kind: 'real', countryId: 1 }, { seed, aiNations: 2, tribes: false }));
      expect(r.ok, `seed ${seed}`).toBe(true);
      if (!r.ok) return;
      const ids = r.match.seats.filter((s) => s.kind === 'ai').map((s) => s.countryId);
      expect(ids.sort(), `seed ${seed}`).toEqual([3, 4]);
      for (const s of r.match.seats) expect(r.match.state.agg.area[s.seat + 1], `seed ${seed} seat ${s.seat}`).toBe(START_DISC_CELLS);
    }
    // and the replacement is really needed: after yours, Beta's capital gives fewer than K cells
    const m = build2(mini);
    expect(m.state.owner[MINI_CAPITALS.beta]).toBe(0);
    expect(MINI_CAPITALS.beta - MINI_CAPITALS.alpha).toBe(18);
  });

  it('when the countries run out the config is refused with the number that exist (the menu offers at most that many)', () => {
    const mini = prepareWorld(miniWorld());
    const r = createMatch(mini, matchSetupConfig({ kind: 'real', countryId: 1 }, { aiNations: 3, tribes: false }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('notEnoughCountries');
      expect(r.error.key).toBe('setup.error.notEnoughCountries');
      expect(r.error.params).toEqual({ available: 2, wanted: 3 });
    }
    expect(maxAiNations(mini, matchSetupConfig({ kind: 'real', countryId: 1 }))).toBe(2);
    expect(createMatch(mini, matchSetupConfig({ kind: 'real', countryId: 1 }, { aiNations: 2, tribes: false })).ok).toBe(true);
  });

  it('maxAiNations gives the real upper limit of every region: that many work, one more is refused (unless the global maximum)', () => {
    for (const region of ['world', 'europe', 'eastAsia', 'americas', 'africaMiddleEast'] as const) {
      const first = listCountries(world, region).find((x) => x.eligibility.ok) as CountryChoice;
      const base = matchSetupConfig(real(first.country.id), { region, tribes: false });
      const max = maxAiNations(world, base);
      expect(max, region).toBeGreaterThanOrEqual(5);
      expect(max, region).toBeLessThanOrEqual(SETUP_AI_NATIONS_MAX);
      expect(createMatch(world, { ...base, aiNations: max }).ok, `${region} ${max}`).toBe(true);
      if (max < SETUP_AI_NATIONS_MAX) {
        const over = createMatch(world, { ...base, aiNations: max + 1 });
        expect(over.ok, `${region} ${max + 1}`).toBe(false);
        if (!over.ok) expect(over.error.code).toBe('notEnoughCountries');
      }
    }
  });
});

/** Alpha's match on the mini world with no AI (only to look at the state after the human spawned). */
function build2(mini: PreparedWorld): BuiltMatch {
  const r = createMatch(mini, matchSetupConfig({ kind: 'real', countryId: 1 }, { aiNations: 0, tribes: false }));
  if (!r.ok) throw new Error(r.error.code);
  return r.match;
}

describe('the refusals', () => {
  it('EVERY country that is not selectable is refused by createMatch with its reason, and nothing is built', () => {
    let refused = 0;
    for (const { country, eligibility } of list) {
      if (eligibility.ok) continue;
      const r = createMatch(world, matchSetupConfig(real(country.id)));
      expect(r.ok, country.a3).toBe(false);
      if (!r.ok) {
        expect(r.error.code, country.a3).toBe('notSelectable');
        expect(r.error.key, country.a3).toBe(eligibility.key);
        expect(r.error.params, country.a3).toEqual(eligibility.params ?? {});
      }
      refused++;
    }
    expect(refused).toBeGreaterThan(90);
  });

  it('a custom start on too small a land mass (or on sea, or outside the region) is refused with its reason', () => {
    const small = list.find((x) => x.eligibility.reason === 'smallLandmass' && x.eligibility.landmass > 0) as CountryChoice;
    const custom = (cell: number): PlayerChoice => ({ kind: 'custom', name: 'Zorland', color: CUSTOM_COLORS[0] as number, flagSeed: 1, cell });
    const r1 = createMatch(world, matchSetupConfig(custom(small.country.capitalCell)));
    expect(r1.ok).toBe(false);
    if (!r1.ok) {
      expect(r1.error.code).toBe('startCell');
      expect(r1.error.key).toBe('setup.reason.smallLandmass');
      expect(r1.error.params).toEqual({ cells: small.eligibility.landmass, need: START_DISC_CELLS });
    }
    const sea = createMatch(world, matchSetupConfig(custom(cellAt(0, -30))));
    expect(sea.ok).toBe(false);
    if (!sea.ok) expect([sea.error.code, sea.error.key]).toEqual(['startCell', 'setup.start.terrain']);
    const out = createMatch(world, matchSetupConfig(custom(cellAt(35.7, 139.7)), { region: 'europe' }));
    expect(out.ok).toBe(false);
  });

  it('an invalid config is an error RESULT (never an exception), whatever is wrong with it', () => {
    const swe = byA3('SWE');
    const ok = matchSetupConfig(real(swe));
    const bad: Array<[string, unknown]> = [
      ['seed NaN', { ...ok, seed: Number.NaN }],
      ['seed float', { ...ok, seed: 1.5 }],
      ['seed too big', { ...ok, seed: 2 ** 33 }],
      ['region', { ...ok, region: 'mars' }],
      ['aiNations -1', { ...ok, aiNations: -1 }],
      ['aiNations max + 1', { ...ok, aiNations: SETUP_AI_NATIONS_MAX + 1 }],
      ['aiNations float', { ...ok, aiNations: 2.5 }],
      ['tribes', { ...ok, tribes: 'yes' }],
      ['difficulty', { ...ok, difficulty: 'impossible' }],
      ['neutral', { ...ok, neutral: 1 }],
      ['humanSeat', { ...ok, humanSeat: 99 }],
      ['humanSeat negative', { ...ok, humanSeat: -1 }],
      ['spawnPhase', { ...ok, spawnPhase: null }],
      ['debugIntents', { ...ok, debugIntents: 0 }],
      ['player null', { ...ok, player: null }],
      ['player kind', { ...ok, player: { kind: 'alien' } }],
      ['player country 0', { ...ok, player: { kind: 'real', countryId: 0 } }],
      ['player country 999', { ...ok, player: { kind: 'real', countryId: 999 } }],
      ['custom name empty', { ...ok, player: { kind: 'custom', name: '   ', color: 1, flagSeed: 1, cell: 5 } }],
      ['custom name long', { ...ok, player: { kind: 'custom', name: 'x'.repeat(25), color: 1, flagSeed: 1, cell: 5 } }],
      ['custom colour', { ...ok, player: { kind: 'custom', name: 'A', color: -1, flagSeed: 1, cell: 5 } }],
      ['custom colour big', { ...ok, player: { kind: 'custom', name: 'A', color: 0x1000000, flagSeed: 1, cell: 5 } }],
      ['custom cell', { ...ok, player: { kind: 'custom', name: 'A', color: 1, flagSeed: 1, cell: 1.5 } }],
      ['custom cell out of the world', { ...ok, player: { kind: 'custom', name: 'A', color: 1, flagSeed: 1, cell: 10 ** 9 } }],
      ['null config', null],
      ['a number', 7],
      ['empty object', {}],
    ];
    for (const [name, config] of bad) {
      let result: ReturnType<typeof createMatch> | undefined;
      expect(() => (result = createMatch(world, config as MatchSetupConfig)), name).not.toThrow();
      expect(result?.ok, name).toBe(false);
      if (result !== undefined && !result.ok) {
        expect(result.error.key.startsWith('setup.'), name).toBe(true);
        expect(['invalid', 'notSelectable', 'startCell', 'unknownCountry']).toContain(result.error.code);
      }
    }
  });

  it('the neutral mode needs a custom nation', () => {
    const r = createMatch(world, matchSetupConfig(real(byA3('SWE')), { neutral: true }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect([r.error.code, r.error.key]).toEqual(['neutralNeedsCustom', 'setup.error.neutralNeedsCustom']);
  });
});

describe('home land and traits', () => {
  it('a real country gives home rules: every nation has its country as home land and traits from its coast and mountain share, inside the cap', () => {
    const m = build(matchSetupConfig(real(byA3('CHL')), { seed: 8 }));
    expect(m.homeRules).toBe(true);
    const home = m.state.home;
    expect(home).not.toBeNull();
    for (const seat of m.seats) {
      const owner = seat.seat + 1;
      if (seat.kind === 'tribe') {
        expect(home?.homeLand[owner]).toBe(0);
        expect([home?.portMilli[owner], home?.defenceMilli[owner]]).toEqual([1000, 1000]);
        continue;
      }
      const c = world.byId.get(seat.countryId)!;
      expect(home?.homeLand[owner], c.a3).toBe(c.homeId);
      expect(home?.portMilli[owner], c.a3).toBe(traitMilli(c.coastPermille, TRAIT_COAST_MID_PERMILLE, TRAIT_COAST_GAIN_PCT));
      expect(home?.defenceMilli[owner], c.a3).toBe(traitMilli(c.mountainPermille, TRAIT_MOUNTAIN_MID_PERMILLE, TRAIT_MOUNTAIN_GAIN_PCT));
      for (const v of [home?.portMilli[owner], home?.defenceMilli[owner]]) {
        expect(v as number).toBeGreaterThanOrEqual(TRAIT_MIN_MILLI);
        expect(v as number).toBeLessThanOrEqual(TRAIT_MAX_MILLI);
      }
    }
  });

  it('the trait cap holds for every country of the table, including the extremes, in the table and in the state', () => {
    let lowest = 2000;
    let highest = 0;
    for (const c of world.countries) {
      for (const v of [traitMilli(c.coastPermille, TRAIT_COAST_MID_PERMILLE, TRAIT_COAST_GAIN_PCT), traitMilli(c.mountainPermille, TRAIT_MOUNTAIN_MID_PERMILLE, TRAIT_MOUNTAIN_GAIN_PCT)]) {
        expect(v, c.a3).toBeGreaterThanOrEqual(TRAIT_MIN_MILLI);
        expect(v, c.a3).toBeLessThanOrEqual(TRAIT_MAX_MILLI);
        lowest = Math.min(lowest, v);
        highest = Math.max(highest, v);
      }
    }
    // the mapping really spreads (a cap nobody reaches would be untested)
    expect(lowest).toBeLessThan(960);
    expect(highest).toBeGreaterThan(1040);
  });

  it('the home land of a country is the country map of the state: cells of the country carry its own id, a merged territory is home land of nobody else (D127)', () => {
    const m = build(matchSetupConfig(real(byA3('SWE')), { seed: 1, tribes: false, aiNations: 2 }));
    const swe = world.byId.get(byA3('SWE'))!;
    const home = m.state.home!;
    let n = 0;
    let wrong = 0;
    for (let i = 0; i < home.country.length; i++) {
      if (world.data.country[i] !== swe.id) continue;
      n++;
      if (home.country[i] !== swe.homeId) wrong++;
    }
    expect(wrong).toBe(0);
    expect(n).toBeGreaterThan(300);
    // every country is its own home land, merged territories included (Lebanon is not Syria's, Palestine not Israel's)
    for (const c of world.countries) expect(c.homeId, c.a3).toBe(c.id);
    expect(world.data.overrides.merged.length).toBeGreaterThan(0);
    for (const merged of world.data.overrides.merged) {
      const child = world.countries.find((c) => c.a3 === merged.a3)!;
      const parent = world.countries.find((c) => c.a3 === merged.into)!;
      expect(child.homeId, merged.a3).not.toBe(parent.id);
      expect(child.excluded, merged.a3).toBe(true);
    }
  });

  it('a player of the parent of a merged territory pays full price on that territory: only its own country is discounted', () => {
    const merged = world.data.overrides.merged.find((x) => world.countries.some((c) => c.a3 === x.into && !c.excluded));
    expect(merged).toBeDefined();
    const child = world.countries.find((c) => c.a3 === merged!.a3)!;
    const parent = world.countries.find((c) => c.a3 === merged!.into)!;
    const m = build(matchSetupConfig(real(parent.id), { seed: 1, tribes: false, aiNations: 1 }));
    const home = m.state.home!;
    let cell = -1;
    let own = -1;
    for (let i = 0; i < home.country.length && (cell < 0 || own < 0); i++) {
      if (cell < 0 && world.data.country[i] === child.id) cell = i;
      if (own < 0 && world.data.country[i] === parent.id) own = i;
    }
    expect(home.country[cell]).toBe(child.id);
    expect(home.country[own]).toBe(parent.id);
    const owner = m.seats.find((s) => s.kind === 'human')!.seat + 1;
    expect(home.homeLand[owner]).toBe(parent.id);
    expect(adjustedCostMilliQt(home, 1000, cell, owner, 0)).toBe(1000);
    expect(adjustedCostMilliQt(home, 1000, own, owner, 0)).toBe(HOME_COST_PCT * 10);
  });

  it('a custom nation plays on equal footing: no home rules in the match at all', () => {
    const m = build(matchSetupConfig({ kind: 'custom', name: 'Zorland', color: 0x336699, flagSeed: 3, cell: cellAt(50, 10) }));
    expect(m.homeRules).toBe(false);
    expect(m.state.home).toBeNull();
    expect(m.state.header.config.homeRules).toBeUndefined();
  });
});

describe('a custom nation', () => {
  const cell = cellAt(47, 8); // central Europe
  const player: PlayerChoice = { kind: 'custom', name: '  Zorland  ', color: 0xc8102e, flagSeed: 77, cell };

  it('starts exactly where you clicked, with its name trimmed, its colour and a flag in that colour', () => {
    const m = build(matchSetupConfig(player, { seed: 2 }));
    const you = m.seats[0]!;
    expect(you.kind).toBe('human');
    expect(you.capitalCell).toBe(cell);
    expect(m.state.capital[1]).toBe(cell + 1);
    expect(m.state.owner[cell]).toBe(1);
    expect(m.state.agg.area[1]).toBe(START_DISC_CELLS);
    expect(you.identity).toEqual({ kind: 'custom', name: 'Zorland' });
    expect(you.flag?.colors[0]).toBe(0xc8102e);
    expect(m.humanColor).toBe(0xc8102e);
    expect(m.labels.name(0)).toBe('Zorland');
    expect(m.labels.flag(0)).toEqual(you.flag);
  });

  it('no AI nation starts within 17 cells of the clicked place, and the other nations are real countries with their names', () => {
    for (const seed of [1, 2, 3]) {
      const m = build(matchSetupConfig(player, { seed, tribes: false }));
      for (const s of m.seats.filter((x) => x.kind === 'ai')) {
        expect(dist2(1024, s.capitalCell, cell), `seed ${seed} ${JSON.stringify(s.identity)}`).toBeGreaterThanOrEqual(17 * 17);
        expect(s.identity.kind).toBe('country');
        expect(s.countryId).toBeGreaterThan(0);
      }
    }
  });
});

describe('the neutral mode (no real borders)', () => {
  const player: PlayerChoice = { kind: 'custom', name: 'Zorland', color: 0x336699, flagSeed: 5, cell: cellAt(47, 8) };

  it('gives the AI nations invented names, flags and no country, and nobody a home land', () => {
    const m = build(matchSetupConfig(player, { neutral: true, seed: 9, tribes: false }));
    expect(m.homeRules).toBe(false);
    expect(m.state.home).toBeNull();
    const names = m.seats.filter((s) => s.kind === 'ai').map((s) => (s.identity.kind === 'invented' ? s.identity.name : ''));
    expect(names.length).toBe(SETUP_AI_NATIONS_DEFAULT);
    expect(new Set(names).size).toBe(names.length);
    const real = new Set(world.countries.flatMap((c) => [c.nameEn.toLowerCase(), c.nameSv.toLowerCase()]));
    for (const n of names) {
      expect(n.length, n).toBeGreaterThan(3);
      expect(real.has(n.toLowerCase()), n).toBe(false);
      expect(n).not.toBe('Zorland');
    }
    for (const s of m.seats.filter((x) => x.kind === 'ai')) {
      expect(s.countryId).toBe(0);
      expect(s.flag).not.toBeNull();
      expect(m.state.agg.area[s.seat + 1]).toBe(START_DISC_CELLS);
    }
    // seeded: the same names again, other names with another seed
    const again = build(matchSetupConfig(player, { neutral: true, seed: 9, tribes: false }));
    expect(again.seats.map((s) => s.identity)).toEqual(m.seats.map((s) => s.identity));
    const other = build(matchSetupConfig(player, { neutral: true, seed: 10, tribes: false }));
    expect(other.seats.map((s) => s.identity)).not.toEqual(m.seats.map((s) => s.identity));
  });
});

describe('the human seat is a parameter', () => {
  it('you can sit on any player seat; the AI plays all the others and the labels follow', () => {
    for (const humanSeat of [0, 4, 12]) {
      const m = build(matchSetupConfig(real(byA3('BRA')), { seed: 6, humanSeat, tribes: false }));
      expect(m.humanSeat).toBe(humanSeat);
      expect(m.seats[humanSeat]?.kind).toBe('human');
      expect(m.seats.filter((s) => s.kind === 'human').length).toBe(1);
      expect(m.seats[humanSeat]?.countryId).toBe(byA3('BRA'));
      expect(m.state.capital[humanSeat + 1]).toBe((world.byId.get(byA3('BRA'))?.capitalCell as number) + 1);
      expect(m.labels.isYou(humanSeat)).toBe(true);
      expect(m.labels.name(humanSeat, 'en')).toBe('Brazil');
      for (const s of m.seats) expect(m.state.agg.area[s.seat + 1]).toBe(START_DISC_CELLS);
    }
  });
});

describe('the skirmish regions: no cell outside the mask is ever owned', () => {
  for (const region of ['europe', 'eastAsia', 'americas', 'africaMiddleEast'] as const) {
    it(`${region}: every owned cell is inside the mask at tick 0 and after 3000 ticks of the AI at war`, () => {
      const mask = regionMask(region, 1024, 512) as Uint8Array;
      const first = listCountries(world, region).find((x) => x.eligibility.ok) as CountryChoice;
      const base = matchSetupConfig(real(first.country.id), { region, seed: 4, debugIntents: false });
      const nations = Math.min(maxAiNations(world, base), 8);
      const m = build({ ...base, aiNations: nations });
      const outside = (): number => {
        let n = 0;
        let owned = 0;
        for (let i = 0; i < m.state.owner.length; i++) {
          if (m.state.owner[i] !== 0) {
            owned++;
            if (mask[i] === 0) n++;
          }
        }
        expect(owned).toBeGreaterThan(0);
        return n;
      };
      expect(outside()).toBe(0);
      expect(m.tribesPlaced).toBeGreaterThan(0);
      const host = new MainThreadHost(m.state, { speed: 1, driver: new AiDriver(base.seed, { humanSeats: [m.humanSeat] }) });
      host.runTicks(1000);
      expect(outside(), 'after 1000 ticks').toBe(0);
      host.runTicks(2000);
      expect(outside(), 'after 3000 ticks').toBe(0);
      // the conquest really ran: the nations hold more than their start discs
      let owned = 0;
      for (const o of m.state.owner) if (o !== 0) owned++;
      expect(owned).toBeGreaterThan(START_DISC_CELLS * m.state.header.seats);
      host.dispose();
    });
  }

  it('the sim itself refuses a Spawn outside the mask (the playable grid of the match world): land outside is unplayable', () => {
    const analysis = world.analyse('europe');
    const state = createWorldState(analysis.world, { seed: 1, seats: 3, config: { debugIntents: false } });
    const tokyo = cellAt(35.7, 139.7);
    expect(world.data.sim.terrainClass[tokyo] !== undefined && isPlayableClass(world.data.sim.terrainClass[tokyo] as number)).toBe(true);
    expect(state.grid.playable[tokyo]).toBe(0);
    expect(applySpawn(state, 0, tokyo, 0)).toBe(REJECT_TERRAIN);
    expect(applySpawn(state, 0, cellAt(59.3, 18.1), 0)).toBe(0);
    // every playable cell of the match world is inside the mask
    const mask = analysis.mask as Uint8Array;
    for (let i = 0; i < mask.length; i++) if (state.grid.playable[i] === 1) expect(mask[i], `cell ${i}`).toBe(1);
  });

  it('the match header carries the world of the region, not the pack: a masked world has its own map hash', () => {
    const world0 = build(matchSetupConfig(real(byA3('SWE')), { seed: 1, tribes: false, aiNations: 1 }));
    const eu = build(matchSetupConfig(real(byA3('SWE')), { seed: 1, tribes: false, aiNations: 1, region: 'europe' }));
    expect(eu.state.header.mapHash).not.toBe(world0.state.header.mapHash);
    expect(eu.region).toBe('europe');
  });
});

describe('tribes', () => {
  it('are on by default (20) and off on request, each on a whole disc', () => {
    const on = build(matchSetupConfig(real(byA3('SWE')), { seed: 2, aiNations: 4 }));
    expect(on.state.header.seats).toBe(5 + MATCH_TRIBES);
    expect(on.seats.filter((s) => s.kind === 'tribe').length).toBe(MATCH_TRIBES);
    const off = build(matchSetupConfig(real(byA3('SWE')), { seed: 2, aiNations: 4, tribes: false }));
    expect(off.state.header.seats).toBe(5);
    expect(off.tribesPlaced).toBe(0);
  });
});

describe('what "fair" means (D128): equal cells, not equal income', () => {
  it('every seat starts with the same number of cells, but the cos-weighted area (income, cap, land share) follows the latitude of the capital', () => {
    const m = build(matchSetupConfig(real(byA3('SWE')), { seed: 1, tribes: false }));
    const cells = new Set<number>();
    let human = 0;
    let most = 0;
    for (const seat of m.seats) {
      const owner = seat.seat + 1;
      cells.add(m.state.agg.area[owner] as number);
      const w = m.state.agg.warea[owner] as number;
      if (seat.kind === 'human') human = w;
      most = Math.max(most, w);
    }
    expect([...cells]).toEqual([START_DISC_CELLS]); // the promise: equal cells
    expect(human).toBeGreaterThan(0);
    expect(human).toBeLessThan(most * 0.75); // the documented consequence: a nation at 60 N earns and ranks less per equal disc (BALANCE, D128)
  });
});
