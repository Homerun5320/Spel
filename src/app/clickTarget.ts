// Which sim cell a click on the globe means. The pick gives the cell under the position, but the render raster (10 km) is finer
// than the sim grid (39 km): a click on a coastal land pixel can fall in a sim cell that is water. When the pick says land
// (elevation above 0) and its own cell cannot be owned, the nearest playable cell within one cell is meant instead.
import type { GlobePick } from '../render/describe';
import { isPlayableClass } from '../sim/terrain';
import type { ReadonlyNumbers } from '../sim/view';

export function resolveClickCell(pick: GlobePick, terrain: ReadonlyNumbers, width: number, height: number): number {
  const own = pick.cell.index;
  if (isPlayableClass(terrain[own] as number)) return own;
  if (pick.elevationM <= 0) return own;
  const fx = ((pick.lon + 180) / 360) * width;
  const fy = ((90 - pick.lat) / 180) * height;
  let best = own;
  let bestD = Infinity;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const y = pick.cell.y + dy;
      if (y < 0 || y >= height) continue;
      const x = (pick.cell.x + dx + width) % width;
      const c = y * width + x;
      if (!isPlayableClass(terrain[c] as number)) continue;
      const d = (x + 0.5 - fx) * (x + 0.5 - fx) + (y + 0.5 - fy) * (y + 0.5 - fy);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
  }
  return best;
}
