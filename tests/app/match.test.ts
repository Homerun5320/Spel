// The match session without a browser: seats, speeds, pause, commitment, intents through the host, the mirror, refusals.
import { describe, expect, it, vi } from 'vitest';
import { LOCAL_SEAT, MATCH_PLAYERS, MATCH_SEATS, MatchSession } from '../../src/app/match';
import { REJECT_PHASE, REJECT_SPAWNED, REJECT_TERRAIN } from '../../src/sim/intents';
import { MATCH_AI_NATIONS, MATCH_TRIBES, TICK_MS } from '../../src/sim/rules';
import { PHASE_IMMUNITY, PHASE_PLAY, PHASE_SPAWN } from '../../src/sim/flow';
import { rowCosFromLut } from '../../src/sim/grid';
import { CLASS_DEEP_SEA, CLASS_PLAINS } from '../../src/sim/terrain';

const W = 64;
const H = 32;

/** Land everywhere except one sea column; a real 32-seat match fits. */
function world() {
  const terrainClass = new Uint8Array(W * H).fill(CLASS_PLAINS);
  for (let y = 0; y < H; y++) terrainClass[y * W + 10] = CLASS_DEEP_SEA;
  return { width: W, height: H, terrainClass, meanElev: new Int16Array(W * H), cosQ15: Array.from(rowCosFromLut(H)) };
}

/** `ai: false` by default: these tests are about what the human's session does, and nobody else may act in the match. */
async function session(interpolate = false, ai = false): Promise<MatchSession> {
  return MatchSession.create(world(), { seed: 3, debugIntents: false, interpolate, ai });
}

describe('MatchSession', () => {
  it('is the standard match: you, five AI nations and twenty tribes, with the match flow on and the debug intents off', async () => {
    const s = await session();
    expect([MATCH_PLAYERS, MATCH_SEATS, LOCAL_SEAT]).toEqual([1 + MATCH_AI_NATIONS, 1 + MATCH_AI_NATIONS + MATCH_TRIBES, 0]);
    const v = s.view;
    expect([v.seats, v.players, v.flow, v.debugIntents, v.tick, v.phase]).toEqual([26, 6, true, false, 0, PHASE_SPAWN]);
    expect(s.localOwner).toBe(1);
    s.dispose();
  });

  it('spawns on a click, refuses sea and a second spawn through the sim, and reports each refusal once and only for its own intents', async () => {
    const s = await session();
    s.spawnAt(10); // the sea column
    s.runTicks(3);
    expect(s.view.rejects).toBe(1);
    expect(s.takeNewReject()).toBe(REJECT_TERRAIN);
    expect(s.takeNewReject()).toBe(0); // reported once
    s.spawnAt(5 * W + 30);
    s.runTicks(3);
    expect(s.view.stats.cells[0]).toBeGreaterThan(0);
    expect(s.view.stats.capital[0]).toBe(5 * W + 30 + 1);
    s.spawnAt(20 * W + 40);
    s.runTicks(3);
    expect(s.takeNewReject()).toBe(REJECT_SPAWNED);
    // an Attack in the spawn phase is the phase rule, not a UI check
    s.attack(0);
    s.runTicks(3);
    expect(s.takeNewReject()).toBe(REJECT_PHASE);
    s.dispose();
  });

  it('runs the phases by the tick: spawn 20 s, immunity 5 s, then play, and the attack starts the conquest', async () => {
    const s = await session();
    s.spawnAt(5 * W + 30);
    s.runTicks(195);
    expect([s.view.phase, s.view.phaseTicksLeft]).toEqual([PHASE_SPAWN, 5]);
    s.runTicks(10);
    expect(s.view.phase).toBe(PHASE_IMMUNITY);
    s.runTicks(50);
    expect([s.view.phase, s.view.phaseTicksLeft]).toEqual([PHASE_PLAY, 0]);
    const before = s.view.stats.cells[0] as number;
    s.attack(0);
    s.runTicks(200);
    expect(s.view.stats.cells[0]).toBeGreaterThan(before);
    expect(s.view.rejects).toBe(0);
    s.dispose();
  });

  it('commitment snaps to steps of 5 between 5 and 100 and starts at 40', async () => {
    const s = await session();
    expect(s.commitPct).toBe(40);
    s.adjustCommit(1);
    expect(s.commitPct).toBe(45);
    s.setCommit(47);
    expect(s.commitPct).toBe(45);
    s.setCommit(48);
    expect(s.commitPct).toBe(50);
    s.setCommit(0);
    expect(s.commitPct).toBe(5);
    s.setCommit(1000);
    expect(s.commitPct).toBe(100);
    s.adjustCommit(-1000);
    expect(s.commitPct).toBe(5);
    s.dispose();
  });

  it('speeds: 1x, 2x, 4x by ticks per frame, pause runs nothing and keeps the chosen speed, . and , stop at the ends', async () => {
    const s = await session();
    const run = (ms: number): number => {
      const t0 = s.view.tick;
      s.frame(ms);
      return s.view.tick - t0;
    };
    expect(run(TICK_MS)).toBe(1);
    s.setSpeed(2);
    expect(run(TICK_MS)).toBe(2);
    s.setSpeed(4);
    expect(run(TICK_MS)).toBe(4);
    s.togglePause();
    expect([s.speed, s.isPaused]).toEqual([0, true]);
    expect(run(1000)).toBe(0);
    s.togglePause();
    expect(s.speed).toBe(4);
    s.faster();
    expect(s.speed).toBe(4);
    s.slower();
    s.slower();
    s.slower();
    expect(s.speed).toBe(1);
    s.setPaused(true);
    s.faster(); // changing the speed while paused keeps the pause
    expect([s.speed, s.isPaused]).toEqual([0, true]);
    s.setPaused(false);
    expect(s.speed).toBe(2);
    s.dispose();
  });

  it('a stalled frame runs at most eight ticks (the host drops the rest) and 60 frames of 1/60 s are one second of game time at 1x', async () => {
    const s = await session();
    s.frame(5000);
    expect(s.view.tick).toBe(8);
    const t0 = s.view.tick;
    for (let i = 0; i < 60; i++) s.frame(1000 / 60);
    expect(s.view.tick - t0).toBeGreaterThanOrEqual(9);
    expect(s.view.tick - t0).toBeLessThanOrEqual(10);
    s.dispose();
  });

  it('HUD numbers interpolate between ticks in the live page and are exact when interpolation is off', async () => {
    const live = await session(true);
    live.spawnAt(5 * W + 30);
    live.runTicks(3);
    live.runTicks(1);
    const a = live.stats.value('troopsQt', 0, 0);
    const b = live.stats.value('troopsQt', 0, 1);
    expect(b).toBeGreaterThanOrEqual(a);
    expect(b).toBe(live.view.stats.troopsQt[0]);
    live.frame(TICK_MS / 4);
    expect(live.alpha()).toBeGreaterThan(0);
    expect(live.alpha()).toBeLessThan(1);
    const exact = await session(false);
    exact.frame(10);
    expect(exact.alpha()).toBe(1);
    live.dispose();
    exact.dispose();
  });

  it('the hash of two sessions with the same seed and the same inputs is the same, another seed gives another match', async () => {
    const play = async (seed: number): Promise<number> => {
      const s = await MatchSession.create(world(), { seed, interpolate: false });
      s.spawnAt(5 * W + 30);
      s.runTicks(260);
      s.attack(0);
      s.runTicks(100);
      const h = await s.hash();
      s.dispose();
      return h;
    };
    expect(await play(5)).toBe(await play(5));
    expect(await play(5)).not.toBe(await play(6));
  });

  it('the AI nations and the tribes act by default and not with ai: false (the 25 other seats stay empty)', async () => {
    const quiet = await session();
    quiet.runTicks(300);
    expect(Array.from(quiet.view.stats.cells as ArrayLike<number>).reduce((a, b) => a + b, 0)).toBe(0);
    quiet.dispose();
    const busy = await MatchSession.create(world(), { seed: 3, debugIntents: false, interpolate: false });
    busy.runTicks(300);
    let alive = 0;
    for (let seat = 1; seat < MATCH_SEATS; seat++) alive += busy.view.stats.alive[seat] as number;
    expect(alive).toBeGreaterThanOrEqual(2); // a 64 x 32 world has room for only a few capitals
    expect(busy.view.stats.cells[LOCAL_SEAT]).toBe(0);
    busy.dispose();
  });

  it('attack(target) sends exactly {kind: Attack, seat: 0, target, pct: the chosen commitment}: a target other than 0 and a commitment other than the default arrive as they are', async () => {
    const s = await session();
    const host = (s as unknown as { host: { submitIntent(b: unknown): void } }).host;
    const sent: unknown[] = [];
    const spy = vi.spyOn(host, 'submitIntent').mockImplementation((b) => {
      sent.push(b);
    });
    s.setCommit(65);
    s.attack(7);
    s.setCommit(15);
    s.attack(0);
    s.setCommit(100);
    s.attack(25);
    expect(sent).toEqual([
      { kind: 'Attack', seat: LOCAL_SEAT, target: 7, pct: 65 },
      { kind: 'Attack', seat: LOCAL_SEAT, target: 0, pct: 15 },
      { kind: 'Attack', seat: LOCAL_SEAT, target: 25, pct: 100 },
    ]);
    spy.mockRestore();
    s.dispose();
  });

  it('spawnAt(cell) sends {kind: Spawn, seat: 0, cell}', async () => {
    const s = await session();
    const host = (s as unknown as { host: { submitIntent(b: unknown): void } }).host;
    const sent: unknown[] = [];
    const spy = vi.spyOn(host, 'submitIntent').mockImplementation((b) => {
      sent.push(b);
    });
    s.spawnAt(123);
    expect(sent).toEqual([{ kind: 'Spawn', seat: LOCAL_SEAT, cell: 123 }]);
    spy.mockRestore();
    s.dispose();
  });

  it('takeNewReject reports only refusals of the human: an AI seat\'s refused intent in a tick where the human sent nothing is never shown', async () => {
    const s = await session();
    const host = (s as unknown as { host: { submitIntent(b: unknown): void } }).host;
    // seat 3 (an AI nation) tries to spawn on the sea column: the sim refuses it, the human sent nothing
    host.submitIntent({ kind: 'Spawn', seat: 3, cell: 10 });
    s.runTicks(4);
    expect(s.view.rejects).toBe(1);
    expect(s.view.lastRejectReason).toBe(REJECT_TERRAIN);
    expect(s.takeNewReject()).toBe(0);
    expect(s.takeNewReject()).toBe(0);
    // a refusal of the human's own intent some ticks later is still reported, once
    s.spawnAt(10 + W); // sea again (the column is sea in every row)
    s.runTicks(4);
    expect(s.view.rejects).toBe(2);
    expect(s.takeNewReject()).toBe(REJECT_TERRAIN);
    expect(s.takeNewReject()).toBe(0);
    s.dispose();
  });

  it('takeNewReject still reports the human\'s refusal when an AI seat was refused in the same tick, and forgets old ticks of its own intents', async () => {
    const s = await session();
    const host = (s as unknown as { host: { submitIntent(b: unknown): void } }).host;
    host.submitIntent({ kind: 'Spawn', seat: 3, cell: 10 });
    s.spawnAt(10 + 2 * W);
    s.runTicks(4);
    expect(s.takeNewReject()).toBe(REJECT_TERRAIN);
    // a human intent that was accepted leaves nothing to report, even much later
    s.spawnAt(5 * W + 30);
    s.runTicks(50);
    expect(s.takeNewReject()).toBe(0);
    s.dispose();
  });
});
