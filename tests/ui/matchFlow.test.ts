// M18-2: the pure view-models of the match flow: the result rows and the reason text from a MatchView, the Escape decision, the human's status,
// the elimination watcher, and the win-config <-> form mapping with the presets.
import { describe, expect, it } from 'vitest';
import { escapeAction } from '../../src/app/matchKeys';
import { defaultWinConfig } from '../../src/app/matchSetup';
import {
  DEFAULT_WIN_DRAFT,
  WIN_PRESETS,
  clampWinDraft,
  presetDraft,
  presetOf,
  winConfigOf,
  winDraftOf,
  winInfoOfConfig,
  winInfoOfView,
  winSummaryText,
} from '../../src/app/winSetup';
import { validWinConfig } from '../../src/sim/matchState';
import { MATCH_HEADER_WORDS, MATCH_SEAT_FIELDS, matchPackedLength, matchViewOf } from '../../src/sim/matchView';
import { WIN_REASON_LAND, WIN_REASON_LAST, WIN_REASON_SCORE } from '../../src/sim/public';
import { WIN_HOLD_TICKS } from '../../src/sim/rules';
import { setLanguage, TABLES } from '../../src/ui/i18n';
import { MatchWatcher, humanStatus, reasonLine, resultRows } from '../../src/ui/matchFlow';
import { WIN_SETUP } from '../../src/ui/uiConfig';

interface Facts {
  ended?: number;
  winner1?: number;
  reason?: number;
  winFlags?: number;
  timeLimitTicks?: number;
  landSharePct?: number;
  holdTicks?: number;
  seat: Partial<Record<(typeof MATCH_SEAT_FIELDS)[number], number[]>>;
}

/** A MatchView of 4 seats (3 players + 1 tribe) over a packed array, the way the sim fills it. */
function view(f: Facts) {
  const seats = 4;
  const p = new Uint32Array(matchPackedLength(seats));
  p[0] = f.ended ?? 0;
  p[1] = f.winner1 ?? 0;
  p[2] = f.reason ?? 0;
  p[4] = f.winFlags ?? 7;
  p[5] = f.timeLimitTicks ?? 7200;
  p[6] = f.landSharePct ?? 60;
  p[7] = f.holdTicks ?? WIN_HOLD_TICKS;
  MATCH_SEAT_FIELDS.forEach((name, i) => {
    const values = f.seat[name] ?? [];
    for (let s = 0; s < seats; s++) p[MATCH_HEADER_WORDS + i * seats + s] = values[s] ?? 0;
  });
  return { m: matchViewOf(seats, p), p };
}

const nameOf = (s: number): string => ['Sverige', 'Norge', 'Danmark', 'Stam'][s] as string;
const colorOf = (s: number): string => `#00000${s}`;

describe('the Escape decision', () => {
  it('closes a mode when the stack has one, opens the pause menu only when it is empty', () => {
    expect(escapeAction(0)).toBe('open-pause');
    expect(escapeAction(1)).toBe('close-mode');
    expect(escapeAction(3)).toBe('close-mode');
  });
});

describe('the result rows', () => {
  const { m } = view({
    ended: 1,
    winner1: 2, // seat 1
    reason: WIN_REASON_SCORE,
    seat: { score: [50, 70, 50, 999], landStd: [10, 5, 12, 99], peakLand: [11, 6, 12, 99], built: [1, 2, 3, 4], conquered: [5, 6, 7, 8], eliminated: [0, 0, 1, 0] },
  });
  const rows = resultRows(m, 3, 0, nameOf, colorOf, (s) => s * 10);

  it('lists the players only, the winner first, then by score, then land, then seat', () => {
    expect(rows.map((r) => r.seat)).toEqual([1, 2, 0]); // seat 2 beats seat 0 on land at equal score
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(rows[0]?.winner).toBe(true);
    expect(rows.find((r) => r.seat === 3)).toBeUndefined();
  });

  it('copies every statistic from the view and marks you and the eliminated', () => {
    const r2 = rows.find((r) => r.seat === 2);
    expect(r2).toMatchObject({ name: 'Danmark', color: '#000002', score: 50, peakLand: 12, built: 3, conquered: 7, landPct: 20, eliminated: true, you: false });
    expect(rows.find((r) => r.seat === 0)).toMatchObject({ you: true, eliminated: false });
  });

  it('M18c-2: carries the treaties made and broken of every nation from the view', () => {
    const t = view({ ended: 1, winner1: 1, seat: { score: [1, 2, 3], landStd: [4, 4, 4], treaties: [3, 0, 7, 0], betrayals: [0, 2, 1, 0] } });
    const byseat = (seat: number) => resultRows(t.m, 3, 0, nameOf, colorOf, () => 0).find((r) => r.seat === seat);
    expect(byseat(0)).toMatchObject({ treaties: 3, betrayals: 0 });
    expect(byseat(1)).toMatchObject({ treaties: 0, betrayals: 2 });
    expect(byseat(2)).toMatchObject({ treaties: 7, betrayals: 1 });
  });

  it('breaks a full tie by the lower seat id', () => {
    const t = view({ ended: 1, winner1: 0, seat: { score: [1, 1, 1], landStd: [4, 4, 4] } });
    expect(resultRows(t.m, 3, 0, nameOf, colorOf, () => 0).map((r) => r.seat)).toEqual([0, 1, 2]);
  });
});

describe('the reason text', () => {
  it('names the three ways to win, with the numbers of the rule', () => {
    const land = reasonLine(view({ ended: 1, winner1: 1, reason: WIN_REASON_LAND, landSharePct: 55, holdTicks: 300, seat: {} }).m, 0, nameOf);
    expect(land.titleKey).toBe('result.title.you');
    expect(land.reasonKey).toBe('result.reason.landYou');
    expect(land.reasonParams).toMatchObject({ pct: 55, secs: 30 });
    const other = reasonLine(view({ ended: 1, winner1: 2, reason: WIN_REASON_LAND, seat: {} }).m, 0, nameOf);
    expect(other.titleKey).toBe('result.title.other');
    expect(other.reasonKey).toBe('result.reason.land');
    expect(other.reasonParams).toMatchObject({ name: 'Norge', pct: 60, secs: 30 });
    expect(reasonLine(view({ ended: 1, winner1: 3, reason: WIN_REASON_LAST, seat: {} }).m, 0, nameOf).reasonKey).toBe('result.reason.last');
    const score = reasonLine(view({ ended: 1, winner1: 1, reason: WIN_REASON_SCORE, timeLimitTicks: 7200, seat: {} }).m, 0, nameOf);
    expect(score.reasonKey).toBe('result.reason.score');
    expect(score.reasonParams).toMatchObject({ min: 12 });
  });

  it('renders the Swedish sentences of the task in both languages', () => {
    const land = reasonLine(view({ ended: 1, winner1: 1, reason: WIN_REASON_LAND, seat: {} }).m, 0, nameOf);
    const sv = TABLES.sv[land.reasonKey] as string;
    expect(sv.replace('{pct}', '60').replace('{secs}', '30')).toBe('Ni erövrade 60 procent av världen i 30 sekunder');
    expect(TABLES.sv['result.reason.last']).toBe('Sist kvar');
    expect((TABLES.sv['result.reason.score'] as string).replace('{min}', '12')).toBe('Högst poäng efter 12 minuter');
  });
});

describe('the human status and the elimination watcher', () => {
  it('is over when the match ended, eliminated when only the human is out', () => {
    expect(humanStatus(view({ seat: {} }).m, 0)).toBe('playing');
    expect(humanStatus(view({ seat: { eliminated: [1] } }).m, 0)).toBe('eliminated');
    expect(humanStatus(view({ ended: 1, seat: { eliminated: [1] } }).m, 0)).toBe('over');
  });

  it('reports a new elimination or capital loss of ANOTHER nation once, and the first scan only learns', () => {
    const w = new MatchWatcher();
    const a = view({ seat: { capitalLost: [0, 1, 0] } });
    expect(w.scan(a.m, 3, 0)).toBeNull(); // primed, nothing reported
    expect(w.scan(a.m, 3, 0)).toBeNull();
    a.p[MATCH_HEADER_WORDS + 2] = 1; // seat 2 eliminated (block 0 = eliminated)
    const ev = w.scan(a.m, 3, 0);
    expect(ev?.eliminated).toEqual([2]);
    expect(ev?.capitalLost).toEqual([]);
    expect(w.scan(a.m, 3, 0)).toBeNull(); // once
    a.p[MATCH_HEADER_WORDS + 0] = 1; // the local seat: its own panel, no toast
    expect(w.scan(a.m, 3, 0)).toBeNull();
    const b = view({ seat: {} });
    const w2 = new MatchWatcher();
    w2.scan(b.m, 3, 0);
    b.p[MATCH_HEADER_WORDS + 4 + 1] = 1; // seat 1's capital lost (block 1 = capitalLost)
    expect(w2.scan(b.m, 3, 0)?.capitalLost).toEqual([1]);
  });
});

describe('the win conditions of the setup', () => {
  it('Standard is the default and gives the sim defaults (no explicit block)', () => {
    expect(DEFAULT_WIN_DRAFT).toEqual(presetDraft('standard'));
    expect(winConfigOf(DEFAULT_WIN_DRAFT, 'world')).toBeUndefined();
    expect(presetOf(DEFAULT_WIN_DRAFT)).toBe('standard');
  });

  it('Quick match is points after 8 minutes plus last alive; Sandbox never ends', () => {
    const quick = winConfigOf(presetDraft('quick'), 'world');
    expect(quick).toMatchObject({ land: false, last: true, score: true, timeLimitTicks: 8 * 600 });
    expect(winConfigOf(presetDraft('sandbox'), 'europe')).toBeNull();
    expect(presetOf(presetDraft('quick'))).toBe('quick');
    expect(presetOf(presetDraft('sandbox'))).toBe('sandbox');
  });

  it('every form value maps to a config the sim accepts, and back', () => {
    for (const land of [false, true]) {
      for (const last of [false, true]) {
        for (const score of [false, true]) {
          for (const minutes of WIN_SETUP.minuteChoices) {
            for (const landPct of [WIN_SETUP.pctMin, 60, WIN_SETUP.pctMax]) {
              for (const region of ['world', 'europe'] as const) {
                const d = { land, last, score, minutes, landPct };
                const cfg = winConfigOf(d, region);
                if (cfg === null || cfg === undefined) continue;
                expect(validWinConfig(cfg)).toBe(true);
                const back = winDraftOf(cfg, region);
                expect(back.land).toBe(land);
                expect(back.last).toBe(last);
                expect(back.score).toBe(score);
                if (land) expect(back.landPct).toBe(landPct);
                expect(winConfigOf(back, region) ?? defaultWinConfig(region)).toEqual(cfg); // "undefined" means the area's defaults
              }
            }
          }
        }
      }
    }
  });

  it('clamps the land share to the slider and the minutes to the choices', () => {
    expect(clampWinDraft({ ...DEFAULT_WIN_DRAFT, landPct: 5 }).landPct).toBe(WIN_SETUP.pctMin);
    expect(clampWinDraft({ ...DEFAULT_WIN_DRAFT, landPct: 99 }).landPct).toBe(WIN_SETUP.pctMax);
    expect(clampWinDraft({ ...DEFAULT_WIN_DRAFT, minutes: 7 }).minutes).toBe(0);
    expect(winConfigOf({ ...DEFAULT_WIN_DRAFT, landPct: 70 }, 'world')).toMatchObject({ landSharePct: 70, holdTicks: WIN_HOLD_TICKS, timeLimitTicks: defaultWinConfig('world').timeLimitTicks });
  });

  it('the presets are exactly three, and the summary names the chosen rules in both languages', () => {
    expect(WIN_PRESETS).toEqual(['standard', 'quick', 'sandbox']);
    setLanguage('sv');
    expect(winSummaryText(winInfoOfConfig(undefined, 'europe'))).toBe('Vinst: Erövra 60 % av världen och håll det i 30 s · Sist kvar · Flest poäng efter 12 min');
    expect(winSummaryText(winInfoOfConfig(null, 'world'))).toBe('Sandlåda: matchen tar aldrig slut.');
    setLanguage('en');
    expect(winSummaryText(winInfoOfConfig(winConfigOf(presetDraft('quick'), 'world'), 'world'))).toBe('Win: Last one standing · Most points after 8 min');
    setLanguage('sv');
  });

  it('the summary from the sim view agrees with the one from the config', () => {
    const cfg = winConfigOf(presetDraft('quick'), 'world');
    const fromView = winInfoOfView({ winFlags: 6, landSharePct: 60, holdTicks: 300, timeLimitTicks: 8 * 600 });
    setLanguage('sv');
    expect(winSummaryText(fromView)).toBe(winSummaryText(winInfoOfConfig(cfg, 'world')));
  });
});
