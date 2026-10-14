// M05fix (D111): the over-cap surplus after a seat loses land is the documented economy rule, not a defect. Pinned reproduction of the
// counterexample the property test once failed on (1 in about 3600 random matches, `expected 4720 to be less than or equal to 4713`).
import { describe, expect, it } from 'vitest';
import { ownerCapQt } from '../../src/sim/economy';
import type { Intent } from '../../src/sim/intents';
import { MAX_DECAY_MICRO_QT_PER_TICK, MICRO_QT_PER_QT } from '../../src/sim/rules';
import { step } from '../../src/sim/step';
import { freshTerritoryMatch, OVER_CAP_MATCH, REFUND_OVER_CAP_MATCH } from './helpers/overCapMatch';

function play(): { s: ReturnType<typeof freshTerritoryMatch>; trace: { troops: number; cap: number; area: number }[] } {
  const s = freshTerritoryMatch(OVER_CAP_MATCH.seed, OVER_CAP_MATCH.debug);
  const trace: { troops: number; cap: number; area: number }[] = [];
  for (const intents of OVER_CAP_MATCH.turns) {
    expect(step(s, { turn: s.tick, intents: intents as Intent[] }).ok).toBe(true);
    trace.push({ troops: s.troops[4] as number, cap: s.agg.area[4] ? ownerCapQt(s, 4) : 0, area: s.agg.area[4] as number });
  }
  return { s, trace };
}

describe('the troop surplus above a fallen cap (the property counterexample of the flake hunt)', () => {
  it('owner 4 holds its full cap, loses a cell, and keeps the surplus over the lower cap (not clamped, by the rule)', () => {
    const { trace } = play();
    const last = trace[trace.length - 1] as { troops: number; cap: number; area: number };
    const before = trace[trace.length - 2] as { troops: number; cap: number; area: number };
    expect(before).toEqual({ troops: 4721, cap: 4721, area: 197 }); // full cap, 197 cells
    expect(last).toEqual({ troops: 4720, cap: 4713, area: 196 }); // one cell lost: 7 QT over the new cap
  });

  it('the surplus only shrinks (by at most MAX_DECAY per tick), never grows, and the troops never rise while above the cap', () => {
    const { s } = play();
    let prev = s.troops[4] as number;
    const maxStep = Math.ceil(MAX_DECAY_MICRO_QT_PER_TICK / MICRO_QT_PER_QT);
    for (let i = 0; i < 300; i++) {
      step(s, { turn: s.tick, intents: [] });
      const now = s.troops[4] as number;
      const cap = ownerCapQt(s, 4);
      if (prev > cap) {
        expect(now).toBeLessThanOrEqual(prev);
        expect(prev - now).toBeLessThanOrEqual(maxStep);
      }
      expect(now).toBeLessThanOrEqual(Math.max(cap, prev));
      prev = now;
    }
  });

  it('the refund of a cancelled attack can lift a seat one QT over its cap (the committed pool is outside the cap), and it decays from there', () => {
    const s = freshTerritoryMatch(REFUND_OVER_CAP_MATCH.seed, REFUND_OVER_CAP_MATCH.debug);
    const seen: { troops: number; cap: number; attacks: number }[] = [];
    for (const intents of REFUND_OVER_CAP_MATCH.turns) {
      expect(step(s, { turn: s.tick, intents: intents as Intent[] }).ok).toBe(true);
      seen.push({ troops: s.troops[5] as number, cap: ownerCapQt(s, 5), attacks: s.attacks.list.length });
    }
    expect(seen[1]).toEqual({ troops: 4703, cap: 4703, attacks: 0 }); // full cap
    expect(seen[2]).toEqual({ troops: 4468, cap: 4703, attacks: 1 }); // 235 QT committed
    expect(seen[7]).toEqual({ troops: 4469, cap: 4703, attacks: 1 });
    expect(seen[8]).toEqual({ troops: 4704, cap: 4703, attacks: 0 }); // cancelled: 235 QT back
    expect(seen[9]?.troops).toBeLessThanOrEqual(4704);
    for (let i = 0; i < 100; i++) {
      const before = s.troops[5] as number;
      step(s, { turn: s.tick, intents: [] });
      expect(s.troops[5]).toBeLessThanOrEqual(before); // above the cap it only decays
    }
  });
});
