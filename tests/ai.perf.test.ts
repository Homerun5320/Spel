// CPU budget of AI v0 (perf project). Statistic: the MEDIAN of 200 single calls of think() per seat after 20 warm-up calls, at most
// budgetMs(0.5) (tests/perfguard.ts). The calls measured are the ones that do the work (the seat thinks on this tick, has troops
// for an Attack and an enemy to pick), the expensive path; the early return of the other nine ticks in ten costs nothing.
import { describe, expect, it } from 'vitest';
import { createAiMemory, pickSpawnCell, think, type AiMemory } from '../src/ai';
import { AiDriver } from '../src/host/aiDriver';
import { MainThreadHost } from '../src/host/mainThreadHost';
import { ownerCapQt } from '../src/sim/economy';
import { MATCH_AI_NATIONS, MATCH_TRIBES, AI_NATION_CLEARANCE_CELLS, AI_THINK_PERIOD_TICKS } from '../src/sim/rules';
import { createRng } from '../src/sim/rng';
import { seatToOwner } from '../src/sim/state';
import { StateView } from '../src/sim/view';
import { createWorldState } from '../src/sim/world';
import { loadRealWorld } from '../tools/sim/realWorld';
import { budgetMs, median, percentile } from './perfguard';

const PLAYERS = 1 + MATCH_AI_NATIONS;
const SEATS = PLAYERS + MATCH_TRIBES;
const WARMUPS = 20;
const CALLS = 200;

describe('AI v0 performance', () => {
  it('think() of every AI seat: median of 200 working calls after 20 warm-ups is at most budgetMs(0.5)', async () => {
    const world = await loadRealWorld();
    const state = createWorldState(world, { seed: 3, seats: SEATS, players: PLAYERS, config: { debugIntents: false, spawnPhase: true } });
    new MainThreadHost(state, { driver: new AiDriver(3) }).runTicks(3000);
    const view = new StateView(state);
    const rng = createRng(1);
    const budget = budgetMs(0.5);
    const rows: string[] = [];
    let sink = 0;
    for (let seat = 1; seat < SEATS; seat++) {
      const m0 = createAiMemory(view, seat, rng);
      const owner = seatToOwner(seat);
      const samples: number[] = [];
      for (let i = 0; i < WARMUPS + CALLS; i++) {
        // Arrange the working path: it thinks now, has the troops, and has not attacked anybody lately.
        const m: AiMemory = { ...m0, phase: (AI_THINK_PERIOD_TICKS - (state.tick % AI_THINK_PERIOD_TICKS)) % AI_THINK_PERIOD_TICKS };
        m.lastAttack.fill(-1);
        state.troops[owner] = ownerCapQt(state, owner);
        view.refresh(); // the statistics are the host's job (once per tick), not part of the thought
        const t0 = performance.now();
        const out = think(view, m, rng);
        const dt = performance.now() - t0;
        if (seat < PLAYERS) sink += out.length;
        if (i >= WARMUPS) samples.push(dt);
      }
      const med = median(samples);
      rows.push(`seat ${seat}${seat >= PLAYERS ? ' (tribe)' : ''}: median ${(med * 1000).toFixed(1)} us, p95 ${(percentile(samples, 95) * 1000).toFixed(1)} us, max ${(Math.max(...samples) * 1000).toFixed(0)} us`);
      expect(med, `seat ${seat}`).toBeLessThanOrEqual(budget);
    }
    console.log(`[ai perf] think() working path, ${CALLS} calls per seat after ${WARMUPS} warm-ups, budget budgetMs(0.5) = ${(budget * 1000).toFixed(0)} us (statistic: median)\n  ${rows.join('\n  ')}`);
    expect(sink, 'the nations really took the working path').toBe((PLAYERS - 1) * (WARMUPS + CALLS));
  });

  it('the spawn path (the place search) has a median of at most budgetMs(0.5) too, and the whole host tick with the driver stays cheap', async () => {
    const world = await loadRealWorld();
    const state = createWorldState(world, { seed: 3, seats: SEATS, players: PLAYERS, config: { debugIntents: false, spawnPhase: true } });
    const host = new MainThreadHost(state, { driver: new AiDriver(3) });
    host.runTicks(60);
    const view = new StateView(state);
    const samples: number[] = [];
    for (let i = 0; i < WARMUPS + CALLS; i++) {
      const rng = createRng(i + 1);
      const t0 = performance.now();
      const cell = pickSpawnCell(view, rng, AI_NATION_CLEARANCE_CELLS);
      const dt = performance.now() - t0;
      expect(cell).toBeGreaterThanOrEqual(0);
      if (i >= WARMUPS) samples.push(dt);
    }
    const med = median(samples);
    const p99 = percentile(samples, 99);
    console.log(`[ai perf] pickSpawnCell: median ${(med * 1000).toFixed(1)} us, p99 ${(p99 * 1000).toFixed(1)} us over ${CALLS} calls (budget for the median budgetMs(0.5) = ${(budgetMs(0.5) * 1000).toFixed(0)} us)`);
    expect(med).toBeLessThanOrEqual(budgetMs(0.5));

    // The host tick with the driver (view refresh + 25 early returns + the occasional thought) against the host tick without it.
    const bare = createWorldState(world, { seed: 3, seats: SEATS, players: PLAYERS, config: { debugIntents: false, spawnPhase: true } });
    const plain = new MainThreadHost(bare);
    const tickMs = (h: MainThreadHost): number[] => {
      const out: number[] = [];
      for (let i = 0; i < 300; i++) {
        const t0 = performance.now();
        h.runTicks(1);
        out.push(performance.now() - t0);
      }
      return out;
    };
    plain.runTicks(300);
    host.runTicks(240);
    const withAi = tickMs(host);
    const without = tickMs(plain);
    console.log(`[ai perf] host tick with the AI: median ${(median(withAi) * 1000).toFixed(1)} us, p95 ${(percentile(withAi, 95) * 1000).toFixed(1)} us; without: median ${(median(without) * 1000).toFixed(1)} us (the AI also makes the sim do conquest work)`);
    expect(median(withAi)).toBeLessThanOrEqual(budgetMs(1));
  });
});
