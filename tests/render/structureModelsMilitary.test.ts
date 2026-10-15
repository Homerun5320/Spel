// M10-3: the Silo, SAM site and Defense Post models. Pure geometry (no three): triangle budget, bounds, the owner colour on the base, the turning dish.
import { describe, expect, it } from 'vitest';
import { STRUCT_POST, STRUCT_SAM, STRUCT_SILO } from '../../src/sim/public';
import { STRUCT_TRIANGLE_BUDGET } from '../../src/render/config';
import { STRUCTURE_MODELS, modelledTypes } from '../../src/render/structureModels';

const TYPES = [STRUCT_SILO, STRUCT_SAM, STRUCT_POST];

function stats(type: number) {
  const model = STRUCTURE_MODELS[type]?.build();
  expect(model).toBeDefined();
  if (model === undefined) throw new Error('no model');
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
  return { model, maxR, top, bottom };
}

describe('the military structure models (M10-3)', () => {
  it('are registered next to the City', () => {
    for (const t of TYPES) expect(modelledTypes()).toContain(t);
  });

  for (const type of TYPES) {
    const name = STRUCTURE_MODELS[type]?.name ?? String(type);
    it(`${name}: at most 250 triangles, well formed, inside the unit disc, a foundation under the ground, an owner-coloured base`, () => {
      const { model, maxR, top, bottom } = stats(type);
      expect(model.triangles).toBeGreaterThan(60);
      expect(model.triangles).toBeLessThanOrEqual(250);
      expect(model.positions.length).toBe(model.triangles * 9);
      expect(model.colors.length).toBe(model.triangles * 9);
      expect(model.tints.length).toBe(model.triangles * 3);
      expect(maxR).toBeLessThanOrEqual(1.0001);
      expect(top).toBeGreaterThan(0.7);
      expect(bottom).toBeLessThan(0);
      // the owner colour sits on the base disc (tint 1 at the plate height)
      let ownerBase = 0;
      for (let v = 0; v < model.tints.length; v++) {
        const tint = (model.tints[v] as number) % 2;
        if (tint === 1 && Math.abs((model.positions[v * 3 + 1] as number) - 0.055) < 1e-4) ownerBase++;
      }
      expect(ownerBase).toBeGreaterThanOrEqual(24);
      for (const tnt of model.tints) expect([0, 1, 2, 3]).toContain(tnt);
      expect(Math.floor(STRUCT_TRIANGLE_BUDGET.test / model.triangles)).toBeGreaterThanOrEqual(60);
    });
  }

  it('only the SAM site has a turning part (tint >= 2), and it reaches off the axis so that the sweep shows', () => {
    for (const type of TYPES) {
      const { model } = stats(type);
      let spin = 0;
      let reach = 0;
      for (let v = 0; v < model.tints.length; v++) {
        if ((model.tints[v] as number) >= 2) {
          spin++;
          reach = Math.max(reach, Math.hypot(model.positions[v * 3] as number, model.positions[v * 3 + 2] as number));
        }
      }
      if (type === STRUCT_SAM) {
        expect(spin).toBeGreaterThan(30);
        expect(reach).toBeGreaterThan(0.3);
      } else expect(spin).toBe(0);
    }
  });

  it('the silhouettes differ in height: the Post is the tallest, the Silo the lowest', () => {
    const silo = stats(STRUCT_SILO);
    const sam = stats(STRUCT_SAM);
    const post = stats(STRUCT_POST);
    expect(post.top).toBeGreaterThan(sam.top);
    expect(sam.top).toBeGreaterThan(silo.top);
  });
});
