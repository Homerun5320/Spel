// The pure decisions of the HUD: the troop bar and its 80 % warning, the banner prompts, the leaderboard ranking, seat names,
// the refusal keys.
import { describe, expect, it } from 'vitest';
import { bannerState, phaseName, rankOf, rankTop, rejectKey, seatName, shareHundredths, troopBar } from '../../src/ui/hudLogic';
import { PHASE_IMMUNITY, PHASE_PLAY, PHASE_SPAWN } from '../../src/sim/flow';
import * as intents from '../../src/sim/intents';
import { hasKey } from '../../src/ui/i18n';
import { TROOP_WARNING_FRACTION } from '../../src/ui/uiConfig';

describe('troopBar', () => {
  it('warns from 80 % of the cap on, not before', () => {
    expect(TROOP_WARNING_FRACTION).toBe(0.8);
    expect(troopBar(799, 1000).warning).toBe(false);
    expect(troopBar(800, 1000).warning).toBe(true);
    expect(troopBar(1000, 1000).warning).toBe(true);
    expect(troopBar(1500, 1000)).toEqual({ fraction: 1, warning: true });
    expect(troopBar(250, 1000)).toEqual({ fraction: 0.25, warning: false });
  });

  it('a zero cap or no troops gives an empty bar without a warning, never NaN', () => {
    expect(troopBar(0, 1000)).toEqual({ fraction: 0, warning: false });
    expect(troopBar(500, 0)).toEqual({ fraction: 0, warning: false });
    expect(troopBar(Number.NaN, 100).warning).toBe(false);
  });
});

describe('bannerState', () => {
  it('prompts for a spawn, then waits, in the spawn phase; the countdown rounds up to whole seconds', () => {
    expect(bannerState(PHASE_SPAWN, 200, false)).toEqual({ key: 'phase.spawnPick', seconds: 20, tone: 'prompt' });
    expect(bannerState(PHASE_SPAWN, 191, true)).toEqual({ key: 'phase.spawnDone', seconds: 20, tone: 'wait' });
    expect(bannerState(PHASE_SPAWN, 1, false).seconds).toBe(1);
  });

  it('says protected in the immunity, the attack hint in play, and "missed" for a player who never spawned', () => {
    expect(bannerState(PHASE_IMMUNITY, 50, true)).toEqual({ key: 'phase.immunity', seconds: 5, tone: 'safe' });
    expect(bannerState(PHASE_PLAY, 0, true)).toEqual({ key: 'phase.play', seconds: -1, tone: 'play' });
    expect(bannerState(PHASE_IMMUNITY, 30, false)).toEqual({ key: 'phase.spawnMissed', seconds: -1, tone: 'missed' });
    expect(bannerState(PHASE_PLAY, 0, false).tone).toBe('missed');
  });

  it('phaseName names the three phases', () => {
    expect([PHASE_SPAWN, PHASE_IMMUNITY, PHASE_PLAY].map(phaseName)).toEqual(['spawn', 'immunity', 'play']);
  });
});

describe('shareHundredths', () => {
  it('converts Q15 (32768 = all the land) to hundredths of a percent', () => {
    expect(shareHundredths(0)).toBe(0);
    expect(shareHundredths(32768)).toBe(10000);
    expect(shareHundredths(16384)).toBe(5000);
    expect(shareHundredths(49)).toBe(15); // 0.15 %
  });
});

function statsOf(shares: number[], cells?: number[]): { landShareQ15: Uint32Array; cells: Uint32Array } {
  return { landShareQ15: Uint32Array.from(shares), cells: Uint32Array.from(cells ?? shares.map((s) => (s > 0 ? 10 : 0))) };
}

describe('rankTop / rankOf', () => {
  it('lists the best seats first, ties to the lower seat, seats without land never', () => {
    const st = statsOf([5, 0, 9, 5, 9, 1, 0, 7]);
    const out = new Int32Array(5);
    const n = rankTop(st, 8, out);
    expect(n).toBe(5);
    expect(Array.from(out)).toEqual([2, 4, 7, 0, 3]);
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((s) => rankOf(st, 8, s))).toEqual([4, 0, 1, 5, 2, 6, 0, 3]);
  });

  it('fewer holders than rows: only the holders; nobody: zero', () => {
    const out = new Int32Array(5);
    expect(rankTop(statsOf([0, 3, 0]), 3, out)).toBe(1);
    expect(out[0]).toBe(1);
    expect(rankTop(statsOf([0, 0, 0]), 3, out)).toBe(0);
  });

  it('only the first `seatCount` seats take part (the tribes are left out)', () => {
    const st = statsOf([1, 2, 99, 99]);
    const out = new Int32Array(5);
    expect(rankTop(st, 2, out)).toBe(2);
    expect(Array.from(out).slice(0, 2)).toEqual([1, 0]);
    expect(rankOf(st, 2, 0)).toBe(2);
  });

  it('matches a plain sort on random data (property)', () => {
    let seed = 12345;
    const rnd = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed;
    };
    for (let round = 0; round < 200; round++) {
      const seats = 1 + (rnd() % 30);
      const shares = Array.from({ length: seats }, () => (rnd() % 4 === 0 ? 0 : rnd() % 20));
      const st = statsOf(shares);
      const out = new Int32Array(5);
      const n = rankTop(st, seats, out);
      const expected = shares
        .map((s, seat) => ({ s, seat }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s || a.seat - b.seat)
        .slice(0, 5)
        .map((x) => x.seat);
      expect(Array.from(out).slice(0, n)).toEqual(expected);
      for (let k = 0; k < expected.length; k++) expect(rankOf(st, seats, expected[k] as number)).toBe(k + 1);
    }
  });
});

describe('seatName', () => {
  it('you, the AI nations by seat, the tribes from 1', () => {
    expect(seatName(0, 6, 0)).toEqual({ key: 'hud.you', n: 0 });
    expect(seatName(3, 6, 0)).toEqual({ key: 'hud.nation', n: 3 });
    expect(seatName(6, 6, 0)).toEqual({ key: 'hud.tribe', n: 1 });
    expect(seatName(25, 6, 0)).toEqual({ key: 'hud.tribe', n: 20 });
  });
});

describe('rejectKey', () => {
  it('every refusal a click can cause has its own text, every key exists in both tables', () => {
    const own = [intents.REJECT_TERRAIN, intents.REJECT_OWNED, intents.REJECT_SPAWNED, intents.REJECT_PHASE, intents.REJECT_IMMUNE, intents.REJECT_NO_CONTACT, intents.REJECT_NO_TROOPS, intents.REJECT_SELF, intents.REJECT_NOT_SPAWNED, intents.REJECT_AMOUNT, intents.REJECT_PCT];
    const keys = own.map(rejectKey);
    expect(new Set(keys).size).toBe(own.length);
    for (const k of [...keys, rejectKey(999)]) expect(hasKey(k), k).toBe(true);
    expect(rejectKey(999)).toBe('reject.other');
  });
});
