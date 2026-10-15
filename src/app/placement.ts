// The placement mode (M10): key 1 (the City; the other build keys follow with their models; the key of a type is its number) pushes this mode on the input stack. It shows a ghost on the
// cell under the cursor, green or red by `validateBuild` (the sim's own placement check on the snapshot), and a click on a green ghost sends the Build
// intent; the UI never changes the sim, and the sim validates again, so the ghost is guidance only. A click on a red ghost shows a toast with the
// reason's text key. Shift + click places several, Escape (handled by the stack) or a right click leaves the mode.
//
// Pure TypeScript over a small target interface, so the unit tests drive it with synthetic events.
import type { InputMode, KeyInput, PointerInput } from './input';

export interface PlacementTarget {
  /** The sim cell of the ground under a pixel, or null when the ray misses the globe. */
  pickCell(x: number, y: number): number | null;
  /** The sim's placement check for the local seat: REJECT_NONE (0) or the reason. */
  validate(type: number, cell: number): number;
  /** Sends the Build intent. */
  send(type: number, cell: number): void;
  setGhost(type: number, cell: number, ok: boolean): void;
  clearGhost(): void;
  /** A click on a red ghost. */
  refused(reason: number): void;
  /** Leaves the mode (the page pops it off the stack). */
  exit(): void;
  /** The mode ended (popped by Escape, a right click, a click or the page): the UI forgets the chosen type. */
  ended(): void;
}

/** What the mode shows right now (tests, the props hook). */
export interface PlacementState {
  readonly type: number;
  /** The cell under the ghost, -1 = no ghost. */
  readonly cell: number;
  readonly ok: boolean;
  readonly reason: number;
}

export interface PlacementMode extends InputMode {
  state(): PlacementState;
}

export function createPlacementMode(type: number, target: PlacementTarget): PlacementMode {
  let px = -1;
  let py = -1;
  let cell = -1;
  let reason = 0;
  let known = false;

  const refresh = (): void => {
    if (!known) return;
    const c = target.pickCell(px, py);
    if (c === null) {
      cell = -1;
      reason = 0;
      target.clearGhost();
      return;
    }
    cell = c;
    reason = target.validate(type, c);
    target.setGhost(type, c, reason === 0);
  };

  return {
    id: `placement:${type}`,
    state: () => ({ type, cell, ok: cell >= 0 && reason === 0, reason }),
    onPop(): void {
      target.clearGhost();
      cell = -1;
      target.ended();
    },
    pointerMove(e: PointerInput): boolean {
      if (e.kind !== 'mouse') return false;
      px = e.x;
      py = e.y;
      known = true;
      refresh();
      return true; // no hover tooltip while placing
    },
    // the ghost follows the camera too (a drag, a wheel notch, a flight moves the ground under a resting cursor)
    tick(): void {
      refresh();
    },
    click(x: number, y: number, e: PointerInput): boolean {
      px = x;
      py = y;
      known = true;
      refresh();
      if (cell < 0) return true;
      if (reason !== 0) {
        target.refused(reason);
        return true;
      }
      target.send(type, cell);
      if (!e.shiftKey) target.exit();
      return true;
    },
    context(): boolean {
      target.exit();
      return true;
    },
    longPress(): boolean {
      return false; // a long press is a context command: it leaves the mode
    },
    key(e: KeyInput): boolean {
      if (e.key === String(type) && e.repeat !== true) {
        target.exit();
        return true;
      }
      return false;
    },
  };
}
