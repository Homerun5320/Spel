// Districts-2b: the district models (triangle counts, bounds, owner tint), the slot placement, the distance cut and the per-layer triangle budget.
import { Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { DISTRICT_FADE_PX_HI, DISTRICT_FADE_PX_LO, DISTRICT_MODEL_UNIT, DISTRICT_RING_R, DISTRICT_SLOT_ANGLES, DISTRICT_TRIANGLE_BUDGET } from '../../src/render/config';
import { levelScale } from '../../src/render/cityTiers';
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
  DISTRICT_MAX_SLOTS,
  DISTRICT_WALLS,
  STRUCT_CITY,
  districtIndex,
  districtSlotsOf,
  maxLevelOf,
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
  it('uses the first 2 / 3 / 4 / 5 fixed slots of the City level, on the ring, and follows the City yaw', () => {
    // Sim-Growth: 2 slots at levels 1 to 2, 3 at 3 to 5, 4 at 6 to 8, 5 at 9 to 10
    expect([1, 2, 3, 5, 6, 8, 9, 10].map(districtSlotsOf)).toEqual([2, 2, 3, 3, 4, 4, 5, 5]);
    expect(districtSlotsOf(maxLevelOf(STRUCT_CITY))).toBe(DISTRICT_MAX_SLOTS);
    expect(DISTRICT_SLOT_ANGLES.length).toBe(DISTRICT_MAX_SLOTS);
    expect(districtSlotOffsetM(1, 2, 0, 700)).toBeNull();
    expect(districtSlotOffsetM(3, 2, 0, 700)).not.toBeNull();
    expect(districtSlotOffsetM(3, 3, 0, 700)).toBeNull();
    expect(districtSlotOffsetM(6, 3, 0, 700)).not.toBeNull();
    expect(districtSlotOffsetM(6, 4, 0, 700)).toBeNull();
    for (let s = 0; s < DISTRICT_MAX_SLOTS; s++) {
      expect(districtSlotOffsetM(9, s, 0, 700)).not.toBeNull();
      const o = districtSlotModelOffset(s);
      expect(Math.hypot(o.x, o.z)).toBeCloseTo(DISTRICT_RING_R, 9);
    }
    expect(districtSlotOffsetM(10, DISTRICT_MAX_SLOTS, 0, 700)).toBeNull();
    // a slot does not move when the City levels up (only the City's unit grows: level 10 is 1.5 x level 1, level 3 a small step)
    const a = districtSlotOffsetM(1, 0, 0, 700) as { east: number; north: number };
    const b = districtSlotOffsetM(3, 0, 0, 700) as { east: number; north: number };
    const c = districtSlotOffsetM(10, 0, 0, 700) as { east: number; north: number };
    expect(b.east / a.east).toBeCloseTo(levelScale(3) / levelScale(1), 9);
    expect(b.north / a.north).toBeCloseTo(levelScale(3) / levelScale(1), 9);
    expect(levelScale(3) / levelScale(1)).toBeGreaterThan(1);
    expect(c.east / a.east).toBeCloseTo(levelScale(10), 9); // Look-2: the level scale is logarithmic and gentle (level 10 is about 1.11 x level 1)
    expect(c.north / a.north).toBeCloseTo(levelScale(10), 9);
    // the City's yaw turns the whole ring: the distance to the centre is kept, the direction turns by the yaw
    const yaw = 0.9;
    for (const slot of [1, 4]) {
      const r0 = districtSlotOffsetM(10, slot, 0, 700) as { east: number; north: number };
      const r1 = districtSlotOffsetM(10, slot, yaw, 700) as { east: number; north: number };
      expect(Math.hypot(r1.east, r1.north)).toBeCloseTo(Math.hypot(r0.east, r0.north), 6);
      const turn = Math.atan2(r1.north, r1.east) - Math.atan2(r0.north, r0.east);
      expect(Math.cos(turn)).toBeCloseTo(Math.cos(yaw), 9);
      expect(Math.sin(turn)).toBeCloseTo(Math.sin(yaw), 9);
    }
    // slots are apart from each other by more than a district is wide (no overlap), for EVERY pair of the five
    for (let s = 0; s < DISTRICT_MAX_SLOTS; s++) {
      for (let q = s + 1; q < DISTRICT_MAX_SLOTS; q++) {
        const p = districtSlotModelOffset(s);
        const r = districtSlotModelOffset(q);
        expect(Math.hypot(p.x - r.x, p.z - r.z)).toBeGreaterThan(2 * DISTRICT_MODEL_UNIT * 1.4);
      }
    }
  });

  it('the slot sets spread round the City: the largest empty arc is at most 144 degrees with 3 or more slots and 216 degrees with 2', () => {
    const arc = (n: number): number => {
      const angles = DISTRICT_SLOT_ANGLES.slice(0, n)
        .map((x) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI))
        .sort((x, y) => x - y);
      let gap = 0;
      for (let i = 0; i < n; i++) gap = Math.max(gap, ((angles[(i + 1) % n] as number) - (angles[i] as number) + 2 * Math.PI) % (2 * Math.PI) || 2 * Math.PI);
      return (gap * 180) / Math.PI;
    };
    expect(arc(2)).toBeCloseTo(216, 6);
    expect(arc(3)).toBeCloseTo(144, 6);
    expect(arc(4)).toBeCloseTo(144, 6);
    expect(arc(5)).toBeCloseTo(72, 6);
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

/** `cities` Cities of level 6 (four slots) with four districts each (kinds cycling), owner 1. */
function tables(cities: number): { st: StructureView; ds: DistrictView } {
  const cells = Array.from({ length: cities }, (_, i) => (200 + (i % 40) * 7) * W + 300 + Math.floor(i / 40) * 11);
  const st: StructureView = {
    capacity: 4096,
    highWater: cities,
    liveCount: cities,
    type: cells.map(() => STRUCT_CITY),
    owner: cells.map(() => 1),
    cell: cells,
    level: cells.map(() => 6),
    buildTick: cells.map(() => 0),
    readyTick: cells.map(() => 0),
    upgradeReadyTick: cells.map(() => 0),
    idAt: () => -1,
    ownedCount: () => 0,
    deleteReadyTick: () => 0,
  };
  const kind = new Uint8Array(cities * DISTRICT_MAX_SLOTS);
  const level = new Uint8Array(cities * DISTRICT_MAX_SLOTS);
  for (let id = 0; id < cities; id++) {
    for (let s = 0; s < 4; s++) {
      kind[districtIndex(id, s)] = KINDS[(id + s) % 4] as number;
      level[districtIndex(id, s)] = 1 + (s % 3);
    }
  }
  const ds: DistrictView = { districtKind: kind, districtLevel: level, districtReadyTick: new Uint32Array(cities * DISTRICT_MAX_SLOTS), districtUpgradeReadyTick: new Uint32Array(cities * DISTRICT_MAX_SLOTS), districtsOwned: () => 0 };
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
    const ids = big.instances().map((d) => d.structure * DISTRICT_MAX_SLOTS + d.slot);
    expect(ids).toEqual([...ids].sort((a, b) => a - b)); // the highest ids are the ones left out
    expect(layerWith(100).instances().map((d) => d.structure * DISTRICT_MAX_SLOTS + d.slot)).toEqual(ids);
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
