// Fix-3A2: the LOS cache behaviours no other test locked (mutation audit 2, finding 5) and the memo of `sync`. Each "kills:" comment names
// the mutant (one changed line in src/sim/los/cache.ts) that turns the test red; the table is in docs/DECISIONS.md (Fix-3A2).
import { describe, expect, it } from 'vitest';
import { rowCosFromLut } from '../../src/sim/grid';
import { ALT_MODE_HIGH, ALT_MODE_LOW, EXPOSED_DETECTED, EXPOSED_NONE, EXPOSED_POST, createLos, type LosSource } from '../../src/sim/los/cache';
import { exposure, fireControlExposed } from '../../src/sim/los/exposure';
import { createLosTerrain, type LosTerrain } from '../../src/sim/los/terrain';
import { POST_RADIUS_CELLS, SAM_MOUNTAIN_PCT, SAM_RADIUS_BASE_CELLS } from '../../src/sim/rules';
import { createEmptyState, type GameState } from '../../src/sim/state';
import { STRUCT_CITY, STRUCT_POST, STRUCT_SAM } from '../../src/sim/structureRules';
import { CLASS_MOUNTAIN } from '../../src/sim/terrain';

const W = 128;
const H = 64;
const at = (x: number, y: number): number => y * W + x;

function world(mean: (x: number, y: number) => number): LosTerrain {
  const m = new Int16Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) m[y * W + x] = mean(x, y);
  return createLosTerrain(W, H, rowCosFromLut(H), m, m);
}
const flat = (): LosTerrain => world(() => 1);
const wallWorld = (): LosTerrain => world((x, y) => (x === 48 && y >= 22 && y <= 42 ? 3000 : 1));

function source(state: GameState, tick = 1000): LosSource & { tick: number } {
  return { tick, structures: state.structures, terrainClass: state.terrain };
}

describe('the mask cache key and the signature', () => {
  it('a SAM upgraded in place gets a NEW mask of the larger radius, and its new rim is covered', () => {
    // kills: los-c-mk-radius (mask key without the radius: the old, smaller mask is reused and read with the new row length)
    const state = createEmptyState(W, H, 1, 3);
    const los = createLos(flat());
    const src = source(state);
    const id = state.structures.add(STRUCT_SAM, 1, at(60, 30), 0);
    expect(exposure(los, src, 0, at(60 + 24, 30), ALT_MODE_HIGH)).toBe(EXPOSED_DETECTED);
    expect(los.maskBuilds).toBe(1);
    state.structures.level[id] = 2; // radius 24 -> 26
    los.invalidate();
    expect(exposure(los, src, 0, at(60 + 26, 30), ALT_MODE_HIGH)).toBe(EXPOSED_DETECTED);
    expect(exposure(los, src, 0, at(60, 30 + 26), ALT_MODE_HIGH)).toBe(EXPOSED_DETECTED);
    expect(exposure(los, src, 0, at(60 + 27, 30), ALT_MODE_HIGH)).toBe(EXPOSED_NONE);
    expect(los.maskBuilds).toBe(2);
  });

  it('a SAM on a Mountain cell has the mountain radius (SAM_MOUNTAIN_PCT percent)', () => {
    // kills: los-c-mountain (the signature ignores CLASS_MOUNTAIN)
    const state = createEmptyState(W, H, 1, 3);
    state.terrain[at(60, 30)] = CLASS_MOUNTAIN;
    const los = createLos(flat());
    const src = source(state);
    state.structures.add(STRUCT_SAM, 1, at(60, 30), 0);
    const r = Math.floor((SAM_RADIUS_BASE_CELLS * SAM_MOUNTAIN_PCT) / 100);
    expect(r).toBeGreaterThan(SAM_RADIUS_BASE_CELLS);
    expect(exposure(los, src, 0, at(60 + r, 30), ALT_MODE_HIGH)).toBe(EXPOSED_DETECTED);
    expect(exposure(los, src, 0, at(60 + r + 1, 30), ALT_MODE_HIGH)).toBe(EXPOSED_NONE);
  });
});

describe('composite and wrap', () => {
  it('the sites of one owner are a union: a cell hidden from one site but seen by another is detected', () => {
    // kills: los-c-composite-max (the composite keeps the larger mask value)
    const t = wallWorld();
    const los = createLos(t);
    const state = createEmptyState(W, H, 1, 2);
    los.addSite(1, at(40, 32), 24); // the wall at x = 48 hides (58, 32) from this one
    los.sync(source(state));
    expect(los.detected(1, at(58, 32), ALT_MODE_LOW)).toBe(false);
    los.addSite(1, at(70, 32), 24); // a clear view of (58, 32)
    los.sync(source(state));
    expect(los.detected(1, at(58, 32), ALT_MODE_LOW)).toBe(true);
    expect(los.detected(1, at(52, 32), ALT_MODE_LOW)).toBe(true);
  });

  it('a Defense Post covers across the date line', () => {
    // kills: los-c-post-wrap (delete 'if (dx > w - dx) dx = w - dx;' in inPostRadius)
    const state = createEmptyState(W, H, 1, 2);
    state.structures.add(STRUCT_POST, 1, at(2, 30), 0);
    const los = createLos(flat());
    const src = source(state);
    const across = at(W - (POST_RADIUS_CELLS - 4), 30); // 2 + 12 - 4 cells west of the seam: distance 10 over the seam
    expect(exposure(los, src, 0, across, ALT_MODE_LOW)).toBe(EXPOSED_POST);
    expect(exposure(los, src, 0, at(W - (POST_RADIUS_CELLS + 4), 30), ALT_MODE_LOW)).toBe(EXPOSED_NONE);
  });

  it('fire control of one site wraps over the date line; High ignores the mask, Low does not', () => {
    // kills: los-c-fire-wrap (delete the two-line wrap in fireControl), los-c-fire-high (High goes through the mask)
    const state = createEmptyState(W, H, 1, 2);
    const los = createLos(world((x, y) => (x === 4 && y >= 20 && y <= 40 ? 3000 : 1)));
    const src = source(state);
    const h = los.addSite(1, at(2, 30), 24);
    expect(fireControlExposed(los, src, h, at(W - 8, 30), ALT_MODE_LOW)).toBe(true); // 10 cells over the seam
    expect(fireControlExposed(los, src, h, at(W - 8, 30), ALT_MODE_HIGH)).toBe(true);
    expect(fireControlExposed(los, src, h, at(W - 40, 30), ALT_MODE_HIGH)).toBe(false); // out of range
    expect(fireControlExposed(los, src, h, at(14, 30), ALT_MODE_LOW)).toBe(false); // behind the wall at x = 4
    expect(fireControlExposed(los, src, h, at(14, 30), ALT_MODE_HIGH)).toBe(true);
  });
});

describe('the memo of sync (Fix-3A2)', () => {
  it('an unchanged table at an unchanged tick is scanned once; a new tick, a new structure, an added site and invalidate() each scan again', () => {
    // kills: los-memo-none (every call scans), los-memo-no-liveCount, los-memo-no-extra
    const state = createEmptyState(W, H, 1, 3);
    const los = createLos(flat());
    const src = source(state);
    const sam = state.structures.add(STRUCT_SAM, 1, at(60, 30), 0);
    for (let i = 0; i < 50; i++) exposure(los, src, 0, at(60, 40), ALT_MODE_LOW);
    expect(los.syncScans).toBe(1);
    src.tick++;
    exposure(los, src, 0, at(60, 40), ALT_MODE_LOW);
    expect(los.syncScans).toBe(2);
    state.structures.add(STRUCT_CITY, 1, at(10, 10), 0);
    exposure(los, src, 0, at(60, 40), ALT_MODE_LOW);
    expect(los.syncScans).toBe(3);
    los.addSite(2, at(100, 30), 10);
    exposure(los, src, 0, at(60, 40), ALT_MODE_LOW);
    expect(los.syncScans).toBe(4);
    state.structures.remove(sam); // the high-water mark stays, only the live count falls
    expect(exposure(los, src, 0, at(60, 40), ALT_MODE_LOW)).toBe(EXPOSED_NONE);
    expect(los.syncScans).toBe(5);
    los.invalidate();
    exposure(los, src, 0, at(60, 40), ALT_MODE_LOW);
    expect(los.syncScans).toBe(6);
    exposure(los, src, 0, at(60, 40), ALT_MODE_LOW);
    expect(los.syncScans).toBe(6);
  });

  it('a SAM that finishes building as the tick passes its ready tick starts to cover although the table did not change', () => {
    // kills: los-memo-no-tick (the memo ignores the tick)
    const state = createEmptyState(W, H, 1, 3);
    const los = createLos(flat());
    const src = source(state, 100);
    state.structures.add(STRUCT_SAM, 1, at(60, 30), 500);
    expect(exposure(los, src, 0, at(60, 40), ALT_MODE_LOW)).toBe(EXPOSED_NONE);
    src.tick = 900;
    expect(exposure(los, src, 0, at(60, 40), ALT_MODE_LOW)).toBe(EXPOSED_DETECTED);
  });

  it('another table object at the same tick is not served from the memo', () => {
    // kills: los-memo-no-table (the memo compares only tick and counters)
    const a = createEmptyState(W, H, 1, 3);
    const b = createEmptyState(W, H, 1, 3);
    a.structures.add(STRUCT_SAM, 1, at(60, 30), 0);
    b.structures.add(STRUCT_SAM, 1, at(90, 30), 0);
    const los = createLos(flat());
    expect(exposure(los, source(a), 0, at(60, 40), ALT_MODE_LOW)).toBe(EXPOSED_DETECTED);
    expect(exposure(los, source(b), 0, at(60, 40), ALT_MODE_LOW)).toBe(EXPOSED_NONE);
  });
});
