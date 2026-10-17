// Ctx-1: the pure placement and keyboard-walk rules of the right-click menu (src/ui/contextMenuLayout.ts). The window sizes are the three the task names: 960x540, 1366x640 and 540x960.
import { describe, expect, it } from 'vitest';
import { moveFocus, placeMenu } from '../../src/ui/contextMenuLayout';

const WINDOWS: ReadonlyArray<readonly [number, number]> = [
  [960, 540],
  [1366, 640],
  [540, 960],
];
const M = 8;

describe('placeMenu keeps the box inside the window', () => {
  it('for every window, box size and pointer position the box lies inside the margins (a tall box is capped and scrolls)', () => {
    for (const [vw, vh] of WINDOWS) {
      for (const [w, h] of [[300, 200], [300, 560], [500, 900]] as const) {
        for (let x = 0; x <= vw; x += 53) {
          for (let y = 0; y <= vh; y += 41) {
            const p = placeMenu(x, y, w, h, vw, vh, M);
            const height = Math.min(h, p.maxHeight);
            expect(p.left, `${vw}x${vh} ${w}x${h} @${x},${y}`).toBeGreaterThanOrEqual(M);
            expect(p.top, `${vw}x${vh} ${w}x${h} @${x},${y}`).toBeGreaterThanOrEqual(M);
            expect(p.left + w, `${vw}x${vh} ${w}x${h} @${x},${y}`).toBeLessThanOrEqual(vw - M);
            expect(p.top + height, `${vw}x${vh} ${w}x${h} @${x},${y}`).toBeLessThanOrEqual(vh - M);
            expect(p.maxHeight).toBe(vh - 2 * M);
          }
        }
      }
    }
  });

  it('opens right of and below the pointer when it fits, flips left / up when it does not, and pushes back when neither side fits', () => {
    expect(placeMenu(100, 100, 300, 200, 960, 540, M)).toMatchObject({ left: 100, top: 100 });
    expect(placeMenu(900, 100, 300, 200, 960, 540, M)).toMatchObject({ left: 600, top: 100 }); // flipped to the left of the pointer
    expect(placeMenu(100, 500, 300, 200, 960, 540, M)).toMatchObject({ left: 100, top: 300 }); // flipped above
    expect(placeMenu(150, 300, 300, 600, 960, 540, M)).toMatchObject({ top: M, maxHeight: 524 }); // neither fits: pushed back (the box scrolls)
    expect(placeMenu(100, 100, 300, 200, 360, 540, M).left).toBe(52); // a narrow window: pushed back inside (360 - 8 - 300)
  });
});

describe('moveFocus', () => {
  it('Arrow keys walk and wrap, Home / End jump, other keys leave the index', () => {
    expect(moveFocus(4, -1, 'ArrowDown')).toBe(0);
    expect(moveFocus(4, -1, 'ArrowUp')).toBe(3);
    expect(moveFocus(4, 3, 'ArrowDown')).toBe(0);
    expect(moveFocus(4, 0, 'ArrowUp')).toBe(3);
    expect(moveFocus(4, 2, 'Home')).toBe(0);
    expect(moveFocus(4, 1, 'End')).toBe(3);
    expect(moveFocus(4, 1, 'x')).toBe(1);
    expect(moveFocus(0, -1, 'ArrowDown')).toBe(-1);
  });
});
