// Fix-3C (audit 2, mutation lens): the path that decides whether the player's match can end. The plain Play match gets its win block from
// `winForPlay`, the setup screen's choice goes through `checkDraft`, the stored setup keeps and clamps it, and the pause menu reads the flags
// back from the sim's MatchView. Every test here has a mutant in docs/DECISIONS.md "Fix-3C" that it kills.
import { beforeAll, describe, expect, it } from 'vitest';
import { LOCAL_SEAT, MatchSession, winForPlay } from '../../src/app/match';
import { defaultWinConfig } from '../../src/app/matchSetup';
import type { PreparedWorld } from '../../src/app/matchWorld';
import { countryEligibility } from '../../src/app/eligibility';
import { checkDraft, defaultDraft, draftFromStored, storedOf, type SetupDraft } from '../../src/app/setupModel';
import { DEFAULT_WIN_DRAFT, TICKS_PER_MINUTE, presetDraft, presetOf, winDraftOf, winInfoOfView, type WinDraft } from '../../src/app/winSetup';
import { REGION_IDS } from '../../src/data/regions';
import { rowCosFromLut } from '../../src/sim/grid';
import { CLASS_PLAINS } from '../../src/sim/terrain';
import { WIN_HOLD_TICKS } from '../../src/sim/rules';
import { WIN_SETUP } from '../../src/ui/uiConfig';
import { loadPreparedWorld } from '../../tools/sim/realWorld';

const W = 64;
const H = 32;
function smallWorld() {
  return { width: W, height: H, terrainClass: new Uint8Array(W * H).fill(CLASS_PLAINS), meanElev: new Int16Array(W * H), cosQ15: Array.from(rowCosFromLut(H)) };
}

describe('the plain Play match and its win block', () => {
  it('winForPlay: the defaults of the world outside test mode, nothing in test mode', () => {
    expect(winForPlay(false)).toEqual(defaultWinConfig('world'));
    expect(winForPlay(true)).toBeUndefined();
  });

  it('a session given the block carries it into the sim (all three rules on); a session without it never ends (no rule on)', async () => {
    const withWin = await MatchSession.create(smallWorld(), { seed: 3, ai: false, interpolate: false, win: winForPlay(false) });
    expect(withWin.view.match.winFlags).toBe(7);
    expect([withWin.view.match.landSharePct, withWin.view.match.holdTicks, withWin.view.match.timeLimitTicks]).toEqual([
      defaultWinConfig('world').landSharePct,
      defaultWinConfig('world').holdTicks,
      defaultWinConfig('world').timeLimitTicks,
    ]);
    withWin.dispose();
    const testMode = await MatchSession.create(smallWorld(), { seed: 3, ai: false, interpolate: false, win: winForPlay(true) });
    expect(testMode.view.match.winFlags).toBe(0);
    expect(LOCAL_SEAT).toBe(0);
    testMode.dispose();
  });
});

describe('the setup draft and its win choice', () => {
  let world: PreparedWorld;
  beforeAll(async () => {
    world = await loadPreparedWorld();
  });
  const okCountry = (): number => world.countries.find((c) => countryEligibility(world.analyse('world'), c).ok)!.id;
  const base = (patch: Partial<SetupDraft> = {}): SetupDraft => ({ ...defaultDraft(1, 'Nyland'), countryId: okCountry(), ...patch });

  it('checkDraft: Standard leaves the block out, Sandbox says "never ends" (null), Quick makes the explicit block', () => {
    const std = checkDraft(world, base());
    expect(std.ok && 'win' in std.config).toBe(false);
    const sandbox = checkDraft(world, base({ win: presetDraft('sandbox') }));
    expect(sandbox.ok && sandbox.config.win).toBeNull();
    const quick = checkDraft(world, base({ win: presetDraft('quick') }));
    expect(quick.ok).toBe(true);
    if (quick.ok) {
      expect(quick.config.win).toMatchObject({ land: false, last: true, score: true, timeLimitTicks: 8 * TICKS_PER_MINUTE, holdTicks: WIN_HOLD_TICKS });
    }
  });

  it('the stored setup keeps a win draft through JSON', () => {
    const draft = base({ win: presetDraft('quick') });
    const back = JSON.parse(JSON.stringify(storedOf(draft, world))) as ReturnType<typeof storedOf>;
    expect(back.win).toEqual(presetDraft('quick'));
    expect(draftFromStored(back, world, base()).win).toEqual(presetDraft('quick'));
  });

  it('a stored win draft out of range is pulled into range; one of another shape, or none, gives the base draft', () => {
    const stored = storedOf(base(), world);
    const evil = { ...stored, win: { land: true, landPct: 5000, last: false, score: true, minutes: 9 } };
    const d = draftFromStored(evil, world, base());
    expect(d.win).toEqual({ land: true, landPct: WIN_SETUP.pctMax, last: false, score: true, minutes: 0 });
    const lowPct = draftFromStored({ ...stored, win: { ...evil.win, landPct: -3 } }, world, base());
    expect(lowPct.win.landPct).toBe(WIN_SETUP.pctMin);
    const junk = { ...stored, win: { land: 'yes', landPct: 60, last: true, score: true, minutes: 0 } } as unknown as typeof stored;
    const other = base({ win: presetDraft('quick') });
    expect(draftFromStored(junk, world, other).win).toEqual(presetDraft('quick'));
    const { win: _omitted, ...old } = stored;
    expect(draftFromStored(old, world, other).win).toEqual(presetDraft('quick'));
  });
});

describe('winSetup: the flags both ways', () => {
  const view = (winFlags: number) => ({ winFlags, landSharePct: 60, holdTicks: 300, timeLimitTicks: 7200 });

  it('winInfoOfView reads land = 1, last = 2, score = 4, each alone and in every mix', () => {
    for (let flags = 0; flags < 8; flags++) {
      const w = winInfoOfView(view(flags));
      expect([w.land, w.last, w.score], `flags ${flags}`).toEqual([(flags & 1) !== 0, (flags & 2) !== 0, (flags & 4) !== 0]);
    }
    expect(winInfoOfView(view(2))).toMatchObject({ land: false, last: true, score: false });
    expect(winInfoOfView(view(4))).toMatchObject({ land: false, last: false, score: true });
    expect(winInfoOfView(view(1))).toMatchObject({ land: true, last: false, score: false });
  });

  it('winDraftOf: undefined is Standard, null is the sandbox, a limit that is a choice is its minutes, any other limit is "the area default"', () => {
    expect(winDraftOf(undefined, 'world')).toEqual(DEFAULT_WIN_DRAFT);
    expect(winDraftOf(null, 'world')).toEqual(presetDraft('sandbox'));
    const base = defaultWinConfig('world');
    expect(winDraftOf({ ...base, timeLimitTicks: 12 * TICKS_PER_MINUTE }, 'world').minutes).toBe(12);
    expect(winDraftOf({ ...base, timeLimitTicks: 9 * TICKS_PER_MINUTE }, 'world').minutes).toBe(0);
    expect(winDraftOf({ ...base, timeLimitTicks: base.timeLimitTicks }, 'world').minutes).toBe(0);
    for (const region of REGION_IDS) expect(winDraftOf(defaultWinConfig(region), region).minutes, region).toBe(0); // the area default is never a fixed choice
    expect(winDraftOf({ ...base, landSharePct: 75, last: false }, 'world')).toMatchObject({ landPct: 75, last: false, land: true });
  });

  it('presetOf: a switch that is off ignores its number; a switch that is on does not', () => {
    const quick = presetDraft('quick');
    const sandbox = presetDraft('sandbox');
    expect(presetOf({ ...quick, landPct: 77 })).toBe('quick'); // land off: its percent is ignored
    expect(presetOf({ ...sandbox, minutes: 20, landPct: 45 })).toBe('sandbox'); // score and land off
    const lastOnlyMinutes: WinDraft = { ...quick, score: false, minutes: 20 };
    expect(presetOf(lastOnlyMinutes)).toBeNull(); // a custom mix: last only
    expect(presetOf({ ...DEFAULT_WIN_DRAFT, landPct: 70 })).toBeNull(); // land on: the percent counts
    expect(presetOf({ ...DEFAULT_WIN_DRAFT, minutes: 8 })).toBeNull(); // score on: the minutes count
    expect(presetOf({ ...quick, minutes: 12 })).toBeNull();
  });
});
