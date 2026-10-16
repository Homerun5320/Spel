// M20a-lite in headless Chromium: the help overlay generated from the hotkey registry, the right click through the command resolver, and the top bar
// (values equal the sim, no DOM writes at rest, no overlap in three window sizes with the longest strings, the win meter follows the MatchView).
// Screenshots go to test-results/shots/m20a-*.png.
import fs from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { OUT_DIR, launchBrowser, openPage } from '../scripts/shot.mjs';
import { TABLES, formatGold, formatGoldRate, formatShownGold, setLanguage, t, type Lang } from '../src/ui/i18n';
import { cellToLatLon } from '../src/render/transforms';
import { STRUCT_CITY } from '../src/sim/public';

let browser: Browser;
const baseUrl = inject('baseUrl');
const SHOT_DIR = process.env.M20A_SHOTS ?? path.join(OUT_DIR, 'shots');
beforeAll(async () => {
  ({ browser } = await launchBrowser());
  fs.mkdirSync(SHOT_DIR, { recursive: true });
});
afterAll(async () => {
  await browser?.close();
  setLanguage('sv');
});

type Msg = Array<{ type: string; text: string }>;
const T = (page: Page) => ({
  state: (): Promise<any> => page.evaluate(() => (window as any).__test.state()),
  props: (): Promise<any> => page.evaluate(() => (window as any).__test.props()),
  advance: (dt: number, ticks: number): Promise<void> => page.evaluate(([d, n]) => (window as any).__test.advance(d, n), [dt, ticks] as const),
  settle: (dt = 0, n = 2): Promise<void> => page.evaluate(([d, k]) => (window as any).__test.settle(d, k), [dt, n] as const),
  render: (): Promise<void> => page.evaluate(() => (window as any).__test.render()),
  view: (v: Record<string, number>): Promise<void> => page.evaluate((x) => (window as any).__test.setView(x), v),
  project: (lat: number, lon: number): Promise<{ x: number; y: number; inView: boolean; facing: boolean }> => page.evaluate(([a, o]) => (window as any).__test.project(a, o), [lat, lon] as const),
  cells: (): Promise<{ capitals: number[] }> => page.evaluate(() => (window as any).__test.seatCells()),
  submit: (b: unknown): Promise<void> => page.evaluate((x) => (window as any).__test.submit(x), b),
  give: (gold: number): Promise<void> => page.evaluate((g) => (window as any).__test.give(0, { gold: g }), gold),
  hotkeys: (): Promise<Array<{ id: string; keys: string[]; scope: string; hidden: boolean }>> => page.evaluate(() => (window as any).__test.hotkeys()),
  helpOpen: (): Promise<boolean> => page.evaluate(() => (window as any).__test.helpOpen()),
  matchInfo: (): Promise<any> => page.evaluate(() => (window as any).__test.matchInfo()),
});

const START = { lat: 48.5, lon: 11 };
const VIEW = { lat: 47, lon: 10, distKm: 2600, heading: 0, tilt: 0 };
const WIDTH = 1024;
const HEIGHT = 512;

async function spawned(query: string, viewport = { width: 960, height: 540 }, gold = 6000, past = 0): Promise<{ page: Page; messages: Msg; capital: number }> {
  const { page, consoleMessages } = await openPage(browser, baseUrl, query, viewport);
  const tt = T(page);
  await tt.view(VIEW);
  const p = await tt.project(START.lat, START.lon);
  await page.mouse.click(p.x, p.y);
  await tt.advance(0.1, 5);
  if (gold > 0) await tt.give(gold);
  await tt.advance(0.1, 4 + past);
  const { capitals } = await tt.cells();
  expect((await tt.state()).local.spawned).toBe(true);
  return { page, messages: consoleMessages, capital: capitals[0] as number };
}
const shot = async (page: Page, name: string): Promise<void> => {
  await T(page).render();
  fs.writeFileSync(path.join(SHOT_DIR, `m20a-${name}.png`), await page.screenshot({ type: 'png' }));
};
const rect = (page: Page, sel: string): Promise<{ left: number; top: number; right: number; bottom: number; w: number; h: number } | null> =>
  page.evaluate((s) => {
    const e = document.querySelector(s);
    if (!(e instanceof HTMLElement) || e.hidden || e.getClientRects().length === 0) return null;
    const r = e.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height };
  }, sel);
const tid = (id: string): string => `[data-testid="${id}"]`;
const overlaps = (a: { left: number; top: number; right: number; bottom: number }, b: { left: number; top: number; right: number; bottom: number }): boolean => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

describe('the help overlay is the registry', () => {
  it('? opens it, every listed entry is a row and every row an entry; Esc and ? close it; keys are dead behind it', async () => {
    const { page, messages } = await spawned('test=1&seed=7&hud=1&ai=0');
    try {
      const tt = T(page);
      expect(await tt.helpOpen()).toBe(false);
      await page.keyboard.press('?');
      expect(await tt.helpOpen()).toBe(true);
      const rows = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid="help-row"]')).map((r) => ({ id: (r as HTMLElement).dataset.id as string, text: r.textContent ?? '' })));
      const entries = await tt.hotkeys();
      expect(rows.map((r) => r.id).sort()).toEqual(entries.filter((e) => !e.hidden).map((e) => e.id).sort());
      expect(entries.filter((e) => e.hidden).map((e) => e.id).sort()).toEqual(['chase', 'exposure']);
      // the registry holds the game's keys: the old match keys, the stack keys, the F-keys and ?
      expect(entries.map((e) => e.id)).toEqual(expect.arrayContaining(['focus-capital', 'build', 'escape', 'pause', 'slower', 'faster', 'commit-down', 'commit-up', 'help', 'overlay', 'devpanel']));
      for (const r of rows) expect(r.text.length, r.id).toBeGreaterThan(3);
      // dead behind the overlay: the build key does not start the placement mode, Esc closes the overlay and does NOT open the pause menu
      await page.keyboard.press('1');
      expect((await tt.props()).placing).toBe(0);
      await shot(page, 'help-960x540-sv');
      await page.keyboard.press('Escape');
      expect(await tt.helpOpen()).toBe(false);
      expect(await page.locator('[data-testid="pause-menu"]').isVisible()).toBe(false);
      await page.keyboard.press('?');
      expect(await tt.helpOpen()).toBe(true);
      await page.keyboard.press('?');
      expect(await tt.helpOpen()).toBe(false);
      // the keys of the game still work through the registry: the space bar pauses, F3 shows the overlay, 1 starts the placement
      const paused0 = (await tt.state()).paused;
      await page.keyboard.press(' ');
      expect((await tt.state()).paused).toBe(!paused0);
      await page.keyboard.press(' ');
      await page.keyboard.press('1');
      expect((await tt.props()).placing).toBe(1);
      await page.keyboard.press('Escape');
      expect((await tt.props()).placing).toBe(0);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('a modal keeps ? out: behind the pause menu the overlay does not open', async () => {
    const { page, messages } = await spawned('test=1&seed=7&hud=1&ai=0');
    try {
      const tt = T(page);
      await page.keyboard.press('Escape'); // empty stack: the pause menu
      expect(await page.locator('[data-testid="pause-menu"]').isVisible()).toBe(true);
      await page.keyboard.press('?');
      expect(await tt.helpOpen()).toBe(false);
      await page.keyboard.press('Escape');
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  for (const [w, h] of [
    [960, 540],
    [540, 960],
  ] as const) {
    for (const lang of ['sv', 'en'] as const satisfies readonly Lang[]) {
      it(`the box is small and inside the window at ${w}x${h} in ${lang}`, async () => {
        const { page, messages } = await spawned(`test=1&seed=7&hud=1&ai=0&w=${w}&h=${h}&lang=${lang}`, { width: w, height: h });
        try {
          await page.keyboard.press('?');
          const card = await rect(page, '.help-card');
          expect(card).not.toBeNull();
          expect(card!.left).toBeGreaterThanOrEqual(0);
          expect(card!.top).toBeGreaterThanOrEqual(0);
          expect(card!.right).toBeLessThanOrEqual(w);
          expect(card!.bottom).toBeLessThanOrEqual(h);
          expect(card!.w * card!.h, 'not full screen').toBeLessThan(w * h * 0.6);
          const clipped = await page.evaluate(() => {
            const c = document.querySelector('.help-card') as HTMLElement;
            return c.scrollWidth > c.clientWidth + 1 || c.scrollHeight > c.clientHeight + 1;
          });
          expect(clipped).toBe(false);
          expect(await page.evaluate(() => document.querySelector('[data-testid="help-title"]')?.textContent)).toBe(TABLES[lang]['help.title']);
          await shot(page, `help-${w}x${h}-${lang}`);
          expect(messages).toEqual([]);
        } finally {
          await page.close();
        }
      });
    }
  }
});

describe('the right click goes through the command resolver', () => {
  async function scenario(act: (page: Page, capital: number) => Promise<void>): Promise<{ troopsQt: number; rejects: number; selection: any; placing: number; structures: number }> {
    const { page, capital } = await spawned('test=1&seed=7&ai=0&hud=1', { width: 960, height: 540 }, 6000, 210);
    try {
      const tt = T(page);
      await tt.submit({ kind: 'Build', seat: 0, type: STRUCT_CITY, cell: capital });
      await tt.advance(0.1, 160);
      await act(page, capital);
      await tt.advance(0.1, 30);
      const s = await tt.state();
      const p = await tt.props();
      return { troopsQt: s.local.troopsQt, rejects: s.rejects, selection: p.selection, placing: p.placing, structures: p.total };
    } finally {
      await page.close();
    }
  }
  const llOf = (cell: number): { lat: number; lon: number } => cellToLatLon(cell, WIDTH, HEIGHT);
  // a view 1000 km away: the sim cells are 39 km, so a click 220 px away is another cell, not a neighbour of the City
  const closeUp = (page: Page, cell: number): Promise<void> => {
    const at = llOf(cell);
    return T(page).view({ lat: at.lat, lon: at.lon, distKm: 1000, heading: 0, tilt: 0 });
  };
  const clickCell = async (page: Page, cell: number, button: 'left' | 'right', dx = 0, dy = 0): Promise<void> => {
    const at = llOf(cell);
    const p = await T(page).project(at.lat, at.lon);
    await page.mouse.click(p.x + dx, p.y + dy, { button });
  };

  it('with a structure selected a right click on the ground goes to the resolver (deselects, sends no intent); with nothing selected it attacks; in the placement mode it only leaves the mode', async () => {
    const control = await scenario(async (page, capital) => {
      await closeUp(page, capital);
      await T(page).settle();
      await clickCell(page, capital, 'left');
      expect((await T(page).props()).selection.panelVisible).toBe(true);
    });
    expect(control.selection.panelVisible).toBe(true);

    const selected = await scenario(async (page, capital) => {
      await closeUp(page, capital);
      await T(page).settle();
      await clickCell(page, capital, 'left');
      expect((await T(page).props()).selection.panelVisible).toBe(true);
      await clickCell(page, capital, 'right', 220, 60); // ground away from the City
      await T(page).settle();
    });
    expect(selected.selection.panelVisible, 'the right click on the ground deselected').toBe(false);
    expect(selected.troopsQt, 'no attack was sent: the troops are those of the control').toBe(control.troopsQt);
    expect(selected.rejects).toBe(control.rejects);

    const attack = await scenario(async (page, capital) => {
      await T(page).view(VIEW);
      await T(page).settle();
      const p = await T(page).project(47, 6); // land outside your territory
      expect(p.inView && p.facing).toBe(true);
      await page.mouse.click(p.x, p.y, { button: 'right' });
    });
    expect(attack.rejects > control.rejects || attack.troopsQt < control.troopsQt, `a right click with nothing marked attacks: troops ${attack.troopsQt} vs ${control.troopsQt}, rejects ${attack.rejects} vs ${control.rejects}`).toBe(true);

    const placing = await scenario(async (page, capital) => {
      await closeUp(page, capital);
      await T(page).settle();
      await page.keyboard.press('1');
      expect((await T(page).props()).placing).toBe(1);
      await clickCell(page, capital, 'right', 220, 60);
      await T(page).settle();
    });
    expect(placing.placing, 'the right click left the placement mode').toBe(0);
    expect(placing.troopsQt).toBe(control.troopsQt); // no intent: same sim as the control
    expect(placing.structures).toBe(control.structures);
  }, 150_000);
});

describe('the top bar', () => {
  it('shows the sim values (strings from the formatters), writes nothing at rest and keeps the testids', async () => {
    const { page, messages } = await spawned('test=1&seed=7&hud=1&ai=0', { width: 960, height: 540 }, 0, 120);
    try {
      const tt = T(page);
      const s = await tt.state();
      const text = (id: string): Promise<string> => page.evaluate((i) => document.querySelector(`[data-testid="${i}"]`)?.textContent ?? '', id);
      expect(await text('gold')).toBe(formatGold(s.local.gold));
      expect(await text('gold-rate')).toBe(`+${formatGoldRate(s.local.goldPerSecMilli)}/s`);
      expect(await text('troops')).toBe(String(s.local.troops).replace(/\B(?=(\d{3})+(?!\d))/g, ' '));
      for (const id of ['status', 'nation', 'gold', 'gold-rate', 'troops', 'troops-cap', 'troops-bar', 'land-share', 'timer', 'win', 'win-bar', 'win-leader']) expect(await page.locator(tid(id)).count(), id).toBe(1);
      // no DOM writes at rest: one second of frames without a tick
      await tt.settle(0.1, 1);
      const writes = await page.evaluate(async () => {
        const hud = document.querySelector('[data-testid="match-hud"]') as HTMLElement;
        let n = 0;
        const mo = new MutationObserver((rs) => (n += rs.length));
        mo.observe(hud, { subtree: true, childList: true, attributes: true, characterData: true });
        for (let i = 0; i < 10; i++) (window as any).__test.settle(0.1, 1);
        await new Promise((r) => setTimeout(r, 50));
        mo.disconnect();
        return n;
      });
      expect(writes, 'mutations of the HUD during 1 s without ticks').toBe(0);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('the win meter follows the MatchView (win=1: the default land condition is on)', async () => {
    const { page, messages } = await spawned('test=1&seed=7&hud=1&ai=0&win=1', { width: 960, height: 540 }, 0, 100);
    try {
      const tt = T(page);
      const m = await tt.matchInfo();
      expect(m.winFlags & 1).toBe(1);
      expect(m.leaderSeat).toBe(0);
      const s = await tt.state();
      const hund = Math.round((s.local.landShareQ15 * 10000) / 32768);
      const need = Math.round(m.requiredPct * 100);
      const dom = await page.evaluate(() => ({
        row: !(document.querySelector('[data-testid="win"]') as HTMLElement).hidden,
        leader: document.querySelector('[data-testid="win-leader"]')?.textContent ?? '',
        you: (document.querySelector('[data-testid="win-leader"]') as HTMLElement).dataset.you,
        fill: (document.querySelector('[data-testid="win-bar"]') as HTMLElement).dataset.value,
        hold: !(document.querySelector('[data-testid="win-hold"]') as HTMLElement).hidden,
      }));
      expect(dom.row).toBe(true);
      expect(dom.you).toBe('1');
      expect(dom.fill).toBe(String(Math.min(400, Math.round((hund * 400) / need))));
      const pct = (h: number): string => `${(h / 100).toFixed(2).replace('.', ',')} %`;
      expect(dom.leader).toBe(t('hud.win.leader', { name: t('hud.you'), pct: pct(hund), need: pct(need) }));
      expect(dom.hold, 'nobody meets the limit yet').toBe(m.holdSeat >= 0);
      await shot(page, 'topbar-960x540-sv');
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  for (const lang of ['sv', 'en'] as const satisfies readonly Lang[]) {
    for (const vp of [
      { width: 960, height: 540 },
      { width: 1366, height: 640 },
      { width: 540, height: 960 },
    ] as const) {
      it(`no overlap and nothing outside at ${vp.width}x${vp.height} in ${lang} with the longest strings`, async () => {
        const { page, messages } = await spawned(`test=1&seed=7&hud=1&ai=0&win=1&devbtn=1&w=${vp.width}&h=${vp.height}&lang=${lang}`, vp, 0, 0);
        try {
          const tt = T(page);
          const put = (id: string, text: string): Promise<void> => page.evaluate(([i, x]) => void ((document.querySelector(`[data-testid="${i}"]`) as HTMLElement).textContent = x as string), [id, text] as const);
          await put('gold', formatShownGold(999_000_000_000));
          await put('gold-rate', t('hud.goldRate', { rate: formatGoldRate(1_234_567_890) }));
          await put('troops', '9 999 999');
          await put('troops-cap', t('hud.cap', { cap: '9 999 999' }));
          await put('land-share', '100,00 %');
          await put('timer', '99:59');
          await put('win-leader', t('hud.win.leader', { name: 'Demokratiska Förbundsrepubliken Kongo', pct: '99,99 %', need: '100,00 %' }));
          await page.evaluate(() => {
            const h = document.querySelector('[data-testid="win-hold"]') as HTMLElement;
            h.hidden = false;
            h.textContent = 'Demokratiska Förbundsrepubliken Kongo håller: 999 s kvar';
            const w = document.querySelector('[data-testid="troops-warning"]') as HTMLElement;
            w.hidden = false;
          });
          const status = await rect(page, tid('status'));
          expect(status).not.toBeNull();
          expect(status!.left).toBeGreaterThanOrEqual(0);
          expect(status!.top).toBeGreaterThanOrEqual(0);
          expect(status!.right).toBeLessThanOrEqual(vp.width + 0.5);
          const sideways = await page.evaluate(() => {
            const e = document.querySelector('[data-testid="status"]') as HTMLElement;
            return { panel: e.scrollWidth > e.clientWidth + 1, page: document.documentElement.scrollWidth > window.innerWidth + 1 };
          });
          expect(sideways).toEqual({ panel: false, page: false });
          const others: Record<string, NonNullable<Awaited<ReturnType<typeof rect>>>> = {};
          for (const [name, sel] of [
            ['phase', tid('phase')],
            ['leaderboard', tid('leaderboard')],
            ['controls', tid('controls')],
            ['build-bar', tid('build-bar')],
            ['dev', '[data-dev-button]'],
          ] as const) {
            const r = await rect(page, sel);
            if (r === null) continue;
            others[name] = r;
            expect(r.right, `${name} right`).toBeLessThanOrEqual(vp.width + 0.5);
            expect(r.bottom, `${name} bottom`).toBeLessThanOrEqual(vp.height + 0.5);
            expect(overlaps(status!, r), `status ${JSON.stringify(status)} over ${name} ${JSON.stringify(r)}`).toBe(false);
          }
          for (const [a, b] of [
            ['phase', 'leaderboard'],
            ['phase', 'controls'],
            ['leaderboard', 'controls'],
            ['leaderboard', 'build-bar'],
          ] as const) if (others[a] !== undefined && others[b] !== undefined) expect(overlaps(others[a], others[b]), `${a} over ${b}`).toBe(false);
          await tt.render();
          await shot(page, `topbar-long-${vp.width}x${vp.height}-${lang}`);
          expect(messages).toEqual([]);
        } finally {
          await page.close();
        }
      }, 90_000);
    }
  }
});
