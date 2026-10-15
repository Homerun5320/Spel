// CPU budgets of the air navigation (M11b; perf project). Budgets go through budgetMs (tests/perfguard.ts). There is no per-tick cost: planRoute runs only when asked.
import { beforeAll, describe, expect, it } from 'vitest';
import { createLos } from '../src/sim/los/cache';
import { createNav, type Nav } from '../src/sim/nav/grid';
import { planRoute, type NavView } from '../src/sim/nav/route';
import { createEmptyState } from '../src/sim/state';
import { loadRealLos } from '../tools/sim/losWorld';
import { budgetMs, median, percentile } from './perfguard';

let nav: Nav;
let view: NavView;
let land: number[];

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The sim cell in the middle of a nav cell of the 256x128 grid. */
function centre(navCell: number): number {
  const nx = navCell % 256;
  const ny = (navCell - nx) / 256;
  return (ny * 4 + 2) * 1024 + nx * 4 + 2;
}

beforeAll(async () => {
  const real = await loadRealLos();
  const los = createLos(real.terrain);
  land = [];
  for (let i = 0; i < 256 * 128; i++) if ((real.terrainClass[centre(i)] as number) > 1) land.push(i);
  const r = rng(11);
  for (let i = 0; i < 30; i++) los.addSite(2, centre(land[Math.floor(r() * land.length)] as number), 24);
  nav = createNav({ width: 1024, height: 512, terrainClass: real.terrainClass, meanElev: real.meanElev }, los);
  const state = createEmptyState(1024, 512, 1, 3);
  view = { tick: 0, structures: state.structures, terrainClass: real.terrainClass, seats: 3 };
});

/** Seeded pairs of land nav cells 10 to 25 nav cells (40 to 100 sim cells) apart in the same Low component. */
function queries(n: number, seed: number): Array<[number, number]> {
  const r = rng(seed);
  const out: Array<[number, number]> = [];
  while (out.length < n) {
    const a = land[Math.floor(r() * land.length)] as number;
    const b = land[Math.floor(r() * land.length)] as number;
    let dx = Math.abs((a % 256) - (b % 256));
    if (dx > 128) dx = 256 - dx;
    const dy = Math.floor(a / 256) - Math.floor(b / 256);
    const d2 = dx * dx + dy * dy;
    if (d2 < 100 || d2 > 625) continue;
    if (!nav.airReachable(centre(a), centre(b), 0)) continue;
    out.push([centre(a), centre(b)]);
  }
  return out;
}

describe('air navigation performance', () => {
  it('A*: median <= budgetMs(2) and p99 <= budgetMs(20) over 200 seeded finished routes (lambda 3, 30 enemy SAM sites; 2 warm-ups first)', () => {
    const q = queries(200, 5);
    for (let i = 0; i < 2; i++) planRoute(nav, view, 0, (q[i] as [number, number])[0], (q[i] as [number, number])[1], 0);
    const samples: number[] = [];
    let fuel = 0;
    for (const [a, b] of q) {
      const t0 = performance.now();
      const r = planRoute(nav, view, 0, a, b, 0);
      samples.push(performance.now() - t0);
      if (r.ok) fuel += r.fuelCells;
    }
    expect(samples.length).toBeGreaterThanOrEqual(200);
    const med = median(samples);
    const p99 = percentile(samples, 99);
    console.log(`[nav perf] A* over ${q.length} routes (mean ${(fuel / q.length).toFixed(0)} cells): median ${med.toFixed(3)} ms (budget ${budgetMs(2).toFixed(3)}), p99 ${p99.toFixed(3)} ms (budget ${budgetMs(20).toFixed(3)})`);
    expect(med).toBeLessThanOrEqual(budgetMs(2));
    expect(p99).toBeLessThanOrEqual(budgetMs(20));
  });

  it('an unreachable goal answered by the labels takes at most budgetMs(0.1) (statistic: median over 1000 queries)', () => {
    // High is closed over the mountains: the goal is a closed cell, so the answer is a label lookup
    const closed: number[] = [];
    for (let i = 0; i < 256 * 128 && closed.length < 50; i++) if (nav.blocked[1]![i] === 1) closed.push(centre(i));
    expect(closed.length).toBeGreaterThan(0);
    const runs = nav.astarRuns;
    const samples: number[] = [];
    for (let i = 0; i < 1000; i++) {
      const t0 = performance.now();
      const r = planRoute(nav, view, 0, centre(land[i % land.length] as number), closed[i % closed.length] as number, 1);
      samples.push(performance.now() - t0);
      expect(r.ok).toBe(false);
    }
    expect(nav.astarRuns).toBe(runs);
    const med = median(samples);
    console.log(`[nav perf] label rejection: median ${(med * 1000).toFixed(2)} us (budget ${(budgetMs(0.1) * 1000).toFixed(0)} us)`);
    expect(med).toBeLessThanOrEqual(budgetMs(0.1));
  });
});
