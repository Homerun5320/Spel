// M06 in headless Chromium (software WebGL2): the main menu and the setup screen, a real country by search and by a click on the globe, a
// custom nation with its flag and a free start place, the options, the outline of the chosen country, the HUD with names and flags, the
// "no real borders" mode, localStorage blocked, and the same hashes as Node. Test mode with `menu=1` shows the menus (plain `test=1` still
// starts the standard match at once, so every earlier e2e file is untouched). Screenshots go to test-results/shots/setup-*.png.
import fs from 'node:fs';
import path from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { OUT_DIR, decodePng, launchBrowser, openPage } from '../scripts/shot.mjs';
import { deltaE76Rgb } from '../src/render/color';
import { isPlayableClass } from '../src/sim/terrain';
import { START_DISC_CELLS } from '../src/sim/rules';
import { TABLES } from '../src/ui/i18n';
import { TARGET_MIN_PX } from '../src/ui/uiConfig';
import { rgbOfHex } from '../src/ui/flag';
import { loadPreparedWorld } from '../tools/sim/realWorld';
import { goldenConfigs } from '../tests/helpers/matchConfigs';
import { latLonOfCell } from '../src/app/cellGeo';
import type { PreparedWorld } from '../src/app/matchWorld';

interface Msg {
  type: string;
  text: string;
}

let browser: Browser;
let world: PreparedWorld;
const baseUrl = inject('baseUrl');
const SHOT_DIR = path.join(OUT_DIR, 'shots');

beforeAll(async () => {
  ({ browser } = await launchBrowser());
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  world = await loadPreparedWorld();
});
afterAll(async () => {
  await browser?.close();
});

async function open(query: string, viewport = { width: 960, height: 540 }): Promise<{ page: Page; messages: Msg[] }> {
  const { page, consoleMessages } = await openPage(browser, baseUrl, query, viewport);
  return { page, messages: consoleMessages as Msg[] };
}

/** Steps the FX clock and renders `seconds` of frames in one call (flights, markers and the picture follow; a coarse step keeps the software renderer's time down, a flight ends exactly on its time whatever the step). */
const settle = (page: Page, seconds = 3.2, step = 0.25): Promise<void> =>
  page.evaluate(([s, dt]) => {
    const t = (window as any).__test;
    for (let i = 0; i < Math.max(1, Math.round(s / dt)); i++) t.render(dt);
  }, [seconds, step] as const);

async function shot(page: Page, name: string): Promise<Buffer> {
  await page.evaluate(() => (window as any).__test.render());
  const png = await page.screenshot({ type: 'png' });
  fs.writeFileSync(path.join(SHOT_DIR, `setup-${name}.png`), png);
  return png;
}

const tid = (id: string): string => `[data-testid="${id}"]`;
const text = (page: Page, id: string): Promise<string> => page.locator(tid(id)).first().textContent().then((x) => x ?? '');

async function openSetup(page: Page, step = 0.25): Promise<void> {
  await page.click(tid('start-setup'));
  await page.waitForSelector(tid('setup-screen'), { timeout: 30_000 });
  await settle(page, 1.5, step);
}

/** Pixels of a screenshot whose colour is the selection outline's (bright amber); counted outside the panel. */
function amberPixels(png: Buffer, fromX: number): number {
  const img = decodePng(png);
  let n = 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = Math.ceil(fromX); x < img.width; x++) {
      const i = (y * img.width + x) * 4;
      const r = img.data[i] as number;
      const g = img.data[i + 1] as number;
      const b = img.data[i + 2] as number;
      if (r > 225 && g > 195 && b < 190 && r - b > 70) n++; // the outline is the amber colour at full strength (about 255, 255, 120)
    }
  }
  return n;
}

/** The capital cell of a country by a3 code, and its id. */
const country = (a3: string): { id: number; cap: number } => {
  const c = world.countries.find((x) => x.a3 === a3);
  if (!c) throw new Error(a3);
  return { id: c.id, cap: c.capitalCell };
};

describe('the main menu', () => {
  it('shows Play (the standard match) and the setup button, both large, in Swedish; the English texts follow the language button', async () => {
    const { page, messages } = await open('test=1&menu=1&hud=1');
    try {
      await page.waitForSelector(tid('start-screen'));
      expect(await page.locator(tid('start-setup')).count()).toBe(1);
      const play = (await page.locator(tid('play')).boundingBox())!;
      const setup = (await page.locator(tid('start-setup')).boundingBox())!;
      const card = (await page.locator('.start-card').boundingBox())!;
      expect(play.height).toBeGreaterThanOrEqual(TARGET_MIN_PX);
      expect(setup.height).toBeGreaterThanOrEqual(TARGET_MIN_PX);
      expect(card.y).toBeGreaterThanOrEqual(0);
      expect(card.y + card.height).toBeLessThanOrEqual(540);
      expect(await text(page, 'play')).toBe(TABLES.sv['start.play']);
      expect(await text(page, 'start-setup')).toBe(TABLES.sv['start.setup']);
      await shot(page, 'menu-960');
      await page.click(tid('start-language'));
      expect(await text(page, 'start-setup')).toBe(TABLES.en['start.setup']);
      expect(await text(page, 'play-hint')).toBe(TABLES.en['start.playHint']);
      await shot(page, 'menu-960-en');
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('without menu=1 the test page still starts the standard match at once (every earlier test relies on it)', async () => {
    const { page, messages } = await open('test=1&seed=7');
    try {
      expect(await page.locator(tid('start-screen')).count()).toBe(0);
      const s = await page.evaluate(() => (window as any).__test.state());
      expect(s.tick).toBe(0);
      expect(s.local.spawned).toBe(false); // the M05 flow: you spawn by clicking
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('Play still starts the standard match of M05 (spawn by clicking) when the menu is on', async () => {
    const { page, messages } = await open('test=1&menu=1&hud=1&seed=7&ai=0');
    try {
      await page.click(tid('play'));
      await page.waitForSelector(tid('match-hud'));
      const s = await page.evaluate(() => (window as any).__test.state());
      expect(s.local.spawned).toBe(false);
      expect(await text(page, 'phase-text')).toBe(TABLES.sv['phase.spawnPick']);
      expect(await page.locator(tid('nation')).evaluate((e) => (e as HTMLElement).hidden)).toBe(true); // the numbered names of M05, no nation header
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

describe('a real country: search, the flight, the outline, the start', () => {
  it('search "Sweden" (and "Sverige", "sverige") finds Sweden; the camera flies there; its border is outlined; Start places the nation on Stockholm with 197 cells; 60 s of play run without errors', async () => {
    const { page, messages } = await open('test=1&menu=1&hud=1&seed=1');
    try {
      const swe = country('SWE');
      await openSetup(page);
      await shot(page, 'setup-960-initial');
      // the list shows every country; the search matches both languages, case and diacritics
      const rows = (): Promise<string[]> => page.locator(tid('setup-row')).evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.a3 ?? ''));
      expect((await rows()).length).toBe(world.countries.length);
      for (const q of ['Sweden', 'sverige', 'SVERIGE', 'swed']) {
        await page.fill('#setup-search', q);
        expect((await rows())[0], q).toBe('SWE');
      }
      await page.fill('#setup-search', 'aland');
      expect((await rows()).length).toBeGreaterThan(0);
      await page.fill('#setup-search', 'zzzz');
      expect(await page.locator(tid('setup-empty')).count()).toBe(1);
      // the name follows the UI language
      await page.fill('#setup-search', 'Sverige');
      expect(await page.locator('.setup-row').first().locator('.setup-row-name').textContent()).toBe('Sverige');
      await page.click(tid('setup-language'));
      expect(await page.locator('.setup-row').first().locator('.setup-row-name').textContent()).toBe('Sweden');
      await page.click(tid('setup-language'));
      expect(await page.locator('.setup-row').first().locator('.setup-row-name').textContent()).toBe('Sverige');
      // the neutral disclaimer is always in view, inside the panel (and so is the source line at the end of the options)
      const disc = (await page.locator(tid('setup-disclaimer')).boundingBox())!;
      const panelBox = (await page.locator(tid('setup-panel')).boundingBox())!;
      expect(await text(page, 'setup-disclaimer')).toBe(TABLES.sv['setup.disclaimer']);
      expect(disc.y).toBeGreaterThan(panelBox.y);
      expect(disc.y + disc.height).toBeLessThanOrEqual(panelBox.y + panelBox.height);
      expect(await text(page, 'setup-sources')).toBe(TABLES.sv['setup.sources']);
      // the start is not possible yet; the status says what is missing
      expect(await page.locator(tid('setup-start')).isDisabled()).toBe(true);
      expect(await page.locator(tid('setup-status')).getAttribute('data-key')).toBe('setup.need.country');
      // before the choice: the same view, no outline (the baseline for the outline check)
      const before = await shot(page, 'sweden-0-before');
      const amberBefore = amberPixels(before, 380);
      // pick Sweden and let the camera fly
      await page.locator(tid('setup-row')).first().click();
      expect(await page.locator(tid('setup-row')).first().getAttribute('data-selected')).toBe('1');
      expect(await page.locator(tid('setup-start')).isDisabled()).toBe(false);
      const v0 = await page.evaluate(() => (window as any).__test.view());
      await settle(page, 0.5);
      const vMid = await page.evaluate(() => (window as any).__test.view());
      expect(vMid.lat !== v0.lat || vMid.lon !== v0.lon || vMid.distKm !== v0.distKm).toBe(true); // it is under way
      await settle(page, 3);
      const v1 = await page.evaluate(() => (window as any).__test.view());
      expect(v1.lat).toBeGreaterThan(55); // the focus is a little west of Sweden: the country is moved out from under the panel
      expect(v1.lat).toBeLessThan(67);
      expect(Math.abs(v1.lon - 16)).toBeLessThan(25);
      // Sweden is in the free part of the screen, right of the panel, and in view
      const p = await page.evaluate(([la, lo]) => (window as any).__test.project(la, lo), [latLonOfCell(swe.cap, 1024, 512).lat, latLonOfCell(swe.cap, 1024, 512).lon] as const);
      expect(p.inView && p.facing).toBe(true);
      const panel = (await page.locator(tid('setup-panel')).boundingBox())!;
      expect(p.x).toBeGreaterThan(panel.x + panel.width);
      const after = await shot(page, 'sweden-1-flown');
      const amberAfter = amberPixels(after, panel.x + panel.width);
      console.log(`[setup] outline pixels before ${amberBefore}, after ${amberAfter}`);
      expect(amberAfter).toBeGreaterThan(amberBefore + 400);
      // Start: the standard flow has no spawn to choose; the nation is on Stockholm with a whole start disc
      await page.click(tid('setup-start'));
      await page.waitForSelector(tid('match-hud'), { timeout: 30_000 });
      expect(await page.locator(tid('setup-screen')).count()).toBe(0);
      expect(await page.locator(tid('start-screen')).count()).toBe(0);
      const cells = await page.evaluate(() => (window as any).__test.seatCells());
      expect(cells.capitals[0]).toBe(swe.cap); // the capital cell IS Stockholm's cell (meta.json), well inside "within 2 cells"
      expect(cells.cells[0]).toBe(START_DISC_CELLS);
      const st = await page.evaluate(() => (window as any).__test.state());
      expect(st.local.spawned).toBe(true);
      expect(st.local.cells).toBe(START_DISC_CELLS);
      // in a default match every seat has exactly K cells at tick 0 (12 AI nations and the tribes that found a place)
      const played = cells.cells.slice(0, 13);
      expect(played).toEqual(new Array(13).fill(START_DISC_CELLS));
      for (const c of cells.cells.slice(13)) expect(c === START_DISC_CELLS || c === 0).toBe(true);
      expect(cells.cells.slice(13).filter((c: number) => c === START_DISC_CELLS).length).toBeGreaterThanOrEqual(15);
      // the HUD: the nation name and flag, the banner for an already placed nation, the leaderboard with names and flags
      await settle(page, 1);
      expect(await text(page, 'nation-name')).toBe('Sverige');
      expect(await text(page, 'phase-text')).toBe(TABLES.sv['phase.preplaced']);
      await page.evaluate(() => (window as any).__test.advance(0, 30));
      await settle(page, 1);
      const board = await page.locator(tid('leader-row')).evaluateAll((els) => els.filter((e) => !(e as HTMLElement).hidden).map((e) => ({ name: e.querySelector('.hud-name')?.textContent, flag: (e as HTMLElement).dataset.flag, you: (e as HTMLElement).dataset.you })));
      expect(board.length).toBeGreaterThanOrEqual(5);
      for (const r of board) {
        expect(r.flag).toBe('1');
        expect(r.name).not.toMatch(/^(Nation|Stam) \d+$/);
      }
      await shot(page, 'sweden-2-hud-sv');
      // 60 seconds of play, fast-forwarded, no errors
      const run = await page.evaluate(() => (window as any).__test.run(60));
      expect(run.ticks).toBeGreaterThanOrEqual(590);
      const end = await page.evaluate(() => (window as any).__test.state());
      expect(end.tick).toBeGreaterThanOrEqual(620);
      expect(end.local.alive).toBe(true);
      expect(end.phase).toBe('play');
      await page.evaluate(() => (window as any).__test.setView({ distKm: 3600, lat: 59.5, lon: 16, heading: 0, tilt: 0 }));
      await shot(page, 'sweden-3-after-60s');
      // names follow the language
      await page.evaluate(() => (window as any).__test.text('hud.you'));
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

/** Node-side picks of cells to click on: an interior cell (all eight neighbours in the same land mass) of a land mass in a size range, nearest to a place. */
function interiorCell(minSize: number, maxSize: number, near: { lat: number; lon: number } | null): number {
  const a = world.analyse('world');
  const { label, size } = a.land;
  const W = world.width;
  const H = world.height;
  let best = -1;
  let bestD = Infinity;
  for (let y = 2; y < H - 2; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const id = label[i] as number;
      if (id < 0) continue;
      const sz = size[id] as number;
      if (sz < minSize || sz > maxSize) continue;
      let all = true;
      for (let dy = -1; dy <= 1 && all; dy++) for (let dx = -1; dx <= 1; dx++) if (label[(y + dy) * W + ((x + dx + W) % W)] !== id) all = false;
      if (!all) continue;
      const at = latLonOfCell(i, W, H);
      const d = near === null ? 0 : (at.lat - near.lat) ** 2 + (at.lon - near.lon) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
  }
  if (best < 0) throw new Error('no interior cell');
  return best;
}

/** Puts the camera on a cell, right of the panel, and returns where to click. */
async function aimAt(page: Page, cell: number, distKm = 1800): Promise<{ x: number; y: number }> {
  const at = latLonOfCell(cell, world.width, world.height);
  await page.evaluate(([la, lo, d]) => (window as any).__test.setView({ lat: la, lon: lo, distKm: d, heading: 0, tilt: 0 }), [at.lat, at.lon, distKm] as const);
  await settle(page, 0.2);
  const p = await page.evaluate(([la, lo]) => (window as any).__test.project(la, lo), [at.lat, at.lon] as const);
  expect(p.inView && p.facing).toBe(true);
  const panel = (await page.locator(tid('setup-panel')).boundingBox())!;
  expect(p.x).toBeGreaterThan(panel.x + panel.width + 5);
  return { x: p.x, y: p.y };
}

describe('a custom nation: name, colour, flag, a free start place', () => {
  it('invalid clicks give a reason (sea, ice, a land mass that is too small); a valid click is where the nation spawns, exactly', async () => {
    const { page, messages } = await open('test=1&menu=1&hud=1&seed=3');
    try {
      await openSetup(page);
      await page.click(tid('setup-tab-custom'));
      // the start is not possible before a place is chosen
      expect(await page.locator(tid('setup-start')).isDisabled()).toBe(true);
      expect(await page.locator(tid('setup-status')).getAttribute('data-key')).toBe('setup.need.cell');
      await page.fill('#setup-name', 'Zorland');
      await page.click(tid('setup-color-3'));
      const msg = (): Promise<{ key: string | null; text: string }> => page.locator(tid('setup-message')).evaluate((e) => ({ key: (e as HTMLElement).dataset.key ?? null, text: e.textContent ?? '' }));
      // 1. sea (the Atlantic west of Portugal)
      const seaCell = 190 * 1024 + 330; // row 190, column 330: lat about 17 N, lon about 38 W: open Atlantic
      expect(isPlayableClass(world.analyse('world').terrain[seaCell] as number)).toBe(false);
      let at = await aimAt(page, seaCell);
      await page.mouse.click(at.x, at.y);
      expect((await msg()).key).toBe('setup.start.terrain');
      expect((await msg()).text).toBe(TABLES.sv['setup.start.terrain']);
      expect(await page.locator(tid('setup-place')).getAttribute('data-set')).toBe('0');
      expect(await page.locator(tid('setup-start')).isDisabled()).toBe(true);
      await shot(page, 'custom-invalid-sea');
      // 2. Antarctica: land, but ice
      const iceCell = 505 * 1024 + 300;
      expect(world.analyse('world').terrain[iceCell]).toBe(7);
      at = await aimAt(page, iceCell, 6000);
      await page.mouse.click(at.x, at.y);
      expect((await msg()).key).toBe('setup.start.terrain');
      // 3. a land mass that is too small for a fair start (an island of 20 to 150 cells)
      const islandCell = interiorCell(20, 150, null);
      at = await aimAt(page, islandCell, 900);
      await page.mouse.click(at.x, at.y);
      const m = await msg();
      expect(m.key).toBe('setup.reason.smallLandmass');
      expect(m.text).toMatch(/ av 197 celler/);
      expect(await page.locator(tid('setup-place')).getAttribute('data-set')).toBe('0');
      expect(await page.locator(tid('setup-start')).isDisabled()).toBe(true);
      await shot(page, 'custom-invalid-island');
      await page.click(tid('setup-language'));
      expect((await msg()).text).toMatch(/^land mass too small for a fair start: \d+ of 197 cells$/i);
      await page.click(tid('setup-language'));
      // 4. a valid click on the big land mass: that cell becomes the capital
      const goodCell = interiorCell(5000, Infinity, { lat: 48, lon: 13 });
      at = await aimAt(page, goodCell, 1500);
      const picked = await page.evaluate(([x, y]) => (window as any).__test.pick(x, y).cell.index, [at.x, at.y] as const);
      expect(picked).toBe(goodCell);
      await page.mouse.click(at.x, at.y);
      expect((await msg()).key).toBe('');
      expect(await page.locator(tid('setup-place')).getAttribute('data-cell')).toBe(String(goodCell));
      expect(await page.locator(tid('setup-start')).isDisabled()).toBe(false);
      // the marker sits on the chosen place
      const mk = await page.locator(tid('setup-marker')).evaluate((e) => ({ hidden: (e as HTMLElement).hidden, t: (e as HTMLElement).style.transform }));
      expect(mk.hidden).toBe(false);
      expect(mk.t).toContain('translate(');
      await shot(page, 'custom-valid');
      await page.click(tid('setup-start'));
      await page.waitForSelector(tid('match-hud'), { timeout: 30_000 });
      const cells = await page.evaluate(() => (window as any).__test.seatCells());
      expect(cells.capitals[0]).toBe(goodCell);
      expect(await page.evaluate((c) => (window as any).__test.ownerOf(c), goodCell)).toBe(1);
      expect(cells.cells[0]).toBe(START_DISC_CELLS);
      await settle(page, 1);
      expect(await text(page, 'nation-name')).toBe('Zorland');
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('the flag preview is drawn with at least two dominant colours that match its spec within dE 10, and a new flag changes it', async () => {
    const { page, messages } = await open('test=1&menu=1&hud=1');
    try {
      await openSetup(page);
      await page.click(tid('setup-tab-custom'));
      await page.click(tid('setup-color-4'));
      const read = async (): Promise<{ spec: string; px: number[] }> =>
        page.evaluate(() => {
          const c = document.querySelector('[data-testid="setup-flag"]') as HTMLCanvasElement;
          const copy = document.createElement('canvas'); // a copy that is meant to be read (the page's own canvas is only drawn)
          copy.width = c.width;
          copy.height = c.height;
          const ctx = copy.getContext('2d', { willReadFrequently: true })!;
          ctx.drawImage(c, 0, 0);
          return { spec: c.dataset.spec ?? '', px: Array.from(ctx.getImageData(0, 0, c.width, c.height).data) };
        });
      const dominant = (px: number[], hex: string): number => {
        const want = rgbOfHex(parseInt(hex.slice(1), 16));
        let n = 0;
        for (let i = 0; i < px.length; i += 4) if (deltaE76Rgb([px[i] as number, px[i + 1] as number, px[i + 2] as number], want) < 10) n++;
        return n / (px.length / 4);
      };
      const a = await read();
      const colors = a.spec.match(/#[0-9a-f]{6}/g)!;
      expect(colors.length).toBe(2);
      expect(parseInt(colors[0]!.slice(1), 16)).toBe(0x6a2d91); // the swatch the player chose is the field colour
      for (const c of colors) expect(dominant(a.px, c), `${c} in ${a.spec}`).toBeGreaterThan(0.08);
      await page.click(tid('setup-reroll'));
      const b = await read();
      expect(b.spec).not.toBe(a.spec);
      expect(b.px.join(',')).not.toBe(a.px.join(','));
      for (const c of b.spec.match(/#[0-9a-f]{6}/g)!) expect(dominant(b.px, c), `${c} in ${b.spec}`).toBeGreaterThan(0.08);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

describe('disabled countries and the options', () => {
  it('a country with a land mass below K is disabled with "X of 197 cells"; it can be looked at but not started; the AI count follows the area', async () => {
    const { page, messages } = await open('test=1&menu=1&hud=1');
    try {
      const all: Array<{ a3: string; ok: boolean; reasonKey: string | null; landmass: number; id: number }> = await page.evaluate(() => (window as any).__test.setupCountries());
      expect(all.filter((c) => c.ok).length).toBeGreaterThan(100);
      const small = all.find((c) => c.reasonKey === 'setup.reason.smallLandmass' && c.landmass > 0)!;
      expect(small).toBeDefined();
      await openSetup(page);
      const row = page.locator(`${tid('setup-row')}[data-a3="${small.a3}"]`);
      expect(await row.getAttribute('data-ok')).toBe('0');
      expect(await row.getAttribute('aria-disabled')).toBe('true');
      expect(await row.locator('.setup-row-why').textContent()).toBe((TABLES.sv['setup.reason.smallLandmass'] as string).replace('{cells}', String(small.landmass)).replace('{need}', '197'));
      await row.click({ force: true }); // aria-disabled: a person can still click it, to read why it cannot be played
      expect(await page.locator(tid('setup-start')).isDisabled()).toBe(true);
      expect(await page.locator(tid('setup-status')).getAttribute('data-kind')).toBe('bad');
      expect(await page.locator(tid('setup-status')).textContent()).toContain(`av 197 celler`);
      // a country with fewer than 8 cells says so
      const tiny = all.find((c) => c.reasonKey === 'setup.reason.tooFewCells')!;
      expect(await page.locator(`${tid('setup-row')}[data-a3="${tiny.a3}"] .setup-row-why`).textContent()).toMatch(/av 8 celler/);
      // the area: East Asia has 10 countries, so at most 9 AI nations
      const japan = all.find((c) => c.a3 === 'JPN')!;
      await page.fill('#setup-search', '');
      await page.locator(`${tid('setup-row')}[data-a3="${japan.a3}"]`).click();
      await page.selectOption('#setup-region', 'eastAsia');
      const max = Number(await page.locator('#setup-ai').getAttribute('data-max'));
      expect(max).toBeGreaterThan(5);
      expect(max).toBeLessThanOrEqual(9);
      expect(await page.locator('#setup-ai').getAttribute('max')).toBe(String(max));
      expect(await page.locator(tid('setup-ai-value')).textContent()).toContain(`${Math.min(12, max)}`);
      await shot(page, 'setup-eastasia');
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('Skirmish: in a Europe match no cell outside the area is ever owned, while the nations grow for 4 minutes', async () => {
    const { page, messages } = await open('test=1&menu=1&hud=1&seed=4');
    try {
      await openSetup(page);
      await page.selectOption('#setup-region', 'europe');
      await page.fill('#setup-search', 'Germany');
      await page.locator(tid('setup-row')).first().click();
      await page.evaluate(() => {
        const ai = document.querySelector('#setup-ai') as HTMLInputElement;
        ai.value = '8';
        ai.dispatchEvent(new Event('input', { bubbles: true }));
      });
      expect(await page.locator(tid('setup-ai-value')).getAttribute('data-value')).toBe('8');
      await page.click(tid('setup-start'));
      await page.waitForSelector(tid('match-hud'), { timeout: 60_000 });
      expect(await page.evaluate(() => (window as any).__test.ownedOutside('europe'))).toBe(0);
      let last = 0;
      for (let i = 0; i < 4; i++) {
        const r = await page.evaluate(() => (window as any).__test.run(60));
        expect(r.ticks).toBeGreaterThanOrEqual(590);
        expect(await page.evaluate(() => (window as any).__test.ownedOutside('europe')), `after ${i + 1} min`).toBe(0);
        last = (await page.evaluate(() => (window as any).__test.state())).seats.reduce((a: number, s: any) => a + s.cells, 0);
      }
      expect(last).toBeGreaterThan(9 * START_DISC_CELLS); // the nations hold land (and grew)
      await page.evaluate(() => (window as any).__test.setView({ lat: 50, lon: 10, distKm: 4500, heading: 0, tilt: 0 }));
      await shot(page, 'europe-after-4min');
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  }, 240_000);

  it('"No real borders": no country lines or names, invented names for the AI nations, no country in the tooltip', async () => {
    const { page, messages } = await open('test=1&menu=1&hud=1&seed=6');
    try {
      await openSetup(page);
      await page.click(tid('setup-tab-custom'));
      const cell = interiorCell(5000, Infinity, { lat: 48, lon: 11 });
      const at = await aimAt(page, cell, 1900);
      await page.mouse.click(at.x, at.y);
      // with real borders the tooltip names the country; the lines are drawn
      const tipReal = await page.evaluate(([x, y]) => (window as any).__test.tooltip(x, y), [at.x + 40, at.y] as const);
      expect(tipReal).toMatch(/^(Tyskland|Österrike|Tjeckien|Polen|Slovakien|Ungern|Italien|Schweiz|Frankrike)/);
      const lines = await shot(page, 'borders-on');
      expect(await page.locator(tid('setup-neutral')).isDisabled()).toBe(false);
      await page.click(tid('setup-neutral'));
      const noLines = await shot(page, 'borders-off');
      const a = decodePng(lines);
      const b = decodePng(noLines);
      let diff = 0;
      for (let y = 0; y < a.height; y++) for (let x = 380; x < a.width; x++) if (Math.abs((a.data[(y * a.width + x) * 4 + 1] as number) - (b.data[(y * a.width + x) * 4 + 1] as number)) > 6) diff++;
      console.log(`[setup] pixels that changed when the country lines were switched off: ${diff}`);
      expect(diff).toBeGreaterThan(300);
      await page.click(tid('setup-start'));
      await page.waitForSelector(tid('match-hud'), { timeout: 30_000 });
      const tip = await page.evaluate(([x, y]) => (window as any).__test.tooltip(x, y), [at.x + 40, at.y] as const);
      expect(tip).toMatch(/^Mark · /);
      const names = await page.locator(tid('leader-row')).evaluateAll((els) => els.map((e) => e.querySelector('.hud-name')?.textContent ?? ''));
      const real = new Set(world.countries.flatMap((c) => [c.nameEn, c.nameSv]));
      expect(names.length).toBeGreaterThan(3);
      for (const n of names) expect(real.has(n), n).toBe(false);
      await settle(page, 3);
      await shot(page, 'neutral-hud');
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

describe('storage and the address', () => {
  it('the choices are remembered (preferences) and come back after a reload; the seed of the address wins', async () => {
    const { page, messages } = await open('test=1&menu=1&hud=1');
    try {
      await openSetup(page);
      await page.click(tid('setup-tab-custom'));
      await page.fill('#setup-name', 'Remember');
      await page.selectOption('#setup-region', 'europe');
      await page.fill('#setup-seed', '42');
      await page.selectOption('#setup-difficulty', 'hard');
      await page.reload({ waitUntil: 'load' });
      await page.waitForFunction(() => (window as any).__test !== undefined);
      await openSetup(page);
      expect(await page.locator(tid('setup-tab-custom')).getAttribute('aria-selected')).toBe('true');
      expect(await page.inputValue('#setup-name')).toBe('Remember');
      expect(await page.inputValue('#setup-region')).toBe('europe');
      expect(await page.inputValue('#setup-seed')).toBe('42');
      expect(await page.inputValue('#setup-difficulty')).toBe('hard');
      // an address with a seed (the Dev panel's seed field writes it) overrides the stored seed
      await page.goto(`${baseUrl}/?test=1&menu=1&hud=1#seed-9`, { waitUntil: 'load' });
      await page.waitForFunction(() => (window as any).__test !== undefined);
      await openSetup(page);
      expect(await page.inputValue('#setup-seed')).toBe('9');
      expect(await page.inputValue('#setup-name')).toBe('Remember');
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('with localStorage blocked the whole flow still works: menu, setup, a country, Start, the HUD', async () => {
    const ctx: BrowserContext = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
    await ctx.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new DOMException('blocked', 'SecurityError');
        },
      });
    });
    const page = await ctx.newPage();
    const messages: Msg[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') messages.push({ type: m.type(), text: m.text() });
    });
    page.on('pageerror', (e) => messages.push({ type: 'error', text: `pageerror: ${e.message}` }));
    try {
      await page.goto(`${baseUrl}/?test=1&menu=1&hud=1`, { waitUntil: 'load' });
      await page.waitForFunction(() => (window as any).__test !== undefined);
      expect(await page.evaluate(() => { try { void localStorage.length; return 'works'; } catch { return 'blocked'; } })).toBe('blocked');
      await openSetup(page);
      await page.fill('#setup-search', 'Japan');
      await page.locator(tid('setup-row')).first().click();
      await page.click(tid('setup-start'));
      await page.waitForSelector(tid('match-hud'), { timeout: 30_000 });
      expect(await text(page, 'nation-name')).toBe('Japan');
      expect(messages).toEqual([]);
    } finally {
      await ctx.close();
    }
  });
});

describe('the same config and seed give the same state in Node and in Chromium', () => {
  it('the four golden matches have the committed hashes at tick 0 and after 600 ticks of play', async () => {
    const golden = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'goldens/match-hashes.json'), 'utf8')) as { ticks: number; hashes: Record<string, { initial: string; after: string }> };
    const { page, messages } = await open('test=1&menu=1');
    try {
      const configs = goldenConfigs(world);
      for (const [name, config] of Object.entries(configs)) {
        const r = await page.evaluate(([c, t]) => (window as any).__test.buildHash(c, t), [config, golden.ticks] as const);
        expect(r.ok, name).toBe(true);
        expect(r.initial, `${name} at tick 0`).toBe(golden.hashes[name]!.initial);
        expect(r.after, `${name} after ${golden.ticks} ticks`).toBe(golden.hashes[name]!.after);
        // and twice in the same page: the same
        const again = await page.evaluate(([c]) => (window as any).__test.buildHash(c, 0), [config, 0] as const);
        expect(again.initial).toBe(r.initial);
      }
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  }, 240_000);

  it('a config the setup refuses gives an error result in the page, never an exception', async () => {
    const { page, messages } = await open('test=1&menu=1');
    try {
      const small = (await page.evaluate(() => (window as any).__test.setupCountries())).find((c: any) => !c.ok);
      const r = await page.evaluate((id) => (window as any).__test.buildHash({ seed: 1, region: 'world', player: { kind: 'real', countryId: id }, aiNations: 12, tribes: true, difficulty: 'normal', neutral: false, humanSeat: 0, spawnPhase: true, debugIntents: false }, 0), small.id);
      expect(r.ok).toBe(false);
      expect(r.code).toBe('notSelectable');
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

describe('layouts and the way back', () => {
  it('Back returns to the menu, the outline goes away, and the setup opens again with the same choice (preferences)', async () => {
    const { page, messages } = await open('test=1&menu=1&hud=1');
    try {
      await openSetup(page);
      await page.fill('#setup-search', 'Sweden');
      await page.locator(tid('setup-row')).first().click();
      await settle(page, 3.5);
      const withOutline = amberPixels(await shot(page, 'back-0-outline'), 380);
      expect(withOutline).toBeGreaterThan(400);
      await page.click(tid('setup-back'));
      await settle(page, 0.3);
      expect(await page.locator(tid('setup-screen')).count()).toBe(0);
      expect(await page.locator(tid('start-screen')).isVisible()).toBe(true);
      expect(amberPixels(await shot(page, 'back-1-menu'), 0)).toBeLessThan(50);
      await page.click(tid('start-setup'));
      await page.waitForSelector(tid('setup-screen'));
      await settle(page, 3.5);
      expect(await page.locator(`${tid('setup-row')}[data-selected="1"]`).getAttribute('data-a3')).toBe('SWE');
      expect(amberPixels(await shot(page, 'back-2-again'), 380)).toBeGreaterThan(400);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('on a 390x844 phone the setup is a bottom sheet, the country is flown into the free part above it, and the HUD of a built match keeps banner, leaderboard and Dev button apart', async () => {
    const { page, messages } = await open('test=1&menu=1&hud=1&devbtn=1&w=390&h=844', { width: 390, height: 844 });
    try {
      await openSetup(page);
      const panel = (await page.locator(tid('setup-panel')).boundingBox())!;
      expect(panel.x).toBeLessThanOrEqual(1);
      expect(panel.x + panel.width).toBeGreaterThanOrEqual(389);
      expect(panel.y).toBeGreaterThan(844 * 0.35); // the globe keeps the upper part of the screen
      expect(panel.y + panel.height).toBeLessThanOrEqual(845);
      await page.fill('#setup-search', 'Japan');
      await page.locator(tid('setup-row')).first().click();
      await settle(page, 3.5);
      const japan = world.countries.find((c) => c.a3 === 'JPN')!;
      const at = latLonOfCell(japan.capitalCell, 1024, 512);
      const p = await page.evaluate(([la, lo]) => (window as any).__test.project(la, lo), [at.lat, at.lon] as const);
      expect(p.inView && p.facing).toBe(true);
      expect(p.y).toBeLessThan(panel.y); // above the sheet
      await shot(page, 'phone-japan');
      // the standard targets: every control of the sheet is at least 44 px tall
      for (const id of ['setup-start', 'setup-back', 'setup-language', 'setup-tab-real', 'setup-tab-custom']) {
        const b = (await page.locator(tid(id)).boundingBox())!;
        expect(b.height, id).toBeGreaterThanOrEqual(TARGET_MIN_PX - 1);
      }
      await page.click(tid('setup-start'));
      await page.waitForSelector(tid('match-hud'), { timeout: 30_000 });
      await settle(page, 3);
      const box = async (sel: string): Promise<{ x: number; y: number; width: number; height: number }> => {
        const b = await page.locator(sel).first().boundingBox();
        if (b === null) throw new Error(`${sel} has no box`);
        return b;
      };
      const banner = await box(tid('phase'));
      const board = await box(tid('leaderboard'));
      const dev = await box('[data-dev-button]');
      const overlap = (a: typeof banner, b: typeof banner): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
      expect(overlap(banner, board)).toBe(false);
      expect(overlap(banner, dev)).toBe(false);
      expect(overlap(board, dev)).toBe(false);
      expect(board.x + board.width).toBeLessThanOrEqual(390);
      expect(board.x).toBeGreaterThanOrEqual(0);
      await shot(page, 'phone-hud');
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('at 1920x1080 the panel fits, its targets are large and the HUD with names and flags is readable (screenshots)', async () => {
    const { page, messages } = await open('test=1&menu=1&hud=1&w=1920&h=1080', { width: 1920, height: 1080 });
    try {
      await openSetup(page, 0.75);
      const panel = (await page.locator(tid('setup-panel')).boundingBox())!;
      expect(panel.y).toBeGreaterThanOrEqual(0);
      expect(panel.y + panel.height).toBeLessThanOrEqual(1080);
      expect(panel.width).toBeLessThan(1920 * 0.35);
      await page.fill('#setup-search', 'Germany');
      await page.locator(tid('setup-row')).first().click();
      await settle(page, 3.5, 0.5);
      await shot(page, 'hd-germany');
      await page.click(tid('setup-start'));
      await page.waitForSelector(tid('match-hud'), { timeout: 30_000 });
      await settle(page, 3, 0.5);
      await page.evaluate(() => (window as any).__test.run(20));
      await shot(page, 'hd-hud');
      for (const id of ['status', 'leaderboard', 'controls', 'nation']) {
        const b = (await page.locator(tid(id)).boundingBox())!;
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width).toBeLessThanOrEqual(1920);
        expect(b.y + b.height).toBeLessThanOrEqual(1080);
      }
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});
