// M11a measurement rounds (logged, not asserted beyond "ran"): the stop rule of the prompt allows at most four rounds over the exaggeration
// (6 to 10) and the occluder weight (20 to 60 percent); the last two rows (weights 70 and 80) are OUTSIDE the allowed range and only inform
// option B of the stop rule. Numbers go to docs/DECISIONS.md "M11a" and docs/PROGRESS.md "Measurements M11a".
import { beforeAll, describe, expect, it } from 'vitest';
import { cellAtLatLon, loadRealLos, type RealLos } from '../../tools/sim/losWorld';
import { accuracy, shareOf } from './helpers/losMeasure';

let real: RealLos;
beforeAll(async () => {
  real = await loadRealLos();
});

const SITES = [['alps', 46.5, 9.5], ['himalaya', 27.7, 85.3], ['kansas', 38.5, -98], ['iowa', 42, -93], ['ukraine', 49, 32], ['pampas', -34, -62], ['australia', -30, 145]] as const;

describe('M11a rounds', () => {
  for (const [exag, weight] of [[8, 60], [10, 60], [6, 60], [7, 50], [8, 70], [8, 80]] as const) {
    it(`EXAG ${exag}, weight ${weight} %`, () => {
      const t = real.withParams(exag, weight);
      const low = SITES.map(([, lat, lon]) => shareOf(t, real.terrainClass, cellAtLatLon(lat, lon), 0));
      const acc = SITES.map(([, lat, lon]) => accuracy(t, cellAtLatLon(lat, lon)));
      const plains = low.slice(2).sort((a, b) => a - b);
      const median = plains[2] as number;
      const alps = low[0] as number;
      console.log(
        `[los round] EXAG ${exag} weight ${weight}: alps ${alps.toFixed(1)} himalaya ${(low[1] as number).toFixed(1)} plains median ${median.toFixed(1)} (min ${(plains[0] as number).toFixed(1)}), ` +
          `plains >= 2x alps and >= 15: ${median >= 2 * alps && median >= 15}, himalaya <= 20: ${(low[1] as number) <= 20}, ` +
          `mask-hidden-but-line-visible per site ${acc.map((a) => a.falseHidden).join('/')}, min agreement ${Math.min(...acc.map((a) => (100 * a.agree) / a.n)).toFixed(1)} %`,
      );
      expect(low.every((v) => v >= 0 && v <= 100)).toBe(true);
    });
  }
});
