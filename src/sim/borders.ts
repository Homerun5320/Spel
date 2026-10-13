// The border index: what the conquest needs to know about where owners touch, kept in step by setOwner (territory.ts)
// and rebuildable from the owner array alone (so it is DERIVED: not serialised, not hashed).
//
//  - edges: for every pair of owners, the number of 4-neighbour adjacencies between a cell of one and a cell of the other.
//    This is the CONTACT LENGTH in cells of the capture formula. Owner 0 stands for unowned playable land; unplayable cells
//    (sea, Peak, Ice) take part in no adjacency, so the coast does not count as contact with anybody.
//  - diff: per cell, how many of its playable neighbours belong to somebody else (0..4).
//  - boundary lists: per owner, the cells with diff > 0, with swap-removal (position array `pos`). A new attack builds its
//    frontier from the boundary list of its attacker, so launching costs the border, not the territory, and never the map.
// The ORDER inside a boundary list depends on history; nothing that is stored may depend on it (a new attack sorts).
import type { Grid } from './grid';

export class BorderIndex {
  readonly slots: number;
  readonly edges: Int32Array;
  readonly diff: Uint8Array;
  readonly pos: Int32Array;
  readonly lists: Int32Array[];
  readonly counts: Int32Array;

  constructor(cells: number, ownerSlotCount: number) {
    this.slots = ownerSlotCount;
    this.edges = new Int32Array(ownerSlotCount * ownerSlotCount);
    this.diff = new Uint8Array(cells);
    this.pos = new Int32Array(cells).fill(-1);
    this.lists = [];
    for (let i = 0; i < ownerSlotCount; i++) this.lists.push(new Int32Array(0));
    this.counts = new Int32Array(ownerSlotCount);
  }

  /** Index of the unordered pair in `edges` (a !== b). */
  pair(a: number, b: number): number {
    return a < b ? a * this.slots + b : b * this.slots + a;
  }

  /** Adjacencies between the land of two owners (0 for a === b). */
  contact(a: number, b: number): number {
    return a === b ? 0 : (this.edges[this.pair(a, b)] as number);
  }

  /** Cells on the boundary of an owner. */
  boundaryLength(owner: number): number {
    return this.counts[owner] as number;
  }

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
    this.pos[cell] = n;
    this.counts[owner] = n + 1;
  }

  remove(owner: number, cell: number): void {
    const list = this.lists[owner] as Int32Array;
    const p = this.pos[cell] as number;
    const last = (this.counts[owner] as number) - 1;
    const moved = list[last] as number;
    list[p] = moved;
    this.pos[moved] = p;
    this.pos[cell] = -1;
    this.counts[owner] = last;
  }

  /** Changes diff[cell] by delta (the cell belongs to `owner`) and keeps the boundary list in step. */
  adjust(cell: number, owner: number, delta: number): void {
    const old = this.diff[cell] as number;
    const now = old + delta;
    this.diff[cell] = now;
    if (owner === 0) return;
    if (old === 0 && now > 0) this.add(owner, cell);
    else if (old > 0 && now === 0) this.remove(owner, cell);
  }

  /** Recomputes everything from the owner array. O(cells). */
  rebuild(owner: Uint16Array, grid: Grid): void {
    this.edges.fill(0);
    this.diff.fill(0);
    this.pos.fill(-1);
    this.counts.fill(0);
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
  }
}
