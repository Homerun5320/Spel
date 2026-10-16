// M11a: the line-of-sight mask, the composite and the exposure queries on SYNTHETIC worlds (the real-data measurement is losReal.test.ts).
import { describe, expect, it } from 'vitest';
import { rowCosFromLut } from '../../src/sim/grid';
import { ALT_MODE_HIGH, ALT_MODE_LOW, EXPOSED_DETECTED, EXPOSED_NONE, EXPOSED_POST, createLos, type Los, type LosSource } from '../../src/sim/los/cache';
import { exposure, fireControlExposed } from '../../src/sim/los/exposure';
import { MASK_NONE, buildMask, maskSide } from '../../src/sim/los/mask';
import { createLosTerrain, type LosTerrain } from '../../src/sim/los/terrain';
import { ALT_LOW_AGL_M, GAMEPLAY_HEIGHT_EXAG, LOS_TILE_CELLS, POST_RADIUS_CELLS, SAM_RADIUS_BASE_CELLS } from '../../src/sim/rules';
import { createEmptyState, type GameState } from '../../src/sim/state';
import { STRUCT_POST, STRUCT_SAM } from '../../src/sim/structureRules';
import { exactVisible } from './helpers/losOracle';

const W = 128;
const H = 64;

function world(mean: (x: number, y: number) => number, max?: (x: number, y: number) => number): LosTerrain {
  const m = new Int16Array(W * H);
  const mx = new Int16Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      m[y * W + x] = mean(x, y);
      mx[y * W + x] = max ? max(x, y) : mean(x, y);
    }
  return createLosTerrain(W, H, rowCosFromLut(H), m, mx);
}

const flat = (): LosTerrain => world(() => 1);
const at = (x: number, y: number): number => y * W + x;

function source(state: GameState, tick = 1000): LosSource {
  return { tick, structures: state.structures, terrainClass: state.terrain };
}

describe('M11a mask on synthetic terrain', () => {
  it('a 3000 m wall hides the cells behind it from Low but not from High; cells beside it stay visible', () => {
    const t = world((x, y) => (x === 48 && y >= 22 && y <= 42 ? 3000 : 1));
    const los = createLos(t);
    const site = at(40, 32);
    los.addSite(1, site, 24);
    const state = createEmptyState(W, H, 1, 2);
    const src = source(state);
    los.sync(src);
    for (const [x, y] of [[60, 32], [56, 30], [58, 34], [52, 32]] as const) {
      expect(los.detected(1, at(x, y), ALT_MODE_LOW), `behind ${x},${y}`).toBe(false);
      expect(los.detected(1, at(x, y), ALT_MODE_HIGH), `High ${x},${y}`).toBe(true);
      expect(exactVisible(t, site, at(x, y), (t.groundGm[at(x, y)] as number) + ALT_LOW_AGL_M)).toBe(false);
    }
    for (const [x, y] of [[44, 50], [36, 32], [40, 12], [47, 18], [52, 48]] as const) expect(los.detected(1, at(x, y), ALT_MODE_LOW), `beside ${x},${y}`).toBe(true);
  });

  it('range: nothing beyond the radius is covered, the site cell is covered, and the mask of a flat world is zero-ish', () => {
    const t = flat();
    const m = buildMask(t, at(40, 32), 24);
    const side = maskSide(24);
    expect(m[24 * side + 24]).toBe(0);
    expect(m[(24 + 24) * side + 24]).toBe(0); // the flat edge cell at exactly R is covered and sees down to the ground
    expect(m[(24 + 20) * side + (24 + 20)]).toBe(MASK_NONE); // distance 28.3 > 24
    expect(m[(24 + 10) * side + (24 + 10)]).not.toBe(MASK_NONE);
  });

  it('a Defense Post makes cells within POST_RADIUS_CELLS exposed in both modes; a SAM beyond its radius gives nothing', () => {
    const state = createEmptyState(W, H, 1, 3);
    state.structures.add(STRUCT_POST, 1, at(30, 30), 0);
    state.structures.add(STRUCT_SAM, 2, at(100, 30), 0);
    const los = createLos(flat());
    const src = source(state);
    expect(exposure(los, src, 0, at(30 + POST_RADIUS_CELLS, 30), ALT_MODE_LOW)).toBe(EXPOSED_POST);
    expect(exposure(los, src, 0, at(30 + POST_RADIUS_CELLS, 30), ALT_MODE_HIGH)).toBe(EXPOSED_POST);
    expect(exposure(los, src, 0, at(30 + POST_RADIUS_CELLS + 1, 30), ALT_MODE_HIGH)).toBe(EXPOSED_NONE);
    // seat 1 owns the SAM at x=100: inside 24 it sees Low on flat ground, one cell beyond it sees nothing
    expect(exposure(los, src, 1, at(100 - SAM_RADIUS_BASE_CELLS, 30), ALT_MODE_LOW)).toBe(EXPOSED_DETECTED);
    expect(exposure(los, src, 1, at(100 - SAM_RADIUS_BASE_CELLS - 1, 30), ALT_MODE_LOW)).toBe(EXPOSED_NONE);
    expect(exposure(los, src, 1, at(100 - SAM_RADIUS_BASE_CELLS - 1, 30), ALT_MODE_HIGH)).toBe(EXPOSED_NONE);
    // the SAM's owner is not exposed to the Post of the other seat's coverage
    expect(exposure(los, src, 2, at(100, 30), ALT_MODE_LOW)).toBe(EXPOSED_NONE);
  });

  it('wrap: a site next to x=0 sees exactly as many cells as the same site on a map shifted around the world', () => {
    const hills = (x: number, y: number): number => 1 + ((Math.imul(x * 7 + 3, 2654435761) ^ Math.imul(y * 13 + 5, 40503)) >>> 0) % 40;
    const a = world(hills, (x, y) => hills(x, y) + (((x * 31 + y * 17) >>> 0) % 25));
    const shift = 61;
    const b = world((x, y) => hills((x - shift + W) % W, y), (x, y) => hills((x - shift + W) % W, y) + ((((x - shift + W) % W) * 31 + y * 17) % 25));
    const count = (t: LosTerrain, sx: number): number => {
      const los = createLos(t);
      los.addSite(1, at(sx, 30), 24);
      const state = createEmptyState(W, H, 1, 2);
      los.sync(source(state));
      let n = 0;
      for (let c = 0; c < W * H; c++) if (los.detected(1, c, ALT_MODE_LOW)) n++;
      return n;
    };
    const near0 = count(a, 2);
    expect(near0).toBeGreaterThan(15);
    expect(count(b, 2 + shift)).toBe(near0);
    expect(count(a, 126)).toBe(count(b, 126 + shift - W));
  });

  it('lazy rebuild: queries without a change build nothing; build, upgrade, conquest and delete rebuild once each', () => {
    const state = createEmptyState(W, H, 1, 3);
    const los = createLos(flat());
    const src = source(state, 1000);
    const id = state.structures.add(STRUCT_SAM, 1, at(40, 30), 0);
    expect(exposure(los, src, 0, at(40, 40), ALT_MODE_LOW)).toBe(EXPOSED_DETECTED);
    expect([los.maskBuilds, los.compositeBuilds]).toEqual([1, 1]);
    for (let i = 0; i < 20; i++) exposure(los, src, 0, at(41, 41), ALT_MODE_LOW);
    expect([los.maskBuilds, los.compositeBuilds]).toEqual([1, 1]);
    // upgrade: radius 24 -> 26, a cell at 25 becomes covered
    expect(exposure(los, src, 0, at(40 + 25, 30), ALT_MODE_HIGH)).toBe(EXPOSED_NONE);
    state.structures.level[id] = 2;
    los.invalidate(); // Fix-3A2: sync is memoised per (table, tick, counters); a hand edit inside one tick says so (the sim itself only edits between ticks)
    expect(exposure(los, src, 0, at(40 + 25, 30), ALT_MODE_HIGH)).toBe(EXPOSED_DETECTED);
    expect(los.compositeBuilds).toBe(2);
    // conquest: the owner changes, the coverage moves to the other seat
    state.structures.transfer(id, 2, 1);
    los.invalidate();
    expect(exposure(los, src, 0, at(40, 40), ALT_MODE_LOW)).toBe(EXPOSED_NONE);
    expect(exposure(los, src, 1, at(40, 40), ALT_MODE_LOW)).toBe(EXPOSED_DETECTED);
    // delete: the coverage is gone
    state.structures.remove(id);
    expect(exposure(los, src, 1, at(40, 40), ALT_MODE_LOW)).toBe(EXPOSED_NONE);
    const builds = los.compositeBuilds;
    exposure(los, src, 1, at(40, 40), ALT_MODE_LOW);
    expect(los.compositeBuilds).toBe(builds);
  });

  it('an unfinished SAM does not cover; fire control uses the one site, not the union', () => {
    const state = createEmptyState(W, H, 1, 3);
    const los = createLos(flat());
    const id = state.structures.add(STRUCT_SAM, 1, at(40, 30), 500);
    expect(exposure(los, source(state, 100), 0, at(40, 40), ALT_MODE_LOW)).toBe(EXPOSED_NONE);
    expect(exposure(los, source(state, 900), 0, at(40, 40), ALT_MODE_LOW)).toBe(EXPOSED_DETECTED);
    const other = state.structures.add(STRUCT_SAM, 1, at(80, 30), 0);
    const src = source(state, 900);
    expect(exposure(los, src, 0, at(80, 40), ALT_MODE_LOW)).toBe(EXPOSED_DETECTED); // the union reaches it
    expect(fireControlExposed(los, src, id, at(80, 40), ALT_MODE_LOW)).toBe(false); // the first site alone does not
    expect(fireControlExposed(los, src, other, at(80, 40), ALT_MODE_LOW)).toBe(true);
  });

  it('a site at R=24 allocates at most 4 composite tiles (exactly 1 inside one tile, 4 on a tile corner)', () => {
    const S = 256;
    const t = createLosTerrain(S, S, rowCosFromLut(S), new Int16Array(S * S).fill(1), new Int16Array(S * S).fill(1));
    const state = createEmptyState(S, S, 1, 2);
    const one = createLos(t);
    one.addSite(1, 32 * S + 32, 24);
    one.sync(source(state));
    expect(one.tileCount(1)).toBe(1);
    const corner = createLos(t);
    corner.addSite(1, (LOS_TILE_CELLS - 1) * S + LOS_TILE_CELLS, 24);
    corner.sync(source(state));
    expect(corner.tileCount(1)).toBeLessThanOrEqual(4);
    expect(corner.tileCount(1)).toBe(4);
  });

  it('the exaggeration is real: the same hill hides a Low aircraft only because heights are in game metres', () => {
    const t = world((x) => (x === 48 ? 150 : 1)); // a 150 m real ridge: 1200 game metres
    expect(t.occGm[at(48, 5)]).toBe(GAMEPLAY_HEIGHT_EXAG * 150);
    const los = createLos(t);
    los.addSite(1, at(40, 5), 24);
    los.sync(source(createEmptyState(W, H, 1, 2)));
    expect(los.detected(1, at(56, 5), ALT_MODE_LOW)).toBe(false);
  });
});

export type { Los };
