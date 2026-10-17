// The pure parts of the top bar (M20a-lite): the win meter read from a MatchView, and the 10 Hz write gate.
import { describe, expect, it } from 'vitest';
import { HudGate } from '../../src/ui/hudGate';
import { HUD_MIN_INTERVAL_S } from '../../src/ui/uiConfig';
import { newWinMeterState, winMeterInto, type WinMeterSource } from '../../src/ui/winMeter';
import { TICK_HZ } from '../../src/ui/hudCodes';
import { matchViewOf, matchPackedLength, MATCH_HEADER_FIELDS } from '../../src/sim/matchView';

const src = (o: Partial<WinMeterSource> = {}): WinMeterSource => ({ ended: false, winFlags: 1, leaderSeat: 2, requiredPct: 60, holdSeat: -1, holdTicksLeft: 0, ...o });
const Q15_30 = Math.round(0.3 * 32768);

describe('winMeterInto', () => {
  it('the bar is the leader share over the requirement now (the overtime figure), capped at the full bar', () => {
    const w = newWinMeterState();
    winMeterInto(w, src(), Q15_30);
    expect(w.active).toBe(true);
    expect(w.leaderSeat).toBe(2);
    expect(w.requiredHundredths).toBe(6000);
    expect(Math.abs(w.leaderHundredths - 3000)).toBeLessThanOrEqual(1);
    expect(w.fillQ).toBe(200); // half way
    winMeterInto(w, src({ requiredPct: 25 }), Q15_30);
    expect(w.requiredHundredths).toBe(2500);
    expect(w.fillQ).toBe(400); // over the limit: full, never past the bar
    winMeterInto(w, src({ requiredPct: 40 }), Q15_30);
    expect(w.fillQ).toBe(300); // the requirement moved, the bar follows it
  });
  it('no leader: an empty bar; no land condition or an ended match: not active', () => {
    const w = newWinMeterState();
    winMeterInto(w, src({ leaderSeat: -1 }), Q15_30);
    expect([w.active, w.leaderHundredths, w.fillQ]).toEqual([true, 0, 0]);
    winMeterInto(w, src({ winFlags: 2 | 4 }), Q15_30);
    expect(w.active).toBe(false);
    winMeterInto(w, src({ ended: true }), Q15_30);
    expect(w.active).toBe(false);
    winMeterInto(w, src({ requiredPct: 0 }), Q15_30);
    expect(w.fillQ).toBe(0); // no division by zero
  });
  it('the hold count-down is the whole seconds left, rounded up, and only with a holder', () => {
    const w = newWinMeterState();
    winMeterInto(w, src({ holdSeat: 2, holdTicksLeft: 3 * TICK_HZ + 1 }), Q15_30);
    expect([w.holdSeat, w.holdSeconds]).toEqual([2, 4]);
    winMeterInto(w, src({ holdSeat: -1, holdTicksLeft: 99 }), Q15_30);
    expect([w.holdSeat, w.holdSeconds]).toEqual([-1, 0]);
  });
  it('reads a real packed MatchView: the field names of the meter exist in the header and the getters give the values the meter reads', () => {
    for (const f of ['ended', 'winFlags', 'leader1', 'holdSeat1', 'holdTicksLeft', 'requiredPct']) expect(MATCH_HEADER_FIELDS as readonly string[]).toContain(f);
    const seats = 3;
    const p = new Uint32Array(matchPackedLength(seats));
    p[4] = 1; // winFlags land
    p[8] = 3; // leader1 = seat 2
    p[9] = 3; // holdSeat1 = seat 2
    p[10] = 25; // holdTicksLeft
    p[11] = 60; // requiredPct
    const w = winMeterInto(newWinMeterState(), matchViewOf(seats, p), Q15_30);
    expect([w.active, w.leaderSeat, w.holdSeat, w.holdSeconds, w.requiredHundredths]).toEqual([true, 2, 2, 3, 6000]);
  });
});

describe('HudGate: at most 10 writes a second', () => {
  it('lets one write through per interval at any frame rate, and none in between', () => {
    const g = new HudGate(HUD_MIN_INTERVAL_S);
    let passes = 0;
    for (let i = 0; i < 600; i++) if (g.pass(1, 50, 0, i / 60)) passes++; // 10 s at 60 fps
    expect(passes).toBeLessThanOrEqual(10 * 10 + 1);
    expect(passes).toBeGreaterThanOrEqual(80); // 6 frames of 1/60 s fall just short of 0.1 s, so the pass is every 7th frame
  });
  it('a speed, commitment or language change goes through at once; a clock that went backwards does too', () => {
    const g = new HudGate(HUD_MIN_INTERVAL_S);
    expect(g.pass(1, 50, 0, 10)).toBe(true);
    expect(g.pass(1, 50, 0, 10.01)).toBe(false);
    expect(g.pass(2, 50, 0, 10.02)).toBe(true);
    expect(g.pass(2, 60, 0, 10.03)).toBe(true);
    expect(g.pass(2, 60, 1, 10.04)).toBe(true);
    expect(g.pass(2, 60, 1, 10.05)).toBe(false);
    expect(g.pass(2, 60, 1, 3)).toBe(true);
    expect(g.pass(2, 60, 1, 3 + HUD_MIN_INTERVAL_S)).toBe(true);
  });
});
