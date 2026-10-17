// Fix-5B: the two layers that had no row in the "Budgetar" table of docs/ARCHITECTURE.md are measured with renderer.info on a real scene and held to the rows the
// table now has: the helicopter effects (a hovering helicopter with dust, ropes, flags, a shadow and an icon; the layer on against off) and the front arrows (one attack).
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { launchBrowser, openPage } from '../scripts/shot.mjs';
import { HELI_HOVER } from '../src/sim/heliTable';
import { readBudgets } from '../tests/helpers/budgets';
import { T, prepare, type Drawn } from './helpers/heliFlight';

let browser: Browser;
const baseUrl = inject('baseUrl');
beforeAll(async () => {
  ({ browser } = await launchBrowser());
});
afterAll(async () => {
  await browser?.close();
});
const ev = <R>(page: Page, fn: string, ...args: unknown[]): Promise<R> => page.evaluate(([f, a]) => (window as any).__test[f as string](...(a as unknown[])), [fn, args] as const) as Promise<R>;
const row = (prefix: string): { triangles: number; drawCalls: number } => {
  const r = readBudgets().find((b) => b.layer.startsWith(prefix));
  expect(r, `a "${prefix}" row in the Budgetar table`).toBeDefined();
  return r as { triangles: number; drawCalls: number };
};

describe('the budget rows of the helicopter effects and the front arrows', () => {
  it("the helicopter effects on against off add at most the row's triangles and draw calls", async () => {
    const { page, consoleMessages } = await openPage(browser, baseUrl, 'test=1&seed=7&ai=0&hud=1&fx=1', { width: 960, height: 540 });
    try {
      const t = T(page);
      const { factory, lz } = await prepare(page);
      await t.submit({ kind: 'LaunchHeli', seat: 0, factory, lzCell: lz, troops: 300, altMode: 0 });
      let h: Drawn | undefined;
      for (let i = 0; i < 400; i++) {
        await t.advance(0, 1);
        await t.settle(0.1, 1);
        h = (await t.helis())[0];
        if (h?.state === HELI_HOVER) break;
      }
      expect(h?.state).toBe(HELI_HOVER);
      await t.ground({ lat: (h as Drawn).lat - 0.9 / 111.2, lon: (h as Drawn).lon, heading: 0, pitchDeg: 32, aglM: (h as Drawn).aglM + 520 });
      await t.settle(0.05, 3);
      // the dust and the rope come a little after the hover starts: wait until the particle layer is drawn too (the worst case of the row)
      let fx = await t.fx();
      for (let i = 0; i < 120 && fx.particles === 0; i++) {
        await t.advance(0, 1);
        await t.settle(0.1, 1);
        fx = await t.fx();
      }
      expect(fx.particles, 'dust or rope particles are alive').toBeGreaterThan(0);
      const on = await t.info();
      await ev(page, 'fxLayer', false);
      await t.settle(0.05, 1);
      const off = await t.info();
      await ev(page, 'fxLayer', true);
      const b = row('Helikoptereffekter');
      const calls = on.drawCalls - off.drawCalls;
      const tris = on.triangles - off.triangles;
      console.log(`[budget] helicopter effects: ${tris} triangles, ${calls} draw calls`);
      expect(calls, 'the layer is drawn').toBeGreaterThan(0);
      expect(calls).toBeLessThanOrEqual(b.drawCalls);
      expect(tris).toBeGreaterThan(0);
      expect(tris).toBeLessThanOrEqual(b.triangles);
      expect(consoleMessages).toEqual([]);
    } finally {
      await page.close();
    }
  }, 200_000);

  it("the front arrows on against off add at most the row's triangles and draw calls", async () => {
    const { page, consoleMessages } = await openPage(browser, baseUrl, 'test=1&seed=7&hud=1&labels=1&ai=0');
    try {
      await ev(page, 'setView', { lat: 48.5, lon: 11, distKm: 2600, heading: 0, tilt: 0 });
      const p0 = await ev<{ x: number; y: number }>(page, 'project', 48.5, 11);
      await page.mouse.click(p0.x, p0.y);
      await ev(page, 'advance', 0.1, 270);
      await ev(page, 'give', 0, { gold: 90000, troops: 5000 });
      await ev(page, 'submit', { kind: 'Attack', seat: 0, target: 0, pct: 60 });
      await ev(page, 'advance', 0.1, 14);
      await ev(page, 'render', 0);
      const on = await ev<{ drawCalls: number; triangles: number }>(page, 'info');
      await ev(page, 'frontLayer', false);
      await ev(page, 'render', 0);
      const off = await ev<{ drawCalls: number; triangles: number }>(page, 'info');
      const b = row('Frontpilar');
      console.log(`[budget] front arrows: ${on.triangles - off.triangles} triangles, ${on.drawCalls - off.drawCalls} draw calls`);
      expect(on.drawCalls - off.drawCalls).toBe(1);
      expect(on.triangles - off.triangles).toBeGreaterThan(0);
      expect(on.triangles - off.triangles).toBeLessThanOrEqual(b.triangles);
      expect(on.drawCalls - off.drawCalls).toBeLessThanOrEqual(b.drawCalls);
      expect(consoleMessages).toEqual([]);
    } finally {
      await page.close();
    }
  }, 150_000);
});
