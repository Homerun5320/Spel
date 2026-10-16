// M13a-2 (tagged leak-test, serial project): the helicopter effects while a helicopter hovers over a landing zone with dust, rope and troop dots in the air, a shadow and
// an icon. (1) 60 render calls (3 rounds x 20) at 320x180: the geometry and texture counts of `renderer.info` do not move and the retained heap stays under 5 MB
// (median of 3). (2) The extra allocation per frame of the effects over the same scene without them is small: the pools are typed arrays made once, a spawn writes
// numbers into them and nothing else (the method of deployAlloc.serial.test.ts: V8's own heap figure read after every frame).
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { heapDelta, launchBrowser, openPage } from '../scripts/shot.mjs';
import { HELI_HOVER } from '../src/sim/heliTable';
import { T, prepare, quiet, type Drawn } from './helpers/heliFlight';

const MB = 1_000_000;
const FRAMES = 120;
/** The extra bytes per frame the effects may allocate over the scene without them (the render itself allocates 20 000 to 40 000 and its noise is a few thousand: docs/DECISIONS.md Fix-4B). */
const ALLOWED_EXTRA_BYTES_PER_FRAME = 12000;
let browser: Browser;
const baseUrl = inject('baseUrl');

beforeAll(async () => {
  ({ browser } = await launchBrowser());
});
afterAll(async () => {
  await browser?.close();
});

const ev = <R>(page: Page, fn: string, ...args: unknown[]): Promise<R> => page.evaluate(([f, a]) => (window as any).__test[f as string](...(a as unknown[])), [fn, args] as const) as Promise<R>;

async function allocatedPerFrame(page: Page, frames: number): Promise<{ perFrame: number; drops: number }> {
  const cdp = await page.context().newCDPSession(page);
  const used = async (): Promise<number> => ((await cdp.send('Runtime.getHeapUsage')) as { usedSize: number }).usedSize;
  try {
    await ev(page, 'settle', 0.05, 1);
    let prev = await used();
    let sum = 0;
    let drops = 0;
    let counted = 0;
    for (let i = 0; i < frames; i++) {
      await ev(page, 'settle', 0.05, 1);
      const now = await used();
      if (now >= prev) {
        sum += now - prev;
        counted++;
      } else drops++;
      prev = now;
    }
    return { perFrame: counted === 0 ? 0 : Math.round(sum / counted), drops };
  } finally {
    await cdp.detach();
  }
}

/** A hovering helicopter over its landing zone, the camera on it, the page at 320x180. */
async function hover(page: Page): Promise<void> {
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
  await page.keyboard.press('Escape');
  await page.addStyleTag({ content: '.hud-root, .hud-root * { pointer-events: none !important; visibility: hidden !important; }' });
  await ev(page, 'resize', 320, 180);
  await t.ground({ lat: (h as Drawn).lat - 0.9 / 111.2, lon: (h as Drawn).lon, heading: 0, pitchDeg: 32, aglM: (h as Drawn).aglM + 520 });
  await t.settle(0.05, 3);
}

describe('leak-test and allocation: the helicopter effects', () => {
  it('60 render calls with dust, rope, shadow and icon retain less than 5 MB (median of 3); the geometry count is unchanged; the effects allocate almost nothing per frame', async () => {
    const { page, consoleMessages } = await openPage(browser, baseUrl, 'test=1&seed=7&ai=0&hud=1&fx=1', { width: 960, height: 540 }, { isolated: true });
    try {
      await hover(page);
      const t = T(page);
      const frames = async (n: number): Promise<void> => {
        for (let i = 0; i < n; i++) await ev(page, 'settle', 0.05, 1); // one draw per call; the sim stands still, the helicopter hovers, the effects keep spawning
      };
      await frames(20); // warm-up outside the measurement: shader compile and first-use allocations are not leaks
      const live = await t.fx();
      expect(live.particles).toBeGreaterThan(5);
      expect([live.shadows, live.icons]).toEqual([1, 1]);
      const before = await ev<{ geometries: number; textures: number }>(page, 'info');
      const delta = await heapDelta(page, async () => {
        for (let round = 0; round < 3; round++) await frames(20);
      });
      const after = await ev<{ geometries: number; textures: number }>(page, 'info');
      console.log(`[leak-test] helicopter effects heap delta: ${(delta / MB).toFixed(3)} MB, geometries ${before.geometries} -> ${after.geometries}, textures ${before.textures} -> ${after.textures}`);
      expect(after.geometries).toBe(before.geometries);
      expect(after.textures).toBe(before.textures);
      expect(delta).toBeLessThan(5 * MB);

      // allocation per frame: the same scene without the effects, then with them
      await ev(page, 'fxLayer', false);
      await ev(page, 'settle', 0.05, 2);
      await allocatedPerFrame(page, 20);
      const off = await allocatedPerFrame(page, FRAMES);
      await ev(page, 'fxLayer', true);
      await ev(page, 'settle', 0.05, 8);
      await allocatedPerFrame(page, 20);
      const on = await allocatedPerFrame(page, FRAMES);
      console.log(`[alloc] bytes per frame: effects off ${off.perFrame} (${off.drops} drops), on ${on.perFrame} (${on.drops} drops); extra ${on.perFrame - off.perFrame}, allowed ${ALLOWED_EXTRA_BYTES_PER_FRAME}`);
      expect((await t.fx()).particles).toBeGreaterThan(5);
      expect(on.perFrame - off.perFrame).toBeLessThan(ALLOWED_EXTRA_BYTES_PER_FRAME);
      expect(quiet(consoleMessages)).toEqual([]);
    } finally {
      await page.close();
    }
  }, 600_000);
});
