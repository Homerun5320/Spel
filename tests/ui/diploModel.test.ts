// M18c-2: the pure model of the diplomacy interface (src/ui/diploModel.ts) against the real sim rules: rows, the state of every button per relation (it IS the
// validate* answer), the break confirmation, the incoming cards, the news the watcher turns into toasts, and the attack block on a treaty party.
import { describe, expect, it } from 'vitest';
import {
  BreakConfirm,
  DiploWatcher,
  NEWS_ACCEPTED,
  NEWS_DECLINED,
  NEWS_EXPIRED,
  NEWS_INCOMING,
  attackBlock,
  buildDiploRows,
  incomingCount,
  incomingProposals,
  relationBadges,
  BADGE_ALLIANCE,
  BADGE_EMBARGO,
  BADGE_TRUCE,
} from '../../src/ui/diploModel';
import { diplomacyRefusalKey } from '../../src/ui/diploReasons';
import {
  PROPOSAL_TTL_TICKS,
  REJECT_DIPLO_AT_PEACE,
  REJECT_DIPLO_COOLDOWN,
  REJECT_DIPLO_EMBARGO_NONE,
  REJECT_DIPLO_NO_TREATY,
  REJECT_DIPLO_PENDING,
  REJECT_DIPLO_TREATY_BOUND,
  REJECT_NONE,
  RELATION_ALLIANCE,
  RELATION_TRUCE,
  RELATION_WAR,
  TREATY_ALLIANCE,
  TREATY_TRUCE,
  TRUCE_TICKS,
  validateBreakTreaty,
  validateImposeEmbargo,
  validateLiftEmbargo,
  validateProposeTreaty,
} from '../../src/sim/public';
import { withId, validateIntent, type IntentBody } from '../../src/sim/intents';
import { applyIntent, step } from '../../src/sim/step';
import { setOwner } from '../../src/sim/territory';
import { StateView } from '../../src/sim/view';
import type { GameState } from '../../src/sim/state';
import { AI_WAR_START_TICKS } from '../../src/sim/rules';
import { landState } from '../sim/helpers/worlds';

let ids = 1;
function send(s: GameState, body: IntentBody): number {
  const i = withId(body, ids++);
  const shape = validateIntent(i, { seats: s.header.seats, cells: s.width * s.height, debugIntents: false });
  return shape !== 0 ? shape : applyIntent(s, i);
}

/** Players side by side on a 100 x 10 plain, owning the given percent of the columns each. */
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

const view = (s: GameState): StateView => {
  const v = new StateView(s);
  v.refresh();
  return v;
};
const ticks = (s: GameState, n: number): void => {
  for (let i = 0; i < n; i++) step(s, { turn: s.tick, intents: [] });
};

describe('the rows of the panel', () => {
  it('one row per other player seat, tribes left out; at war every button is what validate* says', () => {
    const s = landState(100, 10, { seats: 5, players: 3 });
    s.tick = AI_WAR_START_TICKS + 1000;
    const v = view(s);
    const rows = buildDiploRows(v, 0);
    expect(rows.map((r) => r.seat)).toEqual([1, 2]);
    for (const r of rows) {
      expect(r.relation).toBe(RELATION_WAR);
      expect(r.truce.reason).toBe(validateProposeTreaty(v, 0, r.seat, TREATY_TRUCE));
      expect(r.alliance.reason).toBe(validateProposeTreaty(v, 0, r.seat, TREATY_ALLIANCE));
      expect(r.breakTreaty.reason).toBe(validateBreakTreaty(v, 0, r.seat));
      expect(r.embargoButton.reason).toBe(validateImposeEmbargo(v, 0, r.seat));
    }
    const r1 = rows[0] as (typeof rows)[number];
    expect(r1.breakTreaty).toEqual({ enabled: false, reason: REJECT_DIPLO_NO_TREATY });
    expect(r1.embargoOwn).toBe(false);
  });

  it('truce: the button states follow the sim (propose off, break on) and the time left is the sim\'s', () => {
    const s = arena([40, 30, 30]);
    send(s, { kind: 'ProposeTreaty', seat: 1, to: 0, treaty: TREATY_TRUCE });
    send(s, { kind: 'AcceptTreaty', seat: 0, from: 1 });
    const v = view(s);
    const [r1, r2] = buildDiploRows(v, 0) as [ReturnType<typeof buildDiploRows>[number], ReturnType<typeof buildDiploRows>[number]];
    expect(r1.relation).toBe(RELATION_TRUCE);
    expect(r1.truceTicksLeft).toBe(v.diplomacy.truceTicksLeft(0, 1));
    expect(r1.truceTicksLeft).toBeGreaterThan(TRUCE_TICKS - 5);
    expect(r1.truce).toEqual({ enabled: false, reason: REJECT_DIPLO_AT_PEACE });
    expect(r1.alliance.enabled).toBe(validateProposeTreaty(v, 0, 1, TREATY_ALLIANCE) === REJECT_NONE);
    expect(r1.breakTreaty).toEqual({ enabled: true, reason: REJECT_NONE });
    // the other nation is untouched
    expect(r2.relation).toBe(RELATION_WAR);
    expect(r2.truce.enabled).toBe(true);
    expect(r2.breakTreaty.enabled).toBe(false);
  });

  it('an open proposal of yours: the row waits (with the time) and the same button says why it is off', () => {
    const s = arena([40, 30, 30]);
    send(s, { kind: 'ProposeTreaty', seat: 0, to: 1, treaty: TREATY_TRUCE });
    const v = view(s);
    const r1 = buildDiploRows(v, 0)[0] as ReturnType<typeof buildDiploRows>[number];
    expect(r1.waitingTicks).toBe(v.diplomacy.proposalTicksLeft(0, 1));
    expect(r1.waitingTicks).toBeGreaterThan(PROPOSAL_TTL_TICKS - 5);
    expect(r1.truce).toEqual({ enabled: false, reason: REJECT_DIPLO_PENDING });
  });

  it('embargo: Impose until you set one, then Lift (enabled) and the Impose reason is gone; the other side\'s embargo cannot be lifted by you', () => {
    const s = arena([40, 30, 30]);
    let r1 = buildDiploRows(view(s), 0)[0] as ReturnType<typeof buildDiploRows>[number];
    expect(r1.embargoOwn).toBe(false);
    expect(r1.embargoButton.enabled).toBe(true);
    expect(send(s, { kind: 'ImposeEmbargo', seat: 0, target: 1 })).toBe(0);
    const v = view(s);
    r1 = buildDiploRows(v, 0)[0] as ReturnType<typeof buildDiploRows>[number];
    expect(r1.embargo).toBe(true);
    expect(r1.embargoOwn).toBe(true);
    expect(r1.embargoButton).toEqual({ enabled: validateLiftEmbargo(v, 0, 1) === REJECT_NONE, reason: validateLiftEmbargo(v, 0, 1) });
    expect(r1.embargoButton.enabled).toBe(true);
    // seen from seat 1: the embargo exists but is not its own; its button is "Impose" and the sim answers for it
    const other = buildDiploRows(v, 1)[0] as ReturnType<typeof buildDiploRows>[number];
    expect(other.embargo).toBe(true);
    expect(other.embargoOwn).toBe(false);
    expect(other.embargoButton.reason).toBe(validateImposeEmbargo(v, 1, 0));
    expect(validateLiftEmbargo(v, 1, 0)).toBe(REJECT_DIPLO_EMBARGO_NONE);
  });

  it('a break gives the breaker a cooldown (every propose button off with the cooldown reason) and a traitor count in the other\'s rows', () => {
    const s = arena([40, 30, 30]);
    send(s, { kind: 'ProposeTreaty', seat: 1, to: 0, treaty: TREATY_TRUCE });
    send(s, { kind: 'AcceptTreaty', seat: 0, from: 1 });
    expect(send(s, { kind: 'BreakTreaty', seat: 0, with: 1 })).toBe(0);
    const v = view(s);
    expect(v.diplomacy.breakCooldownLeft(0)).toBeGreaterThan(0);
    const mine = buildDiploRows(v, 0);
    for (const r of mine) {
      expect(r.truce).toEqual({ enabled: false, reason: REJECT_DIPLO_COOLDOWN });
      expect(r.alliance.reason).toBe(REJECT_DIPLO_COOLDOWN);
    }
    const theirs = buildDiploRows(v, 1);
    expect((theirs.find((r) => r.seat === 0) as ReturnType<typeof buildDiploRows>[number]).betrayals).toBe(1);
    expect((theirs.find((r) => r.seat === 2) as ReturnType<typeof buildDiploRows>[number]).betrayals).toBe(0);
    // every refusal has a text key (the tooltip), none of them the catch-all
    expect(diplomacyRefusalKey(REJECT_DIPLO_COOLDOWN)).toBe('reject.diplo.cooldown');
  });

  it('an eliminated nation is marked and its buttons follow the sim', () => {
    const s = arena([50, 30, 20]);
    s.match.eliminated[3] = 1; // by owner id: seat 2
    const v = view(s);
    const r2 = buildDiploRows(v, 0).find((r) => r.seat === 2) as ReturnType<typeof buildDiploRows>[number];
    expect(r2.eliminated).toBe(true);
    expect(r2.truce.reason).toBe(validateProposeTreaty(v, 0, 2, TREATY_TRUCE));
    expect(r2.truce.enabled).toBe(false);
  });
});

describe('the break confirmation', () => {
  it('the first click arms, the second on the same nation confirms; another nation, the time and clear disarm', () => {
    const c = new BreakConfirm();
    expect(c.click(1, 0, 6)).toBe(false);
    expect(c.armed()).toBe(1);
    expect(c.click(1, 1, 6)).toBe(true);
    expect(c.armed()).toBe(-1);
    expect(c.click(1, 0, 6)).toBe(false);
    expect(c.click(2, 1, 6), 'another nation arms that one instead').toBe(false);
    expect(c.armed()).toBe(2);
    expect(c.click(2, 7.5, 6), 'too late: it only arms again').toBe(false);
    expect(c.expire(20)).toBe(true);
    expect(c.armed()).toBe(-1);
    c.click(3, 0, 6);
    expect(c.clear()).toBe(true);
    expect(c.clear()).toBe(false);
  });
});

describe('proposals to you: the cards and the news', () => {
  it('at most `max` cards, oldest first, with the treaty and the time left; the count covers all of them', () => {
    const s = arena([25, 25, 25, 25]);
    send(s, { kind: 'ProposeTreaty', seat: 1, to: 0, treaty: TREATY_TRUCE });
    send(s, { kind: 'ProposeTreaty', seat: 2, to: 0, treaty: TREATY_ALLIANCE });
    send(s, { kind: 'ProposeTreaty', seat: 3, to: 0, treaty: TREATY_TRUCE });
    send(s, { kind: 'ProposeTreaty', seat: 3, to: 1, treaty: TREATY_TRUCE }); // not for us
    const v = view(s);
    expect(incomingCount(v, 0)).toBe(3);
    const two = incomingProposals(v, 0, 2);
    expect(two.map((c) => [c.from, c.treaty])).toEqual([[1, TREATY_TRUCE], [2, TREATY_ALLIANCE]]);
    expect(two[0]?.ticksLeft).toBe(v.diplomacy.proposalTicksLeft(1, 0));
    expect(incomingCount(v, 1)).toBe(1);
  });

  it('the watcher reports an incoming proposal once, and your own as accepted, declined or expired', () => {
    const s = arena([40, 30, 30]);
    const log: string[] = [];
    const w = new DiploWatcher((kind, seat, treaty) => log.push(`${kind}:${seat}:${treaty}`));
    const v = new StateView(s);
    const look = (): void => {
      v.refresh();
      w.update(v, 0);
    };
    look(); // learns the empty table
    send(s, { kind: 'ProposeTreaty', seat: 1, to: 0, treaty: TREATY_TRUCE });
    send(s, { kind: 'ProposeTreaty', seat: 0, to: 2, treaty: TREATY_TRUCE });
    look();
    look();
    expect(log).toEqual([`${NEWS_INCOMING}:1:${TREATY_TRUCE}`]);
    // seat 2 accepts: accepted
    log.length = 0;
    send(s, { kind: 'AcceptTreaty', seat: 2, from: 0 });
    look();
    expect(log).toEqual([`${NEWS_ACCEPTED}:2:${TREATY_TRUCE}`]);
    // declined
    log.length = 0;
    send(s, { kind: 'ProposeTreaty', seat: 0, to: 1, treaty: TREATY_TRUCE }); // seat 1 already proposed to us: pending refusal is for the same pair only
    look();
    log.length = 0;
    send(s, { kind: 'DeclineTreaty', seat: 1, from: 0 });
    look();
    expect(log).toEqual([`${NEWS_DECLINED}:1:${TREATY_TRUCE}`]);
    // expired: nobody answers for the whole life of a proposal
    log.length = 0;
    send(s, { kind: 'ProposeTreaty', seat: 0, to: 1, treaty: TREATY_ALLIANCE });
    look();
    for (let n = 0; n < PROPOSAL_TTL_TICKS + 5; n++) {
      ticks(s, 1);
      look();
    }
    expect(log.filter((l) => l.startsWith(`${NEWS_EXPIRED}:`))).toEqual([`${NEWS_EXPIRED}:1:${TREATY_ALLIANCE}`]);
    // the proposal of seat 1 to us has expired too, silently
    expect(log.some((l) => l.startsWith(`${NEWS_DECLINED}:`))).toBe(false);
  });
});

describe('the attack on a treaty party and the badges', () => {
  it('attackBlock is the treaty-bound refusal for a truce or alliance party and nothing for a foe, unowned land or yourself', () => {
    const s = arena([40, 30, 30]);
    send(s, { kind: 'ProposeTreaty', seat: 1, to: 0, treaty: TREATY_TRUCE });
    send(s, { kind: 'AcceptTreaty', seat: 0, from: 1 });
    send(s, { kind: 'ProposeTreaty', seat: 2, to: 0, treaty: TREATY_ALLIANCE });
    send(s, { kind: 'AcceptTreaty', seat: 0, from: 2 });
    const v = view(s);
    expect(attackBlock(v, 0, 2)).toBe(REJECT_DIPLO_TREATY_BOUND); // owner 2 = seat 1, truce
    expect(attackBlock(v, 0, 3)).toBe(REJECT_DIPLO_TREATY_BOUND); // owner 3 = seat 2, alliance
    expect(attackBlock(v, 0, 0)).toBe(REJECT_NONE);
    expect(attackBlock(v, 0, 1)).toBe(REJECT_NONE);
    // the sim says the same
    expect(send(s, { kind: 'Attack', seat: 0, target: 2, pct: 20 })).toBe(REJECT_DIPLO_TREATY_BOUND);
    send(s, { kind: 'BreakTreaty', seat: 0, with: 1 });
    expect(attackBlock(view(s), 0, 2)).toBe(REJECT_NONE);
    expect(relationBadges(view(s), 0, 2)).toBe(BADGE_ALLIANCE);
  });

  it('the badges are a bit set of truce, alliance and embargo, empty for yourself and tribes', () => {
    const s = landState(100, 10, { seats: 4, players: 3 });
    s.tick = AI_WAR_START_TICKS + 1000;
    send(s, { kind: 'ProposeTreaty', seat: 1, to: 0, treaty: TREATY_TRUCE });
    send(s, { kind: 'AcceptTreaty', seat: 0, from: 1 });
    send(s, { kind: 'ImposeEmbargo', seat: 0, target: 2 });
    const v = view(s);
    expect(relationBadges(v, 0, 1)).toBe(BADGE_TRUCE);
    expect(relationBadges(v, 0, 2)).toBe(BADGE_EMBARGO);
    expect(relationBadges(v, 0, 0)).toBe(0);
    expect(relationBadges(v, 0, 3)).toBe(0);
    send(s, { kind: 'ImposeEmbargo', seat: 0, target: 1 });
    expect(relationBadges(view(s), 0, 1)).toBe(BADGE_TRUCE | BADGE_EMBARGO);
  });
});
