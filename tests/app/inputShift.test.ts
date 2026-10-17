// Fix-3B (mutation audit 11): the gating of Shift + left click in the base mode. Shift + left drag turns the camera (the old rule) EXCEPT while the topmost
// mode on the stack wants the Shift click (the placement and selection modes), and then only for the left button without Ctrl: it pans like a plain drag.
import { beforeAll, describe, expect, it } from 'vitest';
import { InputStack, createBaseMode, type InputMode, type InputTarget, type PointerInput } from '../../src/app/input';
import { loadRtsWorld, makeRtsRig, type RtsWorld } from '../helpers/rtsRig';

let w: RtsWorld;
beforeAll(async () => {
  w = await loadRtsWorld();
});

const mouse = (x: number, y: number, extra: Partial<PointerInput> = {}): PointerInput => ({ id: 1, kind: 'mouse', x, y, button: 0, ctrlKey: false, shiftKey: false, ...extra });

/** Drags 50 px sideways with `down` held and returns how far the heading turned. */
function headingTurn(mode: InputMode | null, down: Partial<PointerInput>): number {
  const rig = makeRtsRig(w, { lat: 46.5, lon: 8, heading: 0, tilt: 50 }, 15_000);
  const target: InputTarget = {
    camera: rig,
    now: () => 1,
    cancelFlight: () => undefined,
    click: () => undefined,
    pickCell: () => null,
    hover: () => undefined,
    hoverEnd: () => undefined,
    focusCapital: () => undefined,
  };
  const stack = new InputStack(createBaseMode(target));
  if (mode !== null) stack.push(mode);
  rig.update(1);
  const start = rig.view.heading;
  stack.pointerDown(mouse(480, 270, down));
  stack.pointerMove(mouse(530, 270, down));
  stack.pointerUp(mouse(530, 270, down));
  return Math.abs(rig.view.heading - start);
}

const passive = (wantsShiftClick: boolean): InputMode => ({ id: 'test', wantsShiftClick });

describe('Shift + left drag in the base mode', () => {
  it('turns the camera with no mode on the stack and with a mode that does not want the Shift click', () => {
    expect(headingTurn(null, { shiftKey: true })).toBeGreaterThan(10);
    expect(headingTurn(passive(false), { shiftKey: true })).toBeGreaterThan(10);
  });

  it('pans (no turn) when the topmost mode wants the Shift click, but still turns with Ctrl held', () => {
    expect(headingTurn(passive(true), { shiftKey: true })).toBeLessThan(0.5);
    expect(headingTurn(passive(true), { shiftKey: true, ctrlKey: true })).toBeGreaterThan(10);
  });

  it('the right and the middle button turn the camera even with Shift under a mode that wants the Shift click', () => {
    expect(headingTurn(passive(true), { shiftKey: true, button: 2 })).toBeGreaterThan(10);
    expect(headingTurn(passive(true), { shiftKey: true, button: 1 })).toBeGreaterThan(10);
  });
});
