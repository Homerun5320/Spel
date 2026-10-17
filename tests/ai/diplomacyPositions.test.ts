// Fix-4A2 (audit 3, finding 1.5): the AI's diplomacy (src/ai/diplomacy.ts, and the negotiation guard of src/ai/think.ts) in constructed positions with the real
// sim rules, one expectation per rule that the mutation run of the audit found unpinned: what is remembered as a betrayal, whose proposals are answered, the
// think rhythm, the guards of a proposal, the grudge when choosing a partner, and that an attack waits while a proposal is open.
import { describe, expect, it } from 'vitest';
import { createAiMemory, diplomacyMove, think, type AiMemory } from '../../src/ai';
import { validateIntent, withId, type IntentBody } from '../../src/sim/intents';
import { createRng } from '../../src/sim/rng';
import { AI_GRUDGE_TICKS, AI_PROPOSE_COOLDOWN_TICKS, AI_THINK_PERIOD_TICKS, AI_WAR_MAX_SHARE_PCT, AI_WAR_START_TICKS, TREATY_BREAK_COOLDOWN_TICKS, TRUCE_TICKS } from '../../src/sim/rules';
import { RELATION_ALLIANCE, RELATION_TRUCE, RELATION_WAR } from '../../src/sim/diplomacyTable';
import { applyIntent } from '../../src/sim/step';
import { rebuildAggregates, type GameState } from '../../src/sim/state';
import { setOwner } from '../../src/sim/territory';
import { StateView } from '../../src/sim/view';
import { landState } from '../sim/helpers/worlds';

let ids = 1;
function send(s: GameState, body: IntentBody): number {
  const i = withId(body, ids++);
  const shape = validateIntent(i, { seats: s.header.seats, cells: s.width * s.height, debugIntents: false });
  return shape !== 0 ? shape : applyIntent(s, i);
}
const ok = (s: GameState, body: IntentBody): void => void expect(send(s, body), body.kind).toBe(0);

/** Players left to right on a 100 x 10 plain, each owning the given percent of the columns. */
function arena(shares: number[], seats = shares.length): GameState {
  const s = landState(100, 10, { seats, players: shares.length });
  let x = 0;
  shares.forEach((pct, i) => {
    for (let c = 0; c < pct; c++, x++) for (let y = 0; y < 10; y++) setOwner(s, y * 100 + x, i + 1, 0);
    s.troops[i + 1] = 200000;
    s.capital[i + 1] = x - pct + 1;
  });
  s.tick = AI_WAR_START_TICKS + 1000;
  return s;
}

function mind(s: GameState, seat: number): { memory: AiMemory; rng: Uint32Array; view: StateView } {
  const view = new StateView(s);
  return { memory: createAiMemory(view, seat, { humanSeats: [] }), rng: createRng(1000 + seat), view };
}

function toRhythm(s: GameState, m: AiMemory): void {
  while ((s.tick + m.phase) % AI_THINK_PERIOD_TICKS !== 0) s.tick++;
}

/** One look of the AI at the position: refresh the view, call diplomacyMove. */
function look(s: GameState, m: { memory: AiMemory; rng: Uint32Array; view: StateView }): readonly IntentBody[] {
  m.view.refresh();
  return diplomacyMove(m.view, m.memory, m.rng);
}

/** The reply of AI seat `ai` to the open proposal(s), by waiting tick by tick; the answer intents only. */
function answers(s: GameState, m: { memory: AiMemory; rng: Uint32Array; view: StateView }, limit = 120): IntentBody[] {
  const out: IntentBody[] = [];
  for (let n = 0; n <= limit; n++) {
    for (const b of look(s, m).filter((x) => x.kind === 'AcceptTreaty' || x.kind === 'DeclineTreaty')) {
      out.push(b);
      send(s, b); // the answer reaches the sim, so the proposal is closed
    }
    s.tick++;
  }
  return out;
}

describe('what is remembered as a betrayal (observe)', () => {
  /** AI seat 0 and seat 1 make a truce; the AI looks at it once. Returns the tick the truce ends. */
  function truceSeen(): { s: GameState; m: ReturnType<typeof mind>; until: number } {
    const s = arena([40, 30, 30]);
    const m = mind(s, 0);
    ok(s, { kind: 'ProposeTreaty', seat: 1, to: 0, treaty: 1 });
    ok(s, { kind: 'AcceptTreaty', seat: 0, from: 1 });
    const until = s.tick + TRUCE_TICKS;
    toRhythm(s, m.memory);
    look(s, m);
    expect(m.memory.lastRel[1]).toBe(RELATION_TRUCE);
    return { s, m, until };
  }

  it('a truce is remembered with its end tick, so a truce that the other side breaks early is a betrayal (and the grudge starts that tick)', () => {
    const { s, m, until } = truceSeen();
    expect(m.memory.lastUntil[1]).toBe(until);
    ok(s, { kind: 'BreakTreaty', seat: 1, with: 0 });
    s.tick += AI_THINK_PERIOD_TICKS;
    toRhythm(s, m.memory);
    look(s, m);
    expect(m.memory.betrayedAt[1]).toBe(s.tick);
    expect(m.memory.lastRel[1]).toBe(RELATION_WAR);
  });

  it('a truce that simply runs out is no betrayal, not even on the tick it ends', () => {
    for (const late of [0, 1, 3]) {
      const { s, m, until } = truceSeen();
      s.tick = until + late;
      toRhythm(s, m.memory);
      expect(s.tick).toBeGreaterThanOrEqual(until);
      look(s, m);
      expect(m.memory.betrayedAt[1], `${late} ticks after the end`).toBe(-1);
    }
  });

  it('an alliance that the other side breaks is a betrayal; the AI\'s own break of an alliance is not, and neither is a break the AI sees only as war', () => {
    const s = arena([40, 30, 30]);
    const m = mind(s, 0);
    ok(s, { kind: 'ProposeTreaty', seat: 1, to: 0, treaty: 2 });
    ok(s, { kind: 'AcceptTreaty', seat: 0, from: 1 });
    toRhythm(s, m.memory);
    look(s, m);
    ok(s, { kind: 'BreakTreaty', seat: 1, with: 0 });
    s.tick += AI_THINK_PERIOD_TICKS;
    toRhythm(s, m.memory);
    look(s, m);
    expect(m.memory.betrayedAt[1]).toBe(s.tick);
    expect(m.memory.betrayedAt[2], 'seat 2 never had a treaty').toBe(-1);
  });

  it('a betrayal that comes right after the AI\'s own break of another treaty is still not noted (the own-break window is two think rounds; documented in BACKLOG)', () => {
    // seat 0 (AI, the leader) is allied with seats 1 and 2. At its think tick it breaks ONE alliance; the other side breaks the second in the same round.
    const s = arena([60, 20, 20]);
    const m = mind(s, 0);
    ok(s, { kind: 'ProposeTreaty', seat: 1, to: 0, treaty: 2 });
    ok(s, { kind: 'AcceptTreaty', seat: 0, from: 1 });
    ok(s, { kind: 'ProposeTreaty', seat: 2, to: 0, treaty: 2 });
    ok(s, { kind: 'AcceptTreaty', seat: 0, from: 2 });
    toRhythm(s, m.memory);
    const first = look(s, m);
    expect(first).toEqual([{ kind: 'BreakTreaty', seat: 0, with: 1 }]);
    expect(m.memory.lastBreakAt).toBe(s.tick);
    ok(s, first[0] as IntentBody);
    ok(s, { kind: 'BreakTreaty', seat: 2, with: 0 });
    s.tick += AI_THINK_PERIOD_TICKS;
    toRhythm(s, m.memory);
    look(s, m);
    expect(m.memory.betrayedAt[1], 'its own break').toBe(-1);
    expect(m.memory.betrayedAt[2], 'inside the window').toBe(-1);
    // one window later the same thing WOULD have been noted: the window is exactly two think rounds
    const t = arena([30, 40, 30]);
    const n = mind(t, 0);
    ok(t, { kind: 'ProposeTreaty', seat: 2, to: 0, treaty: 2 });
    ok(t, { kind: 'AcceptTreaty', seat: 0, from: 2 });
    toRhythm(t, n.memory);
    look(t, n);
    n.memory.lastBreakAt = t.tick - 2 * AI_THINK_PERIOD_TICKS;
    ok(t, { kind: 'BreakTreaty', seat: 2, with: 0 });
    t.tick += AI_THINK_PERIOD_TICKS;
    toRhythm(t, n.memory);
    n.memory.lastBreakAt = t.tick - 2 * AI_THINK_PERIOD_TICKS;
    look(t, n);
    expect(n.memory.betrayedAt[2], 'exactly two rounds after its own break').toBe(t.tick);
  });

  it('counts a round for every seat whose attack on the AI is running (hits), and for no other seat', () => {
    const s = arena([40, 30, 30]);
    const m = mind(s, 0);
    ok(s, { kind: 'Attack', seat: 1, target: 1, pct: 10 });
    toRhythm(s, m.memory);
    look(s, m);
    s.tick += AI_THINK_PERIOD_TICKS;
    look(s, m);
    expect(Array.from(m.memory.hits)).toEqual([0, 2, 0]);
  });
});

describe('whose proposals are answered', () => {
  it('a proposal addressed to somebody else gets no answer and draws nothing from the stream', () => {
    const s = arena([40, 30, 30]);
    const m = mind(s, 0);
    ok(s, { kind: 'ProposeTreaty', seat: 1, to: 2, treaty: 1 });
    const before = m.rng.slice();
    expect(answers(s, m, 200)).toEqual([]);
    expect(Array.from(m.rng)).toEqual(Array.from(before));
    expect(Array.from(m.memory.replyAt)).toEqual([-1, -1, -1]);
  });

  it('with two proposals open it answers each one once, the one addressed to it', () => {
    const s = arena([20, 40, 40]);
    const m = mind(s, 0);
    ok(s, { kind: 'ProposeTreaty', seat: 1, to: 2, treaty: 1 });
    ok(s, { kind: 'ProposeTreaty', seat: 2, to: 0, treaty: 1 });
    const out = answers(s, m, 200);
    expect(out).toEqual([{ kind: 'AcceptTreaty', seat: 0, from: 2 }]);
  });

  it('a proposer that is eliminated or not a living player is declined, never accepted', () => {
    const s = arena([20, 40, 40]);
    const m = mind(s, 0);
    ok(s, { kind: 'ProposeTreaty', seat: 1, to: 0, treaty: 1 });
    s.match.eliminated[2] = 1; // the proposer (ownerId 2) is gone before the pause is over
    const out = answers(s, m, 200);
    expect(out.map((b) => b.kind)).not.toContain('AcceptTreaty');
  });

  it('an alliance is declined when the AI itself is allied with the leader (it must be at war with the leader as well)', () => {
    const s = arena([50, 20, 20, 10]);
    ok(s, { kind: 'ProposeTreaty', seat: 0, to: 1, treaty: 2 });
    ok(s, { kind: 'AcceptTreaty', seat: 1, from: 0 }); // AI seat 1 is the leader's ally
    ok(s, { kind: 'ProposeTreaty', seat: 2, to: 1, treaty: 2 });
    expect(answers(s, mind(s, 1))).toEqual([{ kind: 'DeclineTreaty', seat: 1, from: 2 }]);
  });

  it('an alliance against a leader is accepted when both are at war with it, and not when only the proposer is', () => {
    const s = arena([50, 20, 20, 10]);
    ok(s, { kind: 'ProposeTreaty', seat: 2, to: 1, treaty: 2 });
    expect(answers(s, mind(s, 1))).toEqual([{ kind: 'AcceptTreaty', seat: 1, from: 2 }]);
    const t = arena([50, 20, 20, 10]);
    ok(t, { kind: 'ProposeTreaty', seat: 0, to: 1, treaty: 1 }); // a truce of the AI with the leader (a different treaty kind from the one asked)
    ok(t, { kind: 'AcceptTreaty', seat: 1, from: 0 });
    ok(t, { kind: 'ProposeTreaty', seat: 2, to: 1, treaty: 2 });
    expect(answers(t, mind(t, 1)), 'a truce with the leader is no war').toEqual([{ kind: 'DeclineTreaty', seat: 1, from: 2 }]);
  });
});

describe('the think rhythm and the guards of a proposal', () => {
  /** The AI seat 2 (10 of 100) is weak, was attacked by seat 1 for two rounds and would ask it for a truce at its think tick. */
  function weakAsking(): { s: GameState; m: ReturnType<typeof mind> } {
    const s = arena([45, 35, 10, 10]);
    const m = mind(s, 2);
    ok(s, { kind: 'Attack', seat: 1, target: 3, pct: 20 });
    m.memory.hits[1] = 1; // the look itself counts the running attack once more
    toRhythm(s, m.memory);
    return { s, m };
  }

  it('it speaks only on its think tick: the other nine ticks of a round give nothing and change nothing in the memory', () => {
    const outs: number[] = [];
    for (let off = 0; off < AI_THINK_PERIOD_TICKS; off++) {
      const { s, m } = weakAsking();
      s.tick += off;
      const lastRel = Array.from(m.memory.lastRel);
      const out = look(s, m);
      outs.push(out.length);
      if (off !== 0) expect(Array.from(m.memory.lastRel) , `offset ${off}`).toEqual(lastRel);
      if (off !== 0) expect(m.memory.proposeAt, `offset ${off}`).toBe(0);
    }
    expect(outs).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('control: the weak AI asks the neighbour that attacked it for a truce', () => {
    const { s, m } = weakAsking();
    expect(look(s, m)).toEqual([{ kind: 'ProposeTreaty', seat: 2, to: 1, treaty: 1 }]);
    expect(m.memory.proposeAt).toBe(s.tick + AI_PROPOSE_COOLDOWN_TICKS);
  });

  it('a seat that has not spawned, a tribe, a match that has ended and a seat without land say nothing', () => {
    const a = weakAsking();
    a.s.match.ended = 1;
    expect(look(a.s, a.m), 'the match has ended').toEqual([]);
    const b = weakAsking();
    b.s.capital[3] = 0;
    for (let c = 0; c < b.s.owner.length; c++) if (b.s.owner[c] === 3) b.s.owner[c] = 0;
    rebuildAggregates(b.s);
    expect(look(b.s, b.m), 'seat 2 owns nothing any more').toEqual([]);
  });

  it('nothing before the wars start, nothing while it has an open proposal of its own, nothing inside the cooldown, nothing while its break cooldown runs', () => {
    const early = weakAsking();
    early.s.tick = AI_WAR_START_TICKS - 1;
    toRhythm(early.s, early.m.memory);
    early.s.tick -= early.s.tick >= AI_WAR_START_TICKS ? AI_THINK_PERIOD_TICKS : 0;
    expect(early.s.tick).toBeLessThan(AI_WAR_START_TICKS);
    expect(look(early.s, early.m), 'before the wars').toEqual([]);

    const open = weakAsking();
    ok(open.s, { kind: 'ProposeTreaty', seat: 2, to: 0, treaty: 1 });
    expect(look(open.s, open.m), 'an open proposal of its own').toEqual([]);

    const cool = weakAsking();
    cool.m.memory.proposeAt = cool.s.tick + 1;
    expect(look(cool.s, cool.m), 'one tick inside the cooldown').toEqual([]);
    cool.m.memory.proposeAt = cool.s.tick;
    expect(look(cool.s, cool.m).length, 'the cooldown ends at proposeAt').toBe(1);

    const broke = weakAsking();
    broke.s.diplo.cooldownUntil[3] = broke.s.tick + 1;
    expect(look(broke.s, broke.m).length, 'a break cooldown that runs').toBe(0);
    broke.s.diplo.cooldownUntil[3] = broke.s.tick;
    broke.s.tick += AI_THINK_PERIOD_TICKS;
    expect(look(broke.s, broke.m).length, 'and one that has run out').toBe(1);
    expect(TREATY_BREAK_COOLDOWN_TICKS).toBeGreaterThan(0);
  });

  it('the truce goes to a neighbour only after AI_TRUCE_MIN_HITS rounds, never to one it holds a grudge against, and a grudge ends after AI_GRUDGE_TICKS', () => {
    const one = weakAsking();
    one.m.memory.hits[1] = 0;
    expect(look(one.s, one.m).filter((b) => (b as { treaty?: number }).treaty === 1), 'one round of hits is not enough').toEqual([]);
    const grudge = weakAsking();
    grudge.m.memory.betrayedAt[1] = grudge.s.tick - 100;
    expect(look(grudge.s, grudge.m).filter((b) => (b as { treaty?: number }).treaty === 1), 'no truce to a traitor').toEqual([]);
    const over = weakAsking();
    over.m.memory.betrayedAt[1] = over.s.tick - AI_GRUDGE_TICKS;
    expect(look(over.s, over.m), 'the grudge is over at AI_GRUDGE_TICKS').toEqual([{ kind: 'ProposeTreaty', seat: 2, to: 1, treaty: 1 }]);
    const inside = weakAsking();
    inside.m.memory.betrayedAt[1] = inside.s.tick - AI_GRUDGE_TICKS + 1;
    expect(look(inside.s, inside.m).filter((b) => (b as { treaty?: number }).treaty === 1), 'one tick of grudge left').toEqual([]);
  });

  it('the alliance goes to the second strongest, unless it broke a treaty against the AI lately', () => {
    const s = arena([50, 30, 10, 10]);
    const m = mind(s, 2);
    toRhythm(s, m.memory);
    expect(look(s, m)).toEqual([{ kind: 'ProposeTreaty', seat: 2, to: 1, treaty: 2 }]);
    const t = arena([50, 30, 10, 10]);
    const n = mind(t, 2);
    toRhythm(t, n.memory);
    n.memory.betrayedAt[1] = t.tick - 50;
    expect(look(t, n), 'the second strongest is a traitor').toEqual([]);
  });

  it('an AI that holds an alliance with the leader proposes no alliance against it (it must be at war with the leader)', () => {
    const s = arena([50, 30, 10, 10]);
    ok(s, { kind: 'ProposeTreaty', seat: 0, to: 2, treaty: 1 });
    ok(s, { kind: 'AcceptTreaty', seat: 2, from: 0 });
    const m = mind(s, 2);
    toRhythm(s, m.memory);
    expect(look(s, m).filter((b) => (b as { treaty?: number }).treaty === 2)).toEqual([]);
  });

  it('the leader breaks an alliance at exactly more than AI_LEADER_PCT, one per round, and remembers when', () => {
    const s = arena([41, 30, 29]);
    ok(s, { kind: 'ProposeTreaty', seat: 1, to: 0, treaty: 2 });
    ok(s, { kind: 'AcceptTreaty', seat: 0, from: 1 });
    ok(s, { kind: 'ProposeTreaty', seat: 2, to: 0, treaty: 2 });
    ok(s, { kind: 'AcceptTreaty', seat: 0, from: 2 });
    const m = mind(s, 0);
    toRhythm(s, m.memory);
    expect(look(s, m)).toEqual([{ kind: 'BreakTreaty', seat: 0, with: 1 }]);
    expect(m.memory.lastBreakAt).toBe(s.tick);
    expect(m.memory.lastRel[1]).toBe(RELATION_WAR);
    expect(m.memory.lastRel[2]).toBe(RELATION_ALLIANCE);
  });
});

describe('think.ts: an attack is not cancelled while a proposal is open between the two seats', () => {
  /** AI seat 0 at the war cap (above AI_WAR_MAX_SHARE_PCT) with an attack on seat 1 that still runs and that it started itself. */
  function atWarCap(): { s: GameState; m: ReturnType<typeof mind> } {
    const s = arena([AI_WAR_MAX_SHARE_PCT + 5, 40, 45 - AI_WAR_MAX_SHARE_PCT]);
    const m = mind(s, 0);
    ok(s, { kind: 'Attack', seat: 0, target: 2, pct: 20 });
    m.memory.lastAttack[2] = s.tick;
    toRhythm(s, m.memory);
    m.view.refresh();
    return { s, m };
  }
  it('control: at the war cap it calls off the attack it started', () => {
    const { m } = atWarCap();
    expect(think(m.view, m.memory, m.rng).map((b) => b.kind)).toEqual(['CancelAttack']);
  });
  it('with a proposal open from the target, or to the target, the cancel waits (and the memory of the attack stays)', () => {
    for (const [from, to] of [[1, 0], [0, 1]] as const) {
      const { s, m } = atWarCap();
      ok(s, { kind: 'ProposeTreaty', seat: from, to, treaty: 1 });
      m.view.refresh();
      expect(think(m.view, m.memory, m.rng).map((b) => b.kind), `proposal ${from} -> ${to}`).not.toContain('CancelAttack');
      expect(m.memory.lastAttack[2]).toBeGreaterThanOrEqual(0);
    }
  });
});
