// Fix-6A2 [1.12]: the triangle count and the scale (radiusM) of the Airfield, Lab and Plant models are pinned EXACTLY, so that a missing runway dash, a half-open cooling tower or a changed
// size fails here (the budget tests only cap them). A deliberate model change updates this table in the same commit.
import { describe, expect, it } from 'vitest';
import { STRUCTURE_MODELS } from '../../src/render/structureModels';
import { STRUCT_AIRFIELD, STRUCT_LAB, STRUCT_PLANT } from '../../src/sim/public';

const PINNED: ReadonlyArray<readonly [string, number, number, number]> = [
  ['airfield', STRUCT_AIRFIELD, 780, 154],
  ['lab', STRUCT_LAB, 560, 208],
  ['plant', STRUCT_PLANT, 640, 228],
];

describe('the shared-mesh models are pinned in triangles and scale', () => {
  for (const [name, type, radiusM, triangles] of PINNED) {
    it(`${name}: radiusM ${radiusM}, ${triangles} triangles`, () => {
      const spec = STRUCTURE_MODELS[type];
      expect(spec?.name).toBe(name);
      expect(spec?.radiusM).toBe(radiusM);
      expect(spec?.build().triangles).toBe(triangles);
    });
  }
});
