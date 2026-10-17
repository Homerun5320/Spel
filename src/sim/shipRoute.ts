// The sea route of a ship (M13c-1): a deterministic A* search over water cells, then a string-pull into at most SHIP_ROUTE_CAPACITY waypoints.
// Pure and read-only: it reads the terrain class layer and nothing else, allocates nothing per call after the first (module scratch sized by the map), draws no random number.
//
// WATER is terrain class DEEP_SEA or SHALLOWS (the sea and the lakes of the baked world). The grid wraps in x (the date line), not in y. Moves are the eight neighbours in the fixed
// order N, NE, E, SE, S, SW, W, NW; a diagonal move needs both orthogonal cells to be water (no squeezing through a land corner). Costs are integers (10 straight, 14 diagonal). The open set is
// a binary heap (two Int32Arrays side by side) ordered by (f, cell index): a tie in f always goes to the lower cell index, so the result is a pure function of the map. At most SHIP_ROUTE_MAX_CELLS cells are expanded.
// The goal is any water cell within SHIP_LAND_REACH_CELLS (Chebyshev, x wrapping) of the target cell.
import { CLASS_DEEP_SEA, CLASS_SHALLOWS } from './terrain';
import { SHIP_LAND_REACH_CELLS, SHIP_ROUTE_CAPACITY, SHIP_ROUTE_MAX_CELLS } from './rules';

type Numbers = { readonly [index: number]: number };

/** Why a route search ended: SHIP_ROUTE_OK, the target has no water within reach (a bad landing cell), or no route was found / it does not fit. */
export const SHIP_ROUTE_OK = 0;
export const SHIP_ROUTE_BAD_TARGET = 1;
export const SHIP_ROUTE_NONE = 2;

/** The answer of `findShipRoute`: `count` waypoints in `cells`, and the number of cells of the full path before the string-pull. */
export class ShipRoute {
  readonly cells = new Int32Array(SHIP_ROUTE_CAPACITY);
  count = 0;
  pathCells = 0;
  /** The cells the search expanded (what the work limit counts). */
  expanded = 0;
}

export function isWaterClass(cls: number): boolean {
  return cls === CLASS_DEEP_SEA || cls === CLASS_SHALLOWS;
}

/** The water cell next to a Port (the lowest cell index of its four neighbours that is water, x wrapping), or -1 when it has none. */
export function portWaterCell(width: number, height: number, terrain: Numbers, portCell: number): number {
  const x = portCell % width;
  const y = (portCell - x) / width;
  let best = -1;
  const west = y * width + (x === 0 ? width - 1 : x - 1);
  const east = y * width + (x + 1 === width ? 0 : x + 1);
  const north = y > 0 ? portCell - width : -1;
  const south = y + 1 < height ? portCell + width : -1;
  const list = [north, west, east, south]; // ascending cell index
  for (let i = 0; i < 4; i++) {
    const c = list[i] as number;
    if (c >= 0 && isWaterClass(terrain[c] as number)) {
      best = c;
      break;
    }
  }
  return best;
}

/** Does `cell` have a water cell within SHIP_LAND_REACH_CELLS of it (Chebyshev, x wrapping)? */
export function hasWaterWithinReach(width: number, height: number, terrain: Numbers, cell: number): boolean {
  const x = cell % width;
  const y = (cell - x) / width;
  for (let dy = -SHIP_LAND_REACH_CELLS; dy <= SHIP_LAND_REACH_CELLS; dy++) {
    const yy = y + dy;
    if (yy < 0 || yy >= height) continue;
    for (let dx = -SHIP_LAND_REACH_CELLS; dx <= SHIP_LAND_REACH_CELLS; dx++) {
      let xx = x + dx;
      if (xx < 0) xx += width;
      else if (xx >= width) xx -= width;
      if (isWaterClass(terrain[yy * width + xx] as number)) return true;
    }
  }
  return false;
}

// --- scratch (module level, sized by the map; reused, never part of any state) ---
let scratchCells = 0;
let mark: Uint32Array = new Uint32Array(0); // run * 2 = open, run * 2 + 1 = closed
let gCost: Int32Array = new Int32Array(0);
let parent: Int32Array = new Int32Array(0);
let run = 0;
let heapF: Int32Array = new Int32Array(0); // the open set: f cost and cell index side by side, ordered by (f, cell)
let heapC: Int32Array = new Int32Array(0);
let path: Int32Array = new Int32Array(0);

function ensureScratch(cells: number): void {
  if (scratchCells !== cells) {
    scratchCells = cells;
    mark = new Uint32Array(cells);
    gCost = new Int32Array(cells);
    parent = new Int32Array(cells);
    path = new Int32Array(cells);
    run = 0;
  }
  if (heapF.length === 0) {
    heapF = new Int32Array(8 * SHIP_ROUTE_MAX_CELLS + 16);
    heapC = new Int32Array(8 * SHIP_ROUTE_MAX_CELLS + 16);
  }
  run++;
  if (run >= 0x7fffffff) {
    mark.fill(0);
    run = 1;
  }
}

const DX = [0, 1, 1, 1, 0, -1, -1, -1];
const DY = [-1, -1, 0, 1, 1, 1, 0, -1];

/** Octile distance in cost units between two cells (x wrapping). */
function octile(width: number, a: number, b: number): number {
  const ax = a % width;
  const bx = b % width;
  let dx = Math.abs(ax - bx);
  if (dx > width - dx) dx = width - dx;
  const dy = Math.abs((a - ax) / width - (b - bx) / width);
  return dx > dy ? 10 * dx + 4 * dy : 10 * dy + 4 * dx;
}

/** Chebyshev distance between two cells (x wrapping). */
function cheb(width: number, a: number, b: number): number {
  const ax = a % width;
  const bx = b % width;
  let dx = Math.abs(ax - bx);
  if (dx > width - dx) dx = width - dx;
  const dy = Math.abs((a - ax) / width - (b - bx) / width);
  return dx > dy ? dx : dy;
}

/** Is every cell of the straight line between two cells water? (Bresenham over the shortest way round the date line.) */
function lineClear(width: number, terrain: Numbers, a: number, b: number): boolean {
  const ax = a % width;
  const ay = (a - ax) / width;
  const bx0 = b % width;
  const by = (b - bx0) / width;
  let dxs = bx0 - ax;
  if (dxs > width >> 1) dxs -= width;
  else if (dxs < -(width >> 1)) dxs += width;
  const sx = dxs < 0 ? -1 : 1;
  const sy = by < ay ? -1 : 1;
  const adx = Math.abs(dxs);
  const ady = Math.abs(by - ay);
  let err = adx - ady;
  let x = ax;
  let y = ay;
  const n = adx > ady ? adx : ady;
  for (let k = 0; k <= n; k++) {
    let xx = x % width;
    if (xx < 0) xx += width;
    if (!isWaterClass(terrain[y * width + xx] as number)) return false;
    if (k === n) break;
    const e2 = 2 * err;
    if (e2 > -ady) {
      err -= ady;
      x += sx;
    }
    if (e2 < adx) {
      err += adx;
      y += sy;
    }
  }
  return true;
}

/** Is entry (f1, c1) before (f2, c2)? Lower f first; a tie goes to the lower cell index. */
function before(f1: number, c1: number, f2: number, c2: number): boolean {
  return f1 < f2 || (f1 === f2 && c1 < c2);
}

function heapPush(n: number, f: number, c: number): void {
  let i = n;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (!before(f, c, heapF[p] as number, heapC[p] as number)) break;
    heapF[i] = heapF[p] as number;
    heapC[i] = heapC[p] as number;
    i = p;
  }
  heapF[i] = f;
  heapC[i] = c;
}

/** Removes the first entry of a heap of `n` entries; the entry is left in `poppedC`. */
let poppedC = 0;
function heapPop(n: number): void {
  poppedC = heapC[0] as number;
  const m = n - 1;
  const lf = heapF[m] as number;
  const lc = heapC[m] as number;
  let i = 0;
  while (true) {
    let c = 2 * i + 1;
    if (c >= m) break;
    if (c + 1 < m && before(heapF[c + 1] as number, heapC[c + 1] as number, heapF[c] as number, heapC[c] as number)) c++;
    if (!before(heapF[c] as number, heapC[c] as number, lf, lc)) break;
    heapF[i] = heapF[c] as number;
    heapC[i] = heapC[c] as number;
    i = c;
  }
  if (m > 0) {
    heapF[i] = lf;
    heapC[i] = lc;
  }
}

/**
 * Finds the sea route from water cell `start` to a water cell within reach of `target`. Returns SHIP_ROUTE_OK and fills `out` (waypoint 0 is `start`, the last one is the cell the ship stops at),
 * SHIP_ROUTE_BAD_TARGET when the target has no water within SHIP_LAND_REACH_CELLS, or SHIP_ROUTE_NONE when no route fits (no way within SHIP_ROUTE_MAX_CELLS expansions, or more than
 * SHIP_ROUTE_CAPACITY waypoints after the string-pull).
 */
export function findShipRoute(width: number, height: number, terrain: Numbers, start: number, target: number, out: ShipRoute): number {
  out.count = 0;
  out.pathCells = 0;
  out.expanded = 0;
  if (!hasWaterWithinReach(width, height, terrain, target)) return SHIP_ROUTE_BAD_TARGET;
  if (start < 0 || !isWaterClass(terrain[start] as number)) return SHIP_ROUTE_NONE;
  const cells = width * height;
  ensureScratch(cells);
  const open = run * 2;
  const closed = open + 1;
  const slack = 14 * SHIP_LAND_REACH_CELLS;
  let heapN = 0;
  mark[start] = open;
  gCost[start] = 0;
  parent[start] = -1;
  const h0 = Math.max(0, octile(width, start, target) - slack);
  heapPush(heapN++, h0, start);
  let goal = -1;
  let expanded = 0;
  while (heapN > 0) {
    heapPop(heapN--);
    const c = poppedC;
    if (mark[c] === closed) continue;
    mark[c] = closed;
    if (cheb(width, c, target) <= SHIP_LAND_REACH_CELLS) {
      goal = c;
      break;
    }
    if (++expanded > SHIP_ROUTE_MAX_CELLS) break;
    const cx = c % width;
    const cy = (c - cx) / width;
    const g = gCost[c] as number;
    for (let d = 0; d < 8; d++) {
      const ny = cy + (DY[d] as number);
      if (ny < 0 || ny >= height) continue;
      let nx = cx + (DX[d] as number);
      if (nx < 0) nx += width;
      else if (nx >= width) nx -= width;
      const n = ny * width + nx;
      if (mark[n] === closed || !isWaterClass(terrain[n] as number)) continue;
      let step = 10;
      if ((d & 1) === 1) {
        // A diagonal needs both orthogonal cells to be water.
        const ox = nx;
        const oy = cy;
        const px = cx;
        const py = ny;
        if (!isWaterClass(terrain[oy * width + ox] as number) || !isWaterClass(terrain[py * width + px] as number)) continue;
        step = 14;
      }
      const ng = g + step;
      if (mark[n] === open && (gCost[n] as number) <= ng) continue;
      mark[n] = open;
      gCost[n] = ng;
      parent[n] = c;
      const f = ng + Math.max(0, octile(width, n, target) - slack);
      heapPush(heapN++, f, n);
    }
  }
  out.expanded = expanded;
  if (goal < 0) return SHIP_ROUTE_NONE;
  // The full path, start first.
  let len = 0;
  for (let c = goal; c >= 0; c = parent[c] as number) path[len++] = c;
  for (let i = 0, j = len - 1; i < j; i++, j--) {
    const t = path[i] as number;
    path[i] = path[j] as number;
    path[j] = t;
  }
  out.pathCells = len;
  // String-pull: from the anchor, run on while the straight line stays on water; the last cell that was still in line becomes a waypoint.
  let count = 0;
  out.cells[count++] = path[0] as number;
  let anchor = 0;
  while (anchor < len - 1) {
    let j = anchor + 1;
    while (j + 1 < len && lineClear(width, terrain, path[anchor] as number, path[j + 1] as number)) j++;
    if (count >= SHIP_ROUTE_CAPACITY) return SHIP_ROUTE_NONE;
    out.cells[count++] = path[j] as number;
    anchor = j;
  }
  out.count = count;
  return SHIP_ROUTE_OK;
}
