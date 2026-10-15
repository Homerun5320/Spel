// The input mode stack (M08, D155). The page has ONE stack of input modes; the BASE mode is the camera and the click on the match (what
// M05 and M06 did inline in `globeApp.ts`, moved here without a change of behaviour); later modes (placement M10, deploy M13, the
// chase camera M13, target mode M15, the pause menu M18) PUSH themselves on top, see the pointer, wheel and key events first, and pop
// themselves again. `Escape` pops the top mode; the pause menu (M18) opens only when the stack is EMPTY (`setPauseHandler`).
//
// MOUSE. Left drag (more than `CLICK_MOVE_PX` of `src/ui/uiConfig.ts`, 6 px: the M05 tests pin 3 to 10, the prompt's 4 was not taken) =
// grip-pan (the ground point under the cursor stays under it); right or middle drag (or ctrl / shift + left) = yaw and tilt; right click
// without a drag = ONE context command (`setContextHandler`; M20a connects its resolver, until then nothing); wheel = zoom toward the
// cursor; left click without a drag = the M05 action (`InputTarget.click`: spawn or attack).
// TOUCH. One finger = the left button, two fingers = pan (the midpoint is gripped), pinch = zoom toward the midpoint, twist = yaw.
// RESERVED KEYS. 1 to 6 (build fields, M10), E (exposure view, M13), H (chase camera, M13), F (focus on your own capital), Escape.
// Nothing else may bind them; of these only F and Escape do something yet.
//
// The module is pure TypeScript over plain event records (no DOM types): `attachDomInput` at the end is the one DOM adapter, so the
// unit tests drive the stack with synthetic pointer events.
import { WHEEL_ZOOM_RATE } from '../render/config';
import { ClickTracker } from '../ui/clickTracker';

export type PointerKind = 'mouse' | 'touch' | 'pen';

/** A pointer event in canvas pixels. `button`: 0 left, 1 middle, 2 right (DOM numbering). */
export interface PointerInput {
  id: number;
  kind: PointerKind;
  x: number;
  y: number;
  button: number;
  ctrlKey: boolean;
  shiftKey: boolean;
}

/** A wheel event: `deltaY` in pixels (the adapter turns lines and pages into pixels). */
export interface WheelInput {
  x: number;
  y: number;
  deltaY: number;
}

export interface KeyInput {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  repeat?: boolean;
  /** A text field has the focus: the game keys are not taken (`typingInField` of src/app/matchKeys.ts decides in the adapter). */
  typing?: boolean;
}

/** What the camera must offer the base mode: `CameraRig` has all of it. */
export interface CameraInput {
  dragStart(px: number, py: number, now: number): void;
  dragMove(px: number, py: number, now: number): void;
  dragEnd(now: number): void;
  rotateBy(dxPx: number, dyPx: number): void;
  zoomAt(px: number, py: number, wheelDelta: number): void;
  yawBy(deg: number): void;
}

/** The place a context command (right click) points at. */
export interface ContextCommand {
  x: number;
  y: number;
  /** The sim cell index under the cursor. */
  cell: number;
  lat: number;
  lon: number;
}

export type ContextHandler = (command: ContextCommand) => void;

/** What the base mode needs of the page. */
export interface InputTarget {
  camera: CameraInput;
  /** The fx clock (`fxNow`): the camera's inertia reads it. */
  now(): number;
  /** Any grab of the camera ends a flight. */
  cancelFlight(): void;
  /** A left click that did not drag: the M05 action (spawn / attack). */
  click(x: number, y: number): void;
  /** The cell, latitude and longitude of the ground under a pixel, or null when the ray misses the globe (a context command needs it). */
  pickCell(x: number, y: number): { cell: number; lat: number; lon: number } | null;
  /** The mouse rests over the canvas at (x, y) (the hover tooltip); `hoverEnd` hides it (a press starts, the mouse leaves). */
  hover(x: number, y: number): void;
  hoverEnd(): void;
  /** F: fly to your own capital. */
  focusCapital(): void;
}

/** One mode of the stack. Every handler returns true when it used the event (the modes below do not see it). */
export interface InputMode {
  readonly id: string;
  pointerDown?(e: PointerInput): boolean;
  pointerMove?(e: PointerInput): boolean;
  pointerUp?(e: PointerInput): boolean;
  pointerCancel?(e: PointerInput): boolean;
  wheel?(e: WheelInput): boolean;
  key?(e: KeyInput): boolean;
  /** Called when the mode is pushed and when it is popped (by `Escape`, by `pop` or by `clear`). */
  onPush?(): void;
  onPop?(): void;
}

// ---- the handlers a later milestone connects ---------------------------------------------------------------------------------------

let pauseHandler: () => void = () => undefined;
let contextHandler: ContextHandler = () => undefined;

/** The pause menu (M18) opens through this when `Escape` is pressed with an empty stack. Until then it does nothing. */
export function setPauseHandler(fn: () => void): void {
  pauseHandler = fn;
}

/** The context resolver (M20a) gets every right click without a drag through this. Until then it does nothing. */
export function setContextHandler(fn: ContextHandler): void {
  contextHandler = fn;
}

/** Puts both handlers back to their no-op defaults (tests). */
export function resetInputHandlers(): void {
  pauseHandler = () => undefined;
  contextHandler = () => undefined;
}

/** The keys no other code may bind (CLAUDE.md, M08): the stack and the base mode own them. */
export const RESERVED_KEYS: readonly string[] = ['1', '2', '3', '4', '5', '6', 'e', 'h', 'f', 'Escape'];

export function isReservedKey(key: string): boolean {
  return RESERVED_KEYS.includes(key.length === 1 ? key.toLowerCase() : key);
}

// ---- the stack ------------------------------------------------------------------------------------------------------------------------

export class InputStack {
  private readonly modes: InputMode[] = [];
  // The mode that took a pointer's press keeps that pointer until it is released (a mode that pops itself on a press still gets its release).
  private readonly owners = new Map<number, InputMode>();

  constructor(readonly base: InputMode) {}

  /** The number of pushed modes (the base mode is not counted): 0 = the stack is empty and Escape opens the pause menu. */
  get depth(): number {
    return this.modes.length;
  }

  /** The topmost pushed mode, or the base mode when none is pushed. */
  get top(): InputMode {
    return this.modes[this.modes.length - 1] ?? this.base;
  }

  push(mode: InputMode): void {
    this.modes.push(mode);
    mode.onPush?.();
  }

  /** Pops the topmost pushed mode (null when the stack is empty). */
  pop(): InputMode | null {
    const mode = this.modes.pop();
    if (mode === undefined) return null;
    mode.onPop?.();
    return mode;
  }

  /** Pops every mode, topmost first. */
  clear(): void {
    while (this.pop() !== null) {
      /* popped */
    }
  }

  private each(visit: (mode: InputMode) => boolean): boolean {
    for (let i = this.modes.length - 1; i >= 0; i--) if (visit(this.modes[i] as InputMode)) return true;
    return visit(this.base);
  }

  pointerDown(e: PointerInput): boolean {
    let used: InputMode | null = null;
    const handled = this.each((m) => {
      if (m.pointerDown?.(e) === true) {
        used = m;
        return true;
      }
      return false;
    });
    if (handled && used !== null) this.owners.set(e.id, used);
    return handled;
  }

  pointerMove(e: PointerInput): boolean {
    const owner = this.owners.get(e.id);
    if (owner !== undefined) return owner.pointerMove?.(e) === true;
    return this.each((m) => m.pointerMove?.(e) === true);
  }

  pointerUp(e: PointerInput): boolean {
    const owner = this.owners.get(e.id);
    this.owners.delete(e.id);
    if (owner !== undefined) return owner.pointerUp?.(e) === true;
    return this.each((m) => m.pointerUp?.(e) === true);
  }

  pointerCancel(e: PointerInput): boolean {
    const owner = this.owners.get(e.id);
    this.owners.delete(e.id);
    if (owner !== undefined) return owner.pointerCancel?.(e) === true;
    return this.each((m) => m.pointerCancel?.(e) === true);
  }

  wheel(e: WheelInput): boolean {
    return this.each((m) => m.wheel?.(e) === true);
  }

  /**
   * A key press. `Escape` pops the topmost pushed mode; with an empty stack it calls the pause handler (the pause menu of M18). Every other key
   * goes down the stack. Returns true when the key was used. A key typed into a text field is not ours (`typing`).
   */
  key(e: KeyInput): boolean {
    if (e.typing === true || e.metaKey) return false;
    if (e.key === 'Escape') {
      if (e.repeat === true) return true;
      if (this.modes.length > 0) {
        this.pop();
      } else {
        pauseHandler();
      }
      return true;
    }
    return this.each((m) => m.key?.(e) === true);
  }
}

// ---- the base mode --------------------------------------------------------------------------------------------------------------------

interface Tracked {
  id: number;
  x: number;
  y: number;
}

type Gesture = 'none' | 'drag' | 'rotate' | 'pinch';

/**
 * The base mode: the camera and the click on the match. It tracks at most two pointers. A press with the left button or one finger grips the
 * ground; right, middle or ctrl / shift turn the camera; a second finger turns a drag into a pinch. Nothing here allocates per event except
 * the context command of a right click.
 */
export function createBaseMode(target: InputTarget, clickThresholdPx?: number): InputMode {
  const clicks = new ClickTracker(clickThresholdPx);
  const rightClicks = new ClickTracker(clickThresholdPx);
  const a: Tracked = { id: -1, x: 0, y: 0 };
  const b: Tracked = { id: -1, x: 0, y: 0 };
  let gesture: Gesture = 'none';
  let rightButton = false;
  let lastX = 0;
  let lastY = 0;
  // pinch state: the distance and the angle of the line between the fingers, and the midpoint, at the last event
  let pinchDist = 1;
  let pinchAngle = 0;

  const midX = (): number => (a.x + b.x) / 2;
  const midY = (): number => (a.y + b.y) / 2;
  const fingerDist = (): number => Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
  const fingerAngle = (): number => Math.atan2(b.y - a.y, b.x - a.x);

  const endAll = (): void => {
    gesture = 'none';
    rightButton = false;
    a.id = -1;
    b.id = -1;
  };

  const startPinch = (): void => {
    // the single-finger grip becomes the grip of the midpoint
    target.camera.dragEnd(target.now());
    clicks.cancel();
    pinchDist = fingerDist();
    pinchAngle = fingerAngle();
    target.camera.dragStart(midX(), midY(), target.now());
    gesture = 'pinch';
  };

  return {
    id: 'base',

    pointerDown(e: PointerInput): boolean {
      target.hoverEnd();
      target.cancelFlight(); // any grab of the camera ends a flight
      if (e.kind !== 'mouse') {
        if (gesture === 'none') {
          a.id = e.id;
          a.x = e.x;
          a.y = e.y;
          gesture = 'drag';
          clicks.down(e.x, e.y);
          target.camera.dragStart(e.x, e.y, target.now());
        } else if (gesture === 'drag' && b.id < 0 && e.id !== a.id) {
          b.id = e.id;
          b.x = e.x;
          b.y = e.y;
          startPinch();
        }
        return true;
      }
      if (gesture !== 'none') {
        // A mouse press while the base mode still thinks one is held: the browser sends no second pointerdown for a second button, so the
        // release of the first one was lost (the window lost focus, a menu opened): start over with this press, as M05 did.
        if (gesture === 'drag' || gesture === 'pinch') target.camera.dragEnd(target.now());
        clicks.cancel();
        rightClicks.cancel();
        endAll();
      }
      a.id = e.id;
      a.x = e.x;
      a.y = e.y;
      lastX = e.x;
      lastY = e.y;
      if (e.button === 2 || e.button === 1 || e.ctrlKey || e.shiftKey) {
        gesture = 'rotate';
        rightButton = e.button === 2 && !e.ctrlKey && !e.shiftKey;
        rightClicks.down(e.x, e.y);
      } else if (e.button === 0) {
        gesture = 'drag';
        clicks.down(e.x, e.y);
        target.camera.dragStart(e.x, e.y, target.now());
      }
      return true;
    },

    pointerMove(e: PointerInput): boolean {
      if (gesture === 'none') {
        if (e.kind === 'mouse') target.hover(e.x, e.y);
        return true;
      }
      if (gesture === 'pinch') {
        if (e.id === a.id) {
          a.x = e.x;
          a.y = e.y;
        } else if (e.id === b.id) {
          b.x = e.x;
          b.y = e.y;
        } else {
          return true;
        }
        const d = fingerDist();
        const ang = fingerAngle();
        const mx = midX();
        const my = midY();
        target.camera.dragMove(mx, my, target.now());
        if (d !== pinchDist) target.camera.zoomAt(mx, my, -Math.log(d / pinchDist) / WHEEL_ZOOM_RATE);
        let turn = ang - pinchAngle;
        if (turn > Math.PI) turn -= 2 * Math.PI;
        if (turn < -Math.PI) turn += 2 * Math.PI;
        // the map follows the fingers: a twist clockwise on the screen turns the heading the other way
        if (turn !== 0) target.camera.yawBy((-turn * 180) / Math.PI);
        pinchDist = d;
        pinchAngle = ang;
        return true;
      }
      if (e.id !== a.id) return true;
      if (gesture === 'drag') {
        clicks.move(e.x, e.y);
        target.camera.dragMove(e.x, e.y, target.now());
      } else if (gesture === 'rotate') {
        rightClicks.move(e.x, e.y);
        target.camera.rotateBy(e.x - lastX, e.y - lastY);
      }
      a.x = e.x;
      a.y = e.y;
      lastX = e.x;
      lastY = e.y;
      return true;
    },

    pointerUp(e: PointerInput): boolean {
      if (gesture === 'pinch') {
        if (e.id === a.id || e.id === b.id) {
          target.camera.dragEnd(target.now());
          endAll();
        }
        return true;
      }
      if (e.id !== a.id) return true;
      if (gesture === 'drag') {
        const wasClick = clicks.up(e.x, e.y);
        if (!wasClick) clicks.cancel();
        target.camera.dragEnd(target.now());
        endAll();
        if (wasClick) target.click(e.x, e.y);
        return true;
      }
      if (gesture === 'rotate') {
        const wasClick = rightClicks.up(e.x, e.y);
        const command = rightButton && wasClick;
        endAll();
        if (command) {
          const hit = target.pickCell(e.x, e.y);
          if (hit !== null) contextHandler({ x: e.x, y: e.y, cell: hit.cell, lat: hit.lat, lon: hit.lon });
        }
        return true;
      }
      endAll();
      return true;
    },

    pointerCancel(e: PointerInput): boolean {
      if (gesture === 'drag' || gesture === 'pinch') target.camera.dragEnd(target.now());
      clicks.cancel();
      rightClicks.cancel();
      if (e.id === a.id || e.id === b.id) endAll();
      return true;
    },

    wheel(e: WheelInput): boolean {
      target.cancelFlight();
      target.camera.zoomAt(e.x, e.y, e.deltaY);
      return true;
    },

    key(e: KeyInput): boolean {
      if (e.ctrlKey || e.altKey) return false;
      if (e.key === 'f' || e.key === 'F') {
        if (e.repeat !== true) target.focusCapital();
        return true;
      }
      return false;
    },
  };
}

// ---- the DOM adapter --------------------------------------------------------------------------------------------------------------------

/** The pointer and wheel events of a canvas, handed to the stack. Returns the function that removes the listeners. */
export function attachDomInput(canvas: HTMLCanvasElement, stack: InputStack, hoverLeave: () => void, signal?: AbortSignal): () => void {
  canvas.style.touchAction = 'none';
  const local = (e: MouseEvent): { x: number; y: number } => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const kindOf = (e: PointerEvent): PointerKind => (e.pointerType === 'touch' ? 'touch' : e.pointerType === 'pen' ? 'pen' : 'mouse');
  const input = (e: PointerEvent): PointerInput => {
    const p = local(e);
    return { id: e.pointerId, kind: kindOf(e), x: p.x, y: p.y, button: e.button, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey };
  };
  const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void, options?: AddEventListenerOptions): void => {
    canvas.addEventListener(type, fn, signal ? { ...options, signal } : options);
  };
  let pressed = 0;
  on('contextmenu', (e) => e.preventDefault());
  on('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pressed++;
    stack.pointerDown(input(e));
  });
  on('pointermove', (e) => {
    stack.pointerMove(input(e));
  });
  const release = (e: PointerEvent): void => {
    if (pressed > 0) pressed--;
    if (e.type === 'pointerup') stack.pointerUp(input(e));
    else stack.pointerCancel(input(e));
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  };
  on('pointerup', release);
  on('pointercancel', release);
  on('pointerleave', () => {
    if (pressed === 0) hoverLeave();
  });
  on(
    'wheel',
    (e) => {
      e.preventDefault();
      const p = local(e);
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      stack.wheel({ x: p.x, y: p.y, deltaY: e.deltaY * unit });
    },
    { passive: false },
  );
  return () => undefined;
}
