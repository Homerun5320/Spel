// M20a-2: the read-only description of the attacks running (SimView.fronts): a front cell and a direction per attack, at most 16, sent by the host only when it changed
// (a signature that also moves every FRONT_REFRESH_TICKS ticks while an attack runs) and copied by the ViewMirror.
import { describe, expect, it } from 'vitest';
import { MainThreadHost } from '../../src/host/mainThreadHost';
import { FRONT_REFRESH_TICKS } from '../../src/host/frontSnapshot';
import { ViewMirror } from '../../src/host/viewMirror';
import { createState, seatToOwner, type GameState } from '../../src/sim/state';
import { CLASS_PLAINS } from '../../src/sim/terrain';
import { ATTACK_VIEW_CAP, StateView } from '../../src/sim/view';

function world(width: number, height: number, seats: number): GameState {
  return createState({ width, height, seed: 3, seats, players: seats, config: { debugIntents: false, spawnPhase: false }, terrain: new Uint8Array(width * height).fill(CLASS_PLAINS), elevation: new Uint16Array(width * height) });
}

describe('SimView.fronts', () => {
  it('describes a running attack by a cell on its front and the direction into the target; the host sends it only when it changed and the mirror copies it', async () => {
    const state = world(120, 64, 2);
    const host = new MainThreadHost(state);
    const { mirror } = await ViewMirror.attach(host);
    host.submitIntent({ kind: 'Spawn', seat: 0, cell: 32 * 120 + 40 });
    host.submitIntent({ kind: 'Spawn', seat: 1, cell: 32 * 120 + 52 });
    host.runTicks(300);
    const [a, b] = [seatToOwner(0), seatToOwner(1)];
    host.submitIntent({ kind: 'Attack', seat: 0, target: b, pct: 100 });
    host.runTicks(4);
    const live = new StateView(state);
    expect(live.attackRunning(a, b)).toBe(true);
    const f = live.fronts;
    expect(f.count).toBe(1);
    expect([f.attacker[0], f.target[0]]).toEqual([a, b]);
    const c = f.cell[0] as number;
    expect(state.owner[c]).toBe(b);
    expect([state.owner[c - 1], state.owner[c + 1], state.owner[c - 120], state.owner[c + 120]]).toContain(a);
    expect(f.dirX[0]).toBeGreaterThan(0); // seat 0 lies west of seat 1
    expect(Math.abs(f.dirX[0] as number) + Math.abs(f.dirY[0] as number)).toBeGreaterThan(0);
    // the mirror carries the same rows (the full view brought the table at attach time; the diff brings it after at most one refresh period)
    host.runTicks(FRONT_REFRESH_TICKS);
    expect(mirror.fronts.count).toBe(1);
    expect([mirror.fronts.attacker[0], mirror.fronts.target[0]]).toEqual([a, b]);
    expect(state.owner[mirror.fronts.cell[0] as number]).toBe(b);
    // unchanged within a period: no new table arrives
    const v0 = mirror.frontsVersion;
    host.runTicks(1);
    host.runTicks(1);
    expect(mirror.frontsVersion).toBeLessThanOrEqual(v0 + 1);
    const v1 = mirror.frontsVersion;
    host.runTicks(FRONT_REFRESH_TICKS * 2);
    expect(mirror.frontsVersion).toBeGreaterThan(v1);
    // the attack is called off: the rows go
    host.submitIntent({ kind: 'CancelAttack', seat: 0, target: b });
    host.runTicks(FRONT_REFRESH_TICKS + 2);
    expect(live.attackRunning(a, b)).toBe(false);
    expect(mirror.fronts.count).toBe(0);
  });

  it('is capped at ATTACK_VIEW_CAP rows and a match without attacks sends no table after the first', async () => {
    const seats = 36;
    const state = world(960, 40, seats);
    const host = new MainThreadHost(state);
    const { mirror } = await ViewMirror.attach(host);
    expect(mirror.fronts.count).toBe(0);
    for (let s = 0; s < seats; s++) host.submitIntent({ kind: 'Spawn', seat: s, cell: 20 * 960 + 6 + s * 22 });
    host.runTicks(200);
    const v = mirror.frontsVersion;
    host.runTicks(30);
    expect(mirror.frontsVersion).toBe(v);
    for (let s = 0; s < seats; s++) {
      host.submitIntent({ kind: 'Attack', seat: s, target: 0, pct: 50 });
      if (s % 4 === 3) host.runTicks(1); // the host files a few intents per turn
    }
    host.runTicks(6);
    const live = new StateView(state);
    expect(state.attacks.list.length).toBeGreaterThan(ATTACK_VIEW_CAP);
    expect(live.fronts.count).toBe(ATTACK_VIEW_CAP);
    host.runTicks(FRONT_REFRESH_TICKS);
    expect(mirror.fronts.count).toBe(ATTACK_VIEW_CAP);
  });
});
