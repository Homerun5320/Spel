// The attack table: the real game state of the conquest. One Attack per (attacker, target) pair holds the troops committed
// to it, the progress it has made towards the next cell and its FRONTIER: the target cells that touch the attacker's land,
// kept in one bag per DEPTH (0 .. D_MAX_CELLS; the depth is what the price of a cell depends on, D82). The attack always
// takes from the shallowest non-empty bag, and inside a bag it takes the entry that a HASH of (match seed, attack id, number
// of picks so far) points at, so ties between cells of equal depth are broken by a hash and never by the order in which the
// cells were found or by their position in an array. A pick is O(1): index by hash, swap with the last entry, shrink.
//
// The bags are filled incrementally (territory.ts: whenever a cell changes owner its neighbours are offered to the attacks that
// care) and emptied lazily: an entry is checked when it is picked, and one that no longer qualifies (the cell changed owner,
// or no longer touches the attacker) is dropped. So the bags always hold a superset of the true frontier (a test compares
// them with a brute-force recomputation) and nothing ever scans the map. Every Attack is serialised and hashed with its bags
// as they are (the order inside a bag is part of the state).
import { hash2 } from './fixture';
import { D_MAX_CELLS, FRONT_COMPACT_MIN } from './rules';

// Hot-path functions and constants are bound once at load: reading an import binding costs more under some module loaders
// (the test runner's) than reading a local, and pick() runs for every cell an attack takes.
const hashOf = hash2;
const DEPTH_MAX = D_MAX_CELLS;
const INITIAL_CAPACITY = 16;

/** Index 0 .. count-1 chosen by the top 21 bits of a hash (exact for counts below 2^22: the product stays below 2^43). */
export function pickIndex(hash: number, count: number): number {
  return Math.floor(((hash >>> 11) * count) / 2097152);
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
  /** Frontier size at which the next purge runs. */
  compactAt: number;
  /** How many entries this attack has picked so far (counts the stale ones): the third input of the pick hash. */
  picks = 0;
  /** Entries in all bags. */
  size = 0;
  /** Every bag below this depth is empty (derived). */
  low = 0;
  /** The bag of each depth (null until it is first used) and how many entries of it are in use. */
  readonly bags: Array<Int32Array | null> = [];
  readonly counts = new Int32Array(DEPTH_MAX + 1);
  /** The depth of the entry the last pick returned (not state). */
  lastDepth = 0;
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
    for (let d = 0; d <= DEPTH_MAX; d++) this.bags.push(null);
  }

  /** Adds an entry at a depth (clamped to 0 .. D_MAX_CELLS). */
  push(cell: number, depth: number): void {
    const d = depth > DEPTH_MAX ? DEPTH_MAX : depth < 0 ? 0 : depth;
    let bag = this.bags[d] as Int32Array | null;
    const n = this.counts[d] as number;
    if (bag === null) {
      bag = new Int32Array(INITIAL_CAPACITY);
      this.bags[d] = bag;
    } else if (n === bag.length) {
      const bigger = new Int32Array(n * 2);
      bigger.set(bag);
      bag = bigger;
      this.bags[d] = bigger;
    }
    bag[n] = cell;
    this.counts[d] = n + 1;
    this.size++;
    if (d < this.low) this.low = d;
  }

  /**
   * Takes one entry out of the shallowest non-empty bag, the one the hash of (seed, id, picks) points at, and returns its
   * cell (its depth is in `lastDepth`). -1 when there is nothing. Counts the pick whatever the entry turns out to be.
   */
  pick(seed: number): number {
    if (this.size === 0) return -1;
    const counts = this.counts;
    let d = this.low;
    while ((counts[d] as number) === 0) d++;
    this.low = d;
    const n = counts[d] as number;
    const bag = this.bags[d] as Int32Array;
    const i = n === 1 ? 0 : pickIndex(hashOf(seed, this.id, this.picks), n);
    this.picks = (this.picks + 1) >>> 0;
    const cell = bag[i] as number;
    bag[i] = bag[n - 1] as number;
    counts[d] = n - 1;
    this.size--;
    this.lastDepth = d;
    return cell;
  }

  /** Every entry, shallowest bag first, in bag order (the stale ones included). For tests and serialisation. */
  entries(): number[] {
    const out: number[] = [];
    for (let d = 0; d <= DEPTH_MAX; d++) {
      const bag = this.bags[d];
      for (let i = 0; i < (this.counts[d] as number); i++) out.push((bag as Int32Array)[i] as number);
    }
    return out;
  }

  /** Replaces the bags by the given cells, all at depth 0 (a new attack's frontier). */
  setInitial(cells: readonly number[]): void {
    for (let d = 0; d <= DEPTH_MAX; d++) {
      this.counts[d] = 0;
      this.bags[d] = null;
    }
    this.size = 0;
    this.low = 0;
    if (cells.length === 0) return;
    const bag = new Int32Array(Math.max(INITIAL_CAPACITY, cells.length));
    for (let i = 0; i < cells.length; i++) bag[i] = cells[i] as number;
    this.bags[0] = bag;
    this.counts[0] = cells.length;
    this.size = cells.length;
  }

  /** Puts a bag at a depth (deserialize; call recount() when all bags are in). The depth must be in range. */
  load(depth: number, cells: Int32Array): void {
    this.bags[depth] = cells;
    this.counts[depth] = cells.length;
  }

  /** Recomputes `size` and `low` from the counts. */
  recount(): void {
    let size = 0;
    let low = -1;
    for (let d = 0; d <= DEPTH_MAX; d++) {
      const n = this.counts[d] as number;
      size += n;
      if (n > 0 && low < 0) low = d;
    }
    this.size = size;
    this.low = low < 0 ? 0 : low;
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
