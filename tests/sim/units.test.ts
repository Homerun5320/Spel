import { describe, expect, it } from 'vitest';
import { qtToTroops, stdToSimArea, stdToSimCellRate, stdToSimDistance, stdToSimSpeed, troopsToQt } from '../../src/sim/units';

describe('units: the std-cell converter', () => {
  it('round trips and scales', () => {
    for (const x of [0, 1, 7, 197, 4096]) {
      expect(stdToSimDistance(x)).toBe(2 * x);
      expect(stdToSimArea(x)).toBe(4 * x);
      expect(stdToSimSpeed(x)).toBe(2 * x);
      expect(stdToSimCellRate(x)).toBe(4 * x);
      expect(qtToTroops(troopsToQt(x))).toBe(x);
    }
  });
  it('an area is the square of a distance: (2 d)^2 = 4 d^2', () => {
    for (const d of [1, 3, 8, 40]) expect(stdToSimDistance(d) ** 2).toBe(stdToSimArea(d * d));
  });
});
