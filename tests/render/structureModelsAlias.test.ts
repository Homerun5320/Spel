// M18e-1: the provisional models of the Airfield, Lab and Plant are registry entries that reuse the geometry of an existing type (instance size and colour only):
// the layer makes no mesh of its own for them, so a match with all nine types draws with the same number of meshes (draw calls) as one with six.
import { Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { bindHeightSource } from '../../src/render/detail';
import { STRUCTURE_MODELS, modelledTypes } from '../../src/render/structureModels';
import { StructureLayer } from '../../src/render/structures';
import { STRUCT_AIRFIELD, STRUCT_FACTORY, STRUCT_LAB, STRUCT_PLANT, STRUCT_SILO, type StructureView } from '../../src/sim/public';
import { loadChunkWorld } from '../helpers/chunkWorld';

const W = 1024;
const H = 512;

beforeAll(async () => {
  const world = await loadChunkWorld();
  bindHeightSource(world.detailField.sampler as NonNullable<typeof world.detailField.sampler>);
});

function table(types: number[]): StructureView {
  const cells = types.map((_, i) => (200 + i * 7) * W + 300);
  return {
    capacity: 4096,
    highWater: types.length,
    liveCount: types.length,
    type: types,
    owner: types.map(() => 1),
    cell: cells,
    level: types.map(() => 1),
    buildTick: types.map(() => 0),
    readyTick: types.map(() => 0),
    upgradeReadyTick: types.map(() => 0),
    idAt: (c: number) => cells.indexOf(c),
    ownedCount: () => 0,
    deleteReadyTick: () => 0,
  };
}

function layerWith(types: number[]): StructureLayer {
  const layer = new StructureLayer({ tier: 'test', gridWidth: W, gridHeight: H, sun: new Vector3(1, 0, 0) });
  layer.setOwnerPalette(new Uint8Array(16).fill(200));
  layer.setTable(table(types), 1);
  layer.frame([0, 0, 3], 1, 0, 540);
  return layer;
}

describe('the registry entries of the new types', () => {
  it('each new type is modelled, aliases a type that has a mesh of its own, and differs from it in size or colour', () => {
    for (const type of [STRUCT_AIRFIELD, STRUCT_LAB, STRUCT_PLANT]) {
      const spec = STRUCTURE_MODELS[type];
      expect(modelledTypes(), `type ${type}`).toContain(type);
      expect(spec?.alias, `type ${type} has an alias`).toBeDefined();
      const target = STRUCTURE_MODELS[spec?.alias as number];
      expect(target, `alias of ${type}`).toBeDefined();
      expect(target?.alias, 'an alias points at a real model, not at another alias').toBeUndefined();
      expect(spec?.scale === undefined || spec.scale === 1).toBe(false); // another size ...
      expect(spec?.ownerMul?.some((c) => c < 1)).toBe(true); // ... and another colour
      for (const c of spec?.ownerMul ?? []) expect(c > 0 && c <= 1).toBe(true);
      expect(spec?.radiusM).toBe(Math.round((target?.radiusM as number) * (spec?.scale as number)));
    }
  });
});

describe('the layer draws them without a mesh of their own', () => {
  it('a match with all nine types has as many meshes as one with six, the instances land in the layer of the alias with their own size and colour', () => {
    const six = layerWith([STRUCT_FACTORY, STRUCT_SILO]);
    const nine = layerWith([STRUCT_FACTORY, STRUCT_SILO, STRUCT_AIRFIELD, STRUCT_LAB, STRUCT_PLANT]);
    expect(nine.meshes.length).toBe(six.meshes.length);
    expect(nine.instances().map((d) => d.type)).toEqual([STRUCT_FACTORY, STRUCT_SILO, STRUCT_AIRFIELD, STRUCT_LAB, STRUCT_PLANT]);
    const counts = nine.counts();
    expect(counts[STRUCT_FACTORY]).toBe(3); // the Factory, the Airfield and the Plant share one instanced mesh
    expect(counts[STRUCT_SILO]).toBe(2); // the Silo and the Lab
    expect(nine.trianglesOf(STRUCT_AIRFIELD)).toBe(nine.trianglesOf(STRUCT_FACTORY));
    expect(nine.trianglesOf(STRUCT_LAB)).toBe(nine.trianglesOf(STRUCT_SILO));
    // the triangle budget counts the aliased instances with the triangles of the model they reuse
    expect(nine.trianglesDrawn).toBe(3 * nine.trianglesOf(STRUCT_FACTORY) + 2 * nine.trianglesOf(STRUCT_SILO));
  });

  it('the ghost of a new type is allowed (the placement mode can show it) and an unmodelled type is not', () => {
    const layer = layerWith([STRUCT_FACTORY]);
    layer.setGhost(STRUCT_PLANT, 200 * W + 300, true);
    expect(layer.ghostCell).toBe(200 * W + 300);
    layer.clearGhost();
    layer.setGhost(99, 100 * W + 300, true);
    expect(layer.ghostCell).toBe(-1);
  });
});
