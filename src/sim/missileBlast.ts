// The shape of a blast (M14a): a disc on the globe of a radius in km, laid on the equirectangular grid row by row. Radii are stored in km (rules.ts) and turned into cells PER ROW with the
// width of a cell of that row (`cellWidthM`, the cos(lat) row table): a cell (x, y) is in the disc when (dx x cellWidth(y))^2 + (dy x cellHeight)^2 <= r^2, dx the short way round the
// world. Whole-number maths only (isqrt). A polar row whose disc is wider than the world is the whole row once. One function (`blastRows`) answers the question for the sim and for the
// preview, so they cannot disagree. The row table is the integer sine table's (`rowCosFromLut`), the same for a StateView, a ViewMirror and the sim.
import { rowCosFromLut } from './grid';
import { isqrt } from './detmath';
import { EARTH_EQUATOR_M, EARTH_POLE_TO_POLE_M, WEIGHT_ONE } from './rules';

let cachedHeight = -1;
let cachedRows: Uint16Array = new Uint16Array(0);

/** The Q15 cos(lat) of every row of a world `height` rows high (cached for the last height). */
export function blastRowCos(height: number): Uint16Array {
  if (cachedHeight !== height) {
    cachedRows = rowCosFromLut(height);
    cachedHeight = height;
  }
  return cachedRows;
}

/** The width of a cell of `row` in metres (at least 1). */
export function blastCellWidthM(width: number, rowCos: Uint16Array, row: number): number {
  const m = Math.floor((EARTH_EQUATOR_M * (rowCos[row] as number)) / (width * WEIGHT_ONE));
  return m < 1 ? 1 : m;
}

let spans = new Int32Array(0);

/**
 * The rows of the disc of radius `rKm` round (cx, cy): returns how many rows it wrote into `blastSpans()`, three numbers per row: y, half (cells each side of cx; the whole row when
 * 2 x half + 1 >= width), and the row's cell width in metres. Rows are in ascending y.
 */
export function blastRows(width: number, height: number, cx: number, cy: number, rKm: number): number {
  const rowCos = blastRowCos(height);
  if (spans.length < 3 * height) spans = new Int32Array(3 * height);
  const chM = Math.floor(EARTH_POLE_TO_POLE_M / height);
  const r = rKm * 1000;
  const r2 = r * r;
  let n = 0;
  const reach = Math.floor(r / chM);
  const y0 = cy - reach < 0 ? 0 : cy - reach;
  const y1 = cy + reach >= height ? height - 1 : cy + reach;
  for (let y = y0; y <= y1; y++) {
    const dy = (y - cy) * chM;
    const rest = r2 - dy * dy;
    if (rest < 0) continue;
    const cw = blastCellWidthM(width, rowCos, y);
    const half = Math.floor(isqrt(rest) / cw);
    spans[n * 3] = y;
    spans[n * 3 + 1] = 2 * half + 1 >= width ? width : half;
    spans[n * 3 + 2] = cw;
    n++;
  }
  return n;
}

/** The rows `blastRows` wrote (valid until the next call). */
export function blastSpans(): Int32Array {
  return spans;
}

/** Is `cell` inside the disc of radius `rKm` round `center`? The very test `blastRows` encodes. */
export function inBlast(width: number, height: number, center: number, rKm: number, cell: number): boolean {
  const cx = center % width;
  const cy = (center - cx) / width;
  const x = cell % width;
  const y = (cell - x) / width;
  const chM = Math.floor(EARTH_POLE_TO_POLE_M / height);
  const dy = (y - cy) * chM;
  const r = rKm * 1000;
  const rest = r * r - dy * dy;
  if (rest < 0) return false;
  const cw = blastCellWidthM(width, blastRowCos(height), y);
  const half = Math.floor(isqrt(rest) / cw);
  if (2 * half + 1 >= width) return true;
  let dx = x > cx ? x - cx : cx - x;
  if (dx * 2 > width) dx = width - dx;
  return dx <= half;
}

/** Calls `fn(cell)` for every cell of the disc of radius `rKm` round `center`, rows from north to south, x ascending from the west edge of the row's span (wrapping). No allocation but the closure. */
export function forEachInBlast(width: number, height: number, center: number, rKm: number, fn: (cell: number) => void): void {
  const cx = center % width;
  const cy = (center - cx) / width;
  const rows = blastRows(width, height, cx, cy, rKm);
  const sp = spans;
  for (let r = 0; r < rows; r++) {
    const base = (sp[r * 3] as number) * width;
    const half = sp[r * 3 + 1] as number;
    if (half >= width) {
      for (let x = 0; x < width; x++) fn(base + x);
      continue;
    }
    for (let x = cx - half; x <= cx + half; x++) fn(base + (x < 0 ? x + width : x >= width ? x - width : x));
  }
}
