// Shared by the M13a-2 e2e files: the test hooks of a page, a nation with a Factory, one helicopter and a landing zone, and a picture helper.
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright-core';
import { expect } from 'vitest';
import { OUT_DIR } from '../../scripts/shot.mjs';
import { cellToLatLon } from '../../src/render/transforms';
import { BUILD_TICKS, HELI_BUILD_TICKS } from '../../src/sim/rules';
import { STRUCT_FACTORY } from '../../src/sim/structureRules';
import { HELI_PAD } from '../../src/sim/heliTable';

export const SHOT_DIR = process.env.FX_SHOTS ?? path.join(OUT_DIR, 'shots');
export const WIDTH = 1024;
export const HEIGHT = 512;

export interface Drawn {
  id: number;
  owner: number;
  state: number;
  cellX: number;
  cellY: number;
  lat: number;
  lon: number;
  aglM: number;
  radius: number;
  parked: boolean;
}
export interface Fx {
  enabled: boolean;
  particles: number;
  shadows: number;
  icons: number;
  flags: number;
  visibleMeshes: number;
}
export const T = (page: Page) => ({
  props: (): Promise<{ toasts: string[]; selection: { id: number; panelVisible: boolean } }> => page.evaluate(() => (window as any).__test.props()),
  state: (): Promise<{ local: { spawned: boolean } }> => page.evaluate(() => (window as any).__test.state()),
  advance: (dt: number, ticks: number): Promise<void> => page.evaluate(([d, n]) => (window as any).__test.advance(d, n), [dt, ticks] as const),
  settle: (dt = 0, n = 1): Promise<void> => page.evaluate(([d, k]) => (window as any).__test.settle(d, k), [dt, n] as const),
  view: (v: Record<string, number>): Promise<void> => page.evaluate((x) => (window as any).__test.setView(x), v),
  ground: (v: Record<string, number>): Promise<void> => page.evaluate((x) => (window as any).__test.setGroundView(x), v),
  info: (): Promise<{ drawCalls: number; triangles: number }> => page.evaluate(() => (window as any).__test.info()),
  helis: (): Promise<Drawn[]> => page.evaluate(() => (window as any).__test.helis()),
  fx: (): Promise<Fx> => page.evaluate(() => (window as any).__test.fx()),
  chase: (): Promise<{ active: boolean; heli: number; camAglM: number }> => page.evaluate(() => (window as any).__test.chase()),
  project: (lat: number, lon: number): Promise<{ x: number; y: number; inView: boolean; facing: boolean }> => page.evaluate(([a, o]) => (window as any).__test.project(a, o), [lat, lon] as const),
  capital: async (): Promise<number> => ((await page.evaluate(() => (window as any).__test.seatCells())) as { capitals: number[] }).capitals[0] as number,
  beach: (): Promise<{ rows: Array<{ slot: number; seed: number; landTick: number }> }> => page.evaluate(() => (window as any).__test.beach()),
  hash: (): Promise<number> => page.evaluate(() => (window as any).__test.hash()),
  submit: (body: Record<string, unknown>): Promise<void> => page.evaluate((b) => (window as any).__test.submit(b), body),
});

/** Pictures of the world: a camera `dKm` south of a place, `aglM` above the ground, looking north with its axis `pitch` degrees below the horizon. */
export async function look(page: Page, name: string, lat: number, lon: number, dKm: number, aglM: number, pitch = 24): Promise<void> {
  const t = T(page);
  await t.ground({ lat: lat - dKm / 111.2, lon, heading: 0, pitchDeg: pitch, aglM });
  await t.settle(0.02, 3);
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  fs.writeFileSync(path.join(SHOT_DIR, `fx-${name}.png`), await page.screenshot({ timeout: 90_000 }));
}

/** A nation with a Factory and one helicopter on its pad, and a landing zone found by the page's own preview. */
export async function prepare(page: Page): Promise<{ capital: number; factory: number; lz: number; at: { lat: number; lon: number } }> {
  const t = T(page);
  await t.view({ lat: 48.5, lon: 11, distKm: 2600, heading: 0, tilt: 0 });
  const p0 = await t.project(48.5, 11);
  await page.mouse.click(p0.x, p0.y);
  await t.advance(0.1, 5);
  await page.evaluate(() => (window as any).__test.give(0, { gold: 90000, troops: 5000 }));
  await t.advance(0.1, 4);
  expect((await t.state()).local.spawned).toBe(true);
  await t.advance(0.1, 210);
  const capital = await t.capital();
  const at = cellToLatLon(capital, WIDTH, HEIGHT);
  await t.submit({ kind: 'Build', seat: 0, type: STRUCT_FACTORY, cell: capital });
  await t.advance(0.1, (BUILD_TICKS[STRUCT_FACTORY] as number) + 8);
  const pf = await t.project(at.lat, at.lon);
  await page.mouse.click(pf.x, pf.y);
  await t.settle();
  const factory = (await t.props()).selection.id;
  expect(factory).toBeGreaterThanOrEqual(0);
  await page.locator('[data-testid="sel-heli"]').click();
  await t.advance(0.1, HELI_BUILD_TICKS + 4);
  await t.settle();
  expect((await t.helis())[0]?.state).toBe(HELI_PAD);
  const cells = await page.evaluate(
    ([cap, w, fac]) => {
      const out: Array<{ cell: number; reason: number; waypoints: number }> = [];
      const cx = cap % w;
      const cy = (cap - cx) / w;
      for (let dy = -40; dy <= 40; dy += 4) {
        for (let dx = -40; dx <= 40; dx += 4) {
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || x >= w || y < 0 || y >= 512 || Math.hypot(dx, dy) < 14) continue;
          const r = (window as any).__test.previewNow(fac, y * w + x, 300, 0);
          if (r !== null) out.push({ cell: y * w + x, reason: r.reason, waypoints: r.waypoints });
        }
      }
      return out;
    },
    [capital, WIDTH, factory] as const,
  );
  const dist = (a: number, b: number): number => Math.hypot((a % WIDTH) - (b % WIDTH), Math.floor(a / WIDTH) - Math.floor(b / WIDTH));
  const valid = cells.filter((c) => c.reason === 0 && c.waypoints >= 2).sort((a, b) => Math.abs(dist(a.cell, capital) - 22) - Math.abs(dist(b.cell, capital) - 22));
  expect(valid.length, 'a valid landing zone').toBeGreaterThan(0);
  return { capital, factory, lz: (valid[0] as { cell: number }).cell, at };
}


/** The console messages of the page without the SwiftShader driver's own performance notes ("GL Driver Message ... Running out of reserved outsideRenderPass queueSerial"), which a long run of draws prints. */
export function quiet(messages: ReadonlyArray<{ text: string; type: string }>): Array<{ text: string; type: string }> {
  return messages.filter((m) => !/GL Driver Message/.test(m.text));
}
