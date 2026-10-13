// The attack table: the real game state of the conquest. One Attack per (attacker, target) pair holds the troops committed
// to it, the progress it has made towards the next cell and its FRONTIER: a binary min-heap of the target cells that touch
// the attacker's land, ordered by (depth, hash of the cell, cell index). The hash is the tie-break between cells of equal
// depth: it depends on the match seed and the cell, never on the order in which cells were found.
//
// The heap is filled incrementally (territory.ts: whenever a cell changes owner its neighbours are offered to the attacks
// that care) and emptied lazily: an entry is checked when it reaches the top, and one that no longer qualifies (the cell
// changed owner, or no longer touches the attacker) is dropped. Duplicates are harmless for the same reason. So the heap
// always holds a superset of the true frontier (a test compares it with a brute-force recomputation) and nothing ever scans
// the map. Every Attack is serialised and hashed with its heap arrays as they are.
import { hash2 } from './fixture';
import { D_MAX_CELLS, FRONT_COMPACT_MIN } from './rules';

/** Salt of the frontier tie-break hash. */
const FRONT_SALT = 0x6f17;
/** The depth lives in the top 8 bits of a key, the 24-bit hash below it (D_MAX_CELLS must stay below 256, a test checks it). */
export const KEY_DEPTH_SHIFT = 24;
const KEY_DEPTH_UNIT = 16777216;
const INITIAL_CAPACITY = 16;

/** The heap key of a cell at a depth: depth first, then the 24-bit hash of (seed, cell). Depth is clamped to D_MAX_CELLS. */
export function frontKey(seed: number, cell: number, depth: number): number {
  const d = depth > D_MAX_CELLS ? D_MAX_CELLS : depth;
  return d * KEY_DEPTH_UNIT + (hash2(seed, cell, FRONT_SALT) >>> 8);
}

/** The depth stored in a key. */
export function keyDepth(key: number): number {
  return key >>> KEY_DEPTH_SHIFT;
}

export class Attack {
  /** 1, 2, 3 ... in order of creation; also the stamp of the cells this attack takes. */
  id: number;
  /** ownerId of the attacker. */
  attacker: number;
  /** ownerId of the target, 0 = unowned land. */
  target: number;
  /** Troops committed, in QT. */
  troops: number;
  /** Cost already owed for the next cell, in milli-QT (< MILLI_QT_PER_QT). */
  costFrac: number;
  /** Capture progress in micro-cells (< MICRO_CELLS_PER_CELL between ticks). */
  progress: number;
  /** Heap size at which the next purge runs. */
  compactAt: number;
  /** Entries in use. */
  size = 0;
  cells: Int32Array;
  keys: Uint32Array;
  /** Set while the conquest phase runs when the attack is over; removed at the end of the phase. Never stored. */
  dead = false;

  constructor(id: number, attacker: number, target: number, troops: number) {
    this.id = id;
    this.attacker = attacker;
    this.target = target;
    this.troops = troops;
    this.costFrac = 0;
    this.progress = 0;
    this.compactAt = FRONT_COMPACT_MIN;
    this.cells = new Int32Array(INITIAL_CAPACITY);
    this.keys = new Uint32Array(INITIAL_CAPACITY);
  }

  /** Makes room for at least `n` entries. */
  reserve(n: number): void {
    if (n <= this.cells.length) return;
    let cap = this.cells.length;
    while (cap < n) cap *= 2;
    const cells = new Int32Array(cap);
    const keys = new Uint32Array(cap);
    cells.set(this.cells.subarray(0, this.size));
    keys.set(this.keys.subarray(0, this.size));
    this.cells = cells;
    this.keys = keys;
  }

  /** Adds an entry. */
  push(cell: number, key: number): void {
    if (this.size === this.cells.length) this.reserve(this.size + 1);
    const cells = this.cells;
    const keys = this.keys;
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      const pk = keys[p] as number;
      const pc = cells[p] as number;
      if (pk < key || (pk === key && pc <= cell)) break;
      cells[i] = pc;
      keys[i] = pk;
      i = p;
    }
    cells[i] = cell;
    keys[i] = key;
  }

  /** Removes the smallest entry (the heap must not be empty). */
  pop(): void {
    const n = --this.size;
    if (n === 0) return;
    const cells = this.cells;
    const keys = this.keys;
    const lastC = cells[n] as number;
    const lastK = keys[n] as number;
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= n) break;
      const r = c + 1;
      if (r < n) {
        const rk = keys[r] as number;
        const ck = keys[c] as number;
        if (rk < ck || (rk === ck && (cells[r] as number) < (cells[c] as number))) c = r;
      }
      const ck = keys[c] as number;
      const cc = cells[c] as number;
      if (ck < lastK || (ck === lastK && cc < lastC)) {
        cells[i] = cc;
        keys[i] = ck;
        i = c;
      } else break;
    }
    cells[i] = lastC;
    keys[i] = lastK;
  }

  /** Restores the heap order of the first `size` entries in place (Floyd's O(n) construction; deterministic in the array order). */
  heapify(): void {
    const n = this.size;
    const cells = this.cells;
    const keys = this.keys;
    for (let start = (n >> 1) - 1; start >= 0; start--) {
      const c0 = cells[start] as number;
      const k0 = keys[start] as number;
      let i = start;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        const r = c + 1;
        if (r < n) {
          const rk = keys[r] as number;
          const ck = keys[c] as number;
          if (rk < ck || (rk === ck && (cells[r] as number) < (cells[c] as number))) c = r;
        }
        const ck = keys[c] as number;
        const cc = cells[c] as number;
        if (ck < k0 || (ck === k0 && cc < c0)) {
          cells[i] = cc;
          keys[i] = ck;
          i = c;
        } else break;
      }
      cells[i] = c0;
      keys[i] = k0;
    }
  }

  /** Does the heap order hold for every parent and child? (deserialize and the tests.) */
  isHeap(): boolean {
    for (let i = 1; i < this.size; i++) {
      const p = (i - 1) >> 1;
      const pk = this.keys[p] as number;
      const ck = this.keys[i] as number;
      if (ck < pk || (ck === pk && (this.cells[i] as number) < (this.cells[p] as number))) return false;
    }
    return true;
  }
}

/** The attacks of a match, in order of creation (ids ascending), and the lookup from (attacker, target) to the list index. */
export class AttackTable {
  /** Attacks created so far; the next one gets id seq + 1. */
  seq = 0;
  list: Attack[] = [];
  /** Derived: index in `list` of the attack of (attacker, target), -1 if none; slots * slots entries, index attacker * slots + target. */
  readonly slotOf: Int32Array;
  readonly slots: number;

  constructor(ownerSlotCount: number) {
    this.slots = ownerSlotCount;
    this.slotOf = new Int32Array(ownerSlotCount * ownerSlotCount).fill(-1);
  }

  /** Rebuilds `slotOf` from `list` (after a removal shifted the indices, and after deserialize). */
  reindex(): void {
    this.slotOf.fill(-1);
    for (let i = 0; i < this.list.length; i++) {
      const a = this.list[i] as Attack;
      this.slotOf[a.attacker * this.slots + a.target] = i;
    }
  }

  /** The attack of (attacker, target) or null. */
  find(attacker: number, target: number): Attack | null {
    const i = this.slotOf[attacker * this.slots + target] as number;
    return i < 0 ? null : (this.list[i] as Attack);
  }

  /** Index of the attack in `list`, or -1. */
  indexOf(attacker: number, target: number): number {
    return this.slotOf[attacker * this.slots + target] as number;
  }

  /** Appends a new attack (the caller has checked that (attacker, target) is free). */
  create(attacker: number, target: number, troops: number): Attack {
    const a = new Attack(++this.seq, attacker, target, troops);
    this.slotOf[attacker * this.slots + target] = this.list.length;
    this.list.push(a);
    return a;
  }

  /** Removes the attacks flagged `dead`, keeping the order of the others. Returns how many went. */
  removeDead(): number {
    let kept = 0;
    for (let i = 0; i < this.list.length; i++) {
      const a = this.list[i] as Attack;
      if (!a.dead) this.list[kept++] = a;
    }
    const removed = this.list.length - kept;
    if (removed > 0) {
      this.list.length = kept;
      this.reindex();
    }
    return removed;
  }
}
