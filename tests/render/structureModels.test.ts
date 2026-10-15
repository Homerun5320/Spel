// M10: the structure model registry and the City model. Pure geometry (no three): the budget of triangles, the shape of the buffers and the registry that the
// other types plug into.
import { describe, expect, it } from 'vitest';
import { STRUCT_CITY } from '../../src/sim/public';
import { STRUCT_LEVEL_SCALE, STRUCT_TRIANGLE_BUDGET } from '../../src/render/config';
import { STRUCTURE_MODELS, modelledTypes } from '../../src/render/structureModels';

describe('the structure models', () => {
  it('registers the City first (later slices add types after it) with level scales 1.0, 1.25 and 1.5', () => {
    expect(modelledTypes()[0]).toBe(STRUCT_CITY);
    expect(STRUCT_LEVEL_SCALE).toEqual([0, 1.0, 1.25, 1.5]);
  });

  it('the City is at most 300 triangles, well formed, inside the unit disc, and uses the owner tint on its base and spire', () => {
    const model = STRUCTURE_MODELS[STRUCT_CITY]?.build();
    expect(model).toBeDefined();
    if (model === undefined) return;
    expect(model.triangles).toBeGreaterThan(100);
    expect(model.triangles).toBeLessThanOrEqual(300);
    expect(model.positions.length).toBe(model.triangles * 9);
    expect(model.colors.length).toBe(model.triangles * 9);
    expect(model.tints.length).toBe(model.triangles * 3);
    let maxR = 0;
    let top = 0;
    let bottom = 0;
    for (let i = 0; i < model.positions.length; i += 3) {
      const x = model.positions[i] as number;
      const y = model.positions[i + 1] as number;
      const z = model.positions[i + 2] as number;
      expect(Number.isFinite(x + y + z)).toBe(true);
      maxR = Math.max(maxR, Math.hypot(x, z));
      top = Math.max(top, y);
      bottom = Math.min(bottom, y);
    }
    expect(maxR).toBeLessThanOrEqual(1.0001);
    expect(top).toBeGreaterThan(0.9); // the spire: the silhouette from far away
    expect(bottom).toBeLessThan(0); // the foundation reaches under the ground
    const tinted = Array.from(model.tints).filter((t) => t === 1).length;
    expect(tinted).toBeGreaterThan(20);
    for (const t of model.tints) expect(t === 0 || t === 1).toBe(true);
  });

  it('the triangle allowance of the test tier holds at least 60 Cities and stays inside the 15 000 of the Budgetar row', () => {
    const tris = STRUCTURE_MODELS[STRUCT_CITY]?.build().triangles ?? 0;
    expect(STRUCT_TRIANGLE_BUDGET.test).toBeLessThanOrEqual(15000);
    expect(Math.floor(STRUCT_TRIANGLE_BUDGET.test / tris)).toBeGreaterThanOrEqual(60);
  });
});
