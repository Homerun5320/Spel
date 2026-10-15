// M18-1 through the host seam: a finished match reaches the page's mirror (result, win progress, statistics), a snapshot of a finished match
// resumes into the same state as the straight run, and the AI driver stops thinking once the match is over.
import { describe, expect, it } from 'vitest';
import { AiDriver } from '../../src/host/aiDriver';
import { MainThreadHost } from '../../src/host/mainThreadHost';
import { ViewMirror } from '../../src/host/viewMirror';
import { WIN_REASON_LAND } from '../../src/sim/matchState';
import { TICK_MS, WEIGHT_ONE } from '../../src/sim/rules';
import { createState, type GameState } from '../../src/sim/state';
import { setOwner } from '../../src/sim/territory';
import { CLASS_PLAINS } from '../../src/sim/terrain';
import { StateView } from '../../src/sim/view';

/** advance() runs at most MAX_TICKS_PER_FRAME ticks per call, so one tick per call. */
function run(host: MainThreadHost, ticks: number): void {
  for (let i = 0; i < ticks; i++) host.advance(TICK_MS);
}

function match(): GameState {
  const s = createState({
    width: 20,
    height: 20,
    seed: 9,
    seats: 3,
    players: 2,
    rowCos: new Uint16Array(20).fill(WEIGHT_ONE),
    config: { debugIntents: false, win: { land: true, last: true, score: true, timeLimitTicks: 5000, landSharePct: 60, holdTicks: 40 } },
    terrain: new Uint8Array(400).fill(CLASS_PLAINS),
    elevation: new Uint16Array(400),
  });
  for (let c = 0; c < 250; c++) setOwner(s, c, 1, 0);
  for (let c = 300; c < 330; c++) setOwner(s, c, 2, 0);
  s.outbox.clear();
  return s;
}

describe('the match end across the host seam', () => {
  it('the mirror shows the result, the progress and the statistics of the sim', async () => {
    const state = match();
    const host = new MainThreadHost(state);
    const { mirror } = await ViewMirror.attach(host);
    run(host, 10);
    expect(mirror.match.ended).toBe(false);
    expect(mirror.match.holdSeat).toBe(0);
    expect(mirror.match.holdTicksLeft).toBe(30);
    run(host, 40);
    expect(mirror.match.ended).toBe(true);
    expect(mirror.match.winnerSeat).toBe(0);
    expect(mirror.match.reason).toBe(WIN_REASON_LAND);
    expect(mirror.match.endTick).toBe(40);
    const direct = new StateView(state);
    for (const f of ['landStd', 'score', 'peakLand', 'built', 'conquered', 'districts', 'eliminated', 'capitalLost'] as const) {
      expect(Array.from(mirror.match[f] as ArrayLike<number>), f).toEqual(Array.from(direct.match[f] as ArrayLike<number>));
    }
    expect(mirror.match.peakLand[0]).toBe(62); // 250 cells of weight 1.0 = 62 std-cells
  });

  it('a snapshot of a finished match resumes to the same hash as the straight run', async () => {
    const straight = new MainThreadHost(match());
    run(straight, 120);
    const host = new MainThreadHost(match());
    run(host, 60);
    const snap = await host.requestSnapshot();
    const resumed = MainThreadHost.resume(snap);
    expect(resumed).not.toBeNull();
    if (resumed === null) return;
    run(resumed, 60);
    expect((await resumed.requestSnapshot()).hash).toBe((await straight.requestSnapshot()).hash);
  });

  it('the AI driver sends nothing once the match is over (and does send before it)', () => {
    const run = (ended: boolean): number => {
      const state = match();
      const view = new StateView(state);
      state.capital[2] = 301;
      state.troops[2] = 8000;
      const driver = new AiDriver(1, { humanSeats: [0] });
      let sent = 0;
      if (ended) {
        state.match.ended = 1;
        state.match.winner = 1;
        state.match.reason = WIN_REASON_LAND;
      }
      view.refresh();
      for (let t = 0; t < 300; t++) {
        state.tick = 500 + t;
        view.refresh();
        driver.onTick(view, () => sent++);
      }
      return sent;
    };
    expect(run(false)).toBeGreaterThan(0);
    expect(run(true)).toBe(0);
  });
});
