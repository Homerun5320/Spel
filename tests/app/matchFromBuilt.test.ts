// A match from the setup screen: `MatchSession.fromMatch` starts a state that `createMatch` built (everyone placed at tick 0), with the
// human seat of the config, the names and flags of the seats and the AI on every other seat.
import { beforeAll, describe, expect, it } from 'vitest';
import { MatchSession, hashBuiltMatch } from '../../src/app/match';
import { createMatch, matchSetupConfig, type BuiltMatch } from '../../src/app/matchSetup';
import type { PreparedWorld } from '../../src/app/matchWorld';
import { REJECT_PHASE } from '../../src/sim/intents';
import { PHASE_SPAWN } from '../../src/sim/flow';
import { START_DISC_CELLS } from '../../src/sim/rules';
import { bannerState } from '../../src/ui/hudLogic';
import { setLanguage } from '../../src/ui/i18n';
import { loadPreparedWorld } from '../../tools/sim/realWorld';

let world: PreparedWorld;
beforeAll(async () => {
  world = await loadPreparedWorld();
});

function build(seed: number, humanSeat = 0, extra: Partial<Parameters<typeof matchSetupConfig>[1]> = {}): BuiltMatch {
  const swe = world.countries.find((c) => c.a3 === 'SWE')!;
  const r = createMatch(world, matchSetupConfig({ kind: 'real', countryId: swe.id }, { seed, aiNations: 5, humanSeat, ...extra }));
  if (!r.ok) throw new Error(r.error.key);
  return r.match;
}

describe('MatchSession.fromMatch', () => {
  it('starts at tick 0 with every nation on a whole disc, your seat from the config, names and flags from the match', async () => {
    const m = build(1);
    const s = await MatchSession.fromMatch(m, { interpolate: false });
    try {
      expect([s.localSeat, s.localOwner, s.built === m, s.view.tick, s.view.phase]).toEqual([0, 1, true, 0, PHASE_SPAWN]);
      for (let seat = 0; seat < 6; seat++) expect(s.view.stats.cells[seat], `seat ${seat}`).toBe(START_DISC_CELLS);
      setLanguage('sv');
      expect(s.labels?.name(0)).toBe('Sverige');
      setLanguage('en');
      expect(s.labels?.name(0)).toBe('Sweden');
      setLanguage('sv');
      expect(s.labels?.flag(0)).not.toBeNull();
      expect(s.labels?.isYou(0)).toBe(true);
    } finally {
      s.dispose();
    }
  });

  it('the human seat of the config is the seat the session plays: intents carry it, and the AI plays every other seat', async () => {
    const m = build(2, 3);
    const s = await MatchSession.fromMatch(m, { interpolate: false });
    try {
      expect([s.localSeat, s.localOwner]).toEqual([3, 4]);
      expect(s.labels?.isYou(3)).toBe(true);
      expect(s.labels?.isYou(0)).toBe(false);
      s.attack(0); // the attack phase has not begun: the sim refuses it, for seat 3
      s.runTicks(4);
      expect(s.takeNewReject()).toBe(REJECT_PHASE);
      s.runTicks(300); // through the 25 s of waiting: the AI seats act, yours does not
      expect(s.view.stats.cells[3]).toBeGreaterThanOrEqual(START_DISC_CELLS);
      let grew = 0;
      for (const seat of [0, 1, 2, 4, 5]) if ((s.view.stats.cells[seat] as number) > START_DISC_CELLS) grew++;
      expect(grew).toBeGreaterThan(0);
    } finally {
      s.dispose();
    }
  });

  it('with ai: false nobody but you acts (the 25 other seats stay as built)', async () => {
    const m = build(3);
    const s = await MatchSession.fromMatch(m, { interpolate: false, ai: false });
    try {
      const total = (): number => Array.from({ length: s.view.seats }, (_, i) => s.view.stats.cells[i] as number).reduce((a, b) => a + b, 0);
      const before = total();
      expect(before).toBeGreaterThan(6 * START_DISC_CELLS - 1);
      s.runTicks(400);
      for (let seat = 1; seat < 6; seat++) expect(s.view.stats.cells[seat]).toBe(START_DISC_CELLS);
      expect(total()).toBe(before); // nobody took or lost a cell
    } finally {
      s.dispose();
    }
  });

  it('hashBuiltMatch: the same config and seed give the same hashes twice, a different seed a different one, and playing changes the state', () => {
    const a = hashBuiltMatch(build(7), 100);
    const b = hashBuiltMatch(build(7), 100);
    const c = hashBuiltMatch(build(8), 100);
    expect(a).toEqual(b);
    expect(c.initial).not.toBe(a.initial);
    expect(a.after).not.toBe(a.initial);
    expect(a.initial).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('the banner of a match that is already placed', () => {
  it('says the nations are in place (not "starting place chosen") while the spawn phase counts down, and nothing else changes', () => {
    expect(bannerState(PHASE_SPAWN, 150, true, true)).toEqual({ key: 'phase.preplaced', seconds: 15, tone: 'wait' });
    expect(bannerState(PHASE_SPAWN, 150, true)).toEqual({ key: 'phase.spawnDone', seconds: 15, tone: 'wait' });
    expect(bannerState(PHASE_SPAWN, 150, false, true)).toEqual({ key: 'phase.spawnPick', seconds: 15, tone: 'prompt' });
  });
});
