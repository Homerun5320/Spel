// Conquest: attacks, their speed and their price. Everything here is integer maths; the units are in src/sim/rules.ts.
//
// An Attack (attacks.ts) takes the cells of its target that touch the attacker, cheapest depth first. Each tick every attack
// gains `captureRateMicroPerTick` micro-cells of progress and takes as many whole cells from its frontier bags
// as the progress allows, paying `captureCostMilliQt` for each out of the troops committed to it. It ends when its
// frontier is empty, the border is gone, or the committed troops cannot pay for the next cell; what is left goes back to
// the attacker.
//
// SPEED (std-cell formula of the plan, converted once):  v = K * sqrt(L) * 2F / (F + Td)  std-cells per second, with
//   L  the contact length: the adjacencies between the attacker's land and the target's, in sim cells; L / STD_CELL_SIDE
//      is the length in std-cells, so sqrt(L std) = isqrt(L * CAPTURE_SQRT_SCALE) / 1000;
//   F  the troops committed to this attack and Td the target's troops (0 for unowned land); F + Td == 0 gives speed 0.
// The cell RATE converts with STD_CELL_AREA (x4), per tick with / TICK_HZ.
// TERRAIN SLOWS THE CAPTURE (D106): a cell of class c takes TERRAIN_COST_PCT[c] / 100 cells' worth of progress, so a Mountain
// front moves 2.5 times slower than a Plains front. The extra is booked as DEBT after the capture (`a.progress` goes
// negative, down to -PROGRESS_DEBT_MAX) and is paid off by the next ticks' progress before the next cell falls.
//
// PRICE per sim cell (milli-QT):  BASE * terrain% * uphill * (1 + d / DEPTH_DIV), where
//   d   is the depth of the cell in the attack's frontier: how many captures separate it from land that touched the attacker
//       before; 0 at the border, clamped to D_MAX_CELLS (D82). The depth a capture gives a cell is also left in the cell
//       (state.exposure), so a new attack of the same attacker starts there and cancelling cannot reset it (D91);
//   dh  is the rise from the highest attacker cell next to the cell to the cell, in HEIGHT_UNIT_M units; uphill
//       = 1 + 0.25 * dh / 32 capped at x2, downhill and flat cost nothing extra (D83);
//   the defender pays no terrain term.
// HOME RULES (M06, D112 and D113, only when the match config has homeRules): the price is then multiplied by HOME_COST_PCT / 100 for a
// cell of the attacker's own home country and by the defence multiplier / 1000 of the seat the cell is taken from (see homeRules.ts).
import type { Attack } from './attacks';
import { addTroops, deductTroops, isTribe } from './economy';
import { isqrt } from './detmath';
import { adjustedCostMilliQt } from './homeRules';
import { hash2 } from './fixture';
import {
  BASE_COST_MILLI_QT_PER_SIM_CELL,
  CAPTURE_K_MILLI,
  CAPTURE_RATIO_TWO,
  CAPTURE_SQRT_SCALE,
  D_MAX_CELLS,
  DEPTH_COST_DIV_CELLS,
  FRONT_COMPACT_MIN,
  HEIGHT_UNIT_M,
  MICRO_CELLS_PER_CELL,
  MILLI_QT_PER_QT,
  PROGRESS_DEBT_MAX,
  STD_CELL_AREA,
  TERRAIN_COST_PCT,
  TICK_HZ,
  TRIBE_ATTACK_DIV,
  UPHILL_MAX_PCT,
  UPHILL_PER_STEP_MILLI,
  UPHILL_STEP_UNITS,
} from './rules';
import { PHASE_IMMUNITY, PHASE_SPAWN, phaseAt } from './flow';
import {
  REJECT_IMMUNE,
  REJECT_NONE,
  REJECT_NO_ATTACK,
  REJECT_NO_CONTACT,
  REJECT_NO_TROOPS,
  REJECT_NOT_SPAWNED,
  REJECT_PHASE,
  REJECT_SELF,
} from './intents';
import { seatToOwner, type GameState } from './state';
import { changeOwner } from './territory';
import { leaderCostPct } from './win';
import { collectPosts, collectWalls, postAdjustedCost, wallAdjustedCost } from './structureEffects';

// Bound once at load: the capture loop calls and reads these for every cell (see src/sim/attacks.ts for why).
const takeCell = changeOwner;
const COST_PCT = TERRAIN_COST_PCT;
const BASE_MILLI_QT = BASE_COST_MILLI_QT_PER_SIM_CELL;
const DEPTH_DIV = DEPTH_COST_DIV_CELLS;
const DEPTH_MAX = D_MAX_CELLS;
const HEIGHT_UNIT = HEIGHT_UNIT_M;
const MILLI_QT = MILLI_QT_PER_QT;
const UPHILL_PER_STEP = UPHILL_PER_STEP_MILLI;
const UPHILL_STEP = UPHILL_STEP_UNITS;
const UPHILL_CAP = UPHILL_MAX_PCT * 10;
/** Micro-cells of progress per percent point of terrain cost above (or below) Plains. */
const MICRO_PER_PCT = MICRO_CELLS_PER_CELL / 100;
const DEBT_MAX = PROGRESS_DEBT_MAX;
/** Salt of the per-tick order in which the attacks run. */
const ORDER_SALT = 0x2d4b;
/** Attack counts stay below this (seats * seats <= 65025), which lets the run order pack (hash, index) into one safe integer. */
const INDEX_RANGE = 65536;

/**
 * Micro-cells gained per tick by an attack: contact length `contact` (sim cells), `troopsQt` committed, `defenderQt` the
 * target's troops. 0 when there is no contact or nobody has troops. K is in thousandths, sqrt(L std) in thousandths, the troop
 * ratio in millionths and the result in millionths of a cell per tick: K * sqrt * ratio * AREA / (10^6 * TICK_HZ). Products
 * stay below 2^53 for contact < 2^20, troops below 2^32 and K <= 1000 (1000 * 1024000 * 2000000 * 4 < 2^53).
 */
export function captureRateMicroPerTick(contact: number, troopsQt: number, defenderQt: number): number {
  if (contact <= 0 || troopsQt <= 0) return 0;
  const sum = troopsQt + defenderQt;
  if (sum <= 0) return 0;
  const sqrtMilli = isqrt(contact * CAPTURE_SQRT_SCALE);
  const ratio = Math.floor((CAPTURE_RATIO_TWO * troopsQt) / sum);
  return Math.floor((CAPTURE_K_MILLI * sqrtMilli * ratio * STD_CELL_AREA) / (1000000 * TICK_HZ));
}

/** The uphill factor in thousandths for a rise of `dhUnits` height units: 1000 for flat or downhill, at most UPHILL_MAX_PCT * 10. */
export function uphillMilli(dhUnits: number): number {
  if (dhUnits <= 0) return 1000;
  const f = 1000 + Math.floor((UPHILL_PER_STEP * dhUnits) / UPHILL_STEP);
  return f > UPHILL_CAP ? UPHILL_CAP : f;
}

/** The depth that counts for the price: 0 .. D_MAX_CELLS. */
export function clampDepth(d: number): number {
  return d < 0 ? 0 : d > DEPTH_MAX ? DEPTH_MAX : d;
}

/**
 * Price in milli-QT of taking one sim cell of terrain class `cls` that lies `dhUnits` above the attacker's cell (negative
 * or 0 = level or downhill) at depth `depth`. 0 for a class nobody can own (never asked for in play).
 */
export function captureCostMilliQt(cls: number, dhUnits: number, depth: number): number {
  const pct = (COST_PCT[cls] ?? 0) as number;
  if (pct <= 0) return 0;
  const d = clampDepth(depth);
  // BASE * pct/100 * up/1000 * (DIV + d)/DIV, multiplied out and divided once so that nothing is rounded early (< 2^53).
  return Math.floor((BASE_MILLI_QT * pct * uphillMilli(dhUnits) * (DEPTH_DIV + d)) / (100 * 1000 * DEPTH_DIV));
}

/** The rise in height units from the attacker's source cell to the target (metres of mean elevation, floor; 0 or less = no rise). */
export function riseUnits(targetElevationM: number, sourceElevationM: number): number {
  const rise = targetElevationM - sourceElevationM;
  return rise <= 0 ? 0 : Math.floor(rise / HEIGHT_UNIT);
}

/** Terrain classes and depths the flat-price table covers (a class outside it takes the general formula). */
const FLAT_CLASSES = 8;
const FLAT_DEPTHS = D_MAX_CELLS + 1;
/** captureCostMilliQt(class, 0, depth) for every class and depth, filled from the function itself: the price on level ground or downhill. */
const FLAT_COST = new Int32Array(FLAT_CLASSES * FLAT_DEPTHS);
for (let c = 0; c < FLAT_CLASSES; c++) for (let d = 0; d < FLAT_DEPTHS; d++) FLAT_COST[c * FLAT_DEPTHS + d] = captureCostMilliQt(c, 0, d);
/** The progress a capture of a cell of each terrain class owes (micro-cells): ((TERRAIN_COST_PCT - 100) * MICRO_PER_PCT; 0 for a class off the table). */
const PROGRESS_OWED = new Int32Array(256);
for (let c = 0; c < 256; c++) PROGRESS_OWED[c] = ((COST_PCT[c] ?? 100) - 100) * MICRO_PER_PCT;

/** Builds the frontier of a new attack from the boundary cells of its attacker: the target cells that touch them. */
function buildFrontier(state: GameState, a: Attack): void {
  const b = state.borders;
  const list = b.lists[a.attacker] as Int32Array;
  const count = b.counts[a.attacker] as number;
  const mark = state.scratch.mark;
  const owner = state.owner;
  const nb = state.scratch.nb;
  const grid = state.grid;
  const found: number[] = [];
  const exposure = state.exposure;
  for (let i = 0; i < count; i++) {
    const c = list[i] as number;
    state.work.launchScanned++;
    if (owner[c] !== a.attacker || (b.diff[c] as number) === 0) continue; // a stale entry
    const cnt = grid.neighbours(c, nb);
    for (let k = 0; k < cnt; k++) {
      const n = nb[k] as number;
      if (mark[n] === 0 && n !== c && grid.playable[n] === 1 && owner[n] === a.target) {
        mark[n] = 1;
        found.push(n);
      }
    }
  }
  for (let i = 0; i < found.length; i++) mark[found[i] as number] = 0;
  // Sorted by cell index the frontier does not depend on the order of the boundary list (which depends on history).
  found.sort((x, y) => x - y);
  // A cell this attacker's captures exposed earlier keeps its depth, so cancelling and relaunching does not reset the price (D91).
  const depths: number[] = [];
  for (let i = 0; i < found.length; i++) {
    const e = exposure[found[i] as number] as number;
    depths.push(e >>> 8 === a.attacker ? e & 255 : 0);
  }
  a.setInitial(found, depths);
  a.compactAt = Math.max(FRONT_COMPACT_MIN, 2 * found.length);
  state.work.pushed += found.length;
}

/** Is `cell` a cell the attack can take right now: its target's, playable, and touching a playable cell of the attacker? (A cell nobody can own, painted by the debug intent, is no border.) */
function qualifies(state: GameState, a: Attack, cell: number): boolean {
  const grid = state.grid;
  if (state.owner[cell] !== a.target || grid.playable[cell] === 0) return false;
  const nb = state.scratch.nb;
  const cnt = grid.neighbours(cell, nb);
  for (let k = 0; k < cnt; k++) {
    const n = nb[k] as number;
    if (n !== cell && state.owner[n] === a.attacker && grid.playable[n] === 1) return true;
  }
  return false;
}

/** Drops the entries that no longer qualify from an attack's bags (the order of the others is kept). */
export function compactFront(state: GameState, a: Attack): void {
  for (let d = 0; d < a.counts.length; d++) {
    const n = a.counts[d] as number;
    if (n === 0) continue;
    const bag = a.bags[d] as Int32Array;
    let kept = 0;
    for (let i = 0; i < n; i++) {
      const c = bag[i] as number;
      state.work.purged++;
      if (qualifies(state, a, c)) bag[kept++] = c;
    }
    a.counts[d] = kept;
  }
  a.recount();
  a.compactAt = Math.max(FRONT_COMPACT_MIN, 2 * a.size);
}

/**
 * Takes up to `n` cells for the attack at index `slot` of the table (shallowest first, by hash within a depth). Returns how many it took. Sets
 * `a.dead` when the attack is over (no frontier left, or the troops cannot pay for the next cell). This is the whole cost
 * of an attack in a tick: O(n) plus the stale entries it picks on the way.
 */
export function advanceAttack(state: GameState, a: Attack, slot: number, n: number): number {
  const owner = state.owner;
  const grid = state.grid;
  const playable = grid.playable;
  const elevation = state.elevation;
  const terrain = state.terrain;
  const seed = state.header.seed;
  const home = state.home;
  const attacker = a.attacker;
  const target = a.target;
  const stamp = a.id;
  // Defense Posts (M09 part B): the finished Posts of the target make its cells near them dearer for the attacker.
  const posts = target !== 0 && state.structures.liveCount !== 0 ? collectPosts(state, target) : 0;
  const walls = target !== 0 && state.structures.districtCount !== 0 ? collectWalls(state, target) : 0;
  // Anti-snowball (M18-1): a nation above the leader thresholds is cheaper to attack; fixed for the whole call (the share moves by a few cells at most).
  const leaderPct = leaderCostPct(state, target);
  const w = grid.width;
  const colMask = grid.colMask;
  const cells = grid.cells;
  // The attack's own numbers live in locals while the loop runs and are written back once at the end (nothing in the loop reads them).
  let troops = a.troops;
  let costFrac = a.costFrac;
  let progress = a.progress;
  let taken = 0;
  let popped = 0;
  while (taken < n) {
    const cell = a.pick(seed);
    if (cell < 0) {
      a.dead = true;
      break;
    }
    popped++;
    if (owner[cell] !== target || playable[cell] === 0) continue;
    // Does the cell still touch the attacker, and from which attacker cell is it cheapest to come (the highest)? The four
    // neighbours are read in place (what Grid.neighbours gives: x wraps, no row above row 0 or below the last).
    const x = colMask >= 0 ? cell & colMask : cell % w;
    const row = cell - x;
    let source = -1;
    if (row > 0) {
      const m = cell - w;
      if (owner[m] === attacker && playable[m] === 1) {
        const e = elevation[m] as number;
        if (e > source) source = e;
      }
    }
    let m = x + 1 === w ? row : cell + 1;
    if (m !== cell && owner[m] === attacker && playable[m] === 1) {
      const e = elevation[m] as number;
      if (e > source) source = e;
    }
    if (row + w < cells) {
      m = cell + w;
      if (owner[m] === attacker && playable[m] === 1) {
        const e = elevation[m] as number;
        if (e > source) source = e;
      }
    }
    m = x === 0 ? cell + w - 1 : cell - 1;
    if (m !== cell && owner[m] === attacker && playable[m] === 1) {
      const e = elevation[m] as number;
      if (e > source) source = e;
    }
    if (source < 0) continue;
    const depth = a.lastDepth;
    const cls = terrain[cell] as number;
    // Level ground or downhill (a rise below one height unit) is the common case: its price is looked up, not worked out.
    const rise = (elevation[cell] as number) - source;
    let cost = rise < HEIGHT_UNIT && cls < FLAT_CLASSES ? (FLAT_COST[cls * FLAT_DEPTHS + depth] as number) : captureCostMilliQt(cls, riseUnits(elevation[cell] as number, source), depth);
    // Home land (D112) and the defence trait (D113): only a match with homeRules has them; for the others this is one comparison.
    if (home !== null) cost = adjustedCostMilliQt(home, cost, cell, attacker, target);
    if (walls !== 0) {
      // Walls (Districts-1) and a Defense Post do not stack: the dearer of the two prices applies.
      const walled = wallAdjustedCost(state.structures, w, cell, cost);
      cost = posts !== 0 ? Math.max(walled, postAdjustedCost(state.structures, w, cell, cost)) : walled;
    } else if (posts !== 0) cost = postAdjustedCost(state.structures, w, cell, cost);
    // The attacker's discount comes AFTER the defence multipliers (home trait, Walls / Post: the largest of those applies): price = defended price x pct / 100.
    if (leaderPct !== 100) cost = Math.floor((cost * leaderPct) / 100);
    const owed = (costFrac + cost) | 0;
    const whole = (owed / MILLI_QT) | 0;
    if (troops < whole) {
      a.dead = true;
      break;
    }
    troops -= whole;
    costFrac = owed - whole * MILLI_QT;
    takeCell(state, cell, attacker, stamp, slot, depth);
    // Terrain slows the front: the extra progress this cell was worth is owed (a Mountain cell: 1.5 cells' worth).
    const owedProgress = progress - (PROGRESS_OWED[cls] as number);
    progress = owedProgress < -DEBT_MAX ? -DEBT_MAX : owedProgress;
    taken++;
  }
  a.troops = troops;
  a.costFrac = costFrac;
  a.progress = progress;
  state.work.popped += popped;
  state.work.captured += taken;
  state.match.conquered[attacker] = ((state.match.conquered[attacker] as number) + taken) >>> 0;
  return taken;
}

/**
 * Ends an attack at once: its remaining troops go back to the attacker. For use between phases (intents). The part of a cell's
 * price that was owed but not yet paid (`costFrac`) is paid now, rounded up to one QT, so that cancelling and relaunching an
 * attack cannot round a price away (D91).
 */
function endNow(state: GameState, a: Attack): void {
  const owed = a.costFrac > 0 && a.troops > 0 ? 1 : 0;
  addTroops(state, a.attacker, a.troops - owed);
  a.troops = 0;
  a.dead = true;
  state.attacks.removeDead();
}

/**
 * Starts (or reinforces) the attack of `attacker` on `target` with `commitQt` troops that have already been taken from the
 * attacker. Mutual attacks cancel: if the target is attacking the attacker, the two forces are set against each other, both
 * lose the smaller of the two, the one left with nothing ends, and the other goes on with what remains (D85).
 */
export function launchAttack(state: GameState, attacker: number, target: number, commitQt: number): void {
  const table = state.attacks;
  let commit = commitQt;
  if (target !== 0) {
    const counter = table.find(target, attacker);
    if (counter !== null) {
      const clash = commit < counter.troops ? commit : counter.troops;
      commit -= clash;
      counter.troops -= clash;
      if (counter.troops === 0) endNow(state, counter);
      if (commit === 0) return;
    }
  }
  const existing = table.find(attacker, target);
  if (existing !== null) {
    const sum = existing.troops + commit;
    existing.troops = sum > 4294967295 ? 4294967295 : sum;
    return;
  }
  const a = table.create(attacker, target, commit);
  buildFrontier(state, a);
}

/** Applies an Attack intent. Returns REJECT_NONE or the reason it was refused (nothing changed then). */
export function applyAttack(state: GameState, seat: number, target: number, pct: number): number {
  const owner = seatToOwner(seat);
  if (state.header.config.spawnPhase === true) {
    // Match flow (D92): no Attack in the spawn phase, none on owned land in the immunity that follows.
    const phase = phaseAt(state.tick);
    if (phase === PHASE_SPAWN) return REJECT_PHASE;
    if (phase === PHASE_IMMUNITY && target !== 0) return REJECT_IMMUNE;
  }
  if ((state.agg.area[owner] as number) === 0) return REJECT_NOT_SPAWNED;
  if (target === owner) return REJECT_SELF;
  if (state.borders.contact(owner, target) === 0) return REJECT_NO_CONTACT;
  const have = state.troops[owner] as number;
  const commit = isTribe(state, owner) ? Math.floor(have / TRIBE_ATTACK_DIV) : Math.floor((have * pct) / 100);
  if (commit <= 0) return REJECT_NO_TROOPS;
  launchAttack(state, owner, target, deductTroops(state, owner, commit));
  return REJECT_NONE;
}

/** Applies a CancelAttack intent. */
export function applyCancelAttack(state: GameState, seat: number, target: number): number {
  const a = state.attacks.find(seatToOwner(seat), target);
  if (a === null) return REJECT_NO_ATTACK;
  endNow(state, a);
  return REJECT_NONE;
}

/**
 * The conquest phase of a tick: every attack, in an order that is a hash of (seed, tick, attack id), gains progress and takes
 * its cells; finished attacks hand their troops back and leave the table.
 */
export function conquestPhase(state: GameState): void {
  const table = state.attacks;
  const attacks = table.list;
  const count = attacks.length;
  state.work.attacks = count;
  if (count === 0) {
    state.work.purged += state.borders.purge(state.owner, state.scratch.mark);
    return;
  }
  const order: number[] = [];
  for (let i = 0; i < count; i++) order.push(hash2(state.header.seed, state.tick, (attacks[i] as Attack).id ^ ORDER_SALT) * INDEX_RANGE + i);
  if (count > 1) order.sort((x, y) => x - y);
  for (let o = 0; o < count; o++) {
    const slot = (order[o] as number) % INDEX_RANGE;
    const a = attacks[slot] as Attack;
    if (a.dead) continue;
    const contact = state.borders.contact(a.attacker, a.target);
    if (a.troops === 0 || contact === 0 || (state.agg.area[a.attacker] as number) === 0) {
      a.dead = true;
      continue;
    }
    const defender = a.target === 0 ? 0 : (state.troops[a.target] as number);
    const progress = a.progress + captureRateMicroPerTick(contact, a.troops, defender);
    // Below one cell (or still in terrain debt) nothing falls this tick and the progress, possibly negative, is kept.
    const whole = progress >= MICRO_CELLS_PER_CELL ? Math.floor(progress / MICRO_CELLS_PER_CELL) : 0;
    a.progress = progress - whole * MICRO_CELLS_PER_CELL;
    if (whole > 0) advanceAttack(state, a, slot, whole);
    if (!a.dead && a.size >= a.compactAt) compactFront(state, a);
  }
  let anyDead = false;
  for (let i = 0; i < count; i++) {
    const a = attacks[i] as Attack;
    if (a.dead) {
      addTroops(state, a.attacker, a.troops);
      a.troops = 0;
      anyDead = true;
    }
  }
  if (anyDead) table.removeDead();
  state.work.purged += state.borders.purge(state.owner, state.scratch.mark);
}
