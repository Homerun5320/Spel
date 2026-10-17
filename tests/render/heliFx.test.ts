// M13a-2: the helicopter effects layer without a GPU. It is fed by the table (transitions) and the fx clock; it holds its caps (1 200 particles, 4 meshes), allocates
// nothing after the constructor, is silent when switched off and draws a fresh beachhead's flag rising and an old one's standing.
import { Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { bindHeightSource } from '../../src/render/detail';
import { HELI_FX_FLAG_CAP, HELI_FX_ICON_CAP, HELI_FX_PARTICLES_MAX, HELI_FX_SHADOW_CAP, HELI_FX_SMOKE_POOL, HELI_INSTANCE_CAP, HELI_SMOKE_EMIT_S, HELI_SMOKE_LIFE_S } from '../../src/render/config';
import { HeliFx } from '../../src/render/heliFx';
import { HeliLayer } from '../../src/render/heliLayer';
import { HELI_CAPACITY } from '../../src/sim/rules';
import { HELI_CRUISE, HELI_DOWNED, HELI_HOVER, HELI_LIFT, HELI_PAD, HELI_UNLOAD, type BeachheadView, type HeliView } from '../../src/sim/public';
import { loadChunkWorld } from '../helpers/chunkWorld';

const W = 1024;
const H = 512;

beforeAll(async () => {
  const world = await loadChunkWorld();
  bindHeightSource(world.detailField.sampler as NonNullable<typeof world.detailField.sampler>);
});

/** n helicopters of owner 1 at the same place (a cell near the Alps), all in `state`, `alt` game metres up. */
function table(n: number, state: number, alt: number): HeliView & { state: number[] } {
  const owner = new Array<number>(64).fill(0);
  const st = new Array<number>(64).fill(0);
  const x = new Array<number>(64).fill(0);
  const y = new Array<number>(64).fill(0);
  const a = new Array<number>(64).fill(0);
  for (let i = 0; i < n; i++) {
    owner[i] = 1;
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
  return p;
})();
const CAM = [0.0, 0.0, 1.0004]; // far enough that nothing is culled: the emission bound is generous (see below)

/** Lets the camera hover over the helicopters (they are near lat 62, lon 5): a point 5 km above them. */
function camOver(layer: HeliLayer): number[] {
  const g = layer.slotPos;
  void g;
  return [layer.slotPos[0] as number, layer.slotPos[1] as number, layer.slotPos[2] as number].map((c) => c * 1.0008);
}

function rig() {
  const layer = new HeliLayer({ gridWidth: W, gridHeight: H, sun: new Vector3(1, 0, 0) });
  layer.setOwnerPalette(PAL);
  const fx = new HeliFx({ gridWidth: W, gridHeight: H });
  fx.setOwnerPalette(PAL);
  fx.setEnabled(true);
  let v = 0;
  let now = 0;
  let cam: number[] = CAM;
  const step = (view: HeliView, dt: number, newTable: boolean): void => {
    if (newTable) layer.setTable(view, ++v);
    layer.frame(cam, now);
    if (newTable && layer.slotOn[0] === 1) cam = camOver(layer);
    now += dt;
    layer.frame(cam, now);
    fx.frame(layer, view, cam, now, 540);
  };
  return { layer, fx, step, time: () => now };
}

describe('the helicopter effects layer', () => {
  it('has four meshes at most (shadows, particles, flags, icons) and the pools the config names', () => {
    const { fx } = rig();
    expect(fx.meshes.length).toBe(4);
    expect(HELI_FX_PARTICLES_MAX).toBeLessThanOrEqual(1200);
    expect(HELI_FX_SHADOW_CAP).toBe(HELI_INSTANCE_CAP);
    expect(HELI_FX_ICON_CAP).toBe(HELI_INSTANCE_CAP);
    expect(HELI_FX_FLAG_CAP).toBeGreaterThanOrEqual(64);
  });

  it('a helicopter that lifts off blows dust; one that hovers drops a rope and dots; both throw a shadow and show the icon; a parked one does none of it', () => {
    const { fx, step, time } = rig();
    const parked = table(1, HELI_PAD, 0);
    step(parked, 0.1, true);
    step(parked, 0.1, false);
    expect(fx.info(time())).toMatchObject({ particles: 0, shadows: 0, icons: 0 });
    const lift = table(1, HELI_LIFT, 40);
    step(lift, 0.1, true);
    const burst = fx.info(time());
    expect(burst.particles).toBeGreaterThanOrEqual(20); // the take-off puff
    expect(burst).toMatchObject({ shadows: 1, icons: 1 });
    const hover = table(1, HELI_HOVER, 60);
    step(hover, 0.05, true);
    const before = fx.info(time()).particles;
    for (let i = 0; i < 12; i++) step(hover, 0.05, false);
    expect(fx.info(time()).particles).toBeGreaterThan(before); // rope dots and troop dots, dust
    expect(fx.info(time()).visibleMeshes).toBeLessThanOrEqual(4);
  });

  it('a shot-down helicopter flashes and smokes for a few seconds and the smoke is gone about five seconds later', () => {
    const { fx, step, time } = rig();
    step(table(1, HELI_CRUISE, 300), 0.1, true);
    step(table(1, HELI_CRUISE, 300), 0.1, false);
    const t0 = time();
    const downed = table(1, HELI_DOWNED, 200);
    step(downed, 0.05, true);
    const flash = fx.info(time()).particles;
    expect(flash).toBeGreaterThanOrEqual(10);
    // keep the clock running past the end of the smoke (the row stays, the smoke goes on from the stored place)
    let peak = flash;
    while (time() - t0 < HELI_SMOKE_EMIT_S + HELI_SMOKE_LIFE_S * 1.2 + 0.2) {
      step(downed, 0.1, false);
      peak = Math.max(peak, fx.info(time()).particles);
    }
    expect(peak).toBeGreaterThan(flash);
    expect(fx.info(time()).particles).toBe(0);
    expect(fx.info(time()).visibleMeshes).toBeLessThanOrEqual(2); // the particle layer hides itself when nothing is alive
    expect(time() - t0).toBeLessThan(6);
  });

  it('never holds more than 1 200 particles, however many helicopters hover and unload', () => {
    const { fx, step, time } = rig();
    step(table(64, HELI_CRUISE, 300), 0.1, true);
    step(table(64, HELI_UNLOAD, 5), 0.1, true);
    let peak = 0;
    for (let i = 0; i < 400; i++) {
      step(table(64, i % 20 < 10 ? HELI_HOVER : HELI_UNLOAD, 5), 0.1, i % 7 === 0);
      peak = Math.max(peak, fx.info(time()).particles);
    }
    // and all of them shot down at once: the sparks and the smoke fill the second ring, the total still holds
    for (let i = 0; i < 40; i++) {
      step(table(64, HELI_DOWNED, 300), 0.1, i === 0);
      peak = Math.max(peak, fx.info(time()).particles);
    }
    console.log(`[fx] peak particles with 64 helicopters hovering, then all downed: ${peak}`);
    expect(peak).toBeLessThanOrEqual(HELI_FX_PARTICLES_MAX);
    expect(peak).toBeGreaterThan(900); // the test sees both pools fill: it can fail on both sides
    expect(fx.info(time()).visibleMeshes).toBeLessThanOrEqual(4);
    void HELI_FX_SMOKE_POOL;
  });

  it('switched off it feeds and draws nothing', () => {
    const { fx, step, time } = rig();
    fx.setEnabled(false);
    step(table(2, HELI_LIFT, 40), 0.1, true);
    step(table(2, HELI_HOVER, 40), 0.1, true);
    step(table(2, HELI_HOVER, 40), 0.1, false);
    expect(fx.info(time())).toMatchObject({ enabled: false, particles: 0, shadows: 0, icons: 0, visibleMeshes: 0 });
  });

  it('the same input gives the same particles (the generator is local and seeded)', () => {
    const run = (): number[] => {
      const { fx, step, time } = rig();
      step(table(3, HELI_LIFT, 40), 0.1, true);
      for (let i = 0; i < 20; i++) step(table(3, HELI_HOVER, 40), 0.05, i === 0);
      return [fx.info(time()).particles, ...Array.from((fx as unknown as { pVel: Float32Array }).pVel.slice(0, 60))];
    };
    expect(run()).toEqual(run());
  });

  it('a flag rises on a fresh beachhead (hoist starts now) and stands on one that was there at the start (hoisted long ago)', () => {
    const { fx } = rig();
    const rows = { capacity: 64, liveCount: 1, owner: new Array<number>(64).fill(0), seed: new Array<number>(64).fill(0), landTick: new Array<number>(64).fill(0), status: new Array<number>(64).fill(0), cellsOf: () => 1 };
    const view = rows as unknown as BeachheadView;
    const f = fx as unknown as { fOwner: Float32Array };
    const nothing = { rebuilds: 0, slotOn: new Uint8Array(64), alpha: 1 } as unknown as HeliLayer;
    fx.setBeachheads(view, 0);
    fx.frame(nothing, null, CAM, 1, 540);
    expect(fx.info(1).flags).toBe(0);
    // a row appears while the match runs: the hoist starts at the fx time it was seen
    rows.owner[3] = 1;
    rows.seed[3] = 100 * W + 300;
    rows.landTick[3] = 500;
    fx.setBeachheads(view, 1);
    fx.frame(nothing, null, CAM, 12, 540);
    expect(fx.info(12).flags).toBe(1);
    expect(f.fOwner[0]).toBeCloseTo(200 / 255, 3); // the owner colour
    expect(f.fOwner[3]).toBe(12); // hoist start
    // a second row, seen later: its own start; the first keeps its
    rows.owner[5] = 1;
    rows.seed[5] = 101 * W + 300;
    rows.landTick[5] = 900;
    fx.setBeachheads(view, 2);
    fx.frame(nothing, null, CAM, 20, 540);
    expect(fx.info(20).flags).toBe(2);
    expect([f.fOwner[3], f.fOwner[7]]).toEqual([12, 20]);
    // a page that starts with a beachhead already standing: no hoist (the start lies far in the past)
    const late = rig().fx;
    rows.owner.fill(0);
    rows.owner[1] = 1;
    late.setBeachheads(view, 0);
    late.frame(nothing, null, CAM, 50, 540);
    expect((late as unknown as { fOwner: Float32Array }).fOwner[3]).toBeLessThan(-50);
  });
});
