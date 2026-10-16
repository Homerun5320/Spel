// M18d-1: technology. Every test drives the real sim path (applyIntent / step / the real phases), so a rule removed from src/sim/techRules.ts, src/sim/tech.ts or one
// of the effect sites (economy, structureEffects, conquest, heliRules, heliFlight, airDefense) fails here. The mutants are tabulated in the M18d-1 block of docs/DECISIONS.md.
import { describe, expect, it } from 'vitest';
import { decodeIntent, decodeTurn, encodeIntent, encodeTurn } from '../../src/sim/codec';
import { airDefensePhase } from '../../src/sim/airDefense';
import { ownerCapQt } from '../../src/sim/economy';
import { heliFuelMaxQ8 } from '../../src/sim/heliFlight';
import { heliMaxTroopsOf, fleetCapOf } from '../../src/sim/heliRules';
import { HELI_DOWNED, HELI_HOVER, cellCentreQ8 } from '../../src/sim/heliTable';
import {
  cancelResearchBody,
  compareIntents,
  copyBody,
  kindCode,
  launchHeliBody,
  REJECT_HELI_BAD_TROOPS,
  REJECT_NONE,
  REJECT_PHASE,
  REJECT_TECH_BUSY,
  REJECT_TECH_DONE,
  REJECT_TECH_ELIMINATED,
  REJECT_TECH_GOLD,
  REJECT_TECH_ID,
  REJECT_TECH_MATCH_ENDED,
  REJECT_TECH_NOT_ACTIVE,
  REJECT_TECH_PREREQ,
  researchBody,
  validateIntent,
  withId,
  type Intent,
} from '../../src/sim/intents';
import {
  HELI_HP_TENTHS,
  HELI_MAX_TROOPS,
  MILLI_GOLD_PER_GOLD,
  QT_PER_TROOP,
  SAM_HIT_PCT,
  SAM_SALVO_PERIOD_TICKS,
  TECH_COUNT,
  TECH_FX,
  TECH_FX_CAP,
  TECH_FX_CHANNELS,
  TECH_PRICE_GOLD,
  TECH_STEPS,
  TECH_TICKS,
  HELI_FLEET_BASE,
} from '../../src/sim/rules';
import { deserialize, hashState, serialize } from '../../src/sim/serialize';
import { applyIntent, step } from '../../src/sim/step';
import { createState, rebuildAggregates, type GameState } from '../../src/sim/state';
import { structGoldMilliPerSec } from '../../src/sim/structureEffects';
import { STRUCT_CITY, STRUCT_POST } from '../../src/sim/structureRules';
import {
  TECH_ALL_MASK,
  TECH_FX_COST,
  TECH_FX_FLEET,
  TECH_FX_FUEL,
  TECH_FX_GOLD,
  TECH_FX_LOAD,
  TECH_FX_SAM_HIT,
  TECH_FX_SAM_SALVO,
  TECH_FX_SPEED,
  TECH_FX_UPGRADE,
  TECH_FX_WALLS_POST,
  TECH_FX_CAP_TROOPS,
  TECH_FX_REGEN,
  techBranchFxSum,
  techFxOfMask,
  techMaskValid,
} from '../../src/sim/techTable';
import { checkResearch, validateCancelResearch, validateResearch } from '../../src/sim/techRules';
import { CLASS_PLAINS } from '../../src/sim/terrain';
import { StateView } from '../../src/sim/view';
import { flyRaid, syntheticFixture, type Fixture } from '../../tools/sim/heliRaid';

const W = 128;
const H = 64;
const at = (x: number, y: number): number => y * W + x;
const GOLD = 100000 * MILLI_GOLD_PER_GOLD;
const ECON = 0;
const LAND = 1;
const AIR = 2;
const DEF = 3;
const branchMask = (branch: number): number => 0xf << (branch * TECH_STEPS);

/** Seat 0 (ownerId 1) owns the left 40 columns, seat 1 (ownerId 2) the right 40; the 48 columns between are free land. Both are rich. */
function world(config: { debugIntents: boolean; spawnPhase?: boolean } = { debugIntents: true }): GameState {
  const terrain = new Uint8Array(W * H).fill(CLASS_PLAINS);
  const s = createState({ width: W, height: H, seed: 5, seats: 2, config, terrain, elevation: new Uint16Array(W * H) });
  for (let c = 0; c < W * H; c++) s.owner[c] = c % W < 40 ? 1 : c % W >= W - 40 ? 2 : 0;
  rebuildAggregates(s);
  s.gold[1] = GOLD;
  s.gold[2] = GOLD;
  return s;
}

function copyOf(s: GameState): GameState {
  const r = deserialize(serialize(s));
  if (!r.ok) throw new Error(`copy failed: ${r.error}`);
  return r.state;
}

function idle(s: GameState, ticks: number): void {
  for (let i = 0; i < ticks; i++) expect(step(s, { turn: s.tick, intents: [] }).ok).toBe(true);
}

let nextId = 1;
/** The reason the state gives an intent (applyIntent: the very function step runs). */
function reasonOf(s: GameState, body: Parameters<typeof withId>[0]): number {
  return applyIntent(s, withId(body, nextId++));
}

/** Researches `tech` for `seat` through the real step and runs the clock until it is finished. */
function researchFully(s: GameState, seat: number, tech: number): void {
  step(s, { turn: s.tick, intents: [withId(researchBody(seat, tech), nextId++)] });
  idle(s, TECH_TICKS[tech]! - 1);
  expect(s.match.techMask[seat + 1]! & (1 << tech)).not.toBe(0);
}

/** A seat that has researched a whole branch through the real path (gold is topped up, so only the clock matters). */
function researchBranch(s: GameState, seat: number, branch: number): void {
  for (let step_ = 0; step_ < TECH_STEPS; step_++) {
    s.gold[seat + 1] = GOLD;
    researchFully(s, seat, branch * TECH_STEPS + step_);
  }
}

describe('the tree in rules.ts', () => {
  it('has 16 techs in four branches of four steps with rising prices and times, and a TECH_FX row per tech', () => {
    expect(TECH_COUNT).toBe(16);
    expect(TECH_PRICE_GOLD.length).toBe(TECH_COUNT);
    expect(TECH_TICKS.length).toBe(TECH_COUNT);
    expect(TECH_FX.length).toBe(TECH_COUNT * TECH_FX_CHANNELS);
    expect(TECH_FX_CAP.length).toBe(TECH_FX_CHANNELS);
    for (let b = 0; b < 4; b++) {
      for (let k = 1; k < TECH_STEPS; k++) {
        expect(TECH_PRICE_GOLD[b * 4 + k]!).toBeGreaterThan(TECH_PRICE_GOLD[b * 4 + k - 1]!);
        expect(TECH_TICKS[b * 4 + k]!).toBeGreaterThan(TECH_TICKS[b * 4 + k - 1]!);
      }
    }
  });

  it('the researched effect of each branch never passes the channel cap, and all 16 researched give each channel exactly its cap', () => {
    const channelsOfBranch: Record<number, number[]> = {
      [ECON]: [TECH_FX_GOLD, TECH_FX_UPGRADE],
      [LAND]: [TECH_FX_COST, TECH_FX_REGEN, TECH_FX_CAP_TROOPS],
      [AIR]: [TECH_FX_LOAD, TECH_FX_SPEED, TECH_FX_FUEL, TECH_FX_FLEET, TECH_FX_SAM_HIT],
      [DEF]: [TECH_FX_WALLS_POST, TECH_FX_SAM_SALVO],
    };
    for (let branch = 0; branch < 4; branch++) {
      const mask = branchMask(branch);
      for (let ch = 0; ch < TECH_FX_CHANNELS; ch++) {
        const raw = techBranchFxSum(mask, branch, ch);
        expect(raw, `branch ${branch} channel ${ch}`).toBeLessThanOrEqual(TECH_FX_CAP[ch]!);
        expect(techFxOfMask(mask, ch)).toBeLessThanOrEqual(TECH_FX_CAP[ch]!);
        // a channel belongs to exactly one branch: the other branches add nothing to it
        expect(raw > 0, `branch ${branch} channel ${ch} owner`).toBe(channelsOfBranch[branch]!.includes(ch));
      }
    }
    for (let ch = 0; ch < TECH_FX_CHANNELS; ch++) expect(techFxOfMask(TECH_ALL_MASK, ch)).toBe(TECH_FX_CAP[ch]);
    expect(techFxOfMask(0, TECH_FX_GOLD)).toBe(0);
  });

  it('the effect per step: ECONOMY gold 5, 5, 12, 20; the first step of every other branch is small', () => {
    expect([0, 1, 2, 3].map((k) => techFxOfMask((1 << (k + 1)) - 1, TECH_FX_GOLD))).toEqual([5, 5, 12, 20]);
    expect([0, 1, 2, 3].map((k) => techFxOfMask((1 << (4 + k + 1)) - (1 << 4), TECH_FX_COST))).toEqual([4, 4, 9, 15]);
    expect(techMaskValid(0b10)).toBe(false); // step 2 without step 1
    expect(techMaskValid(0b11)).toBe(true);
    expect(techMaskValid(TECH_ALL_MASK)).toBe(true);
    expect(techMaskValid(1 << 16)).toBe(false);
  });
});

describe('Research and CancelResearch: every reason code (the real applyIntent path)', () => {
  it('REJECT_TECH_ID (shape and rule), REJECT_TECH_PREREQ, REJECT_TECH_DONE, REJECT_TECH_BUSY, REJECT_TECH_GOLD, REJECT_TECH_MATCH_ENDED, REJECT_TECH_ELIMINATED, REJECT_PHASE, REJECT_TECH_NOT_ACTIVE', () => {
    const ctx = { seats: 2, cells: W * H, debugIntents: true };
    expect(validateIntent(withId(researchBody(0, TECH_COUNT), 1), ctx)).toBe(REJECT_TECH_ID);
    expect(validateIntent(withId(researchBody(0, -1), 1), ctx)).toBe(REJECT_TECH_ID);
    expect(validateIntent(withId(researchBody(0, 1.5), 1), ctx)).toBe(REJECT_TECH_ID);
    expect(validateIntent(withId(researchBody(0, 15), 1), ctx)).toBe(REJECT_NONE);
    expect(validateIntent(withId(cancelResearchBody(0), 1), ctx)).toBe(REJECT_NONE);
    const s = world();
    expect(reasonOf(s, researchBody(0, 99))).toBe(REJECT_TECH_ID); // the rule itself, past the shape check
    expect(reasonOf(s, researchBody(0, 1))).toBe(REJECT_TECH_PREREQ);
    expect(reasonOf(s, researchBody(0, 7))).toBe(REJECT_TECH_PREREQ);
    expect(reasonOf(s, cancelResearchBody(0))).toBe(REJECT_TECH_NOT_ACTIVE);
    s.gold[1] = TECH_PRICE_GOLD[0]! * MILLI_GOLD_PER_GOLD - 1;
    expect(reasonOf(s, researchBody(0, 0))).toBe(REJECT_TECH_GOLD);
    s.gold[1] = GOLD;
    expect(reasonOf(s, researchBody(0, 0))).toBe(REJECT_NONE);
    expect(reasonOf(s, researchBody(0, 4))).toBe(REJECT_TECH_BUSY);
    expect(reasonOf(s, researchBody(0, 0))).toBe(REJECT_TECH_BUSY);
    expect(reasonOf(s, cancelResearchBody(0))).toBe(REJECT_NONE);
    s.match.setTechMask(1, 0b1);
    expect(reasonOf(s, researchBody(0, 0))).toBe(REJECT_TECH_DONE);
    expect(reasonOf(s, researchBody(0, 1))).toBe(REJECT_NONE);
    s.match.eliminated[2] = 1;
    expect(reasonOf(s, researchBody(1, 0))).toBe(REJECT_TECH_ELIMINATED);
    s.match.ended = 1;
    expect(reasonOf(s, researchBody(0, 4))).toBe(REJECT_TECH_MATCH_ENDED);
    const early = world({ debugIntents: true, spawnPhase: true });
    expect(reasonOf(early, researchBody(0, 0))).toBe(REJECT_PHASE);
    expect(reasonOf(early, cancelResearchBody(0))).toBe(REJECT_PHASE);
  });

  it('validateResearch / validateCancelResearch (the page\'s answer on a SimView) equal the sim\'s answer for every tech in several states', () => {
    const s = world();
    const view = new StateView(s);
    const check = (): void => {
      view.refresh();
      for (let tech = -1; tech <= TECH_COUNT; tech++) {
        const probe = copyOf(s);
        expect(validateResearch(view, 0, tech), `tech ${tech} at tick ${s.tick}`).toBe(applyIntent(probe, withId(researchBody(0, tech), 1)));
      }
      const probe = copyOf(s);
      expect(validateCancelResearch(view, 0)).toBe(applyIntent(probe, withId(cancelResearchBody(0), 1)));
    };
    check();
    s.gold[1] = 400 * MILLI_GOLD_PER_GOLD;
    check();
    step(s, { turn: s.tick, intents: [withId(researchBody(0, 0), nextId++)] });
    check();
    idle(s, TECH_TICKS[0]!);
    check();
    s.match.ended = 1;
    check();
  });

  it('checkResearch has the documented order (mutating it would change one of these)', () => {
    expect(checkResearch(0, -1, 0, true, true, true, 99)).toBe(REJECT_TECH_ID);
    expect(checkResearch(0, -1, 0, true, true, true, 0)).toBe(REJECT_TECH_MATCH_ENDED);
    expect(checkResearch(0, -1, 0, true, false, true, 0)).toBe(REJECT_TECH_ELIMINATED);
    expect(checkResearch(0, -1, 0, true, false, false, 0)).toBe(REJECT_PHASE);
    expect(checkResearch(1, 0, 0, false, false, false, 0)).toBe(REJECT_TECH_DONE);
    expect(checkResearch(0, 0, 0, false, false, false, 1)).toBe(REJECT_TECH_PREREQ);
    expect(checkResearch(0, 3, 0, false, false, false, 0)).toBe(REJECT_TECH_BUSY);
    expect(checkResearch(0, -1, 0, false, false, false, 0)).toBe(REJECT_TECH_GOLD);
    expect(checkResearch(0, -1, GOLD, false, false, false, 0)).toBe(REJECT_NONE);
  });
});

describe('the price, the clock and the chain', () => {
  it('the price leaves the purse when the research STARTS and nothing more happens at the finish', () => {
    const a = world();
    const b = copyOf(a);
    step(a, { turn: a.tick, intents: [withId(researchBody(0, 0), nextId++)] });
    step(b, { turn: b.tick, intents: [] });
    const price = TECH_PRICE_GOLD[0]! * MILLI_GOLD_PER_GOLD;
    expect((b.gold[1] as number) - (a.gold[1] as number)).toBe(price);
    // The whole research: the gap stays the price (no second charge, no refund) and the first tech is there at the end.
    for (let i = 0; i < TECH_TICKS[0]! + 5; i++) {
      step(a, { turn: a.tick, intents: [] });
      step(b, { turn: b.tick, intents: [] });
      expect((b.gold[1] as number) - (a.gold[1] as number), `tick ${a.tick}`).toBe(price);
    }
    expect(a.match.techMask[1]).toBe(1);
  });

  it('is finished at the exact tick: started in the step of tick T, researched when the clock reads T + TECH_TICKS', () => {
    const s = world();
    idle(s, 17);
    const start = s.tick;
    step(s, { turn: s.tick, intents: [withId(researchBody(0, 0), nextId++)] });
    expect(s.match.techCurrent[1]).toBe(1);
    expect(s.match.techDone[1]).toBe(start + TECH_TICKS[0]!);
    while (s.tick < start + TECH_TICKS[0]!) {
      expect(s.match.techMask[1], `tick ${s.tick}`).toBe(0);
      step(s, { turn: s.tick, intents: [] });
    }
    expect(s.tick).toBe(start + TECH_TICKS[0]!);
    expect(s.match.techMask[1]).toBe(1);
    expect(s.match.techCurrent[1]).toBe(0);
    expect(s.match.techDone[1]).toBe(0);
    expect(s.match.fx(1, TECH_FX_GOLD)).toBe(5);
  });

  it('the chain: a step is refused until the one before it is researched, and the four steps of a branch go in order', () => {
    const s = world();
    for (let k = 1; k < TECH_STEPS; k++) expect(reasonOf(s, researchBody(0, AIR * 4 + k))).toBe(REJECT_TECH_PREREQ);
    researchBranch(s, 0, AIR);
    expect(s.match.techMask[1]).toBe(branchMask(AIR));
    expect(reasonOf(s, researchBody(0, AIR * 4))).toBe(REJECT_TECH_DONE);
    expect(reasonOf(s, researchBody(0, DEF * 4 + 1))).toBe(REJECT_TECH_PREREQ);
  });

  it('CancelResearch stops the clock and refunds nothing; another research can start at once', () => {
    const s = world();
    const before = s.gold[1] as number;
    step(s, { turn: s.tick, intents: [withId(researchBody(0, 0), nextId++)] });
    const afterStart = s.gold[1] as number;
    step(s, { turn: s.tick, intents: [withId(cancelResearchBody(0), nextId++)] });
    expect(s.match.techCurrent[1]).toBe(0);
    expect(s.match.techDone[1]).toBe(0);
    expect((s.gold[1] as number) - afterStart).toBeLessThan(5000); // only the income of a tick, no price back
    expect(before - afterStart).toBeGreaterThan(TECH_PRICE_GOLD[0]! * MILLI_GOLD_PER_GOLD - 5000);
    idle(s, TECH_TICKS[0]!);
    expect(s.match.techMask[1]).toBe(0);
    expect(reasonOf(s, researchBody(0, 4))).toBe(REJECT_NONE);
  });
});

describe('the codec and the canonical order', () => {
  it('Research and CancelResearch round-trip on the wire as kinds 21 and 22, and copyBody keeps the field', () => {
    expect(kindCode('Research')).toBe(21);
    expect(kindCode('CancelResearch')).toBe(22);
    const a = withId(researchBody(3, 12), 77);
    const b = withId(cancelResearchBody(3), 78);
    expect(decodeIntent(encodeIntent(a))).toEqual({ ok: true, value: a });
    expect(decodeIntent(encodeIntent(b))).toEqual({ ok: true, value: b });
    const turn = { turn: 5, intents: [a, b] as Intent[] };
    expect(decodeTurn(encodeTurn(turn))).toEqual({ ok: true, value: turn });
    expect(copyBody({ kind: 'Research', seat: 1, tech: 7, extra: 1 })).toEqual({ kind: 'Research', seat: 1, tech: 7 });
    expect(copyBody({ kind: 'CancelResearch', seat: 1 })).toEqual({ kind: 'CancelResearch', seat: 1 });
    expect(compareIntents(withId(researchBody(0, 2), 1), withId(researchBody(0, 3), 1))).toBeLessThan(0);
  });
});

describe('the effects work in the sim (real paths), one branch at a time', () => {
  it('ECONOMY: +20 % on City income and a 15 % cheaper upgrade after the four steps, through real research', () => {
    const s = world();
    const city = s.structures.add(STRUCT_CITY, 1, at(10, 10), 0);
    idle(s, 200);
    const plain = copyOf(s);
    const baseIncome = structGoldMilliPerSec(plain, 1);
    expect(baseIncome).toBeGreaterThan(0);
    researchBranch(s, 0, ECON);
    expect(s.match.fx(1, TECH_FX_GOLD)).toBe(20);
    expect(s.match.fx(1, TECH_FX_UPGRADE)).toBe(15);
    const income = structGoldMilliPerSec(s, 1);
    expect(income).toBe(baseIncome + Math.floor((baseIncome * 20) / 100));
    expect(structGoldMilliPerSec(s, 2)).toBe(0); // the other seat has nothing researched and no structures
    // The upgrade price: the same Upgrade on the researched state and on a plain twin of it differ by exactly 15 %.
    const twin = copyOf(s);
    twin.match.setTechMask(1, 0);
    twin.structures.effDirty = true;
    s.gold[1] = GOLD;
    twin.gold[1] = GOLD;
    expect(reasonOf(s, { kind: 'Upgrade', seat: 0, structure: city })).toBe(REJECT_NONE);
    expect(reasonOf(twin, { kind: 'Upgrade', seat: 0, structure: city })).toBe(REJECT_NONE);
    const paid = GOLD - (s.gold[1] as number);
    const paidPlain = GOLD - (twin.gold[1] as number);
    expect(paid).toBe(Math.floor((paidPlain * 85) / 100));
  });

  it('LAND: the attacker pays at most 15 % less per cell, the troop cap is 15 % higher, regeneration is faster', () => {
    const a = world();
    const b = world();
    b.match.setTechMask(1, branchMask(LAND));
    a.troops[1] = 200000;
    b.troops[1] = 200000;
    const send = (s: GameState): number => {
      step(s, { turn: s.tick, intents: [withId({ kind: 'Attack', seat: 0, target: 0, pct: 50 }, nextId++)] });
      const start = s.attacks.list[0]!.troops;
      const takenBefore = s.match.conquered[1]!;
      idle(s, 60);
      const left = s.attacks.list[0]!.troops;
      const taken = s.match.conquered[1]! - takenBefore;
      expect(taken).toBeGreaterThan(50);
      return (start - left) / taken;
    };
    const costPlain = send(a);
    const costTech = send(b);
    expect(costTech / costPlain).toBeGreaterThan(0.8);
    expect(costTech / costPlain).toBeLessThan(0.9); // 15 % off: 0.85
    expect(ownerCapQt(b, 1)).toBeGreaterThan(ownerCapQt(world(), 1));
    const c = world();
    const d = world();
    d.match.setTechMask(1, branchMask(LAND));
    expect(ownerCapQt(d, 1)).toBe(Math.floor((ownerCapQt(c, 1) * 115) / 100));
    c.troops[1] = 40000;
    d.troops[1] = 40000;
    idle(c, 100);
    idle(d, 100);
    expect((d.troops[1] as number) - 40000).toBeGreaterThan(((c.troops[1] as number) - 40000) * 1.05);
  });

  it('AIR: +25 % load (a real LaunchHeli of 700 troops is refused without the techs and passes the troop check with them), +2 in the fleet cap, +25 % fuel', () => {
    const a = syntheticFixture('plains-sam', 3);
    const b = syntheticFixture('plains-sam', 3);
    b.state.match.setTechMask(1, branchMask(AIR));
    for (const fx of [a, b]) fx.state.troops[1] = 5000 * QT_PER_TROOP;
    expect(HELI_MAX_TROOPS).toBe(600);
    const launch = (fx: Fixture, troops: number): number => {
      fx.state.outbox.clear();
      step(fx.state, { turn: fx.state.tick, intents: [withId(launchHeliBody(0, fx.factory, fx.lz, troops, 0), nextId++)] });
      const refused = fx.state.outbox.drain().filter((e) => e.kind === 2);
      return refused.length === 0 ? REJECT_NONE : refused[0]!.a;
    };
    expect(launch(a, 700)).toBe(REJECT_HELI_BAD_TROOPS);
    expect(launch(b, 750)).toBe(REJECT_NONE);
    expect(launch(b, 751)).not.toBe(REJECT_NONE);
    expect(heliMaxTroopsOf(b.state, 0)).toBe(750);
    expect(heliMaxTroopsOf(a.state, 0)).toBe(600);
    expect(fleetCapOf(b.state, 0)).toBe(fleetCapOf(a.state, 0) + 2);
    expect(fleetCapOf(a.state, 0)).toBeGreaterThanOrEqual(HELI_FLEET_BASE);
    expect(heliFuelMaxQ8(b.state, 1)).toBe(Math.floor((heliFuelMaxQ8(a.state, 1) * 125) / 100));
    expect(b.state.helis.fuel[b.heli]).toBe(heliFuelMaxQ8(b.state, 1)); // a launched helicopter starts with the researched tank
  });

  it('AIR: the helicopter flies 15 % faster (the same launch, the same ticks, the distance flown)', () => {
    const a = syntheticFixture('plains-sam', 3);
    const b = syntheticFixture('plains-sam', 3);
    b.state.match.setTechMask(1, branchMask(AIR));
    const flown = (fx: Fixture): number => {
      const s = fx.state;
      s.troops[1] = 5000 * QT_PER_TROOP;
      const x0 = s.helis.x[fx.heli]!;
      step(s, { turn: s.tick, intents: [withId(launchHeliBody(0, fx.factory, fx.lz, 100, 1), nextId++)] });
      idle(s, 120);
      return Math.abs(s.helis.x[fx.heli]! - x0);
    };
    const da = flown(a);
    const db = flown(b);
    expect(da).toBeGreaterThan(0);
    expect(db / da).toBeGreaterThan(1.1);
    expect(db / da).toBeLessThan(1.2);
  });

  it('AIR and DEFENCE: a SAM site hits 10 points more often (AIR) and fires 25 % more often (DEFENCE), measured on real salvos', () => {
    const run = (mask: number, rolls: number): { hits: number; period: number } => {
      const fx = syntheticFixture('ridge-sam', 7);
      const s = fx.state;
      s.match.setTechMask(2, mask); // the SAM site belongs to ownerId 2
      const sam = fx.sams[0] as number;
      const id = fx.heli;
      const put = (): void => {
        s.helis.state[id] = HELI_HOVER;
        s.helis.x[id] = cellCentreQ8(92);
        s.helis.y[id] = cellCentreQ8(48);
        s.helis.mode[id] = 1;
        s.helis.hp[id] = HELI_HP_TENTHS;
        s.helis.load[id] = 100;
        s.helis.alt[id] = 400;
        s.helis.target[id] = 0;
      };
      put();
      let hits = 0;
      for (let i = 0; i < rolls; i++) {
        s.structures.salvoTick[sam] = 0;
        airDefensePhase(s);
        s.tick++;
        if (s.helis.state[id] === HELI_DOWNED) {
          hits++;
          put();
        }
      }
      // The salvo clock after one salvo: tick + the researched period.
      s.structures.salvoTick[sam] = 0;
      put();
      const t0 = s.tick;
      airDefensePhase(s);
      return { hits, period: (s.structures.salvoTick[sam] as number) - t0 };
    };
    const plain = run(0, 6000);
    const air = run(branchMask(AIR), 6000);
    const def = run(branchMask(DEF), 100);
    expect(plain.period).toBe(SAM_SALVO_PERIOD_TICKS);
    expect(def.period).toBe(SAM_SALVO_PERIOD_TICKS - Math.floor((SAM_SALVO_PERIOD_TICKS * 25) / 100));
    expect(air.period).toBe(SAM_SALVO_PERIOD_TICKS);
    expect(plain.hits / 6000).toBeGreaterThan((SAM_HIT_PCT - 3) / 100);
    expect(plain.hits / 6000).toBeLessThan((SAM_HIT_PCT + 3) / 100);
    expect(air.hits / 6000).toBeGreaterThan((SAM_HIT_PCT + 10 - 3) / 100);
    expect(air.hits / 6000).toBeLessThan((SAM_HIT_PCT + 10 + 3) / 100);
  });

  it('DEFENCE: a Defense Post is 25 % stronger for its owner (the attacker pays 25 % more per cell around it), and nothing changes for a seat that has not researched it', () => {
    const pay = (maskOfOwner2: number): number => {
      const s = world();
      // Seat 1 (ownerId 2) holds a 10 x 10 patch at x 70..79, y 5..14 with a finished Post in the middle; seat 0 holds everything left of it.
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) s.owner[at(x, y)] = x < 70 ? 1 : x < 80 && y >= 5 && y < 15 ? 2 : 0;
      rebuildAggregates(s);
      const post = s.structures.add(STRUCT_POST, 2, at(75, 10), 0);
      s.structures.readyTick[post] = 0;
      s.match.setTechMask(2, maskOfOwner2);
      s.troops[1] = 400000;
      step(s, { turn: s.tick, intents: [withId({ kind: 'Attack', seat: 0, target: 2, pct: 80 }, nextId++)] });
      const start = s.attacks.list[0]!.troops;
      const takenBefore = s.match.conquered[1]!;
      idle(s, 12);
      const taken = s.match.conquered[1]! - takenBefore;
      expect(taken).toBeGreaterThan(4);
      return (start - s.attacks.list[0]!.troops) / taken;
    };
    const plain = pay(0);
    const boosted = pay(branchMask(DEF));
    expect(boosted / plain).toBeGreaterThan(1.15);
    expect(boosted / plain).toBeLessThan(1.35); // 3.125 / 2.5 = 1.25
    expect(pay(branchMask(ECON)) / plain).toBeGreaterThan(0.97); // other branches do not touch the Post
    expect(pay(branchMask(ECON)) / plain).toBeLessThan(1.03);
  });
});

describe('state: serialisation, the straight run and the hash', () => {
  it('a snapshot with a running and a finished research continues exactly like the straight run, and the tech arrays are in the hash', () => {
    const s = world();
    s.structures.add(STRUCT_CITY, 1, at(10, 10), 0);
    researchFully(s, 0, 0);
    researchFully(s, 0, 1);
    step(s, { turn: s.tick, intents: [withId(researchBody(0, 2), nextId++), withId(researchBody(1, 4), nextId++)] });
    idle(s, 50);
    const bytes = serialize(s);
    const r = deserialize(bytes);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const t = r.state;
    expect(hashState(t)).toBe(hashState(s));
    expect(t.match.techMask[1]).toBe(0b11);
    expect(t.match.techCurrent[1]).toBe(3);
    expect(t.match.techDone[1]).toBe(s.match.techDone[1]);
    expect(t.match.fx(1, TECH_FX_GOLD)).toBe(s.match.fx(1, TECH_FX_GOLD));
    for (let i = 0; i < 1300; i++) {
      step(s, { turn: s.tick, intents: [] });
      step(t, { turn: t.tick, intents: [] });
    }
    expect(hashState(t)).toBe(hashState(s));
    expect(t.match.techMask[1]).toBe(0b111);
    expect(structGoldMilliPerSec(t, 1)).toBe(structGoldMilliPerSec(s, 1));
    // The hash sees every one of the three arrays.
    const base = hashState(s);
    const m = s.match;
    const keep = [m.techMask[2]!, m.techCurrent[2]!, m.techDone[2]!];
    const pokes: Array<() => void> = [() => (m.techMask[2] = keep[0]! ^ 1), () => (m.techCurrent[2] = keep[1]! + 1), () => (m.techDone[2] = keep[2]! + 9)];
    for (const poke of pokes) {
      poke();
      expect(hashState(s)).not.toBe(base);
      m.techMask[2] = keep[0]!;
      m.techCurrent[2] = keep[1]!;
      m.techDone[2] = keep[2]!;
      expect(hashState(s)).toBe(base);
    }
  });

  it('deserialize refuses an open mask, a research that is already researched, a finish tick without a research and a research with no predecessor (a valid checksum: only the guard refuses)', () => {
    const base = world();
    expect(deserialize(serialize(base)).ok).toBe(true);
    const refused = (poke: (m: GameState['match']) => void): string => {
      const s = copyOf(base);
      poke(s.match);
      const r = deserialize(serialize(s));
      return r.ok ? 'ok' : r.error;
    };
    expect(refused((m) => (m.techMask[1] = 0b10))).toBe('match-range'); // step 2 without step 1
    expect(refused((m) => (m.techMask[1] = 0b11))).toBe('ok'); // control: a closed mask is fine
    expect(refused((m) => ((m.techCurrent[1] = 1), (m.techDone[1] = 500)))).toBe('ok'); // control: a running research
    expect(refused((m) => ((m.techMask[1] = 1), (m.techCurrent[1] = 1), (m.techDone[1] = 500)))).toBe('match-range'); // researching what is researched
    expect(refused((m) => ((m.techCurrent[1] = 2), (m.techDone[1] = 500)))).toBe('match-range'); // step 2 without step 1
    expect(refused((m) => (m.techDone[1] = 500))).toBe('match-range'); // a finish tick without a research
    expect(refused((m) => (m.techCurrent[1] = 1))).toBe('match-range'); // a research without a finish tick
    expect(refused((m) => ((m.techCurrent[1] = 17), (m.techDone[1] = 500)))).toBe('match-range'); // no such tech
    expect(refused((m) => (m.techMask[0] = 1))).toBe('match-range'); // slot 0 is the unowned pseudo-owner
  });
});
