// Fix-5A3 (audit 4, finding 2.11): sharper assertions for the UI models on fake views: the addressee filter of the incoming cards, the watchers (a tech that is not new is no news; the
// first look is silent; the news key is (from, kind); what counts as accepted; the expiry edge), the countdown rounding, the break confirmation edges and the result groups (summed
// land, the winner flag, the land tie-break, the player filter).
import { describe, expect, it } from 'vitest';
import { RELATION_ALLIANCE, RELATION_TRUCE, RELATION_WAR, TICK_HZ, TREATY_ALLIANCE, TREATY_TRUCE, type SimView } from '../../src/sim/public';
import { BreakConfirm, DiploWatcher, NEWS_ACCEPTED, NEWS_DECLINED, NEWS_EXPIRED, NEWS_INCOMING, incomingCount, incomingProposals, secondsLeft } from '../../src/ui/diploModel';
import { resultGroups } from '../../src/ui/groupModel';
import { createSeatLabels } from '../../src/ui/seatLabels';
import { makeFlagSpec } from '../../src/ui/flag';
import { TechWatcher, techSecondsLeft } from '../../src/ui/techModel';

interface Prop {
  from: number;
  to: number;
  treaty: number;
  left: number;
}
/** A SimView with just the diplomacy reads the models use. `relation` is looked up by `from:to`. */
function diploView(props: Prop[], tick: number, rel: Record<string, number> = {}): SimView {
  return {
    tick,
    diplomacy: {
      proposalCount: props.length,
      proposalFrom: (i: number) => props[i]!.from,
      proposalTo: (i: number) => props[i]!.to,
      proposalTreaty: (i: number) => props[i]!.treaty,
      proposalLeft: (i: number) => props[i]!.left,
      relation: (a: number, b: number) => rel[`${a}:${b}`] ?? RELATION_WAR,
    },
  } as unknown as SimView;
}

describe('incoming proposals', () => {
  it('only proposals addressed to the local seat make cards and count', () => {
    const v = diploView(
      [
        { from: 1, to: 2, treaty: TREATY_TRUCE, left: 50 },
        { from: 3, to: 0, treaty: TREATY_ALLIANCE, left: 70 },
        { from: 0, to: 1, treaty: TREATY_TRUCE, left: 90 }, // the local seat's own
      ],
      10,
    );
    expect(incomingProposals(v, 0, 5)).toEqual([{ from: 3, treaty: TREATY_ALLIANCE, ticksLeft: 70 }]);
    expect(incomingCount(v, 0)).toBe(1);
    expect(incomingProposals(v, 2, 5).map((c) => c.from)).toEqual([1]);
    expect(incomingProposals(v, 0, 0)).toEqual([]);
  });
});

describe('DiploWatcher', () => {
  const run = (): { news: string[]; w: DiploWatcher } => {
    const news: string[] = [];
    return { news, w: new DiploWatcher((k, seat, treaty) => news.push(`${k}:${seat}:${treaty}`)) };
  };

  it('the first look only learns: open proposals are no news', () => {
    const { news, w } = run();
    w.update(diploView([{ from: 1, to: 0, treaty: TREATY_TRUCE, left: 50 }, { from: 0, to: 2, treaty: TREATY_TRUCE, left: 50 }], 5), 0);
    expect(news).toEqual([]);
    w.update(diploView([{ from: 1, to: 0, treaty: TREATY_TRUCE, left: 49 }, { from: 0, to: 2, treaty: TREATY_TRUCE, left: 49 }], 6), 0);
    expect(news).toEqual([]);
  });

  it('an incoming proposal is new by (sender, treaty): the same sender with another treaty, or another sender with the same one, is news', () => {
    const { news, w } = run();
    w.update(diploView([{ from: 1, to: 0, treaty: TREATY_TRUCE, left: 50 }], 1), 0);
    w.update(diploView([{ from: 1, to: 0, treaty: TREATY_ALLIANCE, left: 50 }], 2), 0);
    expect(news).toEqual([`${NEWS_INCOMING}:1:${TREATY_ALLIANCE}`]);
    news.length = 0;
    w.update(diploView([{ from: 1, to: 0, treaty: TREATY_ALLIANCE, left: 50 }, { from: 2, to: 0, treaty: TREATY_ALLIANCE, left: 50 }], 3), 0);
    expect(news).toEqual([`${NEWS_INCOMING}:2:${TREATY_ALLIANCE}`]);
    news.length = 0;
    w.update(diploView([{ from: 1, to: 0, treaty: TREATY_ALLIANCE, left: 49 }, { from: 2, to: 0, treaty: TREATY_ALLIANCE, left: 49 }], 4), 0);
    expect(news).toEqual([]); // known ones stay quiet
  });

  it('your own proposal that is gone: accepted when it became the treaty (a truce also by an alliance), otherwise declined', () => {
    const cases: Array<[number, number, number]> = [
      [TREATY_TRUCE, RELATION_TRUCE, NEWS_ACCEPTED],
      [TREATY_TRUCE, RELATION_ALLIANCE, NEWS_ACCEPTED],
      [TREATY_TRUCE, RELATION_WAR, NEWS_DECLINED],
      [TREATY_ALLIANCE, RELATION_ALLIANCE, NEWS_ACCEPTED],
      [TREATY_ALLIANCE, RELATION_TRUCE, NEWS_DECLINED], // a truce is not the alliance asked for
      [TREATY_ALLIANCE, RELATION_WAR, NEWS_DECLINED],
    ];
    for (const [treaty, relation, expected] of cases) {
      const { news, w } = run();
      w.update(diploView([{ from: 0, to: 2, treaty, left: 100 }], 10), 0);
      w.update(diploView([], 11, { '0:2': relation }), 0);
      expect(news, `treaty ${treaty} relation ${relation}`).toEqual([`${expected}:2:${treaty}`]);
    }
  });

  it('expired exactly when the last tick has passed: the tick of the end counts, the tick before does not', () => {
    const at = (tickNow: number): string[] => {
      const { news, w } = run();
      w.update(diploView([{ from: 0, to: 2, treaty: TREATY_TRUCE, left: 100 }], 10), 0); // ends at tick 110
      w.update(diploView([], tickNow), 0);
      return news;
    };
    expect(at(109)).toEqual([`${NEWS_DECLINED}:2:${TREATY_TRUCE}`]);
    expect(at(110)).toEqual([`${NEWS_EXPIRED}:2:${TREATY_TRUCE}`]);
    expect(at(111)).toEqual([`${NEWS_EXPIRED}:2:${TREATY_TRUCE}`]);
  });
});

describe('countdowns and the break confirmation edges', () => {
  it('whole seconds, rounded up: never 0 while time is left', () => {
    for (const f of [secondsLeft, techSecondsLeft]) {
      expect([f(0), f(1), f(TICK_HZ - 1), f(TICK_HZ), f(TICK_HZ + 1), f(TICK_HZ * 5)]).toEqual([0, 1, 1, 1, 2, 5]);
    }
  });

  it('a click at the very end of the time re-arms instead of confirming, and expire disarms exactly at the end', () => {
    const c = new BreakConfirm();
    expect(c.click(3, 10, 5)).toBe(false); // armed until 15
    expect(c.click(3, 14.99, 5)).toBe(true);
    expect(c.armed()).toBe(-1);
    c.click(3, 10, 5);
    expect(c.click(3, 15, 5)).toBe(false); // the time is over exactly now: this click arms again
    expect(c.armed()).toBe(3);
    const d = new BreakConfirm();
    d.click(2, 0, 5);
    expect(d.expire(4.99)).toBe(false);
    expect(d.armed()).toBe(2);
    expect(d.expire(5)).toBe(true);
    expect(d.armed()).toBe(-1);
    expect(d.expire(6)).toBe(false);
  });
});

describe('TechWatcher', () => {
  it('a second finished tech is news, the first one is not announced again', () => {
    let mask = 0b0001;
    const view = { match: { techMaskOfSeat: () => mask } } as unknown as SimView;
    const news: number[] = [];
    const w = new TechWatcher((t) => news.push(t));
    w.update(view, 0); // learns tech 0
    expect(news).toEqual([]);
    mask = 0b0011;
    w.update(view, 0);
    expect(news).toEqual([1]);
    mask = 0b1011;
    w.update(view, 0);
    expect(news).toEqual([1, 3]);
    w.update(view, 0);
    expect(news).toEqual([1, 3]);
  });
});

describe('resultGroups', () => {
  const flag = makeFlagSpec(5);
  const ids = [0, 1, 2, 3, 4, 5].map((i) => ({ identity: { kind: 'custom' as const, name: `N${i}` }, flag: null }));
  const labels = createSeatLabels(ids, 6, 0, [{ seats: [1, 2, 3], nameEn: 'Utopia', nameSv: 'Utopien', flag }]);

  it('sums the land of the members of a group', () => {
    const g = resultGroups({ winnerSeat: 1, score: [1, 1, 1, 1, 1, 1], landStd: [0, 0, 0, 0, 0, 0] }, 6, 0, labels, (s) => 10 + s);
    const byFed = (f: number, seat?: number): number => g.find((x) => (f >= 0 ? x.fed === f : x.members[0] === seat))!.landPct;
    expect(byFed(0)).toBe(11 + 12 + 13);
    expect(byFed(-1, 4)).toBe(14);
  });

  it('only the winner side is flagged: a federation by its fed, a single nation by its seat, nobody without a winner', () => {
    const flags = (winnerSeat: number): string[] => resultGroups({ winnerSeat, score: [5, 5, 5, 5, 5, 5], landStd: [0, 0, 0, 0, 0, 0] }, 6, 0, labels, () => 0).filter((x) => x.winner).map((x) => `${x.fed}:${x.members.join(',')}`);
    expect(flags(1)).toEqual(['0:1,2,3']);
    expect(flags(3)).toEqual(['0:1,2,3']);
    expect(flags(4)).toEqual(['-1:4']);
    expect(flags(-1)).toEqual([]);
  });

  it('equal scores are ordered by the summed land, then by the lowest seat', () => {
    const order = (landStd: number[]): string[] => resultGroups({ winnerSeat: -1, score: [30, 10, 10, 10, 30, 30], landStd }, 6, 0, labels, () => 0).map((x) => (x.fed >= 0 ? 'F' : String(x.members[0])));
    expect(order([2, 1, 1, 0, 2, 2])).toEqual(['0', 'F', '4', '5']); // all 2: by seat
    expect(order([1, 1, 1, 1, 5, 2])).toEqual(['4', 'F', '5', '0']); // seat 4: 5, federation: 3, seat 5: 2, seat 0: 1... federation 3 beats 2 and 1
    expect(order([9, 1, 1, 1, 1, 1])).toEqual(['0', 'F', '4', '5']); // seat 0 has the most land
    // the score decides before the land
    const byScore = resultGroups({ winnerSeat: -1, score: [5, 1, 1, 1, 9, 3], landStd: [0, 0, 0, 0, 0, 0] }, 6, 0, labels, () => 0).map((x) => (x.fed >= 0 ? 'F' : String(x.members[0])));
    expect(byScore).toEqual(['4', '0', 'F', '5']);
  });

  it('leaves seats beyond `players` out, also the members of a federation', () => {
    const g = resultGroups({ winnerSeat: -1, score: [2, 1, 1, 1, 1, 1], landStd: [0, 0, 0, 0, 0, 0] }, 3, 0, labels, () => 1);
    expect(g.map((x) => x.members.join(','))).toEqual(['0', '1,2']);
    expect(g.find((x) => x.fed === 0)?.landPct).toBe(2);
  });
});
