// M13c-2: the ship preview (the sim's own verdict and route, proven against the real launch), the ship mode (an input mode with synthetic events) and the ship controller (the page glue,
// driven with a fake host). The world is the M13c-1 fixture of tools/sim/shipLanding.ts.
import { describe, expect, it } from 'vitest';
import { HotkeyRegistry, registerGameHotkeys } from '../../src/app/hotkeys';
import { InputStack, isReservedKey, type InputMode } from '../../src/app/input';
import { TABLES } from '../../src/ui/i18n';
import { createShipController, type ShipHost, type ShipMatch } from '../../src/app/shipController';
import { createShipMode, type ShipTarget } from '../../src/app/shipMode';
import { previewShip, routeLengthQ8, shipEtaSeconds } from '../../src/app/shipPreview';
import { launchShipBody } from '../../src/sim/intents';
import { REJECT_SHIP_BAD_TARGET, REJECT_SHIP_NO_ROUTE, REJECT_SHIP_TROOPS_HIGH } from '../../src/sim/public';
import { SHIP_CELLS_PER_TICK_Q, SHIP_MAX_TROOPS, TICK_HZ } from '../../src/sim/rules';
import { applyLaunchShip, shipPhase } from '../../src/sim/shipPhase';
import { SHIP_LAND } from '../../src/sim/shipTable';
import { StateView } from '../../src/sim/view';
import { SHIP } from '../../src/ui/uiConfig';
import type { ShipBox, ShipBoxModel } from '../../src/ui/shipBox';
import { SHIP_W as W, shipFixture } from '../../tools/sim/shipLanding';

const at = (x: number, y: number): number => y * W + x;

describe('previewShip: the sim\'s own verdict and route, not a copy', () => {
  it('the verdict is the real launch\'s and the waypoints are the route the real ship gets', () => {
    for (const [seed, island] of [[0, false], [3, true]] as const) {
      const fx = shipFixture(seed, { island });
      const view = new StateView(fx.state);
      const p = previewShip(view, 0, fx.port, fx.target, 100);
      expect(p.reason).toBe(0);
      expect(p.waypoints).not.toBeNull();
      expect(applyLaunchShip(fx.state, 0, fx.port, fx.target, 100)).toBe(0);
      const t = fx.state.ships;
      const real = Array.from({ length: t.routeLen[0] as number }, (_, k) => t.routeCell(0, k));
      expect(p.waypoints).toEqual(real);
      expect(p.waypoints?.length).toBeGreaterThanOrEqual(island ? 3 : 2); // the island makes the route turn
    }
  });

  it('the sailing time is the real one: the ship reaches the end of its route within the announced seconds, and not a second sooner', () => {
    const fx = shipFixture(0, { island: false });
    const target = at(144, 24);
    const p = previewShip(new StateView(fx.state), 0, fx.port, target, 100);
    expect(applyLaunchShip(fx.state, 0, fx.port, target, 100)).toBe(0);
    let ticks = 0;
    while ((fx.state.ships.state[0] as number) !== SHIP_LAND && ticks < 5000) {
      shipPhase(fx.state);
      fx.state.tick++;
      ticks++;
    }
    expect(p.etaSeconds).toBe(Math.ceil(ticks / TICK_HZ));
    expect(p.etaSeconds).toBeGreaterThan(0);
  });

  it('a refused cell still shows its route when there is one (the verdict says why), and none when there is no sea way to it', () => {
    const fx = shipFixture(0, { island: false });
    const view = new StateView(fx.state);
    const tooMany = previewShip(view, 0, fx.port, fx.target, SHIP_MAX_TROOPS + 1);
    expect(tooMany.reason).toBe(REJECT_SHIP_TROOPS_HIGH);
    expect(tooMany.waypoints).not.toBeNull();
    expect(previewShip(view, 0, fx.port, at(110, 28), 100).reason).toBe(REJECT_SHIP_BAD_TARGET); // open sea: refused (the line may still be shown)
    expect(previewShip(view, 0, fx.port, at(10, 28), 100)).toMatchObject({ reason: REJECT_SHIP_BAD_TARGET, waypoints: null, etaSeconds: 0 }); // own inland: no sea way to it
    const w = shipFixture(0, { island: false });
    for (let y = 0; y < 64; y++) w.state.terrain[at(120, y)] = 2;
    expect(previewShip(new StateView(w.state), 0, w.port, w.target, 100)).toMatchObject({ reason: REJECT_SHIP_NO_ROUTE, waypoints: null });
    expect(previewShip(view, 0, 9999, 5, 100).waypoints).toBeNull();
  });

  it('the route length wraps over the date line like the sim\'s steps do', () => {
    expect(routeLengthQ8(W, [at(2, 4), at(W - 2, 4)], 2)).toBe(4 * 256);
    expect(routeLengthQ8(W, [at(2, 4), at(2, 9)], 2)).toBe(5 * 256);
    expect(shipEtaSeconds(W, [at(0, 0), at(46, 0)], 2)).toBe(Math.ceil((46 * 256) / SHIP_CELLS_PER_TICK_Q / TICK_HZ));
  });
});

const mouse = { id: 1, kind: 'mouse' as const, x: 10, y: 10, button: 0, ctrlKey: false, shiftKey: false };

function modeTarget(cells: { c: number | null } = { c: 7 }) {
  const log: string[] = [];
  const t: ShipTarget = {
    pickCell: () => cells.c,
    hover: (c) => log.push(`hover:${c}`),
    pin: (c) => log.push(`pin:${c}`),
    exit: () => log.push('exit'),
    ended: () => log.push('ended'),
  };
  return { t, log, cells };
}

describe('the ship mode', () => {
  it('a left click only PINS the cell (it never sends and never leaves), a click beside the globe does nothing, a right click leaves', () => {
    const f = modeTarget();
    const m = createShipMode(3, f.t);
    expect(m.click?.(10, 10, mouse)).toBe(true);
    expect(f.log).toEqual(['pin:7']);
    f.cells.c = null;
    m.click?.(1, 1, mouse);
    expect(f.log).toEqual(['pin:7']);
    expect(m.context?.({ x: 1, y: 1, cell: 0, lat: 0, lon: 0 })).toBe(true);
    expect(f.log).toEqual(['pin:7', 'exit']);
  });

  it('hover reports a change of cell only, a resting camera is not picked again, and the pop clears the hover and says "ended"', () => {
    const f = modeTarget();
    let moved = true;
    f.t.cameraMoved = () => moved;
    const m = createShipMode(3, f.t);
    m.pointerMove?.({ ...mouse, x: 5, y: 5 });
    expect(m.pointerMove?.({ ...mouse, kind: 'touch' as never })).toBe(false); // a touch has no hover
    moved = false;
    f.cells.c = 8;
    m.tick?.(0.1); // the camera stands still: no new pick
    expect(f.log).toEqual(['hover:7']);
    moved = true;
    m.tick?.(0.2);
    expect(f.log).toEqual(['hover:7', 'hover:8']);
    expect(m.state()).toEqual({ cell: 8, port: 3 });
    m.onPop?.();
    expect(f.log.slice(-2)).toEqual(['hover:null', 'ended']);
  });

  it('on the input stack Escape pops it and ends it', () => {
    const f = modeTarget();
    const base: InputMode = { id: 'base' };
    const stack = new InputStack(base);
    stack.push(createShipMode(3, f.t));
    expect(stack.depth).toBe(1);
    expect(stack.key({ key: 'Escape', ctrlKey: false, altKey: false, metaKey: false, repeat: false, typing: false })).toBe(true);
    expect(stack.depth).toBe(0);
    expect(f.log).toContain('ended');
  });
});

/** A fake page around the real fixture: the controller drives the real mode on a real stack and asks the sim's real check. */
function rig(seed = 0, island = false) {
  const fx = shipFixture(seed, { island });
  const view = new StateView(fx.state);
  const sent: unknown[] = [];
  const toasts: string[] = [];
  const route: Array<readonly number[] | null> = [];
  const marks: Array<[number, number]> = [];
  const session: ShipMatch = { view, localSeat: 0, localOwner: 1, submit: (b) => sent.push(b) };
  const stack = new InputStack({ id: 'base' } as InputMode);
  let pick: number | null = null;
  const host: ShipHost = {
    match: () => session,
    stack,
    pickCell: () => pick,
    cameraMoved: () => true,
    setRoute: (cells) => route.push(cells),
    setMarker: (cell, state) => marks.push([cell, state]),
    toast: (key) => toasts.push(key),
    exitOthers: () => undefined,
  };
  let troops = 100;
  const modelLog: ShipBoxModel[] = [];
  const box = { root: null as never, troops: () => troops, update: (m: ShipBoxModel) => modelLog.push({ ...m }), dispose: () => undefined } as ShipBox;
  const ctl = createShipController(host, () => box);
  return { fx, ctl, stack, sent, toasts, route, marks, modelLog, setPick: (c: number | null) => (pick = c), setTroops: (n: number) => (troops = n), view };
}

describe('the ship controller', () => {
  it('start, hover (yellow marker), click (green marker and the sim\'s route), confirm sends LaunchShip with the slider\'s troops and leaves the mode', () => {
    const r = rig(3, true);
    r.ctl.enter(r.fx.port);
    expect(r.ctl.isActive()).toBe(true);
    expect(r.stack.depth).toBe(1);
    r.setPick(r.fx.target);
    r.stack.top.pointerMove?.({ ...mouse, x: 20, y: 20 });
    r.ctl.frame();
    expect(r.marks.at(-1)).toEqual([r.fx.target, 0]); // hovered, nothing asked yet: yellow
    expect(r.route.at(-1) ?? null).toBeNull();
    r.stack.top.click?.(20, 20, mouse);
    r.setTroops(150);
    r.ctl.frame();
    const i = r.ctl.info();
    expect([i.active, i.pinned, i.reason, i.markerState]).toEqual([true, r.fx.target, 0, 1]);
    const line = r.route.at(-1);
    expect(line).not.toBeNull();
    expect(line?.at(-1)).toBe(r.fx.target); // the line runs on to the landing cell
    expect((line?.length ?? 0)).toBeGreaterThanOrEqual(3);
    expect(r.sent).toEqual([]); // nothing is sent by a click
    expect(r.ctl.confirm()).toBe(true);
    expect(r.sent).toEqual([launchShipBody(0, r.fx.port, r.fx.target, 150)]);
    expect(r.ctl.isActive()).toBe(false);
    expect(r.stack.depth).toBe(0);
    expect(r.route.at(-1)).toBeNull();
    expect(r.marks.at(-1)).toEqual([-1, 0]);
  });

  it('a refused cell is red and cannot be confirmed; the verdict follows the slider (too many troops), and a valid cell then confirms', () => {
    const r = rig();
    r.ctl.enter(r.fx.port);
    r.setPick(at(110, 28)); // open sea
    r.stack.top.click?.(1, 1, mouse);
    r.ctl.frame();
    expect([r.ctl.info().reason, r.ctl.info().markerState]).toEqual([REJECT_SHIP_BAD_TARGET, 2]);
    expect(r.ctl.confirm()).toBe(false);
    r.setPick(r.fx.target);
    r.stack.top.click?.(1, 1, mouse);
    r.setTroops(SHIP_MAX_TROOPS + 5);
    r.ctl.frame();
    expect(r.ctl.info().reason).toBe(REJECT_SHIP_TROOPS_HIGH);
    expect(r.ctl.confirm()).toBe(false);
    r.setTroops(SHIP.troopsDefault);
    r.ctl.frame();
    expect(r.ctl.info().reason).toBe(0);
    expect(r.ctl.confirm()).toBe(true);
    expect(r.sent).toHaveLength(1);
  });

  it('a dimmed Port does not start the mode and shows the reason; Escape and the toggle leave; losing the Port leaves', () => {
    const r = rig();
    r.fx.state.gold[1] = 0;
    r.view.refresh();
    r.ctl.enter(r.fx.port);
    expect(r.ctl.isActive()).toBe(false);
    expect(r.toasts).toEqual(['reject.ship.noGold']);
    r.ctl.enter(99);
    expect(r.toasts.at(-1)).toBe('reject.ship.noPort');
    const q = rig();
    q.ctl.toggle(q.fx.port);
    expect(q.ctl.isActive()).toBe(true);
    q.ctl.toggle(q.fx.port);
    expect(q.ctl.isActive()).toBe(false);
    q.ctl.enter(q.fx.port);
    q.stack.key({ key: 'Escape', ctrlKey: false, altKey: false, metaKey: false, repeat: false, typing: false });
    expect(q.ctl.isActive()).toBe(false);
    q.ctl.enter(q.fx.port);
    q.fx.state.structures.owner[q.fx.port] = 0; // the Port is lost
    q.ctl.frame();
    expect(q.ctl.isActive()).toBe(false);
    expect(q.stack.depth).toBe(0);
  });

  it('the box model carries the fee, the fleet, the slider top and the preview status', () => {
    const r = rig();
    r.ctl.boxFrame(r.fx.port);
    expect(r.modelLog.at(-1)).toMatchObject({ reason: 0, price: 100, fleet: 0, cap: 4, active: false, status: 'idle', maxTroops: SHIP_MAX_TROOPS });
    r.ctl.enter(r.fx.port);
    r.setPick(r.fx.target);
    r.stack.top.click?.(1, 1, mouse);
    r.ctl.frame();
    r.ctl.boxFrame(r.fx.port);
    expect(r.modelLog.at(-1)).toMatchObject({ active: true, status: 'valid', previewReason: 0 });
    expect(r.modelLog.at(-1)?.etaSeconds).toBeGreaterThan(0);
  });
});


describe('the one shortcut of the ship mode', () => {
  it('B is a match entry (not a reserved key) with a text in both languages, it calls the page, and it is behind a modal and in a text field dead like the others', () => {
    const reg = new HotkeyRegistry();
    const log: string[] = [];
    reg.context = { matchOn: () => true, modalOpen: () => false };
    registerGameHotkeys(reg, { stack: new InputStack({ id: 'base' } as InputMode), toggleOverlay: () => undefined, commit: () => undefined, togglePause: () => undefined, slower: () => undefined, faster: () => undefined, toggleHelp: () => undefined, ship: () => log.push('ship') });
    const def = reg.find('b');
    expect(def?.id).toBe('ship');
    expect([def?.scope, def?.labelKey, def?.hidden]).toEqual(['match', 'hotkey.ship', undefined]);
    expect(isReservedKey('b')).toBe(false);
    expect(reg.listed().map((d) => d.id)).toContain('ship'); // it is in the help overlay
    expect(TABLES.sv['hotkey.ship']).toBeTruthy();
    expect(TABLES.en['hotkey.ship']).toBeTruthy();
    const ev = { key: 'B', ctrlKey: false, altKey: false, metaKey: false, repeat: false, typing: false };
    expect(reg.handle(ev)).toBe(true);
    expect(reg.handle({ ...ev, typing: true })).toBe(false);
    expect(reg.handle({ ...ev, repeat: true })).toBe(false);
    expect(log).toEqual(['ship']);
  });
});
