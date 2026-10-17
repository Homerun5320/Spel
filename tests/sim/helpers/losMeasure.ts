// Measurement helpers of M11a (tests only): the mask against the exact line, and the visible share of the land within R of a site.
import { createLos } from '../../../src/sim/los/cache';
import { MASK_NONE, buildMask, maskSide } from '../../../src/sim/los/mask';
import type { LosTerrain } from '../../../src/sim/los/terrain';
import { ALT_LOW_AGL_M } from '../../../src/sim/rules';
import { createEmptyState } from '../../../src/sim/state';
import { exactVisible } from './losOracle';

export interface Accuracy {
  n: number;
  agree: number;
  /** Cells the mask hides (Low) that the exact line sees: the one-sided error that must be zero. */
  falseHidden: number;
  exactHidden: number;
  maskHidesOfExactHidden: number;
}

export function accuracy(t: LosTerrain, site: number, R = 24): Accuracy {
  const side = maskSide(R);
  const m = buildMask(t, site, R);
  const sx = site % t.width;
  const sy = (site - sx) / t.width;
  const a: Accuracy = { n: 0, agree: 0, falseHidden: 0, exactHidden: 0, maskHidesOfExactHidden: 0 };
  for (let py = -R; py <= R; py++)
    for (let px = -R; px <= R; px++) {
      if (px * px + py * py > R * R || sy + py < 0 || sy + py >= t.height) continue;
      const c = (sy + py) * t.width + ((((sx + px) % t.width) + t.width) % t.width);
      const alt = (t.groundGm[c] as number) + ALT_LOW_AGL_M;
      const mv = m[(py + R) * side + px + R] as number;
      const maskVisible = mv !== MASK_NONE && alt >= mv * 2;
      const exact = exactVisible(t, site, c, alt);
      a.n++;
      if (maskVisible === exact) a.agree++;
      if (!maskVisible && exact) a.falseHidden++;
      if (!exact) {
        a.exactHidden++;
        if (!maskVisible) a.maskHidesOfExactHidden++;
      }
    }
  return a;
}

/** The share (percent) of the LAND cells within R of the site that a Low (0) or High (1) aircraft is visible over. */
export function shareOf(t: LosTerrain, terrainClass: ArrayLike<number>, site: number, mode: 0 | 1, R = 24): number {
  const los = createLos(t);
  los.addSite(1, site, R);
  los.sync({ tick: 0, structures: createEmptyState(t.width, t.height, 1, 2).structures, terrainClass });
  const sx = site % t.width;
  const sy = (site - sx) / t.width;
  let land = 0;
  let seen = 0;
  for (let py = -R; py <= R; py++)
    for (let px = -R; px <= R; px++) {
      if (px * px + py * py > R * R || sy + py < 0 || sy + py >= t.height) continue;
      const c = (sy + py) * t.width + ((((sx + px) % t.width) + t.width) % t.width);
      if ((t.groundGm[c] as number) <= 0) continue;
      land++;
      if (los.detected(1, c, mode)) seen++;
    }
  return (100 * seen) / land;
}
