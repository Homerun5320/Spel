// Fix-5A2 (audit 4: findings 0.5 and 2.14b): the tight guards of readMatch (technology tail, winner, holdOwner) and of the helicopter load and fuel. A forged blob here
// is a VALID state with one illegal field, serialised afterwards, so the checksum is right and only the guard can refuse it. Every test has a control run with the
// neighbouring LEGAL value (it loads), so a test that passes for the wrong reason cannot hide. FORMAT_VERSION is unchanged: the guards are stricter, not new.
import { describe, expect, it } from 'vitest';
import { bindFederation } from '../../src/sim/diplomacy';
import { HELI_CRUISE } from '../../src/sim/heliTable';
import { HELI_FUEL_MAX_Q8, HELI_MAX_TROOPS, HELI_ROUTE_CAPACITY, TECH_STEPS, TECH_TICKS } from '../../src/sim/rules';
import { WIN_REASON_LAND, type WinConfig } from '../../src/sim/matchState';
import { deserialize, serialize } from '../../src/sim/serialize';
import { createState, rebuildAggregates, type GameState } from '../../src/sim/state';
import { STRUCT_FACTORY } from '../../src/sim/structureRules';
import { TECH_FX_FUEL, TECH_FX_LOAD } from '../../src/sim/techTable';
import { CLASS_PLAINS } from '../../src/sim/terrain';

const W = 64;
const H = 32;
const TICK = 1000;
const WIN: WinConfig = { land: true, last: false, score: false, timeLimitTicks: 100000, landSharePct: 60, holdTicks: 300 };
const AIR_MASK = 0xf << (2 * TECH_STEPS);

/** Two players (owners 1 and 2) and one tribe (owner 3); a land win with a hold timer; one helicopter of owner 2 in the air. */
function base(): GameState {
  const s = createState({ width: W, height: H, seed: 5, seats: 3, players: 2, config: { debugIntents: true, win: WIN }, terrain: new Uint8Array(W * H).fill(CLASS_PLAINS), elevation: new Uint16Array(W * H) });
  for (let c = 0; c < W * H; c++) s.owner[c] = c % W < 20 ? 1 : c % W < 40 ? 2 : c % W < 60 ? 3 : 0;
  rebuildAggregates(s);
  s.tick = TICK;
  s.structures.add(STRUCT_FACTORY, 2, 25, 0);
  const h = s.helis;
  const id = h.addBuilding(2, 0, 950, 700);
  h.state[id] = HELI_CRUISE;
  h.x[id] = 30 * 256 + 128;
  h.y[id] = 10 * 256 + 128;
  h.alt[id] = 100;
  h.hp[id] = 800;
  h.load[id] = 100;
  h.fuel[id] = 20000;
  h.mode[id] = 1;
  h.target[id] = 50 * 1 + 1;
  h.routeLen[id] = 1;
  h.routeIdx[id] = 0;
  h.route[id * HELI_ROUTE_CAPACITY] = 31 + 10 * W;
  return s;
}

const MAXELEV = new Int16Array(W * H);
function load(s: GameState): string {
  const r = deserialize(serialize(s), { maxElev: MAXELEV });
  return r.ok ? 'ok' : r.error;
}

describe('Fix-5A2: the technology tail of the match block', () => {
  const research = (s: GameState, owner: number, tech: number, done: number): void => {
    s.match.techCurrent[owner] = tech + 1;
    s.match.techDone[owner] = done;
  };

  it('techDone beyond tick + the research time is refused (a research that never finishes); the exact end loads', () => {
    const s = base();
    research(s, 1, 0, TICK + (TECH_TICKS[0] as number));
    expect(load(s)).toBe('ok');
    research(s, 1, 0, TICK + (TECH_TICKS[0] as number) + 1);
    expect(load(s)).toBe('match-range');
    research(s, 1, 0, 0xffffffff);
    expect(load(s)).toBe('match-range');
    // the bound is that of the tech under research, not of the longest one
    research(s, 1, 3, TICK + (TECH_TICKS[0] as number) + 1);
    s.match.setTechMask(1, 0b111);
    expect(load(s)).toBe('ok');
  });

  it('techDone in the past is refused (it would finish at once); now loads', () => {
    const s = base();
    research(s, 1, 0, TICK);
    expect(load(s)).toBe('ok');
    research(s, 1, 0, TICK - 1);
    expect(load(s)).toBe('match-range');
    research(s, 1, 0, 3);
    expect(load(s)).toBe('match-range');
  });

  it('a tribe has no techs and no running research; a player has', () => {
    const s = base();
    s.match.setTechMask(2, 0b1);
    research(s, 2, 1, TICK + 100);
    expect(load(s)).toBe('ok'); // the player owner 2
    const mask = base();
    mask.match.setTechMask(3, 0b1);
    expect(load(mask)).toBe('match-range');
    const cur = base();
    research(cur, 3, 0, TICK + 100);
    expect(load(cur)).toBe('match-range');
  });
});

describe('Fix-5A2: winner and holdOwner', () => {
  const ended = (s: GameState, winner: number): void => {
    s.match.ended = 1;
    s.match.winner = winner;
    s.match.reason = WIN_REASON_LAND;
    s.match.endTick = TICK;
  };

  it('the winner is a player, never a tribe', () => {
    const s = base();
    ended(s, 2);
    expect(load(s)).toBe('ok');
    ended(s, 3);
    expect(load(s)).toBe('match-range');
  });

  it('the land holder is a player, never a tribe', () => {
    const s = base();
    s.match.holdOwner = 2;
    s.match.holdCount = 5;
    expect(load(s)).toBe('ok');
    s.match.holdOwner = 3;
    expect(load(s)).toBe('match-range');
  });

  it('with a federation the land holder is a group ROOT (the lowest owner of the group), never another member', () => {
    const s = createState({ width: W, height: H, seed: 5, seats: 4, players: 3, config: { debugIntents: true, win: WIN }, terrain: new Uint8Array(W * H).fill(CLASS_PLAINS), elevation: new Uint16Array(W * H) });
    for (let c = 0; c < W * H; c++) s.owner[c] = c % W < 20 ? 1 : c % W < 40 ? 2 : c % W < 60 ? 3 : 0;
    rebuildAggregates(s);
    s.tick = TICK;
    bindFederation(s, 0, 1); // owners 1 and 2: the root is owner 1
    s.match.holdOwner = 1;
    s.match.holdCount = 5;
    expect(load(s)).toBe('ok');
    s.match.holdOwner = 3; // a seat outside the federation is its own root
    expect(load(s)).toBe('ok');
    s.match.holdOwner = 2;
    expect(load(s)).toBe('match-range');
  });
});

describe('Fix-5A2: helicopter load and fuel follow the OWNER\'s own techs (2.14b)', () => {
  const heli = (s: GameState): number => s.helis.highWater - 1;

  it('a seat without AIR techs cannot carry more than HELI_MAX_TROOPS; with them it can carry the researched maximum', () => {
    const s = base();
    s.helis.load[heli(s)] = HELI_MAX_TROOPS;
    expect(load(s)).toBe('ok');
    s.helis.load[heli(s)] = HELI_MAX_TROOPS + 1;
    expect(load(s)).toBe('air-range');
    s.match.setTechMask(2, AIR_MASK);
    const most = HELI_MAX_TROOPS + Math.floor((HELI_MAX_TROOPS * s.match.fx(2, TECH_FX_LOAD)) / 100);
    expect(most).toBeGreaterThan(HELI_MAX_TROOPS);
    s.helis.load[heli(s)] = most;
    expect(load(s)).toBe('ok');
    s.helis.load[heli(s)] = most + 1;
    expect(load(s)).toBe('air-range');
    // another seat's techs do not help the owner
    const other = base();
    other.match.setTechMask(1, AIR_MASK);
    other.helis.load[heli(other)] = HELI_MAX_TROOPS + 1;
    expect(load(other)).toBe('air-range');
  });

  it('a seat without AIR techs cannot hold more fuel than a full standard tank; with them it can hold the researched one', () => {
    const s = base();
    s.helis.fuel[heli(s)] = HELI_FUEL_MAX_Q8;
    expect(load(s)).toBe('ok');
    s.helis.fuel[heli(s)] = HELI_FUEL_MAX_Q8 + 1;
    expect(load(s)).toBe('air-range');
    s.match.setTechMask(2, AIR_MASK);
    const most = HELI_FUEL_MAX_Q8 + Math.floor((HELI_FUEL_MAX_Q8 * s.match.fx(2, TECH_FX_FUEL)) / 100);
    s.helis.fuel[heli(s)] = most;
    expect(load(s)).toBe('ok');
    s.helis.fuel[heli(s)] = most + 1;
    expect(load(s)).toBe('air-range');
  });
});
