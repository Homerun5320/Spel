// M18c-1: diplomacy in the sim: relations, proposals, the attack ban, betrayal, embargo and alliance trade, elimination, serialisation, the hash and the page's copy.
// Every test drives the real intent path (validateIntent + applyIntent / step), so removing a rule fails here.
import { describe, expect, it } from 'vitest';
import { MainThreadHost } from '../../src/host/mainThreadHost';
import { ViewMirror } from '../../src/host/viewMirror';
import { cancelAttacksBetween } from '../../src/sim/conquest';
import { DiplomacyReader, RELATION_ALLIANCE, RELATION_TRUCE, RELATION_WAR, TREATY_ALLIANCE, TREATY_TRUCE } from '../../src/sim/diplomacyTable';
import { decodeTurn, encodeTurn } from '../../src/sim/codec';
import { compareIntents, copyBody, withId, validateIntent, type Intent, type IntentBody } from '../../src/sim/intents';
import * as intents from '../../src/sim/intents';
import {
  PORT_GOLD_MILLI_PER_SEC,
  TRADE_ALLIANCE_PCT,
  PROPOSAL_CAPACITY,
  PROPOSAL_TTL_TICKS,
  TREATY_BREAK_COOLDOWN_TICKS,
  TRUCE_TICKS,
} from '../../src/sim/rules';
import * as pub from '../../src/sim/public';
import { deserialize, hashState, serialize } from '../../src/sim/serialize';
import { applyIntent, step } from '../../src/sim/step';
import { createState, type GameState } from '../../src/sim/state';
import { setOwner } from '../../src/sim/territory';
import { STRUCT_PORT } from '../../src/sim/structureRules';
import { structGoldMilliPerSec, tradeMilliPerSec } from '../../src/sim/structureEffects';
import { PORT_GOLD_MILLI_BY_LEVEL } from '../../src/sim/levelCurves';
import { CLASS_PLAINS } from '../../src/sim/terrain';
import { StateView } from '../../src/sim/view';
import { landState } from './helpers/worlds';

let ids = 1;
const ctxOf = (s: GameState) => ({ seats: s.header.seats, cells: s.width * s.height, debugIntents: false });

/** Sends one intent the way step() would (shape check, then the rules). Returns the reason, 0 = applied. */
function send(s: GameState, body: IntentBody): number {
  const i = withId(body, ids++);
  const shape = validateIntent(i, ctxOf(s));
  return shape !== 0 ? shape : applyIntent(s, i);
}

/** Four blocks of 10 columns on a 40 x 6 plain: owner 1 | 2 | 3 | 4 (4 is a tribe when players = 3). Owners 1 and 2 touch, 2 and 3 touch. */
function arena(seats = 4, players = 3): GameState {
  const s = landState(40, 6, { seats, players });
  for (let y = 0; y < 6; y++) for (let x = 0; x < 40; x++) setOwner(s, y * 40 + x, Math.min(seats, 1 + Math.floor(x / 10)), 0);
  for (let o = 1; o <= seats; o++) s.troops[o] = 200000;
  return s;
}

const view = (s: GameState): StateView => new StateView(s);
const rel = (s: GameState, a: number, b: number): number => view(s).diplomacy.relation(a, b);
const truce = (s: GameState, a: number, b: number): void => {
  expect(send(s, { kind: 'ProposeTreaty', seat: a, to: b, treaty: TREATY_TRUCE })).toBe(0);
  expect(send(s, { kind: 'AcceptTreaty', seat: b, from: a })).toBe(0);
};
const alliance = (s: GameState, a: number, b: number): void => {
  expect(send(s, { kind: 'ProposeTreaty', seat: a, to: b, treaty: TREATY_ALLIANCE })).toBe(0);
  expect(send(s, { kind: 'AcceptTreaty', seat: b, from: a })).toBe(0);
};

describe('the reason codes and the one shared check', () => {
  /** [name, expected reason, setup, the intent]. The public validate* function must give the very same answer as the sim. */
  const R = intents;
  const cases: Array<[string, number, (s: GameState) => void, IntentBody]> = [
    ['NOT_PLAYER: a tribe as target', R.REJECT_DIPLO_NOT_PLAYER, () => undefined, { kind: 'ProposeTreaty', seat: 0, to: 3, treaty: 1 }],
    ['NOT_PLAYER: a tribe as sender', R.REJECT_DIPLO_NOT_PLAYER, () => undefined, { kind: 'ImposeEmbargo', seat: 3, target: 0 }],
    ['SELF', R.REJECT_DIPLO_SELF, () => undefined, { kind: 'ProposeTreaty', seat: 1, to: 1, treaty: 1 }],
    ['AT_PEACE: truce while truce', R.REJECT_DIPLO_AT_PEACE, (s) => truce(s, 0, 1), { kind: 'ProposeTreaty', seat: 0, to: 1, treaty: 1 }],
    ['AT_PEACE: truce while allied', R.REJECT_DIPLO_ALLIED, (s) => alliance(s, 0, 1), { kind: 'ProposeTreaty', seat: 0, to: 1, treaty: 1 }],
    ['ALLIED: alliance while allied', R.REJECT_DIPLO_ALLIED, (s) => alliance(s, 0, 1), { kind: 'ProposeTreaty', seat: 1, to: 0, treaty: 2 }],
    ['PENDING', R.REJECT_DIPLO_PENDING, (s) => void send(s, { kind: 'ProposeTreaty', seat: 0, to: 1, treaty: 1 }), { kind: 'ProposeTreaty', seat: 0, to: 1, treaty: 2 }],
    ['NO_PROPOSAL: accept', R.REJECT_DIPLO_NO_PROPOSAL, () => undefined, { kind: 'AcceptTreaty', seat: 1, from: 0 }],
    ['NO_PROPOSAL: decline of the wrong direction', R.REJECT_DIPLO_NO_PROPOSAL, (s) => void send(s, { kind: 'ProposeTreaty', seat: 0, to: 1, treaty: 1 }), { kind: 'DeclineTreaty', seat: 0, from: 1 }],
    ['COOLDOWN', R.REJECT_DIPLO_COOLDOWN, (s) => { alliance(s, 0, 1); send(s, { kind: 'BreakTreaty', seat: 0, with: 1 }); }, { kind: 'ProposeTreaty', seat: 0, to: 2, treaty: 1 }],
    ['NO_TREATY', R.REJECT_DIPLO_NO_TREATY, () => undefined, { kind: 'BreakTreaty', seat: 0, with: 1 }],
    ['ELIMINATED: target', R.REJECT_DIPLO_ELIMINATED, (s) => void (s.match.eliminated[2] = 1), { kind: 'ProposeTreaty', seat: 0, to: 1, treaty: 1 }],
    ['ELIMINATED: sender', R.REJECT_DIPLO_ELIMINATED, (s) => void (s.match.eliminated[1] = 1), { kind: 'ImposeEmbargo', seat: 0, target: 1 }],
    ['MATCH_ENDED', R.REJECT_DIPLO_MATCH_ENDED, (s) => void (s.match.ended = 1), { kind: 'ProposeTreaty', seat: 0, to: 1, treaty: 1 }],
    ['EMBARGO_SET', R.REJECT_DIPLO_EMBARGO_SET, (s) => void send(s, { kind: 'ImposeEmbargo', seat: 0, target: 1 }), { kind: 'ImposeEmbargo', seat: 0, target: 1 }],
    ['EMBARGO_NONE: nothing imposed', R.REJECT_DIPLO_EMBARGO_NONE, () => undefined, { kind: 'LiftEmbargo', seat: 0, target: 1 }],
    ['EMBARGO_NONE: only the other side imposed', R.REJECT_DIPLO_EMBARGO_NONE, (s) => void send(s, { kind: 'ImposeEmbargo', seat: 1, target: 0 }), { kind: 'LiftEmbargo', seat: 0, target: 1 }],
  ];
  for (const [name, expected, setup, body] of cases) {
    it(`${name} -> ${expected}, and validate* says the same`, () => {
      const s = arena();
      setup(s);
      const v = view(s);
      const fn = {
        ProposeTreaty: (b: IntentBody) => pub.validateProposeTreaty(v, b.seat, (b as { to: number }).to, (b as { treaty: number }).treaty),
        AcceptTreaty: (b: IntentBody) => pub.validateAcceptTreaty(v, b.seat, (b as { from: number }).from),
        DeclineTreaty: (b: IntentBody) => pub.validateDeclineTreaty(v, b.seat, (b as { from: number }).from),
        BreakTreaty: (b: IntentBody) => pub.validateBreakTreaty(v, b.seat, (b as { with: number }).with),
        ImposeEmbargo: (b: IntentBody) => pub.validateImposeEmbargo(v, b.seat, (b as { target: number }).target),
        LiftEmbargo: (b: IntentBody) => pub.validateLiftEmbargo(v, b.seat, (b as { target: number }).target),
      } as Record<string, (b: IntentBody) => number>;
      const before = hashState(s);
      expect(fn[body.kind]?.(body)).toBe(expected);
      expect(send(s, body)).toBe(expected);
      expect(hashState(s), 'a refused intent changes nothing').toBe(before === hashState(s) ? before : -1);
    });
  }

  it('REJECT_PHASE in the spawn phase', () => {
    const s = createState({ width: 20, height: 4, seed: 1, seats: 3, players: 3, config: { debugIntents: false, spawnPhase: true }, terrain: new Uint8Array(80).fill(CLASS_PLAINS), elevation: new Uint16Array(80) });
    expect(send(s, { kind: 'ProposeTreaty', seat: 0, to: 1, treaty: 1 })).toBe(intents.REJECT_PHASE);
    expect(pub.validateProposeTreaty(view(s), 0, 1, 1)).toBe(intents.REJECT_PHASE);
  });

  it('FULL: the 33rd open proposal is refused (capacity 32, one per directed pair)', () => {
    const s = arena(8, 8);
    let made = 0;
    for (let a = 0; a < 8 && made < PROPOSAL_CAPACITY; a++) {
      for (let b = 0; b < 8 && made < PROPOSAL_CAPACITY; b++) {
        if (a === b) continue;
        expect(send(s, { kind: 'ProposeTreaty', seat: a, to: b, treaty: 1 })).toBe(0);
        made++;
      }
    }
    expect(s.diplo.propCount).toBe(PROPOSAL_CAPACITY);
    expect(send(s, { kind: 'ProposeTreaty', seat: 7, to: 6, treaty: 1 })).toBe(intents.REJECT_DIPLO_FULL);
    expect(pub.validateProposeTreaty(view(s), 7, 6, 1)).toBe(intents.REJECT_DIPLO_FULL);
  });

  it('shape: a treaty kind other than 1 or 2, a seat out of range and a missing field are refused before the rules', () => {
    const s = arena();
    const ctx = ctxOf(s);
    expect(validateIntent({ kind: 'ProposeTreaty', seat: 0, id: 1, to: 1, treaty: 0 }, ctx)).toBe(intents.REJECT_SHAPE);
    expect(validateIntent({ kind: 'ProposeTreaty', seat: 0, id: 1, to: 1, treaty: 3 }, ctx)).toBe(intents.REJECT_SHAPE);
    expect(validateIntent({ kind: 'ProposeTreaty', seat: 0, id: 1, to: 4, treaty: 1 }, ctx)).toBe(intents.REJECT_TARGET);
    expect(validateIntent({ kind: 'AcceptTreaty', seat: 0, id: 1, from: -1 }, ctx)).toBe(intents.REJECT_TARGET);
    expect(validateIntent({ kind: 'BreakTreaty', seat: 0, id: 1 }, ctx)).toBe(intents.REJECT_TARGET);
    expect(validateIntent({ kind: 'LiftEmbargo', seat: 0, id: 1, target: 1.5 }, ctx)).toBe(intents.REJECT_TARGET);
    expect(validateIntent({ kind: 'ImposeEmbargo', seat: 0, id: 1, target: 3 }, ctx)).toBe(0);
  });

  it('the diplomacy codes are 80 to 93, all different, above the landing-zone range', () => {
    const codes = Object.entries(intents)
      .filter(([k, v]) => k.startsWith('REJECT_DIPLO_') && typeof v === 'number')
      .map(([, v]) => v as number);
    expect(codes.length).toBe(14);
    expect(new Set(codes).size).toBe(14);
    expect(Math.min(...codes)).toBe(80);
    expect(Math.max(...codes)).toBe(93);
    const others = Object.entries(intents).filter(([k, v]) => k.startsWith('REJECT_') && !k.startsWith('REJECT_DIPLO_') && typeof v === 'number').map(([, v]) => v as number);
    for (const c of codes) expect(others).not.toContain(c);
  });
});

describe('the wire', () => {
  const bodies: IntentBody[] = [
    { kind: 'ProposeTreaty', seat: 2, to: 1, treaty: 2 },
    { kind: 'AcceptTreaty', seat: 1, from: 200 },
    { kind: 'DeclineTreaty', seat: 0, from: 3 },
    { kind: 'BreakTreaty', seat: 4, with: 17 },
    { kind: 'ImposeEmbargo', seat: 5, target: 9 },
    { kind: 'LiftEmbargo', seat: 6, target: 300 },
  ];
  it('kinds 15 to 20 round trip through the codec, copyBody and the canonical order', () => {
    bodies.forEach((b, i) => expect(intents.kindCode(b.kind)).toBe(15 + i));
    const turn = { turn: 9, intents: bodies.map((b, i) => withId(b, i + 1)) };
    const back = decodeTurn(encodeTurn(turn));
    expect(back.ok && back.value).toEqual(turn);
    for (const b of bodies) expect(copyBody(b)).toEqual(b);
    const a = withId({ kind: 'ProposeTreaty', seat: 0, to: 1, treaty: 1 }, 1);
    const b = withId({ kind: 'ProposeTreaty', seat: 0, to: 1, treaty: 2 }, 1);
    expect(compareIntents(a as Intent, b as Intent)).toBeLessThan(0);
  });
});

describe('proposals and relations', () => {
  it('propose -> accept: the relation holds in both directions, both count the treaty, the proposal is gone', () => {
    const s = arena();
    expect(send(s, { kind: 'ProposeTreaty', seat: 0, to: 1, treaty: TREATY_TRUCE })).toBe(0);
    const v = view(s).diplomacy;
    expect([v.proposalCount, v.proposalFrom(0), v.proposalTo(0), v.proposalTreaty(0), v.proposalKind(0, 1), v.proposalKind(1, 0)]).toEqual([1, 0, 1, TREATY_TRUCE, TREATY_TRUCE, 0]);
    expect(v.proposalTicksLeft(0, 1)).toBe(PROPOSAL_TTL_TICKS);
    expect(send(s, { kind: 'AcceptTreaty', seat: 1, from: 0 })).toBe(0);
    expect([rel(s, 0, 1), rel(s, 1, 0)]).toEqual([RELATION_TRUCE, RELATION_TRUCE]);
    expect(rel(s, 0, 2)).toBe(RELATION_WAR);
    expect(view(s).diplomacy.proposalCount).toBe(0);
    expect(view(s).diplomacy.truceTicksLeft(1, 0)).toBe(TRUCE_TICKS);
    expect([s.match.treatiesMade[1], s.match.treatiesMade[2], s.match.treatiesMade[3]]).toEqual([1, 1, 0]);
    expect([view(s).diplomacy.activeRelations(0), view(s).diplomacy.activeRelations(1), view(s).diplomacy.activeRelations(2)]).toEqual([1, 1, 0]);
  });

  it('decline removes the proposal and nothing else; an alliance has no end tick', () => {
    const s = arena();
    send(s, { kind: 'ProposeTreaty', seat: 0, to: 1, treaty: TREATY_ALLIANCE });
    expect(send(s, { kind: 'DeclineTreaty', seat: 1, from: 0 })).toBe(0);
    expect(view(s).diplomacy.proposalCount).toBe(0);
    expect(rel(s, 0, 1)).toBe(RELATION_WAR);
    expect(s.match.treatiesMade[1]).toBe(0);
    alliance(s, 0, 1);
    expect(s.diplo.until[1 * s.diplo.slots + 2]).toBe(0);
    s.tick += 100000;
    expect(rel(s, 0, 1)).toBe(RELATION_ALLIANCE);
  });

  it('a truce upgrades to an alliance by a proposal; the proposals between the pair are dropped when a treaty starts', () => {
    const s = arena();
    truce(s, 0, 1);
    send(s, { kind: 'ProposeTreaty', seat: 1, to: 0, treaty: TREATY_ALLIANCE });
    send(s, { kind: 'ProposeTreaty', seat: 0, to: 2, treaty: TREATY_TRUCE });
    send(s, { kind: 'AcceptTreaty', seat: 0, from: 1 });
    expect(rel(s, 0, 1)).toBe(RELATION_ALLIANCE);
    expect(view(s).diplomacy.truceTicksLeft(0, 1)).toBe(0);
    expect(view(s).diplomacy.proposalCount).toBe(1);
    send(s, { kind: 'ProposeTreaty', seat: 1, to: 0, treaty: TREATY_TRUCE }); // allied now
    send(s, { kind: 'ProposeTreaty', seat: 1, to: 2, treaty: TREATY_TRUCE });
    send(s, { kind: 'ProposeTreaty', seat: 2, to: 1, treaty: TREATY_ALLIANCE });
    send(s, { kind: 'AcceptTreaty', seat: 2, from: 1 });
    expect(view(s).diplomacy.proposalKind(2, 1)).toBe(0); // the reverse proposal went with the acceptance
  });
});

describe('time: tick exact', () => {
  /** Runs steps with `plan` (tick -> intents) up to `until` ticks. */
  function run(s: GameState, until: number, plan: Record<number, IntentBody[]> = {}): void {
    while (s.tick < until) {
      const list = (plan[s.tick] ?? []).map((b) => withId(b, ids++));
      expect(step(s, { turn: s.tick, intents: list }).ok).toBe(true);
    }
  }

  it('a truce accepted at tick T holds for the ticks T .. T + TRUCE_TICKS - 1 and is war from T + TRUCE_TICKS', () => {
    const s = arena();
    run(s, 10, { 5: [{ kind: 'ProposeTreaty', seat: 0, to: 1, treaty: 1 }], 7: [{ kind: 'AcceptTreaty', seat: 1, from: 0 }] });
    expect(rel(s, 0, 1)).toBe(RELATION_TRUCE);
    const end = 7 + TRUCE_TICKS;
    run(s, end - 1);
    expect(rel(s, 0, 1), 'one tick before the end').toBe(RELATION_TRUCE);
    expect(view(s).diplomacy.truceTicksLeft(0, 1)).toBe(1);
    run(s, end);
    // the state is at tick `end`: the reader says war already, the table is swept by the next step
    expect(rel(s, 0, 1), 'at the end tick the view already says war').toBe(RELATION_WAR);
    expect(s.diplo.relationOf(1, 2)).toBe(RELATION_TRUCE);
    // an Attack in the very step at tick `end` is not refused
    run(s, end + 1, { [end]: [{ kind: 'Attack', seat: 0, target: 2, pct: 50 }] });
    expect(s.diplo.relationOf(1, 2)).toBe(RELATION_WAR);
    expect(s.rejects).toBe(0);
    expect(s.attacks.find(1, 2)).not.toBeNull();
    // free: no cooldown, no betrayal
    expect([s.diplo.cooldownUntil[1], s.diplo.cooldownUntil[2], s.match.treatiesBroken[1], s.match.treatiesBroken[2]]).toEqual([0, 0, 0, 0]);
    // and a new proposal renews it
    run(s, end + 3, { [end + 1]: [{ kind: 'ProposeTreaty', seat: 0, to: 1, treaty: 1 }, { kind: 'CancelAttack', seat: 0, target: 2 }] });
    expect(view(s).diplomacy.proposalKind(0, 1)).toBe(TREATY_TRUCE);
  });

  it('an Attack in the last tick of a truce is refused, in the first tick after it is not', () => {
    const s = arena();
    run(s, 1, { 0: [{ kind: 'ProposeTreaty', seat: 0, to: 1, treaty: 1 }] });
    run(s, 3, { 2: [{ kind: 'AcceptTreaty', seat: 1, from: 0 }] });
    const end = 2 + TRUCE_TICKS;
    run(s, end, { [end - 1]: [{ kind: 'Attack', seat: 0, target: 2, pct: 50 }] });
    expect(s.rejects).toBe(1);
    expect(s.attacks.list.length).toBe(0);
  });

  it('a proposal made at tick T can be answered at T + TTL - 1 and not at T + TTL', () => {
    for (const [answerAt, ok] of [[PROPOSAL_TTL_TICKS - 1, true], [PROPOSAL_TTL_TICKS, false]] as const) {
      const s = arena();
      run(s, 1, { 0: [{ kind: 'ProposeTreaty', seat: 0, to: 1, treaty: 1 }] });
      expect(view(s).diplomacy.proposalTicksLeft(0, 1)).toBe(PROPOSAL_TTL_TICKS - 1);
      run(s, answerAt + 1, { [answerAt]: [{ kind: 'AcceptTreaty', seat: 1, from: 0 }] });
      expect(rel(s, 0, 1) === RELATION_TRUCE, `answer at ${answerAt}`).toBe(ok);
      expect(s.rejects).toBe(ok ? 0 : 1);
      expect(s.diplo.propCount).toBe(0);
    }
  });

  it('the view reads a proposal and a truce as gone from the end tick on, before the next step sweeps them', () => {
    const s = arena();
    run(s, 1, { 0: [{ kind: 'ProposeTreaty', seat: 0, to: 1, treaty: 1 }] });
    s.tick = PROPOSAL_TTL_TICKS; // the end tick of the proposal
    expect(view(s).diplomacy.proposalKind(0, 1)).toBe(0);
    expect(pub.validateAcceptTreaty(view(s), 1, 0)).toBe(intents.REJECT_DIPLO_NO_PROPOSAL);
  });
});

describe('the attack ban and the running attacks', () => {
  it('an Attack between treaty parties is refused (truce and alliance, both directions) and war allows it again', () => {
    for (const make of [truce, alliance]) {
      const s = arena();
      make(s, 0, 1);
      expect(send(s, { kind: 'Attack', seat: 0, target: 2, pct: 50 })).toBe(intents.REJECT_DIPLO_TREATY_BOUND);
      expect(send(s, { kind: 'Attack', seat: 1, target: 1, pct: 50 })).toBe(intents.REJECT_DIPLO_TREATY_BOUND);
      expect(send(s, { kind: 'Attack', seat: 1, target: 3, pct: 50 }), 'a third party is still war').toBe(0);
      expect(send(s, { kind: 'Attack', seat: 0, target: 0, pct: 50 }), 'free land is never bound').not.toBe(intents.REJECT_DIPLO_TREATY_BOUND);
      send(s, { kind: 'BreakTreaty', seat: 0, with: 1 });
      expect(send(s, { kind: 'Attack', seat: 0, target: 2, pct: 50 })).toBe(0);
    }
  });

  it('accepting a treaty calls off the running attacks between the two (both directions) and returns the troops', () => {
    for (const [attacker, target] of [[0, 2], [1, 1]] as const) {
      const s = arena();
      const before = s.troops[attacker + 1] as number;
      expect(send(s, { kind: 'Attack', seat: attacker, target, pct: 50 })).toBe(0);
      expect(s.attacks.list.length).toBe(1);
      expect(s.troops[attacker + 1]).toBeLessThan(before);
      truce(s, 0, 1);
      expect(s.attacks.list.length, `attack ${attacker} -> ${target}`).toBe(0);
      expect(s.troops[attacker + 1] as number).toBeGreaterThanOrEqual(before - 1);
    }
  });

  it('an attack on a third party goes on when two other seats make a treaty', () => {
    const s = arena();
    expect(send(s, { kind: 'Attack', seat: 1, target: 3, pct: 50 })).toBe(0);
    truce(s, 0, 1);
    expect(s.attacks.find(2, 3)).not.toBeNull();
    cancelAttacksBetween(s, 1, 2); // the helper itself: no attack between them, nothing happens
    expect(s.attacks.find(2, 3)).not.toBeNull();
  });
});

describe('betrayal', () => {
  it('BreakTreaty is war at once, starts the breaker\'s cooldown of exactly TREATY_BREAK_COOLDOWN_TICKS and is counted for the breaker only', () => {
    const s = arena();
    s.tick = 100;
    alliance(s, 0, 1);
    expect(send(s, { kind: 'BreakTreaty', seat: 0, with: 1 })).toBe(0);
    expect([rel(s, 0, 1), rel(s, 1, 0)]).toEqual([RELATION_WAR, RELATION_WAR]);
    expect([s.match.treatiesBroken[1], s.match.treatiesBroken[2], s.match.treatiesMade[1], s.match.treatiesMade[2]]).toEqual([1, 0, 1, 1]);
    const d = view(s).diplomacy;
    expect([d.breakCooldownLeft(0), d.breakCooldownLeft(1)]).toEqual([TREATY_BREAK_COOLDOWN_TICKS, 0]);
    expect(send(s, { kind: 'ProposeTreaty', seat: 0, to: 2, treaty: 1 })).toBe(intents.REJECT_DIPLO_COOLDOWN);
    expect(send(s, { kind: 'ProposeTreaty', seat: 1, to: 0, treaty: 1 }), 'the other side may propose').toBe(0);
    s.tick = 100 + TREATY_BREAK_COOLDOWN_TICKS - 1;
    expect(send(s, { kind: 'ProposeTreaty', seat: 0, to: 2, treaty: 1 })).toBe(intents.REJECT_DIPLO_COOLDOWN);
    s.tick = 100 + TREATY_BREAK_COOLDOWN_TICKS;
    expect(send(s, { kind: 'ProposeTreaty', seat: 0, to: 2, treaty: 1 })).toBe(0);
    // the statistics are in the MatchView the page reads
    const mv = view(s).match;
    expect([mv.treaties[0], mv.treaties[1], mv.betrayals[0], mv.betrayals[1], mv.relations[0], mv.relations[1]]).toEqual([1, 1, 1, 0, 0, 0]);
  });

  it('breaking a truce is a betrayal as well; a seat that is bound by the cooldown can still answer', () => {
    const s = arena();
    truce(s, 0, 1);
    send(s, { kind: 'BreakTreaty', seat: 1, with: 0 });
    expect(s.match.treatiesBroken[2]).toBe(1);
    send(s, { kind: 'ProposeTreaty', seat: 0, to: 1, treaty: 1 });
    expect(send(s, { kind: 'AcceptTreaty', seat: 1, from: 0 })).toBe(0);
  });
});

describe('embargo and alliance trade', () => {
  const W = 1024;
  /** A strip with two Ports of different owners 100 cells apart (the trade pair) in a 3 seat match. */
  function ports(): GameState {
    const s = createState({ width: W, height: 8, seed: 5, seats: 3, players: 3, terrain: new Uint8Array(W * 8).fill(CLASS_PLAINS), elevation: new Uint16Array(W * 8) });
    for (let o = 1; o <= 3; o++) setOwner(s, 4 * W + o, o, 0);
    s.tick = 5000;
    for (const [owner, x] of [[1, 100], [2, 200]] as const) {
      setOwner(s, 4 * W + x, owner, 0);
      const id = s.structures.add(STRUCT_PORT, owner, 4 * W + x, 0);
      s.structures.level[id] = 1;
    }
    return s;
  }
  const own = PORT_GOLD_MILLI_BY_LEVEL[1] as number;
  const full = tradeMilliPerSec(100, false, false);
  const allied = tradeMilliPerSec(100, false, false, true);

  it('the Port income of both seats follows the embargo: zero trade while it stands, back when its owner lifts it', () => {
    const s = ports();
    expect(structGoldMilliPerSec(s, 1)).toBe(own + full);
    expect(send(s, { kind: 'ImposeEmbargo', seat: 0, target: 1 })).toBe(0);
    expect([structGoldMilliPerSec(s, 1), structGoldMilliPerSec(s, 2)]).toEqual([own, own]);
    expect(view(s).diplomacy.embargo(1, 0)).toBe(true);
    expect([view(s).diplomacy.embargoFrom(0, 1), view(s).diplomacy.embargoFrom(1, 0)]).toEqual([true, false]);
    expect(send(s, { kind: 'LiftEmbargo', seat: 0, target: 1 })).toBe(0);
    expect(structGoldMilliPerSec(s, 1)).toBe(own + full);
  });

  it('two embargoes need two lifts', () => {
    const s = ports();
    send(s, { kind: 'ImposeEmbargo', seat: 0, target: 1 });
    send(s, { kind: 'ImposeEmbargo', seat: 1, target: 0 });
    send(s, { kind: 'LiftEmbargo', seat: 0, target: 1 });
    expect(structGoldMilliPerSec(s, 1)).toBe(own);
    send(s, { kind: 'LiftEmbargo', seat: 1, target: 0 });
    expect(structGoldMilliPerSec(s, 1)).toBe(own + full);
  });

  it('allied Ports trade at TRADE_ALLIANCE_PCT of the open rate (Fix-4A1), a truce changes nothing, an embargo beats the alliance, breaking it restores the full rate', () => {
    const s = ports();
    expect(allied).toBeGreaterThan(full); // Fix-4A1: an alliance must not pay less than a war (it was the same-owner half)
    expect(allied).toBe(Math.floor((full * TRADE_ALLIANCE_PCT) / 100));
    expect(structGoldMilliPerSec(s, 1)).toBe(own + full); // read once: the cache is warm, the flip must dirty it
    truce(s, 0, 1);
    expect(structGoldMilliPerSec(s, 1)).toBe(own + full);
    send(s, { kind: 'BreakTreaty', seat: 0, with: 1 });
    expect(structGoldMilliPerSec(s, 1)).toBe(own + full); // warm again: only the alliance itself may dirty the cache now
    alliance(s, 1, 0);
    expect([structGoldMilliPerSec(s, 1), structGoldMilliPerSec(s, 2)]).toEqual([own + allied, own + allied]);
    send(s, { kind: 'ImposeEmbargo', seat: 1, target: 0 });
    expect(structGoldMilliPerSec(s, 1)).toBe(own);
    send(s, { kind: 'LiftEmbargo', seat: 1, target: 0 });
    send(s, { kind: 'BreakTreaty', seat: 1, with: 0 });
    expect(structGoldMilliPerSec(s, 1)).toBe(own + full);
    expect(PORT_GOLD_MILLI_PER_SEC).toBeGreaterThan(0);
  });
});

describe('elimination', () => {
  it('an eliminated seat\'s treaties, proposals and embargoes are cleared (without a cooldown or a betrayal), the others keep theirs', () => {
    const s = arena(4, 4);
    truce(s, 1, 2);
    alliance(s, 0, 1);
    truce(s, 2, 3);
    send(s, { kind: 'ProposeTreaty', seat: 1, to: 3, treaty: 1 });
    send(s, { kind: 'ProposeTreaty', seat: 3, to: 1, treaty: 2 });
    send(s, { kind: 'ProposeTreaty', seat: 0, to: 3, treaty: 1 });
    send(s, { kind: 'ImposeEmbargo', seat: 1, target: 0 });
    send(s, { kind: 'ImposeEmbargo', seat: 3, target: 1 });
    // owner 2 (seat 1) loses all its land
    for (let c = 0; c < s.width * s.height; c++) if (s.owner[c] === 2) setOwner(s, c, 1, 0);
    s.capital[2] = 1;
    expect(step(s, { turn: s.tick, intents: [] }).ok).toBe(true);
    expect(s.match.eliminated[2]).toBe(1);
    const d = view(s).diplomacy;
    expect([d.relation(1, 0), d.relation(1, 2), d.relation(0, 2), d.relation(2, 3)]).toEqual([RELATION_WAR, RELATION_WAR, RELATION_WAR, RELATION_TRUCE].map((x, i) => (i === 3 ? RELATION_TRUCE : x)));
    expect([d.proposalKind(1, 3), d.proposalKind(3, 1), d.proposalKind(0, 3)]).toEqual([0, 0, TREATY_TRUCE]);
    expect([d.embargo(1, 0), d.embargo(3, 1), d.embargo(0, 1)]).toEqual([false, false, false]);
    expect([d.breakCooldownLeft(0), d.breakCooldownLeft(1)]).toEqual([0, 0]);
    expect(s.match.treatiesBroken.reduce((a, b) => a + b, 0)).toBe(0);
    expect(send(s, { kind: 'ProposeTreaty', seat: 0, to: 1, treaty: 1 })).toBe(intents.REJECT_DIPLO_ELIMINATED);
  });
});

/** Runs a scripted diplomacy game of `ticks` ticks. */
function play(s: GameState, ticks: number, script: Record<number, IntentBody[]>): void {
  while (s.tick < ticks) {
    const list = (script[s.tick] ?? []).map((b) => withId(b, ids++));
    step(s, { turn: s.tick, intents: list });
  }
}
const SCRIPT: Record<number, IntentBody[]> = {
  3: [{ kind: 'ProposeTreaty', seat: 0, to: 1, treaty: 1 }, { kind: 'ProposeTreaty', seat: 2, to: 1, treaty: 2 }],
  5: [{ kind: 'AcceptTreaty', seat: 1, from: 0 }, { kind: 'ImposeEmbargo', seat: 0, target: 2 }],
  40: [{ kind: 'Attack', seat: 1, target: 3, pct: 30 }, { kind: 'ProposeTreaty', seat: 1, to: 2, treaty: 2 }],
  60: [{ kind: 'AcceptTreaty', seat: 2, from: 1 }],
  90: [{ kind: 'BreakTreaty', seat: 2, with: 1 }, { kind: 'ProposeTreaty', seat: 0, to: 2, treaty: 1 }],
  150: [{ kind: 'LiftEmbargo', seat: 0, target: 2 }, { kind: 'ProposeTreaty', seat: 1, to: 0, treaty: 2 }],
};

describe('serialisation, the hash and the straight run', () => {
  it('a state with open proposals, truces, alliances, embargoes, cooldowns and statistics round trips byte for byte', () => {
    const s = arena();
    play(s, 100, SCRIPT);
    expect(s.diplo.propCount).toBeGreaterThan(0);
    const bytes = serialize(s);
    const r = deserialize(bytes);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(hashState(r.state)).toBe(hashState(s));
    expect(Array.from(serialize(r.state))).toEqual(Array.from(bytes));
    expect(Array.from(r.state.diplo.relation)).toEqual(Array.from(s.diplo.relation));
    expect(Array.from(r.state.diplo.embargoBy)).toEqual(Array.from(s.diplo.embargoBy));
    expect(Array.from(r.state.match.treatiesBroken)).toEqual(Array.from(s.match.treatiesBroken));
    expect(r.state.diplo.pairs.length).toBe(s.diplo.pairs.length);
  });

  it('a snapshot with open proposals and active treaties continues exactly like the straight run', () => {
    const straight = arena();
    play(straight, 4000, SCRIPT);
    const a = arena();
    play(a, 70, SCRIPT); // an open proposal (150 not yet), a truce and an alliance are live here
    expect(a.diplo.pairs.length).toBeGreaterThan(0);
    const r = deserialize(serialize(a));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    play(r.state, 4000, SCRIPT);
    expect(hashState(r.state)).toBe(hashState(straight));
    expect(Array.from(r.state.diplo.relation)).toEqual(Array.from(straight.diplo.relation));
  });

  it('every field of the diplomacy tables is in the hash (one change each)', () => {
    const make = (): GameState => {
      const s = arena();
      truce(s, 0, 1);
      send(s, { kind: 'ProposeTreaty', seat: 2, to: 1, treaty: 2 });
      send(s, { kind: 'ImposeEmbargo', seat: 0, target: 2 });
      send(s, { kind: 'BreakTreaty', seat: 0, with: 1 });
      truce(s, 1, 2);
      send(s, { kind: 'ProposeTreaty', seat: 2, to: 0, treaty: 2 }); // the open proposal the hash must cover (owners 3 -> 1)
      return s;
    };
    const base = hashState(make());
    expect(hashState(make())).toBe(base);
    const at = 2 * 5 + 3; // the pair of owners (2, 3) in the slots = 5 matrix
    const mutations: Array<[string, (s: GameState) => void]> = [
      ['relation a b', (s) => void (s.diplo.relation[at] = RELATION_ALLIANCE)],
      ['relation b a', (s) => void (s.diplo.relation[3 * 5 + 2] = RELATION_ALLIANCE)],
      ['until a b', (s) => void (s.diplo.until[at] = (s.diplo.until[at] as number) + 1)],
      ['until b a', (s) => void (s.diplo.until[3 * 5 + 2] = (s.diplo.until[3 * 5 + 2] as number) + 1)],
      ['embargoBy', (s) => void (s.diplo.embargoBy[3 * 5 + 1] = 1)],
      ['embargoBy removed', (s) => void (s.diplo.embargoBy[1 * 5 + 3] = 0)],
      ['cooldownUntil', (s) => void (s.diplo.cooldownUntil[2] = (s.diplo.cooldownUntil[2] as number) + 1)],
      ['propFrom', (s) => void (s.diplo.propFrom[0] = 2)],
      ['propTo', (s) => void (s.diplo.propTo[0] = 2)],
      ['propKind', (s) => void (s.diplo.propKind[0] = 1)],
      ['propExpire', (s) => void (s.diplo.propExpire[0] = (s.diplo.propExpire[0] as number) + 1)],
      ['propCount', (s) => void (s.diplo.propCount = 0)],
      ['treatiesMade', (s) => void (s.match.treatiesMade[3] = (s.match.treatiesMade[3] as number) + 1)],
      ['treatiesBroken', (s) => void (s.match.treatiesBroken[2] = (s.match.treatiesBroken[2] as number) + 1)],
    ];
    for (const [name, mutate] of mutations) {
      const s = make();
      mutate(s);
      expect(hashState(s), name).not.toBe(base);
    }
  });

  it('forged diplomacy blocks are refused with their own error before the checksum (one guard each)', () => {
    const s = arena();
    truce(s, 0, 1);
    send(s, { kind: 'ProposeTreaty', seat: 2, to: 1, treaty: 2 });
    s.tick = 50; // a truce that ends before the tick, or one that is longer than the rules allow, cannot be a state
    const bytes = serialize(s);
    const slots = 5;
    const tail = bytes.length - 4 - (16 + 12 * slots + 16 * 1 + 16 * 1); // start of the diplomacy block: 1 pair and 1 proposal
    const v = (b: Uint8Array): DataView => new DataView(b.buffer);
    expect(v(bytes).getUint32(tail, true), 'one pair').toBe(1);
    const patched = (offset: number, value: number): string => {
      const b = bytes.slice();
      v(b).setUint32(tail + offset, value, true);
      const r = deserialize(b);
      return r.ok ? 'ok' : r.error;
    };
    expect(patched(4, 1), 'control: the same value loads').toBe('ok');
    expect(patched(16, 50 + 100), 'control: a truce end in range but changed fails only the checksum').toBe('checksum');
    expect(patched(4, 0)).toBe('diplomacy-range'); // a = 0
    expect(patched(8, 1)).toBe('diplomacy-range'); // b <= a
    expect(patched(12, 0)).toBe('diplomacy-range'); // relation 0
    expect(patched(12, 3)).toBe('diplomacy-range'); // relation 3
    expect(patched(16, 49)).toBe('diplomacy-range'); // a truce that has already ended
    expect(patched(16, 50 + TRUCE_TICKS + 1)).toBe('diplomacy-range'); // a truce longer than the rules allow
    expect(patched(0, 5)).toBe('diplomacy-range'); // more pairs than players allow
  });
});

describe('the page\'s copy (host snapshot and ViewMirror)', () => {
  it('the mirror carries the table: proposals, truces, cooldowns and embargoes, read against its own tick; it is sent only when it changed', async () => {
    const s = arena();
    const host = new MainThreadHost(s, { speed: 1 });
    const { mirror } = await ViewMirror.attach(host);
    const frames: Array<boolean> = [];
    mirror.onFrame((_m, d) => frames.push(d.view.diplomacy !== null));
    host.runTicks(1);
    host.submitIntent({ kind: 'ProposeTreaty', seat: 0, to: 1, treaty: TREATY_TRUCE });
    host.runTicks(3);
    expect(mirror.diplomacy.proposalKind(0, 1)).toBe(TREATY_TRUCE);
    expect(mirror.diplomacy.proposalCount).toBe(1);
    host.submitIntent({ kind: 'AcceptTreaty', seat: 1, from: 0 });
    host.submitIntent({ kind: 'ImposeEmbargo', seat: 1, target: 2 });
    host.runTicks(3);
    expect([mirror.diplomacy.relation(0, 1), mirror.diplomacy.relation(1, 0), mirror.diplomacy.embargo(2, 1)]).toEqual([RELATION_TRUCE, RELATION_TRUCE, true]);
    expect(mirror.diplomacy.embargoFrom(1, 2)).toBe(true);
    const v = mirror.diplomacyVersion;
    host.runTicks(5);
    expect(mirror.diplomacyVersion, 'nothing changed: no table in the frames').toBe(v);
    expect(frames.filter((x) => x).length).toBeGreaterThan(0);
    expect(frames.filter((x) => !x).length).toBeGreaterThan(0);
    expect(mirror.match.treaties[0]).toBe(1);
    // the mirror's clock: the truce reads as war from its end tick without a new table
    const end = (host.tick - 6) + TRUCE_TICKS;
    expect(mirror.diplomacy.truceTicksLeft(0, 1)).toBeGreaterThan(0);
    mirror.tick = end + 10;
    expect(mirror.diplomacy.relation(0, 1)).toBe(RELATION_WAR);
    expect(new DiplomacyReader(s.diplo, 3, () => 0).relation(0, 1)).toBe(RELATION_TRUCE);
  });
});
