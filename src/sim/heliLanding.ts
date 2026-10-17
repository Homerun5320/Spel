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
import { atWar } from './diplomacy';
import type { GameState } from './state';
import { collectPosts, collectWalls, postAdjustedCost, wallAdjustedCost } from './structureEffects';
import { changeOwner } from './territory';

/** May `owner` set troops down on a cell that belongs to `targetOwner`? Not when a truce or an alliance binds them (the same rule as an Attack); a blocked landing keeps its load aboard and the helicopter turns home. */
export function landingBlockedBy(state: GameState, owner: number, targetOwner: number): boolean {
  return !atWar(state, owner, targetOwner);
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
 * The caller turns the helicopter for home afterwards. The landing itself is `landTroops`, shared with the ships of M13c-1.
 */
export function performLanding(state: GameState, id: number): void {
  const t = state.helis;
  const lz = (t.target[id] as number) - 1;
  t.target[id] = 0;
  const kept = landTroops(state, t.owner[id] as number, lz, t.load[id] as number, OUTBOX_HELI_LANDED, id);
  if (!kept) t.load[id] = 0;
}

/**
 * THE landing (M12a-3, shared with the ships of M13c-1): `load` troops of `ownerId` set down at the landing zone `lz`: the cells, the price, the beachhead row, the rest of the
 * load as an Attack. `landedKind` and `unit` name the OUTBOX_*_LANDED event (a = unit, b = cells taken, -1 = the zone could not be taken and the load is lost, 0 = nothing to land on).
 * Returns true when NO landing was made and the load stays aboard (own land or a blocked owner), false when the load is spent or lost.
 */
export function landTroops(state: GameState, ownerId: number, lz: number, load: number, landedKind: number, unit: number): boolean {
  const tick = state.tick;
  const grid = state.grid;
  const w = grid.width;
  const h = grid.cells / w;
  const lzOwner = state.owner[lz] as number;
  if (state.match.eliminated[ownerId] === 1) {
    // Fix-4A1: an eliminated seat never gets land back (winPhase scraps its helicopters; this is the guard for a state restored from before that rule).
    state.outbox.push(landedKind, tick, unit, -1);
    return false;
  }
  if (lzOwner === ownerId || (lzOwner !== 0 && landingBlockedBy(state, ownerId, lzOwner))) {
    state.outbox.push(landedKind, tick, unit, 0); // nothing to take here: the load flies home with the carrier
    return true;
  }
  let rem = load * QT_PER_TROOP;
  let frac = 0;
  let taken = 0;
  let joined = false; // Fix-4A1: some landed cell touches land the owner already held (before this landing)
  const got = LANDED;
  for (let k = 0; k < BEACHHEAD_LANDING_CELLS; k++) {
    const c = landingCell(w, h, lz, k);
    if (c < 0 || grid.playable[c] === 0) {
      if (k === 0) break;
      continue;
    }
    const o = state.owner[c] as number;
    if (o === ownerId) continue;
    if (o !== 0 && landingBlockedBy(state, ownerId, o)) {
      if (k === 0) break;
      continue;
    }
    const owed = frac + landingCostMilli(state, c, o, ownerId);
    const whole = Math.floor(owed / MILLI_QT_PER_QT);
    if (rem < whole) break;
    rem -= whole;
    frac = owed - whole * MILLI_QT_PER_QT;
    got[taken] = c;
    changeOwner(state, c, ownerId, 0, -1, 0);
    taken++;
  }
  if (taken > 0) joined = touchesOwnLand(state, ownerId, taken);
  if (taken === 0 || state.owner[lz] !== ownerId) {
    // The zone itself could not be taken: the load is lost.
    state.outbox.push(landedKind, tick, unit, -1);
    return false;
  }
  if (frac > 0 && rem > 0) rem -= 1; // the unpaid part of the last cell is paid, rounded up (as CancelAttack does)
  state.match.conquered[ownerId] = ((state.match.conquered[ownerId] as number) + taken) >>> 0;
  state.outbox.push(landedKind, tick, unit, taken);
  // A landing that joins land the owner already held is no beachhead: it is ordinary land at once (Fix-4A1; otherwise a small nation that lands
  // next to its own territory lost ALL of it 450 ticks later, the whole connected territory being the "cluster").
  const slot = joined ? -1 : state.beachheads.add(ownerId, lz, tick, BEACH_CUT_OFF);
  if (slot >= 0) state.outbox.push(OUTBOX_BEACHHEAD_FORMED, tick, slot, lz);
  if (rem > 0) {
    // The rest of the load is an ordinary Attack from the beachhead on the land the zone was taken from.
    if (state.borders.contact(ownerId, lzOwner) > 0) launchAttack(state, ownerId, lzOwner, rem);
    else addTroops(state, ownerId, rem);
  }
  return false;
}

/** The cells a landing took (in order), at most BEACHHEAD_LANDING_CELLS. */
const LANDED = new Int32Array(BEACHHEAD_LANDING_CELLS);

/** Is `cell` part of the cluster of a live cut-off row of `ownerId` (land that is itself still on probation)? Landings next to such land are merged by the row check instead. */
function inCutOffCluster(state: GameState, ownerId: number, cell: number): boolean {
  const b = state.beachheads;
  for (let i = 0; i < b.capacity; i++) {
    if (b.owner[i] !== ownerId) continue;
    const n = scanCluster(state, b.seed[i] as number, ownerId);
    const hit = n > 0 && state.scratch.mark[cell] === 1;
    clearCluster(state, n);
    if (hit) return n < BEACHHEAD_ESTABLISH_CELLS;
  }
  return false;
}

/** Does any of the first `count` cells of LANDED touch (8 neighbours) a cell of `ownerId` that is not itself one of them? */
function touchesOwnLand(state: GameState, ownerId: number, count: number): boolean {
  const w = state.grid.width;
  const h = state.grid.cells / w;
  for (let i = 0; i < count; i++) {
    for (let k = 1; k <= 8; k++) {
      const n = landingCell(w, h, LANDED[i] as number, k);
      if (n < 0 || state.owner[n] !== ownerId || state.grid.playable[n] === 0) continue;
      let landed = false;
      for (let j = 0; j < count; j++) if (LANDED[j] === n) landed = true;
      if (!landed && !inCutOffCluster(state, ownerId, n)) return true;
    }
  }
  return false;
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
  const cap = state.capital[ownerId] as number;
  const city = clusterHasCity() || (cap !== 0 && n < BEACHHEAD_ESTABLISH_CELLS && state.scratch.mark[cap - 1] === 1); // the capital cell makes a cluster established (Fix-4A1)
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
