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
