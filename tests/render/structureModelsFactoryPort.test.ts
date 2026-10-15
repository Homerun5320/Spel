// M10-2: the Factory and Port models. Pure geometry: triangle budget, bounds, silhouette, owner tint, and the Port's pier on model +x.
import { describe, expect, it } from 'vitest';
import { STRUCT_FACTORY, STRUCT_PORT } from '../../src/sim/public';
import { STRUCT_TRIANGLE_BUDGET } from '../../src/render/config';
import { STRUCTURE_MODELS, modelledTypes } from '../../src/render/structureModels';

function stats(type: number) {
  const model = STRUCTURE_MODELS[type]?.build();
  if (model === undefined) throw new Error(`no model for ${type}`);
  let maxR = 0;
  let top = 0;
  let bottom = 0;
  let maxX = -9;
  for (let i = 0; i < model.positions.length; i += 3) {
    const x = model.positions[i] as number;
    const y = model.positions[i + 1] as number;
    const z = model.positions[i + 2] as number;
    expect(Number.isFinite(x + y + z)).toBe(true);
    maxR = Math.max(maxR, Math.hypot(x, z));
    top = Math.max(top, y);
    bottom = Math.min(bottom, y);
    maxX = Math.max(maxX, x);
  }
  return { model, maxR, top, bottom, maxX };
}

describe('the Factory and Port models', () => {
  it('are registered after the City and drawn', () => {
    const types = modelledTypes();
    expect(types).toContain(STRUCT_FACTORY);
    expect(types).toContain(STRUCT_PORT);
  });

  for (const [name, type, minTop] of [['Factory', STRUCT_FACTORY, 0.9], ['Port', STRUCT_PORT, 0.55]] as const) {
    it(`the ${name} is at most 250 triangles, well formed, inside the unit disc, stands on its base and carries the owner tint`, () => {
      const { model, maxR, top, bottom } = stats(type);
      expect(model.triangles).toBeGreaterThan(60);
      expect(model.triangles).toBeLessThanOrEqual(250);
      expect(model.positions.length).toBe(model.triangles * 9);
      expect(model.colors.length).toBe(model.triangles * 9);
      expect(model.tints.length).toBe(model.triangles * 3);
      expect(maxR).toBeLessThanOrEqual(1.0001);
      expect(top).toBeGreaterThan(minTop); // the chimney / the crane: the silhouette
      expect(bottom).toBeLessThan(0); // the foundation reaches under the ground
      expect(Array.from(model.tints).filter((t) => t === 1).length).toBeGreaterThan(20); // the owner-coloured base
      for (const t of model.tints) expect(t === 0 || t === 1).toBe(true);
      for (const c of model.colors) expect(c >= 0 && c <= 1).toBe(true);
      expect(Math.floor(STRUCT_TRIANGLE_BUDGET.test / model.triangles)).toBeGreaterThanOrEqual(60);
    });
  }

  it('only the Port has a front: the pier reaches out on model +x and the layer turns it to the sea', () => {
    expect(STRUCTURE_MODELS[STRUCT_PORT]?.seaward).toBe(true);
    expect(STRUCTURE_MODELS[STRUCT_FACTORY]?.seaward).toBeUndefined();
    expect(stats(STRUCT_PORT).maxX).toBeGreaterThan(0.9);
  });
});
