// Fix-5A2 (audit 4, finding 0.6): the AI's diplomacy decides who the leader is per GROUP (a bound federation counts with its summed land, like the sim's leader price,
// win timer and win meter). Four bound seats with 12 % each are a 48 % leader; the same four seats unbound are nobody's leader.
import { describe, expect, it } from 'vitest';
import { createAiMemory, diplomacyMove } from '../../src/ai';
import { bindFederation } from '../../src/sim/diplomacy';
import { RELATION_ALLIANCE, TREATY_ALLIANCE } from '../../src/sim/diplomacyTable';
import type { IntentBody } from '../../src/sim/intents';
import { createRng } from '../../src/sim/rng';
import { AI_WAR_START_TICKS } from '../../src/sim/rules';
import { setOwner } from '../../src/sim/territory';
import { StateView } from '../../src/sim/view';
import { landState } from '../sim/helpers/worlds';

/** Seats 0..3 hold 12 % each (a group of 48 % when bound), seat 4 holds 30 %, seat 5 holds 22 %. */
function match(bound: boolean) {
  const s = landState(100, 10, { seats: 6, players: 6 });
  let x = 0;
  [12, 12, 12, 12, 30, 22].forEach((pct, i) => {
    for (let c = 0; c < pct; c++, x++) for (let y = 0; y < 10; y++) setOwner(s, y * 100 + x, i + 1, 0);
    s.troops[i + 1] = 200000;
    s.capital[i + 1] = x - pct + 1;
  });
  s.tick = AI_WAR_START_TICKS + 1000;
  if (bound) for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) bindFederation(s, a, b);
  s.diplo.rebuildPairs();
  return s;
}

/** Everything seat `seat` says over 600 ticks of a quiet match. */
function said(s: ReturnType<typeof match>, seat: number): IntentBody[] {
  const view = new StateView(s);
  const memory = createAiMemory(view, seat, { humanSeats: [] });
  const rng = createRng(3);
  const out: IntentBody[] = [];
  for (let n = 0; n < 600; n++) {
    s.tick++;
    view.refresh();
    for (const b of diplomacyMove(view, memory, rng)) out.push(b);
  }
  return out;
}

describe('the AI sees a federation as one leader', () => {
  it('a seat at war with a bound 48 % group asks the strongest OTHER party (seat 4, 30 %) for an alliance; unbound, nobody is the leader and nobody asks', () => {
    const proposals = (bound: boolean): IntentBody[] => said(match(bound), 5).filter((b) => b.kind === 'ProposeTreaty');
    const withGroup = proposals(true);
    expect(withGroup.length).toBeGreaterThan(0);
    expect(withGroup[0]).toMatchObject({ kind: 'ProposeTreaty', seat: 5, to: 4, treaty: TREATY_ALLIANCE });
    // control: the same shares without the bond (no single seat is above 40 %)
    expect(proposals(false)).toEqual([]);
  });

  it('a member of the leading group breaks an ordinary alliance outside the group (the group is the leader), but not when the group is not bound', () => {
    const breaks = (bound: boolean): IntentBody[] => {
      const s = match(bound);
      s.diplo.setRelation(1, 5, RELATION_ALLIANCE, 0); // owners 1 and 5 (seats 0 and 4): an ordinary alliance
      s.diplo.rebuildPairs();
      return said(s, 0).filter((b) => b.kind === 'BreakTreaty');
    };
    const b = breaks(true);
    expect(b.length).toBeGreaterThan(0);
    expect(b[0]).toMatchObject({ kind: 'BreakTreaty', seat: 0, with: 4 });
    expect(breaks(false)).toEqual([]);
  });

  it('nobody proposes to a member of its own group, and a group never proposes to itself', () => {
    const s = match(true);
    for (const seat of [0, 1, 2, 3]) {
      for (const b of said(s, seat)) if (b.kind === 'ProposeTreaty') expect([0, 1, 2, 3]).not.toContain(b.to);
    }
  });
});
