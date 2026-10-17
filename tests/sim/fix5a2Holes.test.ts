// Fix-5A2 (audit 4, finding 2.1, 2.5 and the group rule of 2.6): test holes found by mutation. Each test names the mutant it kills; the table is in the Fix-5A2 block
// of docs/DECISIONS.md. Everything runs on small hand-made worlds through the real sim functions.
import { describe, expect, it } from 'vitest';
import { bindFederation } from '../../src/sim/diplomacy';
import { RELATION_ALLIANCE } from '../../src/sim/diplomacyTable';
import { regenMicroQtPerTick, ownerCapQt } from '../../src/sim/economy';
import { federationRoots } from '../../src/sim/groups';
import { fleetCapOf } from '../../src/sim/heliRules';
import { scrapOwnerHelis } from '../../src/sim/heliPhase';
import { HELI_CRUISE, HELI_PAD } from '../../src/sim/heliTable';
import { REJECT_BUILD_GOLD, REJECT_NONE, REJECT_TECH_GOLD, REJECT_TECH_ID } from '../../src/sim/intents';

import { OUTBOX_HELI_SCRAPPED } from '../../src/sim/outbox';
import { HELI_FLEET_MAX, MICRO_QT_PER_QT, MILLI_GOLD_PER_GOLD, TECH_COUNT, TECH_PRICE_GOLD, TECH_STEPS } from '../../src/sim/rules';
import { step } from '../../src/sim/step';
import { rebuildAggregates, type GameState } from '../../src/sim/state';
import { DISTRICT_MARKET, DISTRICT_WALLS } from '../../src/sim/districtRules';
import { collectWalls, structGoldMilliPerSec } from '../../src/sim/structureEffects';
import { marketGoldMilliAt, wallsCostPctAt, portGoldMilliAt } from '../../src/sim/levelCurves';
import { STRUCT_CITY, STRUCT_FACTORY, STRUCT_PORT, upgradePriceMilliFor, validateUpgrade } from '../../src/sim/structureRules';
import { TECH_FX_FLEET, TECH_FX_GOLD, TECH_FX_REGEN, TECH_FX_UPGRADE, TECH_FX_WALLS_POST, techCountOfMask, techFxOfMask } from '../../src/sim/techTable';
import { checkResearch } from '../../src/sim/techRules';
import { StateView } from '../../src/sim/view';
import { landState } from './helpers/worlds';

const W = 160;
const H = 64;
const at = (x: number, y: number): number => y * W + x;
const branchMask = (branch: number): number => 0xf << (branch * TECH_STEPS);
const ECON = 0;
const LAND = 1;
const AIR = 2;
const DEF = 3;

/** Seat 0 (owner 1) holds the left 80 columns, seat 1 (owner 2) the right 80; plain land, a tick far past every build time. */
function world(seats = 2): GameState {
  const s = landState(W, H, { seats, players: seats, seed: 5 });
  for (let c = 0; c < W * H; c++) s.owner[c] = c % W < 80 ? 1 : 2;
  rebuildAggregates(s);
  s.tick = 1000;
  return s;
}

describe('2.1: scrapOwnerHelis scraps only the eliminated owner', () => {
  it('three owners: owner 2 loses its helicopters, owners 1 and 3 keep theirs (airborne ones too), and exactly one SCRAPPED event names the right helicopter and state', () => {
    const s = landState(64, 32, { seats: 3, players: 3, seed: 5 });
    const f = [1, 2, 3].map((o, i) => s.structures.add(STRUCT_FACTORY, o, 2 * 64 + 2 + i * 10, 0));
    const h1 = s.helis.addBuilding(1, f[0] as number, 100, 120);
    const h2 = s.helis.addBuilding(2, f[1] as number, 100, 120);
    const h3 = s.helis.addBuilding(3, f[2] as number, 100, 120);
    s.helis.state[h1] = HELI_CRUISE; // an airborne helicopter of a bystander
    s.helis.state[h2] = HELI_PAD;
    s.helis.state[h3] = HELI_PAD;
    s.outbox.clear();
    scrapOwnerHelis(s, 2);
    expect([s.helis.owner[h1], s.helis.owner[h2], s.helis.owner[h3]]).toEqual([1, 0, 3]);
    expect(s.helis.liveCount).toBe(2);
    expect(s.helis.state[h1]).toBe(HELI_CRUISE);
    const events = s.outbox.drain().filter((e) => e.kind === OUTBOX_HELI_SCRAPPED);
    expect(events.length).toBe(1);
    expect(events[0]).toMatchObject({ a: h2, b: HELI_PAD, tick: s.tick });
  });
});

describe('2.5: technology effects with an exact value', () => {
  it('LAND: regeneration is exactly floor(rate * (100 + fx) / 100) (kills: rate * (100 + techRegen / 2))', () => {
    const s = world();
    s.match.setTechMask(1, branchMask(LAND));
    const fx = s.match.fx(1, TECH_FX_REGEN);
    expect(fx).toBeGreaterThan(0);
    s.troops[1] = Math.floor(ownerCapQt(s, 1) / 2);
    s.troopFrac[1] = 0;
    const before = s.troops[1] as number;
    const base = regenMicroQtPerTick(before, ownerCapQt(s, 1), false);
    expect(base).toBeGreaterThan(MICRO_QT_PER_QT); // at least one whole QT a tick, so the floor in the expectation does not hide the factor
    step(s, { turn: s.tick, intents: [] });
    const gained = ((s.troops[1] as number) - before) * MICRO_QT_PER_QT + (s.troopFrac[1] as number);
    expect(gained).toBe(Math.floor((base * (100 + fx)) / 100));
  });

  it('ECONOMY: a Market district earns +20 % with the techs (kills: the Market line without goldPct)', () => {
    const income = (mask: number, withMarket: boolean): number => {
      const s = world();
      s.match.setTechMask(1, mask);
      const city = s.structures.add(STRUCT_CITY, 1, at(10, 10), 0);
      if (withMarket) s.structures.setDistrict(city, 0, DISTRICT_MARKET, 3, 0, 0);
      return structGoldMilliPerSec(s, 1);
    };
    const market = marketGoldMilliAt(3);
    expect(income(0, true) - income(0, false)).toBe(market);
    const pct = techFxOfMask(branchMask(ECON), TECH_FX_GOLD);
    expect(pct).toBe(20);
    expect(income(branchMask(ECON), true) - income(branchMask(ECON), false)).toBe(market + Math.floor((market * pct) / 100));
  });

  it('ECONOMY: Port trade earns +20 % with the techs (kills: no goldPct line on tradeMilli)', () => {
    const income = (mask: number): number => {
      const s = world();
      s.match.setTechMask(1, mask);
      s.structures.add(STRUCT_PORT, 1, at(5, 5), 0);
      s.structures.add(STRUCT_PORT, 1, at(70, 5), 0); // 65 cells apart: beyond TRADE_MIN_DIST_CELLS, same owner
      return structGoldMilliPerSec(s, 1);
    };
    const base = portGoldMilliAt(1);
    const plain = income(0);
    const trade = (plain - 2 * base) / 2; // the trade of each of the two symmetric Ports
    expect(trade).toBeGreaterThan(10);
    expect(Number.isInteger(trade)).toBe(true);
    expect(income(branchMask(ECON))).toBe(plain + 2 * Math.floor((trade * 20) / 100));
  });

  it('DEFENCE: a Walls district is stronger by the Walls-and-Post percent (kills: wallPcts = wallPct)', () => {
    const s = world();
    s.match.setTechMask(2, branchMask(DEF));
    const city = s.structures.add(STRUCT_CITY, 2, at(120, 10), 0);
    s.structures.setDistrict(city, 0, DISTRICT_WALLS, 2, 0, 0);
    const boost = s.match.fx(2, TECH_FX_WALLS_POST);
    expect(boost).toBeGreaterThan(0);
    expect(collectWalls(s, 2)).toBe(1);
    const wall = wallsCostPctAt(2);
    expect(s.structures.wallPcts[0]).toBe(Math.floor((wall * (100 + boost)) / 100));
    expect(s.structures.wallPcts[0]).toBeGreaterThan(wall);
    // a seat without the techs gets the plain percent
    s.match.setTechMask(2, 0);
    collectWalls(s, 2);
    expect(s.structures.wallPcts[0]).toBe(wall);
  });

  it('ECONOMY: validateUpgrade (the Upgrade button) knows the discount: a purse between the two prices passes (kills: no techFxOfSeat argument)', () => {
    const s = world();
    s.match.setTechMask(1, branchMask(ECON));
    const factory = s.structures.add(STRUCT_FACTORY, 1, at(10, 10), 0);
    const level = s.structures.level[factory] as number;
    const discount = s.match.fx(1, TECH_FX_UPGRADE);
    expect(discount).toBeGreaterThan(0);
    const full = upgradePriceMilliFor(STRUCT_FACTORY, level + 1, 0);
    const cheap = upgradePriceMilliFor(STRUCT_FACTORY, level + 1, discount);
    expect(cheap).toBeLessThan(full);
    s.gold[1] = cheap;
    expect(validateUpgrade(new StateView(s), 0, factory)).toBe(REJECT_NONE);
    s.gold[1] = cheap - 1;
    expect(validateUpgrade(new StateView(s), 0, factory)).toBe(REJECT_BUILD_GOLD);
    // a seat without the techs needs the full price
    s.match.setTechMask(1, 0);
    s.gold[1] = cheap;
    expect(validateUpgrade(new StateView(s), 0, factory)).toBe(REJECT_BUILD_GOLD);
  });

  it('AIR: the +2 fleet bonus also applies when the Factories already reach HELI_FLEET_MAX (kills: return HELI_FLEET_MAX)', () => {
    const s = world();
    for (let i = 0; i < 6; i++) {
      const f = s.structures.add(STRUCT_FACTORY, 1, at(5 + i * 8, 20), 0);
      s.structures.level[f] = 5;
    }
    expect(fleetCapOf(s, 0)).toBe(HELI_FLEET_MAX);
    s.match.setTechMask(1, branchMask(AIR));
    expect(s.match.fx(1, TECH_FX_FLEET)).toBe(2);
    expect(fleetCapOf(s, 0)).toBe(HELI_FLEET_MAX + 2);
  });

  it('boundaries: research with exactly the price passes, one milli less is refused (kills: <= for <), tech TECH_COUNT and 1.5 are no tech, bit 15 counts', () => {
    const price = (TECH_PRICE_GOLD[0] as number) * MILLI_GOLD_PER_GOLD;
    expect(checkResearch(0, -1, price, false, false, false, 0)).toBe(REJECT_NONE);
    expect(checkResearch(0, -1, price - 1, false, false, false, 0)).toBe(REJECT_TECH_GOLD);
    expect(checkResearch(0, -1, price, false, false, false, TECH_COUNT)).toBe(REJECT_TECH_ID);
    expect(checkResearch(0, -1, price, false, false, false, TECH_COUNT - 1)).not.toBe(REJECT_TECH_ID);
    expect(checkResearch(0, -1, price, false, false, false, 1.5)).toBe(REJECT_TECH_ID);
    expect(techCountOfMask(1 << 15)).toBe(1);
    expect(techCountOfMask(0xffff)).toBe(TECH_COUNT);
    void [LAND, ECON];
  });
});

describe('2.6: groups', () => {
  it('an ordinary alliance (until 0) beside a federation forms no group (kills: dropping the ALLIANCE_FEDERATION condition in federationRoots)', () => {
    const s = landState(32, 32, { seats: 6, players: 6, seed: 5 });
    bindFederation(s, 0, 1);
    bindFederation(s, 1, 2);
    s.diplo.setRelation(4, 5, RELATION_ALLIANCE, 0); // owners 4 and 5 (seats 3 and 4): an ordinary alliance
    const roots = federationRoots(s) as Uint16Array;
    expect(roots).not.toBeNull();
    expect([roots[1], roots[2], roots[3]]).toEqual([1, 1, 1]);
    expect(roots[4]).toBe(4);
    expect(roots[5]).toBe(5);
    // control: no federation at all gives no groups, even with the ordinary alliance
    const plain = landState(32, 32, { seats: 6, players: 6, seed: 5 });
    plain.diplo.setRelation(4, 5, RELATION_ALLIANCE, 0);
    expect(federationRoots(plain)).toBeNull();
  });
});
