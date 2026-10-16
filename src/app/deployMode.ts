// The deploy mode (M13b): an input mode on the stack while the player picks a landing zone for a helicopter of the selected Factory. Escape pops it (the stack
// does that), a left or a right click on a valid zone sends LaunchHeli and leaves the mode, a click on a refused zone shows the reason and stays. The mode
// itself holds no rule: `decide(cell)` is the sim's own check (`validateLaunchHeli`) asked at the moment of the click, and the live marker and route come from
// the throttled preview the page runs (src/app/launchPreview.ts). Pure TypeScript over a small target interface, so the unit tests drive it with synthetic events.
import type { ContextCommand, InputMode, PointerInput } from './input';

export interface DeployTarget {
  /** The sim cell of the ground under a pixel, or null when the ray misses the globe. */
  pickCell(x: number, y: number): number | null;
  /** The cell under the cursor changed (null = off the globe, or the mode ended): the page asks the preview about it. */
  hover(cell: number | null): void;
  /** The verdict for a click RIGHT NOW: 0 = the launch would be accepted, else the reason (the sim's `validateLaunchHeli`). */
  decide(cell: number): number;
  /** Sends the LaunchHeli intent for the cell. */
  send(cell: number): void;
  /** A click on a refused zone. */
  refused(reason: number): void;
  /** Leaves the mode (the page pops it off the stack). */
  exit(): void;
  /** The mode ended (Escape, the page, a sent launch): the page clears the marker and the route. */
  ended(): void;
}

export interface DeployState {
  /** The hovered cell, -1 = none. */
  readonly cell: number;
  readonly factory: number;
}

export interface DeployMode extends InputMode {
  state(): DeployState;
}

export function createDeployMode(factory: number, target: DeployTarget): DeployMode {
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

  const act = (x: number, y: number): boolean => {
    px = x;
    py = y;
    known = true;
    const c = target.pickCell(x, y);
    if (c === null) return true; // a click beside the globe does nothing
    const reason = target.decide(c);
    if (reason !== 0) {
      target.refused(reason);
      return true;
    }
    target.send(c);
    target.exit();
    return true;
  };

  return {
    id: `deploy:${factory}`,
    state: () => ({ cell, factory }),
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
      return true; // no hover tooltip while choosing a zone
    },
    // the marker follows the camera too (a drag, a wheel notch, a flight moves the ground under a resting cursor)
    tick(): void {
      refresh();
    },
    click(x: number, y: number): boolean {
      return act(x, y);
    },
    context(command: ContextCommand): boolean {
      return act(command.x, command.y);
    },
    longPress(): boolean {
      return false; // a long press is a context command: it comes to `context`
    },
  };
}
