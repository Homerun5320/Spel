// The pure parts of the match UI: click versus drag, the game keys, interpolated HUD values and the click target rule.
import { describe, expect, it } from 'vitest';
import { resolveClickCell } from '../../src/app/clickTarget';
import { matchKeyAction, type KeyLike } from '../../src/app/matchKeys';
import { ClickTracker } from '../../src/ui/clickTracker';
import { StatInterpolator } from '../../src/ui/hudValues';
import { CLICK_MOVE_PX, COMMIT_DEFAULT_PCT, COMMIT_MAX_PCT, COMMIT_MIN_PCT, COMMIT_STEP_PCT } from '../../src/ui/uiConfig';
import { statIndex, statsLength } from '../../src/sim/view';
import { CLASS_DEEP_SEA, CLASS_PEAK, CLASS_PLAINS } from '../../src/sim/terrain';

describe('ClickTracker: a short click spawns or attacks, a drag rotates', () => {
  it('a press that stays within the threshold is a click; one that leaves it is a drag even if it comes back', () => {
    const t = new ClickTracker();
    t.down(100, 100);
    t.move(100 + CLICK_MOVE_PX - 1, 100);
    expect(t.up(102, 101)).toBe(true);
    t.down(100, 100);
    t.move(100 + CLICK_MOVE_PX + 1, 100);
    expect(t.isDragging).toBe(true);
    t.move(100, 100);
    expect(t.up(100, 100)).toBe(false);
  });

  it('a release without a press is no click, and the threshold is about a few pixels', () => {
    const t = new ClickTracker();
    expect(t.up(5, 5)).toBe(false);
    expect(CLICK_MOVE_PX).toBeGreaterThanOrEqual(3);
    expect(CLICK_MOVE_PX).toBeLessThanOrEqual(10);
    t.down(0, 0);
    t.cancel();
    expect(t.up(0, 0)).toBe(false);
  });
});

const key = (k: string, extra: Partial<KeyLike> = {}): KeyLike => ({ key: k, ctrlKey: false, altKey: false, metaKey: false, ...extra });

describe('matchKeyAction', () => {
  it('maps [ ] space , . and the aliases - + (a Swedish keyboard needs AltGr for the brackets)', () => {
    expect(matchKeyAction(key('['))).toBe('commit-down');
    expect(matchKeyAction(key(']'))).toBe('commit-up');
    expect(matchKeyAction(key('-'))).toBe('commit-down');
    expect(matchKeyAction(key('+'))).toBe('commit-up');
    expect(matchKeyAction(key(' '))).toBe('pause');
    expect(matchKeyAction(key(','))).toBe('slower');
    expect(matchKeyAction(key('.'))).toBe('faster');
    expect(matchKeyAction(key('a'))).toBeNull();
    expect(matchKeyAction(key('F3'))).toBeNull();
  });

  it('AltGr (reported as ctrl + alt) works, a plain ctrl or meta shortcut does not, a held space does not repeat, a text field keeps its keys', () => {
    expect(matchKeyAction(key('[', { ctrlKey: true, altKey: true }))).toBe('commit-down');
    expect(matchKeyAction(key('[', { ctrlKey: true }))).toBeNull();
    expect(matchKeyAction(key('.', { metaKey: true }))).toBeNull();
    expect(matchKeyAction(key(' ', { repeat: true }))).toBeNull();
    expect(matchKeyAction(key(' ', { targetTag: 'INPUT', targetType: 'text' }))).toBeNull();
    expect(matchKeyAction(key('.', { targetTag: 'TEXTAREA' }))).toBeNull();
    expect(matchKeyAction(key('[', { targetTag: 'INPUT', targetType: 'range' }))).toBe('commit-down'); // a slider is not typing
    expect(matchKeyAction(key(' ', { targetTag: 'BUTTON' }))).toBe('pause');
  });
});

describe('commitment constants', () => {
  it('run 5 to 100 percent in steps of 5 with 40 as the default', () => {
    expect([COMMIT_MIN_PCT, COMMIT_MAX_PCT, COMMIT_STEP_PCT, COMMIT_DEFAULT_PCT]).toEqual([5, 100, 5, 40]);
    expect((COMMIT_DEFAULT_PCT - COMMIT_MIN_PCT) % COMMIT_STEP_PCT).toBe(0);
  });
});

describe('StatInterpolator', () => {
  it('returns the previous value at alpha 0, the current at 1, the midpoint between, and clamps', () => {
    const seats = 2;
    const packed = new Uint32Array(statsLength(seats));
    const it = new StatInterpolator(seats);
    packed[statIndex('troopsQt', seats, 0)] = 1000;
    it.push(packed);
    packed[statIndex('troopsQt', seats, 0)] = 1400;
    it.push(packed);
    expect(it.value('troopsQt', 0, 0)).toBe(1000);
    expect(it.value('troopsQt', 0, 0.5)).toBe(1200);
    expect(it.value('troopsQt', 0, 1)).toBe(1400);
    expect(it.value('troopsQt', 0, 5)).toBe(1400);
    expect(it.value('troopsQt', 0, -1)).toBe(1000);
    expect(it.current('troopsQt', 0)).toBe(1400);
    expect(it.value('goldMilli', 1, 0.5)).toBe(0);
  });

  it('the first push fills both, so nothing slides in from zero', () => {
    const it = new StatInterpolator(1);
    const p = new Uint32Array(statsLength(1));
    p[statIndex('goldMilli', 1, 0)] = 500000;
    it.push(p);
    expect(it.value('goldMilli', 0, 0)).toBe(500000);
  });
});

describe('resolveClickCell', () => {
  const W = 8;
  const H = 4;
  const terrain = new Uint8Array(W * H).fill(CLASS_DEEP_SEA);
  terrain[1 * W + 3] = CLASS_PLAINS; // one land cell at (3, 1)
  terrain[2 * W + 6] = CLASS_PEAK;
  const pick = (x: number, y: number, elevationM: number, lat = 0, lon = 0) => ({ lat, lon, heightM: 0, elevationM, cell: { x, y, index: y * W + x }, classId: 0, countryId: 0 });

  it('keeps the cell when it is playable, or when the pick is sea', () => {
    expect(resolveClickCell(pick(3, 1, 100), terrain, W, H)).toBe(1 * W + 3);
    expect(resolveClickCell(pick(0, 0, -100), terrain, W, H)).toBe(0);
  });

  it('moves a coastal land pick in a water cell to the playable neighbour, never to a Peak, and wraps around the antimeridian', () => {
    // a render-land pixel (elevation > 0) in the water cell (4, 1): the land cell (3, 1) is the nearest playable one
    expect(resolveClickCell(pick(4, 1, 20, 90 - ((1 + 0.5) / H) * 180, ((4 + 0.5) / W) * 360 - 180), terrain, W, H)).toBe(1 * W + 3);
    // next to the Peak only: nothing playable near, stays on the picked cell
    expect(resolveClickCell(pick(5, 2, 20, 0, 0), terrain, W, H)).toBe(2 * W + 5);
    const wrap = new Uint8Array(W * H).fill(CLASS_DEEP_SEA);
    wrap[1 * W + 7] = CLASS_PLAINS;
    expect(resolveClickCell(pick(0, 1, 20, 90 - ((1 + 0.5) / H) * 180, -180 + 0.01), wrap, W, H)).toBe(1 * W + 7);
  });
});
