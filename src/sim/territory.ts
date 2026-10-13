// Who owns which cell. setOwner is the ONLY function that writes state.owner during play: it keeps the per-owner
// aggregates (cells, Q15 weight), the border index (contact lengths, boundary cells), the frontiers of the attacks that care
// and the enclave candidates in step, and reports the change to the render-only outbox. Conquest, Spawn, the enclave flip
// and the debug paint all go through it, so no derived structure can be forgotten.
import type { Attack } from './attacks';
import { OUTBOX_PAINT } from './outbox';
import { WEIGHT_ONE } from './rules';
import type { GameState } from './state';

// Bound once at load, see src/sim/attacks.ts.
const PAINT = OUTBOX_PAINT;

/**
 * Gives a cell to `owner` (an ownerId, or NO_OWNER to free it), stamps it with the id of the intent or attack that did it
 * and tells the outbox. Does nothing but the stamp when the owner does not change. `owner` must be 0..seats.
 */
export function setOwner(state: GameState, cell: number, owner: number, stamp: number): void {
  changeOwner(state, cell, owner, stamp, -1, 0);
}

/**
 * setOwner for the conquest: `viaSlot` is the index in the attack table of the attack that takes the cell and `viaDepth`
 * the depth of the cell in that attack's frontier. The cells that this capture newly exposes to the SAME attack get depth
 * viaDepth + 1; every other attack that gains a frontier cell from it gets depth 0 (D82).
 */
export function changeOwner(state: GameState, cell: number, owner: number, stamp: number, viaSlot: number, viaDepth: number): void {
  const prev = state.owner[cell] as number;
  state.stamp[cell] = stamp;
  if (prev === owner) return;
  const weight = state.grid.weight(cell);
  const { area, warea } = state.agg;
  if (prev !== 0) {
    area[prev] = (area[prev] as number) - 1;
    warea[prev] = (warea[prev] as number) - weight;
  }
  if (owner !== 0) {
    area[owner] = (area[owner] as number) + 1;
    warea[owner] = (warea[owner] as number) + weight;
  }
  state.owner[cell] = owner;
  state.outbox.push(PAINT, state.tick, cell, owner);
  // A cell nobody can own (sea, Peak, Ice) takes part in no adjacency; only the debug paint can give one an owner.
  if (state.grid.playable[cell] === 1) afterChange(state, cell, prev, owner, viaSlot, viaDepth);
}

/**
 * Updates the derived structures for a playable cell that has just gone from `prev` to `next`. O(1): it reads the cells
 * around it.
 *
 * ENCLAVE CANDIDATES (D86). A region of one owner X that this change newly encloses by `next` alone contains a port (a
 * playable 4-neighbour of the cell, owner X, not `next`) and is found by a fill from that port. Which ports can matter:
 *  - a port whose owner is NOT `prev`: the cell was a leak of that region (it touched a different owner), the region may be
 *    closed now;
 *  - a port whose owner IS `prev`: the cell was part of the port's region, which only changes if taking the cell SPLITS it,
 *    i.e. when the non-`next` cells around the cell fall into two or more runs that contain a port (the cycle of the eight
 *    neighbours, runs of non-`next` cells), or if the cell itself was what kept the region open by touching a wall (sea,
 *    Peak, Ice, the edge of the map; a wall joins nothing, so the runs do not see it). A third owner at the cell needs no
 *    rule of its own: it is a port, and a port that is linked to the region's port through a non-`next` diagonal cell keeps
 *    touching it. A straight border between two owners queues nothing.
 * A cell that is itself waiting in the queue and changes owner hands its job to its non-`next` ports (the region it stood
 * for may now be a region next to it). The cell itself is queued only when it has at most one friendly neighbour (a lone
 * cell or a tip): the one way to make a pocket of `next` is to put its cell down inside somebody else's land.
 */
function afterChange(state: GameState, cell: number, prev: number, next: number, viaSlot: number, viaDepth: number): void {
  const grid = state.grid;
  const playable = grid.playable;
  const owner = state.owner;
  const b = state.borders;
  const edges = b.edges;
  const diff = b.diff;
  const slots = b.slots;
  const ports = state.scratch.ring;
  const seen = state.scratch.seen;
  const table = state.attacks;
  const attacking = table.list.length > 0;
  const enclaves = state.enclaves;
  const seed = state.header.seed;
  const w = grid.width;
  const x = grid.colMask >= 0 ? cell & grid.colMask : cell % w;
  const row = cell - x;
  // The four ports in the order N, E, S, W (-1: off the map, or a cell nobody can own), and how many are not `next`'s.
  const east = x + 1 === w ? row : cell + 1;
  const west = x === 0 ? row + w - 1 : cell - 1;
  ports[0] = row >= w && playable[cell - w] === 1 ? cell - w : -1;
  ports[1] = east !== cell && playable[east] === 1 ? east : -1;
  ports[2] = row + w < grid.cells && playable[cell + w] === 1 ? cell + w : -1;
  ports[3] = west !== cell && playable[west] === 1 ? west : -1;
  let nonNext = 0;
  let hasPrev = false;
  let leak = false; // the cell touched a wall: it may have been what kept its own region open
  for (let i = 0; i < 4; i++) {
    const n = ports[i] as number;
    if (n < 0) {
      leak = true;
      continue;
    }
    const r = owner[n] as number;
    if (r !== next) {
      nonNext++;
      if (r === prev) hasPrev = true;
    }
  }
  // Runs of non-`next` CELLS that contain a port: only worth working out when two such ports exist and one of them belongs
  // to `prev` (otherwise every non-`next` port is queued anyway, or none can matter).
  let runs = 0;
  if (hasPrev && nonNext >= 2) runs = portRuns(state, cell, row, x, next);
  const wasQueued = enclaves.queued[cell] === 1;
  let seenCount = 0;
  let diffHere = 0;
  let friends = 0;
  for (let i = 0; i < 4; i++) {
    const n = ports[i] as number;
    if (n < 0) continue;
    const r = owner[n] as number;
    if (r !== prev) {
      const e = prev < r ? prev * slots + r : r * slots + prev;
      edges[e] = (edges[e] as number) - 1;
    }
    if (r !== next) {
      const e = next < r ? next * slots + r : r * slots + next;
      edges[e] = (edges[e] as number) + 1;
      diffHere++;
      if (r !== prev || runs >= 2 || leak || wasQueued) enclaves.push(n, seed);
      if (attacking) {
        // The attack of `next` on `r` gains n, a cell of its target that now touches a new cell of the attacker.
        const s1 = table.slotOf[next * slots + r] as number;
        if (s1 >= 0 && !touchesOther(grid, owner, n, cell, next)) {
          // (n already touching another cell of the attacker means it is in the frontier already: no duplicate)
          (table.list[s1] as Attack).push(n, s1 === viaSlot ? viaDepth + 1 : 0);
          state.work.pushed++;
        }
        // The attack of `r` on `next` gains the cell itself: it is now land of its target and touches r.
        const s2 = table.slotOf[r * slots + next] as number;
        if (s2 >= 0) {
          let dup = false;
          for (let j = 0; j < seenCount; j++) if (seen[j] === s2) dup = true;
          if (!dup) {
            seen[seenCount++] = s2;
            (table.list[s2] as Attack).push(cell, 0);
            state.work.pushed++;
          }
        }
      }
      // the neighbour's count of foreign neighbours: the cell was prev (the same owner as n if r === prev) and is next now
      if (r === prev) {
        const old = diff[n] as number;
        diff[n] = old + 1;
        if (old === 0 && r !== 0 && b.listed[n] !== r) b.add(r, n);
      }
    } else {
      friends++;
      diff[n] = (diff[n] as number) - 1;
    }
  }
  diff[cell] = diffHere;
  if (diffHere > 0 && next !== 0 && b.listed[cell] !== next) b.add(next, cell);
  if (diffHere >= 3 || (diffHere > 0 && friends === 0)) enclaves.push(cell, seed);
}

/** Is `c` (-1: off the map) a playable cell, other than `cell`, that is not `next`'s? Walls (off the map, unplayable) are no cells: they join nothing. */
function otherCell(grid: GameState['grid'], owner: Uint16Array, c: number, cell: number, next: number): boolean {
  return c >= 0 && c !== cell && grid.playable[c] === 1 && owner[c] !== next;
}

/**
 * How many groups of non-`next` cells around `cell` contain a port (a 4-neighbour of it), counting two ports as one group
 * when they are joined along the cycle of the eight neighbours by non-`next` playable cells (the diagonal between two
 * consecutive ports). A wall (off the map, an unplayable cell) is no cell and joins nothing. Ports in the order N, E, S, W
 * are in ring[0..3] (-1 for a wall). 0 when no port is a non-`next` cell.
 */
function portRuns(state: GameState, cell: number, row: number, x: number, next: number): number {
  const grid = state.grid;
  const w = grid.width;
  const owner = state.owner;
  const ring = state.scratch.ring;
  const xe = x + 1 === w ? 0 : x + 1;
  const xw = x === 0 ? w - 1 : x - 1;
  const north = row >= w ? row - w : -1;
  const south = row + w < grid.cells ? row + w : -1;
  // the diagonals NE, SE, SW, NW sit between N and E, E and S, S and W, W and N
  ring[4] = north < 0 ? -1 : north + xe;
  ring[5] = south < 0 ? -1 : south + xe;
  ring[6] = south < 0 ? -1 : south + xw;
  ring[7] = north < 0 ? -1 : north + xw;
  let other = 0;
  for (let i = 0; i < 4; i++) if (otherCell(grid, owner, ring[i] as number, cell, next)) other |= 1 << i;
  let count = 0;
  let links = 0;
  for (let i = 0; i < 4; i++) {
    if (((other >> i) & 1) === 0) continue;
    count++;
    if (((other >> ((i + 1) & 3)) & 1) === 1 && otherCell(grid, owner, ring[4 + i] as number, cell, next)) links++;
  }
  const runs = count - links;
  return count > 0 && runs === 0 ? 1 : runs;
}

/**
 * Does the cell `n` touch a playable cell owned by `owner` other than `except`? The frontier of an attack gets n when the
 * attacker's first cell next to it appears; if n already touched another cell of the attacker, n was offered then (or
 * at the launch of the attack) and is queued: offering it again would only make a duplicate.
 */
function touchesOther(grid: GameState['grid'], owners: Uint16Array, n: number, except: number, owner: number): boolean {
  const w = grid.width;
  const x = grid.colMask >= 0 ? n & grid.colMask : n % w;
  const row = n - x;
  const playable = grid.playable;
  let m = x + 1 === w ? row : n + 1;
  if (m !== except && m !== n && owners[m] === owner && playable[m] === 1) return true;
  m = x === 0 ? row + w - 1 : n - 1;
  if (m !== except && m !== n && owners[m] === owner && playable[m] === 1) return true;
  if (row >= w) {
    m = n - w;
    if (m !== except && owners[m] === owner && playable[m] === 1) return true;
  }
  if (row + w < grid.cells) {
    m = n + w;
    if (m !== except && owners[m] === owner && playable[m] === 1) return true;
  }
  return false;
}

/** The adjacencies between the land of two owners: the contact length of the capture formula. 0 for the same owner. */
export function contactLength(state: GameState, a: number, b: number): number {
  return state.borders.contact(a, b);
}

/** The share of all playable land an owner holds, cos-weighted, as a Q15 fraction (32768 = all of it). 0 when the world has no playable land. */
export function landShareQ15(state: GameState, owner: number): number {
  const total = state.grid.totalWeight;
  if (total === 0) return 0;
  return Math.floor(((state.agg.warea[owner] as number) * WEIGHT_ONE) / total);
}
