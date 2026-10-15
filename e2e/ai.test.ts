// M05 Part C in headless Chromium (software WebGL2): the match with the AI nations and the 20 tribes. Screenshots go to
// test-results/shots/ai-*.png. The sim part is also run in Node and must give the same state hash (the AI is deterministic).
import fs from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { OUT_DIR, analyzeImage, decodePng, launchBrowser, openPage } from '../scripts/shot.mjs';
import { LOCAL_SEAT, MatchSession } from '../src/app/match';
import { MATCH_AI_NATIONS, MATCH_TRIBES, START_DISC_CELLS } from '../src/sim/rules';
import { loadRealWorld } from '../tools/sim/realWorld';

interface MatchState {
  tick: number;
  phase: 'spawn' | 'immunity' | 'play';
  rejects: number;
  local: { spawned: boolean; cells: number; landShareQ15: number; landSharePct: number; troops: number; gold: number };
  seats: Array<{ seat: number; cells: number; troopsQt: number; landShareQ15: number; alive: boolean }>;
  ownership: { uploads: number; gpuUploads: number };
}

const PLAYERS = 1 + MATCH_AI_NATIONS;
const SEATS = PLAYERS + MATCH_TRIBES;
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
const advance = (page: Page, ticks: number): Promise<void> => page.evaluate((t) => (window as any).__test.advance(0.1, t), ticks);
const view = (page: Page, v: Record<string, number>): Promise<void> => page.evaluate((x) => (window as any).__test.setView(x), v);
const hash = (page: Page): Promise<number> => page.evaluate(() => (window as any).__test.hash());

async function shot(page: Page, name: string): Promise<Buffer> {
  await page.evaluate(() => (window as any).__test.render());
  const png = await page.screenshot({ type: 'png' });
  fs.writeFileSync(path.join(SHOT_DIR, `${name}.png`), png);
  return png;
}

async function clickAt(page: Page, lat: number, lon: number): Promise<void> {
  const p = await page.evaluate(([a, o]) => (window as any).__test.project(a, o), [lat, lon] as const);
  expect(p.inView && p.facing, `(${lat}, ${lon}) is on screen`).toBe(true);
  await page.mouse.click(p.x, p.y);
}

const cellOf = (lat: number, lon: number): number => Math.floor(((90 - lat) / 180) * 512) * 1024 + Math.floor(((lon + 180) / 360) * 1024);
const START = { lat: 48.5, lon: 11 };
const VIEW = { lat: 47, lon: 10, distKm: 2600, heading: 0, tilt: 0 };

describe('the match with the AI (?test=1&seed=7, AI on by default)', () => {
  it('spawn by a click, 600 ticks: the tribes and the nations are on the map, the land share grows, the HUD equals the sim, four screenshots', async () => {
    const { page, messages } = await open('test=1&seed=7&hud=1');
    try {
      await view(page, VIEW);
      await shot(page, 'ai-t000');
      await clickAt(page, START.lat, START.lon);
      await advance(page, 5);
      const start = await state(page);
      expect(start.local.spawned, 'the click spawned (nobody was there)').toBe(true);
      expect(start.local.cells).toBe(START_DISC_CELLS);
      // the AI seats wait for the human capital (it showed at tick 3), then follow one by one, 3 ticks apart: none is down at tick 5
      expect(start.seats.filter((s) => s.seat > 0 && s.alive)).toHaveLength(0);
      await advance(page, 95);
      expect((await state(page)).seats.filter((s) => s.seat > 0 && s.alive), 'all 25 AI seats are down by tick 100').toHaveLength(SEATS - 1);
      await shot(page, 'ai-t100');
      await advance(page, 155); // tick 255: the spawn phase and the immunity are over
      await clickAt(page, 48.5, 17); // unowned land east of the capital disc
      await advance(page, 45);
      await shot(page, 'ai-t300');
      const s300 = await state(page);
      await advance(page, 300);
      await shot(page, 'ai-t600');
      const end = await state(page);
      console.log(`[ai] seed 7: you ${start.local.cells} -> ${s300.local.cells} (t300) -> ${end.local.cells} cells (t600); land share ${start.local.landSharePct.toFixed(3)} % -> ${end.local.landSharePct.toFixed(3)} %`);
      expect(end.tick).toBe(600);
      expect(end.local.landShareQ15).toBeGreaterThan(start.local.landShareQ15);
      expect(end.local.cells).toBeGreaterThan(start.local.cells);
      expect(end.rejects, 'the AI sent nothing the sim refused').toBe(0);
      // all 25 other seats have land, the nations have grown beyond their capital, the tribes sit on theirs
      for (const s of end.seats) {
        if (s.seat === LOCAL_SEAT) continue;
        expect(s.alive, `seat ${s.seat}`).toBe(true);
        expect(s.cells, `seat ${s.seat}`).toBeGreaterThanOrEqual(START_DISC_CELLS);
      }
      const nations = end.seats.filter((s) => s.seat > 0 && s.seat < PLAYERS);
      expect(nations.reduce((a, s) => a + s.cells, 0), 'the nations expanded').toBeGreaterThan(nations.length * START_DISC_CELLS);
      // the HUD equals the sim
      const hud = await page.evaluate(() => ({
        troops: document.querySelector('[data-testid="troops"]')?.getAttribute('data-value') ?? '',
        gold: document.querySelector('[data-testid="gold"]')?.getAttribute('data-value') ?? '',
        share: document.querySelector('[data-testid="land-share"]')?.getAttribute('data-value') ?? '',
        rows: document.querySelectorAll('[data-testid="leader-row"]').length,
      }));
      expect(Number(hud.troops)).toBe(end.local.troops);
      expect(Number(hud.gold)).toBe(end.local.gold);
      expect(hud.rows).toBeGreaterThanOrEqual(5);
      // four different, non-blank pictures
      const pngs = ['ai-t000', 'ai-t100', 'ai-t300', 'ai-t600'].map((n) => fs.readFileSync(path.join(SHOT_DIR, `${n}.png`)));
      for (const png of pngs) expect(analyzeImage(decodePng(png)).distinctColors).toBeGreaterThan(1000);
      expect(new Set(pngs.map((p) => p.toString('base64'))).size).toBe(4);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('#test_seed-7 is the same match as ?test=1&seed=7, another seed is another one, and ai=0 leaves the other 25 seats empty', async () => {
    const play = async (query: string): Promise<{ h: number; s: MatchState }> => {
      const { page, messages } = await open(query);
      try {
        await page.evaluate((c) => (window as any).__test.submit({ kind: 'Spawn', seat: 0, cell: c }), cellOf(START.lat, START.lon));
        await advance(page, 400);
        const out = { h: await hash(page), s: await state(page) };
        expect(messages).toEqual([]);
        return out;
      } finally {
        await page.close();
      }
    };
    const a = await play('test=1&seed=7');
    const b = await play('#test_seed-7');
    const c = await play('test=1&seed=8');
    const d = await play('#test_ai-0_seed-7');
    expect(b.h).toBe(a.h);
    expect(c.h).not.toBe(a.h);
    expect(d.h).not.toBe(a.h);
    expect(a.s.seats.filter((s) => s.alive)).toHaveLength(SEATS);
    expect(d.s.seats.filter((s) => s.alive)).toHaveLength(1);
  });

  it('6000 ticks without a console error, inside the render budget, and the same state hash as the same match run in Node (the AI is deterministic across engines)', async () => {
    const world = await loadRealWorld();
    const node = await MatchSession.create(
      { width: world.width, height: world.height, terrainClass: world.terrain, meanElev: world.elevation, cosQ15: world.rowCos },
      { seed: 7, debugIntents: true, interpolate: false },
    );
    node.spawnAt(cellOf(START.lat, START.lon));
    const nodeHashes: number[] = [];
    for (const upTo of [600, 3000, 6000]) {
      node.runTicks(upTo - node.view.tick);
      nodeHashes.push(await node.hash());
    }
    node.dispose();

    const { page, messages } = await open('test=1&seed=7');
    try {
      await page.evaluate((c) => (window as any).__test.submit({ kind: 'Spawn', seat: 0, cell: c }), cellOf(START.lat, START.lon));
      const browserHashes: number[] = [];
      for (const upTo of [600, 3000, 6000]) {
        const now = (await state(page)).tick;
        await advance(page, upTo - now);
        browserHashes.push(await hash(page));
      }
      expect(browserHashes).toEqual(nodeHashes);
      const end = await state(page);
      expect(end.tick).toBe(6000);
      expect(end.rejects).toBe(0);
      await page.evaluate(() => (window as any).__test.render());
      const info = await page.evaluate(() => (window as any).__test.info());
      console.log(`[ai] 6000 ticks: sim hash ${browserHashes.map((h) => h.toString(16)).join(' ')} (Node: the same); ${info.triangles} triangles, ${info.drawCalls} draw calls; ownership uploads ${end.ownership.uploads}`);
      expect(info.triangles).toBeLessThanOrEqual(150_000);
      expect(info.drawCalls).toBeLessThanOrEqual(100) // row 0 of the Budgetar table (Fix-UI: 30 -> 100);
      await view(page, { lat: 30, lon: 15, distKm: 11000, heading: 0, tilt: 0 });
      await shot(page, 'ai-world-t6000');
      await view(page, { lat: 47, lon: 10, distKm: 2600, heading: 0, tilt: 0 });
      await shot(page, 'ai-europe-t6000');
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('ownership uploads stay at 10 per second of fx time or less at every speed while 25 AI seats conquer', async () => {
    const { page, messages } = await open('test=1&seed=7');
    try {
      await page.evaluate((c) => (window as any).__test.submit({ kind: 'Spawn', seat: 0, cell: c }), cellOf(START.lat, START.lon));
      await advance(page, 300); // the spawn phase and the immunity are over, the AI is expanding
      for (const speed of [1, 2, 4]) {
        await page.evaluate((sp) => (window as any).__test.setSpeed(sp), speed);
        const seconds = 20;
        const r = await page.evaluate((sec) => (window as any).__test.run(sec, 60), seconds);
        console.log(`[ai] speed ${speed}x: ${r.ticks} ticks and ${r.uploads} ownership uploads in ${seconds} fx seconds (${(r.uploads / seconds).toFixed(1)} per second)`);
        expect(r.ticks).toBeGreaterThanOrEqual(seconds * 10 * speed - 8);
        expect(r.uploads).toBeLessThanOrEqual(seconds * 10 + 1);
        expect(r.uploads).toBeGreaterThan(0);
      }
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});
