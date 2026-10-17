// Fix-5B: the pure parts of the layout fixes. The result rows of a federation win (every member of the winning group wins, ranked by score alone), the helicopter
// refusal text names the owner's cap, the plural of the exposed-cells text, and the alliance badge that must not read as "AI".
import { describe, expect, it } from 'vitest';
import { MATCH_HEADER_WORDS, MATCH_SEAT_FIELDS, matchPackedLength, matchViewOf } from '../../src/sim/matchView';
import { resultRows } from '../../src/ui/matchFlow';
import { rejectKey } from '../../src/ui/hudLogic';
import { setLanguage, setStrictI18n, t, tn } from '../../src/ui/i18n';
import { REJECT_HELI_BAD_TROOPS } from '../../src/sim/public';

function view(winner1: number, seat: Partial<Record<(typeof MATCH_SEAT_FIELDS)[number], number[]>>) {
  const seats = 5;
  const p = new Uint32Array(matchPackedLength(seats));
  p[0] = 1;
  p[1] = winner1;
  p[2] = 3;
  p[4] = 7;
  p[5] = 7200;
  p[6] = 60;
  p[7] = 100;
  MATCH_SEAT_FIELDS.forEach((name, i) => {
    const values = seat[name] ?? [];
    for (let s = 0; s < seats; s++) p[MATCH_HEADER_WORDS + i * seats + s] = values[s] ?? 0;
  });
  return matchViewOf(seats, p);
}
const names = (s: number): string => `N${s}`;
const color = (s: number): string => '#000000';

describe('the result rows of a federation win', () => {
  // seats 0, 1, 2 are one federation (root 0) that wins; seat 3 is a single nation with the highest score; seat 4 is a tribe
  const m = view(1, { score: [21, 700, 380, 1291, 5], landStd: [1, 2, 3, 4, 5], group: [0, 0, 0, 3, 4] });
  const rows = resultRows(m, 4, 0, names, color, () => 0);

  it('ranks by score alone and marks every member of the winning group as a winner', () => {
    expect(rows.map((r) => r.seat)).toEqual([3, 1, 2, 0]);
    expect(rows.map((r) => r.winner)).toEqual([false, true, true, true]);
  });

  it('a single winner still comes first (as before)', () => {
    const one = view(2, { score: [50, 70, 10, 999, 0], landStd: [1, 1, 1, 1, 1], group: [0, 1, 2, 3, 4] });
    const r = resultRows(one, 4, 0, names, color, () => 0);
    expect(r[0]).toMatchObject({ seat: 1, winner: true });
    expect(r.filter((x) => x.winner).length).toBe(1);
  });
});

describe('texts', () => {
  it('the refusal for a wrong troop count names the cap it is given, in both languages', () => {
    setStrictI18n(true);
    try {
      for (const lang of ['sv', 'en'] as const) {
        setLanguage(lang);
        const text = t(rejectKey(REJECT_HELI_BAD_TROOPS), { code: REJECT_HELI_BAD_TROOPS, max: 660 });
        expect(text).toContain('660');
        expect(text).not.toContain('600');
      }
    } finally {
      setLanguage('sv');
      setStrictI18n(false);
    }
  });

  it('"seen in 1 square", never "1 squares", and the alliance badge is "All" in English', () => {
    setLanguage('en');
    try {
      expect(tn('deploy.info', 'deploy.info.one', 1, { s: 14, fuel: 28, exposed: 1 })).toBe('Flight 14 s, fuel 28 cells, seen in 1 square');
      expect(tn('deploy.info', 'deploy.info.one', 3, { s: 14, fuel: 28, exposed: 3 })).toContain('3 squares');
      expect(t('diplo.badge.alliance')).toBe('All');
    } finally {
      setLanguage('sv');
    }
    expect(tn('deploy.info', 'deploy.info.one', 1, { s: 14, fuel: 28, exposed: 1 })).toContain('1 ruta');
  });
});
