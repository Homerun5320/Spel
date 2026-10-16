// M20a-2 in headless Chromium (software WebGL2): the nation labels and the front arrows over the real world. The labels: hidden when the whole globe is in view, small at middle
// distance, full when zoomed in; never more than 32, never two boxes overlapping, never outside the window (three window sizes, both languages); a still picture makes no DOM
// write; the key N switches labels and arrows together and the choice is a preference. The arrows: one per running attack, one draw call at most, gone when the attack ends.
// Screenshots: test-results/shots/labels-*.png and fronts-*.png (LOOK at them).
import fs from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { OUT_DIR, launchBrowser, openPage } from '../scripts/shot.mjs';
import { cellToLatLon } from '../src/render/transforms';

let browser: Browser;
const baseUrl = inject('baseUrl');
const SHOT_DIR = path.join(OUT_DIR, 'shots');

beforeAll(async () => {
  ({ browser } = await launchBrowser());
  fs.mkdirSync(SHOT_DIR, { recursive: true });
});
afterAll(async () => {
  await browser?.close();
});

interface Box {
  seat: number;
  x: number;
  y: number;
  w: number;
  h: number;
}
interface LabelState {
  shown: Array<{ seat: number; text: string; x: number; y: number; w: number; h: number; scale: number }>;
  writes: number;
  on: boolean;
}
const ev = <R>(page: Page, fn: string, ...args: unknown[]): Promise<R> => page.evaluate(([f, a]) => (window as any).__test[f as string](...(a as unknown[])), [fn, args] as const) as Promise<R>;
const shot = async (page: Page, name: string): Promise<void> => {
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`), type: 'png' });
};

/** The boxes of the visible label elements as the browser lays them out (window pixels). */
async function domBoxes(page: Page): Promise<Box[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="nation-label"]:not([hidden])')).map((el) => {
      const r = el.getBoundingClientRect();
      return { seat: Number((el as HTMLElement).dataset.seat), x: r.left, y: r.top, w: r.width, h: r.height };
    }),
  );
}

function expectClean(boxes: Box[], vw: number, vh: number): void {
  for (const b of boxes) {
    expect(b.x, `seat ${b.seat} left`).toBeGreaterThanOrEqual(-0.5);
    expect(b.y, `seat ${b.seat} top`).toBeGreaterThanOrEqual(-0.5);
    expect(b.x + b.w, `seat ${b.seat} right`).toBeLessThanOrEqual(vw + 0.5);
    expect(b.y + b.h, `seat ${b.seat} bottom`).toBeLessThanOrEqual(vh + 0.5);
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i] as Box;
      const b = boxes[j] as Box;
      const overlap = a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;
      expect(overlap, `labels of seats ${a.seat} and ${b.seat} overlap`).toBe(false);
    }
  }
}

/** The player spawns on the old world and the match runs on until the AI nations have spawned and grown a little. */
async function startMatch(page: Page, ticks = 330): Promise<void> {
  await ev(page, 'setView', { lat: 48.5, lon: 11, distKm: 2600, heading: 0, tilt: 0 });
  const p0 = await ev<{ x: number; y: number }>(page, 'project', 48.5, 11);
  await page.mouse.click(p0.x, p0.y);
  await ev(page, 'advance', 0.1, ticks);
}

const VIEWPORTS = [
  { width: 960, height: 540 },
  { width: 1280, height: 720 },
  { width: 640, height: 400 },
] as const;

describe('nation labels', () => {
  for (const vp of VIEWPORTS) {
    it(`at ${vp.width}x${vp.height}: at most 32, none overlapping, none outside, hidden at globe distance, a still picture writes nothing`, async () => {
      const { page, consoleMessages } = await openPage(browser, baseUrl, `test=1&seed=7&labels=1&w=${vp.width}&h=${vp.height}`, vp);
      try {
        await startMatch(page);
        // the whole globe in view: no label
        await ev(page, 'setView', { lat: 20, lon: 10, distKm: 20000, heading: 0, tilt: 0 });
        await ev(page, 'render', 0);
        let st = await ev<LabelState>(page, 'labels');
        expect(st.on).toBe(true);
        expect(st.shown, 'no label at globe distance').toHaveLength(0);
        expect(await domBoxes(page)).toHaveLength(0);
        // middle distance over the old world
        await ev(page, 'setView', { lat: 30, lon: 15, distKm: 5200, heading: 0, tilt: 0 });
        await ev(page, 'render', 0);
        st = await ev<LabelState>(page, 'labels');
        expect(st.shown.length).toBeGreaterThanOrEqual(2);
        expect(st.shown.length).toBeLessThanOrEqual(32);
        const boxes = await domBoxes(page);
        expect(boxes).toHaveLength(st.shown.length);
        expectClean(boxes, vp.width, vp.height);
        const panels = await page.evaluate(() =>
          Array.from(document.querySelectorAll('.hud-panel'))
            .map((el) => el.getBoundingClientRect())
            .filter((r) => r.width > 0 && r.height > 0)
            .map((r) => ({ x: r.left, y: r.top, w: r.width, h: r.height })),
        );
        for (const b of boxes) {
          for (const r of panels) {
            expect(b.x < r.x + r.w && r.x < b.x + b.w && b.y < r.y + r.h && r.y < b.y + b.h, `label of seat ${b.seat} lies on a HUD panel`).toBe(false);
          }
        }
        // the boxes the layout computed are the ones the browser drew
        for (const l of st.shown) {
          const b = boxes.find((x) => x.seat === l.seat) as Box;
          expect(Math.abs(b.x - l.x)).toBeLessThan(1.5);
          expect(Math.abs(b.y - l.y)).toBeLessThan(1.5);
          expect(Math.abs(b.w - l.w)).toBeLessThan(1.5);
        }
        if (vp.width === 960) await shot(page, `labels-mid-${vp.width}x${vp.height}`);
        // a still picture: another render with nothing moved writes nothing
        const before = (await ev<LabelState>(page, 'labels')).writes;
        await ev(page, 'settle', 0.01, 3);
        expect((await ev<LabelState>(page, 'labels')).writes).toBe(before);
      } finally {
        expect(consoleMessages).toEqual([]);
        await page.close();
      }
    });
  }

  for (const lang of ['sv', 'en'] as const) {
    it(`three zoom levels in ${lang}: small at middle distance, bigger when zoomed in; the key N switches them off and on and the preference remembers it`, async () => {
      const vp = { width: 960, height: 540 };
      const { page, consoleMessages } = await openPage(browser, baseUrl, `test=1&seed=7&labels=1&lang=${lang}&w=960&h=540`, vp);
      try {
        await startMatch(page);
        const scales: number[] = [];
        for (const [name, view] of [
          ['far', { lat: 30, lon: 15, distKm: 7600 }],
          ['mid', { lat: 40, lon: 12, distKm: 4200 }],
          ['near', { lat: 48, lon: 11, distKm: 1400 }],
        ] as const) {
          await ev(page, 'setView', { ...view, heading: 0, tilt: 0 });
          await ev(page, 'render', 0);
          const st = await ev<LabelState>(page, 'labels');
          expect(st.shown.length, name).toBeGreaterThanOrEqual(1);
          scales.push(Math.max(...st.shown.map((l) => l.scale)));
          expectClean(await domBoxes(page), vp.width, vp.height);
          await shot(page, `labels-${name}-${lang}`);
        }
        expect(scales[0]).toBeLessThan(1);
        expect(scales[2]).toBe(1);
        // the key N
        expect(await ev<string>(page, 'language')).toBe(lang);
        await page.keyboard.press('n');
        await ev(page, 'render', 0);
        expect((await ev<LabelState>(page, 'labels')).on).toBe(false);
        expect(await domBoxes(page)).toHaveLength(0);
        await page.keyboard.press('n');
        await ev(page, 'render', 0);
        const back = await ev<LabelState>(page, 'labels');
        expect(back.on).toBe(true);
        expect(back.shown.length).toBeGreaterThanOrEqual(1);
      } finally {
        expect(consoleMessages).toEqual([]);
        await page.close();
      }
    });
  }

  it('with the HUD on, no label lies on a HUD panel (the layout keeps them clear) and the own nation is labelled when zoomed in', async () => {
    const { page, consoleMessages } = await openPage(browser, baseUrl, 'test=1&seed=7&hud=1&labels=1');
    try {
      await startMatch(page);
      for (const view of [
        { lat: 48, lon: 11, distKm: 1400 },
        { lat: 40, lon: 12, distKm: 4200 },
        { lat: 30, lon: 15, distKm: 7600 },
      ]) {
        await ev(page, 'setView', { ...view, heading: 0, tilt: 0 });
        await ev(page, 'render', 0);
        const boxes = await domBoxes(page);
        const panels = await page.evaluate(() =>
          Array.from(document.querySelectorAll('.hud-panel'))
            .map((el) => el.getBoundingClientRect())
            .filter((r) => r.width > 0 && r.height > 0)
            .map((r) => ({ x: r.left, y: r.top, w: r.width, h: r.height })),
        );
        expect(panels.length).toBeGreaterThan(2);
        expectClean(boxes, 960, 540);
        for (const b of boxes) {
          for (const r of panels) {
            expect(b.x < r.x + r.w && r.x < b.x + b.w && b.y < r.y + r.h && r.y < b.y + b.h, `label of seat ${b.seat} lies on a HUD panel at ${view.distKm} km`).toBe(false);
          }
        }
        if (view.distKm === 1400) expect(boxes.some((b) => b.seat === 0)).toBe(true);
      }
    } finally {
      expect(consoleMessages).toEqual([]);
      await page.close();
    }
  });

  it('is listed in the help overlay (generated from the registry) with its key', async () => {
    const { page } = await openPage(browser, baseUrl, 'test=1&seed=7&hud=1&labels=1');
    try {
      const keys = await ev<Array<{ id: string; keys: string[]; hidden: boolean }>>(page, 'hotkeys');
      const entry = keys.find((k) => k.id === 'labels');
      expect(entry).toBeDefined();
      expect(entry?.keys).toEqual(['n']);
      expect(entry?.hidden).toBe(false);
    } finally {
      await page.close();
    }
  });
});

interface FrontState {
  arrows: Array<{ id: number; attacker: number; target: number; cell: number; lat: number; lon: number; dirEast: number; dirNorth: number; own: boolean }>;
  count: number;
  fade: number;
  visible: boolean;
}

describe('front arrows', () => {
  for (const lang of ['sv', 'en'] as const) {
    it(`one arrow per running attack, one draw call, faded out at globe distance, gone when the attack ends (${lang})`, async () => {
      const { page, consoleMessages } = await openPage(browser, baseUrl, `test=1&seed=7&hud=1&labels=1&ai=0&lang=${lang}`);
      try {
        await startMatch(page, 270);
        await ev(page, 'give', 0, { gold: 90000, troops: 5000 });
        const capital = ((await ev<{ capitals: number[] }>(page, 'seatCells')).capitals[0]) as number;
        const at = cellToLatLon(capital, 1024, 512);
        await ev(page, 'setView', { lat: at.lat, lon: at.lon, distKm: 1300, heading: 0, tilt: 0 });
        // nothing attacks yet: no arrow, no draw call
        await ev(page, 'render', 0);
        expect((await ev<FrontState>(page, 'fronts')).count).toBe(0);
        const callsIdle = (await ev<{ drawCalls: number }>(page, 'info')).drawCalls;
        // the player attacks the unowned land around: one attack, one arrow
        await ev(page, 'submit', { kind: 'Attack', seat: 0, target: 0, pct: 60 });
        await ev(page, 'advance', 0.1, 14);
        await ev(page, 'render', 0);
        const f = await ev<FrontState>(page, 'fronts');
        expect(f.count).toBe(1);
        expect(f.arrows).toHaveLength(1);
        expect(f.arrows[0]).toMatchObject({ attacker: 1, target: 0, own: true });
        expect(Math.hypot((f.arrows[0] as { dirEast: number }).dirEast, (f.arrows[0] as { dirNorth: number }).dirNorth)).toBeCloseTo(1, 3);
        expect(f.visible).toBe(true);
        expect(f.fade).toBeGreaterThan(0.99);
        // the draw call: on against off differs by exactly the layer's one while it shows
        const callsOn = (await ev<{ drawCalls: number }>(page, 'info')).drawCalls;
        await ev(page, 'frontLayer', false);
        await ev(page, 'render', 0);
        const callsOff = (await ev<{ drawCalls: number }>(page, 'info')).drawCalls;
        await ev(page, 'frontLayer', true);
        expect(callsOn - callsOff).toBe(1);
        expect(callsOff).toBeGreaterThanOrEqual(callsIdle - 1);
        const tip = f.arrows[0] as { lat: number; lon: number };
        await ev(page, 'setView', { lat: tip.lat - 0.6, lon: tip.lon, distKm: 900, heading: 0, tilt: 0 });
        await ev(page, 'render', 0);
        await shot(page, `fronts-near-${lang}`);
        // the whole globe in view: faded out, no draw call
        await ev(page, 'setView', { lat: at.lat, lon: at.lon, distKm: 20000, heading: 0, tilt: 0 });
        await ev(page, 'render', 0);
        const far = await ev<FrontState>(page, 'fronts');
        expect(far.count).toBe(1);
        expect(far.fade).toBe(0);
        expect(far.visible).toBe(false);
        // called off: the arrow goes with the next table
        await ev(page, 'setView', { lat: at.lat, lon: at.lon, distKm: 1300, heading: 0, tilt: 0 });
        await ev(page, 'submit', { kind: 'CancelAttack', seat: 0, target: 0 });
        await ev(page, 'advance', 0.1, 24);
        await ev(page, 'render', 0);
        const gone = await ev<FrontState>(page, 'fronts');
        expect(gone.count).toBe(0);
        expect(gone.visible).toBe(false);
      } finally {
        expect(consoleMessages).toEqual([]);
        await page.close();
      }
    });
  }
});
