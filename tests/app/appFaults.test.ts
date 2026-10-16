// Fix-4B (audit 3, 1.6): the faults and test holes the independent review found in the app layer, each pinned by a test that was shown to fail against the mutant named in its
// title (the table is in docs/DECISIONS.md, Fix-4B). Hotkeys: the DOM adapter and the registry; command resolver: the left / right click rows; deploy mode: touch, long press,
// the pick under a resting camera; the helicopter rows: reused objects.
import { describe, expect, it } from 'vitest';
import { resolveCommand, type CommandContext, type CommandSelection, type CommandTarget } from '../../src/app/commandResolver';
import { createDeployMode, type DeployTarget } from '../../src/app/deployMode';
import { HotkeyRegistry, attachHotkeys, registerGameHotkeys, registerPageHotkeys, type GameHotkeyActions } from '../../src/app/hotkeys';
import { InputStack, type InputMode, type PointerInput } from '../../src/app/input';
import { ownHeliRows, type HeliRow } from '../../src/ui/heliInfo';
import { HELI_CRUISE, HELI_PAD, STRUCT_CITY, STRUCT_FACTORY, type SimView } from '../../src/sim/public';
import { HeliTable } from '../../src/sim/heliTable';
import { CLASS_PLAINS } from '../../src/sim/terrain';

// ---- the hotkey adapter --------------------------------------------------------------------------------------------------------------

/** A keydown on a plain EventTarget (the Node one: no DOM needed). Returns the event so that a test can ask whether it was prevented. */
function press(target: EventTarget, key: string, extra: Record<string, unknown> = {}): Event {
  const e = new Event('keydown', { cancelable: true });
  Object.assign(e, { key, ctrlKey: false, altKey: false, metaKey: false, repeat: false }, extra);
  target.dispatchEvent(e);
  return e;
}

describe('attachHotkeys (the one keydown listener of the game)', () => {
  const stackless = (): { reg: HotkeyRegistry; runs: string[] } => {
    const reg = new HotkeyRegistry();
    const runs: string[] = [];
    reg.context = { matchOn: () => true, modalOpen: () => false };
    reg.register({ id: 'a', keys: ['x'], labelKey: 'hotkey.pause', scope: 'match', run: () => (runs.push('x'), true) });
    reg.register({ id: 'q', keys: ['y'], labelKey: 'hotkey.pause', scope: 'match', run: () => (runs.push('y'), 'quiet') });
    reg.register({ id: 'n', keys: ['z'], labelKey: 'hotkey.pause', scope: 'match', run: () => (runs.push('z'), false) });
    return { reg, runs };
  };

  it('prevents the browser default for a used key, NOT for a quiet one and not for an unused one (mutant: `quiet` is prevented too)', () => {
    const { reg, runs } = stackless();
    const target = new EventTarget();
    attachHotkeys(target, reg);
    expect(press(target, 'x').defaultPrevented).toBe(true);
    expect(press(target, 'y').defaultPrevented).toBe(false);
    expect(press(target, 'z').defaultPrevented).toBe(false);
    expect(press(target, 'k').defaultPrevented).toBe(false);
    expect(runs).toEqual(['x', 'y', 'z']);
  });

  it('every target gets its own listener, once (mutant: a module-wide flag lets only the first target ever attach; or attaching twice doubles the runs)', () => {
    const a = stackless();
    const b = stackless();
    const t1 = new EventTarget();
    const t2 = new EventTarget();
    attachHotkeys(t1, a.reg);
    attachHotkeys(t1, a.reg); // the same target again: still one listener
    attachHotkeys(t2, b.reg);
    press(t1, 'y'); // a quiet key: the first listener does not prevent it, so a second listener on the same target would run it again
    press(t2, 'x');
    expect(a.runs).toEqual(['y']);
    expect(b.runs).toEqual(['x']);
  });

  it('an event somebody else already handled (defaultPrevented) is not ours; typing in a text field is not either', () => {
    const { reg, runs } = stackless();
    const target = new EventTarget();
    attachHotkeys(target, reg);
    const e = new Event('keydown', { cancelable: true });
    Object.assign(e, { key: 'x', ctrlKey: false, altKey: false, metaKey: false, repeat: false });
    e.preventDefault();
    target.dispatchEvent(e);
    expect(runs).toEqual([]);
    // typing: the event's target is a text field
    const field = Object.assign(new EventTarget(), { tagName: 'INPUT', type: 'text' });
    attachHotkeys(field, reg);
    press(field, 'x');
    expect(runs).toEqual([]);
  });
});

describe('the game hotkeys: the details the review found open', () => {
  const game = (): { reg: HotkeyRegistry; log: string[] } => {
    const log: string[] = [];
    const reg = new HotkeyRegistry();
    reg.context = { matchOn: () => true, modalOpen: () => false };
    const base: InputMode = { id: 'base', key: () => false };
    const a: GameHotkeyActions = {
      stack: new InputStack(base),
      toggleOverlay: () => log.push('overlay'),
      commit: () => log.push('commit'),
      togglePause: () => log.push('pause'),
      slower: () => log.push('slower'),
      faster: () => log.push('faster'),
      toggleHelp: () => log.push('help'),
      deploy: () => log.push('deploy'),
      toggleDiplomacy: () => log.push('diplo'),
    };
    registerGameHotkeys(reg, a);
    return { reg, log };
  };
  const ev = (key: string, repeat = false) => ({ key, ctrlKey: false, altKey: false, metaKey: false, repeat, typing: false });

  it('L and D do not repeat while the key is held (mutant: `noRepeat` dropped from deploy)', () => {
    const { reg, log } = game();
    expect(reg.handle(ev('l'))).toBe(true);
    expect(reg.handle(ev('l', true))).toBe(false);
    expect(reg.handle(ev('d'))).toBe(true);
    expect(reg.handle(ev('d', true))).toBe(false);
    expect(log).toEqual(['deploy', 'diplo']);
  });

  it('the hidden E and H are registered (so no other code can bind them) but the help overlay does not list them (mutant: `listed` returns every entry)', () => {
    const { reg } = game();
    expect(reg.find('e')?.hidden).toBe(true);
    expect(reg.find('h')?.hidden).toBe(true);
    const listedKeys = reg.listed().flatMap((d) => d.keys);
    expect(listedKeys).not.toContain('e');
    expect(listedKeys).not.toContain('h');
    expect(listedKeys).toContain('l');
  });

  it('the page entry registers F2 once: asking again changes nothing and does not throw (mutant: the guard is gone)', () => {
    const reg = new HotkeyRegistry();
    registerPageHotkeys(reg);
    expect(() => registerPageHotkeys(reg)).not.toThrow();
    expect(reg.entries().filter((d) => d.id === 'devpanel').length).toBe(1);
  });
});

// ---- the command resolver -----------------------------------------------------------------------------------------------------------

describe('the resolver rows the review found open', () => {
  const ctx: CommandContext = { localOwner: 3, spawned: true, spawnPhase: false };
  const factory: CommandSelection = { structure: 4, structureType: STRUCT_FACTORY, placing: 0 };
  const land = (owner: number, ownStructure = -1): CommandTarget => ({ cell: 10, terrainClass: CLASS_PLAINS, owner, ownStructure });

  it('a LEFT click with a Factory selected never opens the deploy mode; only the right click does (mutant: `primary` added to the rule)', () => {
    expect(resolveCommand('primary', factory, land(7), ctx).kind).not.toBe('deploy');
    expect(resolveCommand('primary', factory, land(7), ctx)).toEqual({ kind: 'deselect' });
    expect(resolveCommand('context', factory, land(7), ctx)).toEqual({ kind: 'deploy', factory: 4 });
  });

  it('while a structure is being PLACED a right click does not open the deploy mode, even with a Factory marked (mutant: the placing test is dropped)', () => {
    const both: CommandSelection = { structure: 4, structureType: STRUCT_FACTORY, placing: STRUCT_CITY };
    expect(resolveCommand('context', both, land(3), ctx).kind).not.toBe('deploy');
  });

  it('a RIGHT click on another own structure deselects instead of reselecting it; the left click reselects (mutant: the trigger test is dropped)', () => {
    const city: CommandSelection = { structure: 1, structureType: STRUCT_CITY, placing: 0 };
    expect(resolveCommand('context', city, land(3, 9), ctx)).toEqual({ kind: 'deselect' });
    expect(resolveCommand('primary', city, land(3, 9), ctx)).toEqual({ kind: 'select', structure: 9 });
  });
});

// ---- the deploy mode ----------------------------------------------------------------------------------------------------------------

describe('the deploy mode: touch, long press, and the pick under a resting camera', () => {
  const mouse: PointerInput = { id: 1, kind: 'mouse', x: 10, y: 10, button: 0, ctrlKey: false, shiftKey: false };
  const touch: PointerInput = { ...mouse, kind: 'touch' };

  function rig(cameraMoved?: () => boolean) {
    const log: string[] = [];
    let picks = 0;
    const t: DeployTarget = {
      pickCell: () => (picks++, 7),
      hover: (c) => log.push(`hover:${c}`),
      decide: () => 0,
      send: (c) => log.push(`send:${c}`),
      refused: (r) => log.push(`refused:${r}`),
      exit: () => log.push('exit'),
      ended: () => log.push('ended'),
      ...(cameraMoved === undefined ? {} : { cameraMoved }),
    };
    return { mode: createDeployMode(1, t), log, picks: () => picks };
  }

  it('a touch move does not move the marker (mutant: any pointer kind is taken), a mouse move does and takes the event (no hover tooltip)', () => {
    const f = rig();
    expect(f.mode.pointerMove?.(touch)).toBe(false);
    expect(f.log).toEqual([]);
    expect(f.mode.pointerMove?.(mouse)).toBe(true);
    expect(f.log).toEqual(['hover:7']);
  });

  it('a long press is not consumed here (it comes to `context`) and sends nothing (mutant: returns true)', () => {
    const f = rig();
    expect(f.mode.longPress?.(10, 10, touch)).toBe(false);
    expect(f.log).toEqual([]);
  });

  it('tick picks only when the camera moved: a resting cursor under a resting camera costs no pick (mutant: `cameraMoved` ignored)', () => {
    let moved = true;
    const f = rig(() => moved);
    f.mode.pointerMove?.(mouse); // one pick
    const afterMove = f.picks();
    moved = false;
    for (let i = 0; i < 30; i++) f.mode.tick?.(i);
    expect(f.picks()).toBe(afterMove);
    moved = true;
    f.mode.tick?.(31);
    expect(f.picks()).toBe(afterMove + 1);
  });

  it('tick before any cursor position is known does nothing, with or without the hook', () => {
    const f = rig(() => true);
    f.mode.tick?.(0);
    expect(f.picks()).toBe(0);
    const g = rig();
    g.mode.tick?.(0);
    expect(g.picks()).toBe(0);
  });

  it('without the hook it picks every tick (the old behaviour)', () => {
    const f = rig();
    f.mode.pointerMove?.(mouse);
    const n = f.picks();
    f.mode.tick?.(1);
    f.mode.tick?.(2);
    expect(f.picks()).toBe(n + 2);
  });
});

// ---- the helicopter rows ------------------------------------------------------------------------------------------------------------

describe('ownHeliRows reuses its row objects (no allocation per call once the buffer is filled)', () => {
  function view(rows: Array<{ owner: number; state: number; load: number }>): SimView {
    const t = new HeliTable(4);
    rows.forEach((r, i) => {
      t.owner[i] = r.owner;
      t.state[i] = r.state;
      t.load[i] = r.load;
      t.fuel[i] = 0;
    });
    t.highWater = rows.length;
    return { helis: t, tick: 1, seats: 2, structures: { highWater: 0, owner: [], cell: [] } } as unknown as SimView;
  }
  it('the same buffer gets the same objects with new numbers, shrinks when helicopters go, and a fresh buffer gets fresh rows', () => {
    const buf: HeliRow[] = [];
    const v1 = view([
      { owner: 1, state: HELI_PAD, load: 0 },
      { owner: 1, state: HELI_CRUISE, load: 300 },
    ]);
    const first = ownHeliRows(v1, 0, buf);
    expect(first).toBe(buf);
    expect(buf.map((r) => [r.id, r.state, r.troops])).toEqual([
      [0, HELI_PAD, 0],
      [1, HELI_CRUISE, 300],
    ]);
    const a = buf[0];
    const b = buf[1];
    const v2 = view([
      { owner: 1, state: HELI_CRUISE, load: 120 },
      { owner: 2, state: HELI_PAD, load: 0 },
    ]);
    ownHeliRows(v2, 0, buf);
    expect(buf.length).toBe(1);
    expect(buf[0]).toBe(a); // the same object, rewritten
    expect([buf[0]?.id, buf[0]?.state, buf[0]?.troops]).toEqual([0, HELI_CRUISE, 120]);
    ownHeliRows(v1, 0, buf);
    expect(buf.length).toBe(2);
    expect(buf[0]).toBe(a);
    expect(buf[1]).not.toBe(undefined);
    expect(b).toBeDefined();
    expect(ownHeliRows(v1, 0, []).length).toBe(2);
  });
});
