// SimView.contactLength: the page's mirror (a scan of its own copy of the map, cached per ownerVersion) says the same as the
// sim's border index (the StateView the AI reads), for every pair of owners, while a real match with the AI is running.
import { describe, expect, it } from 'vitest';
import { AiDriver } from '../../src/host/aiDriver';
import { MainThreadHost } from '../../src/host/mainThreadHost';
import { ViewMirror } from '../../src/host/viewMirror';
import { MATCH_AI_NATIONS, MATCH_TRIBES } from '../../src/sim/rules';
import { countContacts, StateView } from '../../src/sim/view';
import { createWorldState } from '../../src/sim/world';
import { loadRealWorld } from '../../tools/sim/realWorld';
import { randomMatchState } from '../sim/helpers/randomMatch';

const PLAYERS = 1 + MATCH_AI_NATIONS;
const SEATS = PLAYERS + MATCH_TRIBES;

describe('SimView.contactLength', () => {
  it('the mirror equals the border index for every pair after 1000, 2500 and 4000 ticks of a match with the AI (real world, 26 seats)', async () => {
    const world = await loadRealWorld();
    const state = createWorldState(world, { seed: 5, seats: SEATS, players: PLAYERS, config: { debugIntents: false, spawnPhase: true } });
    const host = new MainThreadHost(state, { driver: new AiDriver(5) });
    const { mirror } = await ViewMirror.attach(host);
    const live = new StateView(state);
    let total = 0;
    for (const upTo of [1000, 2500, 4000]) {
      host.runTicks(upTo - state.tick);
      for (let a = 0; a <= SEATS; a++) {
        for (let b = 0; b <= SEATS; b++) {
          const want = live.contactLength(a, b);
          expect(mirror.contactLength(a, b), `tick ${upTo}: contact(${a}, ${b})`).toBe(want);
          total += want;
        }
      }
    }
    expect(total).toBeGreaterThan(1000);
  });

  it('is symmetric, zero for an owner against itself and for ids out of range, and follows the owner changes (the cache is per ownerVersion)', async () => {
    const state = randomMatchState(21, true);
    const host = new MainThreadHost(state);
    const { mirror } = await ViewMirror.attach(host);
    const seen: number[] = [];
    for (let i = 0; i < 6; i++) {
      for (let k = 0; k < 40; k++) {
        host.submitIntent({ kind: 'DebugPaint', seat: k % 6, cell: (k * 97 + i * 31) % (mirror.width * mirror.height) });
        host.advance(100);
      }
      const live = new StateView(state);
      let sum = 0;
      for (let a = 0; a <= 6; a++) {
        expect(mirror.contactLength(a, a)).toBe(0);
        for (let b = 0; b <= 6; b++) {
          expect(mirror.contactLength(a, b)).toBe(mirror.contactLength(b, a));
          expect(mirror.contactLength(a, b)).toBe(live.contactLength(a, b));
          sum += mirror.contactLength(a, b);
        }
      }
      seen.push(sum);
    }
    expect(new Set(seen).size).toBeGreaterThan(1);
    expect(mirror.contactLength(-1, 2)).toBe(0);
    expect(mirror.contactLength(2, 99)).toBe(0);
  });

  it('countContacts counts the borders of a tiny hand-made map, wraps in x and ignores the sea', () => {
    // 4 x 2, classes: row 0 = Plains Plains Sea Plains, row 1 = Plains Plains Plains Plains; owners 1 1 0 2 / 1 3 3 2 (0 = unowned).
    const terrain = [2, 2, 0, 2, 2, 2, 2, 2];
    const owner = [1, 1, 0, 2, 1, 3, 3, 2];
    const out = new Int32Array(16);
    countContacts(4, 2, owner, terrain, 4, out);
    const at = (a: number, b: number): number => out[a < b ? a * 4 + b : b * 4 + a] as number;
    expect(at(1, 2)).toBe(2); // across the east-west wrap: (3,0) against (0,0) and (3,1) against (0,1)
    expect(at(1, 3)).toBe(2); // (1,0)-(1,1) and (0,1)-(1,1)
    expect(at(2, 3)).toBe(1); // (2,1)-(3,1)
    expect(at(0, 1)).toBe(0); // the sea (0 owner, class sea) is no contact
    expect(at(0, 2)).toBe(0);
  });
});

describe('SimView.attackRunning (D143)', () => {
  it('the mirror equals the sim for every pair of owners while a real match with the AI runs, and some attacks do run', async () => {
    const world = await loadRealWorld();
    const state = createWorldState(world, { seed: 5, seats: SEATS, players: PLAYERS, config: { debugIntents: false, spawnPhase: true } });
    const host = new MainThreadHost(state, { driver: new AiDriver(5) });
    const { mirror } = await ViewMirror.attach(host);
    const live = new StateView(state);
    let running = 0;
    let toOwned = 0;
    for (const upTo of [600, 1500, 2600, 3500, 4500]) {
      host.runTicks(upTo - state.tick);
      live.refresh();
      for (let a = 0; a <= SEATS; a++) {
        for (let b = 0; b <= SEATS; b++) {
          const want = state.attacks.find(a, b) !== null;
          expect(live.attackRunning(a, b), `live tick ${upTo}: attack(${a}, ${b})`).toBe(want);
          expect(mirror.attackRunning(a, b), `mirror tick ${upTo}: attack(${a}, ${b})`).toBe(want);
          if (want) {
            running++;
            if (b !== 0) toOwned++;
          }
        }
      }
    }
    expect(running).toBeGreaterThan(20);
    expect(toOwned).toBeGreaterThan(0);
    // out of range ids are no attack
    for (const view of [live, mirror]) {
      expect(view.attackRunning(-1, 2)).toBe(false);
      expect(view.attackRunning(2, SEATS + 5)).toBe(false);
      expect(view.attackRunning(3, 3)).toBe(false);
    }
  });
});
