// M13a-2 in headless Chromium (software WebGL2): the helicopter effects (shadow, rotor-wash dust, troop ropes, landing dust, the flag of a fresh beachhead, smoke and
// flash of a shot-down one, the far icon) and the chase camera. A page with `fx=1` (the effects are OFF in a test page otherwise, so no golden changes). The flow
// is the deploy test's: a Factory, a helicopter, a landing zone found with the page's own preview, a LaunchHeli intent; then the sim is stepped a tick at a time
// and a picture is taken the first time each state shows. Pictures go to FX_SHOTS (default test-results/shots).
import fs from 'node:fs';
import path from 'node:path';
import type { Browser } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { launchBrowser, openPage } from '../scripts/shot.mjs';
import { cellToLatLon } from '../src/render/transforms';
import { HELI_CHASE_CLEAR_M, HELI_FX_PARTICLES_MAX } from '../src/render/config';
import { HELI_APPROACH, HELI_CRUISE, HELI_DOWNED, HELI_HOVER, HELI_LIFT, HELI_PAD, HELI_RETURN, HELI_UNLOAD } from '../src/sim/heliTable';
import { STRUCT_SAM } from '../src/sim/structureRules';
import { HEIGHT, SHOT_DIR, T, WIDTH, look, prepare, quiet, type Drawn } from './helpers/heliFlight';

let browser: Browser;
const baseUrl = inject('baseUrl');

beforeAll(async () => {
  ({ browser } = await launchBrowser());
});
afterAll(async () => {
  await browser?.close();
});

const HIDE = '.hud-root, .build-bar, .build-hint, .toast-stack, .sel-panel { visibility: hidden !important; }';

describe('the helicopter effects', () => {
  it('shadow, dust, ropes, landing dust and the flag on pictures; the caps hold and the effects cost three draw calls and the icon one', async () => {
    const { page, consoleMessages } = await openPage(browser, baseUrl, 'test=1&seed=7&ai=0&hud=1&fx=1');
    try {
      const t = T(page);
      const { factory, lz } = await prepare(page);
      const pad = (await t.helis())[0] as Drawn;
      // parked: no shadow, no icon, no flag, no dust; H says that no helicopter is in the air
      let fx = await t.fx();
      expect([fx.enabled, fx.shadows, fx.icons, fx.flags, fx.particles]).toEqual([true, 0, 0, 0, 0]);
      await page.keyboard.press('h');
      await t.settle();
      expect((await t.props()).toasts).toContain('toast.heli.noneAirborne');
      expect((await t.chase()).active).toBe(false);
      await page.addStyleTag({ content: HIDE });
      await page.keyboard.press('Escape');
      await look(page, '0-parked', pad.lat, pad.lon, 1.4, 900, 30);

      await t.submit({ kind: 'LaunchHeli', seat: 0, factory, lzCell: lz, troops: 300, altMode: 0 });
      const seen = new Set<number>();
      let maxParticles = 0;
      let counted = false;
      let pictured = false;
      for (let i = 0; i < 700; i++) {
        await t.advance(0, 1);
        await t.settle(0.1, 1);
        const h = (await t.helis())[0];
        if (h === undefined) continue;
        fx = await t.fx();
        maxParticles = Math.max(maxParticles, fx.particles);
        if (h.state === HELI_PAD || h.state === HELI_RETURN) {
          if (seen.has(HELI_UNLOAD)) break;
          continue;
        }
        if (h.state === HELI_LIFT && h.aglM > 150 && !pictured) {
          // the climb over the Factory: the first picture was taken in its hall at ground level
          pictured = true;
          await look(page, '1b-lift-climb', h.lat, h.lon, 1.4, h.aglM + 700, 32);
        }
        if (seen.has(h.state)) continue;
        seen.add(h.state);
        await t.settle(0.15, 3); // the first puffs get a body
        const name = { [HELI_LIFT]: '1-lift', [HELI_CRUISE]: '2-cruise', [HELI_APPROACH]: '3-approach', [HELI_HOVER]: '4-hover', [HELI_UNLOAD]: '5-unload' }[h.state] ?? `s${h.state}`;
        const hh = (await t.helis())[0] as Drawn;
        fx = await t.fx();
        console.log(`[fx] ${name} agl ${hh.aglM.toFixed(0)} m: ${JSON.stringify(fx)}`);
        expect(fx.shadows).toBe(1); // a shadow under every airborne helicopter
        expect(fx.icons).toBe(1);
        if (h.state === HELI_LIFT) expect(fx.particles).toBeGreaterThan(10); // the take-off dust
        if (h.state === HELI_HOVER) expect(fx.particles).toBeGreaterThan(4); // rope and troop dots
        if (h.state === HELI_UNLOAD) {
          expect(fx.particles).toBeGreaterThan(20); // landing dust
          // the draw calls: the effects (shadow, particles; the flag comes later) and the icon are all the layer adds
          const on = (await t.info()).drawCalls;
          await page.evaluate(() => (window as any).__test.fxLayer(false));
          await t.settle(0, 1);
          const off = (await t.info()).drawCalls;
          await page.evaluate(() => (window as any).__test.fxLayer(true));
          console.log(`[fx] draw calls on ${on}, off ${off}, visible effect meshes ${fx.visibleMeshes}`);
          expect(on - off).toBe(fx.visibleMeshes);
          expect(on - off).toBeLessThanOrEqual(4);
          expect(on - off).toBeGreaterThanOrEqual(3);
          counted = true;
        }
        const dKm = h.state === HELI_LIFT ? 1.4 : 0.9;
        await look(page, name, hh.lat, hh.lon, dKm, hh.aglM + (h.state === HELI_LIFT ? 900 : 520), 32);
      }
      expect(counted).toBe(true);
      for (const s of [HELI_LIFT, HELI_CRUISE, HELI_HOVER, HELI_UNLOAD]) expect(seen.has(s), `state ${s} was seen`).toBe(true);
      expect(maxParticles).toBeGreaterThan(20);
      expect(maxParticles).toBeLessThanOrEqual(HELI_FX_PARTICLES_MAX);
      expect(seen.has(HELI_DOWNED)).toBe(false);

      // the landing made a beachhead: a flag rises on its seed cell, then stands
      let seed = -1;
      for (let i = 0; i < 40 && seed < 0; i++) {
        const b = await t.beach();
        if (b.rows.length > 0) seed = (b.rows[0] as { seed: number }).seed;
        else {
          await t.advance(0, 1);
          await t.settle(0.1, 1);
        }
      }
      expect(seed).toBeGreaterThanOrEqual(0);
      await t.settle(0.05, 2);
      expect((await t.fx()).flags).toBe(1);
      const sl = cellToLatLon(seed, WIDTH, HEIGHT);
      await look(page, '6-flag-rising', sl.lat, sl.lon, 1.1, 420, 20);
      await t.settle(1, 3); // the hoist takes 1.6 s of fx time
      await look(page, '7-flag-up', sl.lat, sl.lon, 1.1, 420, 20);
      expect(quiet(consoleMessages)).toEqual([]);
    } finally {
      await page.close();
    }
  }, 600_000);

  it('a helicopter shot down by an enemy SAM site flashes, smokes about three seconds and the smoke is gone five seconds after the hit', async () => {
    const { page, consoleMessages } = await openPage(browser, baseUrl, 'test=1&seed=7&ai=0&hud=1&fx=1');
    try {
      const t = T(page);
      const { capital, factory, lz } = await prepare(page);
      await page.addStyleTag({ content: HIDE });
      // an enemy: seat 1 gets the cells round a point a few cells short of the landing zone and a SAM site on one of them
      const cx = capital % WIDTH;
      const cy = (capital - cx) / WIDTH;
      const lx = lz % WIDTH;
      const ly = (lz - lx) / WIDTH;
      const f = 0.8;
      const mx = Math.round(cx + (lx - cx) * f);
      const my = Math.round(cy + (ly - cy) * f);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) await t.submit({ kind: 'DebugPaint', seat: 1, cell: (my + dy) * WIDTH + mx + dx });
      await page.evaluate(() => (window as any).__test.give(1, { gold: 900000, troops: 500 }));
      await t.advance(0.1, 6);
      await t.submit({ kind: 'Build', seat: 1, type: STRUCT_SAM, cell: my * WIDTH + mx });
      await t.advance(0.1, 80);
      const st = (await t.state()) as unknown as { structures: { byType: number[] } };
      console.log(`[fx] SAM sites: ${st.structures.byType[STRUCT_SAM]}`);
      expect(st.structures.byType[STRUCT_SAM]).toBe(1);
      await t.submit({ kind: 'LaunchHeli', seat: 0, factory, lzCell: lz, troops: 300, altMode: 1 });
      let downed = -1;
      let last: Drawn | undefined;
      for (let i = 0; i < 900 && downed < 0; i++) {
        await t.advance(0, 1);
        await t.settle(0.1, 1);
        const h = (await t.helis())[0];
        if (h === undefined) continue;
        last = h;
        if (h.state === HELI_DOWNED) downed = i;
      }
      console.log(`[fx] downed at step ${downed}; last ${JSON.stringify(last)}`);
      expect(downed).toBeGreaterThanOrEqual(0);
      const h = last as Drawn;
      const clock = async (): Promise<number> => ((await page.evaluate(() => (window as any).__test.info())) as { fx: number }).fx;
      const t0 = await clock();
      await t.settle(0.2, 2);
      expect((await t.fx()).particles).toBeGreaterThan(10); // the flash
      await look(page, '8-crash-flash', h.lat, h.lon, 0.9, h.aglM + 450, 30);
      await t.settle(1, 2);
      expect((await t.fx()).particles).toBeGreaterThan(10);
      await look(page, '9-crash-smoke', h.lat, h.lon, 0.9, h.aglM + 450, 30);
      // 5 s after the hit nothing of it is left (the clock only moves on a frame: step it in 0.5 s notches)
      for (let k = 0; k < 24 && (await clock()) - t0 < 6.5; k++) await t.settle(0.5, 1);
      expect((await t.fx()).particles).toBe(0);
      expect(quiet(consoleMessages)).toEqual([]);
    } finally {
      await page.close();
    }
  }, 600_000);
});

describe('the chase camera', () => {
  it('H rides along with the flying helicopter above the ground, Escape / H / a drag / the wheel end it, the list button starts it, a modal blocks the key', async () => {
    const { page, consoleMessages } = await openPage(browser, baseUrl, 'test=1&seed=7&ai=0&hud=1&fx=1');
    try {
      const t = T(page);
      const { capital, factory, lz, at } = await prepare(page);
      await t.submit({ kind: 'LaunchHeli', seat: 0, factory, lzCell: lz, troops: 300, altMode: 0 });
      for (let i = 0; i < 120; i++) {
        await t.advance(0, 1);
        await t.settle(0.1, 1);
        if (((await t.helis())[0] as Drawn).state === HELI_CRUISE) break;
      }
      expect(((await t.helis())[0] as Drawn).state).toBe(HELI_CRUISE);
      // the list button of the flying row (the Factory is selected)
      expect(await page.locator('[data-testid="heli-chase"]').count()).toBe(1);
      await page.locator('[data-testid="heli-chase"]').click();
      await t.settle(0.1, 1);
      expect(await t.chase()).toMatchObject({ active: true, heli: 0 });
      await page.keyboard.press('Escape');
      await t.settle(0.1, 1);
      expect((await t.chase()).active).toBe(false);
      expect(await page.locator('[data-testid="pause-menu"]').isVisible()).toBe(false); // the Escape popped the ride, nothing more
      await page.addStyleTag({ content: HIDE });

      // H: the camera follows with a clearance the whole way and the helicopter stays on the screen
      await page.keyboard.press('h');
      await t.settle(0.1, 1);
      expect(await t.chase()).toMatchObject({ active: true, heli: 0 });
      let lowest = Infinity;
      for (let i = 0; i < 60; i++) {
        await t.advance(0, 1);
        await t.settle(0.1, 1);
        const c = await t.chase();
        if (!c.active) break;
        lowest = Math.min(lowest, c.camAglM);
        const h = (await t.helis())[0] as Drawn;
        // the camera stays within three kilometres of the helicopter (more only where the ground behind it rises above its altitude) (its drawn radius and place, Earth radii)
        const cam = (await page.evaluate(() => (window as any).__test.cameraPosition())) as [number, number, number];
        const la = (h.lat * Math.PI) / 180;
        const lo = (h.lon * Math.PI) / 180;
        const hv = [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)].map((v) => v * h.radius);
        const km = Math.hypot(cam[0] - (hv[0] as number), cam[1] - (hv[1] as number), cam[2] - (hv[2] as number)) * 6371;
        expect(km, `the camera rides within 3 km at step ${i}`).toBeLessThan(3);
        expect(km).toBeGreaterThan(0.2);
        if (i === 30) {
          await t.settle(0.05, 6); // the terrain chunks of the new place refine over a few frames (the test mode jumps kilometres a tick)
          fs.writeFileSync(path.join(SHOT_DIR, 'fx-a-chase-view.png'), await page.screenshot({ timeout: 90_000 }));
        }
      }
      console.log(`[fx] chase: lowest camera height ${lowest.toFixed(0)} m`);
      expect(lowest).toBeGreaterThan(HELI_CHASE_CLEAR_M - 5);
      expect((await t.chase()).active).toBe(true);
      await page.keyboard.press('h'); // H again ends it
      await t.settle(0.1, 1);
      expect((await t.chase()).active).toBe(false);
      // a drag ends it
      await page.keyboard.press('h');
      await t.settle(0.1, 1);
      expect((await t.chase()).active).toBe(true);
      await page.mouse.move(480, 270);
      await page.mouse.down();
      await page.mouse.move(520, 300);
      await page.mouse.up();
      await t.settle(0.1, 1);
      expect((await t.chase()).active).toBe(false);
      // the wheel ends it
      await page.keyboard.press('h');
      await t.settle(0.1, 1);
      expect((await t.chase()).active).toBe(true);
      await page.mouse.wheel(0, 120);
      await t.settle(0.1, 1);
      expect((await t.chase()).active).toBe(false);
      // a modal blocks the key: with the pause menu open H starts nothing
      for (let k = 0; k < 3 && !(await page.locator('[data-testid="pause-menu"]').isVisible()); k++) {
        await page.keyboard.press('Escape'); // the selection of the Factory goes first, then the pause menu opens
        await t.settle(0.1, 1);
      }
      expect(await page.locator('[data-testid="pause-menu"]').isVisible()).toBe(true);
      await page.keyboard.press('h');
      await t.settle(0.1, 1);
      expect((await t.chase()).active).toBe(false);
      await page.keyboard.press('Escape');
      await t.settle(0.1, 1);
      void capital;
      void at;
      expect(quiet(consoleMessages)).toEqual([]);
    } finally {
      await page.close();
    }
  }, 600_000);
});

describe('the effects are cosmetic', () => {
  it('the same flow with and without the effect layers ends on the same simulation hash', async () => {
    const hashes: number[] = [];
    for (const fx of ['0', '1']) {
      const { page, consoleMessages } = await openPage(browser, baseUrl, `test=1&seed=7&ai=0&hud=1&fx=${fx}`);
      try {
        const t = T(page);
        const { factory, lz } = await prepare(page);
        await t.submit({ kind: 'LaunchHeli', seat: 0, factory, lzCell: lz, troops: 300, altMode: 0 });
        for (let i = 0; i < 160; i++) {
          await t.advance(0, 1);
          if (i % 4 === 0) await t.settle(0.1, 1); // frames in between: the effects feed on them
        }
        expect((await t.fx()).enabled).toBe(fx === '1');
        hashes.push(await t.hash());
        expect(quiet(consoleMessages)).toEqual([]);
      } finally {
        await page.close();
      }
    }
    console.log(`[fx] sim hash without ${hashes[0]}, with ${hashes[1]}`);
    expect(hashes[0]).toBe(hashes[1]);
    expect(hashes[0]).not.toBe(0);
  }, 600_000);
});
