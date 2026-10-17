// M18e-2 in headless Chromium (software WebGL2): the Airfield, Lab and Plant have models of their own, in ONE shared mesh. Real build-bar clicks and keys 7, 8, 9
// start the placement with the right ghost (the ghost's type number); building all three next to a Factory, a Silo and a City adds at most ONE draw call
// and the triangles renderer.info reports; the night lamps of the Lab and the Plant light up on the night side only. Pictures (3 km and 1.5 km, day and night,
// two owners, the Factory and the Silo beside the new three; the near pictures are from about 1.5 km: a model is up to 800 m tall and 1.5 km wide, so a camera 800 m away stands inside it): test-results/shots/airlabplant-*.png, looked at by eye (no golden).
import fs from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { OUT_DIR, analyzeImage, decodePng, encodePng, launchBrowser, openPage } from '../scripts/shot.mjs';
import { timeForSubsolarLon } from '../src/render/geo';
import { STRUCT_AIRFIELD, STRUCT_CITY, STRUCT_FACTORY, STRUCT_LAB, STRUCT_PLANT, STRUCT_SILO } from '../src/sim/structureRules';
import { CLASS_HILLS, CLASS_PLAINS } from '../src/sim/terrain';
import { worldLoader } from '../tests/helpers/dataFiles';
import { cellToLatLon } from '../src/render/transforms';
import { STRUCTURE_MODELS } from '../src/render/structureModels';

let browser: Browser;
const baseUrl = inject('baseUrl');
const SHOT_DIR = path.join(OUT_DIR, 'shots');
const WIDTH = 1024;
const HEIGHT = 512;
const llOf = (cell: number): { lat: number; lon: number } => cellToLatLon(cell, WIDTH, HEIGHT);

beforeAll(async () => {
  ({ browser } = await launchBrowser());
  fs.mkdirSync(SHOT_DIR, { recursive: true });
});
afterAll(async () => {
  await browser?.close();
});

interface Props {
  counts: Record<number, number>;
  dropped: number;
  placing: number;
  ghost: { type: number; cell: number; ok: boolean; reason: number } | null;
}

const T = (page: Page) => ({
  props: (): Promise<Props> => page.evaluate(() => (window as any).__test.props()),
  state: (): Promise<{ local: { spawned: boolean }; structures: { count: number; byType: number[] } }> => page.evaluate(() => (window as any).__test.state()),
  advance: (dt: number, ticks: number): Promise<void> => page.evaluate(([d, n]) => (window as any).__test.advance(d, n), [dt, ticks] as const),
  settle: (n = 2): Promise<void> => page.evaluate((k) => (window as any).__test.settle(0, k), n),
  view: (v: Record<string, number>): Promise<void> => page.evaluate((x) => (window as any).__test.setView(x), v),
  project: (lat: number, lon: number): Promise<{ x: number; y: number; inView: boolean; facing: boolean }> => page.evaluate(([a, o]) => (window as any).__test.project(a, o), [lat, lon] as const),
  info: (): Promise<{ drawCalls: number; triangles: number }> => page.evaluate(() => (window as any).__test.info()),
  cells: (): Promise<{ cells: number[]; capitals: number[] }> => page.evaluate(() => (window as any).__test.seatCells()),
  submit: (body: Record<string, unknown>): Promise<void> => page.evaluate((b) => (window as any).__test.submit(b), body),
});

async function closeUp(page: Page, lat: number, lon: number, dKm: number, aglM: number, pitchDeg: number, night: boolean): Promise<void> {
  const time = timeForSubsolarLon(lon + 25 + (night ? 180 : 0));
  await page.evaluate(([la, lo, d, agl, pitch, tm]) => (window as any).__test.setGroundView({ lat: la - d / 111.2, lon: lo, heading: 0, pitchDeg: pitch, aglM: agl, time: tm }), [lat, lon, dKm, aglM, pitchDeg, time] as const);
}

/** `count` cells of the block `[x0 - r, x0 + r] x [y0 - r, y0 + r]` that are Plains or Hills, at least 3 cells apart, nearest to the centre first. */
function spread(terrain: Uint8Array, cx: number, cy: number, r: number, count: number, skip: number[]): number[] {
  const cand: Array<{ c: number; d: number }> = [];
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const c = (cy + dy) * WIDTH + ((cx + dx + WIDTH) % WIDTH);
      if (terrain[c] === CLASS_PLAINS || terrain[c] === CLASS_HILLS) cand.push({ c, d: Math.hypot(dx, dy) });
    }
  }
  cand.sort((p, q) => p.d - q.d);
  const out: number[] = [];
  for (const k of cand) {
    const kx = k.c % WIDTH;
    const ky = (k.c - kx) / WIDTH;
    if ([...out, ...skip].some((o) => Math.hypot((o % WIDTH) - kx, (o - (o % WIDTH)) / WIDTH - ky) < 3.5)) continue;
    out.push(k.c);
    if (out.length === count) break;
  }
  return out;
}

describe('Airfield, Lab and Plant: models of their own in one shared mesh', () => {
  it('buttons 7, 8, 9 start the placement with the right ghost; the three types add one draw call; the lamps are lit at night only; pictures', async () => {
    const sim = await worldLoader().loadSim();
    const terrain = sim.terrainClass as unknown as Uint8Array;
    const { page, consoleMessages } = await openPage(browser, baseUrl, 'test=1&seed=7&ai=0&hud=1', { width: 960, height: 540 });
    try {
      const t = T(page);
      await t.view({ lat: 47, lon: 10, distKm: 2600, heading: 0, tilt: 0 });
      const p0 = await t.project(48.5, 11);
      await page.mouse.click(p0.x, p0.y);
      await t.advance(0.1, 5);
      await page.evaluate(() => (window as any).__test.give(0, { gold: 900000 }));
      await page.evaluate(() => (window as any).__test.give(1, { gold: 900000, troops: 500 }));
      await t.advance(0.1, 4);
      const capital = (await t.cells()).capitals[0] as number;
      expect((await t.state()).local.spawned).toBe(true);
      await t.advance(0.1, 210); // past the spawn phase
      const cx = capital % WIDTH;
      const cy = (capital - cx) / WIDTH;
      // own land round the capital (the debug intent), so that the placement rules and not the ownership speak
      const paint = async (seat: number, x0: number, y0: number, r: number): Promise<void> => {
        await page.evaluate(([s, ax, ay, rr]) => {
          for (let dy = -rr; dy <= rr; dy++) for (let dx = -rr; dx <= rr; dx++) (window as any).__test.submit({ kind: 'DebugPaint', seat: s, cell: (ay + dy) * 1024 + ax + dx });
        }, [seat, x0, y0, r] as const);
        await t.advance(0.1, 2);
      };
      await paint(0, cx, cy, 9);
      const mine = spread(terrain, cx, cy, 9, 6, [capital]);
      expect(mine.length).toBe(6);
      const [cityCell, plantCell, airCell, labCell, siloCell] = mine as [number, number, number, number, number, number];
      // the buttons: a click on 7, 8 and 9 starts the placement of the type, and the ghost on a free own cell is of that type and green
      for (const [testid, type, cell] of [['build-airfield', STRUCT_AIRFIELD, airCell], ['build-lab', STRUCT_LAB, labCell], ['build-plant', STRUCT_PLANT, plantCell]] as const) {
        expect(await page.locator(`[data-testid="${testid}"]`).count()).toBe(1);
        await page.locator(`[data-testid="${testid}"]`).click();
        expect((await t.props()).placing, testid).toBe(type);
        const at = llOf(cell);
        await t.view({ lat: at.lat, lon: at.lon, distKm: 80, heading: 0, tilt: 0 }); // seen from straight above, so that no ridge hides the cell
        await t.settle();
        const m = await t.project(at.lat, at.lon);
        await page.mouse.move(m.x + 40, m.y + 40); // (a move to the very same screen point as before would raise no event)
        await page.mouse.move(m.x, m.y);
        await t.settle();
        const g = (await t.props()).ghost;
        // the Plant is red until there is a City or Port near it (its rule); the type is what this test pins
        expect([g?.type, g?.cell]).toEqual([type, cell]);
        if (type !== STRUCT_PLANT) expect(g?.ok).toBe(true);
        await page.keyboard.press('Escape');
        expect((await t.props()).placing).toBe(0);
      }
      for (const [key, type] of [['7', STRUCT_AIRFIELD], ['8', STRUCT_LAB], ['9', STRUCT_PLANT]] as const) {
        await page.keyboard.press(key);
        expect((await t.props()).placing, `key ${key}`).toBe(type);
        await page.keyboard.press('Escape');
      }
      // the baseline view with a Factory, a Silo and a City built (the older types), then the three new ones
      await t.submit({ kind: 'Build', seat: 0, type: STRUCT_FACTORY, cell: capital });
      await t.submit({ kind: 'Build', seat: 0, type: STRUCT_CITY, cell: cityCell });
      await t.advance(0.1, 215); // the Factory is finished
      await t.submit({ kind: 'Build', seat: 0, type: STRUCT_SILO, cell: siloCell });
      await t.advance(0.1, 300);
      await t.advance(1, 0);
      const at0 = llOf(airCell);
      await closeUp(page, at0.lat, at0.lon, 3.0, 1200, 24, false);
      await t.settle();
      const before = await t.info();
      await t.submit({ kind: 'Build', seat: 0, type: STRUCT_AIRFIELD, cell: airCell });
      await t.submit({ kind: 'Build', seat: 0, type: STRUCT_LAB, cell: labCell });
      await t.submit({ kind: 'Build', seat: 0, type: STRUCT_PLANT, cell: plantCell });
      await t.advance(0.1, 4);
      await t.advance(0.1, 300);
      await t.advance(1, 0);
      await t.settle();
      const props = await t.props();
      expect([STRUCT_FACTORY, STRUCT_SILO, STRUCT_CITY, STRUCT_AIRFIELD, STRUCT_LAB, STRUCT_PLANT].map((ty) => props.counts[ty])).toEqual([1, 1, 1, 1, 1, 1]);
      expect(props.dropped).toBe(0);
      const after = await t.info();
      const total = [STRUCT_AIRFIELD, STRUCT_LAB, STRUCT_PLANT].reduce((n, ty) => n + (STRUCTURE_MODELS[ty]?.build().triangles ?? 0), 0);
      console.log(`[airlabplant] draw calls ${before.drawCalls} -> ${after.drawCalls}, triangles ${before.triangles} -> ${after.triangles}, three models ${total} per instance`);
      expect(after.drawCalls - before.drawCalls).toBeLessThanOrEqual(1); // ONE shared mesh for the three types
      expect(after.drawCalls - before.drawCalls).toBeGreaterThanOrEqual(1);
      // the shared mesh submits every model of the group for every instance: three instances = 3 x the group's triangles (plus at most the far icons' quads)
      expect(after.triangles - before.triangles).toBeGreaterThanOrEqual(3 * total);
      expect(after.triangles - before.triangles).toBeLessThanOrEqual(3 * total + 60);
      expect(after.triangles).toBeLessThan(before.triangles + 15000);

      // the second owner: a block of land of its own with a City, an Airfield, a Lab and a Plant
      const far = spread(terrain, cx + 18, cy + 4, 8, 8, [capital, ...mine]);
      expect(far.length).toBeGreaterThanOrEqual(4);
      const mid = far[0] as number;
      await paint(1, mid % WIDTH, (mid - (mid % WIDTH)) / WIDTH, 7);
      const theirs = spread(terrain, mid % WIDTH, (mid - (mid % WIDTH)) / WIDTH, 6, 4, []);
      expect(theirs.length).toBe(4);
      await page.evaluate(() => (window as any).__test.give(1, { gold: 900000 })); // (the first purse was reset when the seat spawned)
      await t.submit({ kind: 'Build', seat: 1, type: STRUCT_CITY, cell: theirs[0] as number });
      await t.advance(0.1, 4);
      await t.submit({ kind: 'Build', seat: 1, type: STRUCT_AIRFIELD, cell: theirs[1] as number });
      await t.submit({ kind: 'Build', seat: 1, type: STRUCT_LAB, cell: theirs[2] as number });
      await t.submit({ kind: 'Build', seat: 1, type: STRUCT_PLANT, cell: theirs[3] as number });
      await t.advance(0.1, 4);
      await t.advance(0.1, 300);
      await t.advance(1, 0);
      await t.settle();
      const both = await t.props();
      expect([both.counts[STRUCT_AIRFIELD], both.counts[STRUCT_LAB], both.counts[STRUCT_PLANT]]).toEqual([2, 2, 2]);

      // the pictures: a panel per structure, a sheet per light and distance
      await page.addStyleTag({ content: '.hud-root, .build-bar, .build-hint, .toast-stack { visibility: hidden !important; }' });
      const panels: Array<{ name: string; cell: number }> = [
        { name: 'factory', cell: capital },
        { name: 'silo', cell: siloCell },
        { name: 'airfield', cell: airCell },
        { name: 'lab', cell: labCell },
        { name: 'plant', cell: plantCell },
        { name: 'airfield2', cell: theirs[1] as number },
        { name: 'lab2', cell: theirs[2] as number },
        { name: 'plant2', cell: theirs[3] as number },
      ];
      const warm = (img: ReturnType<typeof decodePng>): number => {
        let n = 0;
        for (let i = 0; i < img.data.length; i += 4) if ((img.data[i] as number) > 240 && (img.data[i + 1] as number) > 205 && (img.data[i + 1] as number) < 235 && (img.data[i + 2] as number) < 175 && (img.data[i + 2] as number) > 110) n++;
        return n;
      };
      const lamps: Record<string, number> = {};
      const crops: Record<string, ReturnType<typeof decodePng>> = {};
      for (const [label, dKm, agl, pitch, night] of [
        ['3km-day', 3.0, 1200, 24, false],
        ['3km-night', 3.0, 1200, 24, true],
        ['1500m-day', 1.0, 1100, 30, false],
        ['1500m-night', 1.0, 1100, 30, true],
      ] as const) {
        const cw = 400;
        const ch = 340;
        const sheet = { width: cw * 4, height: ch * 2, data: Buffer.alloc(cw * 4 * ch * 2 * 4) };
        let k = 0;
        for (const pn of panels) {
          const at = llOf(pn.cell);
          await closeUp(page, at.lat, at.lon, dKm, agl, pitch, night);
          await t.settle();
          const m = await t.project(at.lat, at.lon);
          const img = decodePng(await page.screenshot({ type: 'png' }));
          const x0 = Math.max(0, Math.min(img.width - cw, Math.round(m.x - cw / 2)));
          const y0 = Math.max(0, Math.min(img.height - ch, Math.round(m.y - ch * 0.7)));
          const crop = { width: cw, height: ch, data: Buffer.alloc(cw * ch * 4) };
          for (let y = 0; y < ch; y++) crop.data.set(img.data.subarray(((y0 + y) * img.width + x0) * 4, ((y0 + y) * img.width + x0 + cw) * 4), y * cw * 4);
          crops[`${label}-${pn.name}`] = crop;
          lamps[`${label}-${pn.name}`] = warm(crop);
          const col = k % 4;
          const row = Math.floor(k / 4);
          for (let y = 0; y < ch; y++) sheet.data.set(crop.data.subarray(y * cw * 4, (y + 1) * cw * 4), ((row * ch + y) * cw * 4 + col * cw) * 4);
          k++;
        }
        const png = encodePng(sheet);
        fs.writeFileSync(path.join(SHOT_DIR, `airlabplant-${label}.png`), png);
        expect(analyzeImage(decodePng(png)).lumaStd).toBeGreaterThan(15);
      }
      // the far icons of the new types (a plus, an octagon and a tall bar; the Factory a square, the Silo a triangle): a globe view over the Alps, one draw call
      for (const km of [900, 2600, 9000]) {
        const mid0 = llOf(airCell);
        await t.view({ lat: mid0.lat, lon: mid0.lon, distKm: km, heading: 0, tilt: 0 });
        await t.settle();
        fs.writeFileSync(path.join(SHOT_DIR, `airlabplant-icons-${km}km.png`), await page.screenshot({ type: 'png' }));
      }
      // the new three read as different pictures (not one model three times): the pairwise mean difference of the 3 km day crops
      const diff = (a: ReturnType<typeof decodePng>, b: ReturnType<typeof decodePng>): number => {
        let s = 0;
        for (let i = 0; i < a.data.length; i += 4) s += Math.abs((a.data[i] as number) - (b.data[i] as number)) + Math.abs((a.data[i + 1] as number) - (b.data[i + 1] as number)) + Math.abs((a.data[i + 2] as number) - (b.data[i + 2] as number));
        return s / (a.data.length / 4);
      };
      const names = ['airfield', 'lab', 'plant', 'factory', 'silo'];
      for (let i = 0; i < names.length; i++) {
        for (let j = i + 1; j < names.length; j++) {
          const d = diff(crops[`3km-day-${names[i]}`] as ReturnType<typeof decodePng>, crops[`3km-day-${names[j]}`] as ReturnType<typeof decodePng>);
          expect(d, `${names[i]} vs ${names[j]}`).toBeGreaterThan(6);
        }
      }
      // the lamps: lit on the night side only, and only on the Lab and the Plant
      console.log(`[airlabplant] warm lamp pixels: ${JSON.stringify(lamps)}`);
      for (const n of ['lab', 'plant', 'lab2']) expect(lamps[`3km-night-${n}`], `${n} at night`).toBeGreaterThan(20);
      for (const n of ['lab', 'plant', 'lab2', 'plant2']) expect(lamps[`3km-day-${n}`], `${n} by day`).toBeLessThan(5);
      expect(lamps['3km-night-airfield']).toBeLessThan(5);
      expect((lamps['3km-night-factory'] ?? 0) + (lamps['3km-night-silo'] ?? 0)).toBeLessThan(5); // the older types have no lamps
      expect(consoleMessages.filter((m) => m.type === 'error' || m.type === 'warning')).toEqual([]);
    } finally {
      await page.close();
    }
  }, 600_000);
});
