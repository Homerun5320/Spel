// Ctx-1: the deploy mode and the ship controller opened with a PRE-PICKED target (the context menu's "send a helicopter / ship here"). The route, marker and verdict show before anything is
// sent, the cursor does not move the pin, a click elsewhere moves it, the confirmation sends. Pure logic with synthetic events; the ship part drives the real controller on the real fixture.
import { describe, expect, it } from 'vitest';
import { createDeployMode, type DeployTarget } from '../../src/app/deployMode';
import { InputStack, type InputMode } from '../../src/app/input';
import { createShipController, type ShipHost, type ShipMatch } from '../../src/app/shipController';
import { launchShipBody } from '../../src/sim/intents';
import { StateView } from '../../src/sim/view';
import { shipFixture } from '../../tools/sim/shipLanding';

const mouse = { id: 1, kind: 'mouse' as const, x: 10, y: 10, button: 0, ctrlKey: false, shiftKey: false };

function deployTarget(verdict: (cell: number) => number) {
  const log: string[] = [];
  const pick = { c: 7 as number | null };
  const t: DeployTarget = {
    pickCell: () => pick.c,
    hover: (c) => log.push(`hover:${c}`),
    decide: verdict,
    send: (c) => log.push(`send:${c}`),
    refused: (r) => log.push(`refused:${r}`),
    exit: () => log.push('exit'),
    ended: () => log.push('ended'),
  };
  return { t, log, pick };
}

describe('the deploy mode with a pinned zone', () => {
  it('pushing it shows the zone at once (hover), the cursor does not move it, nothing is sent until the confirmation', () => {
    const f = deployTarget(() => 0);
    const stack = new InputStack({ id: 'base' } as InputMode);
    const m = createDeployMode(3, f.t, 42);
    stack.push(m);
    expect(f.log).toEqual(['hover:42']);
    expect(m.pinned()).toBe(42);
    expect(m.state().cell).toBe(42);
    m.pointerMove?.({ ...mouse, x: 50, y: 50 });
    m.tick?.(0.1);
    expect(f.log).toEqual(['hover:42']); // the cursor over cell 7 did not move the marker
    expect(m.confirm()).toBe(true);
    expect(f.log).toEqual(['hover:42', 'send:42', 'exit']);
  });

  it('a click on ANOTHER cell moves the pin (no send); a click on the pinned cell sends; a refused pinned zone shows the reason and stays', () => {
    const f = deployTarget((c) => (c === 7 ? 0 : 66));
    const m = createDeployMode(3, f.t, 42);
    expect(m.click?.(10, 10, mouse as never)).toBe(true); // the cursor is over 7, the pin is 42: the pin moves
    expect(f.log).toEqual(['hover:7']);
    expect(m.pinned()).toBe(7);
    m.click?.(10, 10, mouse as never); // now on the pin: sends
    expect(f.log).toEqual(['hover:7', 'send:7', 'exit']);
    const g = deployTarget(() => 70);
    const n = createDeployMode(3, g.t, 7);
    expect(n.confirm()).toBe(false);
    expect(n.context?.({ x: 1, y: 1 } as never)).toBe(true);
    expect(g.log).toEqual(['refused:70', 'refused:70']);
  });

  it('without a preset nothing changed: no pin, the first click sends, confirm does nothing', () => {
    const f = deployTarget(() => 0);
    const m = createDeployMode(3, f.t);
    expect(m.pinned()).toBe(-1);
    expect(m.confirm()).toBe(false);
    m.click?.(10, 10, mouse as never);
    expect(f.log).toEqual(['send:7', 'exit']);
  });

  it('popping the mode forgets the pin', () => {
    const f = deployTarget(() => 0);
    const m = createDeployMode(3, f.t, 42);
    m.onPop?.();
    expect(m.pinned()).toBe(-1);
    expect(f.log.slice(-2)).toEqual(['hover:null', 'ended']);
  });
});

describe('the ship controller with a pinned target', () => {
  function rig() {
    const fx = shipFixture(0, { island: false });
    const view = new StateView(fx.state);
    const sent: unknown[] = [];
    const session: ShipMatch = { view, localSeat: 0, localOwner: 1, submit: (b) => sent.push(b) };
    const stack = new InputStack({ id: 'base' } as InputMode);
    const marks: Array<[number, number]> = [];
    const route: Array<readonly number[] | null> = [];
    const host: ShipHost = {
      match: () => session,
      stack,
      pickCell: () => null,
      cameraMoved: () => true,
      setRoute: (cells) => route.push(cells),
      setMarker: (cell, state) => marks.push([cell, state]),
      toast: () => undefined,
      exitOthers: () => undefined,
    };
    const box = { root: null as never, troops: () => 100, update: () => undefined, dispose: () => undefined };
    return { fx, ctl: createShipController(host, () => box), stack, sent, marks, route };
  }

  it('enter(port, target) pins the cell: the next frame shows the green marker and the sim\'s route, and confirm sends exactly that', () => {
    const r = rig();
    r.ctl.enter(r.fx.port, r.fx.target);
    expect(r.ctl.info().pinned).toBe(r.fx.target);
    r.ctl.frame();
    expect(r.ctl.info()).toMatchObject({ active: true, pinned: r.fx.target, reason: 0, markerState: 1 });
    expect(r.marks.at(-1)).toEqual([r.fx.target, 1]);
    expect(r.route.at(-1)?.at(-1)).toBe(r.fx.target);
    expect(r.sent).toEqual([]);
    expect(r.ctl.confirm()).toBe(true);
    expect(r.sent).toEqual([launchShipBody(0, r.fx.port, r.fx.target, 100)]);
    expect(r.stack.depth).toBe(0);
  });

  it('entering again for the same Port with a new target moves the pin instead of doing nothing; without a target the old behaviour (no pin) holds', () => {
    const r = rig();
    r.ctl.enter(r.fx.port);
    expect(r.ctl.info().pinned).toBe(-1);
    r.ctl.enter(r.fx.port, r.fx.target);
    expect(r.ctl.info().pinned).toBe(r.fx.target);
    expect(r.stack.depth).toBe(1);
  });
});
