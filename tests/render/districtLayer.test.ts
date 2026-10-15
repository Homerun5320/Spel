// Districts-2b: the district models (triangle counts, bounds, owner tint), the slot placement, the distance cut and the per-layer triangle budget.
import { Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { DISTRICT_FADE_PX_HI, DISTRICT_FADE_PX_LO, DISTRICT_MODEL_UNIT, DISTRICT_RING_R, DISTRICT_TRIANGLE_BUDGET } from '../../src/render/config';
import { bindHeightSource } from '../../src/render/detail';
import { latLonToVec } from '../../src/render/geo';
import { DistrictLayer } from '../../src/render/districts';
import {
  DISTRICT_MODEL_MAX_TRIANGLES,
  DISTRICT_BUILDERS,
  buildDistrictModels,
  districtCutDistanceM,
  districtFade,
  districtRadiusM,
  districtRadiusPx,
  districtSlotModelOffset,
  districtSlotOffsetM,
} from '../../src/render/districtModels';
import {
  DISTRICT_BARRACKS,
  DISTRICT_HOUSING,
  DISTRICT_MARKET,
  DISTRICT_WALLS,
  STRUCT_CITY,
  districtIndex,
  districtSlotsOf,
  type DistrictView,
  type StructureView,
} from '../../src/sim/public';
import { readBudgets } from '../helpers/budgets';
import { loadChunkWorld } from '../helpers/chunkWorld';

const W = 1024;
const H = 512;
const KINDS = [DISTRICT_HOUSING, DISTRICT_MARKET, DISTRICT_BARRACKS, DISTRICT_WALLS];

beforeAll(async () => {
  const world = await loadChunkWorld();
  bindHeightSource(world.detailField.sampler as NonNullable<typeof world.detailField.sampler>);
});

describe('the district models', () => {
  it('each kind is at most 60 triangles, fits in the unit disc, stands on y >= -0.5 and has an owner-tinted part', () => {
    for (const k of KINDS) {
      const m = (DISTRICT_BUILDERS[k] as () => ReturnType<(typeof DISTRICT_BUILDERS)[1]>)();
      expect(m.triangles).toBeGreaterThan(10);
      expect(m.triangles).toBeLessThanOrEqual(DISTRICT_MODEL_MAX_TRIANGLES);
      let maxR = 0;
      let minY = 0;
      let maxY = 0;
      for (let i = 0; i < m.positions.length; i += 3) {
        maxR = Math.max(maxR, Math.hypot(m.positions[i] as number, m.positions[i + 2] as number));
        minY = Math.min(minY, m.positions[i + 1] as number);
        maxY = Math.max(maxY, m.positions[i + 1] as number);
      }
      expect(maxR).toBeLessThanOrEqual(1.3); // the corner of the slab is the widest point
      expect(minY).toBeGreaterThanOrEqual(-0.5);
      expect(maxY).toBeGreaterThan(0.5);
      expect(maxY).toBeLessThanOrEqual(1.5);
      expect(m.tints.some((t) => t === 1)).toBe(true); // reads as the owner's from afar
      expect(m.tints.some((t) => t === 0)).toBe(true);
    }
  });

  it('the merged geometry carries every kind once, with a kind code per vertex', () => {
    const g = buildDistrictModels();
    expect(g.triangles).toBe(KINDS.reduce((s, k) => s + (g.trianglesByKind[k] as number), 0));
    expect(g.kinds.length).toBe(g.triangles * 3);
    for (const k of KINDS) expect(g.kinds.filter((x) => x === k).length).toBe((g.trianglesByKind[k] as number) * 3);
  });
});

describe('slot placement', () => {
  it('uses the first 2 / 3 / 4 fixed slots of the City level, on the ring, and follows the City yaw', () => {
    expect(districtSlotsOf(1)).toBe(2);
    expect(districtSlotsOf(3)).toBe(4);
    expect(districtSlotOffsetM(1, 2, 0, 700)).toBeNull();
    expect(districtSlotOffsetM(3, 2, 0, 700)).not.toBeNull();
    for (let s = 0; s < 4; s++) {
      const o = districtSlotModelOffset(s);
      expect(Math.hypot(o.x, o.z)).toBeCloseTo(DISTRICT_RING_R, 9);
    }
    // a slot does not move when the City levels up (level 1 and 3 have the same unit, level 3 is 1.5 x larger)
    const a = districtSlotOffsetM(1, 0, 0, 700) as { east: number; north: number };
    const b = districtSlotOffsetM(3, 0, 0, 700) as { east: number; north: number };
    expect(b.east / a.east).toBeCloseTo(1.5, 9);
    expect(b.north / a.north).toBeCloseTo(1.5, 9);
    // the City's yaw turns the whole ring: the distance to the centre is kept, the direction turns by the yaw
    const yaw = 0.9;
    const r0 = districtSlotOffsetM(2, 1, 0, 700) as { east: number; north: number };
    const r1 = districtSlotOffsetM(2, 1, yaw, 700) as { east: number; north: number };
    expect(Math.hypot(r1.east, r1.north)).toBeCloseTo(Math.hypot(r0.east, r0.north), 6);
    const turn = Math.atan2(r1.north, r1.east) - Math.atan2(r0.north, r0.east);
    expect(Math.cos(turn)).toBeCloseTo(Math.cos(yaw), 9);
    expect(Math.sin(turn)).toBeCloseTo(Math.sin(yaw), 9);
    // slots are apart from each other by more than a district is wide (no overlap)
    for (let s = 1; s < 4; s++) {
      const p = districtSlotModelOffset(0);
      const q = districtSlotModelOffset(s);
      expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeGreaterThan(2 * DISTRICT_MODEL_UNIT * 1.4);
    }
  });
});

describe('the distance cut', () => {
  const viewH = 540;
  const tan = Math.tan((45 * Math.PI) / 360);
  it('fades from full at DISTRICT_FADE_PX_HI to nothing at _LO, and the cut distance is where the radius is _LO pixels', () => {
    expect(districtFade(DISTRICT_FADE_PX_HI)).toBe(1);
    expect(districtFade(DISTRICT_FADE_PX_HI + 20)).toBe(1);
    expect(districtFade(DISTRICT_FADE_PX_LO)).toBe(0);
    expect(districtFade(0.5)).toBe(0);
    const mid = districtFade((DISTRICT_FADE_PX_HI + DISTRICT_FADE_PX_LO) / 2);
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(0.7);
    const rM = districtRadiusM(1, 1, 700);
    const cut = districtCutDistanceM(rM, viewH, tan);
    expect(districtRadiusPx(rM, cut, viewH, tan)).toBeCloseTo(DISTRICT_FADE_PX_LO, 9);
    expect(districtFade(districtRadiusPx(rM, cut * 1.01, viewH, tan))).toBe(0);
    expect(districtFade(districtRadiusPx(rM, cut * 0.5, viewH, tan))).toBe(1);
  });
});

/** `cities` Cities of level 3 with four districts each (kinds cycling), owner 1. */
function tables(cities: number): { st: StructureView; ds: DistrictView } {
  const cells = Array.from({ length: cities }, (_, i) => (200 + (i % 40) * 7) * W + 300 + Math.floor(i / 40) * 11);
  const st: StructureView = {
    capacity: 4096,
    highWater: cities,
    liveCount: cities,
    type: cells.map(() => STRUCT_CITY),
    owner: cells.map(() => 1),
    cell: cells,
    level: cells.map(() => 3),
    buildTick: cells.map(() => 0),
    readyTick: cells.map(() => 0),
    upgradeReadyTick: cells.map(() => 0),
    idAt: () => -1,
    ownedCount: () => 0,
    deleteReadyTick: () => 0,
  };
  const kind = new Uint8Array(cities * 4);
  const level = new Uint8Array(cities * 4);
  for (let id = 0; id < cities; id++) {
    for (let s = 0; s < 4; s++) {
      kind[districtIndex(id, s)] = KINDS[(id + s) % 4] as number;
      level[districtIndex(id, s)] = 1 + (s % 3);
    }
  }
  const ds: DistrictView = { districtKind: kind, districtLevel: level, districtReadyTick: new Uint32Array(cities * 4), districtUpgradeReadyTick: new Uint32Array(cities * 4), districtsOwned: () => 0 };
  return { st, ds };
}

function layerWith(cities: number): DistrictLayer {
  const layer = new DistrictLayer({ tier: 'test', gridWidth: W, gridHeight: H, sun: new Vector3(1, 0, 0) });
  layer.setOwnerPalette(new Uint8Array(16).fill(200));
  const { st, ds } = tables(cities);
  layer.setTable(st, ds, 1);
  layer.frame([0, 0, 3], 1, 0, 540, 0.41); // builds the instances
  return layer;
}

describe('the district layer', () => {
  it('counts per kind, stays inside the documented row, and cuts deterministically by City id and slot', () => {
    const row = readBudgets().find((r) => r.layer.startsWith('Distrikt'));
    expect(row?.triangles).toBe(DISTRICT_TRIANGLE_BUDGET.test);
    expect(row?.drawCalls).toBe(1);
    const few = layerWith(3);
    few.frame([0, 0, 3], 1, 0, 540, 0.41);
    expect(few.total()).toBe(12);
    expect(few.counts().slice(1)).toEqual([3, 3, 3, 3]);
    expect(few.dropped).toBe(0);
    const big = layerWith(100);
    big.frame([0, 0, 3], 1, 0, 540, 0.41);
    expect(big.trianglesDrawn).toBeLessThanOrEqual(DISTRICT_TRIANGLE_BUDGET.test);
    expect(big.total() + big.dropped).toBe(400);
    expect(big.dropped).toBeGreaterThan(0);
    const ids = big.instances().map((d) => d.structure * 4 + d.slot);
    expect(ids).toEqual([...ids].sort((a, b) => a - b)); // the highest ids are the ones left out
    expect(layerWith(100).instances().map((d) => d.structure * 4 + d.slot)).toEqual(ids);
  });

  it('draws nothing when empty and nothing when the camera is beyond the cut distance; draws when close', () => {
    const empty = layerWith(0);
    empty.frame([0, 0, 1.0001], 1, 0, 540, 0.41);
    expect(empty.visible).toBe(false);
    const layer = layerWith(1);
    const at = layer.instances()[0] as { lat: number; lon: number };
    const d = latLonToVec(at.lat, at.lon);
    layer.frame([(d[0] as number) * 1.0005, (d[1] as number) * 1.0005, (d[2] as number) * 1.0005], 1, 0, 540, 0.41); // about 3 km above
    expect(layer.visible).toBe(true);
    expect(layer.drawnNow).toBe(true);
    layer.frame([0, 0, 40], 1, 0, 540, 0.41); // 40 Earth radii away
    expect(layer.visible).toBe(false);
    expect(layer.drawnNow).toBe(false);
  });
});
