// M18d-2: the pure model of the research panel (src/ui/techModel.ts) against the real sim: the status of every cell per situation (the REASON is the validateResearch
// answer), the effect lines built from the TECH_FX table, the button states, the cancel confirmation, the watcher, and the discounted upgrade price (shown == debited).
import { describe, expect, it } from 'vitest';
import {
  TECH_NAME_KEYS,
  TechWatcher,
  buildTechCells,
  cancelState,
  runningResearch,
  techCell,
  techEffectParts,
  techEffectText,
  type RunningResearch,
} from '../../src/ui/techModel';
import { BreakConfirm } from '../../src/ui/diploModel';
import { cityInfo } from '../../src/ui/cityViewModel';
import { selectionInfo } from '../../src/ui/structureInfo';
import { getLanguage, setLanguage, t, formatGold } from '../../src/ui/i18n';
import { techRefusalKey } from '../../src/ui/techReasons';
import {
  REJECT_NONE,
  REJECT_TECH_BUSY,
  REJECT_TECH_GOLD,
  REJECT_TECH_NOT_ACTIVE,
  REJECT_TECH_PREREQ,
  TECH_FX,
  TECH_FX_CHANNELS,
  TECH_PRICE_GOLD,
  TECH_TICKS,
  cancelResearchBody,
  researchBody,
  validateCancelResearch,
  validateResearch,
} from '../../src/sim/public';
import { withId } from '../../src/sim/intents';
import { MILLI_GOLD_PER_GOLD } from '../../src/sim/rules';
import { GOLD_DISPLAY_FACTOR } from '../../src/ui/uiConfig';
import { applyIntent, step } from '../../src/sim/step';
import { StateView } from '../../src/sim/view';
import type { GameState } from '../../src/sim/state';
import { STRUCT_CITY, upgradePriceGold } from '../../src/sim/structureRules';
import { landState } from '../sim/helpers/worlds';

let ids = 1;
const send = (s: GameState, body: Parameters<typeof withId>[0]): number => applyIntent(s, withId(body, ids++));
const idle = (s: GameState, n: number): void => {
  for (let i = 0; i < n; i++) step(s, { turn: s.tick, intents: [] });
};
const rich = (): GameState => {
  const s = landState(40, 20, { seats: 2, players: 2 });
  for (let c = 0; c < 40 * 20; c++) s.owner[c] = c % 40 < 20 ? 1 : 2;
  s.gold[1] = 100000 * MILLI_GOLD_PER_GOLD;
  s.gold[2] = 100000 * MILLI_GOLD_PER_GOLD;
  s.tick = 100;
  return s;
};
const view = (s: GameState): StateView => {
  const v = new StateView(s);
  v.refresh();
  return v;
};

describe('the status of the 16 cells', () => {
  it('a fresh rich seat: four first steps available, twelve locked behind their prerequisite; every canResearch IS validateResearch', () => {
    const s = rich();
    const v = view(s);
    const cells = buildTechCells(v, 0);
    expect(cells.length).toBe(16);
    cells.forEach((c, tech) => {
      expect(c.tech).toBe(tech);
      expect(c.canResearch).toBe(validateResearch(v, 0, tech) === REJECT_NONE);
      expect(c.reason).toBe(validateResearch(v, 0, tech));
      expect(c.priceGold).toBe(TECH_PRICE_GOLD[tech]);
      expect(c.ticks).toBe(TECH_TICKS[tech]);
      if (tech % 4 === 0) expect([c.status, c.reason]).toEqual(['available', REJECT_NONE]);
      else expect([c.status, c.reason, c.prereq]).toEqual(['locked', REJECT_TECH_PREREQ, tech - 1]);
    });
  });

  it('too little gold: a first step is blocked with the gold reason; a later step stays locked (the prerequisite is named first)', () => {
    const s = rich();
    s.gold[1] = (TECH_PRICE_GOLD[0] as number) * MILLI_GOLD_PER_GOLD - 1;
    const cells = buildTechCells(view(s), 0);
    expect([cells[0]?.status, cells[0]?.reason, cells[0]?.canResearch]).toEqual(['blocked', REJECT_TECH_GOLD, false]);
    expect(cells[1]?.status).toBe('locked');
  });

  it('a running research: active with the time left and a growing bar, the others blocked as busy; done after the clock; the next step becomes available', () => {
    const s = rich();
    expect(send(s, researchBody(0, 0))).toBe(REJECT_NONE);
    idle(s, 1);
    let v = view(s);
    let c = techCell(v, 0, 0);
    expect(c.status).toBe('active');
    expect(c.ticksLeft).toBe((TECH_TICKS[0] as number) - 1);
    expect(techCell(v, 0, 4)).toMatchObject({ status: 'blocked', reason: REJECT_TECH_BUSY, canResearch: false });
    expect(techCell(v, 0, 1).status).toBe('locked');
    idle(s, 300);
    v = view(s);
    expect(techCell(v, 0, 0).progressPct).toBeGreaterThan(c.progressPct);
    idle(s, TECH_TICKS[0] as number);
    v = view(s);
    c = techCell(v, 0, 0);
    expect([c.status, c.progressPct, c.canResearch]).toEqual(['done', 100, false]);
    expect(techCell(v, 0, 1)).toMatchObject({ status: 'available', canResearch: true });
    // the other seat is untouched
    expect(techCell(v, 1, 0).status).toBe('available');
  });
});

describe('the effect lines come from the table', () => {
  it('for all 16 techs the parts are exactly the non-zero TECH_FX values and the text carries each of them, in both languages', () => {
    const saved = getLanguage();
    for (const lang of ['sv', 'en'] as const) {
      setLanguage(lang);
      for (let tech = 0; tech < 16; tech++) {
        const row = Array.from({ length: TECH_FX_CHANNELS }, (_, c) => TECH_FX[tech * TECH_FX_CHANNELS + c] as number);
        const parts = techEffectParts(tech);
        expect(parts.map((p) => [p.channel, p.n])).toEqual(row.map((n, c) => [c, n]).filter((x) => x[1] !== 0));
        expect(parts.length).toBeGreaterThan(0);
        const text = techEffectText(tech);
        for (const p of parts) expect(text).toContain(String(p.n));
        expect(text).not.toContain('{n}');
        expect(t(TECH_NAME_KEYS[tech]!).length).toBeGreaterThan(2);
      }
    }
    // spot: Integrated Defence (15) gives walls 10 and salvo 17 in the table, so the line has both numbers and two parts
    expect(techEffectParts(15).map((p) => p.n)).toEqual([10, 17]);
    setLanguage(saved);
  });

  it('the price is shown through formatGold: sim gold times GOLD_DISPLAY_FACTOR', () => {
    expect(formatGold(350).replace(/\s/g, '')).toBe(String(350 * GOLD_DISPLAY_FACTOR));
  });
});

describe('cancel, the confirmation and the running research', () => {
  it('cancelState IS validateCancelResearch; nothing runs -> refused as not active; a click arms, the second click confirms, time disarms', () => {
    const s = rich();
    expect(cancelState(view(s), 0)).toEqual({ enabled: false, reason: REJECT_TECH_NOT_ACTIVE });
    expect(techRefusalKey(REJECT_TECH_NOT_ACTIVE)).toBe('reject.tech.notActive');
    send(s, researchBody(0, 0));
    const v = view(s);
    expect(cancelState(v, 0)).toEqual({ enabled: validateCancelResearch(v, 0) === REJECT_NONE, reason: REJECT_NONE });
    const confirm = new BreakConfirm();
    expect(confirm.click(0, 10, 6)).toBe(false); // arms
    expect(confirm.armed()).toBe(0);
    expect(confirm.click(0, 12, 6)).toBe(true); // confirms
    expect(confirm.click(0, 20, 6)).toBe(false);
    expect(confirm.expire(27)).toBe(true); // 20 + 6 passed
    expect(confirm.armed()).toBe(-1);
  });

  it('cancel gives no gold back (the panel warns about it): the purse after the cancel is the purse after the start', () => {
    const s = rich();
    send(s, researchBody(0, 0));
    const after = s.gold[1] as number;
    expect(after).toBe(100000 * MILLI_GOLD_PER_GOLD - (TECH_PRICE_GOLD[0] as number) * MILLI_GOLD_PER_GOLD);
    expect(send(s, cancelResearchBody(0))).toBe(REJECT_NONE);
    expect(s.gold[1]).toBe(after);
    expect(techCell(view(s), 0, 0).status).toBe('available');
  });

  it('runningResearch reads the tech and the ticks left into the object it is given', () => {
    const s = rich();
    const out: RunningResearch = { tech: 99, ticksLeft: 99 };
    expect(runningResearch(view(s), 0, out)).toBe(out);
    expect(out).toEqual({ tech: -1, ticksLeft: 0 });
    send(s, researchBody(0, 4));
    idle(s, 10);
    runningResearch(view(s), 0, out);
    expect(out.tech).toBe(4);
    expect(out.ticksLeft).toBe((TECH_TICKS[4] as number) - 10);
  });
});

describe('the watcher', () => {
  it('learns the mask on the first look, news once when a tech is finished, none for a cancel, none for the other seat', () => {
    const s = rich();
    const news: number[] = [];
    const w = new TechWatcher((tech) => news.push(tech));
    w.update(view(s), 0);
    send(s, researchBody(0, 0));
    send(s, researchBody(1, 4));
    idle(s, 5);
    w.update(view(s), 0);
    expect(news).toEqual([]);
    idle(s, TECH_TICKS[0] as number);
    w.update(view(s), 0);
    expect(news).toEqual([0]);
    w.update(view(s), 0);
    expect(news).toEqual([0]); // once
    send(s, researchBody(0, 1));
    idle(s, 3);
    send(s, cancelResearchBody(0));
    idle(s, 2000);
    w.update(view(s), 0);
    expect(news).toEqual([0]); // a cancelled research is no news
    // a watcher that starts late only learns
    const late: number[] = [];
    const w2 = new TechWatcher((tech) => late.push(tech));
    w2.update(view(s), 0);
    expect(late).toEqual([]);
  });
});

describe('the upgrade price shown is the price debited (M18d-2)', () => {
  it('the selection panel and the city view show the discounted price after the upgrade techs, and it is exactly what the Upgrade takes', () => {
    const cases: [number, number][] = [
      [0, 0],
      [0b11, 5],
      [0b1111, 15],
    ];
    for (const [mask, discount] of cases) {
      const s = rich();
      const id = s.structures.add(STRUCT_CITY, 1, 5 * 40 + 5, 0); // finished long ago
      s.tick = 100000; // the City was built long ago
      s.match.setTechMask(1, mask);
      const full = upgradePriceGold(STRUCT_CITY, 2);
      const v = view(s);
      const sel = selectionInfo(v, 0, id);
      const city = cityInfo(v, 0, id);
      const expectedMilli = Math.floor((full * MILLI_GOLD_PER_GOLD * (100 - discount)) / 100);
      expect((sel?.upgradePrice as number) * MILLI_GOLD_PER_GOLD).toBeCloseTo(expectedMilli, 6);
      expect((city?.upgradePrice as number) * MILLI_GOLD_PER_GOLD).toBeCloseTo(expectedMilli, 6);
      const before = s.gold[1] as number;
      expect(send(s, { kind: 'Upgrade', seat: 0, structure: id })).toBe(REJECT_NONE);
      expect(before - (s.gold[1] as number)).toBe(expectedMilli); // debited == shown
      if (discount === 15) expect(expectedMilli).toBeLessThan(full * MILLI_GOLD_PER_GOLD);
    }
  });
});
