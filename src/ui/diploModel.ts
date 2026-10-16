// The pure model of the diplomacy interface (M18c-2): the rows of the panel, the state of each button, the break confirmation, the incoming proposal cards and the
// watcher that turns table changes into toasts. Nothing here knows a rule: every button state IS the answer of the sim's `validate*` function (the very check the
// sim runs when the intent arrives), every relation is read from `SimView.diplomacy`. No DOM, no clock; the allocation happens when a row list is built (when the panel is
// open and a second, the table or the language changed), never per frame.
import {
  REJECT_DIPLO_TREATY_BOUND,
  REJECT_NONE,
  RELATION_ALLIANCE,
  RELATION_TRUCE,
  RELATION_WAR,
  TICK_HZ,
  TREATY_ALLIANCE,
  TREATY_TRUCE,
  validateBreakTreaty,
  validateImposeEmbargo,
  validateLiftEmbargo,
  validateProposeTreaty,
  type SimView,
} from '../sim/public';

/** One button: whether the sim would take the intent now, and if not, the REJECT_* code that says why (the panel shows it as the tooltip). */
export interface DiploButton {
  readonly enabled: boolean;
  readonly reason: number;
}

export interface DiploRow {
  readonly seat: number;
  /** RELATION_WAR, RELATION_TRUCE or RELATION_ALLIANCE with the local seat. */
  readonly relation: number;
  readonly truceTicksLeft: number;
  readonly eliminated: boolean;
  /** Share of the land in Q15. */
  readonly shareQ15: number;
  /** Any embargo between the two (either side put it on), and whether it is the local seat's own (the one it can lift). */
  readonly embargo: boolean;
  readonly embargoOwn: boolean;
  /** The local seat has an open proposal to this seat: ticks left (0 = none). */
  readonly waitingTicks: number;
  /** Treaties this seat has broken (the traitor mark). */
  readonly betrayals: number;
  readonly truce: DiploButton;
  readonly alliance: DiploButton;
  readonly breakTreaty: DiploButton;
  /** The embargo button: Impose when none is set by the local seat, else Lift. */
  readonly embargoButton: DiploButton;
}

const btn = (reason: number): DiploButton => ({ enabled: reason === REJECT_NONE, reason });

/** The rows of the panel: one per PLAYER seat other than the local one (tribes cannot negotiate), in seat order. */
export function buildDiploRows(view: SimView, localSeat: number): DiploRow[] {
  const d = view.diplomacy;
  const out: DiploRow[] = [];
  for (let s = 0; s < view.players; s++) {
    if (s === localSeat) continue;
    const eliminated = view.match.eliminated[s] === 1;
    const rel = d.relation(localSeat, s);
    const own = d.embargoFrom(localSeat, s);
    out.push({
      seat: s,
      relation: rel,
      truceTicksLeft: rel === RELATION_TRUCE ? d.truceTicksLeft(localSeat, s) : 0,
      eliminated,
      shareQ15: view.stats.landShareQ15[s] as number,
      embargo: d.embargo(localSeat, s),
      embargoOwn: own,
      waitingTicks: d.proposalTicksLeft(localSeat, s),
      betrayals: view.match.betrayals[s] as number,
      truce: btn(validateProposeTreaty(view, localSeat, s, TREATY_TRUCE)),
      alliance: btn(validateProposeTreaty(view, localSeat, s, TREATY_ALLIANCE)),
      breakTreaty: btn(validateBreakTreaty(view, localSeat, s)),
      embargoButton: btn(own ? validateLiftEmbargo(view, localSeat, s) : validateImposeEmbargo(view, localSeat, s)),
    });
  }
  return out;
}

/**
 * The two-click confirmation of a break (like Delete): the first click arms the seat, the second one (on the same seat, while it is armed) breaks. Arming ends on
 * `clear` (the panel closes or another button is used) and after the armed time (`expire`).
 */
export class BreakConfirm {
  private seat = -1;
  private until = 0;

  /** Returns true when this click is the confirming one (the caller sends the intent); otherwise it arms `seat` until `now + seconds`. */
  click(seat: number, now: number, seconds: number): boolean {
    if (this.seat === seat && now < this.until) {
      this.seat = -1;
      return true;
    }
    this.seat = seat;
    this.until = now + seconds;
    return false;
  }

  armed(): number {
    return this.seat;
  }

  /** Disarms after the time; returns true when something changed. */
  expire(now: number): boolean {
    if (this.seat >= 0 && now >= this.until) {
      this.seat = -1;
      return true;
    }
    return false;
  }

  clear(): boolean {
    const changed = this.seat >= 0;
    this.seat = -1;
    return changed;
  }
}

/** An incoming proposal as a card shows it. */
export interface ProposalCard {
  readonly from: number;
  readonly treaty: number;
  readonly ticksLeft: number;
}

/** The proposals addressed to the local seat, oldest first, at most `max` of them. */
export function incomingProposals(view: SimView, localSeat: number, max: number): ProposalCard[] {
  const d = view.diplomacy;
  const cards: ProposalCard[] = [];
  for (let i = 0; i < d.proposalCount && cards.length < max; i++) {
    if (d.proposalTo(i) !== localSeat) continue;
    cards.push({ from: d.proposalFrom(i), treaty: d.proposalTreaty(i), ticksLeft: d.proposalLeft(i) });
  }
  return cards;
}

/** How many proposals wait for the local seat (no allocation: the top-bar signal reads this every tick). */
export function incomingCount(view: SimView, localSeat: number): number {
  const d = view.diplomacy;
  let n = 0;
  for (let i = 0; i < d.proposalCount; i++) if (d.proposalTo(i) === localSeat) n++;
  return n;
}

/** The refusal of an Attack on `targetOwner` (an ownerId, 0 = unowned) that the sim gives for a treaty party; REJECT_NONE when the attack may go. The click sends no intent on a refusal. */
export function attackBlock(view: SimView, localSeat: number, targetOwner: number): number {
  if (targetOwner <= 0) return REJECT_NONE;
  const seat = targetOwner - 1;
  if (seat === localSeat || seat >= view.players) return REJECT_NONE;
  return view.diplomacy.relation(localSeat, seat) !== RELATION_WAR ? REJECT_DIPLO_TREATY_BOUND : REJECT_NONE;
}

export const BADGE_TRUCE = 1;
export const BADGE_ALLIANCE = 2;
export const BADGE_EMBARGO = 4;

/** The badges of the relation between the local seat and `seat` as a bit set (truce, alliance, embargo) for the leaderboard rows. */
export function relationBadges(view: SimView, localSeat: number, seat: number): number {
  if (seat === localSeat || seat >= view.players) return 0;
  const d = view.diplomacy;
  const rel = d.relation(localSeat, seat);
  return (rel === RELATION_TRUCE ? BADGE_TRUCE : 0) | (rel === RELATION_ALLIANCE ? BADGE_ALLIANCE : 0) | (d.embargo(localSeat, seat) ? BADGE_EMBARGO : 0);
}

export const NEWS_INCOMING = 1;
export const NEWS_ACCEPTED = 2;
export const NEWS_DECLINED = 3;
export const NEWS_EXPIRED = 4;

const CAP = 64;

/**
 * Turns the proposal table into news for toasts. Called every frame with the view (the table holds at most 32 rows, nothing is allocated in a quiet frame). Incoming:
 * a proposal to the local seat that was not there at the last look. Outgoing: a proposal of the local seat that is gone now: accepted when the relation turned into a
 * treaty, expired when its last tick has passed, otherwise declined. The first look only learns the table.
 */
export class DiploWatcher {
  private inFrom = new Int32Array(CAP);
  private inKind = new Int32Array(CAP);
  private inN = 0;
  private outTo = new Int32Array(CAP);
  private outKind = new Int32Array(CAP);
  private outEnd = new Int32Array(CAP);
  private outN = 0;
  private nextInFrom = new Int32Array(CAP);
  private nextInKind = new Int32Array(CAP);
  private nextOutTo = new Int32Array(CAP);
  private nextOutKind = new Int32Array(CAP);
  private nextOutEnd = new Int32Array(CAP);
  private primed = false;

  constructor(private readonly news: (kind: number, seat: number, treaty: number) => void) {}

  update(view: SimView, localSeat: number): void {
    const d = view.diplomacy;
    const tick = view.tick;
    let nIn = 0;
    let nOut = 0;
    for (let i = 0; i < d.proposalCount && nIn < CAP && nOut < CAP; i++) {
      const from = d.proposalFrom(i);
      const to = d.proposalTo(i);
      if (to === localSeat) {
        this.nextInFrom[nIn] = from;
        this.nextInKind[nIn] = d.proposalTreaty(i);
        nIn++;
      } else if (from === localSeat) {
        this.nextOutTo[nOut] = to;
        this.nextOutKind[nOut] = d.proposalTreaty(i);
        this.nextOutEnd[nOut] = tick + d.proposalLeft(i);
        nOut++;
      }
    }
    if (this.primed) {
      for (let i = 0; i < nIn; i++) {
        let known = false;
        for (let j = 0; j < this.inN; j++) if (this.inFrom[j] === this.nextInFrom[i] && this.inKind[j] === this.nextInKind[i]) known = true;
        if (!known) this.news(NEWS_INCOMING, this.nextInFrom[i] as number, this.nextInKind[i] as number);
      }
      for (let j = 0; j < this.outN; j++) {
        const to = this.outTo[j] as number;
        let still = false;
        for (let i = 0; i < nOut; i++) if (this.nextOutTo[i] === to) still = true;
        if (still) continue;
        const kind = this.outKind[j] as number;
        const rel = d.relation(localSeat, to);
        if ((kind === TREATY_TRUCE && rel !== RELATION_WAR) || (kind === TREATY_ALLIANCE && rel === RELATION_ALLIANCE)) this.news(NEWS_ACCEPTED, to, kind);
        else if (tick >= (this.outEnd[j] as number)) this.news(NEWS_EXPIRED, to, kind);
        else this.news(NEWS_DECLINED, to, kind);
      }
    }
    this.primed = true;
    [this.inFrom, this.nextInFrom] = [this.nextInFrom, this.inFrom];
    [this.inKind, this.nextInKind] = [this.nextInKind, this.inKind];
    this.inN = nIn;
    [this.outTo, this.nextOutTo] = [this.nextOutTo, this.outTo];
    [this.outKind, this.nextOutKind] = [this.nextOutKind, this.outKind];
    [this.outEnd, this.nextOutEnd] = [this.nextOutEnd, this.outEnd];
    this.outN = nOut;
  }
}

/** Whole seconds of a tick count, rounded up (a countdown never shows 0 while time is left). */
export const secondsLeft = (ticks: number): number => Math.ceil(ticks / TICK_HZ);
