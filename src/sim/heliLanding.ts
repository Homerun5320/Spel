// The landing of a helicopter and the life of its beachhead (M12a-3). Integer maths only; every number is in src/sim/rules.ts.
//
// LANDING (`performLanding`, called by heliFlight when the HELI_UNLOAD ticks are over). The landing zone is taken first, then its neighbours in the
// fixed order N, E, S, W, NE, SE, SW, NW (at most BEACHHEAD_LANDING_CELLS cells in all), each at the price of an Attack cell at depth 0 on level
// ground (`captureCostMilliQt`; terrain, the home trait and a Defense Post or Walls of the defender included), doubled when the cell is somebody
// else's (LANDING_ENEMY_COST_PCT), paid from the load with the same fractional carry as an Attack, until the load cannot pay for the next cell.
// A landing zone that cannot be taken (not enough troops for the first cell, an unplayable cell) fails and the load is lost. What is left of the load
// goes on as an ordinary Attack from the beachhead on the owner the landing zone had (or comes back to the seat when there is no contact).
//
// THE BEACHHEAD (`beachheadPhase`, every tick, before the flights). A row of `state.beachheads` is made at the landing (status BEACH_CUT_OFF, seed =
// the landing zone). Every BEACHHEAD_CHECK_TICKS ticks after the landing the cluster is searched (beachheadCluster.ts): it is ESTABLISHED (the row is
// freed, the cells are ordinary land) when the search reaches BEACHHEAD_ESTABLISH_CELLS cells or meets a City; otherwise, exactly
// BEACHHEAD_REVERT_TICKS after the landing, its cells go back to neutral. Two beachheads of one owner whose clusters touch are merged (the younger row
// is freed; PROVISIONAL, DECISIONS M12a-3). A seed that was taken by somebody else is moved to a neighbour that is still the owner's, else the row is freed.
import { addTroops } from './economy';
import { captureCostMilliQt, launchAttack } from './conquest';
import { adjustedCostMilliQt } from './homeRules';
import { BEACH_CUT_OFF } from './heliTable';
import { CLUSTER_CELLS, clearCluster, clusterHasCity, scanCluster } from './beachheadCluster';
import { OUTBOX_BEACHHEAD_FORMED, OUTBOX_BEACHHEAD_REVERTED, OUTBOX_HELI_LANDED } from './outbox';
import {
  BEACHHEAD_CHECK_TICKS,
  BEACHHEAD_ESTABLISH_CELLS,
  BEACHHEAD_LANDING_CELLS,
  BEACHHEAD_REVERT_TICKS,
  LANDING_ENEMY_COST_PCT,
  MILLI_QT_PER_QT,
  QT_PER_TROOP,
} from './rules';
import type { GameState } from './state';
import { collectPosts, collectWalls, postAdjustedCost, wallAdjustedCost } from './structureEffects';
import { changeOwner } from './territory';

/**
 * HOOK for the diplomacy track (M18c-1): may `owner` set troops down on a cell that belongs to `targetOwner`? No relation query exists yet, so it is
 * always false. When relations land, a truce or an alliance returns true here; a blocked landing keeps its load aboard and the helicopter turns home.
 */
export function landingBlockedBy(owner: number, targetOwner: number): boolean {
  void owner;
  void targetOwner;
  return false;
}

/** The neighbour offsets of the landing in their fixed order: N, E, S, W, NE, SE, SW, NW as (dx, dy). */
export const LANDING_ORDER_DX: readonly number[] = [0, 1, 0, -1, 1, 1, -1, -1];
export const LANDING_ORDER_DY: readonly number[] = [-1, 0, 1, 0, -1, 1, 1, -1];

/** The cell `k` of a landing at `lz`: k = 0 is the zone, 1..8 the neighbours in order; -1 when it is off the map (x wraps over the date line). */
export function landingCell(width: number, height: number, lz: number, k: number): number {
  if (k === 0) return lz;
  const x = lz % width;
  const y = (lz - x) / width;
  const yy = y + (LANDING_ORDER_DY[k - 1] as number);
  if (yy < 0 || yy >= height) return -1;
  const xs = x + (LANDING_ORDER_DX[k - 1] as number);
  const xx = xs < 0 ? width - 1 : xs >= width ? 0 : xs;
  return yy * width + xx;
}

/** The price of a landing cell in milli-QT (see the header): the Attack price at depth 0 on level ground, doubled for somebody else's land. */
export function landingCostMilli(state: GameState, cell: number, targetOwner: number, attacker: number): number {
  let cost = captureCostMilliQt(state.terrain[cell] as number, 0, 0);
  if (targetOwner !== 0) cost = Math.floor((cost * LANDING_ENEMY_COST_PCT) / 100);
  if (state.home !== null) cost = adjustedCostMilliQt(state.home, cost, cell, attacker, targetOwner);
  const posts = targetOwner !== 0 && state.structures.liveCount !== 0 ? collectPosts(state, targetOwner) : 0;
  const walls = targetOwner !== 0 && state.structures.districtCount !== 0 ? collectWalls(state, targetOwner) : 0;
  const w = state.grid.width;
  if (walls !== 0) {
    const walled = wallAdjustedCost(state.structures, w, cell, cost);
    cost = posts !== 0 ? Math.max(walled, postAdjustedCost(state.structures, w, cell, cost)) : walled;
  } else if (posts !== 0) cost = postAdjustedCost(state.structures, w, cell, cost);
  return cost;
}

/**
 * Sets the load of helicopter `id` down at its landing zone (`target - 1`). Returns nothing; afterwards the load is 0 unless the landing was not
 * made (own land or a blocked owner: the load stays aboard and flies home), and the events are in the outbox:
 * HELI_LANDED (a = helicopter, b = cells taken, -1 = a failed landing whose load is lost, 0 = no landing was made) and BEACHHEAD_FORMED (a = slot, b = seed).
 * The caller turns the helicopter for home afterwards.
 */
export function performLanding(state: GameState, id: number): void {
  const t = state.helis;
  const ownerId = t.owner[id] as number;
  const lz = (t.target[id] as number) - 1;
  const tick = state.tick;
  const grid = state.grid;
  const w = grid.width;
  const h = grid.cells / w;
  const lzOwner = state.owner[lz] as number;
  t.target[id] = 0;
  if (lzOwner === ownerId || (lzOwner !== 0 && landingBlockedBy(ownerId, lzOwner))) {
    state.outbox.push(OUTBOX_HELI_LANDED, tick, id, 0); // nothing to take here: the load flies home with the helicopter
    return;
  }
  let rem = (t.load[id] as number) * QT_PER_TROOP;
  t.load[id] = 0;
  let frac = 0;
  let taken = 0;
  for (let k = 0; k < BEACHHEAD_LANDING_CELLS; k++) {
    const c = landingCell(w, h, lz, k);
    if (c < 0 || grid.playable[c] === 0) {
      if (k === 0) break;
      continue;
    }
    const o = state.owner[c] as number;
    if (o === ownerId) continue;
    if (o !== 0 && landingBlockedBy(ownerId, o)) {
      if (k === 0) break;
      continue;
    }
    const owed = frac + landingCostMilli(state, c, o, ownerId);
    const whole = Math.floor(owed / MILLI_QT_PER_QT);
    if (rem < whole) break;
    rem -= whole;
    frac = owed - whole * MILLI_QT_PER_QT;
    changeOwner(state, c, ownerId, 0, -1, 0);
    taken++;
  }
  if (taken === 0 || state.owner[lz] !== ownerId) {
    // The zone itself could not be taken: the load is lost.
    state.outbox.push(OUTBOX_HELI_LANDED, tick, id, -1);
    return;
  }
  if (frac > 0 && rem > 0) rem -= 1; // the unpaid part of the last cell is paid, rounded up (as CancelAttack does)
  state.match.conquered[ownerId] = ((state.match.conquered[ownerId] as number) + taken) >>> 0;
  state.outbox.push(OUTBOX_HELI_LANDED, tick, id, taken);
  const slot = state.beachheads.add(ownerId, lz, tick, BEACH_CUT_OFF);
  if (slot >= 0) state.outbox.push(OUTBOX_BEACHHEAD_FORMED, tick, slot, lz);
  if (rem > 0) {
    // The rest of the load is an ordinary Attack from the beachhead on the land the zone was taken from.
    if (state.borders.contact(ownerId, lzOwner) > 0) launchAttack(state, ownerId, lzOwner, rem);
    else addTroops(state, ownerId, rem);
  }
}

/** The first of the eight neighbours of `cell` (order N, E, S, W, NE, SE, SW, NW) that is a playable cell of `ownerId`, else -1. */
function ownedNeighbour(state: GameState, cell: number, ownerId: number): number {
  const w = state.grid.width;
  const h = state.grid.cells / w;
  for (let k = 1; k <= 8; k++) {
    const c = landingCell(w, h, cell, k);
    if (c >= 0 && state.owner[c] === ownerId && state.grid.playable[c] === 1) return c;
  }
  return -1;
}

/** One check of beachhead row `i` (see the header). */
function checkBeachhead(state: GameState, i: number): void {
  const b = state.beachheads;
  const ownerId = b.owner[i] as number;
  if (state.owner[b.seed[i] as number] !== ownerId) {
    const n = ownedNeighbour(state, b.seed[i] as number, ownerId);
    if (n < 0) {
      b.remove(i);
      return;
    }
    b.seed[i] = n;
    b.dirty = true;
  }
  const n = scanCluster(state, b.seed[i] as number, ownerId);
  const city = clusterHasCity();
  // Merge: another cut-off row of this owner whose seed lies in this cluster. The younger row (later landing, else the higher slot) is freed.
  let mergedAway = false;
  if (b.liveCount > 1) {
    const mark = state.scratch.mark;
    for (let j = 0; j < b.capacity; j++) {
      if (j === i || b.owner[j] !== ownerId || mark[b.seed[j] as number] !== 1) continue;
      const jOlder = (b.landTick[j] as number) < (b.landTick[i] as number) || (b.landTick[j] === b.landTick[i] && j < i);
      if (jOlder) mergedAway = true;
      else b.remove(j);
    }
  }
  if (mergedAway) {
    clearCluster(state, n);
    b.remove(i);
    return;
  }
  if (n >= BEACHHEAD_ESTABLISH_CELLS || city) {
    clearCluster(state, n);
    b.remove(i); // established: ordinary land, the row is freed
    return;
  }
  if ((state.tick - (b.landTick[i] as number)) >= BEACHHEAD_REVERT_TICKS) {
    clearCluster(state, n);
    const seed = b.seed[i] as number;
    for (let k = 0; k < n; k++) changeOwner(state, CLUSTER_CELLS[k] as number, 0, 0, -1, 0);
    state.outbox.push(OUTBOX_BEACHHEAD_REVERTED, state.tick, i, seed);
    b.remove(i);
    return;
  }
  clearCluster(state, n);
}

/** The beachhead phase of a tick (called by heliPhase before the flights): the rows whose landing was a multiple of BEACHHEAD_CHECK_TICKS ticks ago are checked. */
export function beachheadPhase(state: GameState): void {
  const b = state.beachheads;
  if (b.liveCount === 0) return;
  const tick = state.tick;
  for (let i = 0; i < b.capacity; i++) {
    if (b.owner[i] === 0) continue;
    const age = tick - (b.landTick[i] as number);
    if (age <= 0 || age % BEACHHEAD_CHECK_TICKS !== 0) continue;
    checkBeachhead(state, i);
  }
}
