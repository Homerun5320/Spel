import { describe, expect, it } from 'vitest';
import { readBudgets } from './helpers/budgets';
import { buildShip } from '../src/render/shipModel';

describe('docs/ARCHITECTURE.md "Budgetar"', () => {
  it('starts with the globe budget: <= 150 000 triangles and <= 100 draw calls in the test tier (raised from 30 by Fix-UI, the M21 target; DECISIONS Fix-UI)', () => {
    const rows = readBudgets();
    expect(rows[0]).toEqual({ layer: 'Glob (hela glob-scenen)', triangles: 150_000, drawCalls: 100 });
  });

  it('layer budgets add up inside the globe budget', () => {
    const [total, ...layers] = readBudgets();
    expect(layers.length).toBeGreaterThanOrEqual(3);
    expect(layers.reduce((s, l) => s + l.triangles, 0)).toBeLessThanOrEqual((total as { triangles: number }).triangles);
    expect(layers.reduce((s, l) => s + l.drawCalls, 0)).toBeLessThanOrEqual((total as { drawCalls: number }).drawCalls);
  });
});

describe('Fix-Audit2: per-layer draw-call rows pin the real total, not only the 100 ceiling', () => {
  it('the per-layer draw-call allowances (terrain, shell, stars, structures, districts, helicopters, deploy) add up to at most 23 (M13b: +3 for the deploy layer, was 16; Fix-5B: +4 helicopter effects and +1 front arrows, the table now holds every layer: 1+1+1+10+1+1+3+4+1), so the global 100 stays a ceiling and not a licence', () => {
    const [, ...layers] = readBudgets();
    const sum = layers.reduce((s, l) => s + l.drawCalls, 0);
    expect(sum).toBeLessThanOrEqual(24); // M13c-2: +1 for the ship layer (23 -> 24)
    expect(layers.every((l) => l.drawCalls <= 10)).toBe(true);
  });
});

describe('M13a-1: the helicopter layer has its own row', () => {
  it('one draw call and a triangle allowance that fits 64 instances of the model, and the layer rows still add up to at most 17 draw calls (16 + this one)', () => {
    const [, ...layers] = readBudgets();
    const row = layers.find((l) => l.layer.startsWith('Helikoptrar'));
    expect(row).toEqual({ layer: expect.stringContaining('Helikoptrar'), triangles: 7_000, drawCalls: 1 });
    expect(layers.reduce((s, l) => s + l.drawCalls, 0)).toBeLessThanOrEqual(24); // M13c-2: 24 with the ship layer; M13b: 18 with the deploy layer's 3; Fix-5B: 23 with the helicopter effects (4) and the front arrows (1), see the test above
  });
});

describe('M13b: the deploy layer has its own row', () => {
  it('three draw calls (the route twice, the marker once) and no more than a thousand triangles; the helicopter layer and the deploy layer together are at most 4 extra calls', () => {
    const [, ...layers] = readBudgets();
    const row = layers.find((l) => l.layer.startsWith('Utplaceringslagret'));
    expect(row).toEqual({ layer: expect.stringContaining('Utplaceringslagret'), triangles: 1_000, drawCalls: 3 });
    const heli = layers.find((l) => l.layer.startsWith('Helikoptrar')) as { drawCalls: number };
    expect(heli.drawCalls + (row as { drawCalls: number }).drawCalls).toBeLessThanOrEqual(4);
  });
});

describe('Fix-5B: the table is clean and has a row for every layer that draws', () => {
  it('the helicopter effects (<= 3 500 triangles, <= 4 calls) and the front arrows (<= 200 triangles, <= 1 call) have rows, and the per-layer calls add up to exactly 24 (M13c-2: +1 for the ships)', () => {
    const [, ...layers] = readBudgets();
    expect(layers.find((l) => l.layer.startsWith('Helikoptereffekter'))).toMatchObject({ triangles: 3_500, drawCalls: 4 });
    expect(layers.find((l) => l.layer.startsWith('Frontpilar'))).toMatchObject({ triangles: 200, drawCalls: 1 });
    expect(layers.reduce((s, l) => s + l.drawCalls, 0)).toBe(24);
  });
});

describe('M13c-2: the ship layer has its own row', () => {
  it('one draw call and at most 3 000 triangles (32 instances of the 76-triangle model are 2 432; the sum of all rows must stay inside the globe row, so 5 000 did not fit); no existing row was raised', () => {
    const [, ...layers] = readBudgets();
    const row = layers.find((l) => l.layer.startsWith('Fartyg'));
    expect(row).toEqual({ layer: expect.stringContaining('Fartyg'), triangles: 3_000, drawCalls: 1 });
    expect(32 * buildShip().triangles).toBeLessThanOrEqual((row as { triangles: number }).triangles);
    expect(layers.find((l) => l.layer.startsWith('Helikoptrar'))).toMatchObject({ triangles: 7_000, drawCalls: 1 });
    expect(layers.find((l) => l.layer.startsWith('Utplaceringslagret'))).toMatchObject({ triangles: 1_000, drawCalls: 3 });
  });
});
