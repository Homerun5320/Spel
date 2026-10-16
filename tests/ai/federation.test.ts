// M18b-2: the AI and a bound federation alliance. The AI never tries to break it, never proposes to a member, and over 20 seeds sends nothing the rules refuse.
import { describe, expect, it } from 'vitest';
import { AiDriver } from '../../src/host/aiDriver';
import { MainThreadHost } from '../../src/host/mainThreadHost';
import { createAiMemory, diplomacyMove } from '../../src/ai';
import { bindFederation } from '../../src/sim/diplomacy';
import { RELATION_ALLIANCE } from '../../src/sim/diplomacyTable';
import { OUTBOX_REJECT } from '../../src/sim/outbox';
import * as pub from '../../src/sim/public';
import { createRng } from '../../src/sim/rng';
import { AI_WAR_START_TICKS } from '../../src/sim/rules';
import { step } from '../../src/sim/step';
import { createState, type GameState } from '../../src/sim/state';
import { setOwner } from '../../src/sim/territory';
import { CLASS_PLAINS } from '../../src/sim/terrain';
import { StateView } from '../../src/sim/view';
import { landState } from '../sim/helpers/worlds';

describe('the AI and a federation', () => {
  it('a leader AI that would break its alliances leaves the bound one alone (a normal alliance is broken)', () => {
    const run = (bound: boolean): string[] => {
      const s = landState(100, 10, { seats: 3, players: 3 });
      let x = 0;
      [70, 10, 20].forEach((pct, i) => {
        for (let c = 0; c < pct; c++, x++) for (let y = 0; y < 10; y++) setOwner(s, y * 100 + x, i + 1, 0);
        s.troops[i + 1] = 200000;
        s.capital[i + 1] = x - pct + 1;
      });
      s.tick = AI_WAR_START_TICKS + 1000;
      if (bound) bindFederation(s, 0, 1);
      else s.diplo.setRelation(1, 2, RELATION_ALLIANCE, 0);
      s.diplo.rebuildPairs();
      const view = new StateView(s);
      const memory = createAiMemory(view, 0, { humanSeats: [] });
      const rng = createRng(3);
      const said: string[] = [];
      for (let n = 0; n < 600; n++) {
        s.tick++;
        view.refresh();
        for (const b of diplomacyMove(view, memory, rng)) said.push(b.kind);
      }
      return said;
    };
    // seat 0 holds 70 percent (above AI_LEADER_PCT): bound to seat 1 it says nothing about breaking.
    expect(run(true)).not.toContain('BreakTreaty');
    expect(run(true)).not.toContain('ProposeTreaty');
    // control: the same leader with an ordinary alliance does break it (so the test above can fail)
    expect(run(false)).toContain('BreakTreaty');
  });

  it('20 seeds with two federations: nothing refused at send, the bound alliances stay, nobody attacks a member', () => {
    let invalidAtSend = 0;
    let breaks = 0;
    let proposalsToMember = 0;
    let refused = 0;
    let bound = 0;
    const groups = [[0, 1, 2], [3, 4]];
    const sameGroup = (a: number, b: number): boolean => groups.some((g) => g.includes(a) && g.includes(b));
    for (let seed = 1; seed <= 20; seed++) {
      const state: GameState = createState({ width: 128, height: 64, seed, seats: 8, players: 6, config: { debugIntents: false, spawnPhase: true }, terrain: new Uint8Array(128 * 64).fill(CLASS_PLAINS), elevation: new Uint16Array(128 * 64) });
      for (const g of groups) for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) bindFederation(state, g[i] as number, g[j] as number);
      const ai = new AiDriver(seed, { humanSeats: [] });
      const driver = {
        onTick(v: pub.SimView, submit: (b: pub.IntentBody) => void): void {
          ai.onTick(v, (b) => {
            if (b.kind === 'BreakTreaty') {
              breaks++;
              if (sameGroup(b.seat, b.with)) invalidAtSend++;
            }
            if (b.kind === 'ProposeTreaty' && sameGroup(b.seat, b.to)) proposalsToMember++;
            if (b.kind === 'Attack' && b.target !== 0 && sameGroup(b.seat, b.target - 1)) invalidAtSend++;
            submit(b);
          });
        },
      };
      const host = new MainThreadHost(state, {
        driver,
        stepFn: (st, turn) => {
          const r = step(st, turn);
          for (const ev of st.outbox.drain()) {
            if (ev.kind === OUTBOX_REJECT && ev.a >= 80) {
              refused++;
              if (ev.a === pub.REJECT_DIPLO_FEDERATION) bound++;
            }
            st.outbox.push(ev.kind, ev.tick, ev.a, ev.b);
          }
          return r;
        },
      });
      host.runTicks(4500);
      for (const g of groups) for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
        if (state.match.eliminated[g[i] as number] === 0 && state.match.eliminated[g[j] as number] === 0) {
          expect(new StateView(state).diplomacy.federationBound(g[i] as number, g[j] as number), `seed ${seed}`).toBe(true);
        }
      }
    }
    expect(invalidAtSend).toBe(0);
    expect(proposalsToMember).toBe(0);
    expect(bound, 'no break was even tried').toBe(0);
    expect(refused).toBeLessThanOrEqual(5);
    void breaks;
  }, 120_000);
});
