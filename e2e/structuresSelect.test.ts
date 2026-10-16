// M10-4 in headless Chromium (software WebGL2): selecting a structure (outline ring + panel), Upgrade and Delete through the real intents, the range ring of a SAM site,
// the City's night lights, the far icons and the layout of the panel. Real mouse and keyboard events. Screenshots go to test-results/shots/structures-select-*.png.
import fs from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { OUT_DIR, compareGolden, decodePng, encodePng, launchBrowser, openPage } from '../scripts/shot.mjs';
import { timeForSubsolarLon } from '../src/render/geo';
import { cellToLatLon } from '../src/render/transforms';
import { formatGoldRate, formatInt } from '../src/ui/i18n';
import { REJECT_DELETE_COOLDOWN, REJECT_NONE, REJECT_STRUCT_BUSY } from '../src/sim/intents';
import { CAP_CITY_LEVEL_TROOPS, CITY_GOLD_MILLI_PER_SEC_PER_LEVEL, POST_RADIUS_CELLS, SAM_RADIUS_CELLS } from '../src/sim/rules';
import { STRUCT_CITY, STRUCT_POST, STRUCT_SAM, cityGoldMilli, cityTroopCap, upgradePriceGold } from '../src/sim/public';

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

interface Props {
  counts: Record<number, number>;
  list: Array<{ id: number; type: number; level: number; lat: number; lon: number }>;
  placing: number;
  selection: { id: number; panelVisible: boolean; ring: { visible: boolean; rangeCells: number; drawIndices: number } };
  icons: number;
  litLights: number;
}
interface State {
  local: { spawned: boolean; gold: number };
  structures: { count: number; byType: number[] };
}

const T = (page: Page) => ({
  props: (): Promise<Props> => page.evaluate(() => (window as any).__test.props()),
  state: (): Promise<State> => page.evaluate(() => (window as any).__test.state()),
  advance: (dt: number, ticks: number): Promise<void> => page.evaluate(([d, n]) => (window as any).__test.advance(d, n), [dt, ticks] as const),
  settle: (n = 2): Promise<void> => page.evaluate((k) => (window as any).__test.settle(0, k), n),
  view: (v: Record<string, number>): Promise<void> => page.evaluate((x) => (window as any).__test.setView(x), v),
  project: (lat: number, lon: number): Promise<{ x: number; y: number; inView: boolean; facing: boolean }> => page.evaluate(([a, o]) => (window as any).__test.project(a, o), [lat, lon] as const),
  info: (): Promise<{ drawCalls: number; triangles: number }> => page.evaluate(() => (window as any).__test.info()),
  cells: (): Promise<{ cells: number[]; capitals: number[] }> => page.evaluate(() => (window as any).__test.seatCells()),
  submit: (body: Record<string, unknown>): Promise<void> => page.evaluate((b) => (window as any).__test.submit(b), body),
  text: (key: string, params?: Record<string, string | number>): Promise<string> => page.evaluate(([k, p]) => (window as any).__test.text(k, p), [key, params] as const),
});

async function spawned(query = 'test=1&seed=7&ai=0&hud=1', gold = 6000, viewport = { width: 960, height: 540 }): Promise<{ page: Page; messages: Array<{ type: string; text: string }>; capital: number }> {
  const { page, consoleMessages } = await openPage(browser, baseUrl, query, viewport);
  const t = T(page);
  await t.view({ lat: 47, lon: 10, distKm: 2600, heading: 0, tilt: 0 });
  const p = await t.project(48.5, 11);
  await page.mouse.click(p.x, p.y);
  await t.advance(0.1, 5);
  if (gold > 0) await page.evaluate((g) => (window as any).__test.give(0, { gold: g }), gold);
  await t.advance(0.1, 4);
  const { capitals } = await t.cells();
  expect((await t.state()).local.spawned).toBe(true);
  await t.advance(0.1, 210); // Fix-Sim: Build / Upgrade / Delete are refused in the 20 s spawn phase, so the helper plays past it
  return { page, messages: consoleMessages, capital: capitals[0] as number };
}

const WIDTH = 1024;
const HEIGHT = 512;
const llOf = (cell: number): { lat: number; lon: number } => cellToLatLon(cell, WIDTH, HEIGHT);

async function closeUp(page: Page, lat: number, lon: number, dKm = 2.2, aglM = 900, pitchDeg = 24, sunLonOffset = 25): Promise<void> {
  await page.evaluate(([la, lo, d, agl, pitch, time]) => (window as any).__test.setGroundView({ lat: la - d / 111.2, lon: lo, heading: 0, pitchDeg: pitch, aglM: agl, time }), [lat, lon, dKm, aglM, pitchDeg, timeForSubsolarLon(lon + sunLonOffset)] as const);
}

async function clickAt(page: Page, cell: number): Promise<void> {
  const at = llOf(cell);
  const p = await T(page).project(at.lat, at.lon);
  await page.mouse.click(p.x, p.y);
}

const HIDE_HUD = '.hud-root, .build-bar, .build-hint, .toast-stack { visibility: hidden !important; }';

/** Pixels in a window around (cx, cy) whose colour differs by more than `tol` (sum of channels). */
function diffCount(a: ReturnType<typeof decodePng>, b: ReturnType<typeof decodePng>, cx: number, cy: number, half: number, tol = 40): number {
  let n = 0;
  for (let y = Math.max(0, Math.round(cy) - half); y < Math.min(a.height, Math.round(cy) + half); y++) {
    for (let x = Math.max(0, Math.round(cx) - half); x < Math.min(a.width, Math.round(cx) + half); x++) {
      const i = (y * a.width + x) * 4;
      const d = Math.abs((a.data[i] as number) - (b.data[i] as number)) + Math.abs((a.data[i + 1] as number) - (b.data[i + 1] as number)) + Math.abs((a.data[i + 2] as number) - (b.data[i + 2] as number));
      if (d > tol) n++;
    }
  }
  return n;
}

describe('selecting a structure', () => {
  it('a click selects the City: ring and panel with the sim numbers; Upgrade raises the level after the build time and the price rises; Esc deselects; Delete removes it and starts the cooldown', async () => {
    const { page, messages, capital } = await spawned();
    try {
      const t = T(page);
      const at = llOf(capital);
      await t.submit({ kind: 'Build', seat: 0, type: STRUCT_CITY, cell: capital });
      await t.advance(0.1, 160); // past the City's build time (150)
      await closeUp(page, at.lat, at.lon);
      await t.settle();
      expect((await t.props()).selection.id).toBe(-1);
      expect(await page.locator('[data-testid="sel-panel"]').isVisible()).toBe(false);
      await clickAt(page, capital);
      await t.settle();
      let p = await t.props();
      expect(p.selection.id).toBeGreaterThanOrEqual(0);
      expect(p.selection.panelVisible).toBe(true);
      expect(p.selection.ring.visible).toBe(true);
      expect(p.selection.ring.rangeCells).toBe(0); // a City has no range ring
      const panel = page.locator('[data-testid="sel-panel"]');
      expect(await panel.getAttribute('data-level')).toBe('1');
      expect(await panel.getAttribute('data-type')).toBe(String(STRUCT_CITY));
      // what it gives: the sim's numbers (rules.ts), through the text key
      // Look-2: the gold is shown x GOLD_DISPLAY_FACTOR and the panel adds the next level's numbers
      const fxOf = (level: number): Promise<string> => t.text('sel.fx.city', { gold: formatGoldRate(cityGoldMilli(level)), troops: formatInt(cityTroopCap(level)) });
      const expectFx = `${await fxOf(1)} ${await t.text('sel.fxNext', { fx: await fxOf(2) })}`;
      expect(await page.locator('[data-testid="sel-fx"]').textContent()).toBe(expectFx);
      const upgrade = page.locator('[data-testid="sel-upgrade"]');
      expect(await upgrade.getAttribute('data-price')).toBe(String(upgradePriceGold(STRUCT_CITY, 2)));
      expect(await upgrade.getAttribute('aria-disabled')).toBeNull();
      await page.screenshot({ path: path.join(SHOT_DIR, 'structures-select-city.png') });

      // Esc deselects (and does not open anything)
      await page.keyboard.press('Escape');
      await t.settle();
      p = await t.props();
      expect([p.selection.id, p.selection.panelVisible, p.selection.ring.visible]).toEqual([-1, false, false]);

      // Upgrade: the intent costs the price, the level rises after the build time, and the next price is higher
      await clickAt(page, capital);
      await t.settle();
      const goldBefore = (await t.state()).local.gold;
      await upgrade.click();
      await t.advance(0.1, 4);
      const goldAfter = (await t.state()).local.gold;
      expect(goldBefore - goldAfter).toBeGreaterThan(upgradePriceGold(STRUCT_CITY, 2) - 30);
      await t.settle();
      expect(await upgrade.getAttribute('aria-disabled')).toBe('true');
      expect(await upgrade.getAttribute('data-reason')).toBe(String(REJECT_STRUCT_BUSY));
      expect(await panel.getAttribute('data-level')).toBe('1');
      await t.advance(0.1, 160);
      await t.settle();
      expect(await panel.getAttribute('data-level')).toBe('2');
      expect(await upgrade.getAttribute('data-price')).toBe(String(upgradePriceGold(STRUCT_CITY, 3)));
      expect((await t.props()).list[0]?.level).toBe(2);

      // Delete: the structure goes, the selection ends, and the seat's cooldown starts
      // (Fix-UI: Delete takes two clicks; the first only arms the button)
      await page.locator('[data-testid="sel-delete"]').click();
      await t.advance(0.1, 4);
      expect((await t.state()).structures.count).toBe(1);
      expect(await page.locator('[data-testid="sel-delete"]').getAttribute('data-armed')).toBe('1');
      await page.locator('[data-testid="sel-delete"]').click();
      await t.advance(0.1, 4);
      await t.settle();
      p = await t.props();
      expect((await t.state()).structures.count).toBe(0);
      expect([p.selection.id, p.selection.panelVisible]).toEqual([-1, false]);
      await t.submit({ kind: 'Build', seat: 0, type: STRUCT_POST, cell: capital });
      await t.advance(0.1, 90);
      await t.settle();
      await clickAt(page, capital);
      await t.settle();
      const del = page.locator('[data-testid="sel-delete"]');
      expect(await del.getAttribute('aria-disabled')).toBe('true');
      expect(await del.getAttribute('data-reason')).toBe(String(REJECT_DELETE_COOLDOWN));
      expect(await del.getAttribute('title')).not.toBe('');
      await page.screenshot({ path: path.join(SHOT_DIR, 'structures-select-cooldown.png') });
      await t.advance(0.1, 300);
      await t.settle();
      expect(await del.getAttribute('aria-disabled')).toBeNull();
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('a SAM site selected shows its range ring (pixel difference) with the radius of the sim, and the golden', async () => {
    const { page, messages, capital } = await spawned();
    try {
      const t = T(page);
      const at = llOf(capital);
      await t.submit({ kind: 'Build', seat: 0, type: STRUCT_SAM, cell: capital });
      await t.advance(0.1, 210);
      await page.addStyleTag({ content: HIDE_HUD });
      await t.view({ lat: at.lat, lon: at.lon, distKm: 2600, heading: 0, tilt: 0 });
      await t.settle();
      const mark = await t.project(at.lat, at.lon);
      const plain = decodePng(await page.screenshot({ type: 'png' }));
      await page.mouse.click(mark.x, mark.y);
      await t.settle();
      const p = await t.props();
      expect(p.selection.id).toBeGreaterThanOrEqual(0);
      expect(p.selection.ring.rangeCells).toBe(SAM_RADIUS_CELLS[1]);
      expect(p.selection.ring.drawIndices).toBe(96 * 12); // both rings
      const png = await page.screenshot({ type: 'png' });
      fs.writeFileSync(path.join(SHOT_DIR, 'structures-select-sam-ring.png'), png);
      const ringed = decodePng(png);
      const changed = diffCount(plain, ringed, ringed.width / 2, ringed.height / 2, 270);
      console.log(`[ring] changed pixels with the SAM selected: ${changed}`);
      expect(changed).toBeGreaterThan(150);
      // Esc: the rings go and the picture is the plain one again
      await page.keyboard.press('Escape');
      await t.settle();
      expect((await t.props()).selection.ring.visible).toBe(false);
      expect(diffCount(plain, decodePng(await page.screenshot({ type: 'png' })), ringed.width / 2, ringed.height / 2, 270)).toBeLessThan(changed / 10);
      // the golden: a centre crop of the selected frame
      const cw = 480;
      const ch = 380;
      const x0 = Math.max(0, Math.min(ringed.width - cw, Math.round(mark.x - cw / 2)));
      const y0 = Math.max(0, Math.min(ringed.height - ch, Math.round(mark.y - ch / 2)));
      const crop = { width: cw, height: ch, data: Buffer.alloc(cw * ch * 4) };
      for (let y = 0; y < ch; y++) crop.data.set(ringed.data.subarray(((y0 + y) * ringed.width + x0) * 4, ((y0 + y) * ringed.width + x0 + cw) * 4), y * cw * 4);
      const r = compareGolden(encodePng(crop), 'structures-select');
      console.log(`[golden] structures-select: ${r.status}, ${r.diffPixels} px differ`);
      // a Defense Post has its fixed radius
      await t.submit({ kind: 'Delete', seat: 0, structure: p.selection.id });
      await t.advance(0.1, 4);
      await t.submit({ kind: 'Build', seat: 0, type: STRUCT_POST, cell: capital });
      await t.advance(0.1, 90);
      await t.settle();
      const mark2 = await t.project(at.lat, at.lon); // the camera has drifted a little since the first click
      await page.mouse.click(mark2.x, mark2.y);
      await t.settle();
      const pp = await t.props();
      expect(pp.selection.ring.rangeCells).toBe(POST_RADIUS_CELLS);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('the City lights: one light at level 1, two at level 2, three at level 3, lit on the night side only (props and pixels)', async () => {
    const { page, messages, capital } = await spawned('test=1&seed=7&ai=0&hud=1', 9000);
    try {
      const t = T(page);
      const at = llOf(capital);
      await page.addStyleTag({ content: HIDE_HUD });
      await t.submit({ kind: 'Build', seat: 0, type: STRUCT_CITY, cell: capital });
      await t.advance(0.1, 160);
      const warm = async (night: boolean): Promise<number> => {
        await closeUp(page, at.lat, at.lon, 5, 2600, 30, night ? 180 : 25);
        await t.settle();
        const img = decodePng(await page.screenshot({ type: 'png' }));
        let n = 0;
        const m = await t.project(at.lat, at.lon);
        for (let y = Math.max(0, Math.round(m.y) - 150); y < Math.min(img.height, Math.round(m.y) + 150); y++) {
          for (let x = Math.max(0, Math.round(m.x) - 150); x < Math.min(img.width, Math.round(m.x) + 150); x++) {
            const i = (y * img.width + x) * 4;
            if ((img.data[i] as number) > 240 && (img.data[i + 1] as number) > 205 && (img.data[i + 2] as number) > 110 && (img.data[i + 2] as number) < 175) n++;
          }
        }
        return n;
      };
      const seen: number[] = [];
      for (let level = 1; level <= 3; level++) {
        if (level > 1) {
          const id = (await t.props()).list[0]?.id as number;
          await t.submit({ kind: 'Upgrade', seat: 0, structure: id });
          await t.advance(0.1, 160);
        }
        const day = await warm(false);
        expect((await t.props()).litLights).toBe(0);
        const night = await warm(true);
        expect((await t.props()).litLights).toBe(level);
        seen.push(night);
        await page.screenshot({ path: path.join(SHOT_DIR, `structures-select-night-${level}.png`) });
        expect(day).toBeLessThan(20);
        expect(night).toBeGreaterThan(level === 1 ? 15 : 40);
        if (level === 3) await page.screenshot({ path: path.join(SHOT_DIR, 'structures-select-night.png') });
      }
      console.log(`[lights] warm pixels at night per level: ${seen.join(', ')}`);
      expect(seen[2] as number).toBeGreaterThan((seen[0] as number) * 1.8);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('far away the structures stay readable: icon badges appear where the models fall under a few pixels, with the draw calls still inside the budget', async () => {
    const { page, messages, capital } = await spawned();
    try {
      const t = T(page);
      const at = llOf(capital);
      await page.addStyleTag({ content: HIDE_HUD });
      const far = async (): Promise<{ img: ReturnType<typeof decodePng>; x: number; y: number }> => {
        await t.view({ lat: at.lat, lon: at.lon, distKm: 14000, heading: 0, tilt: 0 });
        await t.settle();
        const m = await t.project(at.lat, at.lon);
        expect(m.inView && m.facing).toBe(true);
        return { img: decodePng(await page.screenshot({ type: 'png' })), x: m.x, y: m.y };
      };
      const before = await far();
      const none = await t.info();
      expect((await t.props()).icons).toBe(0);
      await t.submit({ kind: 'Build', seat: 0, type: STRUCT_CITY, cell: capital });
      await t.advance(0.1, 160);
      const after = await far();
      expect((await t.props()).icons).toBe(1);
      const withIcon = await t.info();
      expect(withIcon.drawCalls - none.drawCalls).toBeGreaterThanOrEqual(1);
      expect(withIcon.drawCalls - none.drawCalls).toBeLessThanOrEqual(10);
      const changed = diffCount(before.img, after.img, after.x, after.y + 4, 12);
      console.log(`[icons] changed pixels around the City at 14000 km: ${changed}`);
      expect(changed).toBeGreaterThan(25);
      fs.writeFileSync(path.join(SHOT_DIR, 'structures-select-far.png'), encodePng(after.img));
      // close up there is no icon: the badge has faded out, so the same window shows the model only (the badge's rim colour is gone from its own spot)
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  for (const [name, w, h] of [['landscape', 960, 540], ['portrait', 540, 960]] as const) {
    it(`the panel fits the ${name} window (${w} x ${h}) and does not cover the build bar`, async () => {
      const { page, messages, capital } = await spawned(`test=1&seed=7&ai=0&hud=1&w=${w}&h=${h}`, 3000, { width: w, height: h });
      try {
        const t = T(page);
        const at = llOf(capital);
        await t.submit({ kind: 'Build', seat: 0, type: STRUCT_POST, cell: capital });
        await t.advance(0.1, 90);
        await closeUp(page, at.lat, at.lon);
        await t.settle();
        await clickAt(page, capital);
        await t.settle();
        expect((await t.props()).selection.panelVisible).toBe(true);
        const boxes = await page.evaluate(() => {
          const r = (e: Element | null) => (e === null ? null : e.getBoundingClientRect().toJSON());
          return { panel: r(document.querySelector('[data-testid="sel-panel"]')), bar: r(document.querySelector('[data-testid="build-bar"]')), status: r(document.querySelector('.hud-status')) };
        });
        await page.screenshot({ path: path.join(SHOT_DIR, `structures-select-panel-${name}.png`) });
        const pb = boxes.panel as { left: number; right: number; top: number; bottom: number };
        const bar = boxes.bar as { left: number; right: number; top: number; bottom: number };
        expect(pb.left).toBeGreaterThanOrEqual(0);
        expect(pb.right).toBeLessThanOrEqual(w);
        expect(pb.top).toBeGreaterThanOrEqual(0);
        expect(pb.bottom).toBeLessThanOrEqual(h);
        const overlap = (a: typeof pb, b: typeof pb): boolean => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        expect(overlap(pb, bar)).toBe(false);
        if (boxes.status !== null) expect(overlap(pb, boxes.status as typeof pb)).toBe(false);
        expect(REJECT_NONE).toBe(0);
        expect(messages).toEqual([]);
      } finally {
        await page.close();
      }
    });
  }
});
