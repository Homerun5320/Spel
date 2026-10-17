// Fix-UI: the structure layer's triangle budget is ONE allowance for the whole layer (all types together, the City's night lights included), cut
// deterministically by id, and 191 structures in the test tier stay inside the documented "Strukturer" row of docs/ARCHITECTURE.md (Budgetar).
import { Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { STRUCT_TRIANGLE_BUDGET } from '../../src/render/config';
import { bindHeightSource } from '../../src/render/detail';
import { StructureLayer } from '../../src/render/structures';
import {
  STRUCT_CITY,
  STRUCT_FACTORY,
  STRUCT_PORT,
  STRUCT_POST,
  STRUCT_SAM,
  STRUCT_SILO,
  type StructureView,
} from '../../src/sim/public';
import { readBudgets } from '../helpers/budgets';
import { loadChunkWorld } from '../helpers/chunkWorld';

const W = 1024;
const H = 512;
const TYPES = [STRUCT_CITY, STRUCT_FACTORY, STRUCT_PORT, STRUCT_SILO, STRUCT_SAM, STRUCT_POST];

beforeAll(async () => {
  const world = await loadChunkWorld();
  bindHeightSource(world.detailField.sampler as NonNullable<typeof world.detailField.sampler>);
});

/** `n` structures cycling through the six types, spread over land-ish cells, all owner 1. */
function table(n: number): StructureView {
  const cells = Array.from({ length: n }, (_, i) => (200 + (i % 40) * 7) * W + 300 + Math.floor(i / 40) * 11);
  const byCell = new Map(cells.map((c, id) => [c, id] as const));
  return {
    capacity: 4096,
    highWater: n,
    liveCount: n,
    type: cells.map((_, i) => TYPES[i % 6] as number),
    owner: cells.map(() => 1),
    cell: cells,
    level: cells.map(() => 1),
    buildTick: cells.map(() => 0),
    readyTick: cells.map(() => 0),
    upgradeReadyTick: cells.map(() => 0),
    idAt: (c: number) => byCell.get(c) ?? -1,
    ownedCount: () => 0,
    deleteReadyTick: () => 0,
  };
}

function layerWith(n: number, tier: 'test' | 'low' = 'test'): StructureLayer {
  const layer = new StructureLayer({ tier, gridWidth: W, gridHeight: H, sun: new Vector3(1, 0, 0) });
  layer.setOwnerPalette(new Uint8Array(16).fill(200));
  layer.setTable(table(n), 1);
  layer.frame([0, 0, 3], 1, 0, 540);
  return layer;
}

describe('the structure layer budget is per layer', () => {
  it('191 mixed structures in the test tier draw at most the documented row, and the cut is by id', () => {
    const row = readBudgets().find((r) => r.layer.startsWith('Strukturer'));
    expect(row?.triangles).toBe(STRUCT_TRIANGLE_BUDGET.test);
    const layer = layerWith(191);
    expect(layer.trianglesDrawn).toBeLessThanOrEqual(row?.triangles ?? 0);
    expect(layer.trianglesDrawn).toBeGreaterThan(14000); // the allowance is used, not left half empty
    const drawn = layer.instances();
    expect(drawn.length + layer.dropped).toBe(191);
    expect(layer.dropped).toBeGreaterThan(0);
    // the survivors are exactly the lowest ids: no id above a dropped one is drawn
    const ids = drawn.map((d) => d.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(ids[ids.length - 1]).toBeLessThan(191);
    const again = layerWith(191);
    expect(again.instances().map((d) => d.id)).toEqual(ids); // deterministic
  });

  it('a set under the allowance drops nothing, and the low tier (a larger allowance) keeps what the test tier dropped', () => {
    const few = layerWith(30);
    expect(few.dropped).toBe(0);
    expect(few.instances().length).toBe(30);
    const test = layerWith(191, 'test');
    const low = layerWith(191, 'low');
    expect(low.trianglesDrawn).toBeLessThanOrEqual(STRUCT_TRIANGLE_BUDGET.low);
    expect(low.instances().length).toBeGreaterThan(test.instances().length);
  });
});
