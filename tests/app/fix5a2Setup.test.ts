// Fix-5A2 (audit 4: findings 0.0 and 2.6): the match setup with federations. A split country needs an outsider (no instant "last alive" win), a sub-nation has no home
// land, the partner list leaves out your own start, the AI nations fill the rest of the cap, and every start is a whole disc. Real data: the committed world and federations pack.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PreparedWorld } from '../../src/app/matchWorld';
import { FEDERATION_MIN_AI_NATIONS, createMatch, federationMinAiNations, matchSetupConfig, type BuiltMatch, type MatchSetupConfig } from '../../src/app/matchSetup';
import { step } from '../../src/sim/step';
import { WIN_REASON_LAST } from '../../src/sim/matchState';
import { SETUP_AI_NATIONS_MAX, START_DISC_CELLS } from '../../src/sim/rules';
import { loadPreparedWorld } from '../../tools/sim/realWorld';

let world: PreparedWorld;
beforeAll(async () => {
  world = await loadPreparedWorld();
});

const id = (a3: string): number => world.countries.find((c) => c.a3 === a3)?.id as number;
const config = (a3: string, options: Partial<MatchSetupConfig> = {}): MatchSetupConfig =>
  matchSetupConfig({ kind: 'real', countryId: id(a3) }, { seed: 5, tribes: false, aiNations: 4, win: null, ...options });

function build(a3: string, options: Partial<MatchSetupConfig> = {}): BuiltMatch {
  const r = createMatch(world, config(a3, options));
  if (!r.ok) throw new Error(`refused: ${r.error.code} ${r.error.key}`);
  return r.match;
}

const CANDIDATES = ['RUS', 'CAN', 'USA', 'CHN', 'BRA', 'AUS', 'IND'] as const;

describe('Fix-5A2: a split country needs an outsider (0.0)', () => {
  it('for each of the 7 candidates, 0 AI nations never gives an instant shared victory', () => {
    const f = world.data.federations;
    expect(CANDIDATES.every((a3) => f?.candidate[id(a3) - 1] === 1)).toBe(true);
    let refused = 0;
    for (const a3 of CANDIDATES) {
      const cfg = config(a3, { aiNations: 0, federations: true, win: undefined, spawnPhase: true });
      const r = createMatch(world, cfg);
      if (!r.ok) {
        // Refused at set-up, with its own error and the number to use.
        refused++;
        expect(r.error.code, a3).toBe('federationNeedsAi');
        expect(r.error.params.min, a3).toBe(FEDERATION_MIN_AI_NATIONS);
        expect(federationMinAiNations(world, cfg), a3).toBe(FEDERATION_MIN_AI_NATIONS);
        continue;
      }
      // Built: it must be a match where nobody wins by "last alive" 3000 ticks (150 s) in without an enemy (India stays whole: one player, no group).
      expect(federationMinAiNations(world, cfg), a3).toBe(0);
      const s = r.match.state;
      for (let i = 0; i < 3000 && s.match.ended === 0; i++) step(s, { turn: s.tick, intents: [] });
      expect(s.match.ended === 1 && s.match.reason === WIN_REASON_LAST, a3).toBe(false);
    }
    expect(refused).toBe(6);
  }, 120_000);

  it('one AI nation is enough, and the old behaviour without federations is unchanged', () => {
    expect(createMatch(world, config('USA', { aiNations: 1 })).ok).toBe(true);
    expect(createMatch(world, config('USA', { aiNations: 0, federations: false })).ok).toBe(true);
    expect(federationMinAiNations(world, config('USA', { aiNations: 0, federations: false }))).toBe(0);
    expect(federationMinAiNations(world, config('SWE', { aiNations: 0 }))).toBe(0);
    // A custom nation cannot be split.
    const custom = matchSetupConfig({ kind: 'custom', name: 'Zzyzx', color: 0xc8102e, flagSeed: 1, cell: 0 }, { federations: true, aiNations: 0 });
    expect(federationMinAiNations(world, custom)).toBe(0);
  });
});

describe('Fix-5A2: federation set-up rules (2.6)', () => {
  it('a sub-nation has NO home land; an ordinary nation keeps its country', () => {
    const m = build('USA', { federations: true });
    const home = m.state.home;
    expect(home).toBeTruthy();
    let subs = 0;
    let plain = 0;
    for (const s of m.seats) {
      if (s.kind === 'tribe') continue;
      if (s.subNation !== undefined) {
        subs++;
        expect(home?.homeLand[s.seat + 1], `sub-nation seat ${s.seat}`).toBe(0);
      } else if (s.countryId !== 0) {
        plain++;
        expect(home?.homeLand[s.seat + 1], `nation seat ${s.seat}`).toBeGreaterThan(0);
      }
    }
    expect(subs).toBeGreaterThanOrEqual(2);
    expect(plain).toBeGreaterThanOrEqual(1);
    // The whole-country control: without federations the same human has a home land.
    const whole = build('USA', {});
    expect(whole.state.home?.homeLand[whole.humanSeat + 1]).toBeGreaterThan(0);
  });

  it('the partner list leaves out your own start: players = sub-nations + the AI nations you asked for, no empty seat', () => {
    const m = build('USA', { federations: true, aiNations: 4 });
    const subs = m.seats.filter((s) => s.subNation !== undefined && s.countryId === id('USA'));
    expect(m.players).toBe(subs.length + 4);
    expect(m.federationGroups[0]?.length).toBe(subs.length);
    for (const s of m.seats.slice(0, m.players)) {
      expect(s.capitalCell, `seat ${s.seat} found no start`).toBeGreaterThanOrEqual(0);
      let owned = 0;
      for (let c = 0; c < m.state.owner.length; c++) if (m.state.owner[c] === s.seat + 1) owned++;
      expect(owned, `seat ${s.seat} holds a whole disc`).toBe(START_DISC_CELLS);
    }
  });

  it('the cap 1 + SETUP_AI_NATIONS_MAX holds for a split country; a split AI country is whole (all or none of its sub-nations)', () => {
    const m = build('USA', { federations: true, aiNations: SETUP_AI_NATIONS_MAX });
    expect(m.players).toBeLessThanOrEqual(1 + SETUP_AI_NATIONS_MAX);
    expect(m.players).toBe(1 + SETUP_AI_NATIONS_MAX);
    // Every federation group is the whole set of started sub-nations of ONE country, and every group seat is a sub-nation of it.
    for (const g of m.federationGroups) {
      const countries = new Set(g.map((seat) => m.seats[seat]?.countryId));
      expect(countries.size).toBe(1);
      for (const seat of g) expect(m.seats[seat]?.subNation).toBeGreaterThan(0);
    }
    // Every started player seat holds a whole disc (the split-fit check never leaves a short or empty seat).
    for (const s of m.seats.slice(0, m.players)) {
      let owned = 0;
      for (let c = 0; c < m.state.owner.length; c++) if (m.state.owner[c] === s.seat + 1) owned++;
      expect(owned, `seat ${s.seat}`).toBe(START_DISC_CELLS);
    }
  });
});
