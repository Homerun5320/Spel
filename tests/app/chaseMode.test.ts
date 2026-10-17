// M13a-2: the chase camera. A helicopter flies a straight line over the Alps at 80 m above the visible ground (the lowest the sim allows is about that); the camera
// follows it through the mode and must clear the displaced ground under IT the whole way. Escape, H, a press and the wheel end the mode; a lost helicopter ends it
// with the flag; key H starts it from the base mode and a modal blocks the key (the registry).
import { beforeAll, describe, expect, it } from 'vitest';
import { HELI_CHASE_BACK_M, HELI_CHASE_CLEAR_M, HELI_CHASE_UP_M } from '../../src/render/config';
import { latLonToVec } from '../../src/render/geo';
import { chaseView, createChaseMode, type ChasePose, type ChaseTarget } from '../../src/app/chaseMode';
import { HotkeyRegistry, registerGameHotkeys } from '../../src/app/hotkeys';
import { InputStack, createBaseMode, resetInputHandlers, type InputTarget, type PointerInput } from '../../src/app/input';
import { loadRtsWorld, makeRtsRig, R_M, type RtsWorld } from '../helpers/rtsRig';
import { bindHeightSource } from '../../src/render/detail';

let w: RtsWorld;
beforeAll(async () => {
  w = await loadRtsWorld();
  bindHeightSource(w.world.detailField.sampler as NonNullable<typeof w.world.detailField.sampler>);
});

const press: PointerInput = { id: 1, kind: 'mouse', x: 10, y: 10, button: 0, ctrlKey: false, shiftKey: false };

function harness(path: (step: number) => ChasePose | null) {
  const rig = makeRtsRig(w, { lat: 46.5, lon: 8, distKm: 300, heading: 0, tilt: 0 });
  let step = 0;
  const log = { exits: [] as boolean[], ended: 0, flights: 0, applied: 0 };
  const held: { stack: InputStack | null } = { stack: null };
  const target: ChaseTarget = {
    read: (_id, out) => {
      const p = path(step);
      if (p === null) return false;
      Object.assign(out, p);
      return true;
    },
    groundRadius: (lat, lon) => rig.groundRadius(lat, lon),
    apply: (v) => {
      log.applied++;
      rig.setViewUnclamped(v);
    },
    cancelFlight: () => void log.flights++,
    exit: (lost) => {
      log.exits.push(lost);
      if (held.stack?.top.id.startsWith('chase') === true) held.stack?.pop();
    },
    ended: () => void log.ended++,
  };
  const base = createBaseMode({ camera: rig, now: () => 0, cancelFlight: () => undefined, click: () => undefined, pickCell: () => null, hover: () => undefined, hoverEnd: () => undefined, focusCapital: () => undefined } as InputTarget);
  const stack = new InputStack(base);
  held.stack = stack;
  const mode = createChaseMode(3, target);
  return { rig, stack, mode, log, next: () => void step++ };
}

describe('the chase camera', () => {
  it('clears the displaced ground under the camera the whole flight over the Alps, 80 m above the ground', () => {
    const agl = 80;
    const path = (i: number): ChasePose => {
      const lon = 7.5 + i * 0.004;
      const lat = 46.45 + Math.sin(i * 0.05) * 0.1;
      return { lat, lon, heading: 90, radius: w.ground(lat, lon) + agl / R_M };
    };
    const h = harness(path);
    h.stack.push(h.mode);
    let worst = Infinity;
    for (let i = 0; i < 700; i++) {
      h.next();
      h.stack.tick(i * 0.1);
      const cam = h.rig.aglM();
      worst = Math.min(worst, cam);
    }
    console.log(`[chase] lowest camera height over the ground ${worst.toFixed(1)} m over 700 steps`);
    expect(worst).toBeGreaterThan(HELI_CHASE_CLEAR_M - 5);
    expect(h.log.flights).toBe(1);
    expect(h.log.applied).toBe(701);
  });

  it('chaseView puts the camera behind and above the helicopter and looks at it', () => {
    const lat = 46.5;
    const lon = 9;
    const pose: ChasePose = { lat, lon, heading: 90, radius: w.ground(lat, lon) + 300 / R_M };
    const view = chaseView(pose, w.ground);
    const rig = makeRtsRig(w, view);
    // the camera stands west of an east-flying helicopter, and the helicopter is in front of it
    const camPos = rig.pose().position;
    const heli = latLonToVec(lat, lon).map((c) => c * pose.radius) as [number, number, number];
    // above it, and about HELI_CHASE_BACK_M west of it
    expect(Math.hypot(...camPos)).toBeGreaterThan(pose.radius);
    const back = Math.hypot(camPos[0] - heli[0], camPos[1] - heli[1], camPos[2] - heli[2]) * R_M;
    expect(back).toBeGreaterThan(HELI_CHASE_BACK_M * 0.9);
    expect(back).toBeLessThan(Math.hypot(HELI_CHASE_BACK_M, HELI_CHASE_UP_M) * 1.2);
    // and the helicopter is on the screen, in the middle
    const sp = rig.project(heli);
    expect(sp.inView && sp.facing).toBe(true);
    expect(Math.abs(sp.x - 480)).toBeLessThan(120);
    expect(Math.abs(sp.y - 270)).toBeLessThan(120);
  });

  it('Escape, H, a press and the wheel end the ride; the press and the wheel go on to the camera below; a lost helicopter ends it with the flag', () => {
    const still = (): ChasePose => ({ lat: 46.5, lon: 9, heading: 0, radius: w.ground(46.5, 9) + 100 / R_M });
    {
      const h = harness(still);
      h.stack.push(h.mode);
      expect(h.stack.key({ key: 'Escape', ctrlKey: false, altKey: false, metaKey: false })).toBe(true);
      expect([h.stack.depth, h.log.ended]).toEqual([0, 1]);
    }
    {
      const h = harness(still);
      h.stack.push(h.mode);
      expect(h.stack.key({ key: 'h', ctrlKey: false, altKey: false, metaKey: false })).toBe(true);
      expect([h.stack.depth, h.log.exits, h.log.ended]).toEqual([0, [false], 1]);
    }
    {
      const h = harness(still);
      h.stack.push(h.mode);
      // a press is not taken: the base mode below grips the camera for a drag
      expect(h.mode.pointerDown?.(press)).toBe(false);
      expect(h.stack.depth).toBe(0);
    }
    {
      const h = harness(still);
      h.stack.push(h.mode);
      expect(h.mode.wheel?.({ x: 1, y: 1, deltaY: 100 })).toBe(false);
      expect(h.stack.depth).toBe(0);
    }
    {
      let alive = true;
      const h = harness(() => (alive ? still() : null));
      h.stack.push(h.mode);
      h.stack.tick(0.1);
      expect(h.stack.depth).toBe(1);
      alive = false;
      h.stack.tick(0.2);
      expect([h.stack.depth, h.log.exits]).toEqual([0, [true]]);
    }
  });
});

describe('key H', () => {
  it('starts the ride from the base mode, and a modal blocks the key before it reaches the stack', () => {
    resetInputHandlers();
    let started = 0;
    const base = createBaseMode({ camera: {} as never, now: () => 0, cancelFlight: () => undefined, click: () => undefined, pickCell: () => null, hover: () => undefined, hoverEnd: () => undefined, focusCapital: () => undefined, chase: () => void started++ } as InputTarget);
    const stack = new InputStack(base);
    const reg = new HotkeyRegistry();
    let modal = false;
    reg.context = { matchOn: () => true, modalOpen: () => modal };
    registerGameHotkeys(reg, { stack, toggleOverlay: () => undefined, commit: () => undefined, togglePause: () => undefined, slower: () => undefined, faster: () => undefined, toggleHelp: () => undefined });
    const h = { key: 'h', ctrlKey: false, altKey: false, metaKey: false, repeat: false, typing: false };
    expect(reg.handle(h)).toBe(true);
    expect(started).toBe(1);
    expect(reg.handle({ ...h, key: 'H' })).toBe(true);
    expect(started).toBe(2);
    modal = true; // the pause menu, the elimination panel or the result screen is up
    expect(reg.handle(h)).toBe(false);
    expect(started).toBe(2);
    modal = false;
    expect(reg.handle({ ...h, typing: true })).toBe(false); // a text field has the focus
    expect(started).toBe(2);
    expect(reg.find('h')?.scope).toBe('stack'); // the reserved key goes to the stack
  });
});
