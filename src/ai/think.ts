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
import {
  AI_ATTACK_COOLDOWN_TICKS,
  AI_EXPAND_COMMIT_PCT,
  AI_EXPAND_TROOP_PCT,
  AI_MIN_CONTACT_LENGTH,
  AI_ANCHOR_SEAT,
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
  AI_WAR_MIN_RATIO_PCT,
  NO_OWNER,
  PHASE_PLAY,
  PHASE_SPAWN,
  attackBody,
  nextBelow,
  seatToOwner,
  spawnBody,
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
    const anchor = (stats.capital[AI_ANCHOR_SEAT] as number) - 1; // the human's capital cell, -1 before it exists
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
  if ((stats.troopsQt[seat] as number) * 100 < (stats.capQt[seat] as number) * AI_EXPAND_TROOP_PCT) return NONE;
  if (memory.tribe && (stats.cells[seat] as number) >= AI_TRIBE_MAX_CELLS) return NONE;

  const owner = seatToOwner(seat);
  if (!memory.tribe && view.phase === PHASE_PLAY) {
    // War: the weakest neighbour (fewest troops; the lower ownerId on a tie) that we outnumber by the margin.
    let best = NO_OWNER;
    let bestTroops = 0;
    const mine = stats.troopsQt[seat] as number;
    for (let o = 1; o <= view.seats; o++) {
      if (o === owner || view.contactLength(owner, o) === 0 || coolingDown(memory, o, tick, AI_ATTACK_COOLDOWN_TICKS)) continue;
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
  // Expansion: unowned land that touches ours along at least AI_MIN_CONTACT_LENGTH (a sliver is gone before the intent runs, 2 ticks later).
  const cooldown = memory.tribe ? AI_TRIBE_COOLDOWN_TICKS : AI_ATTACK_COOLDOWN_TICKS;
  if (view.contactLength(owner, NO_OWNER) >= AI_MIN_CONTACT_LENGTH && !coolingDown(memory, NO_OWNER, tick, cooldown)) {
    memory.lastAttack[NO_OWNER] = tick;
    return [attackBody(seat, NO_OWNER, jittered(AI_EXPAND_COMMIT_PCT, rng))];
  }
  return NONE;
}
