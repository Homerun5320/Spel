// Events-1: the ring and the filter allocate no typed array per event (the hosts run them every tick): 6 000 ticks of filter calls and 400 000 pushes build none; the
// packed copy for a diff is the only allocation and only when the ring is not empty. (Raw heap reads are forbidden in tests, tests/rawHeap.test.ts, so the guard counts constructions.)
import { describe, expect, it } from 'vitest';
import { HELI_HOVER, cellCentreQ8 } from '../../src/sim/heliTable';
import { OUTBOX_HELI_DOWNED } from '../../src/sim/outbox';
import { HELI_CAPACITY, HELI_HP_TENTHS } from '../../src/sim/rules';
import { createState } from '../../src/sim/state';
import { STRUCT_FACTORY } from '../../src/sim/structureRules';
import { CLASS_PLAINS } from '../../src/sim/terrain';
import { VIEW_EVENTS_CAP } from '../../src/sim/view';
import { ViewEventFilter } from '../../src/host/viewEventFilter';
import { ViewEventRing } from '../../src/host/viewEventRing';

describe('the side-fact ring', () => {
  it('keeps order across the wrap, drops the oldest, and an empty ring packs to one shared empty array', () => {
    const r = new ViewEventRing();
    expect(r.toPacked()).toBe(r.toPacked());
    for (let i = 0; i < VIEW_EVENTS_CAP * 2 + 7; i++) r.push(1, i, i, -i);
    expect(r.length).toBe(VIEW_EVENTS_CAP);
    expect(r.dropped).toBe(VIEW_EVENTS_CAP + 7);
    const p = r.toPacked();
    expect(p).toHaveLength(VIEW_EVENTS_CAP * 4);
    for (let i = 0; i < VIEW_EVENTS_CAP; i++) {
      const n = VIEW_EVENTS_CAP + 7 + i;
      expect([p[4 * i], p[4 * i + 1], p[4 * i + 2], p[4 * i + 3]]).toEqual([1, n, n, -n]);
    }
    r.clear();
    expect(r.length).toBe(0);
    expect(r.dropped).toBe(0);
  });

  it('allocates nothing per event', () => {
    const s = createState({ width: 64, height: 32, seed: 1, seats: 3, terrain: new Uint8Array(64 * 32).fill(CLASS_PLAINS), elevation: new Uint16Array(64 * 32), maxElev: new Int16Array(64 * 32).fill(5) });
    const f = s.structures.add(STRUCT_FACTORY, 1, 40, 0);
    s.structures.readyTick[f] = 0;
    for (let i = 0; i < 8; i++) {
      const h = s.helis.addBuilding(1 + (i & 1), f, 0, 0);
      s.helis.state[h] = HELI_HOVER;
      s.helis.x[h] = cellCentreQ8(10);
      s.helis.y[h] = cellCentreQ8(10);
      s.helis.hp[h] = HELI_HP_TENTHS;
    }
    const filter = new ViewEventFilter(s, 0);
    const ring = new ViewEventRing();
    const run = (): void => {
      for (let tick = 0; tick < 6000; tick++) {
        s.tick = tick;
        filter.beforeStep();
        for (let id = 0; id < HELI_CAPACITY; id += 8) if (filter.accept(OUTBOX_HELI_DOWNED, id & 7)) ring.push(OUTBOX_HELI_DOWNED, tick, id, 1);
        for (let k = 0; k < 64; k++) ring.push(2, tick, k, 0);
        if (tick % 4 === 0) ring.clear();
      }
    };
    run(); // warm-up: the visibility rows are built once
    const Real = globalThis.Int32Array;
    let made = 0;
    class Counting extends Real {
      constructor(...args: ConstructorParameters<typeof Int32Array>) {
        made++;
        super(...args);
      }
    }
    globalThis.Int32Array = Counting as typeof Int32Array;
    try {
      run();
      expect(made).toBe(0); // ring pushes, clears and the filter build no array (a slice or subarray counts too)
      ring.push(1, 1, 1, 1);
      ring.toPacked();
      expect(made).toBe(1); // the packed copy for a diff is the one allocation
    } finally {
      globalThis.Int32Array = Real;
    }
  });
});
