// Fix-5A3 (audit 4, finding 2.10): the edges of the helicopter effects that the picture tests alone could see: the particle ring wraps (dust never spills into the smoke ring and
// never dies out), a long frame gap emits at most the clamp, the transitions (crash, take-off puff, unload puff) fire on a CHANGE of state only and not for a re-owned slot,
// a downed one throws a shadow but shows no icon, the table is read once per rebuild (not per frame), the particle mesh hides itself when nothing is alive, and a beachhead
// flag restarts its hoist when the slot was freed in between.
import { Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { bindHeightSource } from '../../src/render/detail';
import { HELI_FX_DUST_POOL } from '../../src/render/config';
import { HeliFx } from '../../src/render/heliFx';
import { HeliLayer } from '../../src/render/heliLayer';
import { HELI_CAPACITY } from '../../src/sim/rules';
import { HELI_CRUISE, HELI_DOWNED, HELI_LIFT, HELI_PAD, HELI_UNLOAD, type BeachheadView, type HeliView } from '../../src/sim/public';
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
  alt: number[];
}
function table(n: number, state: number, alt: number, ownerId = 1): Table {
  const owner = new Array<number>(64).fill(0);
  const st = new Array<number>(64).fill(0);
  const x = new Array<number>(64).fill(0);
  const y = new Array<number>(64).fill(0);
  const a = new Array<number>(64).fill(0);
  for (let i = 0; i < n; i++) {
    owner[i] = ownerId;
    st[i] = state;
    x[i] = (520 + (i % 8)) * 256 + 128;
    y[i] = (120 + Math.floor(i / 8)) * 256 + 128;
    a[i] = alt;
  }
  const zeros = new Array<number>(64).fill(0);
  return { capacity: HELI_CAPACITY, highWater: 64, liveCount: n, owner, state: st, factory: zeros, readyTick: zeros, x, y, alt: a, hp: zeros, load: zeros, fuel: zeros, countOf: () => 0 };
}

const PAL = (() => {
  const p = new Uint8Array(16 * 4);
  p.set([200, 30, 30, 255], 4);
  p.set([30, 200, 30, 255], 8);
  return p;
})();

interface Spy {
  emits: number;
  crashes: number;
  bursts: number[];
  syncs: number;
}
function rig() {
  const layer = new HeliLayer({ gridWidth: W, gridHeight: H, sun: new Vector3(1, 0, 0) });
  layer.setOwnerPalette(PAL);
  const fx = new HeliFx({ gridWidth: W, gridHeight: H });
  fx.setOwnerPalette(PAL);
  fx.setEnabled(true);
  const priv = fx as unknown as Record<string, (...a: unknown[]) => unknown> & { heads: Uint32Array | number[]; pTime: Float32Array; smokeUntil: Float64Array | Float32Array | number[] };
  const spy: Spy = { emits: 0, crashes: 0, bursts: [], syncs: 0 };
  const wrap = (name: string, f: (args: unknown[]) => void): void => {
    const orig = priv[name] as (...a: unknown[]) => unknown;
    priv[name] = function (this: unknown, ...a: unknown[]): unknown {
      f(a);
      return orig.apply(fx, a);
    };
  };
  wrap('emit', () => void spy.emits++);
  wrap('crash', () => void spy.crashes++);
  wrap('dustBurst', (a) => void spy.bursts.push(a[3] as number));
  wrap('sync', () => void spy.syncs++);
  let version = 0;
  let now = 0;
  let cam: number[] = [0, 0, 1.0004];
  const frame = (view: Table, dt: number, newTable: boolean): void => {
    if (newTable) layer.setTable(view, ++version);
    layer.frame(cam, now);
    if (newTable && layer.slotOn[0] === 1) cam = [layer.slotPos[0] as number, layer.slotPos[1] as number, layer.slotPos[2] as number].map((c) => c * 1.0008);
    now += dt;
    layer.frame(cam, now);
    fx.frame(layer, view, cam, now, 540);
  };
  return { layer, fx, priv, spy, frame, time: () => now };
}

describe('helicopter effects: edges', () => {
  it('the dust ring wraps: thousands of puffs later the newest are alive, and the smoke ring was never touched', () => {
    const r = rig();
    const unload = table(1, HELI_UNLOAD, 40);
    r.frame(unload, 0.1, true);
    r.frame(unload, 0.1, false);
    for (let i = 0; i < 120; i++) r.frame(unload, 0.4, false); // 48 s at 55 puffs a second and more
    expect(r.spy.emits).toBeGreaterThan(2 * HELI_FX_DUST_POOL + 100);
    expect(r.fx.info(r.time()).particles).toBeGreaterThan(20);
    const t = r.priv.pTime;
    let smokeWritten = 0;
    for (let i = HELI_FX_DUST_POOL; i < 2 * HELI_FX_DUST_POOL; i++) if ((t[i * 4 + 1] as number) > 0) smokeWritten++;
    expect(smokeWritten).toBe(0);
    expect(r.fx.info(r.time()).visibleMeshes).toBeGreaterThanOrEqual(1);
  });

  it('a 60 second frame gap emits no more than half a second of particles', () => {
    const r = rig();
    const unload = table(1, HELI_UNLOAD, 40);
    r.frame(unload, 0.1, true);
    r.frame(unload, 0.1, false);
    r.frame(unload, 0.1, false);
    const before = r.spy.emits;
    r.frame(unload, 60, false);
    const gap = r.spy.emits - before;
    expect(gap).toBeGreaterThan(5);
    expect(gap).toBeLessThan(80); // 0.5 s of dust (about 28), rope dots and troop dots; 60 s would be thousands
    // a frame with an earlier or equal time emits nothing
    const again = r.spy.emits;
    r.frame(unload, 0, false);
    expect(r.spy.emits).toBe(again);
  });

  it('crash, take-off puff and unload puff fire on a change of state only', () => {
    const r = rig();
    r.frame(table(1, HELI_CRUISE, 300), 0.1, true);
    r.frame(table(1, HELI_CRUISE, 300), 0.1, false);
    expect(r.spy.crashes).toBe(0);
    r.frame(table(1, HELI_DOWNED, 200), 0.1, true);
    expect(r.spy.crashes).toBe(1);
    r.frame(table(1, HELI_DOWNED, 150), 0.1, true); // the same state in the next table: no second flash
    r.frame(table(1, HELI_DOWNED, 100), 0.1, true);
    expect(r.spy.crashes).toBe(1);
    // lift: a puff when it comes off the pad only
    const q = rig();
    q.frame(table(1, HELI_PAD, 0), 0.1, true);
    q.frame(table(1, HELI_PAD, 0), 0.1, false);
    q.frame(table(1, HELI_LIFT, 20), 0.1, true);
    expect(q.spy.bursts).toEqual([22]);
    q.frame(table(1, HELI_LIFT, 40), 0.1, true);
    expect(q.spy.bursts).toEqual([22]); // still lifting: none
    const c = rig();
    c.frame(table(1, HELI_CRUISE, 300), 0.1, true);
    c.frame(table(1, HELI_LIFT, 300), 0.1, true);
    expect(c.spy.bursts).toEqual([]); // a lift that did not start on the pad: none
    // unload: once when it begins
    const u = rig();
    u.frame(table(1, HELI_CRUISE, 300), 0.1, true);
    u.frame(table(1, HELI_UNLOAD, 5), 0.1, true);
    u.frame(table(1, HELI_UNLOAD, 5), 0.1, true);
    expect(u.spy.bursts).toEqual([34]);
  });

  it('a slot that changed owner starts from nothing: no flash for a downed row, and the old smoke stops', () => {
    const r = rig();
    r.frame(table(1, HELI_CRUISE, 300), 0.1, true);
    r.frame(table(1, HELI_CRUISE, 300), 0.1, false);
    r.frame(table(1, HELI_DOWNED, 200), 0.1, true);
    expect(r.spy.crashes).toBe(1);
    expect(r.priv.smokeUntil[0]).toBeGreaterThan(0);
    r.frame(table(1, HELI_DOWNED, 200, 2), 0.1, true); // the slot was recycled by owner 2
    expect(r.priv.smokeUntil[0]).toBe(0);
    expect(r.spy.crashes).toBe(1);
  });

  it('a downed helicopter throws a shadow but shows no icon', () => {
    const r = rig();
    r.frame(table(1, HELI_CRUISE, 300), 0.1, true);
    r.frame(table(1, HELI_DOWNED, 200), 0.1, true);
    expect(r.fx.info(r.time())).toMatchObject({ shadows: 1, icons: 0 });
    r.frame(table(1, HELI_CRUISE, 300), 0.1, true);
    expect(r.fx.info(r.time())).toMatchObject({ shadows: 1, icons: 1 });
  });

  it('reads the table once per rebuild, not once per frame', () => {
    const r = rig();
    const t = table(2, HELI_CRUISE, 300);
    r.frame(t, 0.1, true);
    const n = r.spy.syncs;
    expect(n).toBeGreaterThanOrEqual(1);
    for (let i = 0; i < 20; i++) r.frame(t, 0.05, false);
    expect(r.spy.syncs).toBe(n);
    r.frame(t, 0.05, true);
    expect(r.spy.syncs).toBe(n + 1);
  });

  it('the particle mesh hides itself when the last particle has died, and shows while some live', () => {
    const r = rig();
    r.frame(table(1, HELI_PAD, 0), 0.1, true);
    r.frame(table(1, HELI_LIFT, 20), 0.1, true);
    const fx = r.fx as unknown as { particles: { mesh: { visible: boolean } } };
    expect(fx.particles.mesh.visible).toBe(true);
    const idle = table(1, HELI_PAD, 0);
    r.frame(idle, 30, true); // 30 s later (the clamp lets the clock run on in the frame call)
    r.frame(idle, 30, false);
    expect(r.fx.info(r.time()).particles).toBe(0);
    expect(fx.particles.mesh.visible).toBe(false);
  });

  it('a beachhead flag restarts its hoist when the slot was freed and taken again with the same landing tick', () => {
    const fx = new HeliFx({ gridWidth: W, gridHeight: H });
    fx.setOwnerPalette(PAL);
    fx.setEnabled(true);
    const rows = { capacity: 64, liveCount: 1, owner: new Array<number>(64).fill(0), seed: new Array<number>(64).fill(0), landTick: new Array<number>(64).fill(0), status: new Array<number>(64).fill(0), cellsOf: () => 1 };
    const view = rows as unknown as BeachheadView;
    const nothing = { rebuilds: 0, slotOn: new Uint8Array(64), alpha: 1 } as unknown as HeliLayer;
    const f = fx as unknown as { fOwner: Float32Array };
    fx.setBeachheads(view, 0);
    fx.frame(nothing, null, [0, 0, 3], 1, 540);
    rows.owner[3] = 1;
    rows.seed[3] = 100 * W + 300;
    rows.landTick[3] = 500;
    fx.setBeachheads(view, 1);
    fx.frame(nothing, null, [0, 0, 3], 12, 540);
    expect(f.fOwner[3]).toBe(12);
    rows.owner[3] = 0;
    fx.setBeachheads(view, 2);
    fx.frame(nothing, null, [0, 0, 3], 20, 540);
    expect(fx.info(20).flags).toBe(0);
    rows.owner[3] = 1;
    fx.setBeachheads(view, 3);
    fx.frame(nothing, null, [0, 0, 3], 30, 540);
    expect(f.fOwner[3]).toBe(30);
  });
});
