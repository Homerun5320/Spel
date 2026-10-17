// M18d-1: the AI's research. The choice of branch by situation, the waiting rules, and 20 seeded matches in which the AI researches without a single refused Research.
import { describe, expect, it } from 'vitest';
import { createAiMemory, researchMove } from '../../src/ai';
import { AiDriver } from '../../src/host/aiDriver';
import { MainThreadHost, type TickDriver } from '../../src/host/mainThreadHost';
import { REJECT_NONE, withId, type IntentBody } from '../../src/sim/intents';
import { OUTBOX_REJECT } from '../../src/sim/outbox';
import { AI_TECH_GOLD_RESERVE, AI_TECH_PERIOD_TICKS, AI_TECH_START_TICKS, MILLI_GOLD_PER_GOLD, TECH_PRICE_GOLD } from '../../src/sim/rules';
import { applyIntent, step } from '../../src/sim/step';
import type { StepFn } from '../../src/sim/step';
import { createState, type GameState } from '../../src/sim/state';
import { CLASS_PLAINS } from '../../src/sim/terrain';
import { STRUCT_SAM } from '../../src/sim/structureRules';
import { setOwner } from '../../src/sim/territory';
import { StateView } from '../../src/sim/view';
import { landState } from '../sim/helpers/worlds';

const W = 120;
const H = 60;

/** Seat 0 (ownerId 1) holds the left half, seat 1 (ownerId 2) the right half; both are AI seats. */
function scene(): { state: GameState; view: StateView } {
  const state = landState(W, H, { seats: 2, players: 2 });
  for (let c = 0; c < state.grid.cells; c++) setOwner(state, c, c % W < W / 2 ? 1 : 2, 0);
  state.capital[1] = 30 * W + 20 + 1;
  state.capital[2] = 30 * W + 90 + 1;
  return { state, view: new StateView(state) };
}

/** The tick at which seat `seat` looks (past the start tick, on its own residue of the period). */
function lookTick(seat: number): number {
  let t = AI_TECH_START_TICKS;
  while ((t + seat * 3 + 5) % AI_TECH_PERIOD_TICKS !== 0) t++;
  return t;
}

function ask(state: GameState, view: StateView, seat: number, tick = lookTick(seat)): IntentBody | null {
  state.tick = tick;
  view.refresh();
  return researchMove(view, createAiMemory(view, seat, { humanSeats: [] }));
}

describe('researchMove: which branch, and when', () => {
  it('a peaceful, rich nation researches ECONOMY first; the intent is valid and carries the branch\'s first step', () => {
    const { state, view } = scene();
    state.gold[1] = 5000 * MILLI_GOLD_PER_GOLD;
    const b = ask(state, view, 0);
    expect(b).toEqual({ kind: 'Research', seat: 0, tech: 0 });
    expect(applyIntent(state, withId(b as IntentBody, 1))).toBe(REJECT_NONE);
  });

  it('after the first step it asks for the second step of the same branch', () => {
    const { state, view } = scene();
    state.gold[1] = 5000 * MILLI_GOLD_PER_GOLD;
    state.match.setTechMask(1, 0b1);
    expect(ask(state, view, 0)).toEqual({ kind: 'Research', seat: 0, tech: 1 });
  });

  it('under attack it turns to DEFENCE first (step 1 of branch 3 = tech 12), and with a SAM site to AIR (tech 8)', () => {
    const { state, view } = scene();
    state.gold[1] = 5000 * MILLI_GOLD_PER_GOLD;
    state.gold[2] = 5000 * MILLI_GOLD_PER_GOLD;
    state.troops[2] = 100000;
    state.tick = 600;
    expect(applyIntent(state, withId({ kind: 'Attack', seat: 1, target: 1, pct: 50 }, 1))).toBe(REJECT_NONE);
    view.refresh();
    expect(view.attackRunning(2, 1)).toBe(true);
    expect(ask(state, view, 0)).toEqual({ kind: 'Research', seat: 0, tech: 12 });
    expect(ask(state, view, 1)).toEqual({ kind: 'Research', seat: 1, tech: 0 }); // the attacker is not under attack
    const calm = scene();
    calm.state.gold[1] = 5000 * MILLI_GOLD_PER_GOLD;
    const sam = calm.state.structures.add(STRUCT_SAM, 1, 30 * W + 10, 0);
    calm.state.structures.readyTick[sam] = 0;
    expect(ask(calm.state, calm.view, 0)).toEqual({ kind: 'Research', seat: 0, tech: 8 });
  });

  it('waits for price + AI_TECH_GOLD_RESERVE (it does not drift to another branch), and is silent before the start tick, off its look tick, while researching, and as a tribe', () => {
    const { state, view } = scene();
    const need = ((TECH_PRICE_GOLD[0] as number) + AI_TECH_GOLD_RESERVE) * MILLI_GOLD_PER_GOLD;
    state.gold[1] = need - 1;
    expect(ask(state, view, 0)).toBeNull();
    state.gold[1] = need;
    expect(ask(state, view, 0)).not.toBeNull();
    expect(ask(state, view, 0, AI_TECH_START_TICKS - AI_TECH_PERIOD_TICKS)).toBeNull();
    expect(ask(state, view, 0, lookTick(0) + 1)).toBeNull();
    state.match.techCurrent[1] = 1;
    state.match.techDone[1] = 99999;
    expect(ask(state, view, 0)).toBeNull();
    state.match.techCurrent[1] = 0;
    state.match.techDone[1] = 0;
    state.tick = lookTick(0);
    view.refresh();
    const tribe = createAiMemory(view, 0, { humanSeats: [] });
    expect(researchMove(view, { ...tribe, tribe: true })).toBeNull();
  });

  it('a finished tree gives nothing more to research', () => {
    const { state, view } = scene();
    state.gold[1] = 90000 * MILLI_GOLD_PER_GOLD;
    state.match.setTechMask(1, 0xffff);
    expect(ask(state, view, 0)).toBeNull();
  });
});

describe('20 seeded matches: the AI researches and the sim refuses none of it', () => {
  it('no refused Research or CancelResearch, techs do get researched, and a researched tech is never researched twice', () => {
    let refused = 0;
    const reasons: Record<number, number> = {};
    let sent = 0;
    let researched = 0;
    const branches = new Set<number>();
    for (let seed = 1; seed <= 20; seed++) {
      const state = createState({ width: 200, height: 100, seed, seats: 5, players: 5, config: { debugIntents: false, spawnPhase: true }, terrain: new Uint8Array(20000).fill(CLASS_PLAINS), elevation: new Uint16Array(20000) });
      const base = step as StepFn;
      const stepFn: StepFn = (s, turn) => {
        for (const i of turn.intents) if (i.kind === 'Research') sent++;
        const r = base(s, turn);
        for (const e of s.outbox.drain()) if (e.kind === OUTBOX_REJECT && e.a >= 110 && e.a <= 117) { refused++; reasons[e.a] = (reasons[e.a] ?? 0) + 1; }
        return r;
      };
      const ai = new AiDriver(seed, { humanSeats: [0] });
      const driver: TickDriver = {
        onTick(view, submit) {
          // Arrangement, not a rule: a rich purse every 150 ticks so that the AI has gold for the tree as well as for its builds.
          if (view.tick > 1000 && view.tick % 150 === 0) for (let o = 2; o <= 5; o++) state.gold[o] = Math.max(state.gold[o] as number, 2500 * MILLI_GOLD_PER_GOLD);
          ai.onTick(view, submit);
        },
      };
      const host = new MainThreadHost(state, { driver, stepFn });
      host.submitIntent({ kind: 'Spawn', seat: 0, cell: 50 * 200 + 100 });
      host.runTicks(4200);
      for (let o = 2; o <= 5; o++) {
        const mask = state.match.techMask[o] as number;
        for (let t = 0; t < 16; t++) if ((mask & (1 << t)) !== 0) { researched++; branches.add(Math.floor(t / 4)); }
      }
    }
    expect(sent).toBeGreaterThan(20);
    expect(reasons).toEqual({});
    expect(refused).toBe(0);
    expect(researched).toBeGreaterThan(20);
    expect(branches.size).toBeGreaterThanOrEqual(1);
  });
});
