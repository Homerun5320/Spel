// M10: the placement mode on the input stack, driven with synthetic events and a fake target. Every behaviour of the acceptance has a case that fails when
// it is removed: the ghost follows the cursor with the sim's verdict, a click on a green ghost sends Build and leaves the mode (Shift keeps it), a click on
// a red one reports the reason and sends nothing, a right click and Escape leave it, and Escape does not call the pause handler while the mode is on.
import { afterEach, describe, expect, it } from 'vitest';
import { InputStack, createBaseMode, resetInputHandlers, setPauseHandler, type CameraInput, type InputMode, type InputTarget, type PointerInput } from '../../src/app/input';
import { createPlacementMode, type PlacementMode, type PlacementTarget } from '../../src/app/placement';
import { REJECT_BUILD_PEAK, REJECT_NONE, STRUCT_CITY } from '../../src/sim/public';

afterEach(() => resetInputHandlers());

const ptr = (x: number, y: number, extra: Partial<PointerInput> = {}): PointerInput => ({ id: 1, kind: 'mouse', x, y, button: 0, ctrlKey: false, shiftKey: false, ...extra });
const key = (k: string) => ({ key: k, ctrlKey: false, altKey: false, metaKey: false });

/** A rig with the REAL base mode (no dispatchClick shortcut): Shift + left press / release must reach the placement mode as a click. */
function realRig(): { r: Rig; rotated: number[]; baseClicks: number[] } {
  const rotated: number[] = [];
  const baseClicks: number[] = [];
  const camera: CameraInput = {
    dragStart: () => undefined,
    dragMove: () => undefined,
    dragEnd: () => undefined,
    rotateBy: () => rotated.push(1) && undefined,
    zoomAt: () => undefined,
    yawBy: () => undefined,
  };
  const target: InputTarget = {
    camera,
    now: () => 1,
    cancelFlight: () => undefined,
    click: () => baseClicks.push(1) && undefined,
    pickCell: () => null,
    hover: () => undefined,
    hoverEnd: () => undefined,
    focusCapital: () => undefined,
  };
  const stack = new InputStack(createBaseMode(target));
  const r = { stack, sent: [], refused: [], ghost: [], cleared: 0, ended: 0, verdict: new Map<number, number>() } as unknown as Rig;
  r.mode = createPlacementMode(STRUCT_CITY, {
    pickCell: (x, y) => y * 100 + x,
    validate: () => REJECT_NONE,
    send: (t, c) => r.sent.push([t, c]),
    setGhost: () => undefined,
    clearGhost: () => r.cleared++,
    refused: (reason) => r.refused.push(reason),
    exit: () => {
      if (stack.top === r.mode) stack.pop();
    },
    ended: () => r.ended++,
  });
  stack.push(r.mode);
  return { r, rotated, baseClicks };
}

interface Rig {
  stack: InputStack;
  mode: PlacementMode;
  sent: Array<[number, number]>;
  refused: number[];
  ghost: Array<[number, number, boolean]>;
  cleared: number;
  ended: number;
  /** The verdict per cell; cells not listed are free (REJECT_NONE). */
  verdict: Map<number, number>;
}

function rig(): Rig {
  const base: InputMode = { id: 'base' };
  const stack = new InputStack(base);
  const r = { stack, sent: [], refused: [], ghost: [], cleared: 0, ended: 0, verdict: new Map<number, number>() } as unknown as Rig;
  const target: PlacementTarget = {
    pickCell: (x, y) => (x < 0 ? null : y * 100 + x), // the cell is a function of the pixel
    validate: (_t, cell) => r.verdict.get(cell) ?? REJECT_NONE,
    send: (t, c) => r.sent.push([t, c]),
    setGhost: (t, c, ok) => r.ghost.push([t, c, ok]),
    clearGhost: () => r.cleared++,
    refused: (reason) => r.refused.push(reason),
    exit: () => {
      if (stack.top === r.mode) stack.pop();
    },
    ended: () => r.ended++,
  };
  r.mode = createPlacementMode(STRUCT_CITY, target);
  stack.push(r.mode);
  return r;
}

describe('the placement mode', () => {
  it('shows a ghost with the sim verdict under a moving cursor and clears it off the globe', () => {
    const r = rig();
    r.verdict.set(2 * 100 + 5, REJECT_BUILD_PEAK);
    r.stack.pointerMove(ptr(4, 1));
    r.stack.pointerMove(ptr(5, 2));
    expect(r.ghost).toEqual([
      [STRUCT_CITY, 104, true],
      [STRUCT_CITY, 205, false],
    ]);
    expect(r.mode.state()).toEqual({ type: STRUCT_CITY, cell: 205, ok: false, reason: REJECT_BUILD_PEAK });
    r.stack.pointerMove(ptr(-1, 1));
    expect(r.cleared).toBe(1);
    expect(r.mode.state().cell).toBe(-1);
  });

  it('a click on a green ghost sends Build for that cell and leaves the mode; Shift keeps it for another', () => {
    const r = rig();
    r.stack.dispatchClick(7, 3, ptr(7, 3));
    expect(r.sent).toEqual([[STRUCT_CITY, 307]]);
    expect(r.stack.depth).toBe(0);
    expect(r.ended).toBe(1);
    const s = rig();
    s.stack.dispatchClick(7, 3, ptr(7, 3, { shiftKey: true }));
    s.stack.dispatchClick(8, 3, ptr(8, 3, { shiftKey: true }));
    expect(s.sent).toEqual([
      [STRUCT_CITY, 307],
      [STRUCT_CITY, 308],
    ]);
    expect(s.stack.depth).toBe(1);
  });

  it('a click on a red ghost reports the reason, sends nothing and keeps the mode', () => {
    const r = rig();
    r.verdict.set(307, REJECT_BUILD_PEAK);
    expect(r.stack.dispatchClick(7, 3, ptr(7, 3))).toBe(true); // taken: the base would otherwise attack
    expect(r.refused).toEqual([REJECT_BUILD_PEAK]);
    expect(r.sent).toEqual([]);
    expect(r.stack.depth).toBe(1);
  });

  it('a right click leaves the mode, the key again toggles it off, and Escape pops it without calling the pause handler', () => {
    let paused = 0;
    setPauseHandler(() => paused++);
    const a = rig();
    expect(a.stack.dispatchContext({ x: 1, y: 1, cell: 101, lat: 0, lon: 0 })).toBe(true);
    expect(a.stack.depth).toBe(0);
    const b = rig();
    expect(b.stack.key(key('1'))).toBe(true);
    expect(b.stack.depth).toBe(0);
    const c = rig();
    expect(c.stack.key(key('Escape'))).toBe(true);
    expect(c.stack.depth).toBe(0);
    expect(c.ended).toBe(1);
    expect(paused).toBe(0);
    c.stack.key(key('Escape')); // an empty stack: the pause menu
    expect(paused).toBe(1);
  });

  it('a REAL Shift + left press and release places and keeps the mode (the base mode must not turn it into the rotate gesture)', () => {
    const { r, rotated, baseClicks } = realRig();
    for (const x of [7, 8]) {
      r.stack.pointerDown(ptr(x, 3, { shiftKey: true }));
      r.stack.pointerUp(ptr(x, 3, { shiftKey: true }));
    }
    expect(r.sent).toEqual([
      [STRUCT_CITY, 307],
      [STRUCT_CITY, 308],
    ]);
    expect(r.stack.depth).toBe(1);
    expect(rotated).toEqual([]);
    expect(baseClicks).toEqual([]);
    r.stack.pointerDown(ptr(9, 3)); // a plain click places the last one and leaves
    r.stack.pointerUp(ptr(9, 3));
    expect(r.sent.length).toBe(3);
    expect(r.stack.depth).toBe(0);
  });

  it('with the stack empty (no placement), Shift + drag still rotates', () => {
    const { r, rotated } = realRig();
    r.stack.pop();
    r.stack.pointerDown(ptr(5, 5, { shiftKey: true }));
    r.stack.pointerMove(ptr(9, 7, { shiftKey: true }));
    r.stack.pointerUp(ptr(9, 7, { shiftKey: true }));
    expect(rotated.length).toBe(1);
  });

  it('popping the mode clears the ghost, and a click off the globe sends nothing', () => {
    const r = rig();
    const before = r.cleared;
    r.stack.pop();
    expect(r.cleared).toBe(before + 1);
    const s = rig();
    expect(s.stack.dispatchClick(-1, 3, ptr(-1, 3))).toBe(true);
    expect(s.sent).toEqual([]);
    expect(s.refused).toEqual([]);
  });
});
