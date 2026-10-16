// The AI's diplomacy (M18c-1, temperament M18c-2: more willing to truce, see the answers below): it answers proposals, makes proposals and breaks an alliance when it has become the leader. Deterministic rules over the SimView;
// the only randomness is the length of the pause before an answer, drawn from the AI's own stream (nothing is drawn unless a proposal arrives).
//
//  - Answers (every tick): a proposal is answered DIPLOMACY_REPLY_MIN_TICKS to DIPLOMACY_REPLY_MAX_TICKS after the AI first saw it. A truce is accepted (M18c-2) when the AI
//    fights AI_TRUCE_ACCEPT_WARS players, or fights AI_TRUCE_OTHER_WARS other than the proposer and the proposer is not the leader, or its own land is below
//    AI_TRUCE_MEDIAN_PCT of the median. An alliance is accepted when the proposer holds at most
//    AI_ALLY_PROPOSER_MAX_PCT of the land and a leader above AI_ALLY_LEADER_MIN_PCT is at war with both of them (ganging up on the leader). Everything else is declined, and
//    so is every proposal of a seat that broke a treaty against this AI in the last AI_GRUDGE_TICKS.
//  - Proposals (on the think rhythm, at most one per AI_PROPOSE_COOLDOWN_TICKS): a weak AI (land below AI_WEAK_MEDIAN_PCT of the median of the living players) proposes a
//    truce (M18c-2: so does one fighting on several fronts) to the neighbour that attacked it most often (AI_TRUCE_MIN_HITS think rounds at least); an AI proposes an alliance to the strongest player that is not the leader when a leader holds more than AI_LEADER_PCT.
//  - Breaking: an AI that holds more than AI_LEADER_PCT itself breaks its alliances (the betrayal mark applies to the AI too).
// Every intent is checked with the same validate* function the sim runs before it is sent, so the AI never sends an invalid one.
import {
  AI_ALLY_LEADER_MIN_PCT,
  AI_ALLY_PROPOSER_MAX_PCT,
  AI_GRUDGE_TICKS,
  AI_LEADER_PCT,
  AI_PROPOSE_COOLDOWN_TICKS,
  AI_THINK_PERIOD_TICKS,
  AI_TRUCE_ACCEPT_WARS,
  AI_TRUCE_MEDIAN_PCT,
  AI_TRUCE_MIN_HITS,
  AI_TRUCE_OTHER_WARS,
  AI_WAR_START_TICKS,
  AI_WEAK_MEDIAN_PCT,
  DIPLOMACY_REPLY_MAX_TICKS,
  DIPLOMACY_REPLY_MIN_TICKS,
  PHASE_PLAY,
  REJECT_NONE,
  RELATION_ALLIANCE,
  RELATION_WAR,
  TREATY_ALLIANCE,
  TREATY_TRUCE,
  WEIGHT_ONE,
  acceptTreatyBody,
  breakTreatyBody,
  declineTreatyBody,
  nextBelow,
  proposeTreatyBody,
  seatToOwner,
  validateAcceptTreaty,
  validateBreakTreaty,
  validateDeclineTreaty,
  validateProposeTreaty,
  type IntentBody,
  type SimView,
} from '../sim/public';
import type { AiMemory } from './memory';

const NONE: readonly IntentBody[] = Object.freeze([]);
/** Scratch for the median (a module constant, filled and read inside one call: nothing survives a call). */
const SHARES = new Int32Array(256);

/** The land share of a seat in Q15 (WEIGHT_ONE = everything). */
function share(view: SimView, seat: number): number {
  return view.stats.landShareQ15[seat] as number;
}

/** Is the seat's share strictly above `pct` percent of the land? */
function above(view: SimView, seat: number, pct: number): boolean {
  return share(view, seat) * 100 > pct * WEIGHT_ONE;
}

function livingPlayer(view: SimView, seat: number): boolean {
  return seat < view.players && (view.stats.alive[seat] as number) === 1 && view.match.eliminated[seat] === 0;
}

/** How many other players (not `skip`) an attack runs against or from. */
function warCount(view: SimView, seat: number, skip = -1): number {
  const me = seatToOwner(seat);
  let n = 0;
  for (let o = 0; o < view.players; o++) {
    if (o === seat || o === skip || !livingPlayer(view, o)) continue;
    if (view.attackRunning(me, seatToOwner(o)) || view.attackRunning(seatToOwner(o), me)) n++;
  }
  return n;
}

/** The living player with the most land (the lower seat on a tie), skipping the seats `skipA` and `skipB`; -1 when there is none. */
function strongest(view: SimView, skipA: number, skipB: number): number {
  let best = -1;
  for (let o = 0; o < view.players; o++) {
    if (o === skipA || o === skipB || !livingPlayer(view, o)) continue;
    if (best < 0 || share(view, o) > share(view, best)) best = o;
  }
  return best;
}

/** Notes which seats broke a treaty against this AI since the last look: a relation that went from truce or alliance to war before the truce was due, and not by this AI's own break. */
function observe(view: SimView, memory: AiMemory): void {
  const d = view.diplomacy;
  const tick = view.tick;
  const seat = memory.seat;
  for (let o = 0; o < view.players; o++) {
    if (o === seat) continue;
    const rel = d.relation(seat, o);
    const prev = memory.lastRel[o] as number;
    if (prev !== RELATION_WAR && rel === RELATION_WAR) {
      const early = prev === RELATION_ALLIANCE || tick < (memory.lastUntil[o] as number);
      const own = memory.lastBreakAt >= 0 && tick - memory.lastBreakAt < 2 * AI_THINK_PERIOD_TICKS;
      if (early && !own) memory.betrayedAt[o] = tick;
    }
    memory.lastRel[o] = rel;
    memory.lastUntil[o] = tick + d.truceTicksLeft(seat, o);
    if (o < view.players && view.attackRunning(seatToOwner(o), seatToOwner(seat))) memory.hits[o] = (memory.hits[o] as number) + 1;
  }
}

function holdsGrudge(memory: AiMemory, other: number, tick: number): boolean {
  const at = memory.betrayedAt[other] as number;
  return at >= 0 && tick - at < AI_GRUDGE_TICKS;
}

/** Does the AI want the treaty `kind` that `from` proposed? */
function wants(view: SimView, memory: AiMemory, from: number, kind: number): boolean {
  const seat = memory.seat;
  if (!livingPlayer(view, from) || holdsGrudge(memory, from, view.tick)) return false;
  if (kind === TREATY_TRUCE) {
    // M18c-2: at war with another party and the proposer is not the largest threat, or weaker than the median, or fighting on several fronts.
    if (warCount(view, seat) >= AI_TRUCE_ACCEPT_WARS) return true;
    if (warCount(view, seat, from) >= AI_TRUCE_OTHER_WARS && share(view, from) < share(view, strongest(view, -1, -1))) return true;
    return share(view, seat) * 100 < medianShare(view) * AI_TRUCE_MEDIAN_PCT;
  }
  if (kind !== TREATY_ALLIANCE || share(view, from) * 100 > AI_ALLY_PROPOSER_MAX_PCT * WEIGHT_ONE) return false;
  const leader = strongest(view, seat, from);
  const d = view.diplomacy;
  return leader >= 0 && above(view, leader, AI_ALLY_LEADER_MIN_PCT) && d.relation(seat, leader) === RELATION_WAR && d.relation(from, leader) === RELATION_WAR;
}

/** The answer to the first open proposal whose pause is over (and the pause of one that has just arrived is drawn here). */
function reply(view: SimView, memory: AiMemory, rng: Uint32Array): readonly IntentBody[] {
  const d = view.diplomacy;
  const seat = memory.seat;
  const tick = view.tick;
  // A pause for a proposal that has gone is forgotten.
  for (let o = 0; o < view.players; o++) if ((memory.replyAt[o] as number) >= 0 && d.proposalKind(o, seat) === 0) memory.replyAt[o] = -1;
  for (let i = 0; i < d.proposalCount; i++) {
    if (d.proposalTo(i) !== seat) continue;
    const from = d.proposalFrom(i);
    const due = memory.replyAt[from] as number;
    if (due < 0) {
      memory.replyAt[from] = tick + DIPLOMACY_REPLY_MIN_TICKS + nextBelow(rng, DIPLOMACY_REPLY_MAX_TICKS - DIPLOMACY_REPLY_MIN_TICKS + 1);
      continue;
    }
    if (tick < due) continue;
    memory.replyAt[from] = -1;
    if (wants(view, memory, from, d.proposalTreaty(i))) return validateAcceptTreaty(view, seat, from) === REJECT_NONE ? [acceptTreatyBody(seat, from)] : NONE;
    return validateDeclineTreaty(view, seat, from) === REJECT_NONE ? [declineTreatyBody(seat, from)] : NONE;
  }
  return NONE;
}

/** The median land share of the living players (the upper one of two), Q15. */
function medianShare(view: SimView): number {
  let n = 0;
  for (let o = 0; o < view.players && n < SHARES.length; o++) {
    if (!livingPlayer(view, o)) continue;
    const v = share(view, o);
    let at = n++;
    while (at > 0 && (SHARES[at - 1] as number) > v) {
      SHARES[at] = SHARES[at - 1] as number;
      at--;
    }
    SHARES[at] = v;
  }
  return n === 0 ? 0 : (SHARES[n >> 1] as number);
}

/** Does the seat have an open proposal of its own? */
function hasOpenProposal(view: SimView, seat: number): boolean {
  const d = view.diplomacy;
  for (let i = 0; i < d.proposalCount; i++) if (d.proposalFrom(i) === seat) return true;
  return false;
}

/** A proposal this AI wants to make now, or null. */
function proposal(view: SimView, memory: AiMemory): IntentBody | null {
  const seat = memory.seat;
  const tick = view.tick;
  const d = view.diplomacy;
  if (tick < AI_WAR_START_TICKS || tick < memory.proposeAt || hasOpenProposal(view, seat) || d.breakCooldownLeft(seat) > 0) return null;
  // A weak AI, or one fighting on several fronts, asks the neighbour that attacked it most often (the stronger on a tie) for a truce.
  if (share(view, seat) * 100 < medianShare(view) * AI_WEAK_MEDIAN_PCT || warCount(view, seat) >= AI_TRUCE_ACCEPT_WARS) {
    let target = -1;
    for (let o = 0; o < view.players; o++) {
      if (o === seat || !livingPlayer(view, o) || holdsGrudge(memory, o, tick) || (memory.hits[o] as number) < AI_TRUCE_MIN_HITS) continue;
      if (validateProposeTreaty(view, seat, o, TREATY_TRUCE) !== REJECT_NONE) continue;
      const h = memory.hits[o] as number;
      const t = target < 0 ? -1 : (memory.hits[target] as number);
      if (target < 0 || h > t || (h === t && share(view, o) > share(view, target))) target = o;
    }
    if (target >= 0) return proposeTreatyBody(seat, target, TREATY_TRUCE);
  }
  // Everybody asks the second strongest for an alliance against a leader.
  const leader = strongest(view, -1, -1);
  if (leader >= 0 && leader !== seat && above(view, leader, AI_LEADER_PCT) && d.relation(seat, leader) === RELATION_WAR) {
    const ally = strongest(view, leader, seat);
    if (ally >= 0 && !holdsGrudge(memory, ally, tick) && validateProposeTreaty(view, seat, ally, TREATY_ALLIANCE) === REJECT_NONE) return proposeTreatyBody(seat, ally, TREATY_ALLIANCE);
  }
  return null;
}

/**
 * What this AI says this tick (usually nothing). Answers are looked at every tick, the rest on the think rhythm of the seat. A tribe, a seat that has not spawned or has
 * been eliminated, and a match outside the play phase get nothing.
 */
export function diplomacyMove(view: SimView, memory: AiMemory, rng: Uint32Array): readonly IntentBody[] {
  if (memory.tribe || view.phase !== PHASE_PLAY || view.match.ended || (view.stats.alive[memory.seat] as number) === 0) return NONE;
  const talk = reply(view, memory, rng);
  if (talk.length > 0) return talk;
  if ((view.tick + memory.phase) % AI_THINK_PERIOD_TICKS !== 0) return NONE;
  observe(view, memory);
  const seat = memory.seat;
  const d = view.diplomacy;
  if (above(view, seat, AI_LEADER_PCT)) {
    // The leader no longer needs its allies: it breaks them, one at a time.
    for (let o = 0; o < view.players; o++) {
      if (d.relation(seat, o) === RELATION_ALLIANCE && validateBreakTreaty(view, seat, o) === REJECT_NONE) {
        memory.lastBreakAt = view.tick;
        memory.lastRel[o] = RELATION_WAR;
        return [breakTreatyBody(seat, o)];
      }
    }
  }
  const p = proposal(view, memory);
  if (p === null) return NONE;
  memory.proposeAt = view.tick + AI_PROPOSE_COOLDOWN_TICKS;
  return [p];
}
