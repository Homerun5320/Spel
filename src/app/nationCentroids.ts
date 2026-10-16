// Where a nation's label belongs (M20a-2): one pass over the ownerId array gives every owner its cell count and its centre of gravity. The x axis wraps (the date line), so the
// mean of x is the circular mean (a sine and cosine table per column, built once); y is the plain mean. A nation split in two (an island chain, Alaska) can have its centre
// outside its land: `anchorCell` then falls back to the capital cell when that is the owner's, else to the centre cell. The page runs this at most twice a second and only when the
// owners changed. No sim code is involved; it reads the mirror's owner array.
import type { ReadonlyNumbers } from '../sim/view';

export class NationCentroids {
  /** Cells per ownerId (index 0 = unowned). */
  readonly count: Uint32Array;
  /** The centre of gravity in cell coordinates (x in 0..width, y in 0..height); meaningful where `count` > 0. */
  readonly cx: Float32Array;
  readonly cy: Float32Array;
  private readonly sumCos: Float64Array;
  private readonly sumSin: Float64Array;
  private readonly sumY: Float64Array;
  private readonly cosX: Float32Array;
  private readonly sinX: Float32Array;

  constructor(
    readonly slots: number,
    readonly width: number,
    readonly height: number,
  ) {
    this.count = new Uint32Array(slots);
    this.cx = new Float32Array(slots);
    this.cy = new Float32Array(slots);
    this.sumCos = new Float64Array(slots);
    this.sumSin = new Float64Array(slots);
    this.sumY = new Float64Array(slots);
    this.cosX = new Float32Array(width);
    this.sinX = new Float32Array(width);
    for (let x = 0; x < width; x++) {
      const a = ((x + 0.5) / width) * Math.PI * 2;
      this.cosX[x] = Math.cos(a);
      this.sinX[x] = Math.sin(a);
    }
  }

  /** Recomputes everything from the owner array (ownerIds below `slots`). No allocation. */
  compute(owner: ReadonlyNumbers): void {
    const { count, sumCos, sumSin, sumY, cosX, sinX, width, height, slots } = this;
    count.fill(0);
    sumCos.fill(0);
    sumSin.fill(0);
    sumY.fill(0);
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        const o = owner[row + x] as number;
        if (o === 0 || o >= slots) continue;
        count[o] = (count[o] as number) + 1;
        sumCos[o] = (sumCos[o] as number) + (cosX[x] as number);
        sumSin[o] = (sumSin[o] as number) + (sinX[x] as number);
        sumY[o] = (sumY[o] as number) + y;
      }
    }
    for (let o = 1; o < slots; o++) {
      const n = count[o] as number;
      if (n === 0) continue;
      let a = Math.atan2(sumSin[o] as number, sumCos[o] as number);
      if (a < 0) a += Math.PI * 2;
      this.cx[o] = (a / (Math.PI * 2)) * width;
      this.cy[o] = (sumY[o] as number) / n + 0.5;
    }
  }

  /** The cell the label of `ownerId` hangs on: the centre cell when the owner holds it, else the capital cell when that is the owner's (`capitalCell` -1 = none), else the centre cell. -1 without land. */
  anchorCell(ownerId: number, owner: ReadonlyNumbers, capitalCell: number): number {
    if ((this.count[ownerId] as number) === 0) return -1;
    const x = Math.min(this.width - 1, Math.floor(this.cx[ownerId] as number));
    const y = Math.min(this.height - 1, Math.max(0, Math.floor(this.cy[ownerId] as number)));
    const c = y * this.width + x;
    if (owner[c] === ownerId) return c;
    if (capitalCell >= 0 && owner[capitalCell] === ownerId) return capitalCell;
    return c;
  }
}
