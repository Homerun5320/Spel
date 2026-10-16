// The diplomacy rules (M18c-1): proposals, truces, alliances, betrayal and embargo. Pure functions of the state and rules.ts; no clock, no random.
//
// The model (docs/DECISIONS.md "M18c-1"): between two PLAYER seats the relation is WAR (the default), TRUCE (TRUCE_TICKS from the acceptance, then war again) or
// ALLIANCE (until somebody breaks it). A seat proposes with ProposeTreaty, the other accepts (AcceptTreaty) or declines (DeclineTreaty); a proposal runs out
// after PROPOSAL_TTL_TICKS. Between treaty parties an Attack is refused and running attacks are called off. BreakTreaty is war at once but costs the breaker a
// cooldown on new proposals and counts as a betrayal; a truce that runs out is free. An embargo (ImposeEmbargo / LiftEmbargo) stops the trade of two seats'
// Ports; allied Ports trade as if they had one owner.
//
// ONE implementation of every check: `checkPropose` and its siblings read a `DiploCheckView` (a SimView has exactly this shape), the public `validate*` functions
// pass the page's view and the `apply*` functions below pass a thin view of the live state, so the page and the sim can never disagree.
import { cancelAttacksBetween } from './conquest';
import { PHASE_PLAY, PHASE_SPAWN, phaseAt } from './flow';
import {
  REJECT_DIPLO_ALLIED,
  REJECT_DIPLO_AT_PEACE,
  REJECT_DIPLO_COOLDOWN,
  REJECT_DIPLO_ELIMINATED,
  REJECT_DIPLO_EMBARGO_NONE,
  REJECT_DIPLO_EMBARGO_SET,
  REJECT_DIPLO_FULL,
  REJECT_DIPLO_MATCH_ENDED,
  REJECT_DIPLO_NOT_PLAYER,
  REJECT_DIPLO_NO_PROPOSAL,
  REJECT_DIPLO_NO_TREATY,
  REJECT_DIPLO_PENDING,
  REJECT_DIPLO_SELF,
  REJECT_NONE,
  REJECT_PHASE,
} from './intents';
import {
  DiplomacyReader,
  RELATION_ALLIANCE,
  RELATION_TRUCE,
  RELATION_WAR,
  TREATY_ALLIANCE,
  TREATY_TRUCE,
  type DiplomacyView,
} from './diplomacyTable';
import { PROPOSAL_CAPACITY, PROPOSAL_TTL_TICKS, TREATY_BREAK_COOLDOWN_TICKS, TRUCE_TICKS } from './rules';
import { seatToOwner, type GameState } from './state';
import type { MatchPhase } from './flow';
import type { ReadonlyNumbers } from './view';
import { dirtyTrade, syncEmbargo } from './diplomacyClear';

/** What the checks read: the shape of a SimView (and of a thin view over a live state). */
export interface DiploCheckView {
  readonly seats: number;
  readonly players: number;
  readonly phase: MatchPhase;
  readonly match: { readonly ended: boolean; readonly eliminated: ReadonlyNumbers };
  readonly diplomacy: DiplomacyView;
}

/** The thin view the sim passes to the shared checks for its own state (allocated per applied intent: diplomacy intents are rare). */
export function checkViewOf(state: GameState): DiploCheckView {
  const m = state.match;
  return {
    seats: state.header.seats,
    players: state.header.players,
    phase: state.header.config.spawnPhase === true ? phaseAt(state.tick) : PHASE_PLAY,
    match: { ended: m.ended === 1, eliminated: m.eliminated.subarray(1) },
    diplomacy: new DiplomacyReader(state.diplo, state.header.players, () => state.tick),
  };
}

/** The checks every diplomacy intent starts with, in this order: match over, spawn phase, the sender (a player, not eliminated), the other seat (not itself, a player, not eliminated). */
function checkCommon(v: DiploCheckView, seat: number, other: number): number {
  if (v.match.ended) return REJECT_DIPLO_MATCH_ENDED;
  if (v.phase === PHASE_SPAWN) return REJECT_PHASE;
  if (seat < 0 || seat >= v.players) return REJECT_DIPLO_NOT_PLAYER;
  if (v.match.eliminated[seat] === 1) return REJECT_DIPLO_ELIMINATED;
  if (other === seat) return REJECT_DIPLO_SELF;
  if (other < 0 || other >= v.players) return REJECT_DIPLO_NOT_PLAYER;
  if (v.match.eliminated[other] === 1) return REJECT_DIPLO_ELIMINATED;
  return REJECT_NONE;
}

/** Why `seat` cannot propose `treaty` (TREATY_TRUCE or TREATY_ALLIANCE) to `to` right now. */
export function checkPropose(v: DiploCheckView, seat: number, to: number, treaty: number): number {
  const why = checkCommon(v, seat, to);
  if (why !== REJECT_NONE) return why;
  const d = v.diplomacy;
  if (d.breakCooldownLeft(seat) > 0) return REJECT_DIPLO_COOLDOWN;
  const rel = d.relation(seat, to);
  if (treaty === TREATY_ALLIANCE ? rel === RELATION_ALLIANCE : rel !== RELATION_WAR) return rel === RELATION_ALLIANCE ? REJECT_DIPLO_ALLIED : REJECT_DIPLO_AT_PEACE;
  if (d.proposalKind(seat, to) !== 0) return REJECT_DIPLO_PENDING;
  if (d.proposalCount >= PROPOSAL_CAPACITY) return REJECT_DIPLO_FULL;
  return REJECT_NONE;
}

/** Why `seat` cannot accept or decline the open proposal from `from` right now (the two share the check). */
export function checkAnswer(v: DiploCheckView, seat: number, from: number): number {
  const why = checkCommon(v, seat, from);
  if (why !== REJECT_NONE) return why;
  return v.diplomacy.proposalKind(from, seat) === 0 ? REJECT_DIPLO_NO_PROPOSAL : REJECT_NONE;
}

/** Why `seat` cannot break its treaty with `withSeat` right now. */
export function checkBreak(v: DiploCheckView, seat: number, withSeat: number): number {
  const why = checkCommon(v, seat, withSeat);
  if (why !== REJECT_NONE) return why;
  return v.diplomacy.relation(seat, withSeat) === RELATION_WAR ? REJECT_DIPLO_NO_TREATY : REJECT_NONE;
}

/** Why `seat` cannot put an embargo on `target` right now. */
export function checkImpose(v: DiploCheckView, seat: number, target: number): number {
  const why = checkCommon(v, seat, target);
  if (why !== REJECT_NONE) return why;
  return v.diplomacy.embargoFrom(seat, target) ? REJECT_DIPLO_EMBARGO_SET : REJECT_NONE;
}

/** Why `seat` cannot lift its embargo on `target` right now. */
export function checkLift(v: DiploCheckView, seat: number, target: number): number {
  const why = checkCommon(v, seat, target);
  if (why !== REJECT_NONE) return why;
  return v.diplomacy.embargoFrom(seat, target) ? REJECT_NONE : REJECT_DIPLO_EMBARGO_NONE;
}

// ---- applying ----------------------------------------------------------------------------------------------------------------------------------------------

/** Is the relation between two ownerIds war? The question the attack check and the helicopter landing ask (owner 0 = neutral land is always war). */
export function atWar(state: GameState, ownerA: number, ownerB: number): boolean {
  return ownerA === 0 || ownerB === 0 || state.diplo.relationOf(ownerA, ownerB) === RELATION_WAR;
}

/** Applies a ProposeTreaty. */
export function applyProposeTreaty(state: GameState, seat: number, to: number, treaty: number): number {
  const why = checkPropose(checkViewOf(state), seat, to, treaty);
  if (why !== REJECT_NONE) return why;
  state.diplo.addProposal(seatToOwner(seat), seatToOwner(to), treaty, state.tick + PROPOSAL_TTL_TICKS);
  return REJECT_NONE;
}

/** Starts a treaty between two ownerIds: the relation (a truce gets its end tick), the proposals between them go, running attacks between them stop, both count it. */
function enterTreaty(state: GameState, a: number, b: number, treaty: number): void {
  const d = state.diplo;
  d.removeProposalsBetween(a, b);
  d.setRelation(a, b, treaty === TREATY_TRUCE ? RELATION_TRUCE : RELATION_ALLIANCE, treaty === TREATY_TRUCE ? state.tick + TRUCE_TICKS : 0);
  cancelAttacksBetween(state, a, b);
  state.match.treatiesMade[a] = ((state.match.treatiesMade[a] as number) + 1) >>> 0;
  state.match.treatiesMade[b] = ((state.match.treatiesMade[b] as number) + 1) >>> 0;
  dirtyTrade(state);
}

/** Applies an AcceptTreaty. */
export function applyAcceptTreaty(state: GameState, seat: number, from: number): number {
  const why = checkAnswer(checkViewOf(state), seat, from);
  if (why !== REJECT_NONE) return why;
  const me = seatToOwner(seat);
  const other = seatToOwner(from);
  const i = state.diplo.findProposal(other, me);
  enterTreaty(state, me, other, state.diplo.propKind[i] as number);
  return REJECT_NONE;
}

/** Applies a DeclineTreaty. */
export function applyDeclineTreaty(state: GameState, seat: number, from: number): number {
  const why = checkAnswer(checkViewOf(state), seat, from);
  if (why !== REJECT_NONE) return why;
  state.diplo.removeProposalAt(state.diplo.findProposal(seatToOwner(from), seatToOwner(seat)));
  return REJECT_NONE;
}

/** Applies a BreakTreaty: war at once, the breaker's cooldown starts, the betrayal is counted. */
export function applyBreakTreaty(state: GameState, seat: number, withSeat: number): number {
  const why = checkBreak(checkViewOf(state), seat, withSeat);
  if (why !== REJECT_NONE) return why;
  const me = seatToOwner(seat);
  state.diplo.setRelation(me, seatToOwner(withSeat), RELATION_WAR, 0);
  state.diplo.cooldownUntil[me] = state.tick + TREATY_BREAK_COOLDOWN_TICKS;
  state.diplo.version++;
  state.match.treatiesBroken[me] = ((state.match.treatiesBroken[me] as number) + 1) >>> 0;
  dirtyTrade(state);
  return REJECT_NONE;
}

/** Applies an ImposeEmbargo. */
export function applyImposeEmbargo(state: GameState, seat: number, target: number): number {
  const why = checkImpose(checkViewOf(state), seat, target);
  if (why !== REJECT_NONE) return why;
  const me = seatToOwner(seat);
  const other = seatToOwner(target);
  state.diplo.embargoBy[me * state.diplo.slots + other] = 1;
  syncEmbargo(state, me, other);
  return REJECT_NONE;
}

/** Applies a LiftEmbargo. */
export function applyLiftEmbargo(state: GameState, seat: number, target: number): number {
  const why = checkLift(checkViewOf(state), seat, target);
  if (why !== REJECT_NONE) return why;
  const me = seatToOwner(seat);
  const other = seatToOwner(target);
  state.diplo.embargoBy[me * state.diplo.slots + other] = 0;
  syncEmbargo(state, me, other);
  return REJECT_NONE;
}

/**
 * The start of a step (before the intents of the tick): truces whose end tick has come become war, proposals whose last tick has passed are removed. A truce
 * accepted at tick T lasts the ticks T .. T + TRUCE_TICKS - 1; at T + TRUCE_TICKS the first intent already sees war. Costs one comparison when nothing is due.
 */
export function expireDiplomacy(state: GameState): void {
  const d = state.diplo;
  if (state.tick < d.nextEvent) return;
  const tick = state.tick;
  for (let k = d.pairs.length - 1; k >= 0; k--) {
    const key = d.pairs[k] as number;
    if (d.relation[key] === RELATION_TRUCE && (d.until[key] as number) <= tick) {
      const a = Math.floor(key / d.slots);
      d.setRelation(a, key - a * d.slots, RELATION_WAR, 0);
    }
  }
  for (let i = d.propCount - 1; i >= 0; i--) if ((d.propExpire[i] as number) <= tick) d.removeProposalAt(i);
  d.rebuildDerived();
}

// ---- the public face for the UI and the AI (src/sim/public.ts) ------------------------------------------------------------------------------------------

/** Why `seat` could not propose `treaty` (TREATY_TRUCE, TREATY_ALLIANCE) to `to` right now in the snapshot `view` (REJECT_NONE = it could). The sim runs the same `checkPropose`. */
export function validateProposeTreaty(view: DiploCheckView, seat: number, to: number, treaty: number): number {
  return checkPropose(view, seat, to, treaty);
}

/** Why `seat` could not accept the open proposal of `from` right now. */
export function validateAcceptTreaty(view: DiploCheckView, seat: number, from: number): number {
  return checkAnswer(view, seat, from);
}

/** Why `seat` could not decline the open proposal of `from` right now (the same check as accepting it). */
export function validateDeclineTreaty(view: DiploCheckView, seat: number, from: number): number {
  return checkAnswer(view, seat, from);
}

/** Why `seat` could not break its treaty with `withSeat` right now. */
export function validateBreakTreaty(view: DiploCheckView, seat: number, withSeat: number): number {
  return checkBreak(view, seat, withSeat);
}

/** Why `seat` could not put an embargo on `target` right now. */
export function validateImposeEmbargo(view: DiploCheckView, seat: number, target: number): number {
  return checkImpose(view, seat, target);
}

/** Why `seat` could not lift its embargo on `target` right now. */
export function validateLiftEmbargo(view: DiploCheckView, seat: number, target: number): number {
  return checkLift(view, seat, target);
}
