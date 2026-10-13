// The grid of the world: cell addressing with x-wrap, 4-neighbours, cos(lat) cell weights from the committed Q15 row
// table, cell sizes in kilometres, and which cells are playable. Read-only derived data: built from the terrain classes
// and the row table (both are state arrays), never serialised, never hashed.
//
// A cell index is y * width + x. Row 0 is north. x wraps around (the world is a cylinder), y does not (the poles are
// Ice rows, and nothing crosses them).
import { ANGLE_QUARTER, cosQ15, floorDiv } from './detmath';
import { EARTH_EQUATOR_M, EARTH_POLE_TO_POLE_M, WEIGHT_ONE } from './rules';
import { isPlayableClass } from './terrain';

/** Neighbour directions in the fixed order the code visits them: north, east, south, west. */
export const DIR_N = 0;
export const DIR_E = 1;
export const DIR_S = 2;
export const DIR_W = 3;

/**
 * The cos(latitude) weight of every row in Q15, computed from the integer sine table, for worlds that have no committed
 * row table (the fixture worlds of the tests). The real 1024x512 world uses the committed table of meta.json instead;
 * the two agree within 2 Q15 units (a test pins that).
 */
export function rowCosFromLut(height: number): Uint16Array {
  const rows = new Uint16Array(height);
  for (let y = 0; y < height; y++) {
    // Latitude of the row centre is (height - 2y - 1) / (4 height) of a turn, which is (height - 2y - 1) * ANGLE_QUARTER / height angle units.
    const angle = floorDiv((height - 2 * y - 1) * ANGLE_QUARTER, height);
    rows[y] = cosQ15(angle);
  }
  return rows;
}

export class Grid {
  readonly width: number;
  readonly height: number;
  readonly cells: number;
  /** Q15 cos(lat) of each row (shared with the state, not copied). */
  readonly rowCos: Uint16Array;
  /** 1 where the terrain class can be owned (Plains, Forest, Hills, Mountain), else 0. */
  readonly playable: Uint8Array;
  /** Sum of the cell weights of all playable cells (the denominator of a land share). Below 2^32, checked by the constructor. */
  readonly totalWeight: number;
  /** Number of playable cells. */
  readonly playableCells: number;

  /** Throws RangeError when the weights of all playable cells would overflow the 32-bit per-owner sums. */
  constructor(width: number, height: number, terrain: Uint8Array, rowCos: Uint16Array) {
    this.width = width;
    this.height = height;
    this.cells = width * height;
    this.rowCos = rowCos;
    this.playable = new Uint8Array(this.cells);
    let total = 0;
    let count = 0;
    for (let y = 0; y < height; y++) {
      const w = rowCos[y] as number;
      const base = y * width;
      for (let x = 0; x < width; x++) {
        if (isPlayableClass(terrain[base + x] as number)) {
          this.playable[base + x] = 1;
          total += w;
          count++;
        }
      }
    }
    if (total > 4294967295) throw new RangeError('the playable cells weigh more than 2^32 in Q15');
    this.totalWeight = total;
    this.playableCells = count;
  }

  cellX(cell: number): number {
    return cell % this.width;
  }

  cellY(cell: number): number {
    return Math.floor(cell / this.width);
  }

  /** The cell at (x, y) with x wrapped into [0, width); y must be in [0, height). */
  cellAt(x: number, y: number): number {
    const wx = x % this.width;
    return y * this.width + (wx < 0 ? wx + this.width : wx);
  }

  /** Q15 weight (cos of the latitude) of a cell. */
  weight(cell: number): number {
    return this.rowCos[Math.floor(cell / this.width)] as number;
  }

  /**
   * Writes the 4-neighbours of a cell into `out` in the order north, east, south, west, skipping the ones off the map
   * (north of row 0, south of the last row); x wraps. Returns how many were written (2 to 4). On a world only 1 or 2 cells
   * wide east and west can name the same cell or the cell itself; callers that mark visited cells do not care.
   */
  neighbours(cell: number, out: Int32Array): number {
    const w = this.width;
    const x = cell % w;
    const y = (cell - x) / w;
    let n = 0;
    if (y > 0) out[n++] = cell - w;
    out[n++] = x + 1 === w ? cell - x : cell + 1;
    if (y + 1 < this.height) out[n++] = cell + w;
    out[n++] = x === 0 ? cell + w - 1 : cell - 1;
    return n;
  }

  /** The neighbour of a cell in one direction (DIR_*), or -1 off the map. */
  neighbour(cell: number, dir: number): number {
    const w = this.width;
    const x = cell % w;
    const y = (cell - x) / w;
    switch (dir) {
      case DIR_N:
        return y > 0 ? cell - w : -1;
      case DIR_E:
        return x + 1 === w ? cell - x : cell + 1;
      case DIR_S:
        return y + 1 < this.height ? cell + w : -1;
      default:
        return x === 0 ? cell + w - 1 : cell - 1;
    }
  }

  /** Squared distance in cells between two cells, the east-west difference taken the short way round the world. */
  distance2(a: number, b: number): number {
    const w = this.width;
    const ax = a % w;
    const bx = b % w;
    let dx = ax > bx ? ax - bx : bx - ax;
    if (dx * 2 > w) dx = w - dx;
    const dy = Math.floor(a / w) - Math.floor(b / w);
    return dx * dx + dy * dy;
  }

  /** East-west extent of a cell of this row in metres: the equator width times cos(lat). */
  cellWidthM(row: number): number {
    return Math.floor((EARTH_EQUATOR_M * (this.rowCos[row] as number)) / (this.width * WEIGHT_ONE));
  }

  /** North-south extent of a cell in metres (the same in every row). */
  cellHeightM(): number {
    return Math.floor(EARTH_POLE_TO_POLE_M / this.height);
  }

  /** The east-west extent of a cell of this row in kilometres (for display and tests; the rules use the Q15 weights, not this). */
  cellKm(row: number): number {
    return this.cellWidthM(row) / 1000;
  }
}
