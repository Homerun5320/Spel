// The placement of the nation labels (M20a-2), pure and without allocation after construction: candidates in screen pixels (centre, size, priority) go in, the ones that are
// shown come out with their boxes moved inside the window, none overlapping another. Greedy by priority (the higher first; a tie by the lower id), at most `maxShown`.
// With at most 64 candidates the overlap test is a plain pass over the boxes placed so far (at most 32): cheaper and simpler than a grid at this size.

export class LabelLayout {
  readonly capacity: number;
  count = 0;
  readonly id: Int32Array;
  /** Centre of the box (input); after `solve` the centre of the placed box of a shown candidate. */
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly w: Float32Array;
  readonly h: Float32Array;
  readonly prio: Float64Array;
  /** 1 = shown after `solve`. */
  readonly shown: Uint8Array;
  /** The candidates in the order of priority after `solve` (indices). */
  readonly order: Int32Array;
  /** The indices of the shown candidates after `solve`, in order of priority, and how many. */
  readonly placed: Int32Array;
  placedCount = 0;
  /** Rectangles no box may touch (the HUD panels): left, top, width, height. */
  readonly blocked = new Float32Array(16 * 4);
  blockedCount = 0;

  constructor(capacity = 64) {
    this.capacity = capacity;
    this.id = new Int32Array(capacity);
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.w = new Float32Array(capacity);
    this.h = new Float32Array(capacity);
    this.prio = new Float64Array(capacity);
    this.shown = new Uint8Array(capacity);
    this.order = new Int32Array(capacity);
    this.placed = new Int32Array(capacity);
  }

  clear(): void {
    this.count = 0;
    this.placedCount = 0;
  }

  /** Adds a blocked rectangle (at most 16); returns false when full. */
  block(left: number, top: number, w: number, h: number): boolean {
    if (this.blockedCount >= 16) return false;
    const k = this.blockedCount++ * 4;
    this.blocked[k] = left;
    this.blocked[k + 1] = top;
    this.blocked[k + 2] = w;
    this.blocked[k + 3] = h;
    return true;
  }

  clearBlocked(): void {
    this.blockedCount = 0;
  }

  /** Adds a candidate; returns false when the table is full. */
  add(id: number, x: number, y: number, w: number, h: number, prio: number): boolean {
    if (this.count >= this.capacity) return false;
    const i = this.count++;
    this.id[i] = id;
    this.x[i] = x;
    this.y[i] = y;
    this.w[i] = w;
    this.h[i] = h;
    this.prio[i] = prio;
    this.shown[i] = 0;
    return true;
  }

  /**
   * Chooses and places. A box wider or taller than the window is never shown. Returns the number shown (also `placedCount`). Boxes keep `gap` pixels from each other and
   * `edge` pixels from the window edge.
   */
  solve(viewW: number, viewH: number, maxShown: number, gap: number, edge: number): number {
    const n = this.count;
    const order = this.order;
    // insertion sort by (prio desc, id asc): n is small
    for (let i = 0; i < n; i++) {
      let j = i;
      const p = this.prio[i] as number;
      const id = this.id[i] as number;
      while (j > 0) {
        const o = order[j - 1] as number;
        const po = this.prio[o] as number;
        if (po > p || (po === p && (this.id[o] as number) < id)) break;
        order[j] = o;
        j--;
      }
      order[j] = i;
    }
    let placed = 0;
    for (let k = 0; k < n; k++) {
      const i = order[k] as number;
      this.shown[i] = 0;
      if (placed >= maxShown) continue;
      const w = this.w[i] as number;
      const h = this.h[i] as number;
      if (w + 2 * edge > viewW || h + 2 * edge > viewH) continue;
      let left = (this.x[i] as number) - w / 2;
      let top = (this.y[i] as number) - h / 2;
      if (left < edge) left = edge;
      else if (left + w > viewW - edge) left = viewW - edge - w;
      if (top < edge) top = edge;
      else if (top + h > viewH - edge) top = viewH - edge - h;
      let free = true;
      for (let q = 0; q < this.blockedCount && free; q++) {
        const k = q * 4;
        const bl = this.blocked[k] as number;
        const bt = this.blocked[k + 1] as number;
        if (left < bl + (this.blocked[k + 2] as number) + gap && bl < left + w + gap && top < bt + (this.blocked[k + 3] as number) + gap && bt < top + h + gap) free = false;
      }
      for (let q = 0; q < placed && free; q++) {
        const j = this.placed[q] as number;
        const jl = (this.x[j] as number) - (this.w[j] as number) / 2;
        const jt = (this.y[j] as number) - (this.h[j] as number) / 2;
        if (left < jl + (this.w[j] as number) + gap && jl < left + w + gap && top < jt + (this.h[j] as number) + gap && jt < top + h + gap) {
          free = false;
          break;
        }
      }
      if (!free) continue;
      this.x[i] = left + w / 2;
      this.y[i] = top + h / 2;
      this.shown[i] = 1;
      this.placed[placed++] = i;
    }
    this.placedCount = placed;
    return placed;
  }
}
