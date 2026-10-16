// Fix-3B: over its triangle allowance the structure layer draws the local player's structures first, then the nearest the camera (a model each); the
// rest keep their far icon instead of vanishing, and a camera that stands still never causes a rebuild.
import { Vector3 } from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { bindHeightSource } from '../../src/render/detail';
import { latLonToVec } from '../../src/render/geo';
import { StructureLayer } from '../../src/render/structures';
import { cellToLatLon } from '../../src/render/transforms';
import { STRUCT_CITY, STRUCT_FACTORY, STRUCT_PORT, STRUCT_POST, STRUCT_SAM, STRUCT_SILO, type StructureView } from '../../src/sim/public';
import { loadChunkWorld } from '../helpers/chunkWorld';

const W = 1024;
const H = 512;
const TYPES = [STRUCT_CITY, STRUCT_FACTORY, STRUCT_PORT, STRUCT_SILO, STRUCT_SAM, STRUCT_POST];
const LOCAL = 1;
const OTHER = 2;

beforeAll(async () => {
  const world = await loadChunkWorld();
  bindHeightSource(world.detailField.sampler as NonNullable<typeof world.detailField.sampler>);
});

/** `n` structures cycling through the six types; every owner is OTHER except the ids in `own`. */
function table(n: number, own: readonly number[]): StructureView {
  const cells = Array.from({ length: n }, (_, i) => (200 + (i % 40) * 7) * W + 300 + Math.floor(i / 40) * 11);
  const byCell = new Map(cells.map((c, id) => [c, id] as const));
  return {
    capacity: 4096,
    highWater: n,
    liveCount: n,
    type: cells.map((_, i) => TYPES[i % 6] as number),
    owner: cells.map((_, i) => (own.includes(i) ? LOCAL : OTHER)),
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

function layerWith(t: StructureView, cam: readonly number[]): StructureLayer {
  const layer = new StructureLayer({ tier: 'test', gridWidth: W, gridHeight: H, sun: new Vector3(1, 0, 0) });
  layer.setOwnerPalette(new Uint8Array(16).fill(200));
  layer.setLocalOwner(LOCAL);
  layer.setTable(t, 1);
  layer.frame(cam, 1, 0, 540);
  return layer;
}

const above = (cell: number, radius: number): number[] => {
  const ll = cellToLatLon(cell, W, H);
  const d = latLonToVec(ll.lat, ll.lon);
  return [d[0] * radius, d[1] * radius, d[2] * radius];
};

describe('structure layer priority over the allowance', () => {
  it("the local player's newest structures are drawn when the layer is over the allowance, the others keep an icon", () => {
    const own = [188, 189, 190];
    const layer = layerWith(table(191, own), [0, 0, 3]);
    expect(layer.dropped).toBeGreaterThan(0);
    const ids = layer.instances().map((d) => d.id);
    for (const id of own) expect(ids, `own structure ${id}`).toContain(id);
    expect(ids.length + layer.dropped).toBe(191);
    expect(layer.iconCount()).toBe(191); // nothing vanishes: the ones without a model are icons
  });

  it('close to the ground the nearest foreign structures are drawn first, and a still camera never rebuilds', () => {
    const t = table(191, []);
    const target = 190; // the highest id: the old cut would have dropped it
    const layer = layerWith(t, above(t.cell[target] as number, 1.002));
    expect(layer.dropped).toBeGreaterThan(0);
    expect(layer.instances().map((d) => d.id)).toContain(target);
    const spy = vi.spyOn(layer as unknown as { rebuild(): void }, 'rebuild');
    const cam = above(t.cell[target] as number, 1.002);
    for (let i = 0; i < 30; i++) layer.frame(cam, 1 + i, 0, 540);
    expect(spy).not.toHaveBeenCalled();
    // a real move (far past a quarter of the altitude) re-ranks once, to the structure now underneath
    const other = 3;
    layer.frame(above(t.cell[other] as number, 1.002), 40, 0, 540);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(layer.instances().map((d) => d.id)).toContain(other);
  });

  it('a set that fits is drawn in id order and drops nothing', () => {
    const layer = layerWith(table(30, [29]), [0, 0, 3]);
    expect(layer.dropped).toBe(0);
    const ids = layer.instances().map((d) => d.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(ids.length).toBe(30);
  });
});
