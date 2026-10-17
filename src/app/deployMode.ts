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
  /**
   * Whether the camera moved since the last time this was asked (true the first time). The ground under a resting cursor only changes when the camera does, so `tick` picks
   * only then. Optional: a target without it is picked every tick.
   */
  cameraMoved?(): boolean;
}

export interface DeployState {
  /** The hovered cell, -1 = none. */
  readonly cell: number;
  readonly factory: number;
}

export interface DeployMode extends InputMode {
  state(): DeployState;
  /** Ctx-1: the pinned landing zone (-1 = none). A mode opened with a target pins it; a click on another cell moves the pin, a click on the pinned cell sends. */
  pinned(): number;
  /** Ctx-1: sends the pinned zone when its verdict is accepted (a refusal shows its reason); returns true when it was sent. */
  confirm(): boolean;
}

/**
 * `preset` (Ctx-1, the context menu's "send a helicopter here") skips the second click: the zone is pinned at once, the page shows its route, marker and verdict like a hovered
 * one, and the player confirms (the Send button, or a click on the pinned cell). The cursor no longer moves the marker while a zone is pinned; a click elsewhere moves the pin.
 */
export function createDeployMode(factory: number, target: DeployTarget, preset = -1): DeployMode {
  let pin = preset;
  let px = -1;
  let py = -1;
  let known = false;
  let cell = preset;

  const refresh = (): void => {
    if (!known || pin >= 0) return;
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
    if (pin >= 0 && c !== pin) {
      pin = c; // the pin moves to the clicked zone: the preview shows it before anything is sent
      cell = c;
      target.hover(c);
      return true;
    }
    send(c);
    return true;
  };

  /** Asks the verdict, then sends (and leaves the mode) or shows the reason; true when the launch was sent. */
  const send = (c: number): boolean => {
    const reason = target.decide(c);
    if (reason !== 0) {
      target.refused(reason);
      return false;
    }
    target.send(c);
    target.exit();
    return true;
  };

  return {
    id: `deploy:${factory}`,
    state: () => ({ cell, factory }),
    pinned: () => pin,
    confirm: () => pin >= 0 && send(pin),
    onPush(): void {
      if (preset >= 0) target.hover(preset);
    },
    onPop(): void {
      pin = -1;
      cell = -1;
      target.hover(null);
      target.ended();
    },
    pointerMove(e: PointerInput): boolean {
      if (e.kind !== 'mouse') return false;
      px = e.x;
      py = e.y;
      known = true;
      refresh(); // (a pinned zone keeps the marker)
      return true; // no hover tooltip while choosing a zone
    },
    // the marker follows the camera too (a drag, a wheel notch, a flight moves the ground under a resting cursor)
    tick(): void {
      if (!known) return;
      if (target.cameraMoved !== undefined && !target.cameraMoved()) return; // the cursor and the camera stand still: the cell under it is the same
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
