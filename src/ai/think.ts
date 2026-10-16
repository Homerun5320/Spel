// AI v0: a pure function of what the seat can see. `think(view, memory, rng)` returns the intents this seat sends now (usually
// none). It reads the SimView, writes only its own memory and its own random stream, and never touches the sim; the host that
// calls it files the intents for T + 2 like any other.
//
// Behaviour (docs/DECISIONS.md D104):
//  - Spawn phase: the seats wait for the human's capital (or AI_SPAWN_WAIT_TICKS), then plant their capitals one by one, the
//    nations first, on seeded places with a whole disc of land and clear ground around them, near the human's capital so that the
//    world fills in around the player; if a capital has not appeared a few ticks later the seat tries another place.
//  - After that, once per second on its own tick (staggered by seat), a seat with troops of at least AI_EXPAND_TROOP_PCT of its
//    cap acts: a nation first attacks the WEAKEST neighbour it outnumbers (AI_WAR_MIN_RATIO_PCT), else expands into unowned
//    land it touches. A tribe only expands. A seat does not attack the same target again within a cooldown.
//  - Tempo pass (D142, D143): a nation starts no war before AI_WAR_START_TICKS (the land grab comes first) and none on a human seat
//    before AI_WAR_HUMAN_START_TICKS; a nation that owns AI_WAR_MAX_SHARE_PCT of all land starts none, calls off the ones it has
//    (only the attacks that still run, asked of the view, so the sim never refuses a Cancel) but answers a neighbour that attacks
//    it; one that owns AI_EXPAND_MAX_SHARE_PCT also expands no further.
import {
  AI_ATTACK_COOLDOWN_TICKS,
  AI_EXPAND_COMMIT_PCT,
  AI_EXPAND_MAX_SHARE_PCT,
  AI_EXPAND_TROOP_PCT,
  AI_MIN_CONTACT_LENGTH,
  AI_NATION_CLEARANCE_CELLS,
  AI_NATION_REACH_CELLS,
  AI_SPAWN_RETRY_TICKS,
  AI_SPAWN_WAIT_TICKS,
  AI_THINK_PERIOD_TICKS,
  AI_TRIBE_CLEARANCE_CELLS,
  AI_TRIBE_REACH_CELLS,
  AI_TRIBE_COOLDOWN_TICKS,
  AI_TRIBE_MAX_CELLS,
  AI_WAR_COMMIT_PCT,
  AI_WAR_HUMAN_START_TICKS,
  AI_WAR_MIN_CONTACT_LENGTH,
  AI_WAR_MAX_SHARE_PCT,
  AI_WAR_MIN_RATIO_PCT,
  AI_WAR_START_TICKS,
  NO_OWNER,
  PHASE_PLAY,
  PHASE_SPAWN,
  RELATION_WAR,
  attackBody,
  cancelAttackBody,
  nextBelow,
  seatToOwner,
  spawnBody,
  WEIGHT_ONE,
  type IntentBody,
  type SimView,
} from '../sim/public';
import type { AiMemory } from './memory';
import { pickSpawnCell } from './place';

/** The answer "nothing to do". Shared, so a thought that does nothing allocates nothing; callers must not change it. */
const NONE: readonly IntentBody[] = Object.freeze([]);
const NO_CELLS: readonly number[] = Object.freeze([]);

/** The commitment (percent) with a little seeded variation, in steps of 5, so the nations do not move in lockstep. */
function jittered(base: number, rng: Uint32Array): number {
  return Math.max(5, Math.min(100, base + 5 * (nextBelow(rng, 5) - 2)));
}

/** Is a proposal open between the two seats, in either direction? An acceptance on its way would end an attack between them (or refuse a new one), so the AI neither starts nor cancels one meanwhile (M18c-1). */
function negotiating(view: SimView, seat: number, other: number): boolean {
  return view.diplomacy.proposalKind(seat, other) !== 0 || view.diplomacy.proposalKind(other, seat) !== 0;
}

function coolingDown(memory: AiMemory, target: number, tick: number, cooldown: number): boolean {
  const last = memory.lastAttack[target] as number;
  return last >= 0 && tick - last < cooldown;
}

/**
 * `inFlight`: the capital cells of Spawns that other AI seats have sent and that have not run yet (the host driver keeps the list),
 * so that seats which Spawn on consecutive ticks do not pick the same neighbourhood.
 */
export function think(view: SimView, memory: AiMemory, rng: Uint32Array, inFlight: readonly number[] = NO_CELLS): readonly IntentBody[] {
  const seat = memory.seat;
  const tick = view.tick;
  const stats = view.stats;

  if ((stats.capital[seat] as number) === 0) {
    // Not spawned yet.
    if (view.phase !== PHASE_SPAWN) return NONE;
    const anchor = (stats.capital[memory.anchor] as number) - 1; // the human's capital cell, -1 before it exists
    if (memory.release < 0) {
      if (anchor < 0 && tick < AI_SPAWN_WAIT_TICKS) return NONE;
      memory.release = tick;
    }
    if (tick < memory.release + memory.slot || tick < memory.retryAt) return NONE;
    memory.attempts++;
    memory.retryAt = tick + AI_SPAWN_RETRY_TICKS;
    const tribe = memory.tribe;
    const cell = pickSpawnCell(view, rng, tribe ? AI_TRIBE_CLEARANCE_CELLS : AI_NATION_CLEARANCE_CELLS, anchor, tribe ? AI_TRIBE_REACH_CELLS : AI_NATION_REACH_CELLS, inFlight);
    return cell < 0 ? NONE : [spawnBody(seat, cell)];
  }
  if (view.phase === PHASE_SPAWN || (tick + memory.phase) % AI_THINK_PERIOD_TICKS !== 0) return NONE;
  if ((stats.alive[seat] as number) === 0) return NONE;
  const owner = seatToOwner(seat);
  const share = (stats.landShareQ15[seat] as number) * 100;
  const atWarCap = !memory.tribe && share >= AI_WAR_MAX_SHARE_PCT * WEIGHT_ONE;
  const atExpandCap = !memory.tribe && share >= AI_EXPAND_MAX_SHARE_PCT * WEIGHT_ONE;
  if (atWarCap || atExpandCap) {
    // At a cap the nation calls off what it started, once: its wars at the war cap, its expansion at the expansion cap. Only an
    // attack that still runs is cancelled (an attack that ran dry, or that a head-on clash used up, is gone from the sim, and a
    // Cancel of it would be refused, D143).
    let cancels: IntentBody[] | null = null;
    if (atWarCap) {
      for (let o = 1; o <= view.seats; o++) {
        // An open proposal between the two (M18c-1) may be accepted any tick, and that calls the attack off: the Cancel would then be refused, so it waits.
        if (o === owner || (memory.lastAttack[o] as number) < 0 || negotiating(view, seat, o - 1)) continue;
        memory.lastAttack[o] = -1;
        if (view.attackRunning(owner, o)) (cancels ??= []).push(cancelAttackBody(seat, o));
      }
    }
    if (atExpandCap && view.attackRunning(owner, NO_OWNER)) {
      memory.lastAttack[NO_OWNER] = -1;
      (cancels ??= []).push(cancelAttackBody(seat, NO_OWNER));
    }
    if (cancels !== null) return cancels;
  }
  if ((stats.troopsQt[seat] as number) * 100 < (stats.capQt[seat] as number) * AI_EXPAND_TROOP_PCT) return NONE;
  if (memory.tribe && (stats.cells[seat] as number) >= AI_TRIBE_MAX_CELLS) return NONE;

  if (!memory.tribe && view.phase === PHASE_PLAY) {
    if (atWarCap) {
      // Retaliation: a nation at the war cap starts no war, but it answers the first neighbour that attacks it. The sim sets the
      // two forces against each other (a mutual attack, D85: both lose the smaller one), so the answer holds the aggressor's troops back.
      for (let o = 1; o <= view.seats; o++) {
        if (o === owner || !view.attackRunning(o, owner) || view.diplomacy.relation(seat, o - 1) !== RELATION_WAR || negotiating(view, seat, o - 1) || coolingDown(memory, o, tick, AI_ATTACK_COOLDOWN_TICKS)) continue;
        memory.lastAttack[o] = tick;
        return [attackBody(seat, o, jittered(AI_WAR_COMMIT_PCT, rng))];
      }
    } else if (tick >= AI_WAR_START_TICKS) {
      // War comes after the land grab (AI_WAR_START_TICKS): the weakest neighbour (fewest troops; the lower ownerId on a tie) that we
      // outnumber by the margin. A human seat is left alone until AI_WAR_HUMAN_START_TICKS unless it attacks us.
      let best = NO_OWNER;
      let bestTroops = 0;
      const mine = stats.troopsQt[seat] as number;
      for (let o = 1; o <= view.seats; o++) {
        // A sliver (a single cell of contact, or a target left with fewer cells than AI_MIN_CONTACT_LENGTH) is gone before the intent runs, 2 ticks later.
        // A truce or an alliance (M18c-1) is respected: the sim refuses an Attack on a treaty party, and the AI never sends a refused one.
        if (o === owner || view.diplomacy.relation(seat, o - 1) !== RELATION_WAR || negotiating(view, seat, o - 1) || view.contactLength(owner, o) < AI_WAR_MIN_CONTACT_LENGTH || (stats.cells[o - 1] as number) < AI_MIN_CONTACT_LENGTH || coolingDown(memory, o, tick, AI_ATTACK_COOLDOWN_TICKS)) continue;
        if (tick < AI_WAR_HUMAN_START_TICKS && memory.human[o - 1] === 1 && !view.attackRunning(o, owner)) continue;
        const theirs = stats.troopsQt[o - 1] as number;
        if (best === NO_OWNER || theirs < bestTroops) {
          best = o;
          bestTroops = theirs;
        }
      }
      if (best !== NO_OWNER && mine * 100 >= bestTroops * AI_WAR_MIN_RATIO_PCT) {
        memory.lastAttack[best] = tick;
        return [attackBody(seat, best, jittered(AI_WAR_COMMIT_PCT, rng))];
      }
    }
  }
  if (atExpandCap) return NONE;
  // Expansion: unowned land that touches ours along at least AI_MIN_CONTACT_LENGTH (a sliver is gone before the intent runs, 2 ticks later).
  const cooldown = memory.tribe ? AI_TRIBE_COOLDOWN_TICKS : AI_ATTACK_COOLDOWN_TICKS;
  if (view.contactLength(owner, NO_OWNER) >= AI_MIN_CONTACT_LENGTH && !coolingDown(memory, NO_OWNER, tick, cooldown)) {
    memory.lastAttack[NO_OWNER] = tick;
    return [attackBody(seat, NO_OWNER, jittered(AI_EXPAND_COMMIT_PCT, rng))];
  }
  return NONE;
}
