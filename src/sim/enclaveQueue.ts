// The enclave candidates: cells next to a cell that just changed owner. A candidate may be part of a region that the change
// has just closed in (an enclave); the check runs once per ENCLAVE_FLIP_TICKS ticks. Candidates are spread over that many
// buckets by a hash of the cell ("förskjuten med hash(id)"), the bucket `tick % 20` is checked in the enclave phase of a
// tick, so every candidate is looked at within 20 ticks of being queued and the work of a tick is its bucket, never a scan.
// The buckets are game state (they decide when a flip happens) and are serialised and hashed; `queued` is derived.
import { hash2 } from './fixture';
import { ENCLAVE_FLIP_TICKS, ENCLAVE_MAX_CELLS, ENCLAVE_PASS_BUDGET_CELLS } from './rules';

/** Salt of the bucket hash. */
const ENCLAVE_SALT = 0x3c91;
// Bound once at load, see src/sim/attacks.ts.
const hashOf = hash2;
const BUCKETS = ENCLAVE_FLIP_TICKS;
/** Capacity of a bucket on first use: a big conquest queues tens of thousands of cells, and every growth is a typed-array allocation. */
const BUCKET_START = 512;

/** The bucket (0..ENCLAVE_FLIP_TICKS-1) in which a cell is checked. */
export function enclaveBucket(seed: number, cell: number): number {
  // the top 16 bits of the hash scaled to 0..ENCLAVE_FLIP_TICKS-1 (a multiply and a shift, no division)
  return ((hashOf(seed, cell, ENCLAVE_SALT) >>> 16) * BUCKETS) >>> 16;
}

export class EnclaveQueues {
  readonly buckets: Int32Array[] = [];
  readonly counts: Int32Array = new Int32Array(ENCLAVE_FLIP_TICKS);
  /** Derived: 1 for every cell that sits in some bucket (a cell is queued at most once). */
  readonly queued: Uint8Array;
  // Scratch of the enclave phase (not state).
  readonly fill = new Int32Array(ENCLAVE_MAX_CELLS + 4);
  readonly touched = new Int32Array(ENCLAVE_PASS_BUDGET_CELLS + ENCLAVE_MAX_CELLS + 8);
  batch = new Int32Array(64);
  touchedCount = 0;

  constructor(cells: number) {
    for (let i = 0; i < ENCLAVE_FLIP_TICKS; i++) this.buckets.push(new Int32Array(0));
    this.queued = new Uint8Array(cells);
  }

  /** Queues a cell unless it is queued already. */
  push(cell: number, seed: number): void {
    if (this.queued[cell] === 1) return;
    this.queued[cell] = 1;
    const b = enclaveBucket(seed, cell);
    let list = this.buckets[b] as Int32Array;
    const n = this.counts[b] as number;
    if (n === list.length) {
      const bigger = new Int32Array(n === 0 ? BUCKET_START : n * 2);
      bigger.set(list);
      this.buckets[b] = bigger;
      list = bigger;
    }
    list[n] = cell;
    this.counts[b] = n + 1;
  }

  /** Total candidates waiting. */
  get length(): number {
    let n = 0;
    for (let i = 0; i < this.counts.length; i++) n += this.counts[i] as number;
    return n;
  }

  /** Rebuilds `queued` from the buckets (after deserialize). */
  reindex(): void {
    this.queued.fill(0);
    for (let b = 0; b < ENCLAVE_FLIP_TICKS; b++) {
      const list = this.buckets[b] as Int32Array;
      for (let i = 0; i < (this.counts[b] as number); i++) this.queued[list[i] as number] = 1;
    }
  }
}
