// Work counters of the conquest: how many cells a tick looked at. They are the PRIMARY performance limit of the milestone
// (wall-clock time is only checked through budgetMs): the tests assert that the cells scanned per tick are proportional to
// the length of the fronts plus the cells that changed, and never a scan of the world. Derived and diagnostic: not hashed,
// not serialised, reset at the start of every conquest phase.

export class WorkCounters {
  /** Frontier entries picked (stale ones included). */
  popped = 0;
  /** Frontier entries put into a frontier. */
  pushed = 0;
  /** Cells that changed owner in the conquest phase of this tick (captures). */
  captured = 0;
  /** Boundary cells read to build the frontier of a new attack (once per Attack intent, not per tick). */
  launchScanned = 0;
  /** Entries examined by a purge. */
  purged = 0;
  /** Enclave candidates taken from the bucket of this tick. */
  candidates = 0;
  /** Enclave candidates taken plus the cells visited by their fills (at most ENCLAVE_MAX_CELLS + 1 per candidate). */
  enclaveVisited = 0;
  /** Cells that changed owner in the enclave phase of this tick. */
  enclaveFlipped = 0;
  /** Attacks that were active when the phase began (the "front" side of the proportionality bound is measured by the test). */
  attacks = 0;

  reset(): void {
    this.popped = 0;
    this.pushed = 0;
    this.captured = 0;
    this.launchScanned = 0;
    this.purged = 0;
    this.candidates = 0;
    this.enclaveVisited = 0;
    this.enclaveFlipped = 0;
    this.attacks = 0;
  }

  /** Cells the tick looked at. */
  get scanned(): number {
    return this.popped + this.pushed + this.launchScanned + this.purged + this.enclaveVisited;
  }

  /** Cells the tick changed. */
  get changed(): number {
    return this.captured + this.enclaveFlipped;
  }
}
