// Fix-6A2 [1.9]: one constructed position per branch of the Fix-5A2 group changes in src/ai/diplomacy.ts that the first tests left to chance (sameGroup, the tie rule of
// strongest, the group share in the truce answer). Real sim rules, the real answer path (a ProposeTreaty intent, then diplomacyMove). Mutants: the Fix-6A2 block of docs/DECISIONS.md.
import { describe, expect, it } from 'vitest';
import { createAiMemory, diplomacyMove } from '../../src/ai';
import { bindFederation } from '../../src/sim/diplomacy';
import { applyIntent } from '../../src/sim/step';
import { validateIntent, withId, type IntentBody } from '../../src/sim/intents';
import { createRng } from '../../src/sim/rng';
import { AI_THINK_PERIOD_TICKS, AI_WAR_START_TICKS } from '../../src/sim/rules';
import { TREATY_ALLIANCE, TREATY_TRUCE } from '../../src/sim/diplomacyTable';
import type { GameState } from '../../src/sim/state';
import { setOwner } from '../../src/sim/territory';
import { StateView } from '../../src/sim/view';
import { landState } from '../sim/helpers/worlds';

let ids = 5000;
function send(s: GameState, body: IntentBody): number {
  const i = withId(body, ids++);
  const shape = validateIntent(i, { seats: s.header.seats, cells: s.width * s.height, debugIntents: false });
  return shape !== 0 ? shape : applyIntent(s, i);
}

/** Players left to right on a 100 x 10 plain, each holding the given percent of the columns. */
function arena(shares: number[]): GameState {
  const s = landState(100, 10, { seats: shares.length, players: shares.length });
  let x = 0;
  shares.forEach((pct, i) => {
    for (let c = 0; c < pct; c++, x++) for (let y = 0; y < 10; y++) setOwner(s, y * 100 + x, i + 1, 0);
    s.troops[i + 1] = 200000;
    s.capital[i + 1] = x - pct + 1;
  });
  s.tick = AI_WAR_START_TICKS + 1000;
  return s;
}

/** Everything seat `seat` says during up to 300 ticks (the sim is not run: only the tick moves). */
function said(s: GameState, seat: number): IntentBody[] {
  const view = new StateView(s);
  const memory = createAiMemory(view, seat, { humanSeats: [] });
  const rng = createRng(3);
  const out: IntentBody[] = [];
  for (let n = 0; n < 300 && out.length === 0; n++) {
    s.tick++;
    view.refresh();
    for (const b of diplomacyMove(view, memory, rng)) out.push(b);
  }
  return out;
}

const answerOf = (s: GameState, ai: number): string => {
  const out = said(s, ai).filter((b) => b.kind === 'AcceptTreaty' || b.kind === 'DeclineTreaty');
  return out.length === 0 ? 'silence' : (out[0] as IntentBody).kind;
};

describe('strongest(): the tie rule', () => {
  it('two groups with EXACTLY the same land: the lower seat is the leader, so the third seat asks the OTHER one for an alliance', () => {
    const s = arena([45, 45, 10]);
    expect(AI_THINK_PERIOD_TICKS).toBeGreaterThan(0);
    const proposals = said(s, 2).filter((b) => b.kind === 'ProposeTreaty');
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ kind: 'ProposeTreaty', seat: 2, to: 1, treaty: TREATY_ALLIANCE });
  });
});

describe('sameGroup(): a non-root member of the strongest group is skipped with its whole group', () => {
  it('an alliance proposed by a MEMBER (seat 1) of the 48 % group is judged against the best OTHER leader (seat 4, 30 %), not against its own group: accepted', () => {
    const s = arena([12, 12, 12, 12, 30, 22]);
    for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) bindFederation(s, a, b);
    s.diplo.rebuildPairs();
    const view = new StateView(s);
    const memory = createAiMemory(view, 5, { humanSeats: [] });
    expect(send(s, { kind: 'ProposeTreaty', seat: 1, to: 5, treaty: TREATY_ALLIANCE })).toBe(0);
    const rng = createRng(3);
    let answer = 'silence';
    for (let n = 0; n < 300 && answer === 'silence'; n++) {
      s.tick++;
      view.refresh();
      const out = diplomacyMove(view, memory, rng).filter((b) => b.kind === 'AcceptTreaty' || b.kind === 'DeclineTreaty');
      if (out.length > 0) answer = (out[0] as IntentBody).kind;
    }
    expect(answer).toBe('AcceptTreaty');
  });
});

describe('the leader test is per group', () => {
  it('a member of the 45 % group that has no direct bond to the group root (war on paper) does not ask outsiders for an alliance against its OWN group', () => {
    const s = arena([15, 15, 15, 25, 30]);
    bindFederation(s, 0, 1);
    bindFederation(s, 1, 2); // seat 2 is bound to seat 1 only: its pair with the root (seat 0) is plain war
    s.diplo.rebuildPairs();
    expect(said(s, 2).filter((b) => b.kind === 'ProposeTreaty')).toEqual([]);
    // control: the same shares unbound make no seat a leader (45 % needs the bond), so nobody proposes either; with seat 3 (25 %) as the asker against the group it does
    const proposals = said(s, 3).filter((b) => b.kind === 'ProposeTreaty');
    expect(proposals.length).toBeGreaterThan(0);
  });
});

describe('the truce answer uses the GROUP share of the proposer', () => {
  it('a member (15 %) of the biggest group (25 + 15 = 40 %) proposes a truce to an AI at war with one other party and above the median: declined (its group IS the strongest); with the group share replaced by the own share it would be accepted', () => {
    const s = arena([25, 15, 30, 30]);
    bindFederation(s, 0, 1);
    s.diplo.rebuildPairs();
    expect(send(s, { kind: 'Attack', seat: 2, target: 4, pct: 20 })).toBe(0); // the AI (seat 2) fights seat 3 only: one war
    expect(send(s, { kind: 'ProposeTreaty', seat: 1, to: 2, treaty: TREATY_TRUCE })).toBe(0);
    expect(answerOf(s, 2)).toBe('DeclineTreaty');
  });

  it('control: a proposer that is NOT in the biggest group is accepted under the same war (the rule fires)', () => {
    const s = arena([25, 15, 30, 30]);
    bindFederation(s, 0, 1);
    s.diplo.rebuildPairs();
    expect(send(s, { kind: 'Attack', seat: 2, target: 2, pct: 20 })).toBe(0); // the AI fights the big group; seat 3 proposes
    expect(send(s, { kind: 'ProposeTreaty', seat: 3, to: 2, treaty: TREATY_TRUCE })).toBe(0);
    expect(answerOf(s, 2)).toBe('AcceptTreaty');
  });
});
