// M17-pre: a helicopter that leaves the viewer's sight is a row that turns into a free slot in the next table (the host sends it so). The layer, the effects, the mission
// news and the list must take that as "gone": nothing drawn, no shadow, icon or flag left, no streak when it comes back, no error in the console.
import { Vector3 } from 'three';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { bindHeightSource } from '../../src/render/detail';
import { HeliFx } from '../../src/render/heliFx';
import { HeliLayer } from '../../src/render/heliLayer';
import { MISSION_LANDED, MISSION_LOST, MissionWatcher, ownHeliRows } from '../../src/ui/heliInfo';
import { HELI_CAPACITY } from '../../src/sim/rules';
import { HELI_CRUISE, HELI_DOWNED, HELI_UNLOAD, type HeliView, type SimView } from '../../src/sim/public';
import { loadChunkWorld } from '../helpers/chunkWorld';

const W = 1024;
const H = 512;

beforeAll(async () => {
  const world = await loadChunkWorld();
  bindHeightSource(world.detailField.sampler as NonNullable<typeof world.detailField.sampler>);
});

afterEach(() => vi.restoreAllMocks());

interface Row {
  owner: number;
  state: number;
  cx: number;
}

/** A 64-slot table from rows (slot = index); a row of owner 0 is a free slot. */
function table(rows: readonly Row[]): HeliView {
  const n = HELI_CAPACITY;
  const owner = new Array<number>(n).fill(0);
  const state = new Array<number>(n).fill(0);
  const x = new Array<number>(n).fill(0);
  const y = new Array<number>(n).fill(0);
  const alt = new Array<number>(n).fill(0);
  rows.forEach((r, i) => {
    owner[i] = r.owner;
    state[i] = r.owner === 0 ? 0 : r.state;
    x[i] = r.cx * 256 + 128;
    y[i] = 120 * 256 + 128;
    alt[i] = 300;
  });
  const zeros = new Array<number>(n).fill(0);
  return { capacity: n, highWater: rows.length, liveCount: rows.filter((r) => r.owner !== 0).length, owner, state, factory: zeros, readyTick: zeros, x, y, alt, hp: zeros, load: zeros, fuel: zeros, countOf: () => 0 };
}

const PAL = (() => {
  const p = new Uint8Array(16 * 4);
  p.set([200, 30, 30, 255], 4);
  p.set([30, 30, 200, 255], 8);
  return p;
})();

describe('a helicopter that leaves the viewer\'s sight', () => {
  it('disappears from the layer and the effects without residue or console errors, and comes back without a streak', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const layer = new HeliLayer({ gridWidth: W, gridHeight: H, sun: new Vector3(1, 0, 0) });
    layer.setOwnerPalette(PAL);
    const fx = new HeliFx({ gridWidth: W, gridHeight: H });
    fx.setOwnerPalette(PAL);
    fx.setEnabled(true);
    let version = 0;
    let now = 0;
    const cam = [0, 0, 1.0004];
    const show = (view: HeliView): void => {
      layer.setTable(view, ++version);
      for (let i = 0; i < 3; i++) {
        now += 0.1;
        layer.frame(cam, now);
        fx.frame(layer, view, cam, now, 540);
      }
    };
    const enemy = (cx: number): Row => ({ owner: 2, state: HELI_CRUISE, cx });
    show(table([{ owner: 1, state: HELI_CRUISE, cx: 520 }, enemy(530)]));
    show(table([{ owner: 1, state: HELI_CRUISE, cx: 521 }, enemy(531)]));
    expect(layer.count).toBe(2);
    expect(fx.info(now).shadows).toBe(2);
    // the enemy flies into the shadow: the next table has a free slot there
    show(table([{ owner: 1, state: HELI_CRUISE, cx: 522 }, { owner: 0, state: 0, cx: 0 }]));
    expect(layer.count).toBe(1);
    expect(layer.slotOn[1]).toBe(0);
    expect(fx.info(now)).toMatchObject({ shadows: 1, icons: 1 });
    // it is seen again far from where it left: no glide across the map
    show(table([{ owner: 1, state: HELI_CRUISE, cx: 523 }, enemy(700)]));
    expect(layer.count).toBe(2);
    expect(layer.slotOn[1]).toBe(1);
    expect(Math.abs(layer.slotDelta[3] as number) + Math.abs(layer.slotDelta[4] as number) + Math.abs(layer.slotDelta[5] as number)).toBe(0);
    // and all gone: nothing left
    show(table([{ owner: 0, state: 0, cx: 0 }, { owner: 0, state: 0, cx: 0 }]));
    expect(layer.count).toBe(0);
    expect(fx.info(now)).toMatchObject({ shadows: 0, icons: 0, flags: 0 });
    expect(err).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('the mission news and the list of the own seat', () => {
  const viewOf = (t: HeliView): SimView => ({ helis: t, tick: 1, seats: 3 }) as unknown as SimView;

  it('an own helicopter that is shot down stays in the table as a wreck and is reported once; an enemy row coming and going is no news', () => {
    const w = new MissionWatcher();
    const flying = table([{ owner: 1, state: HELI_CRUISE, cx: 500 }, { owner: 2, state: HELI_CRUISE, cx: 510 }]);
    expect(w.update(viewOf(flying), 1, 0)).toBe(0);
    const enemyGone = table([{ owner: 1, state: HELI_CRUISE, cx: 501 }, { owner: 0, state: 0, cx: 0 }]);
    expect(w.update(viewOf(enemyGone), 2, 0)).toBe(0);
    const wreck = table([{ owner: 1, state: HELI_DOWNED, cx: 502 }, { owner: 2, state: HELI_UNLOAD, cx: 520 }]);
    expect(w.update(viewOf(wreck), 3, 0)).toBe(MISSION_LOST);
    expect(w.update(viewOf(wreck), 4, 0) & MISSION_LANDED).toBe(0);
    const rows = ownHeliRows(viewOf(wreck), 0, []);
    expect(rows.map((r) => r.id)).toEqual([0]);
  });
});
