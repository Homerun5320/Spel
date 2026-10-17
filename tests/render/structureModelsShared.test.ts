// M18e-2: the Airfield, Lab and Plant have models of their own (this replaces the M18e-1 alias test: no registry entry reuses another type's geometry any more).
// The three live in ONE shared geometry; an instance carries the model kind it shows (aBuild.z) and the vertex shader collapses the other models, so the three
// types cost ONE draw call together. Pure registry checks first, then the layer (meshes, instance data, budget, icons, ghost).
import { Vector3, type BufferAttribute, type InstancedBufferAttribute, type Mesh } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { bindHeightSource } from '../../src/render/detail';
import { STRUCTURE_MODELS, iconShapeOf, kindOf, modelledTypes, sharedGroup } from '../../src/render/structureModels';
import { StructureLayer } from '../../src/render/structures';
import { STRUCT_AIRFIELD, STRUCT_FACTORY, STRUCT_LAB, STRUCT_PLANT, STRUCT_SILO, type StructureView } from '../../src/sim/public';
import { loadChunkWorld } from '../helpers/chunkWorld';

const W = 1024;
const H = 512;
const NEW = [STRUCT_AIRFIELD, STRUCT_LAB, STRUCT_PLANT];

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

const attr = (m: Mesh, name: string): ArrayLike<number> => (m.geometry.getAttribute(name) as BufferAttribute).array;

describe('the registry entries of the new types', () => {
  it('each new type has a model of its own: no alias, scale or colour factor left, 60 to 300 triangles, inside the unit disc, in one shared mesh', () => {
    for (const spec of Object.values(STRUCTURE_MODELS)) {
      expect(spec).not.toHaveProperty('alias');
      expect(spec).not.toHaveProperty('ownerMul');
      expect(spec).not.toHaveProperty('scale');
    }
    const seen = new Set<string>();
    for (const type of NEW) {
      const spec = STRUCTURE_MODELS[type];
      expect(modelledTypes(), `type ${type}`).toContain(type);
      expect(spec?.shared, `type ${type} is in the shared mesh`).toBe(STRUCT_AIRFIELD);
      const model = spec?.build();
      expect(model).toBeDefined();
      if (model === undefined) throw new Error('no model');
      expect(model.triangles).toBeGreaterThan(60);
      expect(model.triangles).toBeLessThanOrEqual(300);
      expect(model.positions.length).toBe(model.triangles * 9);
      expect(model.tints.length).toBe(model.triangles * 3);
      let top = 0;
      let bottom = 0;
      for (let i = 0; i < model.positions.length; i += 3) {
        const x = model.positions[i] as number;
        const y = model.positions[i + 1] as number;
        const z = model.positions[i + 2] as number;
        expect(Number.isFinite(x + y + z)).toBe(true);
        expect(Math.hypot(x, z)).toBeLessThanOrEqual(1.0001);
        top = Math.max(top, y);
        bottom = Math.min(bottom, y);
      }
      expect(bottom).toBeLessThan(0); // a foundation under the ground
      expect(top).toBeGreaterThan(0.8); // a silhouette that stands out
      expect(Array.from(model.tints).filter((t) => t === 1).length).toBeGreaterThan(24); // the owner colour on the disc
      for (const t of model.tints) expect([0, 1, 4]).toContain(t); // owner tint, or the night bulb (light 1), never a spinning part
      seen.add(Array.from(model.positions).join(','));
    }
    expect(seen.size).toBe(3); // three different geometries
    // the Lab and the Plant have night lamps (light 1), the Airfield none
    const lamps = (t: number) => Array.from(STRUCTURE_MODELS[t]?.build().tints ?? []).filter((v) => v === 4).length;
    expect(lamps(STRUCT_LAB)).toBeGreaterThanOrEqual(24);
    expect(lamps(STRUCT_PLANT)).toBeGreaterThanOrEqual(24);
    expect(lamps(STRUCT_AIRFIELD)).toBe(0);
  });

  it('the kind of a type is its position in the shared group; a type with a mesh of its own is kind 0; the icon shape is the type itself', () => {
    expect(sharedGroup(STRUCT_AIRFIELD)).toEqual(NEW);
    expect(NEW.map(kindOf)).toEqual([1, 2, 3]);
    expect(kindOf(STRUCT_FACTORY)).toBe(0);
    expect(sharedGroup(STRUCT_FACTORY)).toEqual([]);
    for (const t of modelledTypes()) expect(iconShapeOf(t)).toBe(t);
  });
});

describe('the layer draws them in one shared mesh', () => {
  it('a match with all nine types has exactly one mesh more than one with six; the instances carry their kind; the vertices carry theirs', () => {
    const six = layerWith([STRUCT_FACTORY, STRUCT_SILO]);
    const nine = layerWith([STRUCT_FACTORY, STRUCT_SILO, STRUCT_AIRFIELD, STRUCT_LAB, STRUCT_PLANT, STRUCT_PLANT]);
    expect(nine.meshes.length).toBe(six.meshes.length);
    // one mesh per mesh owner (six own meshes + the shared one), plus the ring, the far icons and the ghost
    const owners = modelledTypes().filter((ty) => STRUCTURE_MODELS[ty]?.shared === undefined || STRUCTURE_MODELS[ty]?.shared === ty);
    expect(owners.length).toBe(7);
    expect(nine.meshes.length).toBe(owners.length + 3);
    expect(nine.instances().map((d) => d.type)).toEqual([STRUCT_FACTORY, STRUCT_SILO, STRUCT_AIRFIELD, STRUCT_LAB, STRUCT_PLANT, STRUCT_PLANT]);
    const counts = nine.counts();
    expect(counts[STRUCT_FACTORY]).toBe(1);
    expect(counts[STRUCT_AIRFIELD]).toBe(1);
    expect(counts[STRUCT_LAB]).toBe(1);
    expect(counts[STRUCT_PLANT]).toBe(2);
    // the shared mesh: the mesh whose vertex buffer holds the three models
    const total = NEW.reduce((n, t) => n + (STRUCTURE_MODELS[t]?.build().triangles ?? 0), 0);
    const shared = nine.meshes.find((m) => attr(m, 'position').length === total * 9) as Mesh;
    expect(shared).toBeDefined();
    const kinds = attr(shared, 'aModel');
    for (const [i, t] of NEW.entries()) expect(Array.from(kinds).filter((k) => k === i + 1).length).toBe((STRUCTURE_MODELS[t]?.build().triangles ?? 0) * 3);
    expect(Array.from(kinds).filter((k) => k === 0).length).toBe(0);
    // the instance data: Airfield, Lab, Plant, Plant -> kinds 1, 2, 3, 3 in aBuild.z
    const build = (shared.geometry.getAttribute('aBuild') as InstancedBufferAttribute).array;
    expect([0, 1, 2, 3].map((i) => build[i * 3 + 2])).toEqual([1, 2, 3, 3]);
    // the other meshes hold one model each: kind 0 everywhere
    const factory = nine.meshes[1] as Mesh;
    expect(Array.from(attr(factory, 'aModel')).every((k) => k === 0)).toBe(true);
  });

  it('the budget counts the shared mesh by what it submits (the whole group per instance), trianglesOf is the type`s own model', () => {
    const nine = layerWith([STRUCT_FACTORY, STRUCT_AIRFIELD, STRUCT_LAB, STRUCT_PLANT]);
    const total = NEW.reduce((n, t) => n + (STRUCTURE_MODELS[t]?.build().triangles ?? 0), 0);
    for (const t of NEW) {
      expect(nine.trianglesOf(t)).toBe(STRUCTURE_MODELS[t]?.build().triangles);
      expect(nine.trianglesCost(t)).toBe(total);
    }
    expect(nine.trianglesOf(STRUCT_AIRFIELD)).not.toBe(nine.trianglesOf(STRUCT_FACTORY));
    expect(nine.trianglesDrawn).toBe(nine.trianglesCost(STRUCT_FACTORY) + 3 * total);
  });

  it('the far icon of each new type has its own shape index, and the ring of each has its own size', () => {
    const nine = layerWith([STRUCT_FACTORY, STRUCT_AIRFIELD, STRUCT_LAB, STRUCT_PLANT]);
    const icons = nine.meshes.find((m) => m.geometry.getAttribute('aInfo') !== undefined) as Mesh;
    const info = (icons.geometry.getAttribute('aInfo') as InstancedBufferAttribute).array;
    expect([0, 1, 2, 3].map((i) => info[i * 4])).toEqual([STRUCT_FACTORY, STRUCT_AIRFIELD, STRUCT_LAB, STRUCT_PLANT]);
    expect([1, 2, 3].map((i) => info[i * 4 + 1])).toEqual(NEW.map((t) => STRUCTURE_MODELS[t]?.radiusM));
    expect(new Set(NEW.map((t) => STRUCTURE_MODELS[t]?.radiusM)).size).toBe(3);
  });

  it('the ghost of a new type wears its kind, an unmodelled type is refused', () => {
    const layer = layerWith([STRUCT_FACTORY]);
    const ghost = layer.meshes[layer.meshes.length - 1] as Mesh;
    for (const t of NEW) {
      layer.setGhost(t, 200 * W + 300, true);
      expect(layer.ghostCell).toBe(200 * W + 300);
      expect((ghost.geometry.getAttribute('aBuild') as InstancedBufferAttribute).array[2]).toBe(kindOf(t));
      expect(attr(ghost, 'aModel').length).toBe(attr(ghost, 'position').length / 3);
    }
    layer.setGhost(STRUCT_FACTORY, 200 * W + 300, true);
    expect((ghost.geometry.getAttribute('aBuild') as InstancedBufferAttribute).array[2]).toBe(0);
    layer.clearGhost();
    layer.setGhost(99, 100 * W + 300, true);
    expect(layer.ghostCell).toBe(-1);
  });
});
