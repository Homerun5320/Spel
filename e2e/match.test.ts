// M05 Part A in headless Chromium (software WebGL2): the playable conquest on the globe. Real mouse and keyboard events on the
// page, the sim behind its host, the ownership texture read back from the GPU. Screenshots go to test-results/shots/match-*.png.
import fs from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { OUT_DIR, analyzeImage, decodePng, launchBrowser, luma, openPage } from '../scripts/shot.mjs';
import { deltaE76, rgbToLab } from '../src/render/color';
import { timeForSubsolarLon } from '../src/render/geo';
import { REJECT_IMMUNE, REJECT_PCT, REJECT_PHASE, REJECT_SELF, REJECT_TERRAIN } from '../src/sim/intents';
import { SPAWN_PHASE_TICKS, IMMUNITY_TICKS, START_DISC_CELLS } from '../src/sim/rules';
import { CLASS_ICE, CLASS_MOUNTAIN, CLASS_PEAK } from '../src/sim/terrain';
import { worldLoader } from '../tests/helpers/dataFiles';

interface MatchState {
  tick: number;
  phase: 'spawn' | 'immunity' | 'play';
  speed: number;
  paused: boolean;
  seed: number;
  rejects: number;
  lastRejectReason: number;
  commitPct: number;
  local: { spawned: boolean; cells: number; troops: number; troopsQt: number; capQt: number; gold: number; goldMilli: number; goldPerSecMilli: number; landShareQ15: number; landSharePct: number; alive: boolean };
  seats: Array<{ seat: number; cells: number; troopsQt: number; goldMilli: number; landShareQ15: number; alive: boolean }>;
  ownership: { uploads: number; gpuUploads: number; dirty: boolean };
  hostAdvance: { frames: number; meanMs: number; p95Ms: number; maxMs: number };
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
const submit = (page: Page, body: Record<string, unknown>): Promise<void> => page.evaluate((b) => (window as any).__test.submit(b), body);

async function shot(page: Page, name: string): Promise<Buffer> {
  await page.evaluate(() => (window as any).__test.render());
  const png = await page.screenshot({ type: 'png' });
  fs.writeFileSync(path.join(SHOT_DIR, `${name}.png`), png);
  return png;
}

/** A real left click on the surface point (lat, lon), found through the test hook that projects it. */
async function clickAt(page: Page, lat: number, lon: number): Promise<void> {
  const p = await page.evaluate(([a, o]) => (window as any).__test.project(a, o), [lat, lon] as const);
  expect(p.inView && p.facing, `(${lat}, ${lon}) is on screen`).toBe(true);
  await page.mouse.click(p.x, p.y);
}

const cellOf = (lat: number, lon: number): number => Math.floor(((90 - lat) / 180) * 512) * 1024 + Math.floor(((lon + 180) / 360) * 1024);

// The fixed script of the acceptance: seed 7, central Europe, spawn at 48.5 N 11 E, the attack on unowned land at 255 ticks.
const START = { lat: 48.5, lon: 11 };
const VIEW = { lat: 47, lon: 10, distKm: 2600, heading: 0, tilt: 0 };

async function playScript(page: Page, shots = false): Promise<{ start: MatchState; end: MatchState; hash: number }> {
  await view(page, VIEW);
  if (shots) await shot(page, 'match-t000');
  await clickAt(page, START.lat, START.lon);
  await advance(page, 0.1, 5);
  const start = await state(page);
  await advance(page, 0.1, 95);
  if (shots) await shot(page, 'match-t100');
  await advance(page, 0.1, 155); // tick 255: the spawn phase (200) and the immunity (50) are over
  await clickAt(page, 48.5, 17); // unowned land east of the capital disc
  await advance(page, 0.1, 45); // tick 300
  if (shots) await shot(page, 'match-t300');
  await advance(page, 0.1, 300); // tick 600
  if (shots) await shot(page, 'match-t600');
  return { start, end: await state(page), hash: await page.evaluate(() => (window as any).__test.hash()) };
}

describe('the playable match: spawn, attack, 600 ticks', () => {
  it('?test=1&seed=7: starts in the spawn phase, a click spawns, a click attacks, the land share grows, and the HUD shows the sim values', async () => {
    const { page, messages } = await open('test=1&seed=7&hud=1');
    try {
      const s0 = await state(page);
      expect(s0.seed).toBe(7);
      expect([s0.tick, s0.phase, s0.local.spawned, s0.local.cells, s0.rejects]).toEqual([0, 'spawn', false, 0, 0]);
      const r = await playScript(page, true);
      console.log(`[match] seed 7: ${r.start.local.cells} cells after the spawn, ${r.end.local.cells} at tick ${r.end.tick}; land share ${r.start.local.landSharePct.toFixed(3)} % -> ${r.end.local.landSharePct.toFixed(3)} %; troops ${r.end.local.troops}, gold ${r.end.local.gold}; sim hash ${r.hash.toString(16)}`);
      expect(r.start.local.spawned).toBe(true);
      expect(r.start.local.cells).toBe(START_DISC_CELLS); // a full capital disc inland
      expect(r.start.tick).toBe(5);
      expect(r.end.tick).toBe(600);
      expect(r.end.phase).toBe('play');
      expect(r.end.local.cells).toBeGreaterThan(r.start.local.cells);
      expect(r.end.local.landShareQ15).toBeGreaterThan(r.start.local.landShareQ15);
      expect(r.end.rejects).toBe(0);
      // HUD values equal the sim values (data-testid)
      const hud = await page.evaluate(() => ({
        troops: document.querySelector('[data-testid="troops"]')?.textContent ?? '',
        gold: document.querySelector('[data-testid="gold"]')?.textContent ?? '',
        phase: document.querySelector('[data-testid="phase"]')?.getAttribute('data-phase') ?? '',
      }));
      expect(Number(/\d+/.exec(hud.troops)?.[0])).toBe(r.end.local.troops);
      expect(Number(/\d+/.exec(hud.gold)?.[0])).toBe(r.end.local.gold);
      expect(hud.phase).toBe('play');
      // the four screenshots exist, are not blank, and differ from each other
      const names = ['match-t000', 'match-t100', 'match-t300', 'match-t600'];
      const pngs = names.map((n) => fs.readFileSync(path.join(SHOT_DIR, `${n}.png`)));
      for (const [i, png] of pngs.entries()) {
        const m = analyzeImage(decodePng(png));
        console.log(`[match] ${names[i]}: ${m.distinctColors} colours, luma std ${m.lumaStd.toFixed(1)}`);
        expect(m.distinctColors, names[i]).toBeGreaterThan(1000); // not a blank or flat picture
        expect(m.lumaStd, names[i]).toBeGreaterThan(15);
      }
      const shas = new Set(pngs.map((p) => p.toString('base64')));
      expect(shas.size).toBe(4);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('#test_seed-7 is the same match as ?test=1&seed=7 (same state hash after the same script), and another seed is another match', async () => {
    const a = await open('test=1&seed=7');
    const b = await open('#test_seed-7');
    const c = await open('test=1&seed=8');
    try {
      const ra = await playScript(a.page);
      const rb = await playScript(b.page);
      const rc = await playScript(c.page);
      expect(rb.hash).toBe(ra.hash);
      expect(rb.end.local.cells).toBe(ra.end.local.cells);
      expect((await state(b.page)).seed).toBe(7);
      expect(rc.hash).not.toBe(ra.hash);
      expect([...a.messages, ...b.messages, ...c.messages]).toEqual([]);
    } finally {
      await Promise.all([a.page.close(), b.page.close(), c.page.close()]);
    }
  });
});

describe('refusals are the sim\'s: the state stays as it was and the reject counter counts', () => {
  it('spawn on sea, on Peak and on Ice; attack on own land; spawn after the phase; pct 0; attack on owned land in the immunity', async () => {
    const world = worldLoader();
    const sim = await world.loadSim();
    const find = (cls: number): number => sim.terrainClass.indexOf(cls);
    const peak = find(CLASS_PEAK);
    expect(peak).toBeGreaterThanOrEqual(0);
    expect(find(CLASS_ICE)).toBeGreaterThanOrEqual(0); // the Antarctic click below lands on Ice
    const { page, messages } = await open('test=1&seed=7');
    try {
      const sample = async (): Promise<string> => {
        const cells = Array.from({ length: 200 }, (_, i) => (i * 2617 + 91) % (1024 * 512));
        const owners: number[] = await page.evaluate((c) => (window as any).__test.readOwnership(c), cells);
        const s = await state(page);
        return JSON.stringify({ owners, cells: s.seats.map((x) => x.cells) });
      };
      const expectRefused = async (what: string, reason: number, act: () => Promise<void>): Promise<void> => {
        const before = await state(page);
        const snapshot = await sample();
        await act();
        await advance(page, 0, 3);
        const after = await state(page);
        expect(after.rejects, `${what}: reject counter`).toBe(before.rejects + 1);
        expect(after.lastRejectReason, `${what}: reason`).toBe(reason);
        expect(await sample(), `${what}: owners and cell counts unchanged`).toBe(snapshot);
      };

      // 1. spawn on sea: a real click in the middle of the Atlantic
      await view(page, { lat: 30, lon: -40, distKm: 6000, heading: 0, tilt: 0 });
      await expectRefused('spawn on sea', REJECT_TERRAIN, () => clickAt(page, 30, -40));
      // 2. spawn on Ice: a real click on the Antarctic plateau
      await view(page, { lat: -80, lon: 0, distKm: 6000, heading: 0, tilt: 0 });
      await expectRefused('spawn on Ice', REJECT_TERRAIN, () => clickAt(page, -80, 0));
      // 3. spawn on a Peak cell, through the raw intent path (a click near a peak means the mountain next to it)
      await expectRefused('spawn on Peak', REJECT_TERRAIN, () => submit(page, { kind: 'Spawn', seat: 0, cell: peak }));
      expect((await state(page)).local.spawned).toBe(false);

      // a real spawn, then the phases
      await view(page, VIEW);
      await clickAt(page, START.lat, START.lon);
      await advance(page, 0, 3);
      expect((await state(page)).local.spawned).toBe(true);
      await submit(page, { kind: 'DebugPaint', seat: 1, cell: cellOf(48.5, 17) }); // an AI seat's land next to nothing yet; used below
      await advance(page, 0, 3);
      // 4. an attack in the spawn phase
      await expectRefused('attack in the spawn phase', REJECT_PHASE, () => submit(page, { kind: 'Attack', seat: 0, target: 0, pct: 40 }));
      // 5. the immunity: an Attack on owned land (the painted cell belongs to ownerId 2)
      await advance(page, 0, SPAWN_PHASE_TICKS + 2 - (await state(page)).tick);
      expect((await state(page)).phase).toBe('immunity');
      await expectRefused('attack on owned land in the immunity', REJECT_IMMUNE, () => submit(page, { kind: 'Attack', seat: 0, target: 2, pct: 40 }));
      // 6. spawn after the phase (seat 1 has not spawned)
      await expectRefused('spawn after the phase', REJECT_PHASE, () => submit(page, { kind: 'Spawn', seat: 2, cell: cellOf(40, 0) }));
      await advance(page, 0, IMMUNITY_TICKS + 5);
      expect((await state(page)).phase).toBe('play');
      // 7. attack on own land and 8. pct 0
      await expectRefused('attack on own land', REJECT_SELF, () => submit(page, { kind: 'Attack', seat: 0, target: 1, pct: 40 }));
      await expectRefused('pct 0', REJECT_PCT, () => submit(page, { kind: 'Attack', seat: 0, target: 0, pct: 0 }));
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

describe('the ownership texture', () => {
  it('equals the owner array in 200 sampled cells (GPU readback), and uploads at most 10 times per fx second at every sim speed', async () => {
    const { page, messages } = await open('test=1&seed=7');
    try {
      await playScript(page);
      // a long conquest so that owners change every tick: plenty of troops, all of them committed
      await page.evaluate(() => (window as any).__test.give(0, { gold: 0, troops: 200000 }));
      await advance(page, 0, 3);
      await submit(page, { kind: 'Attack', seat: 0, target: 0, pct: 100 });
      await advance(page, 0, 3);
      const cells: number[] = [];
      let lcg = 12345;
      for (let i = 0; i < 100; i++) {
        lcg = (Math.imul(lcg, 1664525) + 1013904223) >>> 0;
        cells.push(lcg % (1024 * 512));
      }
      // 100 more around the capital, where the owners are
      for (let i = 0; i < 100; i++) cells.push(cellOf(48.5 + ((i % 10) - 5) * 0.35, 11 + (Math.floor(i / 10) - 5) * 0.5));
      const readback: number[] = await page.evaluate((c) => (window as any).__test.readOwnership(c), cells);
      const mirror: number[] = await page.evaluate((c) => c.map((x) => (window as any).__test.ownerOf(x)), cells);
      expect(readback).toEqual(mirror);
      expect(readback.filter((o) => o !== 0).length).toBeGreaterThan(20); // not a trivial all-zero comparison
      expect(new Set(readback).size).toBeGreaterThanOrEqual(2);

      for (const speed of [1, 2, 4] as const) {
        await page.evaluate((s) => (window as any).__test.setSpeed(s), speed);
        const before = await state(page);
        const r: { uploads: number; ticks: number } = await page.evaluate(() => (window as any).__test.run(3, 60));
        const after = await state(page);
        console.log(`[ownership] speed ${speed}x: ${r.ticks} ticks and ${r.uploads} uploads in 3 fx seconds (${(r.uploads / 3).toFixed(1)} per second); cells ${before.local.cells} -> ${after.local.cells}`);
        expect(r.uploads).toBeLessThanOrEqual(30);
        expect(r.uploads).toBeGreaterThan(0);
        expect(r.ticks).toBeGreaterThanOrEqual(30 * speed - 2);
        expect(r.ticks).toBeLessThanOrEqual(30 * speed + 2);
        expect(after.local.cells).toBeGreaterThan(before.local.cells); // owners changed all the time, and the uploads still stayed throttled
      }
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

describe('territory borders', () => {
  it('on a Mountain cell the border pixel differs by CIE76 dE >= 15 from both the own and the neighbour colour', async () => {
    const sim = await worldLoader().loadSim();
    // the first 12 x 6 block of Mountain cells (class 5) in scan order
    let block: { x: number; y: number } | null = null;
    const BW = 12;
    const BH = 6;
    outer: for (let y = 40; y < 470; y++) {
      for (let x = 0; x < 1024 - BW; x++) {
        let ok = true;
        for (let j = 0; j < BH && ok; j++) for (let i = 0; i < BW && ok; i++) if (sim.terrainClass[(y + j) * 1024 + x + i] !== CLASS_MOUNTAIN) ok = false;
        if (ok) {
          block = { x, y };
          break outer;
        }
      }
    }
    expect(block, 'a 12 x 6 block of Mountain cells exists').not.toBeNull();
    const b = block as { x: number; y: number };
    const lat = 90 - ((b.y + BH / 2) / 512) * 180;
    const lonMid = ((b.x + BW / 2) / 1024) * 360 - 180;
    const lonBorder = ((b.x + BW / 2) / 1024) * 360 - 180; // the vertical border between the 6th and 7th column
    const { page, messages } = await open('test=1&seed=7');
    try {
      await page.evaluate(
        ([x0, y0, w, h]) => {
          const t = (window as any).__test;
          for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) t.submit({ kind: 'DebugPaint', seat: i < w / 2 ? 0 : 1, cell: (y0 + j) * 1024 + x0 + i });
        },
        [b.x, b.y, BW, BH] as const,
      );
      await advance(page, 0, 3);
      const owners: number[] = await page.evaluate(([x0, y0]) => [(window as any).__test.ownerOf(y0 * 1024 + x0), (window as any).__test.ownerOf(y0 * 1024 + x0 + 11)], [b.x, b.y] as const);
      expect(owners).toEqual([1, 2]);
      await view(page, { lat, lon: lonMid, distKm: 750, heading: 0, tilt: 0, time: timeForSubsolarLon(lonMid) });
      const png = await shot(page, 'match-border-mountain');
      const img = decodePng(png);
      const at = (x: number, y: number): [number, number, number] => {
        const o = (Math.round(y) * img.width + Math.round(x)) * 4;
        return [img.data[o] as number, img.data[o + 1] as number, img.data[o + 2] as number];
      };
      const mean = (x: number, y: number): [number, number, number] => {
        const acc = [0, 0, 0];
        for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) at(x + dx, y + dy).forEach((v, k) => (acc[k] = (acc[k] as number) + v));
        return [(acc[0] as number) / 81, (acc[1] as number) / 81, (acc[2] as number) / 81];
      };
      const p = await page.evaluate(([a, o]) => (window as any).__test.project(a, o), [lat, lonBorder] as const);
      const px = (await page.evaluate(([a, o]) => (window as any).__test.project(a, o), [lat, lonBorder + 0.5] as const)).x - p.x; // pixels per half a degree
      expect(Math.abs(px)).toBeGreaterThan(40); // the cells are tens of pixels wide: the border is a line, not a smear
      const lab = (c: [number, number, number]) => rgbToLab(c[0], c[1], c[2]);
      const worst: number[] = [];
      for (const dy of [-60, -30, 0, 30, 60]) {
        const y = p.y + dy;
        // the border pixel: the darkest pixel within 40 px of the nominal border position on this row (the domain warp moves the line by up to a third of a cell, about 15 px here)
        let best = at(p.x, y);
        for (let dx = -40; dx <= 40; dx++) if (luma(...at(p.x + dx, y)) < luma(...best)) best = at(p.x + dx, y);
        const own = mean(p.x - 90, y);
        const nb = mean(p.x + 90, y);
        const dOwn = deltaE76(lab(best), lab(own));
        const dNb = deltaE76(lab(best), lab(nb));
        worst.push(Math.min(dOwn, dNb));
      }
      console.log(`[border] Mountain block at cell (${b.x}, ${b.y}) lat ${lat.toFixed(1)} lon ${lonMid.toFixed(1)}: worst dE76 of the border pixel against the own and the neighbour colour per row ${worst.map((w) => w.toFixed(1)).join(', ')}`);
      for (const w of worst) expect(w).toBeGreaterThanOrEqual(15);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

describe('input: click against drag, the HUD, the keys', () => {
  it('a drag rotates the globe and spawns nothing; a click on the HUD never reaches the globe; a short click spawns', async () => {
    const { page, messages } = await open('test=1&seed=7&hud=1');
    try {
      await view(page, VIEW);
      const v0 = await page.evaluate(() => (window as any).__test.view());
      await page.mouse.move(480, 270);
      await page.mouse.down();
      await page.mouse.move(520, 280, { steps: 8 });
      await page.mouse.up();
      await advance(page, 0, 3);
      const v1 = await page.evaluate(() => (window as any).__test.view());
      expect(Math.abs(v1.lon - v0.lon) + Math.abs(v1.lat - v0.lat)).toBeGreaterThan(0.5); // it rotated
      let s = await state(page);
      expect([s.local.spawned, s.rejects]).toEqual([false, 0]); // and it neither spawned nor was refused

      // the HUD: its buttons and its empty padding
      await page.click('[data-testid="speed-2"]');
      await page.click('[data-testid="controls"]', { position: { x: 3, y: 3 } });
      await page.click('[data-testid="commit-slider"]');
      await advance(page, 0, 3);
      s = await state(page);
      expect([s.local.spawned, s.rejects, s.speed]).toEqual([false, 0, 2]);

      // a short click on land spawns (with jitter below the threshold)
      await view(page, VIEW);
      const p = await page.evaluate(([a, o]) => (window as any).__test.project(a, o), [START.lat, START.lon] as const);
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      await page.mouse.move(p.x + 2, p.y + 1);
      await page.mouse.up();
      await advance(page, 0, 3);
      expect((await state(page)).local.spawned).toBe(true);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('[ ] change the commitment in steps of 5 between 5 and 100, space pauses, , and . change the speed', async () => {
    const { page, messages } = await open('test=1&seed=7');
    try {
      expect((await state(page)).commitPct).toBe(40);
      await page.keyboard.press(']');
      expect((await state(page)).commitPct).toBe(45);
      for (let i = 0; i < 3; i++) await page.keyboard.press('[');
      expect((await state(page)).commitPct).toBe(30);
      for (let i = 0; i < 30; i++) await page.keyboard.press('[');
      expect((await state(page)).commitPct).toBe(5);
      for (let i = 0; i < 30; i++) await page.keyboard.press(']');
      expect((await state(page)).commitPct).toBe(100);
      let s = await state(page);
      expect([s.speed, s.paused]).toEqual([1, false]);
      await page.keyboard.press(' ');
      s = await state(page);
      expect([s.speed, s.paused]).toEqual([0, true]);
      await page.keyboard.press(' ');
      expect((await state(page)).speed).toBe(1);
      await page.keyboard.press('.');
      expect((await state(page)).speed).toBe(2);
      await page.keyboard.press('.');
      await page.keyboard.press('.');
      expect((await state(page)).speed).toBe(4);
      await page.keyboard.press(',');
      expect((await state(page)).speed).toBe(2);
      await page.keyboard.press(',');
      await page.keyboard.press(',');
      expect((await state(page)).speed).toBe(1);
      // the chosen speed survives a pause
      await page.keyboard.press('.');
      await page.keyboard.press(' ');
      await page.keyboard.press(' ');
      expect((await state(page)).speed).toBe(2);
      // the attack commits what the slider says
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

describe('__test.give', () => {
  it('changes gold and troops only through a DebugGive intent: nothing happens before the intent is applied (T + 2)', async () => {
    const { page, messages } = await open('test=1&seed=7');
    try {
      await view(page, VIEW);
      await clickAt(page, START.lat, START.lon);
      await advance(page, 0, 3);
      const a = await state(page);
      await page.evaluate(() => (window as any).__test.give(0, { gold: 1000, troops: 500 }));
      const b = await state(page);
      expect([b.local.goldMilli, b.local.troopsQt]).toEqual([a.local.goldMilli, a.local.troopsQt]); // not written directly
      await advance(page, 0, 1);
      expect((await state(page)).local.gold - a.local.gold).toBeLessThan(1000); // one tick after the call: still before T + 2
      await advance(page, 0, 3);
      const c = await state(page);
      expect(c.local.gold - a.local.gold).toBeGreaterThanOrEqual(1000);
      expect(c.local.troops - a.local.troops).toBeGreaterThanOrEqual(500);
      // a seat without land is refused (and counted)
      const r0 = (await state(page)).rejects;
      await page.evaluate(() => (window as any).__test.give(3, { gold: 5, troops: 5 }));
      await advance(page, 0, 3);
      expect((await state(page)).rejects).toBe(r0 + 1);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

describe('long runs and budgets', () => {
  it('6000 ticks run in the browser without console errors, with the match staying consistent (the test tier stays at <= 150k triangles)', async () => {
    const { page, messages } = await open('test=1&seed=7');
    try {
      await playScript(page);
      await page.evaluate(() => (window as any).__test.give(0, { gold: 0, troops: 100000 }));
      for (let k = 0; k < 6; k++) {
        await advance(page, 0, 1000);
        await submit(page, { kind: 'Attack', seat: 0, target: 0, pct: 60 });
      }
      const s = await state(page);
      expect(s.tick).toBeGreaterThanOrEqual(6000);
      expect(s.local.cells).toBeGreaterThan(500);
      await page.evaluate(() => (window as any).__test.render());
      const info = await page.evaluate(() => (window as any).__test.info());
      console.log(`[match] after ${s.tick} ticks: ${s.local.cells} cells (${s.local.landSharePct.toFixed(2)} % of the land), ${info.triangles} triangles, ${info.drawCalls} draw calls, ${info.textureMB.toFixed(1)} MB of textures`);
      expect(info.triangles).toBeLessThanOrEqual(150_000);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('the live loop is not needed to be exact, but the host advance cost per frame at 4x is measured and logged (frames of 1/60 s, no drawing)', async () => {
    const { page, messages } = await open('test=1&seed=7');
    try {
      await playScript(page);
      await page.evaluate(() => (window as any).__test.give(0, { gold: 0, troops: 100000 }));
      await advance(page, 0, 3);
      await submit(page, { kind: 'Attack', seat: 0, target: 0, pct: 100 });
      await advance(page, 0, 3);
      await page.evaluate(() => (window as any).__test.setSpeed(4));
      const ms: number = await page.evaluate(() => {
        const t = (window as any).__test;
        const t0 = performance.now();
        t.run(5, 60); // 300 frames at 4x = 200 ticks of a big conquest
        return performance.now() - t0;
      });
      console.log(`[match] 300 frames at 4x with a running conquest took ${ms.toFixed(1)} ms in total (${(ms / 300).toFixed(3)} ms per frame; software GL not involved, nothing drawn); logged, not asserted`);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

describe('the Dev panel', () => {
  it('has a seed field with the id seed and a relative link to debug/sim.html; the field restarts the match with that seed', async () => {
    const { page, messages } = await open('test=1&seed=7&devbtn=1');
    try {
      await page.keyboard.press('F2');
      await page.waitForSelector('[data-dev-panel] input#seed');
      const href = await page.getAttribute('[data-dev-mode="debug-sim"]', 'href');
      expect(href?.endsWith('debug/sim.html')).toBe(true);
      expect(await page.inputValue('input#seed')).toBe('7');
      await page.fill('input#seed', '12');
      await page.click('[data-dev-field-go="seed"]');
      await page.waitForFunction(() => (window as any).__test?.state?.()?.seed === 12);
      expect(await page.evaluate(() => window.location.hash)).toContain('seed-12');
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

describe('the live page (no test mode): start screen, Play, a click spawns, the loop runs the sim', () => {
  it('opens on the start screen with a Play button; Play shows the HUD; a click on land spawns; the frame loop advances ticks and logs the host advance cost', async () => {
    const page = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
    const messages: Array<{ type: string; text: string }> = [];
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') messages.push({ type: m.type(), text: m.text() });
    });
    page.on('pageerror', (e) => messages.push({ type: 'error', text: `pageerror: ${e.message}` }));
    try {
      await page.goto(`${baseUrl}/?quality=low#perf_seed-7`, { waitUntil: 'load' });
      await page.waitForSelector('[data-testid="start-screen"]', { timeout: 30_000 });
      expect(await page.locator('[data-testid="match-hud"]').count()).toBe(0); // nothing of the match before Play
      fs.writeFileSync(path.join(SHOT_DIR, 'match-start-screen.png'), await page.screenshot({ type: 'png' }));
      await page.click('[data-testid="play"]');
      await page.waitForSelector('[data-testid="match-hud"]', { timeout: 30_000 });
      expect(await page.locator('[data-testid="start-screen"]').count()).toBe(0);
      // a click on the middle of the globe (the default view looks at the Sahara): spawn
      await page.mouse.click(480, 270);
      await page.waitForFunction(() => Number(/\d+/.exec(document.querySelector('[data-testid="troops"]')?.textContent ?? '')?.[0] ?? 0) > 100, undefined, { timeout: 30_000 });
      // the loop runs: the countdown of the spawn phase goes down
      await page.waitForFunction(() => Number(/\d+/.exec(document.querySelector('[data-testid="phase-seconds"]')?.textContent ?? '')?.[0] ?? 99) < 20, undefined, { timeout: 30_000 });
      fs.writeFileSync(path.join(SHOT_DIR, 'match-live.png'), await page.screenshot({ type: 'png' }));
      const text = await page.evaluate(() => document.querySelector('[data-perf]')?.textContent ?? '');
      console.log(`[live] perf overlay: ${text.replace(/\n/g, ' | ')}`);
      expect(text).toContain('match: tick');
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });
});
