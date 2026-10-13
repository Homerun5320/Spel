import type { Browser } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { assertShotOk, checkShot, launchBrowser, takeShot } from '../scripts/shot.mjs';

describe('negative: a deliberately empty canvas must fail the smoke assertions', () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = (await launchBrowser()).browser;
  });
  afterAll(async () => {
    await browser?.close();
  });

  it('?test=1&blank=1 makes assertShotOk throw', async () => {
    const shot = await takeShot(browser, inject('baseUrl'), { query: 'test=1&blank=1' });
    // The page itself is healthy (WebGL2, no console noise); only the picture is empty.
    expect(shot.info.webgl2).toBe(true);
    const fails = checkShot(shot);
    expect(fails.length).toBeGreaterThan(0);
    expect(fails.join('\n')).toMatch(/distinct colours/);
    expect(() => assertShotOk(shot)).toThrow(/smoke shot failed/);
  });
});
