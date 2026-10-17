// Ctx-1 in headless Chromium (software WebGL2): the right-click menu. A right click on another nation's land opens it (Attack, Send helicopter here, Send ship here, Diplomacy), on your own
// land it offers "Build here" (a build goes straight onto the cell), on your own buildings the building's entries; a helicopter or ship chosen from it opens the mode with the target
// ALREADY picked (route, marker, verdict) and a Send button. The menu fits and can be used with the keyboard at 960x540, 1366x640 and 540x960 in Swedish and English, Escape closes it,
// the map does not drag or zoom under it. Screenshots go to test-results/shots/ctx-*.png (the task asks for four: other land with every entry, own land, own Factory, dimmed entries).
import fs from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { OUT_DIR, launchBrowser, openPage } from '../scripts/shot.mjs';
import { cellToLatLon } from '../src/render/transforms';
import { HELI_PAD } from '../src/sim/heliTable';
import { BUILD_TICKS, HELI_BUILD_TICKS } from '../src/sim/rules';
import { findShipRoute, hasWaterWithinReach, portWaterCell, ShipRoute, SHIP_ROUTE_OK } from '../src/sim/shipRoute';
import { isCoastCell, STRUCT_CITY, STRUCT_FACTORY, STRUCT_PORT } from '../src/sim/structureRules';
import { CLASS_DEEP_SEA, CLASS_HILLS, CLASS_MOUNTAIN, CLASS_PEAK, CLASS_SHALLOWS, isPlayableClass } from '../src/sim/terrain';
import { TARGET_MIN_PX } from '../src/ui/uiConfig';
import { worldLoader } from '../tests/helpers/dataFiles';

let browser: Browser;
const baseUrl = inject('baseUrl');
const SHOT_DIR = path.join(OUT_DIR, 'shots');
const WIDTH = 1024;
const HEIGHT = 512;
beforeAll(async () => {
  ({ browser } = await launchBrowser());
  fs.mkdirSync(SHOT_DIR, { recursive: true });
});
afterAll(async () => {
  await browser?.close();
});

type Msg = Array<{ type: string; text: string }>;
const T = (page: Page) => ({
  state: (): Promise<any> => page.evaluate(() => (window as any).__test.state()),
  props: (): Promise<{ toasts: string[]; selection: { id: number; panelVisible: boolean } }> => page.evaluate(() => (window as any).__test.props()),
  advance: (dt: number, ticks: number): Promise<void> => page.evaluate(([d, n]) => (window as any).__test.advance(d, n), [dt, ticks] as const),
  settle: (dt = 0, n = 1): Promise<void> => page.evaluate(([d, k]) => (window as any).__test.settle(d, k), [dt, n] as const),
  render: (): Promise<void> => page.evaluate(() => (window as any).__test.render()),
  view: (v: Record<string, number>): Promise<void> => page.evaluate((x) => (window as any).__test.setView(x), v),
  project: (lat: number, lon: number): Promise<{ x: number; y: number; inView: boolean; facing: boolean }> => page.evaluate(([a, o]) => (window as any).__test.project(a, o), [lat, lon] as const),
  submit: (b: unknown): Promise<void> => page.evaluate((x) => (window as any).__test.submit(x), b),
  menu: (): Promise<{ open: boolean; entries: number }> => page.evaluate(() => (window as any).__test.ctxMenu()),
  deploy: (): Promise<any> => page.evaluate(() => (window as any).__test.deploy()),
  helis: (): Promise<Array<{ id: number; state: number }>> => page.evaluate(() => (window as any).__test.helis()),
  shipMode: (): Promise<any> => page.evaluate(() => (window as any).__test.shipMode()),
  ships: (): Promise<unknown[]> => page.evaluate(() => (window as any).__test.ships()),
  ownerOf: (c: number): Promise<number> => page.evaluate((x) => (window as any).__test.ownerOf(x), c),
  seatCells: (): Promise<{ capitals: number[] }> => page.evaluate(() => (window as any).__test.seatCells()),
});
const tid = (id: string): string => `[data-testid="${id}"]`;
const START = { lat: 48.5, lon: 11 };
const VIEW = { lat: 48.5, lon: 13.5, distKm: 1500, heading: 0, tilt: 0 };

/** A page with the local nation spawned (Munich) and the match in the play phase; seat 1 and seat 2 get a block of land east of the capital. */
async function playing(query: string, viewport = { width: 960, height: 540 }): Promise<{ page: Page; messages: Msg; cx: number; cy: number }> {
  const { page, consoleMessages } = await openPage(browser, baseUrl, query, viewport);
  const tt = T(page);
  await tt.view({ ...VIEW, distKm: 2600 });
  const p = await tt.project(START.lat, START.lon);
  await page.mouse.click(p.x, p.y);
  await tt.advance(0.1, 5);
  expect((await tt.state()).local.spawned).toBe(true);
  const s = await tt.state();
  await tt.advance(0.1, 260 - s.tick);
  await page.evaluate(() => (window as any).__test.give(0, { gold: 90000, troops: 5000 }));
  await tt.advance(0.1, 4);
  const cx = Math.round(((START.lon + 180) / 360) * 1024 - 0.5);
  const cy = Math.round(((90 - START.lat) / 180) * 512 - 0.5);
  await page.evaluate(
    ([x0, y0]) => {
      const t = (window as any).__test;
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = 9; dx <= 22; dx++) t.submit({ kind: 'DebugPaint', seat: 1, cell: (y0 + dy) * 1024 + x0 + dx });
      }
    },
    [cx, cy] as const,
  );
  await tt.advance(0.1, 4);
  await tt.view(VIEW);
  await tt.settle();
  return { page, messages: consoleMessages, cx, cy };
}

async function screenOf(page: Page, cell: number, dx = 0, dy = 0): Promise<{ x: number; y: number }> {
  const at = cellToLatLon(cell, WIDTH, HEIGHT);
  const p = await T(page).project(at.lat, at.lon);
  expect(p.inView && p.facing, `cell ${cell} is on screen`).toBe(true);
  return { x: p.x + dx, y: p.y + dy };
}
/** A right click on a cell; waits for the (lazily loaded) menu. */
async function rightClick(page: Page, cell: number, dx = 0, dy = 0): Promise<void> {
  const p = await screenOf(page, cell, dx, dy);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await page.locator(tid('ctx-menu')).waitFor({ state: 'visible', timeout: 15_000 });
  await T(page).settle(0.05, 1);
}
const item = (page: Page, id: string) => page.locator(tid(`ctx-${id}`));
const menuIds = (page: Page): Promise<string[]> => page.evaluate(() => Array.from(document.querySelectorAll('[data-testid="ctx-menu"] .ctx-item')).map((e) => (e as HTMLElement).dataset.id as string));
const stateOf = (page: Page, id: string): Promise<string | undefined> => page.evaluate((i) => (document.querySelector(`[data-testid="ctx-${i}"]`) as HTMLElement | null)?.dataset.state, id);
const shot = async (page: Page, name: string): Promise<void> => {
  await T(page).render();
  fs.writeFileSync(path.join(SHOT_DIR, `ctx-${name}.png`), await page.screenshot({ type: 'png' }));
};

describe('another nation\'s land', () => {
  it('right click: Attack, helicopter, ship, Diplomacy; Attack attacks; a helicopter chosen from the menu opens the deploy mode with the zone picked, the Send button sends', async () => {
    const { page, messages, cx, cy } = await playing('test=1&seed=7&ai=0&hud=1');
    try {
      const tt = T(page);
      const enemy = cy * WIDTH + cx + 15;
      const capital = (await tt.seatCells()).capitals[0] as number;
      // --- a Factory with a helicopter on the pad (built through the menu itself: own land, then the Factory's entry)
      await rightClick(page, capital, 0, 25);
      expect((await menuIds(page)).length).toBe(9);
      await item(page, 'build.2').click(); // Factory: built straight onto the cell
      await tt.advance(0.1, (BUILD_TICKS[STRUCT_FACTORY] as number) + 8);
      expect((await tt.menu()).open).toBe(false);
      expect((await tt.state()).structures.byType[STRUCT_FACTORY]).toBe(1);
      await rightClick(page, capital, 0, 25);
      expect(await menuIds(page)).toEqual(['upgrade', 'produceHeli', 'deploySend', 'select', 'delete']);
      expect(await stateOf(page, 'deploySend')).toBe('disabled'); // no helicopter on the pad yet
      expect(await page.locator(tid('ctx-reason-deploySend')).textContent()).toBeTruthy();
      await shot(page, 'own-factory');
      await item(page, 'produceHeli').click();
      await tt.advance(0.1, HELI_BUILD_TICKS + 4);
      // --- the page's own preview says which cells of the painted block a helicopter may land on (the first Factory has the id 0)
      const scan: Array<{ cell: number; reason: number }> = await page.evaluate(
        ([x0, y0]) => {
          const out: Array<{ cell: number; reason: number }> = [];
          for (let dy = -3; dy <= 3; dy++) for (let dx = 10; dx <= 21; dx++) out.push({ cell: (y0 + dy) * 1024 + x0 + dx, reason: (window as any).__test.previewNow(0, (y0 + dy) * 1024 + x0 + dx, 1, 0).reason });
          return out;
        },
        [cx, cy] as const,
      );
      const bad = scan.find((c) => c.reason !== 0);
      const good = scan.find((c) => c.reason === 0);
      expect(good, 'a landing cell on the other nation\'s land').toBeDefined();
      expect(bad, 'a cell a helicopter cannot land on (forest, hills ...)').toBeDefined();
      // --- another nation's land: the entries, the diplomacy group folded; a refused landing is DIMMED with its reason on screen
      await rightClick(page, (bad as { cell: number }).cell);
      expect(await menuIds(page)).toEqual(['attack', 'deployHere', 'shipHere', 'diplo-truce', 'diplo-alliance', 'diplo-embargo']);
      expect(await item(page, 'attack').getAttribute('data-state')).toBe('ok');
      expect(await stateOf(page, 'deployHere')).toBe('disabled');
      expect(await page.locator(tid('ctx-reason-deployHere')).isVisible()).toBe(true);
      expect(await stateOf(page, 'shipHere')).toBe('disabled'); // no Port: dimmed WITH its reason on screen
      expect(await page.locator(tid('ctx-reason-shipHere')).isVisible()).toBe(true);
      expect(await item(page, 'diplo-truce').isVisible()).toBe(false); // folded until the group is opened
      await shot(page, 'enemy-dimmed');
      await page.keyboard.press('Escape');
      await rightClick(page, (good as { cell: number }).cell);
      expect(await stateOf(page, 'deployHere')).toBe('ok');
      await page.locator(tid('ctx-group-diplo')).click();
      expect(await item(page, 'diplo-truce').isVisible()).toBe(true);
      await shot(page, 'enemy-all');
      // --- the helicopter: the mode opens with the zone already picked
      await item(page, 'deployHere').click();
      await tt.settle(0.3, 1);
      let d = await tt.deploy();
      for (let i = 0; i < 12 && d.status !== 'ready'; i++) {
        await tt.settle(0.3, 1);
        d = await tt.deploy();
      }
      expect([d.active, d.hover, d.status, d.reason]).toEqual([true, (good as { cell: number }).cell, 'ready', 0]);
      expect(d.markerCell).toBe((good as { cell: number }).cell);
      for (let i = 0; i < 6 && !(await page.locator(tid('deploy-confirm')).isVisible()); i++) await tt.settle(0.2, 1); // the box follows the preview one frame later
      await shot(page, 'deploy-preselected');
      expect(await page.locator(tid('deploy-confirm')).isVisible()).toBe(true);
      expect((await tt.helis())[0]?.state).toBe(HELI_PAD); // nothing left yet
      const troopsBefore = (await tt.state()).local.troops;
      await page.locator(tid('deploy-confirm')).click();
      await tt.advance(0.1, 8); // the host applies an intent a few ticks after it is sent
      await tt.settle();
      expect((await tt.deploy()).active).toBe(false);
      expect((await tt.props()).toasts).toContain('deploy.sent');
      expect(troopsBefore - (await tt.state()).local.troops, 'one troop went with the helicopter').toBeGreaterThanOrEqual(1);
      await tt.advance(0.1, 100);
      await tt.settle();
      expect((await tt.helis())[0]?.state).not.toBe(HELI_PAD);
      // --- Attack from the menu: the troops leave
      const before = (await tt.state()).local.troopsQt;
      await rightClick(page, enemy);
      await item(page, 'attack').click();
      await tt.advance(0.1, 4);
      expect((await tt.state()).local.troopsQt).toBeLessThan(before * 0.9);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  }, 240_000);

  it('Diplomacy: the group unfolds in place and "propose a truce" sends the proposal (the diplomacy panel row waits); your own land: Build here puts a City straight on the cell', async () => {
    const { page, messages, cx, cy } = await playing('test=1&seed=7&ai=0&hud=1');
    try {
      const tt = T(page);
      const enemy = cy * WIDTH + cx + 15;
      await rightClick(page, enemy);
      await page.locator(tid('ctx-group-diplo')).click();
      await item(page, 'diplo-truce').click();
      await tt.advance(0.1, 6);
      expect((await tt.menu()).open).toBe(false);
      await page.keyboard.press('d');
      await tt.advance(0.05, 0);
      const row = page.locator(`${tid('diplo-row')}[data-seat="1"]`);
      await row.waitFor({ state: 'visible' });
      expect(await row.locator(tid('diplo-waiting')).isVisible()).toBe(true);
      await page.keyboard.press('Escape');
      // --- own land
      const capital = (await tt.seatCells()).capitals[0] as number;
      await rightClick(page, capital, 40, 30);
      expect((await menuIds(page)).map((i) => i.replace('build.', ''))).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
      for (let i = 1; i <= 9; i++) expect(await stateOf(page, `build.${i}`), `type ${i}`).toBeDefined();
      expect(await page.locator(`${tid('ctx-build.1')} .ctx-key`).textContent()).toBe('1');
      const cities = (await tt.state()).structures.byType[STRUCT_CITY] ?? 0;
      await item(page, 'build.1').click();
      await tt.advance(0.1, (BUILD_TICKS[STRUCT_CITY] as number) + 8);
      expect((await tt.state()).structures.byType[STRUCT_CITY]).toBe(cities + 1);
      // a marked structure: the right click on the ground unmarks it AND opens the menu (the resolver's rule is unchanged, the menu comes on top)
      const city = await screenOf(page, capital, 40, 30);
      await page.mouse.click(city.x, city.y);
      await tt.settle();
      expect((await tt.props()).selection.panelVisible).toBe(true);
      await rightClick(page, cy * WIDTH + cx + 15);
      expect((await tt.props()).selection.panelVisible).toBe(false);
      expect(await menuIds(page)).toContain('attack');
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  }, 180_000);
});

describe('the sea: Ports and ships', () => {
  const isWater = (cls: number): boolean => cls === CLASS_DEEP_SEA || cls === CLASS_SHALLOWS;
  /** The Port candidate on the own coast near the capital and the landing cell with the shortest sea way (the sim's own route search, as in e2e/ships.test.ts). */
  async function findScene(page: Page, capital: number, mine: number): Promise<{ port: number; target: number }> {
    const sim = await worldLoader().loadSim();
    const cx = capital % WIDTH;
    const cy = (capital - cx) / WIDTH;
    const ports: number[] = [];
    for (let dy = -7; dy <= 7; dy++) {
      for (let dx = -7; dx <= 7; dx++) {
        const c = (cy + dy) * WIDTH + ((cx + dx + WIDTH) % WIDTH);
        const cls = sim.terrainClass[c] as number;
        if (cls === CLASS_HILLS || cls === CLASS_MOUNTAIN || cls === CLASS_PEAK || isWater(cls) || !isCoastCell(WIDTH, HEIGHT, sim.terrainClass, c)) continue;
        if (dx * dx + dy * dy > 4) ports.push(c);
      }
    }
    ports.sort((a, b) => Math.hypot((a % WIDTH) - cx, Math.floor(a / WIDTH) - cy) - Math.hypot((b % WIDTH) - cx, Math.floor(b / WIDTH) - cy));
    const owners: number[] = await page.evaluate((cs) => cs.map((c) => (window as any).__test.ownerOf(c)), ports);
    const port = ports.find((_, i) => owners[i] === mine && portWaterCell(WIDTH, HEIGHT, sim.terrainClass, ports[i] as number) >= 0) ?? -1;
    expect(port, 'a Port cell on the own coast').toBeGreaterThanOrEqual(0);
    const start = portWaterCell(WIDTH, HEIGHT, sim.terrainClass, port);
    const route = new ShipRoute();
    const found: Array<{ c: number; len: number }> = [];
    const px = port % WIDTH;
    const py = (port - px) / WIDTH;
    for (let dy = -40; dy <= 40; dy++) {
      for (let dx = -40; dx <= 40; dx++) {
        const yy = py + dy;
        if (yy < 0 || yy >= HEIGHT || dx * dx + dy * dy < 36) continue;
        const c = yy * WIDTH + ((px + dx + WIDTH) % WIDTH);
        if (!isPlayableClass(sim.terrainClass[c] as number) || !hasWaterWithinReach(WIDTH, HEIGHT, sim.terrainClass, c)) continue;
        if (findShipRoute(WIDTH, HEIGHT, sim.terrainClass, start, c, route) !== SHIP_ROUTE_OK || route.pathCells < 8) continue;
        found.push({ c, len: route.pathCells });
      }
    }
    found.sort((x, y) => x.len - y.len);
    const near = found.slice(0, 200);
    const who: number[] = await page.evaluate((cs) => cs.map((c) => (window as any).__test.ownerOf(c)), near.map((f) => f.c));
    const pick = near.find((_, i) => who[i] !== mine);
    expect(pick, 'a landing cell with a sea way that is not the own land').toBeDefined();
    return { port, target: (pick as { c: number }).c };
  }

  it('Port: "Send ship…" opens the ship mode (no target); "Send ship here" on a coast opens it with the cell picked, the route shown, and Send sends', async () => {
    const { page, consoleMessages } = await openPage(browser, baseUrl, 'test=1&seed=7&ai=0&hud=1');
    try {
      const tt = T(page);
      await tt.view({ lat: 41.9, lon: 12.5, distKm: 2600, heading: 0, tilt: 0 });
      const p0 = await tt.project(41.9, 12.5);
      await page.mouse.click(p0.x, p0.y);
      await tt.advance(0.1, 5);
      await page.evaluate(() => (window as any).__test.give(0, { gold: 9000, troops: 5000 }));
      await tt.advance(0.1, 4);
      expect((await tt.state()).local.spawned).toBe(true);
      await tt.advance(0.1, 210);
      const capital = (await tt.seatCells()).capitals[0] as number;
      const scene = await findScene(page, capital, await tt.ownerOf(capital));
      await tt.submit({ kind: 'Build', seat: 0, type: STRUCT_PORT, cell: scene.port });
      await tt.advance(0.1, (BUILD_TICKS[STRUCT_PORT] as number) + 8);
      expect((await tt.state()).structures.byType[STRUCT_PORT]).toBe(1);
      const pl = cellToLatLon(scene.port, WIDTH, HEIGHT);
      await page.evaluate(([la, lo]) => (window as any).__test.setGroundView({ lat: la - 40 / 111.2, lon: lo, heading: 0, pitchDeg: 40, aglM: 30000, time: 0.45 }), [pl.lat, pl.lon] as const);
      await tt.settle();
      // --- the Port's own menu: "Send ship…" (key B) opens the mode with the Port selected and no target
      await rightClick(page, scene.port);
      expect(await menuIds(page)).toEqual(['upgrade', 'shipSend', 'select', 'delete']);
      expect(await item(page, 'shipSend').locator('.ctx-key').textContent()).toBe('B');
      await item(page, 'shipSend').click();
      await tt.settle();
      let m = await tt.shipMode();
      expect([m.active, m.pinned]).toEqual([true, -1]);
      await page.keyboard.press('Escape'); // leaves the ship mode (one mode), the selection stays
      await page.keyboard.press('Escape');
      await tt.settle();
      expect((await tt.shipMode()).active).toBe(false);
      // --- "Send ship here" on a coast of someone else's land: the mode opens with the cell picked
      const tl = cellToLatLon(scene.target, WIDTH, HEIGHT);
      const sepKm = Math.hypot((tl.lat - pl.lat) * 111.2, (tl.lon - pl.lon) * 111.2 * Math.cos((pl.lat * Math.PI) / 180));
      await tt.view({ lat: (pl.lat + tl.lat) / 2, lon: (pl.lon + tl.lon) / 2, distKm: Math.max(500, sepKm * 3), heading: 0, tilt: 0 });
      await tt.settle();
      await rightClick(page, scene.target);
      expect(await stateOf(page, 'shipHere')).toBe('ok');
      await item(page, 'shipHere').click();
      await tt.advance(0.05, 1);
      await tt.settle(0.1, 1);
      m = await tt.shipMode();
      expect([m.active, m.pinned, m.reason, m.markerState]).toEqual([true, scene.target, 0, 1]);
      expect(m.routePoints).toBeGreaterThanOrEqual(2);
      expect((await tt.ships()).length).toBe(0); // nothing sent yet
      await shot(page, 'ship-preselected');
      await page.locator(tid('ship-confirm')).click();
      await tt.advance(0.1, 8);
      await tt.settle();
      expect((await tt.ships()).length).toBe(1);
      expect(consoleMessages).toEqual([]);
    } finally {
      await page.close();
    }
  }, 240_000);
});

describe('size, language, keyboard, Escape and the map under the menu', () => {
  const SIZES = [
    { width: 960, height: 540 },
    { width: 1366, height: 640 },
    { width: 540, height: 960 },
  ];
  for (const lang of ['sv', 'en'] as const) {
    for (const vp of SIZES) {
      it(`fits and works with the keyboard at ${vp.width}x${vp.height} in ${lang}`, async () => {
        const { page, messages, cx, cy } = await playing(`test=1&seed=7&hud=1&ai=0&w=${vp.width}&h=${vp.height}&lang=${lang}`, vp);
        try {
          const tt = T(page);
          const enemy = cy * WIDTH + cx + 15;
          const capital = (await tt.seatCells()).capitals[0] as number;
          for (const [name, cell, dy] of [['enemy', enemy, 0], ['own', capital, 30]] as const) {
            await rightClick(page, cell, 0, dy);
            if (name === 'enemy') await page.locator(tid('ctx-group-diplo')).click();
            const box = await page.evaluate(() => {
              const r = (document.querySelector('[data-testid="ctx-menu"]') as HTMLElement).getBoundingClientRect();
              return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
            });
            expect(box.left, `${name} left`).toBeGreaterThanOrEqual(0);
            expect(box.top).toBeGreaterThanOrEqual(0);
            expect(box.right).toBeLessThanOrEqual(vp.width + 0.5);
            expect(box.bottom).toBeLessThanOrEqual(vp.height + 0.5);
            const heights = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid="ctx-menu"] .ctx-item, [data-testid="ctx-menu"] .ctx-group')).map((e) => (e as HTMLElement).getBoundingClientRect().height));
            for (const h of heights) expect(h).toBeGreaterThanOrEqual(TARGET_MIN_PX - 0.5);
            // the keyboard: End reaches the last row (the menu scrolls to it), Home the first, ArrowDown moves on; the focused row is inside the menu
            await page.keyboard.press('End');
            const last = await page.evaluate(() => {
              const f = document.activeElement as HTMLElement;
              const m = document.querySelector('[data-testid="ctx-menu"]') as HTMLElement;
              const fr = f.getBoundingClientRect();
              const mr = m.getBoundingClientRect();
              return { inside: m.contains(f), visible: fr.bottom <= mr.bottom + 1 && fr.top >= mr.top - 1, id: f.dataset.id };
            });
            expect(last.inside).toBe(true);
            expect(last.visible, `${name}: the last row is scrolled into view`).toBe(true);
            await page.keyboard.press('Home');
            await page.keyboard.press('ArrowDown');
            const second = await page.evaluate(() => (document.activeElement as HTMLElement).dataset.id);
            expect(second).toBeDefined();
            if (name === 'enemy' && vp.width === 960 && lang === 'sv') await shot(page, 'enemy-keyboard');
            await page.keyboard.press('Escape');
            expect((await tt.menu()).open).toBe(false);
            expect(await page.locator(tid('pause-menu')).isVisible()).toBe(false); // Escape closed the menu only
          }
          if (vp.width === 960 && lang === 'sv') {
            await rightClick(page, capital, 0, 30);
            await shot(page, 'own-land');
            await page.keyboard.press('Escape');
          }
          if (vp.width === 540 && lang === 'en') {
            await rightClick(page, enemy);
            await page.locator(tid('ctx-group-diplo')).click();
            await shot(page, 'enemy-540x960-en');
          }
          expect(messages).toEqual([]);
        } finally {
          await page.close();
        }
      }, 180_000);
    }
  }

  it('Enter on a row acts (keyboard only), a click outside closes, a press on the map closes WITHOUT also acting, Escape closes, and the map neither drags nor zooms under the menu but does afterwards', async () => {
    const { page, messages, cx, cy } = await playing('test=1&seed=7&hud=1&ai=0');
    try {
      const tt = T(page);
      const enemy = cy * WIDTH + cx + 15;
      const capital = (await tt.seatCells()).capitals[0] as number;
      const mark = async (): Promise<{ x: number; y: number }> => {
        const p = await tt.project(START.lat, START.lon);
        return { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 };
      };
      // keyboard only: open, walk to the Attack row (the first one has the focus), Enter
      const before = (await tt.state()).local.troopsQt;
      await rightClick(page, enemy);
      expect(await page.evaluate(() => (document.activeElement as HTMLElement).dataset.id)).toBe('attack');
      await page.keyboard.press('Enter');
      await tt.advance(0.1, 4);
      expect((await tt.state()).local.troopsQt).toBeLessThan(before * 0.9);
      expect((await tt.menu()).open).toBe(false);
      // a left press on the map while the menu is open closes it and does NOT attack or drag
      const troops = (await tt.state()).local.troopsQt;
      const home = await mark();
      await rightClick(page, capital, 0, 30);
      const target = { x: 40, y: 470 }; // bare map away from the menu and the panels
      await page.mouse.click(target.x, target.y); // a press on the map
      await tt.advance(0.1, 3);
      expect((await tt.menu()).open).toBe(false);
      expect((await tt.state()).local.troopsQt, 'the press closed the menu and did nothing else (no attack)').toBeGreaterThan(troops * 0.95); // a new attack would take 40 % (the first one is still running: only its small ongoing drain shows)
      // a wheel notch and a drag on the map do nothing while the menu is open ...
      await rightClick(page, capital, 0, 30);
      await page.mouse.move(target.x, target.y);
      await page.mouse.wheel(0, -600);
      await tt.settle(0.2, 2);
      expect(await mark()).toEqual(home);
      expect((await tt.menu()).open).toBe(true);
      await page.keyboard.press('Escape');
      expect((await tt.menu()).open).toBe(false);
      // ... and afterwards the map is not stolen: a drag moves it
      await page.mouse.move(target.x, target.y);
      await page.mouse.down();
      await page.mouse.move(target.x + 80, target.y + 10, { steps: 4 });
      await page.mouse.up();
      await tt.settle(0.2, 3);
      const moved = await mark();
      expect(Math.abs(moved.x - home.x) + Math.abs(moved.y - home.y), 'the drag moved the map').toBeGreaterThan(20);
      // the pref gives the old behaviour: `?ctx=0` attacks directly (covered by e2e/m20aLite.test.ts), here only that no menu opens
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  }, 180_000);

  it('?ctx=0 keeps the old behaviour: a right click on land is an attack and no menu appears', async () => {
    const { page, messages, cx, cy } = await playing('test=1&seed=7&hud=1&ai=0&ctx=0');
    try {
      const tt = T(page);
      const before = (await tt.state()).local.troopsQt;
      const p = await screenOf(page, cy * WIDTH + cx + 15);
      await page.mouse.click(p.x, p.y, { button: 'right' });
      await tt.advance(0.1, 4);
      expect((await tt.menu()).open).toBe(false);
      expect((await tt.state()).local.troopsQt).toBeLessThan(before * 0.9);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  }, 120_000);
});
