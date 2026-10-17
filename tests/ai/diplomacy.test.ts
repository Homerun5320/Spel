// M18c-1: the AI's diplomacy (src/ai/diplomacy.ts) in constructed positions with the real sim rules, and over 20 seeds on a small world.
import { describe, expect, it } from 'vitest';
import { AiDriver } from '../../src/host/aiDriver';
import { MainThreadHost } from '../../src/host/mainThreadHost';
import { createAiMemory, diplomacyMove, think, diplomacyWordCount, diplomacyWords, loadDiplomacyWords, type AiMemory } from '../../src/ai';
import { REJECT_DIPLO_TREATY_BOUND, withId, validateIntent, type IntentBody } from '../../src/sim/intents';
import { OUTBOX_REJECT } from '../../src/sim/outbox';
import {
  AI_GRUDGE_TICKS,
  AI_PROPOSE_COOLDOWN_TICKS,
  AI_THINK_PERIOD_TICKS,
  AI_WAR_START_TICKS,
  DIPLOMACY_REPLY_MAX_TICKS,
  DIPLOMACY_REPLY_MIN_TICKS,
} from '../../src/sim/rules';
import { createRng } from '../../src/sim/rng';
import * as pub from '../../src/sim/public';
import { RELATION_ALLIANCE, RELATION_WAR } from '../../src/sim/diplomacyTable';
import { applyIntent, step } from '../../src/sim/step';
import { createState, type GameState } from '../../src/sim/state';
import { setOwner } from '../../src/sim/territory';
import { CLASS_PLAINS } from '../../src/sim/terrain';
import { StateView } from '../../src/sim/view';
import { landState } from '../sim/helpers/worlds';

let ids = 1;
function send(s: GameState, body: IntentBody): number {
  const i = withId(body, ids++);
  const shape = validateIntent(i, { seats: s.header.seats, cells: s.width * s.height, debugIntents: false });
  return shape !== 0 ? shape : applyIntent(s, i);
}

/** Players left to right on a 100 x 10 plain, each owning the given percent of the columns (what is left stays unowned). */
function arena(shares: number[], seats = shares.length): GameState {
  const s = landState(100, 10, { seats, players: shares.length });
  let x = 0;
  shares.forEach((pct, i) => {
    for (let c = 0; c < pct; c++, x++) for (let y = 0; y < 10; y++) setOwner(s, y * 100 + x, i + 1, 0);
    s.troops[i + 1] = 200000;
    s.capital[i + 1] = x - pct + 1; // a spawned seat (the capital cell + 1)
  });
  s.tick = AI_WAR_START_TICKS + 1000;
  return s;
}

/** A memory (humans: nobody) and a rng for the seat. Its think rhythm is returned by `rhythm`. */
function mind(s: GameState, seat: number): { memory: AiMemory; rng: Uint32Array; view: StateView } {
  const view = new StateView(s);
  return { memory: createAiMemory(view, seat, { humanSeats: [] }), rng: createRng(1000 + seat), view };
}

/** Advances the tick (without running the sim) to the next think tick of the memory. */
function toRhythm(s: GameState, m: AiMemory): void {
  while ((s.tick + m.phase) % AI_THINK_PERIOD_TICKS !== 0) s.tick++;
}

/** Calls diplomacyMove tick by tick until it ANSWERS a proposal (the AI may make proposals of its own on the way, which are ignored here); returns [ticks waited, what]. */
function waitForWord(s: GameState, view: StateView, m: AiMemory, rng: Uint32Array, limit: number): [number, readonly IntentBody[]] {
  const t0 = s.tick;
  for (let n = 0; n <= limit; n++) {
    view.refresh();
    const out = diplomacyMove(view, m, rng).filter((b) => b.kind === 'AcceptTreaty' || b.kind === 'DeclineTreaty');
    if (out.length > 0) return [s.tick - t0, out];
    s.tick++;
  }
  return [limit + 1, []];
}

describe('answering proposals', () => {
  it('waits 30 to 60 ticks after it first sees a proposal, then answers it; a stronger proposer gets a truce', () => {
    for (let seed = 0; seed < 12; seed++) {
      const s = arena([40, 60]);
      const { memory, view } = mind(s, 0);
      const rng = createRng(seed);
      expect(send(s, { kind: 'ProposeTreaty', seat: 1, to: 0, treaty: 1 })).toBe(0);
      const [waited, out] = waitForWord(s, view, memory, rng, 100);
      expect(waited, `seed ${seed}`).toBeGreaterThanOrEqual(DIPLOMACY_REPLY_MIN_TICKS);
      expect(waited, `seed ${seed}`).toBeLessThanOrEqual(DIPLOMACY_REPLY_MAX_TICKS);
      expect(out).toEqual([{ kind: 'AcceptTreaty', seat: 0, from: 1 }]);
    }
  });

  it('the pause is drawn from the AI\'s own stream: the same stream, the same pause; the pauses are not all equal', () => {
    const pauses = new Set<number>();
    for (let seed = 0; seed < 12; seed++) {
      const wait = (): number => {
        const s = arena([40, 60]);
        const { memory, view } = mind(s, 0);
        send(s, { kind: 'ProposeTreaty', seat: 1, to: 0, treaty: 1 });
        return waitForWord(s, view, memory, createRng(seed), 100)[0];
      };
      expect(wait()).toBe(wait());
      pauses.add(wait());
    }
    expect(pauses.size).toBeGreaterThan(3);
  });

  it('draws nothing from the stream while nobody proposes', () => {
    const s = arena([40, 60]);
    const { memory, view } = mind(s, 0);
    const rng = createRng(5);
    const before = rng.slice();
    for (let n = 0; n < 300; n++) {
      s.tick++;
      view.refresh();
      diplomacyMove(view, memory, rng);
    }
    expect(Array.from(rng)).toEqual(Array.from(before));
  });

  /** The answer of AI seat `ai` to a proposal of `kind` by `from` in a position built by `setup`. */
  function answer(shares: number[], ai: number, from: number, kind: number, setup: (s: GameState) => void = () => undefined): string {
    const s = arena(shares);
    setup(s);
    const { memory, view } = mind(s, ai);
    expect(send(s, { kind: 'ProposeTreaty', seat: from, to: ai, treaty: kind })).toBe(0);
    const [, out] = waitForWord(s, view, memory, createRng(3), 120);
    return out.length === 0 ? 'silence' : (out[0] as IntentBody).kind;
  }
  const attack = (s: GameState, seat: number, target: number): void => void expect(send(s, { kind: 'Attack', seat, target, pct: 20 })).toBe(0);

  it('a truce: accepted from a stronger proposer or when fighting two others, declined from a weaker one', () => {
    expect(answer([40, 60], 0, 1, 1)).toBe('AcceptTreaty');
    expect(answer([60, 40], 0, 1, 1)).toBe('DeclineTreaty');
    // AI seat 1 sits between seats 0 and 2; seat 3 (the weakest) asks. Two attacks on the AI (from 0 and 2) make it accept.
    expect(answer([30, 40, 20, 10], 1, 3, 1)).toBe('DeclineTreaty');
    expect(answer([30, 40, 20, 10], 1, 3, 1, (s) => { attack(s, 0, 2); attack(s, 2, 2); })).toBe('AcceptTreaty');
    // M18c-2: one war with another party is enough when the proposer is not the leader; a leader asking while the AI holds the median is still declined; below the median accepts
    expect(answer([30, 40, 20, 10], 1, 3, 1, (s) => attack(s, 0, 2))).toBe('AcceptTreaty');
    expect(answer([30, 40, 20, 10], 0, 1, 1, (s) => attack(s, 3, 1)), 'the proposer is the leader').toBe('DeclineTreaty');
    expect(answer([30, 40, 20, 10], 2, 1, 1), 'below the median, no war at all').toBe('AcceptTreaty');
    expect(answer([30, 40, 20, 10], 0, 3, 1), 'at the median, no war').toBe('DeclineTreaty');
  });

  it('an alliance: only from a proposer of at most 25 percent and against a leader above 25 percent that is at war with both', () => {
    expect(answer([50, 20, 20, 10], 1, 2, 2)).toBe('AcceptTreaty');
    expect(answer([45, 20, 25, 10], 1, 2, 2), 'exactly 25 percent is still allowed').toBe('AcceptTreaty');
    expect(answer([45, 20, 26, 9], 1, 2, 2), 'the proposer is too strong').toBe('DeclineTreaty');
    expect(answer([25, 25, 25, 25], 1, 2, 2), 'a leader at exactly 25 percent is no leader').toBe('DeclineTreaty');
    expect(answer([30, 25, 25, 20], 1, 2, 2), 'a leader at 30 percent is one since M18c-2').toBe('AcceptTreaty');
    expect(answer([50, 20, 20, 10], 1, 2, 2, (s) => {
      send(s, { kind: 'ProposeTreaty', seat: 0, to: 2, treaty: 2 });
      send(s, { kind: 'AcceptTreaty', seat: 2, from: 0 });
    }), 'the leader is the proposer\'s ally').toBe('DeclineTreaty');
    expect(answer([20, 50, 20, 10], 1, 2, 2), 'the AI is the leader itself').toBe('DeclineTreaty');
    expect(answer([50, 20, 20, 10], 1, 2, 1) , 'a truce from a weaker proposer, no wars').toBe('DeclineTreaty');
  });

  it('never makes a treaty with a seat that broke one against it in the last five minutes, and does again afterwards', () => {
    const s = arena([40, 30, 30]);
    const { memory, view } = mind(s, 0);
    const rng = createRng(2);
    // an alliance with seat 1 that the AI sees, then seat 1 breaks it
    send(s, { kind: 'ProposeTreaty', seat: 1, to: 0, treaty: 2 });
    send(s, { kind: 'AcceptTreaty', seat: 0, from: 1 });
    toRhythm(s, memory);
    view.refresh();
    diplomacyMove(view, memory, rng);
    expect(memory.lastRel[1]).toBe(RELATION_ALLIANCE);
    send(s, { kind: 'BreakTreaty', seat: 1, with: 0 });
    s.tick += AI_THINK_PERIOD_TICKS;
    toRhythm(s, memory);
    view.refresh();
    diplomacyMove(view, memory, rng);
    expect(memory.betrayedAt[1]).toBe(s.tick);
    const later = s.tick;
    // seat 1 is the cooldown holder; let it pass and propose a truce that the AI would otherwise accept (seat 1 is weaker: share 30 against 40 -> use seat 2 as control)
    s.tick = later + 2000;
    s.diplo.cooldownUntil[2] = 0;
    send(s, { kind: 'ProposeTreaty', seat: 1, to: 0, treaty: 1 });
    send(s, { kind: 'Attack', seat: 0, target: 3, pct: 10 }); // fights seat 2 ... and seat 1 is not at war with it: no effect on the decision
    expect(waitForWord(s, view, memory, rng, 100)[1][0]?.kind).toBe('DeclineTreaty');
    // after AI_GRUDGE_TICKS the same proposal is judged on its merits again (the AI is below the median and the proposer is stronger: accepted by the merits)
    const s2 = arena([20, 40, 40]);
    const m2 = mind(s2, 0);
    m2.memory.betrayedAt[1] = s2.tick - AI_GRUDGE_TICKS + 200; // 200 ticks of grudge left
    send(s2, { kind: 'ProposeTreaty', seat: 1, to: 0, treaty: 1 });
    expect(waitForWord(s2, m2.view, m2.memory, createRng(4), 100)[1][0]?.kind, 'inside the grudge').toBe('DeclineTreaty');
    const s3 = arena([20, 40, 40]);
    const m3 = mind(s3, 0);
    m3.memory.betrayedAt[1] = s3.tick - AI_GRUDGE_TICKS - 1;
    send(s3, { kind: 'ProposeTreaty', seat: 1, to: 0, treaty: 1 });
    expect(waitForWord(s3, m3.view, m3.memory, createRng(4), 100)[1][0]?.kind, 'after the grudge').toBe('AcceptTreaty');
  });

  it('forgets the pause of a proposal that is gone, and a tribe, an unspawned seat and the spawn phase say nothing', () => {
    const s = arena([40, 60]);
    const { memory, view } = mind(s, 0);
    const rng = createRng(1);
    send(s, { kind: 'ProposeTreaty', seat: 1, to: 0, treaty: 1 });
    view.refresh();
    diplomacyMove(view, memory, rng);
    expect(memory.replyAt[1]).toBeGreaterThan(0);
    send(s, { kind: 'DeclineTreaty', seat: 0, from: 1 });
    diplomacyMove(view, memory, rng);
    expect(memory.replyAt[1]).toBe(-1);
    const t = arena([40, 40, 20], 4); // seat 3 is a tribe without land
    send(t, { kind: 'ProposeTreaty', seat: 1, to: 0, treaty: 1 });
    const tm = mind(t, 3);
    expect(diplomacyMove(tm.view, tm.memory, tm.rng)).toEqual([]);
    const u = createState({ width: 20, height: 4, seed: 1, seats: 3, players: 3, config: { debugIntents: false, spawnPhase: true }, terrain: new Uint8Array(80).fill(CLASS_PLAINS), elevation: new Uint16Array(80) });
    const um = mind(u, 0);
    expect(diplomacyMove(um.view, um.memory, um.rng)).toEqual([]);
  });
});

describe('proposing and breaking', () => {
  it('a weak AI proposes a truce to the strongest neighbour that attacked it, once per 60 seconds, and not before the wars start', () => {
    const s = arena([45, 35, 10, 10]);
    expect(send(s, { kind: 'Attack', seat: 1, target: 3, pct: 20 })).toBe(0); // seat 1 (35 percent) attacks seat 2 (10 percent)
    const { memory, view, rng } = mind(s, 2);
    s.tick = AI_WAR_START_TICKS - 1;
    toRhythm(s, memory);
    s.tick -= AI_THINK_PERIOD_TICKS * Math.ceil((s.tick - AI_WAR_START_TICKS + 2) / AI_THINK_PERIOD_TICKS);
    view.refresh();
    expect(s.tick).toBeLessThan(AI_WAR_START_TICKS);
    expect(diplomacyMove(view, memory, rng), 'before AI_WAR_START_TICKS').toEqual([]);
    s.tick = AI_WAR_START_TICKS + 100;
    toRhythm(s, memory);
    const first = s.tick;
    view.refresh();
    const out = diplomacyMove(view, memory, rng);
    expect(out).toEqual([{ kind: 'ProposeTreaty', seat: 2, to: 1, treaty: 1 }]);
    expect(send(s, out[0] as IntentBody)).toBe(0);
    // an open proposal of its own, then the cooldown: nothing more
    s.tick = first + AI_THINK_PERIOD_TICKS;
    expect(diplomacyMove(view, memory, rng)).toEqual([]);
    send(s, { kind: 'DeclineTreaty', seat: 1, from: 2 });
    s.tick = first + AI_PROPOSE_COOLDOWN_TICKS - AI_THINK_PERIOD_TICKS;
    expect(diplomacyMove(view, memory, rng), 'inside the 60 seconds').toEqual([]);
    s.tick = first + AI_PROPOSE_COOLDOWN_TICKS;
    expect(diplomacyMove(view, memory, rng).length, 'after them').toBe(1);
  });

  it('M18c-2: the truce goes to the neighbour that attacked most often (not the strongest), and only after AI_TRUCE_MIN_HITS rounds', () => {
    const s = arena([10, 25, 10, 35]);
    const { memory, view, rng } = mind(s, 2); // weak (10 percent against a median of 25), between seats 1 and 3
    s.tick = AI_WAR_START_TICKS + 100;
    toRhythm(s, memory);
    expect(send(s, { kind: 'Attack', seat: 1, target: 3, pct: 20 })).toBe(0); // seat 1 attacks the AI
    view.refresh();
    expect(diplomacyMove(view, memory, rng), 'one round is not enough').toEqual([]);
    expect(memory.hits[1]).toBe(1);
    // seat 3 (the stronger) attacks too, but only from the second round on: seat 1 has the higher count, so it gets the proposal although seat 3 is stronger
    expect(send(s, { kind: 'Attack', seat: 3, target: 3, pct: 20 })).toBe(0);
    s.tick += AI_THINK_PERIOD_TICKS;
    view.refresh();
    expect(diplomacyMove(view, memory, rng)).toEqual([{ kind: 'ProposeTreaty', seat: 2, to: 1, treaty: 1 }]);
    expect(memory.hits[1]).toBe(2);
    expect(memory.hits[3]).toBe(1);
  });

  it('an AI that is not weak, or was not attacked, proposes no truce', () => {
    const s = arena([45, 35, 10, 10]);
    const a = mind(s, 1); // 35 percent, not weak
    toRhythm(s, a.memory);
    send(s, { kind: 'Attack', seat: 0, target: 2, pct: 20 });
    a.view.refresh();
    expect(diplomacyMove(a.view, a.memory, a.rng).filter((x) => (x as { treaty?: number }).treaty === 1)).toEqual([]);
    const b = mind(s, 3); // weak but nobody attacked it
    toRhythm(s, b.memory);
    expect(diplomacyMove(b.view, b.memory, b.rng).filter((x) => x.kind === 'ProposeTreaty' && (x as { treaty: number }).treaty === 1)).toEqual([]);
  });

  it('an AI proposes an alliance to the strongest player that is not the leader when a leader holds more than 40 percent', () => {
    const s = arena([50, 30, 10, 10]);
    const { memory, view, rng } = mind(s, 2);
    toRhythm(s, memory);
    view.refresh();
    expect(diplomacyMove(view, memory, rng)).toEqual([{ kind: 'ProposeTreaty', seat: 2, to: 1, treaty: 2 }]);
    // exactly 40 percent is no leader
    const t = arena([40, 30, 20, 10]);
    const m = mind(t, 2);
    toRhythm(t, m.memory);
    m.view.refresh();
    expect(diplomacyMove(m.view, m.memory, m.rng)).toEqual([]);
    // the leader itself proposes nothing of the kind, and an AI already allied with the leader proposes nothing
    const u = arena([50, 30, 10, 10]);
    const l = mind(u, 0);
    toRhythm(u, l.memory);
    l.view.refresh();
    expect(diplomacyMove(l.view, l.memory, l.rng)).toEqual([]);
  });

  it('an AI that has become the leader (above 40 percent) breaks its alliance; the betrayal is counted for it, and its cooldown starts', () => {
    const s = arena([50, 30, 20]);
    send(s, { kind: 'ProposeTreaty', seat: 1, to: 0, treaty: 2 });
    send(s, { kind: 'AcceptTreaty', seat: 0, from: 1 });
    const { memory, view, rng } = mind(s, 0);
    toRhythm(s, memory);
    view.refresh();
    const out = diplomacyMove(view, memory, rng);
    expect(out).toEqual([{ kind: 'BreakTreaty', seat: 0, with: 1 }]);
    expect(send(s, out[0] as IntentBody)).toBe(0);
    expect(s.match.treatiesBroken[1]).toBe(1);
    expect(view.diplomacy.breakCooldownLeft(0)).toBeGreaterThan(0);
    expect(view.diplomacy.relation(0, 1)).toBe(RELATION_WAR);
    // its own break is not noted as somebody else's betrayal
    s.tick += AI_THINK_PERIOD_TICKS;
    toRhythm(s, memory);
    diplomacyMove(view, memory, rng);
    expect(memory.betrayedAt[1]).toBe(-1);
    // a smaller AI (below 40 percent) keeps its alliance
    const t = arena([40, 40, 20]);
    send(t, { kind: 'ProposeTreaty', seat: 1, to: 0, treaty: 2 });
    send(t, { kind: 'AcceptTreaty', seat: 0, from: 1 });
    const k = mind(t, 0);
    toRhythm(t, k.memory);
    k.view.refresh();
    expect(diplomacyMove(k.view, k.memory, k.rng).filter((x) => x.kind === 'BreakTreaty')).toEqual([]);
  });

  it('the AI\'s attacks leave treaty parties alone (think respects the ban), and it attacks them again at war', () => {
    const attacks = (treaty: boolean): number => {
      const s = arena([10, 10]);
      if (treaty) {
        send(s, { kind: 'ProposeTreaty', seat: 1, to: 0, treaty: 1 });
        send(s, { kind: 'AcceptTreaty', seat: 0, from: 1 });
      }
      s.troops[1] = 2000000;
      s.troops[2] = 100;
      const { memory, view, rng } = mind(s, 0);
      let n = 0;
      for (let t = 0; t < 60; t++) {
        view.refresh();
        n += think(view, memory, rng).filter((b) => b.kind === 'Attack' && (b as { target: number }).target === 2).length;
        s.tick++;
      }
      return n;
    };
    expect(attacks(false), 'control: at war the stronger AI attacks').toBeGreaterThan(0);
    expect(attacks(true)).toBe(0);
  });
});

describe('the memory', () => {
  it('the diplomacy words round trip, and a blob of the wrong length is refused', () => {
    const s = arena([40, 60]);
    const { memory } = mind(s, 0);
    memory.proposeAt = 777;
    memory.lastBreakAt = 555;
    memory.replyAt[1] = 123;
    memory.betrayedAt[1] = 99;
    memory.lastRel[1] = 2;
    memory.lastUntil[1] = 4242;
    memory.hits[1] = 7;
    const words = diplomacyWords(memory);
    expect(words.length).toBe(diplomacyWordCount(memory));
    const other = mind(s, 0).memory;
    expect(loadDiplomacyWords(other, words)).toBe(true);
    expect([other.proposeAt, other.lastBreakAt, other.replyAt[1], other.betrayedAt[1], other.lastRel[1], other.lastUntil[1], other.hits[1]]).toEqual([777, 555, 123, 99, 2, 4242, 7]);
    expect(loadDiplomacyWords(other, words.slice(1))).toBe(false);
  });

  it('the AI blob carries the diplomacy memory: save, restore, and the restored driver continues like the original', () => {
    const run = (cut: boolean): string => {
      const s = arena([20, 30, 30, 20]);
      const driver = new AiDriver(7, { humanSeats: [] });
      let d = driver;
      const view = new StateView(s);
      send(s, { kind: 'ProposeTreaty', seat: 1, to: 0, treaty: 1 });
      const log: string[] = [];
      for (let n = 0; n < 200; n++) {
        view.refresh();
        d.onTick(view, (b) => log.push(`${s.tick}:${b.kind}:${b.seat}`));
        if (cut && n === 20) {
          const blob = d.serialize();
          d = new AiDriver(7, { humanSeats: [] });
          d.onTick(view, () => undefined);
          expect(d.restore(blob)).toBe(true);
        }
        s.tick++;
      }
      return log.join(',');
    };
    const a = run(false);
    expect(a).toContain('Accept'); // somebody answered the proposal
    expect(run(true)).toBe(a);
  });
});

describe('20 seeds: the AI never sends an intent the rules refuse', () => {
  /** A small world with 6 nations and 2 tribes; the AI plays every seat. */
  function match(seed: number): GameState {
    return createState({ width: 128, height: 64, seed, seats: 8, players: 6, config: { debugIntents: false, spawnPhase: true }, terrain: new Uint8Array(128 * 64).fill(CLASS_PLAINS), elevation: new Uint16Array(128 * 64) });
  }

  it('every diplomacy intent is valid when it is sent; the refusals that come back are rare races', () => {
    let sent = 0;
    let diplo = 0;
    let treaties = 0;
    let breaks = 0;
    let invalidAtSend = 0;
    let refused = 0;
    let bound = 0;
    const kinds = new Map<string, number>();
    for (let seed = 1; seed <= 20; seed++) {
      const state = match(seed);
      const ai = new AiDriver(seed, { humanSeats: [] });
      const view = new StateView(state);
      const driver = {
        onTick(v: pub.SimView, submit: (b: IntentBody) => void): void {
          ai.onTick(v, (b) => {
            sent++;
            const why =
              b.kind === 'ProposeTreaty' ? pub.validateProposeTreaty(v, b.seat, b.to, b.treaty)
              : b.kind === 'AcceptTreaty' ? pub.validateAcceptTreaty(v, b.seat, b.from)
              : b.kind === 'DeclineTreaty' ? pub.validateDeclineTreaty(v, b.seat, b.from)
              : b.kind === 'BreakTreaty' ? pub.validateBreakTreaty(v, b.seat, b.with)
              : b.kind === 'Attack' && b.target !== 0 && v.diplomacy.relation(b.seat, b.target - 1) !== RELATION_WAR ? REJECT_DIPLO_TREATY_BOUND
              : 0;
            if (b.kind === 'ProposeTreaty' || b.kind === 'AcceptTreaty' || b.kind === 'DeclineTreaty' || b.kind === 'BreakTreaty') {
              diplo++;
              kinds.set(b.kind, (kinds.get(b.kind) ?? 0) + 1);
              if (b.kind === 'AcceptTreaty') treaties++;
              if (b.kind === 'BreakTreaty') breaks++;
            }
            if (why !== 0) invalidAtSend++;
            submit(b);
          });
        },
      };
      void view;
      const host = new MainThreadHost(state, {
        driver,
        stepFn: (st, turn) => {
          const r = step(st, turn);
          for (const ev of st.outbox.drain()) {
            if (ev.kind === OUTBOX_REJECT && ev.a >= 80) {
              refused++;
              if (ev.a === REJECT_DIPLO_TREATY_BOUND) bound++;
            }
            st.outbox.push(ev.kind, ev.tick, ev.a, ev.b);
          }
          return r;
        },
      });
      host.runTicks(4500);
    }
    console.log(`[M18c-1 AI over 20 seeds x 4500 ticks] sent ${sent}, diplomacy ${diplo} (${[...kinds].map(([k, n]) => `${k} ${n}`).join(', ')}), refused at the sim ${refused} (attack ban ${bound})`);
    expect(invalidAtSend).toBe(0);
    expect(diplo, 'the AI talked at all').toBeGreaterThan(0);
    expect(treaties).toBeGreaterThan(0);
    expect(breaks).toBeGreaterThanOrEqual(0);
    // an intent that was valid when sent can be overtaken by another seat's intent of the same tick (T + 2): a small fraction at most
    expect(refused).toBeLessThanOrEqual(Math.max(2, Math.floor(sent / 100)));
  }, 120_000);
});
