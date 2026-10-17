// Fix-3A2: the packed MatchView (src/sim/matchView.ts fillMatchView) that the HUD, the pause menu and the result screen read, and the initial copy of
// it in the page's ViewMirror. Every header word and every per-seat block is checked with values that differ between words and seats, so a
// swapped, missing or shifted word fails. The "kills:" comments name the mutants (mutation audit 2, finding 7); the table is in docs/DECISIONS.md.
import { describe, expect, it } from 'vitest';
import { MainThreadHost } from '../../src/host/mainThreadHost';
import { ViewMirror } from '../../src/host/viewMirror';
import { fillMatchView, matchPackedLength, matchViewOf, MATCH_HEADER_WORDS } from '../../src/sim/matchView';
import { WIN_REASON_LAST, type WinConfig } from '../../src/sim/matchState';
import { SPAWN_PHASE_TICKS, WEIGHT_ONE } from '../../src/sim/rules';
import { createState, type GameState } from '../../src/sim/state';
import { step } from '../../src/sim/step';
import { setOwner } from '../../src/sim/territory';
import { CLASS_PLAINS } from '../../src/sim/terrain';

const W = 20;
const H = 20;
const CELLS = W * H;
const MIN = 600;
const WIN: WinConfig = { land: true, last: true, score: true, timeLimitTicks: 40000, landSharePct: 60, holdTicks: 300 };

function world(seats: number, players: number, win: WinConfig | null = WIN, flow = false): GameState {
  return createState({
    width: W,
    height: H,
    seed: 5,
    seats,
    players,
    rowCos: new Uint16Array(H).fill(WEIGHT_ONE),
    config: { debugIntents: true, spawnPhase: flow, ...(win === null ? {} : { win }) },
    terrain: new Uint8Array(CELLS).fill(CLASS_PLAINS),
    elevation: new Uint16Array(CELLS),
  });
}
const paint = (s: GameState, owner: number, from: number, to: number): void => {
  for (let c = from; c < to; c++) setOwner(s, c, owner, 0);
};
function pack(s: GameState) {
  const out = new Uint32Array(matchPackedLength(s.header.seats));
  fillMatchView(s, out, new Uint32Array(s.header.seats + 1));
  return matchViewOf(s.header.seats, out);
}

describe('leaderSeat', () => {
  it('is the player with the most land: ties go to the lower seat, eliminated seats and tribes never lead, nobody with land is -1', () => {
    // kills: mv-leader-elim (drop the eliminated test), mv-leader-area (drop the area === 0 test), mv-leader-ge (> -> >=), mv-leader-tribe (players -> seats)
    const empty = world(4, 3);
    expect(pack(empty).leaderSeat).toBe(-1);
    const s = world(4, 3);
    paint(s, 1, 0, 50);
    paint(s, 2, 50, 100); // a tie of 50 with seat 0
    paint(s, 3, 100, 160); // the biggest, but eliminated below
    paint(s, 4, 160, 400); // a tribe (seat 3): never the leader
    expect(pack(s).leaderSeat).toBe(3 - 1); // before the flag: the biggest player, owner 3 = seat 2
    s.match.eliminated[3] = 1;
    expect(pack(s).leaderSeat).toBe(0);
    paint(s, 2, 100, 101);
    expect(pack(s).leaderSeat).toBe(1); // one more cell than seat 0
  });
});

describe('the header words', () => {
  it('requiredPct follows the overtime curve, and timeLeft is measured from the end of the spawn phase and stops at the end', () => {
    // kills: mv-required (requiredLandPct(...) -> cfg.landSharePct), mv-timeleft-start (elapsed from tick 0), mv-timeleft-ended (not 0 after the end)
    const s = world(2, 2, WIN);
    s.tick = 22 * MIN + 5;
    const v = pack(s);
    expect(v.requiredPct).toBe(58);
    expect(v.timeLeftTicks).toBe(40000 - (22 * MIN + 5));
    s.tick = 5;
    expect(pack(s).requiredPct).toBe(60);
    const f = world(2, 2, WIN, true);
    f.tick = SPAWN_PHASE_TICKS - 7; // inside the spawn phase: the clock has not started
    expect(pack(f).timeLeftTicks).toBe(40000);
    f.tick = SPAWN_PHASE_TICKS + 1234;
    expect(pack(f).timeLeftTicks).toBe(40000 - 1234);
    expect(pack(f).requiredPct).toBe(60);
    f.match.ended = 1;
    expect(pack(f).timeLeftTicks).toBe(0);
  });

  it('the rules of the match and the hold timer: holdTicksLeft = holdTicks - holdCount; no holder or an ended match clears holdSeat and holdTicksLeft', () => {
    // kills: mv-hold-owner-ended (holdOwner not cleared at the end), mv-hold-left (wrong formula), mv-flags
    const s = world(3, 3, WIN);
    let v = pack(s);
    expect([v.winFlags, v.timeLimitTicks, v.landSharePct, v.holdTicks]).toEqual([7, 40000, 60, 300]);
    expect([v.holdSeat, v.holdTicksLeft]).toEqual([-1, 0]);
    s.match.holdOwner = 2;
    s.match.holdCount = 120;
    v = pack(s);
    expect([v.holdSeat, v.holdTicksLeft]).toEqual([1, 180]);
    s.match.holdCount = 900; // past the requirement: never negative
    expect(pack(s).holdTicksLeft).toBe(0);
    s.match.holdCount = 120;
    s.match.ended = 1;
    s.match.winner = 3;
    s.match.reason = 2;
    s.match.endTick = 4321;
    v = pack(s);
    expect([v.ended, v.winnerSeat, v.reason, v.endTick, v.holdSeat, v.holdTicksLeft]).toEqual([true, 2, 2, 4321, -1, 0]);
    const none = pack(world(3, 3, null));
    expect([none.winFlags, none.timeLimitTicks, none.landSharePct, none.holdTicks, none.requiredPct, none.timeLeftTicks, none.holdTicksLeft]).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
});

describe('the per-seat blocks', () => {
  it('each block carries its own match array, seat by seat (distinct values everywhere)', () => {
    // kills: mv-districts-block (m.districts -> m.built), mv-capital (m.capitalLost -> m.eliminated), any swapped or shifted block
    const s = world(3, 3, WIN);
    paint(s, 1, 0, 30);
    paint(s, 2, 30, 90);
    paint(s, 3, 90, 100);
    const m = s.match;
    for (let o = 1; o <= 3; o++) {
      m.eliminated[o] = o === 2 ? 1 : 0;
      m.capitalLost[o] = o === 3 ? 1 : 0;
      m.peakLand[o] = 100 * o + 1;
      m.built[o] = 100 * o + 2;
      m.conquered[o] = 100 * o + 3;
      m.districts[o] = 100 * o + 4;
    }
    m.setTechMask(1, 0b1);
    m.setTechMask(3, 0b1111_0011);
    m.techCurrent[2] = 6;
    m.techDone[2] = 777;
    const v = pack(s);
    expect(Array.from(v.eliminated)).toEqual([0, 1, 0]);
    expect(Array.from(v.capitalLost)).toEqual([0, 0, 1]);
    expect(Array.from(v.peakLand)).toEqual([101, 201, 301]);
    expect(Array.from(v.built)).toEqual([102, 202, 302]);
    expect(Array.from(v.conquered)).toEqual([103, 203, 303]);
    expect(Array.from(v.districts)).toEqual([104, 204, 304]);
    expect(Array.from(v.techMask)).toEqual([1, 0, 0b1111_0011]); // M18d-1
    expect(Array.from(v.techCurrent1)).toEqual([0, 6, 0]);
    expect(Array.from(v.techDone)).toEqual([0, 777, 0]);
    expect(Array.from(v.techCount)).toEqual([1, 0, 6]);
    expect([v.techCurrentOfSeat(0), v.techCurrentOfSeat(1), v.techMaskOfSeat(2)]).toEqual([-1, 5, 0b1111_0011]);
    expect(v.techFxOfSeat(0, 0)).toBe(5);
    expect(v.landStd[1]).toBeGreaterThan(v.landStd[0] as number); // 60 cells against 30
    expect(v.landStd[0]).toBeGreaterThan(v.landStd[2] as number);
    expect(v.score[1]).toBeGreaterThan(v.score[2] as number);
    expect(matchPackedLength(3)).toBe(MATCH_HEADER_WORDS + 16 * 3); // M18c-1: + treaties, betrayals, relations; M18d-1: + techMask, techCurrent1, techDone, techCount; M18b-3: + group
  });
});

describe('the ViewMirror starts from the host match words', () => {
  it('a mirror built from a view of an ENDED match starts ended, with the winner, the reason and the per-seat blocks (no frame needed)', async () => {
    // kills: vm-match-init (delete 'this.matchPacked.set(v.match);' in the ViewMirror constructor)
    const s = world(2, 2, WIN);
    paint(s, 1, 0, 100);
    paint(s, 2, 100, 110);
    s.capital[2] = 101;
    step(s, { turn: s.tick, intents: [] });
    for (let c = 100; c < 110; c++) setOwner(s, c, 1, 0);
    step(s, { turn: s.tick, intents: [] });
    expect(s.match.ended).toBe(1);
    s.match.built[1] = 7;
    s.match.districts[2] = 9;
    const { mirror, stop } = await ViewMirror.attach(new MainThreadHost(s));
    const want = pack(s);
    expect(mirror.match.ended).toBe(true);
    expect(mirror.match.winnerSeat).toBe(0);
    expect(mirror.match.reason).toBe(WIN_REASON_LAST);
    expect(mirror.match.endTick).toBe(want.endTick);
    expect(Array.from(mirror.match.eliminated)).toEqual(Array.from(want.eliminated));
    expect(Array.from(mirror.match.capitalLost)).toEqual(Array.from(want.capitalLost));
    expect(Array.from(mirror.match.built)).toEqual([7, 0]);
    expect(Array.from(mirror.match.districts)).toEqual([0, 9]);
    stop();
  });
});
