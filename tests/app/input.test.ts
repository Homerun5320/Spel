// M08 item 1 and the input half of item 2: the input mode stack, the base mode (the M05 input taken over unchanged), the mouse mapping,
// the context command, the reserved keys and the two-finger gesture. The events are synthetic records (`PointerInput`), the camera is the
// real RTS rig over the real terrain, so "the ground point stays under the cursor" is measured with the rig's own projection.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  InputStack,
  RESERVED_KEYS,
  attachDomKeys,
  createBaseMode,
  isReservedKey,
  resetInputHandlers,
  setContextHandler,
  setPauseHandler,
  type ContextCommand,
  type InputMode,
  type InputTarget,
  type KeyInput,
  type PointerInput,
} from '../../src/app/input';
import { matchKeyAction } from '../../src/app/matchKeys';
import { CameraRig } from '../../src/render/camera';
import { ROTATE_DEG_PER_PX, TILT_MAX_DEG } from '../../src/render/config';
import { vecToLatLon, type Vec3 } from '../../src/render/geo';
import { latLonToCell, pickGround, worldToCell } from '../../src/render/transforms';
import { CLICK_MOVE_PX, LONG_PRESS_S } from '../../src/ui/uiConfig';
import { loadRtsWorld, makeRtsRig, type RtsWorld } from '../helpers/rtsRig';

let w: RtsWorld;
beforeAll(async () => {
  w = await loadRtsWorld();
});
afterEach(() => resetInputHandlers());

const key = (k: string, extra: Partial<KeyInput> = {}): KeyInput => ({ key: k, ctrlKey: false, altKey: false, metaKey: false, ...extra });

interface Harness {
  rig: CameraRig;
  stack: InputStack;
  clicks: Array<[number, number]>;
  focus: number[];
  cancels: number[];
  hovers: Array<[number, number]>;
  contexts: ContextCommand[];
  /** The fx time, seconds. */
  t: number;
  frame(seconds?: number): void;
}

function harness(view: Parameters<typeof makeRtsRig>[1], alt?: number): Harness {
  const rig = makeRtsRig(w, view, alt);
  const h: Harness = { rig, stack: null as unknown as InputStack, clicks: [], focus: [], cancels: [], hovers: [], contexts: [], t: 1, frame: () => undefined };
  const target: InputTarget = {
    camera: rig,
    now: () => h.t,
    cancelFlight: () => h.cancels.push(h.t),
    click: (x, y) => h.clicks.push([x, y]),
    pickCell: (x, y) => {
      const hit = pickGround(w.world.detailField, rig.rayAt(x, y));
      return hit === null ? null : { cell: worldToCell(hit.point, 1024, 512).index, lat: hit.lat, lon: hit.lon };
    },
    hover: (x, y) => h.hovers.push([x, y]),
    hoverEnd: () => undefined,
    focusCapital: () => h.focus.push(h.t),
  };
  h.stack = new InputStack(createBaseMode(target));
  h.frame = (seconds = 1 / 60) => {
    h.t += seconds;
    rig.update(h.t);
  };
  rig.update(h.t);
  return h;
}

const mouse = (x: number, y: number, button = 0, extra: Partial<PointerInput> = {}): PointerInput => ({ id: 1, kind: 'mouse', x, y, button, ctrlKey: false, shiftKey: false, ...extra });
const finger = (id: number, x: number, y: number): PointerInput => ({ id, kind: 'touch', x, y, button: 0, ctrlKey: false, shiftKey: false });

/** The pixel a world point is at, and its distance in pixels to (x, y). */
function offBy(rig: CameraRig, p: Vec3, x: number, y: number): number {
  const s = rig.project(p);
  return Math.hypot(s.x - x, s.y - y);
}

const groundAt = (h: Harness, x: number, y: number): Vec3 => {
  const hit = pickGround(w.world.detailField, h.rig.rayAt(x, y));
  if (!hit) throw new Error(`no ground at ${x}, ${y}`);
  return hit.point;
};

describe('the stack: Escape pops the top mode, the pause menu opens only when the stack is empty', () => {
  const dummy = (id: string, log: string[] = []): InputMode => ({ id, onPush: () => log.push(`${id}+`), onPop: () => log.push(`${id}-`) });

  it('push, pop, depth and top; Escape pops the topmost mode and calls the pause handler ONLY with an empty stack', () => {
    let paused = 0;
    setPauseHandler(() => paused++);
    const log: string[] = [];
    const stack = new InputStack(dummy('base'));
    expect(stack.depth).toBe(0);
    expect(stack.top.id).toBe('base');
    stack.push(dummy('place', log));
    stack.push(dummy('target', log));
    expect(stack.depth).toBe(2);
    expect(stack.top.id).toBe('target');
    expect(stack.key(key('Escape'))).toBe(true);
    expect(stack.top.id).toBe('place');
    expect(paused).toBe(0); // a mode was popped: no pause menu
    expect(stack.key(key('Escape'))).toBe(true);
    expect(stack.depth).toBe(0);
    expect(paused).toBe(0);
    expect(stack.key(key('Escape'))).toBe(true); // the stack is empty now
    expect(paused).toBe(1);
    expect(stack.key(key('Escape'))).toBe(true);
    expect(paused).toBe(2);
    expect(log).toEqual(['place+', 'target+', 'target-', 'place-']);
  });

  it('the handlers are no-ops by default, an Escape typed into a text field or held down is not a second pop, clear() pops everything', () => {
    const stack = new InputStack(dummy('base'));
    expect(() => stack.key(key('Escape'))).not.toThrow(); // the default pause handler does nothing
    let paused = 0;
    setPauseHandler(() => paused++);
    expect(stack.key(key('Escape', { typing: true }))).toBe(false);
    expect(paused).toBe(0);
    expect(stack.key(key('Escape', { metaKey: true }))).toBe(false);
    stack.push(dummy('a'));
    stack.push(dummy('b'));
    stack.key(key('Escape', { repeat: true })); // auto-repeat: nothing
    expect(stack.depth).toBe(2);
    stack.clear();
    expect(stack.depth).toBe(0);
    expect(paused).toBe(0);
  });

  it('pointer events go to the topmost mode first; a mode that uses a press keeps the pointer until its release; the base sees what the modes leave', () => {
    const seen: string[] = [];
    const mk = (id: string, take: boolean): InputMode => ({
      id,
      pointerDown: () => (seen.push(`${id}:down`), take),
      pointerMove: () => (seen.push(`${id}:move`), take),
      pointerUp: () => (seen.push(`${id}:up`), take),
    });
    const stack = new InputStack(mk('base', true));
    stack.push(mk('lower', false));
    stack.push(mk('upper', true));
    stack.pointerDown(mouse(1, 1));
    stack.pointerMove(mouse(2, 2));
    stack.pointerUp(mouse(2, 2));
    expect(seen).toEqual(['upper:down', 'upper:move', 'upper:up']);
    seen.length = 0;
    stack.pop();
    stack.pointerDown(mouse(1, 1));
    stack.pointerUp(mouse(1, 1));
    expect(seen).toEqual(['lower:down', 'base:down', 'base:up']);
  });
});

describe('reserved keys', () => {
  it('1 to 6, E, H, F and Escape are reserved, and the match keys do not bind any of them', () => {
    expect([...RESERVED_KEYS]).toEqual(['1', '2', '3', '4', '5', '6', 'e', 'h', 'f', 'Escape']);
    for (const k of ['1', '2', '3', '4', '5', '6', 'e', 'E', 'h', 'H', 'f', 'F', 'Escape']) {
      expect(isReservedKey(k), k).toBe(true);
      expect(matchKeyAction({ key: k, ctrlKey: false, altKey: false, metaKey: false }), k).toBeNull();
    }
    expect(isReservedKey('x')).toBe(false);
  });

  it('F asks for your capital once per press (not on auto-repeat, not with ctrl); 1 to 6, E and H do nothing yet', () => {
    const h = harness({ lat: 46.5, lon: 8, heading: 0, tilt: 50 }, 20_000);
    expect(h.stack.key(key('f'))).toBe(true);
    expect(h.stack.key(key('F'))).toBe(true);
    expect(h.focus.length).toBe(2);
    expect(h.stack.key(key('f', { repeat: true }))).toBe(true);
    expect(h.focus.length).toBe(2);
    expect(h.stack.key(key('f', { ctrlKey: true }))).toBe(false);
    expect(h.focus.length).toBe(2);
    for (const k of ['1', '2', '3', '4', '5', '6', 'e', 'h']) expect(h.stack.key(key(k)), k).toBe(false);
  });
});

describe('left drag = grip-pan: the ground point stays under the cursor', () => {
  const views = [
    { name: 'the Alps, 20 km up, tilt 55', view: { lat: 46.5, lon: 8, heading: 20, tilt: 55 }, alt: 20_000, from: [480, 300], to: [720, 190] },
    { name: 'the Himalaya, 60 km up, tilt 40, heading 200', view: { lat: 28.2, lon: 86.8, heading: 200, tilt: 40 }, alt: 60_000, from: [400, 320], to: [260, 400] },
    { name: 'open sea, 3 km up, tilt 65', view: { lat: 0, lon: -150, heading: 90, tilt: 65 }, alt: 3_000, from: [600, 350], to: [300, 330] },
    { name: 'Norway, 300 m up (the floor), tilt 70', view: { lat: 62, lon: 7, heading: 270, tilt: 70 }, alt: 300, from: [500, 400], to: [420, 440] },
  ] as const;

  for (const v of views) {
    it(`${v.name}: within 1 px at every one of 40 moves and frames, then the camera is still above the clearance`, () => {
      const h = harness(v.view, v.alt);
      const [x0, y0] = v.from;
      const [x1, y1] = v.to;
      const P = groundAt(h, x0, y0);
      const before = vecToLatLon(h.rig.pose().position);
      h.stack.pointerDown(mouse(x0, y0));
      let worst = 0;
      for (let i = 1; i <= 40; i++) {
        h.frame(1 / 60);
        const x = x0 + ((x1 - x0) * i) / 40;
        const y = y0 + ((y1 - y0) * i) / 40;
        h.stack.pointerMove(mouse(x, y));
        worst = Math.max(worst, offBy(h.rig, P, x, y));
        h.frame(1 / 60); // a frame between the events: the camera follows the ground and the grip re-aligns
        worst = Math.max(worst, offBy(h.rig, P, x, y));
      }
      expect(worst, 'worst distance of the grabbed point from the cursor (px)').toBeLessThanOrEqual(1);
      h.t += 0.2; // a pause before the release: no fling
      h.stack.pointerUp(mouse(x1, y1));
      expect(h.clicks).toEqual([]); // a drag is not a click
      const after = vecToLatLon(h.rig.pose().position);
      expect(Math.hypot(after.lat - before.lat, after.lon - before.lon), 'the camera did move').toBeGreaterThan(1e-5);
      for (let i = 0; i < 120; i++) h.frame(1 / 60);
      expect(h.rig.aglM()).toBeGreaterThanOrEqual(299.9);
    });
  }

  it('a press that moves no more than CLICK_MOVE_PX is a click (one call at the release position); a longer one is not; the camera is gripped from the first pixel', () => {
    const h = harness({ lat: 46.5, lon: 8, heading: 0, tilt: 50 }, 20_000);
    h.stack.pointerDown(mouse(400, 300));
    h.stack.pointerMove(mouse(400 + CLICK_MOVE_PX - 1, 300));
    h.stack.pointerUp(mouse(400 + CLICK_MOVE_PX - 1, 300));
    expect(h.clicks).toEqual([[400 + CLICK_MOVE_PX - 1, 300]]);
    h.stack.pointerDown(mouse(400, 300));
    h.stack.pointerMove(mouse(400 + CLICK_MOVE_PX + 1, 300));
    h.stack.pointerUp(mouse(400, 300)); // back at the start: still a drag
    expect(h.clicks.length).toBe(1);
    expect(h.cancels.length).toBe(2); // any press ends a flight
  });

  it('the globe regime is unchanged: the same events through the stack and straight into the rig (as globeApp did in M05) give byte-identical views', () => {
    const view = { lat: 20, lon: 0, distKm: 9000, heading: 0, tilt: 0 };
    const a = harness(view);
    const b = makeRtsRig(w, view);
    a.stack.pointerDown(mouse(480, 270));
    b.dragStart(480, 270, 1);
    for (let i = 1; i <= 8; i++) {
      a.stack.pointerMove(mouse(480 + i * 15, 270 - i * 3));
      b.dragMove(480 + i * 15, 270 - i * 3, 1);
    }
    a.t = 1.2;
    a.stack.pointerUp(mouse(600, 246));
    b.dragEnd(1.2);
    a.rig.update(2);
    b.update(2);
    expect(a.rig.view).toEqual(b.view);
    // right drag
    a.stack.pointerDown(mouse(480, 270, 2));
    b.rotateBy(0, 0);
    let px = 480;
    let py = 270;
    for (let i = 1; i <= 10; i++) {
      a.stack.pointerMove(mouse(480 + i * 20, 270 + i * 40, 2));
      b.rotateBy(480 + i * 20 - px, 270 + i * 40 - py);
      px = 480 + i * 20;
      py = 270 + i * 40;
    }
    a.stack.pointerUp(mouse(px, py, 2));
    expect(a.rig.view).toEqual(b.view);
    expect(a.rig.view.tilt).toBe(TILT_MAX_DEG);
  });
});

describe('right drag = yaw and tilt about the ground point at the centre of the screen', () => {
  it('turns the heading by the pixels moved and does not move the position: the ground point at the centre stays at the centre (RTS)', () => {
    const h = harness({ lat: 46.5, lon: 8, heading: 40, tilt: 50 }, 15_000);
    const centre = groundAt(h, 480, 270);
    const view0 = h.rig.view;
    const depth0 = h.stack.depth;
    h.stack.pointerDown(mouse(480, 270, 2));
    for (let i = 1; i <= 20; i++) {
      h.stack.pointerMove(mouse(480 + i * 4, 270, 2)); // 80 px to the right
      h.frame(1 / 60);
    }
    h.stack.pointerUp(mouse(560, 270, 2));
    const view1 = h.rig.view;
    expect(h.stack.depth).toBe(depth0); // no mode was pushed or popped
    expect(Math.abs(view1.heading - view0.heading - 80 * ROTATE_DEG_PER_PX), 'heading change (deg)').toBeLessThan(0.6);
    expect(Math.abs(view1.tilt - view0.tilt), 'tilt unchanged by a horizontal drag').toBeLessThan(0.05);
    expect(offBy(h.rig, centre, 480, 270), 'the point at the centre stays at the centre (px)').toBeLessThan(1);
  });

  it('a vertical drag tilts within the RTS limits 20 to 80 degrees (measured at the camera; the globe keeps 0 to 72), also about the centre point', () => {
    const h = harness({ lat: 46.5, lon: 8, heading: 0, tilt: 50 }, 15_000);
    const centre = groundAt(h, 480, 270);
    h.stack.pointerDown(mouse(480, 270, 2));
    for (let i = 1; i <= 40; i++) h.stack.pointerMove(mouse(480, 270 + i * 20, 2)); // far down: toward the horizon
    expect(h.rig.localTilt()).toBeCloseTo(80, 3);
    expect(offBy(h.rig, centre, 480, 270)).toBeLessThan(1.5);
    for (let i = 1; i <= 80; i++) h.stack.pointerMove(mouse(480, 270 + 800 - i * 20, 2)); // far up: toward straight down
    expect(h.rig.localTilt()).toBeCloseTo(20, 3);
    h.stack.pointerUp(mouse(480, 270, 2));
  });

  it('the middle button and ctrl / shift + left do the same turn and never give a context command', () => {
    let commands = 0;
    setContextHandler(() => commands++);
    for (const down of [mouse(480, 270, 1), mouse(480, 270, 0, { ctrlKey: true }), mouse(480, 270, 0, { shiftKey: true })]) {
      const h = harness({ lat: 46.5, lon: 8, heading: 0, tilt: 50 }, 15_000);
      h.stack.pointerDown(down);
      h.stack.pointerMove({ ...down, x: 530 });
      h.stack.pointerUp({ ...down, x: 530 });
      expect(h.rig.view.heading).toBeGreaterThan(10);
      expect(h.clicks).toEqual([]);
      const h2 = harness({ lat: 46.5, lon: 8, heading: 0, tilt: 50 }, 15_000);
      h2.stack.pointerDown(down);
      h2.stack.pointerUp(down); // a click with the middle button / ctrl: nothing at all
      expect(h2.clicks).toEqual([]);
    }
    expect(commands).toBe(0);
  });
});

describe('right click without a drag = exactly one context command with the right cell', () => {
  it('calls the handler once with the cell under the cursor (also after a pixel of jitter); a real drag gives none', () => {
    const got: ContextCommand[] = [];
    setContextHandler((c) => got.push(c));
    const h = harness({ lat: 46.5, lon: 8, heading: 0, tilt: 50 }, 600_000);
    for (const [x, y] of [
      [480, 270],
      [300, 400],
      [700, 150],
    ] as const) {
      got.length = 0;
      const P = groundAt(h, x, y);
      h.stack.pointerDown(mouse(x, y, 2));
      h.stack.pointerUp(mouse(x, y, 2));
      expect(got.length, `click at ${x}, ${y}`).toBe(1);
      const ll = vecToLatLon(P);
      expect(got[0]?.cell).toBe(latLonToCell(ll.lat, ll.lon, 1024, 512).index);
      expect(got[0]).toMatchObject({ x, y });
    }
    got.length = 0;
    h.stack.pointerDown(mouse(480, 270, 2));
    h.stack.pointerMove(mouse(481, 271, 2));
    h.stack.pointerUp(mouse(481, 271, 2));
    expect(got.length).toBe(1);
    expect(h.rig.view.heading).toBeCloseTo(h.rig.view.heading, 9);
    got.length = 0;
    h.stack.pointerDown(mouse(480, 270, 2));
    h.stack.pointerMove(mouse(520, 270, 2));
    h.stack.pointerUp(mouse(520, 270, 2));
    expect(got.length).toBe(0);
    // a left click is the M05 click, not a context command
    h.stack.pointerDown(mouse(480, 270, 0));
    h.stack.pointerUp(mouse(480, 270, 0));
    expect(got.length).toBe(0);
    expect(h.clicks.length).toBe(1);
  });

  it('the default handler is a no-op, a click that hits no ground gives no command, and a second handler replaces the first', () => {
    const h = harness({ lat: 20, lon: 10, heading: 0, tilt: 0, distKm: 21500 });
    expect(() => {
      h.stack.pointerDown(mouse(480, 270, 2));
      h.stack.pointerUp(mouse(480, 270, 2));
    }).not.toThrow();
    const a: ContextCommand[] = [];
    const b: ContextCommand[] = [];
    setContextHandler((c) => a.push(c));
    setContextHandler((c) => b.push(c));
    h.stack.pointerDown(mouse(480, 270, 2));
    h.stack.pointerUp(mouse(480, 270, 2));
    h.stack.pointerDown(mouse(3, 3, 2)); // sky
    h.stack.pointerUp(mouse(3, 3, 2));
    expect(a.length).toBe(0);
    expect(b.length).toBe(1);
  });
});

describe('a lost release does not freeze the camera', () => {
  it('a mouse press after a press whose release never came starts over (M05 overwrote its mode on every press): the second drag works and the first one is closed', () => {
    const h = harness({ lat: 46.5, lon: 8, heading: 0, tilt: 50 }, 20_000);
    h.stack.pointerDown(mouse(400, 300)); // ... and the pointerup is lost
    h.stack.pointerMove(mouse(430, 300));
    h.stack.pointerDown(mouse(500, 300)); // a new press
    const before = h.rig.view;
    h.stack.pointerMove(mouse(560, 330));
    h.stack.pointerUp(mouse(560, 330));
    expect(h.rig.view).not.toEqual(before);
    expect(h.clicks).toEqual([]);
    h.stack.pointerDown(mouse(300, 300));
    h.stack.pointerUp(mouse(300, 300));
    expect(h.clicks).toEqual([[300, 300]]);
  });
});

describe('the wheel zooms toward the cursor', () => {
  it('the ground point under the cursor stays under it while the height shrinks (RTS), and the wheel ends a flight', () => {
    const h = harness({ lat: 46.5, lon: 8, heading: 0, tilt: 50 }, 30_000);
    const P = groundAt(h, 600, 200);
    const agl0 = h.rig.aglM();
    let worst = 0;
    for (let i = 0; i < 6; i++) {
      h.stack.wheel({ x: 600, y: 200, deltaY: -240 });
      for (let k = 0; k < 20; k++) {
        h.frame(1 / 60);
        worst = Math.max(worst, offBy(h.rig, P, 600, 200));
      }
    }
    for (let k = 0; k < 120; k++) h.frame(1 / 60);
    expect(h.rig.aglM()).toBeLessThan(agl0 * 0.4);
    expect(worst).toBeLessThan(3);
    expect(offBy(h.rig, P, 600, 200)).toBeLessThan(1);
    expect(h.cancels.length).toBe(6);
  });
});

describe('two fingers = pan, pinch zoom and twist (synthetic touch events)', () => {
  const start = (): Harness => {
    const h = harness({ lat: 46.5, lon: 8, heading: 30, tilt: 50 }, 30_000);
    h.stack.pointerDown(finger(1, 400, 270));
    h.stack.pointerDown(finger(2, 560, 270));
    return h;
  };

  it('both fingers sliding together pan: the ground point between the fingers stays between them (within 1 px) and the camera moves', () => {
    const h = start();
    const P = groundAt(h, 480, 270);
    const before = vecToLatLon(h.rig.pose().position);
    let worst = 0;
    for (let i = 1; i <= 30; i++) {
      h.stack.pointerMove(finger(1, 400 + 3 * i, 270 - 2 * i));
      h.stack.pointerMove(finger(2, 560 + 3 * i, 270 - 2 * i));
      h.frame(1 / 60);
      worst = Math.max(worst, offBy(h.rig, P, 480 + 3 * i, 270 - 2 * i));
    }
    h.stack.pointerUp(finger(1, 490, 210));
    h.stack.pointerUp(finger(2, 650, 210));
    const after = vecToLatLon(h.rig.pose().position);
    expect(worst).toBeLessThanOrEqual(1);
    expect(Math.hypot(after.lat - before.lat, after.lon - before.lon)).toBeGreaterThan(1e-4);
    expect(h.clicks).toEqual([]); // a gesture is never a click
  });

  it('spreading the fingers zooms in toward the midpoint (the height falls by about the ratio), pinching zooms out', () => {
    const h = start();
    const P = groundAt(h, 480, 270);
    const agl0 = h.rig.aglM();
    for (let i = 1; i <= 20; i++) {
      h.stack.pointerMove(finger(1, 400 - 4 * i, 270));
      h.stack.pointerMove(finger(2, 560 + 4 * i, 270)); // 160 px -> 320 px: twice as far apart
      h.frame(1 / 60);
    }
    for (let k = 0; k < 60; k++) h.frame(1 / 60);
    const agl1 = h.rig.aglM();
    expect(agl1 / agl0, 'height ratio after a pinch-out of x2').toBeGreaterThan(0.3);
    expect(agl1 / agl0).toBeLessThan(0.7);
    expect(offBy(h.rig, P, 480, 270), 'the midpoint stays on its ground (px)').toBeLessThan(2);
    for (let i = 1; i <= 20; i++) {
      h.stack.pointerMove(finger(1, 320 + 4 * i, 270));
      h.stack.pointerMove(finger(2, 640 - 4 * i, 270)); // back to 160 px
      h.frame(1 / 60);
    }
    for (let k = 0; k < 60; k++) h.frame(1 / 60);
    expect(h.rig.aglM() / agl1).toBeGreaterThan(1.5);
  });

  it('twisting the fingers clockwise on the screen turns the heading the other way, by about the angle, about the point between them', () => {
    const h = start();
    const P = groundAt(h, 480, 270);
    const heading0 = h.rig.view.heading;
    const R = 80;
    for (let i = 1; i <= 20; i++) {
      const a = (i / 20) * (30 * Math.PI) / 180; // 30 degrees clockwise (the screen's y axis points down)
      h.stack.pointerMove(finger(1, 480 - R * Math.cos(a), 270 - R * Math.sin(a)));
      h.stack.pointerMove(finger(2, 480 + R * Math.cos(a), 270 + R * Math.sin(a)));
      h.frame(1 / 60);
    }
    const dHeading = ((h.rig.view.heading - heading0 + 540) % 360) - 180;
    expect(dHeading, 'heading change (deg)').toBeLessThan(-25);
    expect(dHeading).toBeGreaterThan(-35);
    expect(offBy(h.rig, P, 480, 270), 'the pivot stays between the fingers (px)').toBeLessThan(2);
  });

  it('lifting one finger ends the gesture; a single finger is the left button (a tap is a click)', () => {
    const h = start();
    h.stack.pointerUp(finger(2, 560, 270));
    h.stack.pointerMove(finger(1, 450, 270)); // the rest of the gesture is ignored
    h.stack.pointerUp(finger(1, 450, 270));
    expect(h.clicks).toEqual([]);
    h.stack.pointerDown(finger(3, 300, 300));
    h.stack.pointerUp(finger(3, 300, 301));
    expect(h.clicks).toEqual([[300, 301]]);
  });
});

describe('a cancelled or lost gesture lets go of the camera (M08 audit pass)', () => {
  /** The calls the base mode makes on the rig, in order, while the real rig still does its work. */
  function spyOnRig(h: Harness): string[] {
    const log: string[] = [];
    const rig = h.rig;
    for (const name of ['dragStart', 'dragMove', 'dragEnd'] as const) {
      const orig = rig[name].bind(rig) as (...a: number[]) => void;
      (rig as unknown as Record<string, unknown>)[name] = (...a: number[]): void => {
        log.push(name);
        orig(...a);
      };
    }
    return log;
  }
  const gripOf = (rig: CameraRig): unknown => (rig as unknown as { grip: unknown }).grip;
  const draggingOf = (rig: CameraRig): boolean => (rig as unknown as { dragging: boolean }).dragging;

  it('a touch that is cancelled (a palm, a system gesture) ends the drag: dragEnd is called, the grip is gone, the camera rests, and a wheel zoom afterwards keeps ITS point under the cursor', () => {
    const h = harness({ lat: 46.5, lon: 8, heading: 20, tilt: 50 }, 20_000);
    const log = spyOnRig(h);
    h.stack.pointerDown(finger(1, 300, 300));
    for (let i = 1; i <= 10; i++) h.stack.pointerMove(finger(1, 300 + 5 * i, 300 + 2 * i));
    expect(gripOf(h.rig)).not.toBeNull();
    expect(draggingOf(h.rig)).toBe(true);
    h.t += 0.3;
    h.stack.pointerCancel(finger(1, 350, 320));
    expect(log.filter((n) => n === 'dragEnd').length).toBe(1);
    expect(gripOf(h.rig)).toBeNull();
    expect(draggingOf(h.rig)).toBe(false);
    expect(h.clicks).toEqual([]); // a cancelled touch is not a tap
    // the camera rests
    for (let i = 0; i < 300; i++) h.frame(1 / 60); // the follow of the ground settles first
    const rest = h.rig.view;
    for (let i = 0; i < 60; i++) h.frame(1 / 60);
    expect(h.rig.view).toEqual(rest);
    // a wheel zoom afterwards is pulled toward ITS cursor only
    const P = groundAt(h, 700, 150);
    h.stack.wheel({ x: 700, y: 150, deltaY: -300 });
    let worst = 0;
    for (let i = 0; i < 180; i++) {
      h.frame(1 / 60);
      worst = Math.max(worst, offBy(h.rig, P, 700, 150));
    }
    expect(worst).toBeLessThan(3);
    // and the pointer is free again: the next touch is a tap
    h.stack.pointerDown(finger(2, 200, 200));
    h.stack.pointerUp(finger(2, 200, 200));
    expect(h.clicks).toEqual([[200, 200]]);
  });

  it('a mouse press after a press whose release was lost closes the first drag in the rig BEFORE the second one starts', () => {
    const h = harness({ lat: 46.5, lon: 8, heading: 0, tilt: 50 }, 20_000);
    const log = spyOnRig(h);
    h.stack.pointerDown(mouse(400, 300));
    h.stack.pointerMove(mouse(430, 300));
    expect(draggingOf(h.rig)).toBe(true);
    h.stack.pointerDown(mouse(500, 300)); // the release never came
    expect(log).toEqual(['dragStart', 'dragMove', 'dragEnd', 'dragStart']);
    h.stack.pointerUp(mouse(500, 300));
    expect(log[log.length - 1]).toBe('dragEnd');
    expect(draggingOf(h.rig)).toBe(false);
    expect(gripOf(h.rig)).toBeNull();
  });

  it('a second finger that is cancelled ends the pinch in the rig as well', () => {
    const h = harness({ lat: 46.5, lon: 8, heading: 30, tilt: 50 }, 30_000);
    const log = spyOnRig(h);
    h.stack.pointerDown(finger(1, 400, 270));
    h.stack.pointerDown(finger(2, 560, 270));
    h.stack.pointerMove(finger(2, 600, 270));
    h.stack.pointerCancel(finger(2, 600, 270));
    expect(log[log.length - 1]).toBe('dragEnd');
    expect(draggingOf(h.rig)).toBe(false);
    expect(gripOf(h.rig)).toBeNull();
  });

  it('events of another pointer do not end a drag: a foreign pointer-up is ignored, and a touch that merely moves over the canvas shows no hover tooltip', () => {
    const h = harness({ lat: 46.5, lon: 8, heading: 0, tilt: 50 }, 20_000);
    h.stack.pointerDown(mouse(400, 300));
    h.stack.pointerMove(mouse(440, 300));
    h.stack.pointerUp({ ...finger(9, 100, 100) }); // some other pointer lets go
    expect(draggingOf(h.rig)).toBe(true);
    const before = h.rig.view;
    h.stack.pointerMove(mouse(480, 300));
    expect(h.rig.view).not.toEqual(before); // the drag goes on
    h.stack.pointerUp(mouse(480, 300));
    expect(draggingOf(h.rig)).toBe(false);
    h.hovers.length = 0;
    h.stack.pointerMove(finger(5, 300, 300));
    expect(h.hovers).toEqual([]);
    h.stack.pointerMove(mouse(300, 300));
    expect(h.hovers).toEqual([[300, 300]]);
  });

  it('the pointer a mode owns is routed to that mode alone: when its move handler declines, the base mode does not see the move', () => {
    const seen: string[] = [];
    const base: InputMode = { id: 'base', pointerDown: () => (seen.push('base:down'), true), pointerMove: () => (seen.push('base:move'), true), pointerUp: () => (seen.push('base:up'), true) };
    const owner: InputMode = { id: 'owner', pointerDown: () => (seen.push('owner:down'), true), pointerMove: () => (seen.push('owner:move'), false), pointerUp: () => (seen.push('owner:up'), true) };
    const stack = new InputStack(base);
    stack.push(owner);
    expect(stack.pointerDown(mouse(1, 1))).toBe(true);
    expect(stack.pointerMove(mouse(2, 2))).toBe(false); // the owner declined: the base is not asked
    expect(stack.pointerUp(mouse(2, 2))).toBe(true);
    expect(seen).toEqual(['owner:down', 'owner:move', 'owner:up']);
    // a pointer nobody owns goes down the stack as before
    seen.length = 0;
    stack.pointerMove(mouse(3, 3, 0, { id: 7 }));
    expect(seen).toEqual(['owner:move', 'base:move']);
  });
});

describe('modes are the target of clicks, context commands and long presses (M10 placement, M13 deploy, M15 targeting, M20 radial menu)', () => {
  const placing = (log: string[], take = true): InputMode => ({
    id: 'placement',
    click: (x, y) => (log.push(`click ${x},${y}`), take),
    context: (c) => (log.push(`context ${c.cell}`), take),
    longPress: (x, y) => (log.push(`long ${x},${y}`), take),
  });

  it('a pushed mode that takes a click gets it instead of the M05 action; a drag still pans under it; one that declines leaves nothing for the base while it is pushed', () => {
    const h = harness({ lat: 46.5, lon: 8, heading: 0, tilt: 50 }, 20_000);
    const log: string[] = [];
    h.stack.push(placing(log));
    h.stack.pointerDown(mouse(400, 300));
    h.stack.pointerUp(mouse(400, 300));
    expect(log).toEqual(['click 400,300']);
    expect(h.clicks).toEqual([]); // placing a building does not also attack the cell
    // the camera still drags: the mode did not take the press, the base did
    const before = h.rig.view;
    h.stack.pointerDown(mouse(400, 300));
    h.stack.pointerMove(mouse(480, 330));
    h.stack.pointerUp(mouse(480, 330));
    expect(h.rig.view).not.toEqual(before);
    expect(log.length).toBe(1);
    // a mode that declines: the click is not the base's either (the stack is not empty)
    h.stack.pop();
    const declined: string[] = [];
    h.stack.push(placing(declined, false));
    h.stack.pointerDown(mouse(410, 310));
    h.stack.pointerUp(mouse(410, 310));
    expect(declined).toEqual(['click 410,310']);
    expect(h.clicks).toEqual([]);
    // and with the stack empty again the base acts
    h.stack.pop();
    h.stack.pointerDown(mouse(420, 320));
    h.stack.pointerUp(mouse(420, 320));
    expect(h.clicks).toEqual([[420, 320]]);
  });

  it('the topmost mode is offered the click first, and the one below only if the one above declined', () => {
    const h = harness({ lat: 46.5, lon: 8, heading: 0, tilt: 50 }, 20_000);
    const log: string[] = [];
    h.stack.push({ id: 'lower', click: () => (log.push('lower'), true) });
    h.stack.push({ id: 'upper', click: () => (log.push('upper'), false) });
    h.stack.pointerDown(mouse(400, 300));
    h.stack.pointerUp(mouse(400, 300));
    expect(log).toEqual(['upper', 'lower']);
  });

  it('a right click goes to the modes first and the context resolver runs ONLY with an empty stack (M20a); dispatchContext is the same path for the touch radial menu', () => {
    const got: ContextCommand[] = [];
    setContextHandler((c) => got.push(c));
    const h = harness({ lat: 46.5, lon: 8, heading: 0, tilt: 50 }, 600_000);
    const log: string[] = [];
    h.stack.push({ id: 'camera-only' }); // a mode with no opinion about context commands
    h.stack.pointerDown(mouse(480, 270, 2));
    h.stack.pointerUp(mouse(480, 270, 2));
    expect(got.length).toBe(0); // the resolver does not run while a mode is pushed
    h.stack.push(placing(log));
    h.stack.pointerDown(mouse(480, 270, 2));
    h.stack.pointerUp(mouse(480, 270, 2));
    expect(log.length).toBe(1);
    expect(log[0]).toMatch(/^context \d+$/);
    expect(got.length).toBe(0);
    h.stack.clear();
    h.stack.pointerDown(mouse(480, 270, 2));
    h.stack.pointerUp(mouse(480, 270, 2));
    expect(got.length).toBe(1);
    // the radial menu of M20b calls the same entry
    expect(h.stack.dispatchContext({ x: 1, y: 2, cell: 3, lat: 4, lon: 5 })).toBe(true);
    expect(got.length).toBe(2);
    expect(got[1]).toEqual({ x: 1, y: 2, cell: 3, lat: 4, lon: 5 });
    h.stack.push({ id: 'camera-only' });
    expect(h.stack.dispatchContext({ x: 1, y: 2, cell: 3, lat: 4, lon: 5 })).toBe(false);
    expect(got.length).toBe(2);
  });

  it('a touch held for LONG_PRESS_S without moving is a long press: a mode may take it, else it is a context command at that place (once); its release is no tap; a moving or a two-finger touch is none', () => {
    const got: ContextCommand[] = [];
    setContextHandler((c) => got.push(c));
    const h = harness({ lat: 46.5, lon: 8, heading: 0, tilt: 50 }, 600_000);
    const ground = groundAt(h, 300, 300);
    h.stack.pointerDown(finger(1, 300, 300));
    h.t += LONG_PRESS_S - 0.05;
    h.stack.tick(h.t);
    expect(got.length).toBe(0); // not yet
    h.t += 0.1;
    h.stack.tick(h.t);
    expect(got.length).toBe(1);
    const ll = vecToLatLon(ground);
    expect(got[0]?.cell).toBe(latLonToCell(ll.lat, ll.lon, 1024, 512).index);
    expect(got[0]).toMatchObject({ x: 300, y: 300 });
    h.t += 0.5;
    h.stack.tick(h.t);
    expect(got.length).toBe(1); // once
    h.stack.pointerMove(finger(1, 340, 330)); // the rest of the touch does nothing
    h.stack.pointerUp(finger(1, 340, 330));
    expect(h.clicks).toEqual([]);
    expect(got.length).toBe(1);
    // moving past the click threshold: a drag, never a long press
    h.stack.pointerDown(finger(2, 300, 300));
    h.stack.pointerMove(finger(2, 300 + CLICK_MOVE_PX + 4, 300));
    h.t += 2;
    h.stack.tick(h.t);
    h.stack.pointerUp(finger(2, 300 + CLICK_MOVE_PX + 4, 300));
    expect(got.length).toBe(1);
    // two fingers: a gesture, never a long press
    h.stack.pointerDown(finger(3, 300, 300));
    h.stack.pointerDown(finger(4, 400, 300));
    h.t += 2;
    h.stack.tick(h.t);
    h.stack.pointerUp(finger(3, 300, 300));
    h.stack.pointerUp(finger(4, 400, 300));
    expect(got.length).toBe(1);
    // a quick tap is still a click
    h.stack.pointerDown(finger(5, 500, 300));
    h.t += 0.1;
    h.stack.tick(h.t);
    h.stack.pointerUp(finger(5, 500, 300));
    expect(h.clicks).toEqual([[500, 300]]);
    // a pushed mode takes the long press before the resolver
    const log: string[] = [];
    h.stack.push(placing(log));
    h.stack.pointerDown(finger(6, 310, 310));
    h.t += LONG_PRESS_S + 0.1;
    h.stack.tick(h.t);
    expect(log).toEqual(['long 310,310']);
    expect(got.length).toBe(1);
  });

  it('take(): a mode claims a pointer in the middle of a gesture: the base lets go of the camera, and the rest of the gesture goes to the mode alone', () => {
    const h = harness({ lat: 46.5, lon: 8, heading: 0, tilt: 50 }, 20_000);
    const seen: string[] = [];
    const claimer: InputMode = { id: 'claimer', pointerMove: () => (seen.push('move'), true), pointerUp: () => (seen.push('up'), true) };
    h.stack.push(claimer);
    h.stack.pointerDown(mouse(400, 300));
    h.stack.pointerMove(mouse(440, 300));
    expect((h.rig as unknown as { dragging: boolean }).dragging).toBe(true);
    h.stack.take(mouse(440, 300), claimer);
    expect((h.rig as unknown as { dragging: boolean }).dragging).toBe(false);
    const view = h.rig.view;
    h.stack.pointerMove(mouse(500, 330));
    h.stack.pointerUp(mouse(500, 330));
    expect(seen).toEqual(['move', 'up']);
    expect(h.rig.view).toEqual(view); // the camera did not follow
    expect(h.clicks).toEqual([]);
  });
});

describe('the keyboard adapter hands every reserved key to the stack and nothing else', () => {
  interface Env {
    win: EventTarget;
    stack: InputStack;
    got: string[];
    enabled: { on: boolean };
    press(key: string, extra?: Partial<KeyInput> & { defaultPrevented?: boolean }, on?: EventTarget): Event;
  }
  function env(): Env {
    const win = new EventTarget();
    const got: string[] = [];
    const base: InputMode = { id: 'base', key: (k) => (got.push(`base:${k.key}`), false) };
    const stack = new InputStack(base);
    stack.push({ id: 'mode', key: (k) => (got.push(`mode:${k.key}`), k.key !== 'x') });
    const enabled = { on: true };
    attachDomKeys(win, stack, () => enabled.on);
    const press = (key: string, extra: Partial<KeyInput> & { defaultPrevented?: boolean } = {}, on: EventTarget = win): Event => {
      const { defaultPrevented, ...fields } = extra;
      const e = Object.assign(new Event('keydown', { cancelable: true }), { key, ctrlKey: false, altKey: false, metaKey: false, repeat: false }, fields);
      if (defaultPrevented) e.preventDefault();
      on.dispatchEvent(e);
      return e;
    };
    return { win, stack, got, enabled, press };
  }

  it('1 to 6, E, H and F reach the top mode (and are prevented when used); other keys never do', () => {
    const e = env();
    for (const k of ['1', '2', '3', '4', '5', '6', 'e', 'E', 'h', 'H', 'f', 'F']) {
      const ev = e.press(k);
      expect(ev.defaultPrevented, k).toBe(true);
    }
    expect(e.got.filter((g) => g.startsWith('mode:')).length).toBe(12);
    e.got.length = 0;
    for (const k of ['x', 'a', '[', ' ', '7', 'F3']) e.press(k);
    expect(e.got).toEqual([]);
  });

  it('ctrl, alt and meta take the key away from the stack (Ctrl+1 is a browser tab), a disabled page (no match yet) and a text field do not pass keys, and an already handled key is not ours', () => {
    const e = env();
    e.press('1', { ctrlKey: true });
    e.press('3', { altKey: true });
    e.press('h', { metaKey: true });
    expect(e.got).toEqual([]);
    e.enabled.on = false;
    e.press('f');
    expect(e.got).toEqual([]);
    e.enabled.on = true;
    e.press('f', { defaultPrevented: true });
    expect(e.got).toEqual([]);
    const field = Object.assign(new EventTarget(), { tagName: 'INPUT', type: 'text' });
    attachDomKeys(field, e.stack, () => true);
    e.press('f', {}, field);
    expect(e.got).toEqual([]);
    e.press('f');
    expect(e.got).toEqual(['mode:f']);
  });

  it('Escape pops the top mode and is prevented only then; with an empty stack it calls the pause handler and is left to the browser', () => {
    let paused = 0;
    setPauseHandler(() => paused++);
    const e = env();
    const first = e.press('Escape');
    expect(first.defaultPrevented).toBe(true);
    expect(e.stack.depth).toBe(0);
    expect(paused).toBe(0);
    const second = e.press('Escape');
    expect(second.defaultPrevented).toBe(false);
    expect(paused).toBe(1);
  });
});
