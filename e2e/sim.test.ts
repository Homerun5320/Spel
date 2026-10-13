// debug/sim.html in headless Chromium: the golden scenario run by the browser's engine must hash exactly like Node did
// (e2e/goldens/sim-hashes.json), through the plain step loop and through MainThreadHost, and the Float64 canary must
// equal its committed value. This is the cross-engine proof the later milestones count on.
import fs from 'node:fs';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { launchBrowser } from '../scripts/shot.mjs';
import { hex32 } from '../src/sim/hash';
import { GOLDEN_TICKS, scenarioHashes } from '../src/sim/scenario';
import { readGolden } from '../tests/helpers/simGolden';

interface Hooks {
  ready: boolean;
  seed: number;
  ticks: number;
  engineVersion: number;
  formatVersion: number;
  mapHash: string;
  hashes: Record<string, string>;
  hostHashes: Record<string, string>;
  canary: { values: number; hash: string };
}

async function openSim(browser: Browser, baseUrl: string, suffix = ''): Promise<{ page: Page; hooks: Hooks; messages: string[] }> {
  const page = await browser.newPage({ viewport: { width: 800, height: 400 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(20_000);
  const messages: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') messages.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => messages.push(`pageerror: ${e.message}`));
  await page.goto(`${baseUrl}/debug/sim.html${suffix}`, { waitUntil: 'load' });
  await page.waitForSelector('body[data-ready="1"]', { timeout: 20_000 });
  const hooks = (await page.evaluate(() => (window as unknown as { __debugSim: Hooks }).__debugSim)) as Hooks;
  return { page, hooks, messages };
}

describe('debug/sim.html (Chromium) against the committed hashes (Node)', () => {
  let browser: Browser;
  const baseUrl = inject('baseUrl');
  beforeAll(async () => {
    ({ browser } = await launchBrowser());
  });
  afterAll(async () => {
    await browser?.close();
  });

  it('is a Vite entry that loads its script by a relative address', () => {
    const html = fs.readFileSync('debug/sim.html', 'utf8');
    expect(html).toContain('src="../src/app/debugSim.ts"');
    expect(html).not.toMatch(/(?:src|href)="\//);
    expect(fs.readFileSync('vite.config.ts', 'utf8')).toContain("debug/sim.html");
  });

  it('golden hashes at ticks 1, 10, 100, 1000 and 6000 are equal in Chromium, in Node (the file), and through MainThreadHost', async () => {
    const golden = readGolden();
    const { page, hooks, messages } = await openSim(browser, baseUrl);
    try {
      expect(hooks.seed).toBe(golden.seed);
      expect(hooks.ticks).toBe(6000);
      expect(hooks.engineVersion).toBe(golden.engineVersion);
      expect(hooks.formatVersion).toBe(golden.formatVersion);
      expect(hooks.mapHash).toBe(golden.mapHash);
      expect(Object.keys(hooks.hashes)).toEqual(['1', '10', '100', '1000', '6000']);
      expect(hooks.hashes).toEqual(golden.hashes);
      expect(hooks.hostHashes).toEqual(golden.hashes);
      console.log(`[sim e2e] chromium hashes ${JSON.stringify(hooks.hashes)}`);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('the Float64 canary (sqrt, multiply, divide over 100 000 values) has the same hash in Chromium and Node', async () => {
    const golden = readGolden();
    const { page, hooks } = await openSim(browser, baseUrl, '?ticks=0');
    try {
      expect(hooks.canary.values).toBe(100000);
      expect(hooks.canary.hash).toBe(golden.canary.hash);
      console.log(`[sim e2e] canary ${hooks.canary.hash} in Chromium, ${golden.canary.hash} committed`);
    } finally {
      await page.close();
    }
  });

  it('another seed (query or hash) gives other hashes that still equal what Node computes', async () => {
    const golden = readGolden();
    for (const suffix of ['?seed=2&ticks=1000', '#seed-2_ticks-1000']) {
      const { page, hooks, messages } = await openSim(browser, baseUrl, suffix);
      try {
        expect(hooks.seed).toBe(2);
        const ticks = GOLDEN_TICKS.filter((t) => t <= 1000);
        const node = scenarioHashes({ seed: 2 }, ticks).map(hex32);
        expect(Object.values(hooks.hashes)).toEqual(node);
        expect(hooks.hostHashes).toEqual(hooks.hashes);
        expect(hooks.hashes['1000']).not.toBe(golden.hashes['1000']);
        expect(messages).toEqual([]);
      } finally {
        await page.close();
      }
    }
  });

  it('shows the hashes on the page', async () => {
    const { page } = await openSim(browser, baseUrl, '?ticks=100');
    try {
      const text = await page.locator('#hashes').innerText();
      const golden = readGolden();
      expect(text).toContain(golden.hashes['100']);
      expect(text).toContain(golden.canary.hash);
    } finally {
      await page.close();
    }
  });
});
