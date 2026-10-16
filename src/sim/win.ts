// The match end (M18-1): the three win conditions, the elimination, the statistics that need a look at the whole state, and the anti-snowball
// discount. Pure functions of the state and rules.ts; no clock, no random, no float (floors of integer division only).
//
// The phase `winPhase(state)` runs LAST in a step, after the tick counter has been incremented, so `state.tick` is the number of completed steps.
// Conditions (a match with `config.win` absent or all off never ends, it still keeps the statistics and the elimination flags):
//   (b) last alive: at most one player is not eliminated (needs at least two players at the start);
//   (a) land: a player holds at least `requiredLandPct` of all playable weighted land for `holdTicks` evaluations in a row;
//   (c) score: `timeLimitTicks` of play have passed (counted from the end of the spawn phase); the highest score wins, then more land, then the lower seat.
// M18b-3: every condition counts GROUPS (src/sim/groups.ts): a federation's land and score are summed, it holds the land timer and wins together; `winner` is
// the group's root (lowest ownerId). A match without a federation takes the plain per-seat path.
// When several are true in one step the order of that list wins: last, land, score. Once a match has ended `step` only counts ticks.
import { floorDiv } from './detmath';
import { SPAWN_PHASE_TICKS } from './rules';
import {
  LEADER_COST_PCT_HIGH,
  LEADER_COST_PCT_MID,
  LEADER_LAND_PCT_HIGH,
  LEADER_LAND_PCT_MID,
  OVERTIME_MIN_PCT,
  OVERTIME_START_MINUTE,
  OVERTIME_STEP_PCT,
  SCORE_CITY_LEVEL_POINTS,
  SCORE_FACTORY_LEVEL_POINTS,
  STD_CELL_AREA,
  TICK_HZ,
  WEIGHT_ONE,
} from './rules';
import { WIN_REASON_LAND, WIN_REASON_LAST, WIN_REASON_NONE, WIN_REASON_SCORE } from './matchState';
import { clearDiplomacyOf } from './diplomacyClear';
import { federationRoots, groupSumScratch } from './groups';
import { scrapOwnerHelis } from './heliPhase';
import { OUTBOX_CAPITAL_LOST, OUTBOX_ELIMINATED, OUTBOX_MATCH_END } from './outbox';
import { ownerSlots, type GameState } from './state';
import { STRUCT_CITY, STRUCT_FACTORY } from './structureRules';

/** Ticks in one minute of play. */
const TICKS_PER_MINUTE = 60 * TICK_HZ;
/** Q15 weight sum of one weighted standard cell. */
const WEIGHT_PER_STD = WEIGHT_ONE * STD_CELL_AREA;

/** The tick count at which play (and the match clock) starts: the end of the spawn phase of a match with a flow, else 0. */
export function playStartTick(state: GameState): number {
  return state.header.config.spawnPhase === true ? SPAWN_PHASE_TICKS : 0;
}

/** Whole minutes of play after `elapsedTicks`. */
export function playMinutes(elapsedTicks: number): number {
  return Math.floor(elapsedTicks / TICKS_PER_MINUTE);
}

/**
 * The land share (percent) condition (a) asks for after `elapsedTicks` of play: `basePct` up to the end of minute OVERTIME_START_MINUTE + 1,
 * then OVERTIME_STEP_PCT less for every whole minute after minute OVERTIME_START_MINUTE (60 up to minute 21, 59 from there), never below
 * OVERTIME_MIN_PCT. A pure function, tested alone.
 */
export function requiredLandPct(basePct: number, elapsedTicks: number): number {
  const over = playMinutes(elapsedTicks) - OVERTIME_START_MINUTE;
  const pct = over > 0 ? basePct - over * OVERTIME_STEP_PCT : basePct;
  return pct < OVERTIME_MIN_PCT ? OVERTIME_MIN_PCT : pct;
}

/** The land of an owner in weighted standard cells (floored). */
export function landStdOf(state: GameState, owner: number): number {
  return floorDiv(state.agg.warea[owner] as number, WEIGHT_PER_STD);
}

/**
 * The attacker's price in percent of the cell price against `target` (an ownerId; 0 = free land): LEADER_COST_PCT_HIGH when the target is a
 * NATION (a player seat, not a tribe) holding STRICTLY more than LEADER_LAND_PCT_HIGH of all playable weighted land, else LEADER_COST_PCT_MID
 * above LEADER_LAND_PCT_MID, else 100. Never stacked: the higher tier replaces the lower. Exact integer comparison on the weight sums.
 * Only a match with end rules (`config.win`) has the discount: a match without them is the plain sandbox of M04 to M17 (DECISIONS M18-1).
 */
export function leaderCostPct(state: GameState, target: number): number {
  if (state.header.config.win === undefined || target < 1 || target > state.header.players) return 100;
  let held = state.agg.warea[target] as number;
  // M18b-3: the members of one federation are priced by the share of the WHOLE group (a federation with 40 % is as dear or cheap as one nation with 40 %).
  const roots = federationRoots(state);
  if (roots !== null) {
    const root = roots[target] as number;
    held = 0;
    for (let o = 1; o <= state.header.players; o++) if (roots[o] === root) held += state.agg.warea[o] as number;
  }
  const share100 = held * 100;
  const total = state.grid.totalWeight;
  if (share100 > LEADER_LAND_PCT_HIGH * total) return LEADER_COST_PCT_HIGH;
  if (share100 > LEADER_LAND_PCT_MID * total) return LEADER_COST_PCT_MID;
  return 100;
}

/**
 * Scores of every owner into `out` (slots long): land in weighted std-cells plus SCORE_CITY_LEVEL_POINTS per finished City level plus
 * SCORE_FACTORY_LEVEL_POINTS per finished Factory level (an upgrade counts when it has finished). Allocation free.
 */
export function fillScores(state: GameState, out: Uint32Array): void {
  const seats = state.header.seats;
  for (let o = 1; o <= seats; o++) out[o] = landStdOf(state, o);
  out[0] = 0;
  const t = state.structures;
  if (t.liveCount === 0) return;
  const tick = state.tick;
  for (let id = 0; id < t.highWater; id++) {
    const o = t.owner[id] as number;
    if (o === 0 || tick < (t.readyTick[id] as number)) continue;
    const type = t.type[id] as number;
    if (type === STRUCT_CITY) out[o] = (out[o] as number) + SCORE_CITY_LEVEL_POINTS * (t.level[id] as number);
    else if (type === STRUCT_FACTORY) out[o] = (out[o] as number) + SCORE_FACTORY_LEVEL_POINTS * (t.level[id] as number);
  }
}

function endMatch(state: GameState, winner: number, reason: number): void {
  const m = state.match;
  m.ended = 1;
  m.winner = winner;
  m.reason = reason;
  m.endTick = state.tick;
  state.outbox.push(OUTBOX_MATCH_END, state.tick - 1, winner, reason);
}

/** The player (or, with federations, the group root) with the highest score (then land, then the lower ownerId). 0 when the match has no player. */
function scoreWinner(state: GameState): number {
  const players = state.header.players;
  const slots = ownerSlots(state.header.seats);
  const scores = new Uint32Array(slots);
  fillScores(state, scores);
  const roots = federationRoots(state);
  // Group totals (score, land) at the root index; without a federation every seat is its own root and the totals are the plain values.
  const gScore = new Uint32Array(slots);
  const gLand = new Uint32Array(slots);
  for (let o = 1; o <= players; o++) {
    const r = roots === null ? o : (roots[o] as number);
    gScore[r] = (gScore[r] as number) + (scores[o] as number);
    gLand[r] = (gLand[r] as number) + landStdOf(state, o);
  }
  let best = 0;
  for (let o = 1; o <= players; o++) {
    if (roots !== null && roots[o] !== o) continue;
    if (best === 0) {
      best = o;
      continue;
    }
    const a = gScore[o] as number;
    const b = gScore[best] as number;
    // Tiebreak: the higher land in the unit the score uses (weighted std-cells), then the lower seat (the loop is ascending, so only a strict gain replaces).
    if (a > b || (a === b && (gLand[o] as number) > (gLand[best] as number))) best = o;
  }
  return best;
}

/**
 * The last phase of a step (after the tick increment): peak land, elimination and capital-loss events, then the win conditions. O(seats) per
 * tick, plus one pass over the structures when the time limit decides. Does nothing once the match has ended.
 */
export function winPhase(state: GameState): void {
  const m = state.match;
  if (m.ended === 1) return;
  const seats = state.header.seats;
  const area = state.agg.area;
  const warea = state.agg.warea;
  for (let o = 1; o <= seats; o++) {
    const land = floorDiv(warea[o] as number, WEIGHT_PER_STD);
    if (land > (m.peakLand[o] as number)) m.peakLand[o] = land;
    const cap = state.capital[o] as number;
    if (m.eliminated[o] === 0 && (area[o] as number) === 0 && (cap !== 0 || (m.peakLand[o] as number) > 0)) {
      m.eliminated[o] = 1;
      clearDiplomacyOf(state, o);
      scrapOwnerHelis(state, o); // Fix-4A1: no helicopter may land and revive an eliminated seat
      state.outbox.push(OUTBOX_ELIMINATED, state.tick - 1, o - 1, 0);
    }
    if (cap !== 0) {
      const lost = state.owner[cap - 1] !== o ? 1 : 0;
      if (lost !== m.capitalLost[o]) {
        m.capitalLost[o] = lost;
        if (lost === 1) state.outbox.push(OUTBOX_CAPITAL_LOST, state.tick - 1, o - 1, 0);
      }
    }
  }
  const cfg = state.header.config.win;
  if (cfg === undefined) return;
  const start = playStartTick(state);
  if (state.tick <= start) return;
  const elapsed = state.tick - start;
  const players = state.header.players;

  if (cfg.last && players >= 2) {
    let alive = 0;
    let who = 0;
    const roots = federationRoots(state);
    for (let o = 1; o <= players; o++) {
      if (m.eliminated[o] === 0) {
        // Alive seats of ONE group count as one (a shared victory); `who` is then the first alive member.
        if (roots === null) {
          alive++;
          who = o;
        } else if (alive === 0 || roots[o] !== roots[who]) {
          alive++;
          if (who === 0) who = o;
        }
      }
    }
    if (alive <= 1) {
      endMatch(state, alive === 1 ? (roots === null ? who : (roots[who] as number)) : 0, alive === 1 ? WIN_REASON_LAST : WIN_REASON_NONE);
      return;
    }
  }

  if (cfg.land) {
    const total = state.grid.totalWeight;
    const need = requiredLandPct(cfg.landSharePct, elapsed) * total;
    let pick = 0;
    if (total > 0) {
      // A group's land is the sum over its members (a plain seat is a group of one); only roots are candidates.
      const roots = federationRoots(state);
      let sums: number[] | null = null;
      if (roots !== null) {
        sums = groupSumScratch(roots.length);
        for (let o = 1; o <= players; o++) sums[roots[o] as number] = (sums[roots[o] as number] as number) + (warea[o] as number);
      }
      const landOf = (o: number): number => (sums === null ? (warea[o] as number) : (sums[o] as number));
      const holder = m.holdOwner;
      if (holder !== 0 && landOf(holder) * 100 >= need) {
        pick = holder;
      } else {
        for (let o = 1; o <= players; o++) {
          if (roots !== null && roots[o] !== o) continue;
          if (landOf(o) * 100 >= need && (pick === 0 || landOf(o) > landOf(pick))) pick = o;
        }
      }
    }
    if (pick === 0) {
      m.holdOwner = 0;
      m.holdCount = 0;
    } else {
      m.holdCount = pick === m.holdOwner ? m.holdCount + 1 : 1;
      m.holdOwner = pick;
      if (m.holdCount >= cfg.holdTicks) {
        endMatch(state, pick, WIN_REASON_LAND);
        return;
      }
    }
  }

  if (cfg.score && elapsed >= cfg.timeLimitTicks) {
    const w = scoreWinner(state);
    endMatch(state, w, w === 0 ? WIN_REASON_NONE : WIN_REASON_SCORE);
  }
}
