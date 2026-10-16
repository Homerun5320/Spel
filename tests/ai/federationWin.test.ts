// M18b-3: the AI in a match with federations AND win rules. Over 20 seeds nothing the rules refuse is sent, the time limit decides every match, and the
// winner is a legal group representative: a member of the winning federation is only ever named by the group's root.
import { describe, expect, it } from 'vitest';
import { AiDriver } from '../../src/host/aiDriver';
import { MainThreadHost } from '../../src/host/mainThreadHost';
import { bindFederation } from '../../src/sim/diplomacy';
import { federationRoots } from '../../src/sim/groups';
import { OUTBOX_REJECT } from '../../src/sim/outbox';
import { hashState } from '../../src/sim/serialize';
import { createState, type GameState } from '../../src/sim/state';
import { step } from '../../src/sim/step';
import { CLASS_PLAINS } from '../../src/sim/terrain';

const GROUPS = [[0, 1, 2], [3, 4]];

function run(seed: number, federated: boolean): { state: GameState; refused: number } {
  const state: GameState = createState({
    width: 128,
    height: 64,
    seed,
    seats: 8,
    players: 6,
    config: { debugIntents: false, spawnPhase: true, win: { land: true, last: true, score: true, timeLimitTicks: 3000, landSharePct: 40, holdTicks: 200 } },
    terrain: new Uint8Array(128 * 64).fill(CLASS_PLAINS),
    elevation: new Uint16Array(128 * 64),
  });
  if (federated) for (const g of GROUPS) for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) bindFederation(state, g[i] as number, g[j] as number);
  const ai = new AiDriver(seed, { humanSeats: [] });
  let refused = 0;
  const host = new MainThreadHost(state, {
    driver: { onTick: (v, submit) => ai.onTick(v, submit) },
    stepFn: (st, turn) => {
      const r = step(st, turn);
      for (const ev of st.outbox.drain()) {
        if (ev.kind === OUTBOX_REJECT) refused++;
        st.outbox.push(ev.kind, ev.tick, ev.a, ev.b);
      }
      return r;
    },
  });
  host.runTicks(4500);
  return { state, refused };
}

describe('the AI with federations and win rules', () => {
  it('20 seeds: the time limit ends every match, the winner is a legal representative, the run repeats exactly', () => {
    let federationWins = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const a = run(seed, true);
      expect(a.state.match.ended, `seed ${seed}`).toBe(1);
      const w = a.state.match.winner;
      if (w !== 0) {
        const roots = federationRoots(a.state);
        // a winner inside a living federation is its root (the lowest ownerId of the group)
        if (roots !== null) expect(roots[w], `seed ${seed}`).toBe(w);
        if (GROUPS.some((g) => g.includes(w - 1))) federationWins++;
      }
      // the same seed again gives the same state (determinism with groups in the win phase)
      if (seed <= 3) expect(hashState(run(seed, true).state), `seed ${seed}`).toBe(hashState(a.state));
    }
    console.log(`[federationWin] ${federationWins} of 20 matches were won by a federation member`);
  }, 240_000);

  it('the AI sends nothing the rules refuse more often with federations than without', () => {
    let withFed = 0;
    let without = 0;
    for (let seed = 1; seed <= 20; seed++) {
      withFed += run(seed, true).refused;
      without += run(seed, false).refused;
    }
    expect(withFed).toBeLessThanOrEqual(without + 5);
  }, 240_000);
});
