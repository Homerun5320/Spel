// A min / max pyramid over the u8 height codes: the lowest and the highest code under any rectangle of the equirectangular raster
// in a handful of reads. The chunk quadtree needs the height range of a chunk for its bounding sphere (culling, split distance);
// without it a chunk would have to assume everything between the sea and the highest mountain on Earth (106 km at x12) and a
// 76 m chunk would be a 50 km sphere. Pure (no three, no DOM). Built once per world; the build reads each level-0 byte once.

export class HeightPyramid {
  readonly width: number;
  readonly height: number;
  /** levels[0] is the raster itself (not copied); levels[k] is (width >> k) x (height >> k), each texel the max of its 2x2 parents. */
  private readonly levels: Uint8Array[];
  private readonly minLevels: Uint8Array[];
  private readonly widths: number[];
  private readonly heights: number[];
  /** Result of the last `range` call. */
  minCode = 0;
  maxCode = 0;

  constructor(codes: Uint8Array, width: number, height: number, minSide = 16) {
    if (codes.length !== width * height) throw new Error(`pyramid: ${codes.length} codes for ${width}x${height}`);
    this.width = width;
    this.height = height;
    this.levels = [codes];
    this.minLevels = [codes];
    this.widths = [width];
    this.heights = [height];
    let w = width;
    let h = height;
    let prev = codes;
    let prevMin = codes;
    while (w > minSide && h > minSide && w % 2 === 0 && h % 2 === 0) {
      const nw = w >> 1;
      const nh = h >> 1;
      const next = new Uint8Array(nw * nh);
      const nextMin = new Uint8Array(nw * nh);
      for (let y = 0; y < nh; y++) {
        const r0 = 2 * y * w;
        const r1 = r0 + w;
        for (let x = 0; x < nw; x++) {
          const a = prev[r0 + 2 * x] as number;
          const b = prev[r0 + 2 * x + 1] as number;
          const c = prev[r1 + 2 * x] as number;
          const d = prev[r1 + 2 * x + 1] as number;
          const m1 = a > b ? a : b;
          const m2 = c > d ? c : d;
          next[y * nw + x] = m1 > m2 ? m1 : m2;
          const la = prevMin[r0 + 2 * x] as number;
          const lb = prevMin[r0 + 2 * x + 1] as number;
          const lc = prevMin[r1 + 2 * x] as number;
          const ld = prevMin[r1 + 2 * x + 1] as number;
          const n1 = la < lb ? la : lb;
          const n2 = lc < ld ? lc : ld;
          nextMin[y * nw + x] = n1 < n2 ? n1 : n2;
        }
      }
      this.levels.push(next);
      this.minLevels.push(nextMin);
      this.widths.push(nw);
      this.heights.push(nh);
      prev = next;
      prevMin = nextMin;
      w = nw;
      h = nh;
    }
  }

  /** Code at a texel (longitude wraps, latitude clamps). */
  private code(x: number, y: number): number {
    const W = this.width;
    const wx = ((x % W) + W) % W;
    const wy = y < 0 ? 0 : y >= this.height ? this.height - 1 : y;
    return (this.levels[0] as Uint8Array)[wy * W + wx] as number;
  }

  get levelCount(): number {
    return this.levels.length;
  }

  /**
   * The lowest and the highest code any bilinear sample inside the rectangle u in [u0, u1], v in [v0, v1] can see (u = longitude
   * fraction from -180, v = fraction from the north pole), left in `minCode` and `maxCode`. The four texels of a bilinear tap around
   * every point are included, so the range bounds the filtered height too. Longitude wraps, latitude clamps. Allocation-free.
   */
  range(u0: number, u1: number, v0: number, v1: number): void {
    const W = this.width;
    const H = this.height;
    const xLo = Math.floor(u0 * W - 0.5);
    const xHi = Math.floor(u1 * W - 0.5) + 1;
    const yLo = Math.floor(v0 * H - 0.5);
    const yHi = Math.floor(v1 * H - 0.5) + 1;
    if (xHi - xLo === 1 && yHi - yLo === 1) {
      // The rectangle lies inside ONE bilinear cell of the raster (every chunk finer than a texel): the filtered code is bilinear
      // there, so its extremes are at the four corners of the rectangle, and the range is far tighter than the four taps' range.
      const c00 = this.code(xLo, yLo);
      const c10 = this.code(xHi, yLo);
      const c01 = this.code(xLo, yHi);
      const c11 = this.code(xHi, yHi);
      let mn = 255;
      let mx = 0;
      for (let k = 0; k < 4; k++) {
        const fx = (k & 1 ? u1 : u0) * W - 0.5 - xLo;
        const fy = (k & 2 ? v1 : v0) * H - 0.5 - yLo;
        const c = c00 * (1 - fx) * (1 - fy) + c10 * fx * (1 - fy) + c01 * (1 - fx) * fy + c11 * fx * fy;
        if (c < mn) mn = c;
        if (c > mx) mx = c;
      }
      // Rounded outward to whole codes so the bound stays a bound (the texture holds integers, the filter does not).
      this.minCode = Math.max(0, Math.floor(mn));
      this.maxCode = Math.min(255, Math.ceil(mx));
      return;
    }
    const span = Math.max(xHi - xLo, yHi - yLo) + 1;
    // The finest level at which the rectangle covers at most 3 texels per axis (the coarsest level when none does).
    let k = 0;
    while (k + 1 < this.levels.length && Math.ceil(span / (1 << k)) + 1 > 3) k++;
    const lw = this.widths[k] as number;
    const lh = this.heights[k] as number;
    const hi = this.levels[k] as Uint8Array;
    const lo = this.minLevels[k] as Uint8Array;
    const x0 = xLo >> k;
    const x1 = xHi >> k;
    let y0 = yLo >> k;
    let y1 = yHi >> k;
    if (y0 < 0) y0 = 0;
    if (y1 > lh - 1) y1 = lh - 1;
    if (y1 < y0) y1 = y0;
    let mx = 0;
    let mn = 255;
    for (let y = y0; y <= y1; y++) {
      const row = y * lw;
      for (let x = x0; x <= x1; x++) {
        const i = row + (((x % lw) + lw) % lw);
        const c = hi[i] as number;
        if (c > mx) mx = c;
        const d = lo[i] as number;
        if (d < mn) mn = d;
      }
    }
    this.minCode = mn;
    this.maxCode = mx;
  }
}
