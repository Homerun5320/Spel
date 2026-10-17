// CPU budget of the side-fact path (Events-1; perf project): 64 helicopter events in one tick, every helicopter hostile to the viewer (so the mask is recomputed per
// sample), filtered, pushed into the ring and packed for the diff. Statistic: median of 40 samples after 5 warm-ups, at most budgetMs(0.5) (tests/perfguard.ts).
import { describe, expect, it } from 'vitest';
import { HELI_HOVER, cellCentreQ8 } from '../src/sim/heliTable';
import { OUTBOX_HELI_DOWNED } from '../src/sim/outbox';
import { HELI_CAPACITY, HELI_FUEL_MAX_Q8, HELI_HP_TENTHS } from '../src/sim/rules';
import { createState } from '../src/sim/state';
import { STRUCT_FACTORY, STRUCT_SAM } from '../src/sim/structureRules';
import { CLASS_PLAINS } from '../src/sim/terrain';
import { ViewEventFilter } from '../src/host/viewEventFilter';
import { ViewEventRing } from '../src/host/viewEventRing';
import { budgetMs } from './perfguard';

const W = 256;
const H = 96;

describe('side-fact path performance', () => {
  it('64 helicopter events per tick take at most budgetMs(0.5) (median of 40 samples after 5 warm-ups)', () => {
    const s = createState({ width: W, height: H, seed: 9, seats: 4, terrain: new Uint8Array(W * H).fill(CLASS_PLAINS), elevation: new Uint16Array(W * H).fill(5), maxElev: new Int16Array(W * H).fill(5) });
    const factory = s.structures.add(STRUCT_FACTORY, 1, 48 * W + 20, 0);
    s.structures.readyTick[factory] = 0;
    const sam = s.structures.add(STRUCT_SAM, 2, 48 * W + 150, 0);
    s.structures.readyTick[sam] = 0;
    for (let i = 0; i < HELI_CAPACITY; i++) {
      const h = s.helis.addBuilding(1, factory, 0, 0);
      const t = s.helis;
      t.state[h] = HELI_HOVER;
      t.x[h] = cellCentreQ8(100 + (i % 50));
      t.y[h] = cellCentreQ8(40 + (i % 16));
      t.alt[h] = 400;
      t.hp[h] = HELI_HP_TENTHS;
      t.fuel[h] = HELI_FUEL_MAX_Q8;
    }
    const filter = new ViewEventFilter(s, 1);
    const ring = new ViewEventRing();
    let kept = 0;
    const samples: number[] = [];
    for (let i = 0; i < 45; i++) {
      s.tick++;
      const t0 = performance.now();
      filter.beforeStep();
      for (let id = 0; id < HELI_CAPACITY; id++) if (filter.accept(OUTBOX_HELI_DOWNED, id)) ring.push(OUTBOX_HELI_DOWNED, s.tick, id, 1);
      kept += ring.toPacked().length;
      ring.clear();
      const dt = performance.now() - t0;
      if (i >= 5) samples.push(dt);
    }
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)] as number;
    console.log(`view events: median ${median.toFixed(3)} ms for ${HELI_CAPACITY} events (budget ${budgetMs(0.5).toFixed(2)} ms)`);
    expect(kept).toBeGreaterThan(0); // the sensors see some of them
    expect(median).toBeLessThanOrEqual(budgetMs(0.5));
  });
});
