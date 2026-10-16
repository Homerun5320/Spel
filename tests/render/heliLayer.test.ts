// M13a-1: the helicopter layer draws every row of a HeliView that is not under production, wherever it is and whatever it does; the position is the sim's
// (within half a cell), the model is small, the buffers hold the table's capacity and nothing is drawn for free slots.
import { Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { bindHeightSource } from '../../src/render/detail';
import { HELI_INSTANCE_CAP, HELI_MODEL_MAX_TRIANGLES } from '../../src/render/config';
import { HeliLayer, heliLatLon } from '../../src/render/heliLayer';
import { heliModel } from '../../src/render/heliModel';
import { HELI_CAPACITY } from '../../src/sim/rules';
import { HELI_APPROACH, HELI_BUILDING, HELI_CRUISE, HELI_DOWNED, HELI_HOVER, HELI_LIFT, HELI_PAD, HELI_RETURN, HELI_UNLOAD, type HeliView } from '../../src/sim/public';
import { loadChunkWorld } from '../helpers/chunkWorld';

const W = 1024;
const H = 512;

beforeAll(async () => {
  const world = await loadChunkWorld();
  bindHeightSource(world.detailField.sampler as NonNullable<typeof world.detailField.sampler>);
});

const STATES = [HELI_BUILDING, HELI_PAD, HELI_LIFT, HELI_CRUISE, HELI_APPROACH, HELI_HOVER, HELI_UNLOAD, HELI_RETURN, HELI_DOWNED];

/** One helicopter per state in slots 0..8, a free slot at 9 and one more (owner 2) at 10; x/y in Q8 cells, altitude in game metres. */
function fixture(): HeliView {
  const n = 11;
  const owner = new Array<number>(n).fill(1);
  const state = new Array<number>(n).fill(0);
  const x = new Array<number>(n).fill(0);
  const y = new Array<number>(n).fill(0);
  const alt = new Array<number>(n).fill(0);
  STATES.forEach((s, i) => {
    state[i] = s;
    x[i] = (300 + i * 3) * 256 + 128 + (i % 2) * 77;
    y[i] = (200 + i * 2) * 256 + 128 + (i % 3) * 51;
    alt[i] = s === HELI_PAD || s === HELI_BUILDING ? 0 : 400 + i * 10;
  });
  owner[9] = 0;
  owner[10] = 2;
  state[10] = HELI_PAD;
  x[10] = 500 * 256 + 128;
  y[10] = 100 * 256 + 128;
  const zeros = new Array<number>(n).fill(0);
  return { capacity: HELI_CAPACITY, highWater: n, liveCount: 10, owner, state, factory: zeros, readyTick: zeros, x, y, alt, hp: zeros, load: zeros, fuel: zeros, countOf: () => 0 };
}

function layer(view: HeliView): HeliLayer {
  const l = new HeliLayer({ gridWidth: W, gridHeight: H, sun: new Vector3(1, 0, 0) });
  const pal = new Uint8Array(16 * 4);
  pal.set([200, 30, 30, 255], 4);
  pal.set([20, 200, 40, 255], 8);
  l.setOwnerPalette(pal);
  l.setTable(view, 1);
  l.frame([0, 0, 3], 0);
  return l;
}

describe('helicopter layer', () => {
  it('the model is one merged geometry under the triangle ceiling and the buffer holds the sim table', () => {
    expect(heliModel().triangles).toBeGreaterThan(20);
    expect(heliModel().triangles).toBeLessThan(HELI_MODEL_MAX_TRIANGLES);
    expect(HELI_INSTANCE_CAP).toBe(HELI_CAPACITY);
  });

  it('draws one instance per state except under production, none for a free slot, in ONE mesh', () => {
    const l = layer(fixture());
    const ids = l.drawn().map((d) => d.id);
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 10]);
    expect(l.count).toBe(9);
    expect(l.meshes).toHaveLength(1);
    expect(l.drawn().find((d) => d.state === HELI_DOWNED)).toBeDefined();
    expect(l.drawn().find((d) => d.state === HELI_BUILDING)).toBeUndefined();
  });

  it('every drawn position equals the sim position within half a cell', () => {
    const v = fixture();
    const l = layer(v);
    for (const d of l.drawn()) {
      expect(Math.abs(d.cellX - (v.x[d.id] as number) / 256)).toBeLessThan(0.5);
      expect(Math.abs(d.cellY - (v.y[d.id] as number) / 256)).toBeLessThan(0.5);
      const ll = heliLatLon(v.x[d.id] as number, v.y[d.id] as number, W, H);
      expect(d.lat).toBeCloseTo(ll.lat, 9);
      expect(d.lon).toBeCloseTo(ll.lon, 9);
    }
  });

  it('a parked one stands on the ground, an airborne one above it, a downed one is drawn too', () => {
    const l = layer(fixture());
    const byId = new Map(l.drawn().map((d) => [d.id, d] as const));
    expect((byId.get(1) as { aglM: number }).aglM).toBe(0);
    expect((byId.get(1) as { parked: boolean }).parked).toBe(true);
    expect((byId.get(3) as { aglM: number }).aglM).toBe(430);
    expect((byId.get(8) as { state: number }).state).toBe(HELI_DOWNED);
    expect((byId.get(3) as { heightM: number }).heightM).toBeGreaterThan((byId.get(3) as { aglM: number }).aglM - 1);
  });

  it('the owner colour comes from the palette and a changed table version redraws', () => {
    const v = fixture();
    const l = layer(v);
    expect(l.drawn()[0]?.owner).toBe(1);
    expect(l.drawn()[8]?.owner).toBe(2);
    const state = v.state as number[];
    state[2] = HELI_BUILDING;
    l.setTable(v, 1); // same version: nothing is rewritten
    l.frame([0, 0, 3], 0);
    expect(l.count).toBe(9);
    l.setTable(v, 2);
    l.frame([0, 0, 3], 0);
    expect(l.count).toBe(8);
  });

  it('a helicopter that moved turns towards its movement', () => {
    const v = fixture();
    const l = layer(v);
    const x = v.x as number[];
    x[3] = (x[3] as number) + 256 * 5; // five cells east
    l.setTable(v, 2);
    l.frame([0, 0, 3], 0);
    expect(l.drawn().find((d) => d.id === 3)?.yaw).toBeCloseTo(0, 6);
  });
});

describe('Fix-4B: the list of drawn helicopters is made only on request', () => {
  it('with `recordDrawn` off the layer draws the same instances but keeps no list (no garbage per table version); with it on (the default, test mode) the list is there', () => {
    const view = fixture();
    const on = layer(view);
    expect(on.recordDrawn).toBe(true);
    expect(on.drawn().length).toBeGreaterThan(5);
    const off = new HeliLayer({ gridWidth: W, gridHeight: H, sun: new Vector3(1, 0, 0) });
    off.recordDrawn = false;
    off.setOwnerPalette(new Uint8Array(16 * 4).fill(200));
    off.setTable(view, 1);
    off.frame([0, 0, 3], 0);
    expect(off.drawn().length).toBe(0);
    expect(off.count).toBe(on.count); // the instances are the same
    expect(off.count).toBeGreaterThan(5);
    off.recordDrawn = true;
    off.setTable(view, 2);
    off.frame([0, 0, 3], 0);
    expect(off.drawn().length).toBe(on.drawn().length);
  });
});
