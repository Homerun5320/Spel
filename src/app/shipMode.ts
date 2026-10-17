// The ship mode (M13c-2): an input mode on the stack while the player picks the coast cell a ship of the selected Port should land at (the pattern of the deploy mode, M13b). Escape
// pops it (the stack does that), a RIGHT click leaves it, a left click PICKS the cell under the cursor (the page then shows the route, the marker and the verdict, and the box's
// Send button sends LaunchShip). The mode holds no rule: the page asks the sim's own check (src/app/shipPreview.ts). Pure TypeScript over a small target interface.
import type { ContextCommand, InputMode, PointerInput } from './input';

export interface ShipTarget {
  /** The sim cell of the ground under a pixel, or null when the ray misses the globe. */
  pickCell(x: number, y: number): number | null;
  /** The cell under the cursor changed (null = off the globe, or the mode ended). */
  hover(cell: number | null): void;
  /** A left click on a cell: the page pins it as the target. */
  pin(cell: number): void;
  /** Leaves the mode (the page pops it off the stack). */
  exit(): void;
  /** The mode ended (Escape, the page, a sent launch): the page clears the marker and the route. */
  ended(): void;
  /** Whether the camera moved since the last time this was asked (true the first time); optional like the deploy mode's. */
  cameraMoved?(): boolean;
}

export interface ShipModeState {
  /** The hovered cell, -1 = none. */
  readonly cell: number;
  readonly port: number;
}

export interface ShipMode extends InputMode {
  state(): ShipModeState;
}

export function createShipMode(port: number, target: ShipTarget): ShipMode {
  let px = -1;
  let py = -1;
  let known = false;
  let cell = -1;

  const refresh = (): void => {
    if (!known) return;
    const c = target.pickCell(px, py);
    const next = c === null ? -1 : c;
    if (next === cell) return;
    cell = next;
    target.hover(c);
  };

  return {
    id: `ship:${port}`,
    state: () => ({ cell, port }),
    onPop(): void {
      cell = -1;
      target.hover(null);
      target.ended();
    },
    pointerMove(e: PointerInput): boolean {
      if (e.kind !== 'mouse') return false;
      px = e.x;
      py = e.y;
      known = true;
      refresh();
      return true; // no hover tooltip while choosing a coast
    },
    tick(): void {
      if (!known) return;
      if (target.cameraMoved !== undefined && !target.cameraMoved()) return;
      refresh();
    },
    click(x: number, y: number): boolean {
      px = x;
      py = y;
      known = true;
      const c = target.pickCell(x, y);
      if (c !== null) target.pin(c);
      return true;
    },
    context(_command: ContextCommand): boolean {
      target.exit(); // a right click cancels
      return true;
    },
    longPress(): boolean {
      return false;
    },
  };
}
