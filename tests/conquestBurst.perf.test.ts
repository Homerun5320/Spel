// The worst case of the conquest, in a file of its own so that the process has nothing else on its heap: 100 000 cells change
// owner in ONE tick. Wall-clock time goes through budgetMs (tests/perfguard.ts); the statistic is named in the test.
//
// How the measurement is kept steady (D132): every sample runs on a fresh 1024x512 world that is built OUTSIDE the timing,
// a full garbage collection runs after the build and before the clock starts (so the build's garbage and the external-memory
// pressure of its typed arrays cannot trigger a collection inside the timed kernel), and the median is taken over 21 samples
// after 3 warm-ups (the first two runs of a cold process are slow while the optimiser settles; 21 samples let a burst of interference from other VMs spoil a few of them without moving the median).
// The perf project's one retry (vitest.config.ts) would start at once, inside the same stretch of interference: when the median is over the
// budget the test waits COOL_DOWN_MS before it fails, so that the retry measures another stretch. A kernel that is really too slow fails both.
import v8 from 'node:v8';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { advanceAttack } from '../src/sim/conquest';
import { seatToOwner, type GameState } from '../src/sim/state';
import { makeBurstState } from './helpers/burstWorld';
import { budgetMs, median } from './perfguard';

/** How long a failing measurement waits before it reports, so that the retry does not land in the same burst of interference. */
const COOL_DOWN_MS = 10_000;

/** Blocks the thread (this test is synchronous and nothing else runs in the process). */
function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** A full collection on demand: Node hides `gc` behind a flag, and the flag can be switched on at run time. */
function fullGc(): () => void {
  v8.setFlagsFromString('--expose-gc');
  const gc = vm.runInNewContext('gc') as (() => void) | undefined;
  return typeof gc === 'function' ? gc : () => undefined;
}

describe('conquest burst', () => {
  it('conquering 100 000 cells in ONE tick takes at most budgetMs(50) (statistic: median of 21 runs after 3 warm-ups, each on a fresh 1024x512 world built and garbage-collected outside the timing)', () => {
    const runs = 21;
    const warmups = 3;
    const gc = fullGc();
    const samples: number[] = [];
    let work = '';
    for (let i = 0; i < warmups + runs; i++) {
      const s: GameState = makeBurstState();
      const a = s.attacks.list[0];
      if (a === undefined) throw new Error('no attack');
      s.work.reset();
      gc();
      const t0 = performance.now();
      const taken = advanceAttack(s, a, 0, 100000);
      const dt = performance.now() - t0;
      expect(taken).toBe(100000);
      expect(s.agg.area[seatToOwner(0)]).toBe(100000 + 2 * 512);
      if (i >= warmups) samples.push(dt);
      if (i === warmups) work = `popped ${s.work.popped}, pushed ${s.work.pushed}, captured ${s.work.captured}, frontier left ${a.size}`;
    }
    const m = median(samples);
    const budget = budgetMs(50);
    const sorted = [...samples].sort((x, y) => x - y);
    console.log(
      `[conquest perf] 100 000 cells in one tick: median ${m.toFixed(1)} ms of ${runs} (min ${(sorted[0] as number).toFixed(1)}, max ${(sorted[sorted.length - 1] as number).toFixed(1)}; ` +
        `budget <= ${budget.toFixed(1)} ms = budgetMs(50), median is ${((100 * m) / budget).toFixed(0)} % of it); ${work}`,
    );
    if (m > budget) {
      console.warn(`[conquest perf] median over the budget: waiting ${COOL_DOWN_MS / 1000} s before failing, so that the retry measures another stretch of the machine`);
      pause(COOL_DOWN_MS);
    }
    expect(m).toBeLessThanOrEqual(budget);
  });
});
