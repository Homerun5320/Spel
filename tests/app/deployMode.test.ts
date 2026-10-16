// M13b: the deploy mode (an input mode), the resolver rule that opens it, the mission news. Pure logic, synthetic events.
import { describe, expect, it } from 'vitest';
import { createDeployMode, type DeployTarget } from '../../src/app/deployMode';
import { resolveCommand, type CommandContext, type CommandSelection, type CommandTarget } from '../../src/app/commandResolver';
import { InputStack } from '../../src/app/input';
import { MISSION_LANDED, MISSION_LOST, MissionWatcher, ownHeliRows } from '../../src/ui/heliInfo';
import { HELI_CRUISE, HELI_DOWNED, HELI_HOVER, HELI_PAD, HELI_RETURN, STRUCT_CITY, STRUCT_FACTORY } from '../../src/sim/public';
import { HeliTable } from '../../src/sim/heliTable';
import type { SimView } from '../../src/sim/public';

function target(verdict: (cell: number) => number) {
  const log: string[] = [];
  let cell: number | null = 7;
  const t: DeployTarget = {
    pickCell: () => cell,
    hover: (c) => log.push(`hover:${c}`),
    decide: verdict,
    send: (c) => log.push(`send:${c}`),
    refused: (r) => log.push(`refused:${r}`),
    exit: () => log.push('exit'),
    ended: () => log.push('ended'),
  };
  return { t, log, setCell: (c: number | null) => (cell = c) };
}

const mouse = { kind: 'mouse' as const, x: 10, y: 10, button: 0, buttons: 0, shiftKey: false, ctrlKey: false, altKey: false, pointerId: 1 };

describe('the deploy mode', () => {
  it('a click on a valid zone sends and leaves; a click on a refused zone shows the reason and stays; the right click does the same', () => {
    const f = target((c) => (c === 7 ? 0 : 66));
    const m = createDeployMode(3, f.t);
    expect(m.click?.(10, 10, mouse as never)).toBe(true);
    expect(f.log).toEqual(['send:7', 'exit']);
    const g = target(() => 70);
    const n = createDeployMode(3, g.t);
    n.click?.(10, 10, mouse as never);
    n.context?.({ x: 10, y: 10 } as never);
    expect(g.log).toEqual(['refused:70', 'refused:70']); // no intent, no exit
    const h = target(() => 0);
    h.setCell(null);
    createDeployMode(3, h.t).click?.(1, 1, mouse as never);
    expect(h.log).toEqual([]); // a click beside the globe does nothing
    const i = target(() => 0);
    createDeployMode(3, i.t).context?.({ x: 1, y: 1 } as never);
    expect(i.log).toEqual(['send:7', 'exit']);
  });

  it('hover reports a change of cell only, and the pop clears the hover and says "ended"', () => {
    const f = target(() => 0);
    const m = createDeployMode(3, f.t);
    m.pointerMove?.({ ...mouse, x: 5, y: 5 } as never);
    m.tick?.(0);
    m.tick?.(0.1);
    f.setCell(8);
    m.tick?.(0.2);
    expect(f.log).toEqual(['hover:7', 'hover:8']);
    expect(m.state()).toEqual({ cell: 8, factory: 3 });
    m.onPop?.();
    expect(f.log.slice(-2)).toEqual(['hover:null', 'ended']);
  });

  it('on the real stack: Escape pops the mode and nothing else opens; the stack offers the context click to the mode first', () => {
    const f = target(() => 0);
    const stack = new InputStack({ id: 'base' } as never);
    const m = createDeployMode(3, f.t);
    stack.push(m);
    expect(stack.depth).toBe(1);
    expect(stack.key({ key: 'Escape', ctrlKey: false, altKey: false, metaKey: false, repeat: false, typing: false })).toBe(true);
    expect(stack.depth).toBe(0);
    expect(f.log).toEqual(['hover:null', 'ended']);
  });
});

describe('the resolver rule', () => {
  const ctx: CommandContext = { localOwner: 1, spawned: true, spawnPhase: false };
  const tgt: CommandTarget = { cell: 5, terrainClass: 2, owner: 3, ownStructure: -1 };
  const sel = (structureType: number, structure = 4): CommandSelection => ({ structure, structureType, placing: 0 });

  it('Factory selected + right click anywhere opens the deploy mode; a left click and every other structure keep their old meaning', () => {
    expect(resolveCommand('context', sel(STRUCT_FACTORY), tgt, ctx)).toEqual({ kind: 'deploy', factory: 4 });
    expect(resolveCommand('context', sel(STRUCT_FACTORY), { ...tgt, ownStructure: 4 }, ctx)).toEqual({ kind: 'deploy', factory: 4 });
    expect(resolveCommand('primary', sel(STRUCT_FACTORY), tgt, ctx)).toEqual({ kind: 'deselect' });
    expect(resolveCommand('context', sel(STRUCT_CITY), tgt, ctx)).toEqual({ kind: 'deselect' });
    expect(resolveCommand('context', { structure: -1, structureType: 0, placing: 0 }, tgt, ctx)).toEqual({ kind: 'attack', target: 3 });
  });
});

describe('the helicopter list and the mission news', () => {
  function view(t: HeliTable): SimView {
    return { helis: t, tick: 100, flow: false, phase: 0, structures: { highWater: 0 } } as unknown as SimView;
  }
  it('lists the seat\'s helicopters but not those under production, with the fuel as a percentage', () => {
    const t = new HeliTable(4);
    const a = t.addBuilding(1, 0, 0, 50);
    void a;
    const b = t.addBuilding(1, 0, 0, 0);
    t.state[b] = HELI_CRUISE;
    t.load[b] = 120;
    t.fuel[b] = 90 * 256;
    const c = t.addBuilding(2, 0, 0, 0);
    t.state[c] = HELI_PAD;
    const rows = ownHeliRows(view(t), 0, []);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: b, state: HELI_CRUISE, troops: 120, fuelPct: 50 });
  });

  it('a hovering helicopter that is gone from HOVER has landed; a downed one is lost; only the seat\'s own count', () => {
    const t = new HeliTable(4);
    const mine = t.addBuilding(1, 0, 0, 0);
    const other = t.addBuilding(2, 0, 0, 0);
    t.state[mine] = HELI_HOVER;
    t.state[other] = HELI_HOVER;
    const w = new MissionWatcher();
    expect(w.update(view(t), 1, 0)).toBe(0); // the first look only records
    t.state[mine] = HELI_RETURN;
    t.state[other] = HELI_DOWNED;
    expect(w.update(view(t), 2, 0)).toBe(MISSION_LANDED);
    t.state[mine] = HELI_DOWNED;
    expect(w.update(view(t), 2, 0)).toBe(0); // same version: nothing
    expect(w.update(view(t), 3, 0)).toBe(MISSION_LOST);
  });
});
