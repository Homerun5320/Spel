// The border index: what the conquest needs to know about where owners touch, kept in step by setOwner (territory.ts)
// and rebuildable from the owner array alone (so it is DERIVED: not serialised, not hashed).
//
//  - edges: for every pair of owners, the number of 4-neighbour adjacencies between a cell of one and a cell of the other.
//    This is the CONTACT LENGTH in cells of the capture formula. Owner 0 stands for unowned playable land; unplayable cells
//    (sea, Peak, Ice) take part in no adjacency, so the coast does not count as contact with anybody.
//  - diff: per cell, how many of its playable neighbours belong to somebody else (0..4).
//  - boundary lists: per owner, a list of cells that are or were on its boundary (diff > 0). A cell is APPENDED when it
//    becomes a boundary cell and is not listed yet; it is never removed on the spot (that would cost random memory writes on
//    every capture). An entry is VALID when the cell still belongs to the owner and still has diff > 0; invalid entries
//    are skipped by whoever reads the list and dropped by a purge when the list has doubled since the last one. A new attack
//    builds its frontier from the valid entries of its attacker's list, so launching costs about the border, never the map.
// The ORDER inside a list, and which stale entries it still holds, depend on history; nothing that is stored may depend on
// them (a new attack sorts what it finds).
import type { Grid } from './grid';
import { FRONT_COMPACT_MIN } from './rules';

export class BorderIndex {
  readonly slots: number;
  readonly edges: Int32Array;
  readonly diff: Uint8Array;
  /** The owner whose list physically holds the cell (0 = none). A cell can also sit, stale, in the list of an earlier owner. */
  readonly listed: Uint16Array;
  readonly lists: Int32Array[];
  /** Entries in use per list, stale ones included. */
  readonly counts: Int32Array;
  /** Size at which a list is purged next. */
  readonly purgeAt: Int32Array;
  /** Lists that reached purgeAt (purged at the end of the conquest phase). */
  readonly full: Uint8Array;

  constructor(cells: number, ownerSlotCount: number) {
    this.slots = ownerSlotCount;
    this.edges = new Int32Array(ownerSlotCount * ownerSlotCount);
    this.diff = new Uint8Array(cells);
    this.listed = new Uint16Array(cells);
    this.lists = [];
    for (let i = 0; i < ownerSlotCount; i++) this.lists.push(new Int32Array(0));
    this.counts = new Int32Array(ownerSlotCount);
    this.purgeAt = new Int32Array(ownerSlotCount).fill(FRONT_COMPACT_MIN);
    this.full = new Uint8Array(ownerSlotCount);
  }

  /** Index of the unordered pair in `edges` (a !== b). */
  pair(a: number, b: number): number {
    return a < b ? a * this.slots + b : b * this.slots + a;
  }

  /** Adjacencies between the land of two owners (0 for a === b). */
  contact(a: number, b: number): number {
    return a === b ? 0 : (this.edges[this.pair(a, b)] as number);
  }

  /** Entries in an owner's boundary list (valid and stale): the cost of reading it. */
  listLength(owner: number): number {
    return this.counts[owner] as number;
  }

  /** Appends a cell to an owner's list. */
  add(owner: number, cell: number): void {
    let list = this.lists[owner] as Int32Array;
    const n = this.counts[owner] as number;
    if (n === list.length) {
      const bigger = new Int32Array(n === 0 ? 64 : n * 2);
      bigger.set(list);
      this.lists[owner] = bigger;
      list = bigger;
    }
    list[n] = cell;
    this.listed[cell] = owner;
    this.counts[owner] = n + 1;
    if (n + 1 >= (this.purgeAt[owner] as number)) this.full[owner] = 1;
  }

  /** Changes diff[cell] by delta (the cell belongs to `owner`); a cell that gets its first foreign neighbour joins the list. */
  adjust(cell: number, owner: number, delta: number): void {
    const old = this.diff[cell] as number;
    this.diff[cell] = old + delta;
    if (old === 0 && owner !== 0 && this.listed[cell] !== owner) this.add(owner, cell);
  }

  /** The valid entries of an owner's list (those whose cell is the owner's and has a foreign neighbour), for tests and for readers that want a copy. */
  validCells(owner: number, ownerOf: Uint16Array): number[] {
    const out: number[] = [];
    const list = this.lists[owner] as Int32Array;
    for (let i = 0; i < (this.counts[owner] as number); i++) {
      const c = list[i] as number;
      if (ownerOf[c] === owner && (this.diff[c] as number) > 0) out.push(c);
    }
    return out;
  }

  /**
   * Drops the invalid entries and the repeats from every list that has reached its purge size. `mark` is the all-zero
   * per-cell scratch of the state (left all-zero). Returns the entries it looked at.
   */
  purge(ownerOf: Uint16Array, mark: Uint8Array): number {
    let looked = 0;
    for (let o = 1; o < this.slots; o++) {
      if (this.full[o] === 0) continue;
      this.full[o] = 0;
      const list = this.lists[o] as Int32Array;
      const n = this.counts[o] as number;
      looked += n;
      let kept = 0;
      for (let i = 0; i < n; i++) {
        const c = list[i] as number;
        if (ownerOf[c] === o && (this.diff[c] as number) > 0 && mark[c] === 0) {
          mark[c] = 1;
          list[kept++] = c;
        } else if (this.listed[c] === o && !(ownerOf[c] === o && (this.diff[c] as number) > 0)) {
          this.listed[c] = 0;
        }
      }
      for (let i = 0; i < kept; i++) mark[list[i] as number] = 0;
      this.counts[o] = kept;
      this.purgeAt[o] = Math.max(FRONT_COMPACT_MIN, 2 * kept);
    }
    return looked;
  }

  /** Recomputes everything from the owner array. O(cells). */
  rebuild(owner: Uint16Array, grid: Grid): void {
    this.edges.fill(0);
    this.diff.fill(0);
    this.listed.fill(0);
    this.counts.fill(0);
    this.purgeAt.fill(FRONT_COMPACT_MIN);
    this.full.fill(0);
    const nb = new Int32Array(4);
    const playable = grid.playable;
    for (let c = 0; c < grid.cells; c++) {
      if (playable[c] === 0) continue;
      const o = owner[c] as number;
      const count = grid.neighbours(c, nb);
      let d = 0;
      for (let k = 0; k < count; k++) {
        const n = nb[k] as number;
        if (n === c || playable[n] === 0) continue;
        const r = owner[n] as number;
        if (r !== o) {
          d++;
          // each adjacency is seen from both of its cells; count it once, from the lower index
          if (c < n) this.edges[this.pair(o, r)] = (this.edges[this.pair(o, r)] as number) + 1;
        }
      }
      this.diff[c] = d;
      if (d > 0 && o !== 0) this.add(o, c);
    }
    this.full.fill(0);
  }
}
