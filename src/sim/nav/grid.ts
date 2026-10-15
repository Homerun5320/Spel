// The nav grid of the air routes (M11b): the sim world folded into blocks of NAV_BLOCK_CELLS x NAV_BLOCK_CELLS sim cells (256x128 for the
// 1024x512 world), the per-mode service-ceiling blocking, and connected-component labels (land, and air per flight mode) that answer
// "is there any route at all" in O(1). Derived, read-only data: never serialised, never hashed. The buffers of the route search live here
// too, persistent and reused through generation stamps, so a planRoute call allocates only its result.
import { AIR_MODE_AGL_M, NAV_BLOCK_CELLS, SERVICE_CEILING_M } from '../rules';
import type { Los } from '../los/cache';
import { CLASS_PEAK } from '../terrain';

export const NAV_MODES = 2;

export interface NavSource {
  readonly width: number;
  readonly height: number;
  /** Terrain class per sim cell. */
  readonly terrainClass: ArrayLike<number>;
  /** Real mean elevation in metres per sim cell (sea at or below 0). */
  readonly meanElev: ArrayLike<number>;
}

export class Nav {
  readonly width: number;
  readonly height: number;
  readonly simWidth: number;
  readonly simHeight: number;
  readonly los: Los;
  readonly terrainClass: ArrayLike<number>;
  readonly meanElev: ArrayLike<number>;
  /** Real mean height of a nav cell in metres (sea counts 0). */
  readonly meanM: Int32Array;
  /** 1 when one of the nav cell's sim cells is Peak. */
  readonly hasPeak: Uint8Array;
  /** Land sim cells (not DeepSea / Shallows) of the 16. */
  readonly landCount: Uint8Array;
  /** The sim cell with the lowest ground in the nav cell (where exposure is evaluated). */
  readonly lowCell: Int32Array;
  /** 1 = closed to the flight mode (service ceiling or Peak). */
  readonly blocked: Uint8Array[];
  /** Component label per nav cell (-1 = closed) for each flight mode. */
  readonly airLabel: Int32Array[];
  /** Component label of land nav cells (a majority of land sim cells), -1 = not land. */
  readonly landLabel: Int32Array;
  /** Kilometres of a nav cell east-west per nav row and north-south. */
  readonly wKm: Float64Array;
  readonly hKm: number;
  /** Counters the tests read: A* searches run and queries answered by the labels alone. */
  astarRuns = 0;
  labelRejects = 0;
  // --- persistent search buffers ---
  generation = 0;
  readonly gCost: Float64Array;
  readonly gStamp: Uint32Array;
  readonly closedStamp: Uint32Array;
  readonly parent: Int32Array;
  readonly expStamp: Uint32Array;
  readonly expVal: Uint8Array;
  heapKey: Float64Array;
  heapNode: Int32Array;
  readonly owners: number[] = [];

  constructor(src: NavSource, los: Los) {
    const B = NAV_BLOCK_CELLS;
    if (src.width % B !== 0 || src.height % B !== 0) throw new Error('nav: the world size must be a multiple of NAV_BLOCK_CELLS');
    this.simWidth = src.width;
    this.simHeight = src.height;
    this.width = src.width / B;
    this.height = src.height / B;
    this.los = los;
    this.terrainClass = src.terrainClass;
    this.meanElev = src.meanElev;
    const n = this.width * this.height;
    this.meanM = new Int32Array(n);
    this.hasPeak = new Uint8Array(n);
    this.landCount = new Uint8Array(n);
    this.lowCell = new Int32Array(n);
    for (let ny = 0; ny < this.height; ny++) {
      for (let nx = 0; nx < this.width; nx++) {
        let sum = 0;
        let land = 0;
        let peak = 0;
        let low = 0x7fffffff;
        let lowCell = 0;
        for (let dy = 0; dy < B; dy++) {
          for (let dx = 0; dx < B; dx++) {
            const c = (ny * B + dy) * src.width + nx * B + dx;
            const e = Math.max(0, src.meanElev[c] as number);
            const cls = src.terrainClass[c] as number;
            sum += e;
            if (cls > 1) land++;
            if (cls === CLASS_PEAK) peak = 1;
            if (e < low) {
              low = e;
              lowCell = c;
            }
          }
        }
        const i = ny * this.width + nx;
        this.meanM[i] = Math.floor(sum / (B * B));
        this.landCount[i] = land;
        this.hasPeak[i] = peak;
        this.lowCell[i] = lowCell;
      }
    }
    this.blocked = [];
    this.airLabel = [];
    for (let m = 0; m < NAV_MODES; m++) {
      const b = new Uint8Array(n);
      const ceiling = SERVICE_CEILING_M - (AIR_MODE_AGL_M[m] as number);
      for (let i = 0; i < n; i++) b[i] = this.hasPeak[i] === 1 || (this.meanM[i] as number) > ceiling ? 1 : 0;
      this.blocked.push(b);
      this.airLabel.push(this.label(b));
    }
    const landClosed = new Uint8Array(n);
    for (let i = 0; i < n; i++) landClosed[i] = (this.landCount[i] as number) * 2 >= B * B ? 0 : 1;
    this.landLabel = this.label(landClosed);
    const cellWidthM = los.terrain.cellWidthM;
    this.wKm = new Float64Array(this.height);
    for (let ny = 0; ny < this.height; ny++) this.wKm[ny] = (B * (cellWidthM[ny * B + (B >> 1)] as number)) / 1000;
    this.hKm = (B * los.terrain.cellHeightM) / 1000;
    this.gCost = new Float64Array(n);
    this.gStamp = new Uint32Array(n);
    this.closedStamp = new Uint32Array(n);
    this.parent = new Int32Array(n);
    this.expStamp = new Uint32Array(n);
    this.expVal = new Uint8Array(n);
    this.heapKey = new Float64Array(n * 4);
    this.heapNode = new Int32Array(n * 4);
  }

  /** 8-neighbour (wrapX) connected components of the open cells; closed cells get -1. Corner cutting is not allowed, matching the route search. */
  private label(closed: Uint8Array): Int32Array {
    const w = this.width;
    const h = this.height;
    const out = new Int32Array(w * h).fill(-1);
    const stack = new Int32Array(w * h);
    let next = 0;
    for (let s = 0; s < w * h; s++) {
      if (closed[s] === 1 || (out[s] as number) !== -1) continue;
      let sp = 0;
      stack[sp++] = s;
      out[s] = next;
      while (sp > 0) {
        const c = stack[--sp] as number;
        const cx = c % w;
        const cy = (c - cx) / w;
        for (let dy = -1; dy <= 1; dy++) {
          const y = cy + dy;
          if (y < 0 || y >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const x = (cx + dx + w) % w;
            const m = y * w + x;
            if (closed[m] === 1 || (out[m] as number) !== -1) continue;
            if (dx !== 0 && dy !== 0 && (closed[cy * w + x] === 1 || closed[y * w + cx] === 1)) continue;
            out[m] = next;
            stack[sp++] = m;
          }
        }
      }
      next++;
    }
    return out;
  }

  /** The nav cell of a sim cell. */
  navOf(simCell: number): number {
    const sx = simCell % this.simWidth;
    const sy = (simCell - sx) / this.simWidth;
    return Math.floor(sy / NAV_BLOCK_CELLS) * this.width + Math.floor(sx / NAV_BLOCK_CELLS);
  }

  /** The sim cell in the middle of a nav cell. */
  centerOf(nav: number): number {
    const nx = nav % this.width;
    const ny = (nav - nx) / this.width;
    return (ny * NAV_BLOCK_CELLS + (NAV_BLOCK_CELLS >> 1)) * this.simWidth + nx * NAV_BLOCK_CELLS + (NAV_BLOCK_CELLS >> 1);
  }

  /** O(1): are the two sim cells in the same air component of the mode (both cells open)? */
  airReachable(from: number, to: number, mode: number): boolean {
    const l = this.airLabel[mode] as Int32Array;
    const a = l[this.navOf(from)] as number;
    return a >= 0 && a === (l[this.navOf(to)] as number);
  }

  /** O(1): are the two sim cells on the same landmass (nav land components)? */
  landReachable(from: number, to: number): boolean {
    const a = this.landLabel[this.navOf(from)] as number;
    return a >= 0 && a === (this.landLabel[this.navOf(to)] as number);
  }
}

export function createNav(src: NavSource, los: Los): Nav {
  return new Nav(src, los);
}
