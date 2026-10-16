import { describe, expect, it } from 'vitest';
import { readBudgets } from './helpers/budgets';

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
  it('the per-layer draw-call allowances (terrain, shell, stars, structures, districts) add up to at most 16, so the global 100 stays a ceiling and not a licence', () => {
    const [, ...layers] = readBudgets();
    const sum = layers.reduce((s, l) => s + l.drawCalls, 0);
    expect(sum).toBeLessThanOrEqual(16);
    expect(layers.every((l) => l.drawCalls <= 10)).toBe(true);
  });
});

describe('M13a-1: the helicopter layer has its own row', () => {
  it('one draw call and a triangle allowance that fits 64 instances of the model, and the layer rows still add up to at most 17 draw calls (16 + this one)', () => {
    const [, ...layers] = readBudgets();
    const row = layers.find((l) => l.layer.startsWith('Helikoptrar'));
    expect(row).toEqual({ layer: expect.stringContaining('Helikoptrar'), triangles: 7_000, drawCalls: 1 });
    expect(layers.reduce((s, l) => s + l.drawCalls, 0)).toBeLessThanOrEqual(17);
  });
});
