// Fix-4A2 (audit 3, finding 1.5), part 2: thresholds and tie-breaks of the AI's truce and alliance moves (the exact edge of every comparison). Same constructed
// positions as tests/ai/diplomacyPositions.test.ts.
import { describe, expect, it } from 'vitest';
import { createAiMemory, diplomacyMove, type AiMemory } from '../../src/ai';
import { validateIntent, withId, type IntentBody } from '../../src/sim/intents';
import { createRng } from '../../src/sim/rng';
import { AI_THINK_PERIOD_TICKS, AI_WAR_START_TICKS, DIPLOMACY_REPLY_MAX_TICKS, DIPLOMACY_REPLY_MIN_TICKS } from '../../src/sim/rules';
import { applyIntent } from '../../src/sim/step';
import { type GameState } from '../../src/sim/state';
import { setOwner } from '../../src/sim/territory';
import { StateView } from '../../src/sim/view';
import { landState } from '../sim/helpers/worlds';

let ids = 1;
function send(s: GameState, body: IntentBody): number {
  const i = withId(body, ids++);
  const shape = validateIntent(i, { seats: s.header.seats, cells: s.width * s.height, debugIntents: false });
  return shape !== 0 ? shape : applyIntent(s, i);
}
const ok = (s: GameState, body: IntentBody): void => void expect(send(s, body), body.kind).toBe(0);

function arena(shares: number[]): GameState {
  const s = landState(100, 10, { seats: shares.length, players: shares.length });
  let x = 0;
  shares.forEach((pct, i) => {
    for (let c = 0; c < pct; c++, x++) for (let y = 0; y < 10; y++) setOwner(s, y * 100 + x, i + 1, 0);
    s.troops[i + 1] = 200000;
    s.capital[i + 1] = x - pct + 1;
  });
  s.tick = AI_WAR_START_TICKS + 1000;
  return s;
}
type Mind = { memory: AiMemory; rng: Uint32Array; view: StateView };
function mind(s: GameState, seat: number): Mind {
  const view = new StateView(s);
  return { memory: createAiMemory(view, seat, { humanSeats: [] }), rng: createRng(1000 + seat), view };
}
function toRhythm(s: GameState, m: AiMemory): void {
  while ((s.tick + m.phase) % AI_THINK_PERIOD_TICKS !== 0) s.tick++;
}
function look(s: GameState, m: Mind): readonly IntentBody[] {
  m.view.refresh();
  return diplomacyMove(m.view, m.memory, m.rng);
}
function answers(s: GameState, m: Mind, limit = 120): IntentBody[] {
  const out: IntentBody[] = [];
  for (let n = 0; n <= limit; n++) {
    for (const b of look(s, m).filter((x) => x.kind === 'AcceptTreaty' || x.kind === 'DeclineTreaty')) {
      out.push(b);
      send(s, b);
    }
    s.tick++;
  }
  return out;
}
const asks = (out: readonly IntentBody[], treaty: number): IntentBody[] => out.filter((b) => (b as { treaty?: number }).treaty === treaty);

describe('thresholds and tie-breaks of the truce and alliance moves', () => {
  it('a leader asking for a truce is accepted when the AI fights exactly AI_TRUCE_ACCEPT_WARS players, the leader among them (and declined with one)', () => {
    const run = (extra: boolean): IntentBody[] => {
      const s = arena([20, 40, 30, 10]);
      ok(s, { kind: 'Attack', seat: 1, target: 3, pct: 10 });
      if (extra) ok(s, { kind: 'Attack', seat: 3, target: 3, pct: 10 });
      ok(s, { kind: 'ProposeTreaty', seat: 1, to: 2, treaty: 1 });
      return answers(s, mind(s, 2));
    };
    expect(run(true)).toEqual([{ kind: 'AcceptTreaty', seat: 2, from: 1 }]);
    expect(run(false)).toEqual([{ kind: 'DeclineTreaty', seat: 2, from: 1 }]);
  });

  it('the truce goes to the neighbour with most hits; on equal hits to the stronger one, whichever side it sits on', () => {
    for (const [shares, want] of [[[10, 25, 10, 35], 3], [[10, 35, 10, 25], 1]] as const) {
      const s = arena([...shares]);
      const m = mind(s, 2);
      ok(s, { kind: 'Attack', seat: 1, target: 3, pct: 10 });
      ok(s, { kind: 'Attack', seat: 3, target: 3, pct: 10 });
      m.memory.hits[1] = 1;
      m.memory.hits[3] = 1;
      toRhythm(s, m.memory);
      expect(asks(look(s, m), 1), `shares ${shares.join('/')}`).toEqual([{ kind: 'ProposeTreaty', seat: 2, to: want, treaty: 1 }]);
    }
  });

  it('seat 0 is a valid truce target and a valid ally', () => {
    const s = arena([35, 10, 45, 10]);
    const m = mind(s, 1);
    ok(s, { kind: 'Attack', seat: 0, target: 2, pct: 10 });
    m.memory.hits[0] = 1;
    toRhythm(s, m.memory);
    expect(asks(look(s, m), 1)).toEqual([{ kind: 'ProposeTreaty', seat: 1, to: 0, treaty: 1 }]);
    const t = arena([30, 50, 10, 10]);
    const n = mind(t, 2);
    toRhythm(t, n.memory);
    expect(look(t, n)).toEqual([{ kind: 'ProposeTreaty', seat: 2, to: 0, treaty: 2 }]);
  });

  it('a strong AI proposes a truce when it fights exactly two players, not when it fights one; a weak one at exactly half the median is not weak', () => {
    const fronts = (n: number): readonly IntentBody[] => {
      const s = arena([25, 25, 25, 25]);
      const m = mind(s, 1);
      ok(s, { kind: 'Attack', seat: 0, target: 2, pct: 10 });
      if (n > 1) ok(s, { kind: 'Attack', seat: 2, target: 2, pct: 10 });
      m.memory.hits[0] = 2;
      m.memory.hits[2] = 2;
      toRhythm(s, m.memory);
      return asks(look(s, m), 1);
    };
    expect(fronts(2).length).toBe(1);
    expect(fronts(1)).toEqual([]);
    const half = (own: number): readonly IntentBody[] => {
      const s = arena([own, 50]);
      const m = mind(s, 0);
      ok(s, { kind: 'Attack', seat: 1, target: 1, pct: 10 });
      m.memory.hits[1] = 2;
      toRhythm(s, m.memory);
      return asks(look(s, m), 1);
    };
    expect(half(25), 'share 25 against a median of 50: exactly half').toEqual([]);
    expect(half(24).length, 'share 24 against a median of 50').toBe(1);
  });

  it('the first think tick at AI_WAR_START_TICKS asks; the one before does not', () => {
    const at = (tick: number): readonly IntentBody[] => {
      const s = arena([10, 45, 35, 10]); // seat 0 thinks on multiples of the period (phase 0)
      const m = mind(s, 0);
      ok(s, { kind: 'Attack', seat: 1, target: 1, pct: 10 });
      m.memory.hits[1] = 1;
      s.tick = tick;
      return asks(look(s, m), 1);
    };
    expect(at(AI_WAR_START_TICKS - AI_THINK_PERIOD_TICKS)).toEqual([]);
    expect(at(AI_WAR_START_TICKS).length).toBe(1);
  });

  it('a stable alliance is no betrayal however often the AI looks', () => {
    const s = arena([30, 40, 30]);
    const m = mind(s, 0);
    ok(s, { kind: 'ProposeTreaty', seat: 2, to: 0, treaty: 2 });
    ok(s, { kind: 'AcceptTreaty', seat: 0, from: 2 });
    toRhythm(s, m.memory);
    for (let i = 0; i < 5; i++) {
      look(s, m);
      s.tick += AI_THINK_PERIOD_TICKS;
    }
    expect(Array.from(m.memory.betrayedAt)).toEqual([-1, -1, -1]);
  });

  it('the pause before an answer covers the whole range from DIPLOMACY_REPLY_MIN_TICKS to DIPLOMACY_REPLY_MAX_TICKS', () => {
    let lo = Infinity;
    let hi = 0;
    for (let seed = 0; seed < 300; seed++) {
      const s = arena([40, 60]);
      const m = mind(s, 0);
      ok(s, { kind: 'ProposeTreaty', seat: 1, to: 0, treaty: 1 });
      m.rng.set(createRng(seed));
      const t0 = s.tick;
      for (let n = 0; n < 100; n++) {
        if (look(s, m).some((b) => b.kind === 'AcceptTreaty')) break;
        s.tick++;
      }
      lo = Math.min(lo, s.tick - t0);
      hi = Math.max(hi, s.tick - t0);
    }
    expect([lo, hi]).toEqual([DIPLOMACY_REPLY_MIN_TICKS, DIPLOMACY_REPLY_MAX_TICKS]);
  });
});
