// The work counters are the PRIMARY performance limit of the conquest: the cells a tick looks at are proportional to the fronts it
// works on and the cells that change, never a scan of the map. (Wall-clock budgets are in tests/*.perf.test.ts.)
import { describe, expect, it } from 'vitest';
import { advanceAttack } from '../../src/sim/conquest';
import { ENCLAVE_MAX_CELLS, ENCLAVE_PASS_BUDGET_CELLS } from '../../src/sim/rules';
import { step } from '../../src/sim/step';
import type { GameState } from '../../src/sim/state';
import { makeBurstState } from '../helpers/burstWorld';
import { startRealMatch } from '../helpers/realMatch';
import { landState } from './helpers/worlds';

/** The counters after taking `n` cells in one go on a burst world (the attack was launched by makeBurstState). */
function takeOnBurst(width: number, height: number, n: number): { launch: number; scanned: number; popped: number; pushed: number; captured: number; cells: number } {
  const s = makeBurstState({ width, height });
  const launch = s.work.launchScanned;
  const a = s.attacks.list[0];
  if (a === undefined) throw new Error('no attack');
  s.work.reset();
  expect(advanceAttack(s, a, 0, n)).toBe(n);
  return { launch, scanned: s.work.scanned, popped: s.work.popped, pushed: s.work.pushed, captured: s.work.captured, cells: width * height };
}

describe('work counters: scanned cells are proportional to fronts and changes', () => {
  it('launching an attack reads the border of the attacker (2 x the height of its strip), not the map', () => {
    for (const [w, h] of [[256, 64], [256, 256], [1024, 128], [1024, 512]] as const) {
      const r = takeOnBurst(w, h, 1);
      expect(r.launch, `${w}x${h}`).toBe(2 * h); // the boundary list: the two columns of the strip, each cell next to free land
      expect(r.launch).toBeLessThan(r.cells / 100 + 1);
    }
  });

  it('taking c cells costs about c, whatever the length of the front and the size of the world (identical orders of magnitude on 256x64 and 1024x512)', () => {
    for (const c of [1, 16, 160, 1600]) {
      const small = takeOnBurst(256, 64, c);
      const wide = takeOnBurst(256, 256, c); // a front four times as long
      const big = takeOnBurst(1024, 512, c); // 32 times the cells, a front eight times as long
      for (const r of [small, wide, big]) {
        expect(r.captured).toBe(c);
        expect(r.popped).toBe(c); // a fresh frontier has no stale entries: one pick per capture
        expect(r.pushed).toBeLessThanOrEqual(3 * c + 1); // at most three new frontier cells per capture
        expect(r.scanned).toBeLessThanOrEqual(5 * c + 1);
      }
      // the same work, give or take the luck of the hash order, on a front of any length and a world of any size
      expect(Math.abs(wide.scanned - small.scanned)).toBeLessThanOrEqual(0.5 * small.scanned + 2);
      expect(Math.abs(big.scanned - small.scanned)).toBeLessThanOrEqual(0.5 * small.scanned + 2);
    }
    // linear in c: ten times the cells, about ten times the work
    const ten = takeOnBurst(1024, 512, 160).scanned;
    const hundred = takeOnBurst(1024, 512, 1600).scanned;
    expect(hundred / ten).toBeGreaterThan(8);
    expect(hundred / ten).toBeLessThan(12);
  });

  it('a world with nothing going on scans nothing: no attack and no candidate queued means 0 cells per tick, however large the world', () => {
    const s: GameState = makeBurstState({ width: 512, height: 256 });
    s.attacks.list.length = 0; // no attack
    s.attacks.reindex();
    for (let t = 0; t < 2 * 20; t++) step(s, { turn: s.tick, intents: [] }); // drain the enclave queue (the strip's own candidates)
    expect(s.enclaves.length).toBe(0);
    for (let t = 0; t < 100; t++) {
      step(s, { turn: s.tick, intents: [] });
      expect(s.work.scanned, `tick ${s.tick}`).toBe(0);
    }
    const small = landState(16, 8);
    for (let t = 0; t < 30; t++) {
      step(small, { turn: small.tick, intents: [] });
      expect(small.work.scanned).toBe(0);
    }
  });

  it('the stale entries an attack meets cost no more than the entries that were pushed: popped <= pushed over the life of an attack, per tick popped <= captured + stale', () => {
    const s = makeBurstState({ width: 256, height: 128 });
    const a = s.attacks.list[0];
    if (a === undefined) throw new Error('no attack');
    let pushed = s.work.pushed;
    let popped = 0;
    for (let i = 0; i < 40; i++) {
      s.work.reset();
      advanceAttack(s, a, 0, 100);
      pushed += s.work.pushed;
      popped += s.work.popped;
    }
    expect(popped).toBeLessThanOrEqual(pushed);
  });
});

describe('work counters on a whole match: 12 players and 20 tribes on the real world', () => {
  it('every tick looks at far less than a hundredth of the map, the enclave pass is bounded by its candidates and its budget, and the total work is a constant times the cells that changed', async () => {
    const match = await startRealMatch(1, 12, 20, true);
    const s = match.state;
    const cells = s.grid.cells;
    let ticks = 0;
    let scannedSum = 0;
    let changedSum = 0;
    let paintsSum = 0;
    let candidatesSum = 0;
    let launchSum = 0;
    let scannedMax = 0;
    const perTickRatio: number[] = [];
    for (let t = 0; t < 1500; t++) {
      const { paints } = match.tick();
      const w = s.work;
      ticks++;
      scannedSum += w.scanned;
      changedSum += w.changed;
      paintsSum += paints;
      candidatesSum += w.candidates;
      launchSum += w.launchScanned;
      scannedMax = Math.max(scannedMax, w.scanned);
      expect(w.scanned, `tick ${t}`).toBeLessThan(cells / 100);
      // hard bounds of the enclave pass
      expect(w.enclaveVisited, `tick ${t}`).toBeLessThanOrEqual(w.candidates * (ENCLAVE_MAX_CELLS + 1));
      expect(w.enclaveVisited, `tick ${t}`).toBeLessThanOrEqual(ENCLAVE_PASS_BUDGET_CELLS + ENCLAVE_MAX_CELLS + 1);
      if (w.changed >= 8) perTickRatio.push(w.scanned / w.changed);
    }
    // each owner change queues at most five candidates (four ports and the cell itself); a Spawn's cells and the enclave flips are changes too
    expect(candidatesSum).toBeLessThanOrEqual(5 * paintsSum + 100);
    // so the enclave work is at most (ENCLAVE_MAX_CELLS + 1) * 5 per changed cell; the rest is a small constant per change and per launch
    expect(scannedSum).toBeLessThanOrEqual(5 * (ENCLAVE_MAX_CELLS + 1) * paintsSum + 12 * paintsSum + launchSum + 1000);
    const typical = scannedSum / Math.max(1, paintsSum);
    console.log(
      `[work] ${ticks} ticks of the 12+20 match: mean cells scanned per tick ${(scannedSum / ticks).toFixed(0)} (max ${scannedMax}, the map has ${cells}), changed per tick ${(paintsSum / ticks).toFixed(1)}, scanned per changed cell ${typical.toFixed(1)}, ` +
        `candidates per changed cell ${(candidatesSum / paintsSum).toFixed(2)}, launch reads ${launchSum}; captures ${changedSum} (conquest + enclave flips)`,
    );
    expect(typical).toBeLessThan(60);
    expect(changedSum).toBeGreaterThan(5000);
  }, 60000);
});
