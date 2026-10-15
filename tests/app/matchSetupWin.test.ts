// M18-1: the win block of a built match. Real matches get the defaults of their region, `win: null` never ends, an invalid block is refused,
// and the block survives a serialisation round trip of the built state.
import { describe, expect, it } from 'vitest';
import { prepareWorld } from '../../src/app/matchWorld';
import { createMatch, defaultWinConfig, matchSetupConfig, type MatchSetupConfig } from '../../src/app/matchSetup';
import { TIME_LIMIT_SKIRMISH_TICKS, TIME_LIMIT_WORLD_TICKS, WIN_HOLD_TICKS, WIN_LAND_SHARE_PCT } from '../../src/sim/rules';
import { deserialize, hashState, serialize } from '../../src/sim/serialize';
import { miniWorld } from '../helpers/miniWorld';

const mini = prepareWorld(miniWorld());
const base = (extra: Partial<MatchSetupConfig> = {}): MatchSetupConfig => matchSetupConfig({ kind: 'real', countryId: 1 }, { aiNations: 2, tribes: false, ...extra });

describe('the win block of createMatch', () => {
  it('the defaults: all three on, 60 percent for 300 ticks, 25 minutes for the World and 12 for a Skirmish', () => {
    expect(defaultWinConfig('world')).toEqual({ land: true, last: true, score: true, timeLimitTicks: TIME_LIMIT_WORLD_TICKS, landSharePct: WIN_LAND_SHARE_PCT, holdTicks: WIN_HOLD_TICKS });
    expect(defaultWinConfig('europe').timeLimitTicks).toBe(TIME_LIMIT_SKIRMISH_TICKS);
    expect([TIME_LIMIT_WORLD_TICKS, TIME_LIMIT_SKIRMISH_TICKS, WIN_LAND_SHARE_PCT, WIN_HOLD_TICKS]).toEqual([15000, 7200, 60, 300]);
  });

  it('a real match carries the default block; win null carries none; an explicit block is kept', () => {
    const r = createMatch(mini, base());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.match.state.header.config.win).toEqual(defaultWinConfig('world'));
    const off = createMatch(mini, base({ win: null }));
    expect(off.ok && off.match.state.header.config.win).toBeUndefined();
    const custom = { land: false, last: true, score: false, timeLimitTicks: 100, landSharePct: 50, holdTicks: 10 };
    const c = createMatch(mini, base({ win: custom }));
    expect(c.ok && c.match.state.header.config.win).toEqual(custom);
    expect(off.ok && c.ok && hashState(off.match.state) !== hashState(c.match.state)).toBe(true);
  });

  it('refuses a malformed block with the field name', () => {
    for (const bad of [{ land: true, last: true, score: true, timeLimitTicks: 0, landSharePct: 60, holdTicks: 300 }, { land: true, last: true, score: true, timeLimitTicks: 100, landSharePct: 101, holdTicks: 300 }, { land: 1, last: true, score: true, timeLimitTicks: 100, landSharePct: 60, holdTicks: 300 }]) {
      const r = createMatch(mini, base({ win: bad as never }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.params.field).toBe('win');
    }
  });

  it('the built state round-trips with its block', () => {
    const r = createMatch(mini, base());
    if (!r.ok) throw new Error('refused');
    const back = deserialize(serialize(r.match.state));
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.state.header.config.win).toEqual(defaultWinConfig('world'));
      expect(hashState(back.state)).toBe(hashState(r.match.state));
    }
  });
});
