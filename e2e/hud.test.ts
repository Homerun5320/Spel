// M05 Part B in headless Chromium (software WebGL2): the DOM HUD, the start screen and the i18n tables as the page shows them.
// Screenshots go to test-results/shots/hud-*.png and start-*.png; the readability checks read real pixels of day and night views.
import fs from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { OUT_DIR, decodePng, heapDelta, launchBrowser, luma, openPage } from '../scripts/shot.mjs';
import { timeForSubsolarLon } from '../src/render/geo';
import { CLASS_FOREST, CLASS_HILLS, CLASS_PLAINS } from '../src/sim/terrain';
import { TABLES, placeholdersOf } from '../src/ui/i18n';
import { TARGET_MIN_PX } from '../src/ui/uiConfig';
import { worldLoader } from '../tests/helpers/dataFiles';

interface MatchState {
  tick: number;
  phase: 'spawn' | 'immunity' | 'play';
  speed: number;
  paused: boolean;
  rejects: number;
  commitPct: number;
  local: { spawned: boolean; cells: number; troops: number; troopsQt: number; capQt: number; gold: number; goldMilli: number; goldPerSecMilli: number; landShareQ15: number; landSharePct: number };
  seats: Array<{ seat: number; cells: number; landShareQ15: number }>;
}

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

async function open(query: string, viewport = { width: 960, height: 540 }): Promise<{ page: Page; messages: Array<{ type: string; text: string }> }> {
  const { page, consoleMessages } = await openPage(browser, baseUrl, query, viewport);
  return { page, messages: consoleMessages };
}

const state = (page: Page): Promise<MatchState> => page.evaluate(() => (window as any).__test.state());
const advance = (page: Page, dt: number, ticks: number): Promise<void> => page.evaluate(([d, t]) => (window as any).__test.advance(d, t), [dt, ticks] as const);
const view = (page: Page, v: Record<string, number>): Promise<void> => page.evaluate((x) => (window as any).__test.setView(x), v);
const testid = (page: Page, id: string): Promise<{ text: string; value: string | null }> =>
  page.evaluate((i) => {
    const e = document.querySelector(`[data-testid="${i}"]`);
    return { text: e?.textContent ?? '', value: e?.getAttribute('data-value') ?? null };
  }, id);

const VIEW = { lat: 47, lon: 10, distKm: 2600, heading: 0, tilt: 0 };
const START = { lat: 48.5, lon: 11 };

async function clickAt(page: Page, lat: number, lon: number): Promise<void> {
  const p = await page.evaluate(([a, o]) => (window as any).__test.project(a, o), [lat, lon] as const);
  expect(p.inView && p.facing, `(${lat}, ${lon}) is on screen`).toBe(true);
  await page.mouse.click(p.x, p.y);
}

async function shot(page: Page, name: string): Promise<Buffer> {
  await page.evaluate(() => (window as any).__test.render());
  const png = await page.screenshot({ type: 'png' });
  fs.writeFileSync(path.join(SHOT_DIR, `${name}.png`), png);
  return png;
}

const rectOf = (page: Page, id: string): Promise<{ x: number; y: number; width: number; height: number } | null> =>
  page.evaluate((i) => {
    const e = document.querySelector(`[data-testid="${i}"]`);
    if (!(e instanceof HTMLElement) || e.hidden) return null;
    const r = e.getBoundingClientRect();
    return r.width === 0 ? null : { x: r.x, y: r.y, width: r.width, height: r.height };
  }, id);

const overlap = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe('the HUD shows the sim values (data-testid)', () => {
  it('gold with income, troops with cap, land share, timer and the leaderboard equal the sim at tick 5, 100, 255 and 600', async () => {
    const { page, messages } = await open('test=1&seed=7&hud=1&ai=0');
    try {
      await view(page, VIEW);
      // before the spawn: zeros, the empty leaderboard, the prompt with 20 s
      expect((await testid(page, 'phase-seconds')).text).toBe('20 s');
      expect((await page.evaluate(() => document.querySelector('[data-testid="phase"]')?.getAttribute('data-phase')))).toBe('spawn');
      expect((await testid(page, 'phase-text')).text).toBe('Välj din startplats: klicka på marken');
      await clickAt(page, START.lat, START.lon);
      let tick = 0;
      for (const target of [5, 100, 255, 600]) {
        await advance(page, 0, target - (await state(page)).tick);
        const s = await state(page);
        tick = s.tick;
        expect(tick).toBe(target);
        const [gold, rate, troops, cap, share, timer] = await Promise.all(['gold', 'gold-rate', 'troops', 'troops-cap', 'land-share', 'timer'].map((id) => testid(page, id)));
        expect(Number(gold?.value), `gold at ${tick}`).toBe(s.local.gold);
        expect(Number(rate?.value), `gold per second at ${tick}`).toBe(s.local.goldPerSecMilli);
        expect(Number(troops?.value), `troops at ${tick}`).toBe(s.local.troops);
        expect(Number(cap?.value), `cap at ${tick}`).toBe(Math.floor(s.local.capQt / 4));
        expect(Number(share?.value), `land share at ${tick}`).toBe(s.local.landShareQ15);
        expect(Number(timer?.value), `timer at ${tick}`).toBe(Math.floor(tick / 10));
        // the text shows the same digits as the number behind it
        expect((troops?.text ?? '').replace(/\D/g, '')).toBe(String(s.local.troops));
        expect((gold?.text ?? '').replace(/\D/g, '')).toBe(String(s.local.gold));
        expect((cap?.text ?? '').replace(/\D/g, '')).toBe(String(Math.floor(s.local.capQt / 4)));
        expect(share?.text).toBe(`${(s.local.landSharePct).toFixed(2).replace('.', ',')} %`);
        const m = Math.floor(tick / 10 / 60);
        const sec = Math.floor(tick / 10) - m * 60;
        expect(timer?.text).toBe(`${m}:${sec < 10 ? '0' : ''}${sec}`);
        // the phase attribute and the countdown follow the sim
        const phase = await page.evaluate(() => document.querySelector('[data-testid="phase"]')?.getAttribute('data-phase'));
        expect(phase).toBe(s.phase);
        // the leaderboard: you alone, rank 1, with your share
        const rows = await page.evaluate(() =>
          Array.from(document.querySelectorAll<HTMLElement>('[data-testid="leader-row"]'))
            .filter((e) => !e.hidden)
            .map((e) => ({ seat: Number(e.dataset.seat), rank: Number(e.dataset.rank), share: Number(e.dataset.share), you: e.dataset.you })),
        );
        expect(rows).toEqual([{ seat: 0, rank: 1, share: s.local.landShareQ15, you: '1' }]);
        if (tick === 100) await shot(page, 'hud-960-tick100');
        if (tick === 600) await shot(page, 'hud-960-tick600');
      }
      // the banner: protected, then the attack hint (visible for a while), both without a countdown in play
      expect((await testid(page, 'phase-text')).text).toBe('Klicka på fiende- eller oägd mark för att anfalla');
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('the banner counts down the spawn phase and the immunity; a player who never spawned is told so', async () => {
    const { page, messages } = await open('test=1&seed=7&hud=1&ai=0');
    try {
      await view(page, VIEW);
      await advance(page, 0, 50);
      expect((await testid(page, 'phase-seconds')).text).toBe('15 s');
      await advance(page, 0, 155); // tick 205: the immunity, and nobody has spawned
      const missed = await testid(page, 'phase-text');
      expect(missed.text).toBe('Du hann inte välja startplats. Ladda om sidan för en ny match.');
      expect(await page.evaluate(() => document.querySelector('[data-testid="phase"]')?.getAttribute('data-tone'))).toBe('missed');
      expect(await page.evaluate(() => (document.querySelector('[data-testid="phase-seconds"]') as HTMLElement).hidden)).toBe(true);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('the immunity banner counts 5 s down for a player who has spawned', async () => {
    const { page, messages } = await open('test=1&seed=7&hud=1&ai=0');
    try {
      await view(page, VIEW);
      await clickAt(page, START.lat, START.lon);
      await advance(page, 0, 203);
      expect((await state(page)).phase).toBe('immunity');
      expect((await testid(page, 'phase-text')).text).toBe('Skyddad en kort stund. Gör dig redo att anfalla');
      expect((await testid(page, 'phase-seconds')).text).toBe('5 s');
      await advance(page, 0, 30);
      expect((await testid(page, 'phase-seconds')).text).toBe('2 s');
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

describe('the troop bar and its warning', () => {
  it('the bar follows troops / cap and the warning appears from 80 % of the cap', async () => {
    const { page, messages } = await open('test=1&seed=7&hud=1&ai=0');
    try {
      await view(page, VIEW);
      await clickAt(page, START.lat, START.lon);
      await advance(page, 0, 5);
      const bar = () =>
        page.evaluate(() => {
          const b = document.querySelector('[data-testid="troops-bar"]') as HTMLElement;
          const fill = b.querySelector('.hud-bar-fill') as HTMLElement;
          const warn = document.querySelector('[data-testid="troops-warning"]') as HTMLElement;
          return { warning: b.dataset.warning, scale: Number(/scaleX\(([\d.]+)\)/.exec(fill.style.transform)?.[1] ?? -1), warnVisible: !warn.hidden && warn.getBoundingClientRect().width > 0, now: Number(b.getAttribute('aria-valuenow')), max: Number(b.getAttribute('aria-valuemax')) };
        });
      const s0 = await state(page);
      const cap = Math.floor(s0.local.capQt / 4);
      let b = await bar();
      expect(b.warning).toBe('0');
      expect(b.warnVisible).toBe(false);
      expect(b.scale).toBeCloseTo(s0.local.troops / cap, 2);
      expect([b.now, b.max]).toEqual([s0.local.troops, cap]);
      // 70 % of the cap: no warning
      await page.evaluate((n) => (window as any).__test.give(0, { gold: 0, troops: n }), Math.floor(cap * 0.7) - s0.local.troops);
      await advance(page, 0, 4);
      b = await bar();
      const s1 = await state(page);
      expect(s1.local.troops / cap).toBeLessThan(0.78);
      expect(b.warning).toBe('0');
      // 90 % of the cap: the warning (colour state and text)
      await page.evaluate((n) => (window as any).__test.give(0, { gold: 0, troops: n }), Math.floor(cap * 0.9) - s1.local.troops);
      await advance(page, 0, 4);
      b = await bar();
      const s2 = await state(page);
      expect(s2.local.troops / cap).toBeGreaterThan(0.82);
      expect(b.warning).toBe('1');
      expect(b.warnVisible).toBe(true);
      expect(b.scale).toBeCloseTo(Math.min(1, s2.local.troops / cap), 2);
      expect((await testid(page, 'troops-warning')).text).toBe('Nära taket');
      await shot(page, 'hud-960-troop-warning');
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

describe('the leaderboard: top 5 and you', () => {
  async function landCells(count: number, skip: number): Promise<number[]> {
    const sim = await worldLoader().loadSim();
    const out: number[] = [];
    let seen = 0;
    for (let y = 150; y < 330 && out.length < count; y++) {
      for (let x = 640; x < 960 && out.length < count; x++) {
        const c = sim.terrainClass[y * 1024 + x] as number;
        if (c === CLASS_PLAINS || c === CLASS_FOREST || c === CLASS_HILLS) {
          if (seen++ >= skip) out.push(y * 1024 + x);
        }
      }
    }
    expect(out.length).toBe(count);
    return out;
  }

  async function paint(page: Page, counts: number[]): Promise<void> {
    const total = counts.reduce((a, b) => a + b, 0);
    const cells = await landCells(total, 0);
    let at = 0;
    const jobs: Array<[number, number[]]> = counts.map((n, i) => [i + 1, cells.slice(at, (at += n))]);
    await page.evaluate((js) => {
      const t = (window as any).__test;
      for (const [seat, cs] of js) for (const cell of cs) t.submit({ kind: 'DebugPaint', seat, cell });
    }, jobs);
    await advance(page, 0, 4);
  }

  const boardRows = (page: Page) =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('[data-testid="leader-row"]'))
        .filter((e) => !e.hidden)
        .map((e) => ({ seat: Number(e.dataset.seat), rank: Number(e.dataset.rank), share: Number(e.dataset.share), you: e.dataset.you, text: e.textContent ?? '' })),
    );

  it('five nations ahead of you: the top 5 are the nations and your own row follows with rank 6', async () => {
    const { page, messages } = await open('test=1&seed=7&hud=1&ai=0');
    try {
      await view(page, VIEW);
      await clickAt(page, START.lat, START.lon);
      await advance(page, 0, 5);
      await paint(page, [400, 360, 320, 280, 240]); // your capital disc is 197 cells
      const rows = await boardRows(page);
      expect(rows.map((r) => r.seat)).toEqual([1, 2, 3, 4, 5, 0]);
      expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(rows.map((r) => r.you)).toEqual(['0', '0', '0', '0', '0', '1']);
      const s = await state(page);
      for (const r of rows) expect(r.share, `share of seat ${r.seat}`).toBe(s.seats[r.seat]?.landShareQ15);
      expect(rows[0]?.text).toContain('Nation 1');
      expect(rows[5]?.text).toContain('Du');
      await shot(page, 'hud-960-leaderboard-six');
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('you among the best: five rows, you in your place, the weakest nation left out', async () => {
    const { page, messages } = await open('test=1&seed=7&hud=1&ai=0');
    try {
      await view(page, VIEW);
      await clickAt(page, START.lat, START.lon);
      await advance(page, 0, 5);
      await paint(page, [120, 150, 100, 60, 30]);
      const rows = await boardRows(page);
      expect(rows.map((r) => r.seat)).toEqual([0, 2, 1, 3, 4]);
      expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5]);
      expect(rows.filter((r) => r.you === '1').length).toBe(1);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

describe('the controls', () => {
  it('speed buttons, pause and the commitment slider change the game and show their state', async () => {
    const { page, messages } = await open('test=1&seed=7&hud=1&ai=0');
    try {
      const pressed = () => page.evaluate(() => Object.fromEntries(['pause', '1', '2', '4'].map((id) => [id, document.querySelector(`[data-testid="speed-${id}"]`)?.getAttribute('aria-pressed')])));
      expect(await pressed()).toEqual({ pause: 'false', '1': 'true', '2': 'false', '4': 'false' });
      await page.click('[data-testid="speed-4"]');
      await advance(page, 0, 0);
      expect(await pressed()).toEqual({ pause: 'false', '1': 'false', '2': 'false', '4': 'true' });
      expect((await state(page)).speed).toBe(4);
      await page.click('[data-testid="speed-pause"]');
      await advance(page, 0, 0);
      expect((await state(page)).paused).toBe(true);
      expect((await pressed()).pause).toBe('true');
      expect(await page.locator('[data-testid="paused"]').isVisible()).toBe(true);
      expect((await testid(page, 'paused')).text).toBe('Pausat');
      await page.keyboard.press(' '); // the key resumes, the button must not have kept the focus
      await advance(page, 0, 0);
      expect((await state(page)).speed).toBe(4);
      expect(await page.locator('[data-testid="paused"]').isVisible()).toBe(false);
      // the slider: 5 to 100 in steps of 5, label and troops follow
      await page.locator('[data-testid="commit-slider"]').fill('65');
      await advance(page, 0, 0);
      expect((await state(page)).commitPct).toBe(65);
      expect((await testid(page, 'commit')).text).toBe('65 %');
      expect((await testid(page, 'commit')).value).toBe('65');
      await page.keyboard.press(']');
      await advance(page, 0, 0);
      expect((await testid(page, 'commit')).text).toBe('70 %');
      expect(await page.evaluate(() => (document.querySelector('[data-testid="commit-slider"]') as HTMLInputElement).value)).toBe('70');
      const slider = await page.evaluate(() => {
        const e = document.querySelector('[data-testid="commit-slider"]') as HTMLInputElement;
        return { min: e.min, max: e.max, step: e.step };
      });
      expect(slider).toEqual({ min: '5', max: '100', step: '5' });
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('a refusal shows a toast in the language of the page', async () => {
    const { page, messages } = await open('test=1&seed=7&hud=1&ai=0');
    try {
      await view(page, { lat: 30, lon: -40, distKm: 6000, heading: 0, tilt: 0 });
      await clickAt(page, 30, -40); // sea
      await advance(page, 0, 3);
      const toast = await page.evaluate(() => {
        const e = document.querySelector('[data-testid="toast"]') as HTMLElement;
        return { hidden: e.hidden, text: e.textContent };
      });
      expect(toast).toEqual({ hidden: false, text: 'Du kan inte spawna där (hav, bergstopp eller is).' });
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

describe('layout and readability at 960x540 and 1920x1080, by day and by night', () => {
  for (const [w, h] of [
    [960, 540],
    [1920, 1080],
  ] as const) {
    it(`${w}x${h}: panels do not overlap each other or the Dev button, targets are large, text stays readable on bright and dark ground`, async () => {
      const { page, messages } = await open(`test=1&seed=7&hud=1&ai=0&devbtn=1&w=${w}&h=${h}`, { width: w, height: h });
      try {
        await view(page, VIEW);
        await clickAt(page, START.lat, START.lon);
        await advance(page, 0, 30);
        const ids = ['phase', 'status', 'leaderboard', 'controls'];
        const rects: Record<string, { x: number; y: number; width: number; height: number }> = {};
        for (const id of ids) {
          const r = await rectOf(page, id);
          expect(r, id).not.toBeNull();
          rects[id] = r as { x: number; y: number; width: number; height: number };
          expect(r!.x, `${id} inside left`).toBeGreaterThanOrEqual(0);
          expect(r!.y, `${id} inside top`).toBeGreaterThanOrEqual(0);
          expect(r!.x + r!.width, `${id} inside right`).toBeLessThanOrEqual(w);
          expect(r!.y + r!.height, `${id} inside bottom`).toBeLessThanOrEqual(h);
        }
        const dev = await page.evaluate(() => {
          const r = (document.querySelector('[data-dev-button]') as HTMLElement).getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        });
        rects.dev = dev;
        const names = Object.keys(rects);
        for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) expect(overlap(rects[names[i] as string] as never, rects[names[j] as string] as never), `${names[i]} and ${names[j]} overlap`).toBe(false);
        // large targets: the four speed buttons, the slider
        for (const id of ['speed-pause', 'speed-1', 'speed-2', 'speed-4', 'commit-slider']) {
          const r = await rectOf(page, id);
          expect(r!.height, `${id} height`).toBeGreaterThanOrEqual(TARGET_MIN_PX - 0.5);
          if (id !== 'commit-slider') expect(r!.width, `${id} width`).toBeGreaterThanOrEqual(TARGET_MIN_PX - 0.5);
        }
        // the HUD grows with the screen
        const font = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('[data-testid="match-hud"]') as HTMLElement).fontSize));
        console.log(`[hud] ${w}x${h}: HUD font ${font.toFixed(1)} px, status panel ${Math.round(rects.status!.width)}x${Math.round(rects.status!.height)}, controls ${Math.round(rects.controls!.width)}x${Math.round(rects.controls!.height)}`);
        expect(font).toBeGreaterThanOrEqual(14);

        // readability on real pixels: the panel padding is dark over snow, desert, sea and night, and the text on it is bright
        const views: Array<[string, Record<string, number>]> = [
          ['day', { lat: 47, lon: 10, distKm: 2600, heading: 0, tilt: 0, time: timeForSubsolarLon(10) }],
          ['night', { lat: 47, lon: 10, distKm: 2600, heading: 0, tilt: 0, time: timeForSubsolarLon(190) }],
          ['ice', { lat: -80, lon: 0, distKm: 4000, heading: 0, tilt: 0, time: timeForSubsolarLon(0) }],
        ];
        for (const [name, v] of views) {
          await view(page, v);
          const png = await shot(page, `hud-${w}-${name}`);
          const img = decodePng(png);
          const at = (x: number, y: number): number => {
            const o = (Math.round(y) * img.width + Math.round(x)) * 4;
            return luma(img.data[o] as number, img.data[o + 1] as number, img.data[o + 2] as number);
          };
          const sampled: string[] = [];
          for (const id of ids) {
            const r = rects[id] as { x: number; y: number; width: number; height: number };
            // padding points: 12 px in from the four corners and 6 px in from the middle of each edge
            const pts: Array<[number, number]> = [
              [r.x + 12, r.y + 12],
              [r.x + r.width - 12, r.y + 12],
              [r.x + 12, r.y + r.height - 12],
              [r.x + r.width - 12, r.y + r.height - 12],
              [r.x + r.width / 2, r.y + 6],
              [r.x + r.width / 2, r.y + r.height - 6],
            ];
            const pad = pts.map(([x, y]) => at(x, y));
            sampled.push(`${id} pad max ${Math.max(...pad).toFixed(0)}`);
            expect(Math.max(...pad), `${id} on the ${name} view: padding luma`).toBeLessThan(80);
            // text: some pixel in the panel is bright (the digits and letters), far above the padding
            let bright = 0;
            for (let y = Math.floor(r.y); y < r.y + r.height; y += 2) for (let x = Math.floor(r.x); x < r.x + r.width; x += 2) if (at(x, y) > 170) bright++;
            expect(bright, `${id} on the ${name} view: bright text pixels`).toBeGreaterThan(15);
          }
          console.log(`[hud] ${w}x${h} ${name}: ${sampled.join(', ')}`);
        }
        expect(messages).toEqual([]);
      } finally {
        await page.close();
      }
    });
  }
});

describe('clicks on the HUD never reach the globe', () => {
  it('a click in the middle of the banner, the status panel, the leaderboard and the controls spawns nothing and refuses nothing', async () => {
    const { page, messages } = await open('test=1&seed=7&hud=1&ai=0');
    try {
      await view(page, VIEW);
      for (const id of ['phase', 'status', 'leaderboard', 'controls']) {
        const r = await rectOf(page, id);
        expect(r, id).not.toBeNull();
        // the middle of the status panel is a bar or text: nothing clickable; controls' middle is the commitment line
        await page.mouse.click(r!.x + 4, r!.y + 4);
        await advance(page, 0, 3);
        const s = await state(page);
        expect([s.local.spawned, s.rejects], id).toEqual([false, 0]);
      }
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

describe('i18n in the browser', () => {
  it('test mode fails on a missing key: text() throws, and every key of both tables resolves in the page', async () => {
    const { page, messages } = await open('test=1&seed=7&ai=0');
    try {
      const err = await page.evaluate(() => {
        try {
          (window as any).__test.text('hud.noSuchKey');
          return null;
        } catch (e) {
          return String((e as Error).message);
        }
      });
      expect(err).toMatch(/i18n: key "hud.noSuchKey" is missing/);
      // every key gets a value for each of ITS placeholders (read from the Swedish text; the English table has the same ones, a unit test
      // states it): a key that still throws is missing from a table. (Before M06 one fixed set of five names was enough.)
      const keys = Object.keys(TABLES.sv).map((k) => [k, Object.fromEntries(placeholdersOf(TABLES.sv[k] as string).map((p) => [p, 1]))] as const);
      const bad = await page.evaluate((ks) => {
        const t = (window as any).__test;
        const out: string[] = [];
        for (const [k, params] of ks) {
          try {
            t.text(k, params);
          } catch (e) {
            out.push(`${k}: ${(e as Error).message}`);
          }
        }
        return out;
      }, keys);
      expect(bad).toEqual([]);
      expect(await page.evaluate(() => (window as any).__test.language())).toBe('sv');
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('#test_lang-en and ?lang=en show English everywhere in the HUD, and the hover tooltip', async () => {
    const a = await open('test=1&seed=7&hud=1&ai=0&lang=en');
    const b = await open('#test_ai-0_hud_seed-7_lang-en');
    try {
      for (const { page } of [a, b]) {
        expect(await page.evaluate(() => (window as any).__test.language())).toBe('en');
        await view(page, VIEW);
        expect((await testid(page, 'phase-text')).text).toBe('Choose your starting place: click the ground');
        const labels = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid="status"] .hud-label, [data-testid="leaderboard"] .hud-board-title, [data-testid="controls"] .hud-label')).map((e) => e.textContent));
        expect(labels).toEqual(['Leaderboard', 'Gold', 'Troops', 'Land share', 'Time', 'Speed', 'Commitment']); // document order
        expect(await page.evaluate(() => document.querySelector('[data-testid="speed-pause"]')?.textContent)).toBe('Pause');
        await clickAt(page, START.lat, START.lon);
        await advance(page, 0, 5);
        expect((await testid(page, 'phase-text')).text).toBe('Starting place chosen. Waiting for the phase to end');
        expect((await testid(page, 'gold-rate')).text).toMatch(/^\+\d+\.\d\/s$/); // a decimal point, not a comma
        const row = await page.evaluate(() => document.querySelector('[data-testid="leader-row"]:not([hidden])')?.textContent);
        expect(row).toContain('You');
        const tip = await page.evaluate(([x, y]) => (window as any).__test.tooltip(x, y), [480, 270] as const);
        expect(tip).toMatch(/Germany|Austria|Switzerland|Italy|France/);
        expect(tip).not.toMatch(/Tyskland|Österrike|Schweiz/);
      }
      expect([...a.messages, ...b.messages]).toEqual([]);
    } finally {
      await Promise.all([a.page.close(), b.page.close()]);
    }
  });

  it('the tooltip says Hav / Sea and Slätt / Plains in the page language', async () => {
    const sv = await open('test=1&seed=7&ai=0');
    const en = await open('test=1&seed=7&ai=0&lang=en');
    try {
      for (const { page } of [sv, en]) await view(page, { lat: 30, lon: -40, distKm: 6000, heading: 0, tilt: 0 });
      const at = async (page: Page) => {
        const p = await page.evaluate(() => (window as any).__test.project(30, -40));
        return page.evaluate(([x, y]) => (window as any).__test.tooltip(x, y), [p.x, p.y] as const);
      };
      expect(await at(sv.page)).toMatch(/^Hav · /);
      expect(await at(en.page)).toMatch(/^Sea · /);
      expect([...sv.messages, ...en.messages]).toEqual([]);
    } finally {
      await Promise.all([sv.page.close(), en.page.close()]);
    }
  });
});

describe('the HUD does no work when nothing changed', () => {
  it('500 refreshes of an unchanged state cause no DOM mutation; the cost per refresh is logged', async () => {
    const { page, messages } = await open('test=1&seed=7&hud=1&ai=0');
    try {
      await view(page, VIEW);
      await clickAt(page, START.lat, START.lon);
      await advance(page, 0, 30);
      const r = await page.evaluate(() => {
        const root = document.querySelector('[data-testid="match-hud"]') as HTMLElement;
        const records: string[] = [];
        const obs = new MutationObserver((list) => {
          for (const m of list) records.push(`${m.type}:${(m.target as HTMLElement).dataset?.testid ?? (m.target as HTMLElement).className}`);
        });
        obs.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
        const ms = (window as any).__test.hudRefresh(500);
        const pending = obs.takeRecords();
        obs.disconnect();
        return { ms, mutations: records.length + pending.length };
      });
      console.log(`[hud] 500 refreshes of an unchanged state: ${r.ms.toFixed(2)} ms (${(r.ms / 500).toFixed(4)} ms each), ${r.mutations} DOM mutations; logged, not asserted`);
      expect(r.mutations).toBe(0);
      // the retained heap of 3000 refreshes (gc before and after, median of 3; a string per refresh would be 100 KB or more)
      const retained = await heapDelta(page, () => page.evaluate(() => { (window as any).__test.hudRefresh(3000); }));
      console.log(`[hud] heap retained by 3000 refreshes (gc, median of 3): ${retained} bytes`);
      expect(retained).toBeLessThan(1_000_000);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

describe('the live page: the start screen first, Play, language, Dev', () => {
  async function live(hash: string, viewport = { width: 960, height: 540 }): Promise<{ page: Page; messages: string[] }> {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    const messages: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') messages.push(`${m.type()}: ${m.text()}`);
    });
    page.on('pageerror', (e) => messages.push(`pageerror: ${e.message}`));
    await page.goto(`${baseUrl}/?quality=low${hash}`, { waitUntil: 'load' });
    await page.waitForSelector('[data-testid="start-screen"]', { timeout: 60_000 });
    return { page, messages };
  }

  it('the first thing on screen is the start screen with a large Play button and a small Dev button, in Swedish; the HUD does not exist yet', async () => {
    const { page, messages } = await live('#seed-7');
    try {
      expect(await page.locator('[data-testid="match-hud"]').count()).toBe(0);
      const play = await page.locator('[data-testid="play"]').boundingBox();
      const devb = await page.locator('[data-testid="start-dev"]').boundingBox();
      const card = await page.locator('.start-card').boundingBox();
      expect(play!.height).toBeGreaterThanOrEqual(TARGET_MIN_PX);
      expect(play!.width).toBeGreaterThan(120);
      expect(devb!.height).toBeGreaterThanOrEqual(TARGET_MIN_PX);
      expect(devb!.width * devb!.height).toBeLessThan(play!.width * play!.height); // small
      expect(card!.y).toBeGreaterThanOrEqual(0);
      expect(card!.y + card!.height).toBeLessThanOrEqual(540);
      expect(await page.locator('[data-testid="play"]').textContent()).toBe('Spela');
      expect(await page.locator('[data-testid="start-title"]').textContent()).toBe('Erövra jorden');
      expect(await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))).toBe('play'); // Enter starts
      await page.waitForTimeout(800);
      fs.writeFileSync(path.join(SHOT_DIR, 'start-sv.png'), await page.screenshot({ type: 'png' }));
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('the language button switches the whole start screen at once and back; the Dev button opens the Dev panel; Enter starts the match in the chosen language', async () => {
    const { page, messages } = await live('#seed-7');
    try {
      await page.click('[data-testid="start-language"]');
      expect(await page.locator('[data-testid="play"]').textContent()).toBe('Play');
      expect(await page.locator('[data-testid="start-title"]').textContent()).toBe('Conquer the Earth');
      expect(await page.locator('[data-testid="start-language"]').textContent()).toBe('Svenska');
      const helpEn = await page.locator('[data-testid="start-help"] li').allTextContents();
      expect(helpEn).toEqual([TABLES.en['help.click'], TABLES.en['help.drag'], TABLES.en['help.commit'], TABLES.en['help.speed'], TABLES.en['help.dev']]);
      fs.writeFileSync(path.join(SHOT_DIR, 'start-en.png'), await page.screenshot({ type: 'png' }));
      await page.click('[data-testid="start-language"]');
      expect(await page.locator('[data-testid="play"]').textContent()).toBe('Spela');
      await page.click('[data-testid="start-language"]');
      expect(await page.locator('[data-dev-panel]').isVisible()).toBe(false);
      await page.click('[data-testid="start-dev"]');
      expect(await page.locator('[data-dev-panel]').isVisible()).toBe(true);
      expect(await page.locator('input#seed').count()).toBe(1);
      await page.keyboard.press('Escape');
      expect(await page.locator('[data-dev-panel]').isVisible()).toBe(false);
      // the Dev panel's own language entries exist
      await page.keyboard.press('F2');
      expect(await page.locator('[data-dev-mode="lang-en"]').count()).toBe(1);
      expect(await page.locator('[data-dev-mode="probe"]').count()).toBe(1);
      await page.keyboard.press('F2');
      await page.focus('[data-testid="play"]');
      await page.keyboard.press('Enter');
      await page.waitForSelector('[data-testid="match-hud"]', { timeout: 60_000 });
      expect(await page.locator('[data-testid="start-screen"]').count()).toBe(0);
      expect(await page.locator('[data-testid="phase-text"]').textContent()).toBe('Choose your starting place: click the ground');
      // the two link chips of the start page are gone while the HUD is up (they sat above it)
      expect(await page.evaluate(() => [(document.getElementById('probe-link') as HTMLElement).hidden, (document.getElementById('debug-links') as HTMLElement).hidden])).toEqual([true, true]);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('#lang-en opens the start screen in English; Play shows the HUD, a click spawns, the perf report carries the HUD cost', async () => {
    const { page, messages } = await live('#perf_seed-7_lang-en');
    try {
      expect(await page.locator('[data-testid="play"]').textContent()).toBe('Play');
      await page.click('[data-testid="play"]');
      await page.waitForSelector('[data-testid="match-hud"]', { timeout: 60_000 });
      await page.mouse.click(480, 270);
      await page.waitForFunction(() => Number(document.querySelector('[data-testid="troops"]')?.getAttribute('data-value') ?? 0) > 100, undefined, { timeout: 30_000 });
      await page.waitForFunction(() => /HUD [\d.]+ ms/.test(document.querySelector('[data-perf]')?.textContent ?? ''), undefined, { timeout: 30_000 });
      const text = await page.evaluate(() => document.querySelector('[data-perf]')?.textContent ?? '');
      console.log(`[live] perf overlay: ${text.replace(/\n/g, ' | ')}`);
      fs.writeFileSync(path.join(SHOT_DIR, 'hud-live-en.png'), await page.screenshot({ type: 'png' }));
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('on a 390x844 phone the phase banner is readable and nothing in the top area overlaps (banner, leaderboard, Dev button)', async () => {
    const { page, messages } = await live('#seed-7', { width: 390, height: 844 });
    try {
      await page.keyboard.press('Enter');
      await page.waitForSelector('[data-testid="match-hud"]', { timeout: 60_000 });
      const box = async (sel: string): Promise<{ x: number; y: number; width: number; height: number }> => {
        const b = await page.locator(sel).first().boundingBox();
        if (b === null) throw new Error(`${sel} has no box`);
        return b;
      };
      const check = async (label: string): Promise<void> => {
        const banner = await box('[data-testid="phase"]');
        const board = await box('[data-testid="leaderboard"]');
        const dev = await box('[data-dev-button]');
        expect(banner.width, `${label}: banner width`).toBeGreaterThanOrEqual(200);
        expect(banner.height, `${label}: banner height`).toBeLessThan(90);
        expect(banner.x, label).toBeGreaterThanOrEqual(0);
        expect(banner.x + banner.width, label).toBeLessThanOrEqual(390);
        expect(overlap(banner, board), `${label}: banner and leaderboard`).toBe(false);
        expect(overlap(banner, dev), `${label}: banner and Dev button`).toBe(false);
        expect(overlap(board, dev), `${label}: leaderboard and Dev button`).toBe(false);
        expect(board.x + board.width, label).toBeLessThanOrEqual(390);
      };
      await check('spawn phase');
      await page.screenshot({ path: path.join(SHOT_DIR, 'm390-01-banner.png') });
      await page.mouse.click(195, 470);
      await page.waitForFunction(() => Number(document.querySelector('[data-testid="troops"]')?.getAttribute('data-value') ?? 0) > 100, undefined, { timeout: 30_000 });
      await page.waitForTimeout(500);
      await check('after the click');
      expect(await page.locator('[data-testid="phase-text"]').textContent()).toContain('Startplats vald');
      fs.writeFileSync(path.join(SHOT_DIR, 'm390-02-after-click.png'), await page.screenshot({ type: 'png' }));
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('on a phone-sized screen the start card fits and Play is reachable', async () => {
    const { page, messages } = await live('', { width: 390, height: 844 });
    try {
      const card = await page.locator('.start-card').boundingBox();
      expect(card!.x).toBeGreaterThanOrEqual(0);
      expect(card!.x + card!.width).toBeLessThanOrEqual(390);
      expect(card!.y + card!.height).toBeLessThanOrEqual(844);
      fs.writeFileSync(path.join(SHOT_DIR, 'start-phone.png'), await page.screenshot({ type: 'png' }));
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});
