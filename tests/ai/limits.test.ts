// Fix-3A2 (mutation audit 2, finding 8): quick unit scenes on the AI's single build move (src/ai/build.ts buildMove): a constructed state, ONE call,
// the expected intent. They lock the City level limit (1 + Cities * AI_CITY_UPGRADE_LEVELS_PER_CITY, at most AI_CITY_LEVEL_CAP), the rule that districts
// never eat the gold of the next wanted structure, the cheapest-first district upgrade with its own spare check, the interior filter for district
// upgrades and the kind of slot 5. Before this file only the 30 s tests/ai/driver.test.ts (or nothing) protected them. The "kills:" comments name the
// mutants; the table is in docs/DECISIONS.md (Fix-3A2).
import { describe, expect, it } from 'vitest';
import { buildMove, createAiMemory, type AiMemory } from '../../src/ai';
import { DISTRICT_BARRACKS, DISTRICT_HOUSING, DISTRICT_MARKET, DISTRICT_WALLS, districtBuildPriceMilli, districtIndex } from '../../src/sim/districtRules';
import { type IntentBody } from '../../src/sim/intents';
import { createRng } from '../../src/sim/rng';
import { AI_CITY_LEVEL_CAP, AI_CITY_UPGRADE_LEVELS_PER_CITY, AI_STRUCT_LEVEL_CAP, AI_THINK_PERIOD_TICKS, MILLI_GOLD_PER_GOLD } from '../../src/sim/rules';
import type { GameState } from '../../src/sim/state';
import { STRUCT_CITY, STRUCT_FACTORY, STRUCT_PORT, buildPriceMilli } from '../../src/sim/structureRules';
import { setOwner } from '../../src/sim/territory';
import { StateView } from '../../src/sim/view';
import { landState } from '../sim/helpers/worlds';

const W = 200;
const H = 100;
const ROW = 50 * W;

interface Scene {
  state: GameState;
  view: StateView;
  memory: AiMemory;
  rng: Uint32Array;
  cities: number[];
}

/** Seat 0 owns x < 100. `levels` = the levels of its interior Cities, plus a finished Factory and Port at their cap so only Cities and districts are left to want. */
function scene(levels: number[], seed = 3): Scene {
  const state = landState(W, H, { seats: 2, players: 2, seed });
  for (let c = 0; c < state.grid.cells; c++) setOwner(state, c, c % W < 100 ? 1 : 2, 0);
  state.capital[1] = ROW + 51;
  state.troops[1] = 1000;
  const cities = levels.map((level, i) => {
    const id = state.structures.add(STRUCT_CITY, 1, ROW + 20 + i * 15, 0);
    state.structures.level[id] = level;
    return id;
  });
  for (const [type, x] of [[STRUCT_FACTORY, 20], [STRUCT_PORT, 30]] as const) {
    const id = state.structures.add(type, 1, 60 * W + x, 0);
    state.structures.level[id] = AI_STRUCT_LEVEL_CAP;
  }
  const view = new StateView(state);
  const memory = createAiMemory(view, 0, { humanSeats: [] });
  return { state, view, memory, rng: createRng(seed), cities };
}

/** One think of the seat on a thinking tick with a purse of `goldMilli`. */
function ask(p: Scene, goldMilli: number): IntentBody | null {
  const t = 1000;
  p.state.tick = t + ((AI_THINK_PERIOD_TICKS - ((t + p.memory.phase) % AI_THINK_PERIOD_TICKS)) % AI_THINK_PERIOD_TICKS);
  p.memory.districtRetryAt = 0; // a think that finds nothing backs off; every ask is a fresh think
  p.memory.buildRetryAt = 0;
  p.state.gold[1] = goldMilli;
  p.view.refresh();
  return buildMove(p.view, p.memory, p.rng);
}

const GOLD = (g: number): number => g * MILLI_GOLD_PER_GOLD;
const nextCityMilli = (p: Scene): number => buildPriceMilli(p.view.structures, 1, STRUCT_CITY);

describe('the City level limit of a rich AI', () => {
  it('a City below 1 + Cities * AI_CITY_UPGRADE_LEVELS_PER_CITY is upgraded, one at the limit is not (the AI builds instead)', () => {
    // kills: ai-rich-max (level >= maxLevelOf(type) instead of the City target), ai-offset (the 1 + in the target, or the factor)
    const limit = 1 + 1 * AI_CITY_UPGRADE_LEVELS_PER_CITY; // one City
    const below = scene([limit - 1]);
    const up = ask(below, GOLD(1_000_000));
    expect(up).toMatchObject({ kind: 'Upgrade', structure: below.cities[0] });
    const at = scene([limit]);
    const b = ask(at, GOLD(1_000_000));
    expect(b?.kind).toBe('Build');
  });

  it('with three Cities the limit is AI_CITY_LEVEL_CAP: a level 9 City is upgraded, a level 10 City is left alone', () => {
    // kills: ai-city-cap (the cap removed from cityLevelTarget)
    expect(1 + 3 * AI_CITY_UPGRADE_LEVELS_PER_CITY).toBeGreaterThan(AI_CITY_LEVEL_CAP);
    const nine = scene([AI_CITY_LEVEL_CAP - 1, AI_CITY_LEVEL_CAP, AI_CITY_LEVEL_CAP]);
    expect(ask(nine, GOLD(1_000_000))).toMatchObject({ kind: 'Upgrade', structure: nine.cities[0] });
    const ten = scene([AI_CITY_LEVEL_CAP, AI_CITY_LEVEL_CAP, AI_CITY_LEVEL_CAP]);
    expect(ask(ten, GOLD(1_000_000))?.kind).not.toBe('Upgrade');
  });
});

describe('districts never eat the gold of the next wanted structure', () => {
  const full = (p: Scene, skip: ReadonlyArray<readonly [number, number]> = []): void => {
    // every slot of every City holds a level 3 district (the AI's cap), except the slots in `skip`
    for (const id of p.cities)
      for (let slot = 0; slot < 5; slot++) {
        if (skip.some(([i, s]) => p.cities[i] === id && s === slot)) continue;
        p.state.structures.setDistrict(id, slot, [DISTRICT_MARKET, DISTRICT_BARRACKS, DISTRICT_HOUSING, DISTRICT_WALLS, DISTRICT_MARKET][slot] as number, 3, 0, 0);
      }
  };

  it('a free slot is filled only from the purse that is left after the next City; with less the AI builds the City first', () => {
    // kills: ai-district-spare-gold ('const spare = goldMilli - price' -> 'goldMilli')
    const p = scene([10, 10, 10]);
    const city = nextCityMilli(p);
    const market = districtBuildPriceMilli(p.view.districts, 1, DISTRICT_MARKET);
    expect(ask(p, city + market - 1)?.kind).toBe('Build'); // the City, not the Market
    expect(ask(p, city + market)).toMatchObject({ kind: 'BuildDistrict', structure: p.cities[0], slot: 0, districtKind: DISTRICT_MARKET });
  });

  it('a district dearer than the spare purse is skipped even when the purse pays the cheapest kind', () => {
    // kills: ai-district-spare-price (the 'spareMilli >= districtBuildPriceMilli' test of a free slot removed)
    const p = scene([10, 10, 10]);
    for (const id of p.cities) for (const slot of [0, 4]) p.state.structures.setDistrict(id, slot, DISTRICT_MARKET, 3, 0, 0); // slot 1 (Barracks, 250 gold) is next, then Housing and Walls
    const barracks = districtBuildPriceMilli(p.view.districts, 1, DISTRICT_BARRACKS);
    expect(barracks).toBeGreaterThan(GOLD(100));
    expect(ask(p, nextCityMilli(p) + GOLD(100))?.kind).toBe('Build');
    expect(ask(p, nextCityMilli(p) + barracks)).toMatchObject({ kind: 'BuildDistrict', slot: 1, districtKind: DISTRICT_BARRACKS });
  });

  it('the fifth slot of a level 10 City is a Market', () => {
    // kills: ai-district-order5 (the last DISTRICT_ORDER entry DISTRICT_MARKET -> DISTRICT_WALLS)
    const p = scene([10, 10, 10]);
    full(p, [[0, 4]]);
    expect(ask(p, GOLD(1_000_000))).toMatchObject({ kind: 'BuildDistrict', structure: p.cities[0], slot: 4, districtKind: DISTRICT_MARKET });
  });

  it('the district upgrade picks the cheapest one in the whole empire, not the first, and also needs the spare purse', () => {
    // kills: ai-district-upgrade-cheapest ('price < bestPrice' -> '>'), ai-district-upgrade-spare (the 'spareMilli >= price' test removed)
    const p = scene([10, 10, 10]);
    full(p);
    p.state.structures.districtLevel[districtIndex(p.cities[0]!, 1)] = 1; // City 0, slot 1: Barracks level 1 -> 2 costs 500 gold
    p.state.structures.districtLevel[districtIndex(p.cities[1]!, 0)] = 1; // City 1, slot 0: Market level 1 -> 2 costs 80 gold
    expect(ask(p, nextCityMilli(p) + GOLD(1000))).toMatchObject({ kind: 'UpgradeDistrict', structure: p.cities[1], slot: 0 });
    expect(ask(p, nextCityMilli(p) + GOLD(60))?.kind).toBe('Build'); // 60 gold spare pays neither upgrade (the cheapest asks 80)
  });

  it('a district upgrade is never bought in a City on the border', () => {
    // kills: ai-district-upgrade-interior (the interior test of the upgrade loop removed)
    const p = scene([10, 10]);
    const border = p.state.structures.add(STRUCT_CITY, 1, ROW + 99, 0); // touches the enemy at x = 100
    p.state.structures.level[border] = 10;
    p.cities.push(border);
    full(p);
    p.state.structures.districtLevel[districtIndex(border, 0)] = 1; // the only upgradeable district stands in the border City
    expect(ask(p, GOLD(1_000_000))?.kind).toBe('Build');
  });
});
