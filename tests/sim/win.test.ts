// M18-1: the match end. Hold timer, last alive, score and its tiebreak, the overtime curve, the anti-snowball discount at its exact thresholds,
// elimination, the statistics against an independent recount, serialisation of a finished match. Worlds are tiny and have UNIFORM cell weights
// (every row weight is WEIGHT_ONE), so a share is a plain cell count: 400 cells, 25 percent = exactly 100 cells.
import { describe, expect, it } from 'vitest';
import { advanceAttack } from '../../src/sim/conquest';
import { hash2 } from '../../src/sim/fixture';
import { fillMatchView, matchPackedLength, matchViewOf } from '../../src/sim/matchView';
import { WIN_REASON_LAND, WIN_REASON_LAST, WIN_REASON_SCORE, type WinConfig } from '../../src/sim/matchState';
import { OUTBOX_ELIMINATED, OUTBOX_MATCH_END } from '../../src/sim/outbox';
import * as pub from '../../src/sim/public';
import {
  BUILD_TICKS,
  LEADER_COST_PCT_HIGH,
  LEADER_COST_PCT_MID,
  LEADER_LAND_PCT_HIGH,
  LEADER_LAND_PCT_MID,
  POST_COST_DEN,
  POST_COST_NUM,
  SPAWN_PHASE_TICKS,
  WEIGHT_ONE,
} from '../../src/sim/rules';
import { deserialize, hashState, serialize } from '../../src/sim/serialize';
import { createState, type GameState } from '../../src/sim/state';
import { step } from '../../src/sim/step';
import { STRUCT_CITY, STRUCT_FACTORY, STRUCT_POST } from '../../src/sim/structureRules';
import { setOwner } from '../../src/sim/territory';
import { CLASS_PLAINS } from '../../src/sim/terrain';
import { StateView } from '../../src/sim/view';
import { leaderCostPct, requiredLandPct } from '../../src/sim/win';
import { MatchDriver, randomBodies, randomMatchState, RH, RW } from './helpers/randomMatch';

const W = 20;
const H = 20;
const CELLS = W * H;

const WIN_ALL: WinConfig = { land: true, last: true, score: true, timeLimitTicks: 1000, landSharePct: 60, holdTicks: 300 };
const only = (k: 'land' | 'last' | 'score', extra: Partial<WinConfig> = {}): WinConfig => ({ land: false, last: false, score: false, timeLimitTicks: 1000, landSharePct: 60, holdTicks: 300, ...extra, [k]: true });

/** A 20 x 20 plain with uniform weights; `seats` seats of which `players` are players. */
function world(seats: number, players: number, win?: WinConfig, flow = false): GameState {
  return createState({
    width: W,
    height: H,
    seed: 5,
    seats,
    players,
    rowCos: new Uint16Array(H).fill(WEIGHT_ONE),
    config: { debugIntents: true, spawnPhase: flow, ...(win === undefined ? {} : { win }) },
    terrain: new Uint8Array(CELLS).fill(CLASS_PLAINS),
    elevation: new Uint16Array(CELLS),
  });
}

/** Gives `owner` the cells with index in [from, to). */
function paint(s: GameState, owner: number, from: number, to: number): void {
  for (let c = from; c < to; c++) setOwner(s, c, owner, 0);
}

function tick(s: GameState, n = 1): void {
  for (let i = 0; i < n; i++) expect(step(s, { turn: s.tick, intents: [] }).ok).toBe(true);
}

describe('the overtime curve (a pure function)', () => {
  const minute = 600;
  it('asks for the base share up to minute 21 and one point less for every whole minute after', () => {
    expect(requiredLandPct(60, 0)).toBe(60);
    expect(requiredLandPct(60, 20 * minute)).toBe(60);
    expect(requiredLandPct(60, 21 * minute - 1)).toBe(60);
    expect(requiredLandPct(60, 21 * minute)).toBe(59);
    expect(requiredLandPct(60, 22 * minute - 1)).toBe(59);
    expect(requiredLandPct(60, 22 * minute)).toBe(58);
    expect(requiredLandPct(60, 40 * minute)).toBe(40);
  });
  it('never falls below the floor', () => {
    expect(requiredLandPct(60, 500 * minute)).toBe(1);
    expect(requiredLandPct(3, 30 * minute)).toBe(1);
  });
});

describe('condition (a): hold the land share', () => {
  it('ends exactly when the 300th consecutive tick at the share has passed (60 percent counts, >=)', () => {
    const s = world(2, 2, only('land'));
    paint(s, 1, 0, 240); // exactly 60 percent
    tick(s, 299);
    expect(s.match.ended).toBe(0);
    tick(s);
    expect(s.match.ended).toBe(1);
    expect(s.match.winner).toBe(1);
    expect(s.match.reason).toBe(WIN_REASON_LAND);
    expect(s.match.endTick).toBe(300);
  });
  it('is reset by a dip below the requirement: 59 percent for one tick starts the count again', () => {
    const s = world(2, 2, only('land'));
    paint(s, 1, 0, 240);
    tick(s, 200);
    setOwner(s, 239, 0, 0); // 239 cells = 59.75 percent
    tick(s, 1);
    expect(s.match.holdCount).toBe(0);
    setOwner(s, 239, 1, 0);
    tick(s, 299);
    expect(s.match.ended).toBe(0); // 299 ticks since the dip, a timer that was not reset would have ended long ago
    tick(s);
    expect(s.match.ended).toBe(1);
    expect(s.match.endTick).toBe(200 + 1 + 300);
  });
  it('the holder keeps the timer while it still meets the requirement, even if another nation also qualifies and has more', () => {
    const s = world(2, 2, only('land', { landSharePct: 40, holdTicks: 50 }));
    paint(s, 1, 0, 160); // exactly 40 percent
    paint(s, 2, 200, 300);
    tick(s, 3);
    expect(s.match.holdOwner).toBe(1);
    paint(s, 2, 300, 400); // seat 2 now holds 50 percent, seat 1 still exactly 40
    tick(s, 3);
    expect(s.match.holdOwner).toBe(1);
    expect(s.match.holdCount).toBe(6);
  });
  it('59.75 percent never wins', () => {
    const s = world(2, 2, only('land'));
    paint(s, 1, 0, 239);
    tick(s, 700);
    expect(s.match.ended).toBe(0);
  });
  it('a tribe never wins by land, and a player must be a player seat', () => {
    const s = world(3, 2, only('land'));
    paint(s, 3, 0, 300); // the tribe holds 75 percent
    tick(s, 400);
    expect(s.match.ended).toBe(0);
  });
  it('the requirement falls in overtime: 59 percent wins from minute 21 on', () => {
    const s = world(2, 2, only('land', { holdTicks: 5, timeLimitTicks: 100000 }));
    paint(s, 1, 0, 236); // 59 percent
    tick(s, 21 * 600 - 1);
    expect(s.match.ended).toBe(0);
    tick(s, 5);
    expect(s.match.ended).toBe(1);
    expect(s.match.winner).toBe(1);
  });
  it('the match clock starts when the spawn phase ends', () => {
    const s = world(2, 2, only('land', { holdTicks: 5, timeLimitTicks: 100000 }), true);
    paint(s, 1, 0, 236);
    tick(s, 21 * 600 + SPAWN_PHASE_TICKS - 1);
    expect(s.match.ended).toBe(0); // would be minute 21 if the clock started at tick 0
  });
});

describe('condition (b): last alive and elimination', () => {
  it('a nation that spawned and owns no cell is eliminated (flag + event); the match goes on while two live', () => {
    const s = world(3, 3, only('last'));
    paint(s, 1, 0, 100);
    paint(s, 2, 100, 200);
    paint(s, 3, 200, 300);
    tick(s);
    expect(Array.from(s.match.eliminated)).toEqual([0, 0, 0, 0]);
    s.outbox.clear();
    for (let c = 200; c < 300; c++) setOwner(s, c, 0, 0);
    tick(s);
    expect(s.match.eliminated[3]).toBe(1);
    expect(s.match.ended).toBe(0);
    expect(s.outbox.drain().filter((e) => e.kind === OUTBOX_ELIMINATED)).toEqual([{ kind: OUTBOX_ELIMINATED, tick: 1, a: 2, b: 0 }]);
  });
  it('the last player alive wins (reason last); tribes do not count', () => {
    const s = world(3, 2, only('last'));
    paint(s, 1, 0, 100);
    paint(s, 2, 100, 200);
    paint(s, 3, 200, 300); // a tribe
    tick(s, 3);
    expect(s.match.ended).toBe(0);
    for (let c = 100; c < 200; c++) setOwner(s, c, 0, 0);
    s.outbox.clear();
    tick(s);
    expect(s.match.ended).toBe(1);
    expect(s.match.winner).toBe(1);
    expect(s.match.reason).toBe(WIN_REASON_LAST);
    expect(s.outbox.drain().some((e) => e.kind === OUTBOX_MATCH_END && e.a === 1 && e.b === WIN_REASON_LAST)).toBe(true);
  });
  it('a seat that has not spawned is not eliminated, and a lone player does not "win" at once', () => {
    const s = world(3, 3, only('last'));
    paint(s, 1, 0, 100);
    tick(s, 20);
    expect(Array.from(s.match.eliminated)).toEqual([0, 0, 0, 0]);
    expect(s.match.ended).toBe(0);
    const solo = world(1, 1, only('last'));
    paint(solo, 1, 0, 100);
    tick(solo, 20);
    expect(solo.match.ended).toBe(0);
  });
  it('the loss of the capital alone is not an elimination', () => {
    const s = world(2, 2, only('last'));
    paint(s, 1, 0, 100);
    paint(s, 2, 100, 200);
    s.capital[2] = 100 + 1;
    tick(s);
    setOwner(s, 100, 1, 0); // the capital cell changes hands, the rest stays
    tick(s);
    expect(s.match.capitalLost[2]).toBe(1);
    expect(s.match.eliminated[2]).toBe(0);
    expect(s.match.ended).toBe(0);
  });
});

describe('condition (c): the score at the time limit', () => {
  const limit = 6;
  it('does nothing before the limit and decides on the limit tick', () => {
    const s = world(2, 2, only('score', { timeLimitTicks: limit }));
    paint(s, 1, 0, 40);
    paint(s, 2, 100, 120);
    tick(s, limit - 1);
    expect(s.match.ended).toBe(0);
    tick(s);
    expect(s.match.ended).toBe(1);
    expect(s.match.winner).toBe(1);
    expect(s.match.reason).toBe(WIN_REASON_SCORE);
  });
  it('score = land + 25 per City level + 10 per Factory level (finished structures only), here a City decides', () => {
    const t = BUILD_TICKS[STRUCT_CITY] as number;
    const s = world(2, 2, only('score', { timeLimitTicks: t + 5 }));
    paint(s, 1, 0, 80); // 20 std-cells
    paint(s, 2, 100, 164); // 16 std-cells + a City (25) = 41
    s.structures.add(STRUCT_CITY, 2, 110, 0);
    tick(s, t + 4);
    expect(s.match.ended).toBe(0);
    tick(s);
    expect(s.match.winner).toBe(2);
    const v = new Uint32Array(matchPackedLength(2));
    fillMatchView(s, v, new Uint32Array(3));
    const m = matchViewOf(2, v);
    expect([m.landStd[0], m.score[0], m.landStd[1], m.score[1]]).toEqual([20, 20, 16, 41]);
    // a Factory that is not finished adds nothing
    const f = world(2, 2, only('score', { timeLimitTicks: 3 }));
    paint(f, 1, 0, 40);
    paint(f, 2, 100, 140);
    f.structures.add(STRUCT_FACTORY, 2, 110, 0);
    tick(f, 3);
    expect(f.match.winner).toBe(1); // equal land, the Factory is still building, the lower seat wins
  });
  it('tiebreak: equal score goes to the higher land, then to the lower seat', () => {
    const t = BUILD_TICKS[STRUCT_CITY] as number;
    // 30 vs 5 + 25: equal score 30, seat 2 has the City and less land, so seat 1 wins on land
    const a = world(2, 2, only('score', { timeLimitTicks: t + 1 }));
    paint(a, 1, 0, 120); // 30
    paint(a, 2, 200, 220); // 5
    a.structures.add(STRUCT_CITY, 2, 205, 0);
    tick(a, t + 1);
    expect(a.match.winner).toBe(1);
    // the same with the roles swapped: seat 2 has the land, seat 1 the City
    const b = world(2, 2, only('score', { timeLimitTicks: t + 1 }));
    paint(b, 2, 0, 120);
    paint(b, 1, 200, 220);
    b.structures.add(STRUCT_CITY, 1, 205, 0);
    tick(b, t + 1);
    expect(b.match.winner).toBe(2);
    // a complete tie: the lower seat
    const c = world(3, 3, only('score', { timeLimitTicks: 3 }));
    paint(c, 2, 0, 40);
    paint(c, 3, 100, 140);
    paint(c, 1, 200, 240);
    tick(c, 3);
    expect(c.match.winner).toBe(1);
  });
  it('without structures the score is the land: more land wins', () => {
    const s = world(2, 2, only('score', { timeLimitTicks: 3 }));
    paint(s, 1, 0, 100); // 25
    paint(s, 2, 150, 258); // 27
    tick(s, 3);
    expect(s.match.winner).toBe(2);
  });
});

describe('precedence and the end', () => {
  it('a match without a win block, or with all three off, never ends', () => {
    for (const win of [undefined, { ...WIN_ALL, land: false, last: false, score: false }]) {
      const s = world(2, 2, win);
      paint(s, 1, 0, 399);
      paint(s, 2, 399, 400);
      tick(s, 1500);
      expect(s.match.ended).toBe(0);
      expect(s.header.config.win).toBeUndefined();
    }
  });
  it('last alive wins over land when both happen in one step', () => {
    const s = world(2, 2, { ...WIN_ALL, holdTicks: 2 });
    paint(s, 1, 0, 300);
    paint(s, 2, 350, 360);
    tick(s); // the first tick of the hold
    for (let c = 350; c < 360; c++) setOwner(s, c, 0, 0);
    tick(s); // the second tick of the hold AND seat 2 is eliminated: last alive is checked first
    expect(s.match.holdCount).toBe(1); // the hold did not even get to count: the match ended before
    expect(s.match.reason).toBe(WIN_REASON_LAST);
    expect(s.match.winner).toBe(1);
  });
  it('after the end step only counts ticks: intents are ignored and nothing else changes', () => {
    const s = world(2, 2, only('land', { holdTicks: 1 }));
    paint(s, 1, 0, 300);
    tick(s);
    expect(s.match.ended).toBe(1);
    const owners = s.owner.slice();
    const gold = s.gold.slice();
    const rejects = s.rejects;
    const before = hashState(s);
    const r = step(s, { turn: s.tick, intents: [{ kind: 'DebugPaint', seat: 1, cell: 399, id: 1 }, { kind: 'Spawn', seat: 1, cell: 3, id: 2 }] });
    expect(r.ok).toBe(true);
    expect(s.tick).toBe(2);
    expect(Array.from(s.owner)).toEqual(Array.from(owners));
    expect(Array.from(s.gold)).toEqual(Array.from(gold));
    expect(s.rejects).toBe(rejects);
    expect(hashState(s)).not.toBe(before); // the tick counter is in the hash
    tick(s, 50);
    expect(s.match.endTick).toBe(1);
  });
  it('the view reports the result and the win progress', () => {
    const s = world(2, 2, only('land', { holdTicks: 100 }));
    paint(s, 1, 0, 250);
    tick(s, 40);
    const v = new StateView(s);
    expect(v.match.ended).toBe(false);
    expect(v.match.leaderSeat).toBe(0);
    expect(v.match.holdSeat).toBe(0);
    expect(v.match.holdTicksLeft).toBe(60);
    expect(v.match.requiredPct).toBe(60);
    expect(v.match.timeLeftTicks).toBe(1000 - 40);
    tick(s, 60);
    v.refresh();
    expect(v.match.ended).toBe(true);
    expect(v.match.winnerSeat).toBe(0);
    expect(v.match.reason).toBe(WIN_REASON_LAND);
    expect(v.match.endTick).toBe(100);
    const none = new StateView(world(2, 2));
    expect(none.match.winFlags).toBe(0);
    expect(none.match.winnerSeat).toBe(-1);
  });
});

describe('anti-snowball: the attacker pays less against a nation above the thresholds', () => {
  const BASE = 3000; // a Plains cell at depth 0 in milli-QT
  /** Owner 1 (a nation) holds `n` cells at the far end; owner 2 holds cell 0; the attack takes cell 1 from owner 1. Returns the milli-QT the cell cost. */
  function costAgainst(n: number, opts: { target?: number; seats?: number; players?: number; post?: boolean; win?: boolean } = {}): number {
    const s = world(opts.seats ?? 3, opts.players ?? 3, opts.win === false ? undefined : WIN_ALL);
    const target = opts.target ?? 1;
    setOwner(s, 0, 2, 0);
    setOwner(s, 1, target, 0);
    for (let c = CELLS - 1; c > CELLS - n; c--) setOwner(s, c, target, 0);
    if (opts.post === true) {
      s.structures.add(STRUCT_POST, target, 1, 0);
      s.tick = 10000; // the Post is finished
    }
    const a = s.attacks.create(2, target, 1000000);
    a.push(1, 0);
    expect(advanceAttack(s, a, 0, 1)).toBe(1);
    return (1000000 - a.troops) * 1000 + a.costFrac;
  }
  it('exact thresholds: 25.0 and 40.0 percent are NOT discounted, one cell more is', () => {
    expect(costAgainst(100)).toBe(BASE); // 100 / 400 = 25.0 percent exactly
    expect(costAgainst(101)).toBe(Math.floor((BASE * LEADER_COST_PCT_MID) / 100));
    expect(costAgainst(160)).toBe(Math.floor((BASE * LEADER_COST_PCT_MID) / 100)); // 40.0 percent: the mid tier still
    expect(costAgainst(161)).toBe(Math.floor((BASE * LEADER_COST_PCT_HIGH) / 100));
    expect(costAgainst(300)).toBe(Math.floor((BASE * LEADER_COST_PCT_HIGH) / 100)); // replaces, does not stack with, the mid tier
  });
  it('the numbers are 25, 40, 0.85 and 0.7', () => {
    expect([LEADER_LAND_PCT_MID, LEADER_LAND_PCT_HIGH, LEADER_COST_PCT_MID, LEADER_COST_PCT_HIGH]).toEqual([25, 40, 85, 70]);
  });
  it('does not apply against a tribe or against free land', () => {
    expect(costAgainst(300, { target: 3, seats: 3, players: 2 })).toBe(BASE); // owner 3 is a tribe
    const s = world(3, 3, WIN_ALL);
    paint(s, 1, 0, 300);
    expect(leaderCostPct(s, 0)).toBe(100);
    expect(leaderCostPct(s, 1)).toBe(LEADER_COST_PCT_HIGH);
  });
  it('combines with a Defense Post after it: the post price first, then the discount', () => {
    const posted = Math.floor((BASE * POST_COST_NUM) / POST_COST_DEN);
    expect(costAgainst(100, { post: true })).toBe(posted);
    expect(costAgainst(300, { post: true })).toBe(Math.floor((posted * LEADER_COST_PCT_HIGH) / 100));
  });
  it('is a rule of a match with end rules: without `config.win` the sandbox keeps the plain price', () => {
    expect(costAgainst(300, { win: false })).toBe(BASE);
  });
  it('the AI and the UI read the same thresholds (public.ts re-exports the constants of rules.ts)', () => {
    expect(pub.LEADER_LAND_PCT_MID).toBe(LEADER_LAND_PCT_MID);
    expect(pub.LEADER_LAND_PCT_HIGH).toBe(LEADER_LAND_PCT_HIGH);
  });
});

describe('statistics against an independent recount', () => {
  it('peak land, conquered cells and built structures over random matches', () => {
    for (const seed of [3, 11, 29]) {
      const s = randomMatchState(seed, true, 6, 3);
      const d = new MatchDriver(s, seed, true);
      const seats = s.header.seats;
      const peak = new Array<number>(seats + 1).fill(0);
      let captured = 0;
      let builtTotal = 0;
      const builtBy = new Array<number>(seats + 1).fill(0);
      for (let t = 0; t < 400; t++) {
        const extra: pub.IntentBody[] = [];
        if (t % 7 === 3) {
          for (let seat = 0; seat < seats; seat++) {
            extra.push({ kind: 'DebugGive', seat, gold: 5000, troops: 0 });
            extra.push({ kind: 'Build', seat, type: STRUCT_CITY, cell: hash2(seed, t, 90 + seat) % (RW * RH) });
          }
        }
        const high = s.structures.highWater;
        d.step(d.intents([...extra, ...randomBodies(seed, s.tick, seats, RW * RH, true)]));
        s.outbox.clear();
        captured += s.work.captured;
        // independent recount of the land: sum the row weights of the cells the owner array says are owned
        const sums = new Array<number>(seats + 1).fill(0);
        for (let y = 0; y < RH; y++) for (let x = 0; x < RW; x++) {
          const o = s.owner[y * RW + x] as number;
          if (o !== 0) sums[o] = (sums[o] as number) + (s.rowCos[y] as number);
        }
        for (let o = 1; o <= seats; o++) peak[o] = Math.max(peak[o] as number, Math.floor((sums[o] as number) / (WEIGHT_ONE * 4)));
        for (let id = high; id < s.structures.highWater; id++) {
          builtTotal++;
          builtBy[s.structures.owner[id] as number] = (builtBy[s.structures.owner[id] as number] as number) + 1;
        }
      }
      let conq = 0;
      for (let o = 1; o <= seats; o++) {
        expect(s.match.peakLand[o], `peak seat ${o - 1} seed ${seed}`).toBe(peak[o]);
        conq += s.match.conquered[o] as number;
      }
      expect(conq, `conquered seed ${seed}`).toBe(captured);
      expect(builtTotal).toBeGreaterThan(0);
      let built = 0;
      for (let o = 1; o <= seats; o++) built += s.match.built[o] as number;
      expect(built, `built seed ${seed}`).toBe(builtTotal);
      for (let o = 1; o <= seats; o++) expect(s.match.built[o], `built seat ${o - 1}`).toBe(builtBy[o]);
    }
  });
});

describe('serialisation of the match block', () => {
  it('a finished match round-trips (hash, result, statistics) and a restored copy goes on exactly like the original', () => {
    const s = world(2, 2, only('land', { holdTicks: 20 }));
    paint(s, 1, 0, 300);
    s.match.built[1] = 7;
    s.match.conquered[2] = 9;
    s.match.districts[1] = 2;
    tick(s, 50);
    expect(s.match.ended).toBe(1);
    const bytes = serialize(s);
    const back = deserialize(bytes);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    const r = back.state;
    expect(hashState(r)).toBe(hashState(s));
    expect(r.header.config.win).toEqual(s.header.config.win);
    expect([r.match.ended, r.match.winner, r.match.reason, r.match.endTick]).toEqual([1, 1, WIN_REASON_LAND, 20]);
    expect(Array.from(r.match.built)).toEqual(Array.from(s.match.built));
    expect(Array.from(r.match.eliminated)).toEqual(Array.from(s.match.eliminated));
    tick(s, 30);
    tick(r, 30);
    expect(hashState(r)).toBe(hashState(s));
  });
  it('a mid-match snapshot with a running hold timer continues to the same end as a straight run', () => {
    const run = (): GameState => {
      const s = world(2, 2, only('land', { holdTicks: 120 }));
      paint(s, 1, 0, 250);
      return s;
    };
    const straight = run();
    tick(straight, 200);
    const half = run();
    tick(half, 70);
    expect(half.match.holdCount).toBe(70);
    const back = deserialize(serialize(half));
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    tick(back.state, 130);
    expect(hashState(back.state)).toBe(hashState(straight));
    expect(back.state.match.endTick).toBe(120);
  });
  it('refuses inconsistent match blocks and the win block is part of the hash', () => {
    const s = world(2, 2, only('land'));
    const bytes = serialize(s);
    // the first scalar of the block is winFlags: 40 + 24 * 3 bytes before the checksum
    const blockStart = bytes.length - 4 - (16 + 12 * 3) - (40 + 24 * 3); // M18c-1: the diplomacy block (16 + 12 per ownerId) sits after the match block
    const bad = bytes.slice();
    new DataView(bad.buffer).setUint32(blockStart + 20, 1, true); // a winner before the end
    const res = deserialize(bad);
    expect(res.ok).toBe(false);
    const a = world(2, 2, only('land', { landSharePct: 60 }));
    const b = world(2, 2, only('land', { landSharePct: 61 }));
    expect(hashState(a)).not.toBe(hashState(b));
    expect(hashState(world(2, 2))).not.toBe(hashState(world(2, 2, only('score'))));
  });
  it('a win block with all conditions off is dropped (the match is the one without a block)', () => {
    const a = world(2, 2, { ...WIN_ALL, land: false, last: false, score: false });
    expect(hashState(a)).toBe(hashState(world(2, 2)));
  });
});

describe('the packed match view', () => {
  it('an eliminated and a capital-lost flag reach the per-seat blocks', () => {
    const s = world(2, 2, WIN_ALL);
    paint(s, 1, 0, 100);
    paint(s, 2, 100, 110);
    s.capital[2] = 101;
    tick(s);
    for (let c = 100; c < 110; c++) setOwner(s, c, 1, 0);
    tick(s);
    const v = new StateView(s);
    expect(v.match.eliminated[1]).toBe(1);
    expect(v.match.capitalLost[1]).toBe(1);
    expect(v.match.ended).toBe(true);
    expect(v.match.winnerSeat).toBe(0);
    expect(v.match.reason).toBe(WIN_REASON_LAST);
    expect(v.match.leaderSeat).toBe(0);
  });
});
