// Fix-5A3 (audit 4, finding 2.10): the glide between two helicopter tables (M13a-2). When the table moved, a flying helicopter of the same owner that was drawn before gets
// `slotDelta` = (the old drawn position - the new one) and `slotGroundDelta` for the ground point under it; a new, parked, re-owned, teleported (farther than HELI_TELEPORT_R) or
// formerly parked one gets 0. The instance attribute `aDelta` carries the same numbers, a rebuild without a new table version keeps the reference, and `frame(.., alpha)` sets uTick.
import { Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { bindHeightSource } from '../../src/render/detail';
import { HeliLayer } from '../../src/render/heliLayer';
import { HELI_CAPACITY } from '../../src/sim/rules';
import { HELI_CRUISE, HELI_PAD, type HeliView } from '../../src/sim/public';
import { loadChunkWorld } from '../helpers/chunkWorld';

const W = 1024;
const H = 512;

beforeAll(async () => {
  const world = await loadChunkWorld();
  bindHeightSource(world.detailField.sampler as NonNullable<typeof world.detailField.sampler>);
});

interface Table extends HeliView {
  owner: number[];
  state: number[];
  x: number[];
  y: number[];
  alt: number[];
}
function table(n: number): Table {
  const zeros = new Array<number>(n).fill(0);
  return { capacity: HELI_CAPACITY, highWater: n, liveCount: n, owner: new Array<number>(n).fill(1), state: new Array<number>(n).fill(HELI_CRUISE), factory: zeros, readyTick: zeros, x: new Array<number>(n).fill(0), y: new Array<number>(n).fill(0), alt: new Array<number>(n).fill(0), hp: zeros, load: zeros, fuel: zeros, countOf: () => 0 };
}
const cellQ = (c: number): number => c * 256 + 128;

function setup(t: Table): { l: HeliLayer; next: (alpha?: number) => void; delta: (id: number) => number[]; gdelta: (id: number) => number[]; pos: (id: number) => number[] } {
  const l = new HeliLayer({ gridWidth: W, gridHeight: H, sun: new Vector3(1, 0, 0) });
  const pal = new Uint8Array(16 * 4);
  pal.set([200, 30, 30, 255], 4);
  pal.set([20, 200, 40, 255], 8);
  l.setOwnerPalette(pal);
  let version = 1;
  l.setTable(t, version);
  l.frame([0, 0, 3], 0);
  return {
    l,
    next: (alpha = 1) => {
      l.setTable(t, ++version);
      l.frame([0, 0, 3], 0, alpha);
    },
    delta: (id) => Array.from(l.slotDelta.subarray(id * 3, id * 3 + 3)),
    gdelta: (id) => Array.from(l.slotGroundDelta.subarray(id * 3, id * 3 + 3)),
    pos: (id) => Array.from(l.slotPos.subarray(id * 3, id * 3 + 3)),
  };
}
const sub = (a: number[], b: number[]): number[] => a.map((v, i) => v - (b[i] as number));
const norm = (a: number[]): number => Math.hypot(a[0] as number, a[1] as number, a[2] as number);

describe('helicopter layer: the glide between tables', () => {
  it('a flying helicopter that moved a little gets delta = old position minus new, and the same for the ground point', () => {
    const t = table(1);
    t.x[0] = cellQ(300);
    t.y[0] = cellQ(200);
    t.alt[0] = 400;
    const s = setup(t);
    const p0 = s.pos(0);
    const g0 = Array.from(s.l.slotGround.subarray(0, 3));
    expect(s.delta(0)).toEqual([0, 0, 0]); // the first table has nothing to blend from
    t.x[0] = cellQ(301.5);
    t.y[0] = cellQ(200.5);
    t.alt[0] = 900; // a climb: the position delta and the ground delta differ
    s.next();
    const p1 = s.pos(0);
    const g1 = Array.from(s.l.slotGround.subarray(0, 3));
    const d = s.delta(0);
    expect(norm(d)).toBeGreaterThan(1e-4);
    for (let k = 0; k < 3; k++) expect(d[k]).toBeCloseTo(sub(p0, p1)[k] as number, 12);
    const gd = s.gdelta(0);
    expect(norm(gd)).toBeGreaterThan(1e-4);
    for (let k = 0; k < 3; k++) expect(gd[k]).toBeCloseTo(sub(g0, g1)[k] as number, 12);
    expect(norm(sub(d, gd))).toBeGreaterThan(1e-6); // the climb is in the position delta only
    // the instance attribute carries the position delta in float32
    const dlt = (s.l as unknown as { dlt: Float32Array }).dlt;
    for (let k = 0; k < 3; k++) expect(dlt[k]).toBeCloseTo(d[k] as number, 6);
  });

  it('blends a short hop (2 cells, 0.012 Earth radii) but not a teleport (8 cells, 0.05)', () => {
    const t = table(2);
    for (let i = 0; i < 2; i++) {
      t.x[i] = cellQ(300 + i * 20);
      t.y[i] = cellQ(200);
      t.alt[i] = 400;
    }
    const s = setup(t);
    t.x[0] = cellQ(302);
    t.x[1] = cellQ(320 + 8);
    s.next();
    expect(norm(s.delta(0))).toBeGreaterThan(1e-3);
    expect(s.delta(1)).toEqual([0, 0, 0]);
    expect(s.gdelta(1)).toEqual([0, 0, 0]);
    // a delta once set is cleared again by a later teleport of the same slot (no stale numbers)
    t.x[0] = cellQ(302 + 10);
    s.next();
    expect(s.delta(0)).toEqual([0, 0, 0]);
  });

  it('gives a new, a parked, a re-owned and a formerly parked helicopter no blend', () => {
    const t = table(4);
    for (let i = 0; i < 4; i++) {
      t.x[i] = cellQ(300 + i * 30);
      t.y[i] = cellQ(200);
      t.alt[i] = 400;
    }
    t.owner[3] = 0; // slot 3 not there yet
    t.state[1] = HELI_PAD;
    t.alt[1] = 0;
    t.state[2] = HELI_PAD;
    t.alt[2] = 0;
    const s = setup(t);
    // table 2: slot 1 stays parked, slot 2 takes off close to its pad, slot 3 appears, slot 0 changes owner
    t.x[1] = cellQ(331);
    t.x[2] = cellQ(361);
    t.state[2] = HELI_CRUISE;
    t.alt[2] = 400;
    t.owner[3] = 1;
    t.owner[0] = 2;
    t.x[0] = cellQ(301);
    s.next();
    for (const id of [0, 1, 2, 3]) expect(s.delta(id)).toEqual([0, 0, 0]);
    // table 3: now slot 2 flew in the last table, so it blends; slot 0 (owner 2 in both) blends
    t.x[2] = cellQ(362);
    t.x[0] = cellQ(302);
    s.next();
    expect(norm(s.delta(2))).toBeGreaterThan(1e-4);
    expect(norm(s.delta(0))).toBeGreaterThan(1e-4);
    expect(s.delta(1)).toEqual([0, 0, 0]);
    // table 4: slot 0 lands on a pad, table 5: it takes off again close by: the parked table in between is no reference
    t.state[0] = HELI_PAD;
    t.alt[0] = 0;
    s.next();
    expect(s.delta(0)).toEqual([0, 0, 0]);
    t.state[0] = HELI_CRUISE;
    t.alt[0] = 400;
    t.x[0] = cellQ(303);
    s.next();
    expect(s.delta(0)).toEqual([0, 0, 0]);
  });

  it('a rebuild without a new table version (a palette change) keeps the reference and the delta', () => {
    const t = table(1);
    t.x[0] = cellQ(300);
    t.y[0] = cellQ(200);
    t.alt[0] = 400;
    const s = setup(t);
    t.x[0] = cellQ(301);
    s.next();
    const d = s.delta(0);
    expect(norm(d)).toBeGreaterThan(1e-4);
    const pal = new Uint8Array(16 * 4);
    pal.set([9, 9, 9, 255], 4);
    s.l.setOwnerPalette(pal);
    s.l.frame([0, 0, 3], 0);
    expect(s.delta(0)).toEqual(d);
    s.l.setTable(t, 2); // the same version again
    s.l.setOwnerPalette(pal);
    s.l.frame([0, 0, 3], 0);
    expect(s.delta(0)).toEqual(d);
  });

  it('frame(.., alpha) hands the sim fraction to the shader (uTick) and to the layer', () => {
    const t = table(1);
    t.x[0] = cellQ(300);
    t.y[0] = cellQ(200);
    const s = setup(t);
    s.next(0.25);
    const uni = (s.l as unknown as { material: { uniforms: { uTick: { value: number } } } }).material.uniforms;
    expect(uni.uTick.value).toBe(0.25);
    expect(s.l.alpha).toBe(0.25);
    s.l.frame([0, 0, 3], 0);
    expect(uni.uTick.value).toBe(1);
  });
});
