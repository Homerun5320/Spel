// M18b-3: the pure UI models of federations: the leaderboard entries (one per federation, summed share, living members), the share the win meter uses,
// the groups of the result screen, the shared-victory headline and the federation flag.
import { describe, expect, it } from 'vitest';
import { makeFlagSpec } from '../../src/ui/flag';
import { boardEntries, resultGroups, sideInfoOf, sideShareQ15 } from '../../src/ui/groupModel';
import { reasonLine } from '../../src/ui/matchFlow';
import { createSeatLabels } from '../../src/ui/seatLabels';
import { WIN_REASON_SCORE } from '../../src/sim/public';

const flag = makeFlagSpec(77);
// Seats 0..5 are players: 0 is a single nation, 1 to 3 are the federation "Utopia", 4 is single, 5 single.
const ids = [0, 1, 2, 3, 4, 5].map((i) => ({ identity: { kind: 'custom' as const, name: `N${i}` }, flag: null }));
const labels = createSeatLabels(ids, 6, 0, [{ seats: [1, 2, 3], nameEn: 'Utopia', nameSv: 'Utopien', flag }]);

const stats = (shares: number[]) => ({ landShareQ15: shares, cells: shares.map((s) => (s > 0 ? 10 : 0)) });

describe('the leaderboard entries', () => {
  it('a federation is ONE entry with the summed share and its living members; it ranks above a bigger single nation', () => {
    const e = boardEntries(stats([5000, 3000, 3000, 3000, 8000, 100]), 6, labels);
    expect(e.map((x) => [x.fed, x.seat, x.shareQ15, x.alive, x.total])).toEqual([
      [0, 1, 9000, 3, 3],
      [-1, 4, 8000, 1, 1],
      [-1, 0, 5000, 1, 1],
      [-1, 5, 100, 1, 1],
    ]);
  });
  it('members without land are not alive; a federation without any land has no entry', () => {
    const e = boardEntries(stats([5000, 4000, 0, 0, 0, 0]), 6, labels);
    expect(e.map((x) => [x.fed, x.alive, x.total, x.seats.join(',')])).toEqual([
      [-1, 1, 1, '0'],
      [0, 1, 3, '1'],
    ]);
    expect(boardEntries(stats([5000, 0, 0, 0, 0, 0]), 6, labels).some((x) => x.fed >= 0)).toBe(false);
  });
  it('the win meter share is the group sum for a member and the own share otherwise', () => {
    const st = stats([5000, 3000, 2000, 1000, 8000, 100]);
    expect(sideShareQ15(st, labels, 2)).toBe(6000);
    expect(sideShareQ15(st, labels, 4)).toBe(8000);
  });
});

describe('the result groups and the headline', () => {
  const m = { winnerSeat: 1, score: [50, 30, 20, 10, 60, 5], landStd: [5, 3, 2, 1, 6, 1] };
  it('the winning group comes first with its summed score and land; the rest follow by score', () => {
    const g = resultGroups(m, 6, 0, labels, (s) => s);
    expect(g.map((x) => [x.rank, x.fed, x.winner, x.score, x.members.join(',')])).toEqual([
      [1, 0, true, 60, '1,2,3'],
      [2, -1, false, 60, '4'],
      [3, -1, false, 50, '0'],
      [4, -1, false, 5, '5'],
    ]);
    expect(g[0]?.flag).toBe(flag);
    expect(g[0]?.you).toBe(false);
    expect(g[2]?.you).toBe(true);
  });
  it('a shared victory has its own headline and counts for every member of the side, also an eliminated one', () => {
    const view = { winnerSeat: 1, reason: WIN_REASON_SCORE, landSharePct: 60, holdTicks: 300, timeLimitTicks: 3000 } as unknown as Parameters<typeof reasonLine>[0];
    const side = sideInfoOf(labels);
    expect(reasonLine(view, 3, () => 'Utopien', side).titleKey).toBe('result.title.fedYou');
    expect(reasonLine(view, 0, () => 'Utopien', side).titleKey).toBe('result.title.fedOther');
    // without federations (the default) the old headlines stay
    expect(reasonLine(view, 1, () => 'N1').titleKey).toBe('result.title.you');
    expect(reasonLine(view, 0, () => 'N1').titleKey).toBe('result.title.other');
  });
});
