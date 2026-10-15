// TEST ORACLE of M11a (never exported from the sim): the exact line of sight with half-cell steps, the same distance measure and the
// same heights as src/sim/los. A target at `cell` and altitude `targetGm` is visible from `site` when no occluder between them
// (the site and target cells excluded) rises above the straight line from the antenna to the target.
import { antennaGm } from '../../../src/sim/los/mask';
import type { LosTerrain } from '../../../src/sim/los/terrain';

export function exactVisible(t: LosTerrain, site: number, cell: number, targetGm: number): boolean {
  const w = t.width;
  const sx = site % w;
  const sy = (site - sx) / w;
  const tx0 = cell % w;
  let dx = tx0 - sx;
  if (dx > w / 2) dx -= w;
  else if (dx < -w / 2) dx += w;
  const dy = (cell - tx0) / w - sy;
  const n = Math.max(Math.abs(dx), Math.abs(dy));
  if (n === 0) return true;
  const a = antennaGm(t, site);
  const wM = t.cellWidthM[sy] as number;
  const ex = dx * wM;
  const ey = dy * t.cellHeightM;
  const total = Math.sqrt(ex * ex + ey * ey);
  for (let k = 1; k < 2 * n; k++) {
    const f = k / (2 * n);
    const px = Math.round(dx * f);
    const py = Math.round(dy * f);
    if ((px === 0 && py === 0) || (px === dx && py === dy)) continue;
    const y = sy + py;
    if (y < 0 || y >= t.height) return false;
    const x = (((sx + px) % w) + w) % w;
    const fx = dx * f * wM;
    const fy = dy * f * t.cellHeightM;
    const d = Math.sqrt(fx * fx + fy * fy);
    const line = a + ((targetGm - a) * d) / total;
    if ((t.occGm[y * w + x] as number) > line) return false;
  }
  return true;
}

/** The lowest altitude (game metres) at which a target over `cell` is visible from `site` by the exact line (0 when nothing blocks). */
export function exactRequiredGm(t: LosTerrain, site: number, cell: number): number {
  const w = t.width;
  const sx = site % w;
  const sy = (site - sx) / w;
  const tx0 = cell % w;
  let dx = tx0 - sx;
  if (dx > w / 2) dx -= w;
  else if (dx < -w / 2) dx += w;
  const dy = (cell - tx0) / w - sy;
  const n = Math.max(Math.abs(dx), Math.abs(dy));
  if (n === 0) return 0;
  const a = antennaGm(t, site);
  const wM = t.cellWidthM[sy] as number;
  const total = Math.sqrt((dx * wM) ** 2 + (dy * t.cellHeightM) ** 2);
  let need = 0;
  for (let k = 1; k < 2 * n; k++) {
    const f = k / (2 * n);
    const px = Math.round(dx * f);
    const py = Math.round(dy * f);
    if ((px === 0 && py === 0) || (px === dx && py === dy)) continue;
    const y = sy + py;
    if (y < 0 || y >= t.height) return 1e9;
    const x = (((sx + px) % w) + w) % w;
    const d = Math.sqrt((dx * f * wM) ** 2 + (dy * f * t.cellHeightM) ** 2);
    const req = a + (((t.occGm[y * w + x] as number) - a) * total) / d;
    if (req > need) need = req;
  }
  return need;
}
