// Fix-6B [2.5]: a resting Port panel allocates nothing. `shipPanelInfo` runs the sim's launch check, which makes a plan and its route buffer (an Int32Array) per call; the
// cache hands out the answer of one tick instead. The count of Int32Array constructions is the probe (the same sim check, the same fixture as shipPanel.test.ts).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShipPanelInfoCache, shipPanelInfo } from '../../src/ui/shipInfo';
import { StateView } from '../../src/sim/view';
import { shipFixture } from '../../tools/sim/shipLanding';

let made = 0;
const RealInt32 = Int32Array;
function countInt32(): void {
  made = 0;
  class Counting extends RealInt32 {
    constructor(...args: ConstructorParameters<typeof Int32Array>) {
      super(...(args as [never]));
      made++;
    }
  }
  vi.stubGlobal('Int32Array', Counting);
}
afterEach(() => vi.unstubAllGlobals());

describe('ShipPanelInfoCache', () => {
  it('60 frames of one tick make the info once; a new tick, port or seat makes it again; the answer equals the uncached one', () => {
    const fx = shipFixture(0, { island: false });
    const view = new StateView(fx.state);
    const cache = new ShipPanelInfoCache();
    countInt32();
    const first = cache.get(view, 0, fx.port);
    const afterFirst = made;
    expect(afterFirst, 'the sim check allocates (the probe is live)').toBeGreaterThan(0);
    for (let f = 0; f < 60; f++) expect(cache.get(view, 0, fx.port)).toBe(first);
    expect(made, 'a resting panel allocates nothing').toBe(afterFirst);
    expect(first).toEqual(shipPanelInfo(view, 0, fx.port));
    // the info of another seat is not the cached one
    expect(cache.get(view, 1, fx.port)).not.toBe(first);
    expect(made).toBeGreaterThan(afterFirst);
    // a new tick recomputes
    cache.get(view, 0, fx.port);
    const before = made;
    fx.state.tick += 1;
    cache.get(view, 0, fx.port);
    expect(made).toBeGreaterThan(before);
  });
});
