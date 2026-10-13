import { describe, expect, it } from 'vitest';
import { readBudgets } from './helpers/budgets';

describe('docs/ARCHITECTURE.md "Budgetar"', () => {
  it('starts with the globe budget: <= 150 000 triangles and <= 30 draw calls in the test tier', () => {
    const rows = readBudgets();
    expect(rows[0]).toEqual({ layer: 'Glob (hela glob-scenen)', triangles: 150_000, drawCalls: 30 });
  });

  it('layer budgets add up inside the globe budget', () => {
    const [total, ...layers] = readBudgets();
    expect(layers.length).toBeGreaterThanOrEqual(3);
    expect(layers.reduce((s, l) => s + l.triangles, 0)).toBeLessThanOrEqual((total as { triangles: number }).triangles);
    expect(layers.reduce((s, l) => s + l.drawCalls, 0)).toBeLessThanOrEqual((total as { drawCalls: number }).drawCalls);
  });
});
