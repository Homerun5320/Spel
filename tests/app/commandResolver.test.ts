// The command resolver table (M20a-lite): selection x target -> command, every rule, the invalid targets, the extension point for M13b / M15b, and the
// selection mode's `context(cmd)` that feeds it.
import { describe, expect, it } from 'vitest';
import { NO_COMMAND, commandRules, registerCommandRule, resolveCommand, type Command, type CommandContext, type CommandSelection, type CommandTarget } from '../../src/app/commandResolver';
import { InputStack, type ContextCommand, type InputMode } from '../../src/app/input';
import { createPlacementMode } from '../../src/app/placement';
import { createSelectionMode, type SelectionTarget } from '../../src/app/structureSelect';
import { STRUCT_CITY, STRUCT_FACTORY } from '../../src/sim/public';
import { CLASS_DEEP_SEA, CLASS_PEAK, CLASS_PLAINS } from '../../src/sim/terrain';

const ME = 3;
const ctx: CommandContext = { localOwner: ME, spawned: true, spawnPhase: false };
const none: CommandSelection = { structure: -1, structureType: 0, placing: 0 };
const selected = (id: number, type = STRUCT_CITY): CommandSelection => ({ structure: id, structureType: type, placing: 0 });
const placing = (type: number): CommandSelection => ({ structure: -1, structureType: 0, placing: type });
const land = (owner: number, ownStructure = -1, cell = 10): CommandTarget => ({ cell, terrainClass: CLASS_PLAINS, owner, ownStructure });
const sea: CommandTarget = { cell: 11, terrainClass: CLASS_DEEP_SEA, owner: 0, ownStructure: -1 };
const peak: CommandTarget = { cell: 12, terrainClass: CLASS_PEAK, owner: 0, ownStructure: -1 };

describe('the table: selection x target -> command', () => {
  const rows: Array<[string, Parameters<typeof resolveCommand>[0], CommandSelection, CommandTarget, Command]> = [
    // attack
    ['nothing marked, right click on enemy land attacks its owner', 'context', none, land(7), { kind: 'attack', target: 7 }],
    ['nothing marked, right click on unowned land attacks owner 0', 'context', none, land(0), { kind: 'attack', target: 0 }],
    ['nothing marked, left click on enemy land attacks too', 'primary', none, land(7), { kind: 'attack', target: 7 }],
    ['nothing marked, right click on own land does nothing', 'context', none, land(ME), NO_COMMAND],
    ['nothing marked, right click on the sea is refused', 'context', none, sea, { kind: 'invalid', reason: 'unplayable' }],
    ['nothing marked, right click on a peak is refused', 'context', none, peak, { kind: 'invalid', reason: 'unplayable' }],
    // build on own ground (placement)
    ['placing a City, left click on own land builds there', 'primary', placing(STRUCT_CITY), land(ME, -1, 55), { kind: 'build', type: STRUCT_CITY, cell: 55 }],
    ['placing, a click on enemy land is refused (no attack while placing)', 'primary', placing(STRUCT_CITY), land(7), { kind: 'invalid', reason: 'not-own-ground' }],
    ['placing, a click on the sea is refused', 'primary', placing(STRUCT_CITY), sea, { kind: 'invalid', reason: 'not-own-ground' }],
    ['placing, a right click is not in the table (the placement mode leaves itself)', 'context', placing(STRUCT_CITY), land(7), NO_COMMAND],
    // selected structure against another cell
    ['a structure marked, right click on other land deselects', 'context', selected(4), land(7), { kind: 'deselect' }],
    ['a structure marked, right click on own empty land deselects', 'context', selected(4), land(ME), { kind: 'deselect' }],
    ['a structure marked, right click on the sea deselects', 'context', selected(4), sea, { kind: 'deselect' }],
    ['a structure marked, right click on itself keeps it', 'context', selected(4), land(ME, 4), NO_COMMAND],
    ['a structure marked, left click on another own structure reselects', 'primary', selected(4), land(ME, 9), { kind: 'select', structure: 9 }],
    ['a structure marked, left click on other land deselects', 'primary', selected(4), land(7), { kind: 'deselect' }],
    ['a structure marked, left click on itself keeps it', 'primary', selected(4), land(ME, 4), NO_COMMAND],
    // spawn
    ['spawn phase: a right click does nothing', 'context', none, land(0), NO_COMMAND],
  ];
  for (const [name, trigger, sel, target, want] of rows) {
    it(name, () => {
      const c = name.startsWith('spawn phase') ? { ...ctx, spawnPhase: true } : ctx;
      expect(resolveCommand(trigger, sel, target, c)).toEqual(want);
    });
  }
  it('before the spawn an attack click is refused with the spawn reason', () => {
    expect(resolveCommand('context', none, land(7), { ...ctx, spawned: false })).toEqual({ kind: 'invalid', reason: 'not-spawned' });
  });
});

describe('the extension point: a rule in front of the attack (what M13b and M15b will add)', () => {
  it('a Factory-marked right click on land runs the new rule and leaves the old rows alone', () => {
    const off = registerCommandRule({
      id: 'test-launch-heli',
      priority: 15,
      triggers: ['context'],
      applies: (_t, sel, target) => sel.structureType === STRUCT_FACTORY && target.terrainClass === CLASS_PLAINS,
      resolve: () => NO_COMMAND,
    });
    try {
      expect(commandRules().map((r) => r.id)).toEqual(['build-own', 'test-launch-heli', 'deselect-other', 'attack']);
      expect(resolveCommand('context', selected(4, STRUCT_FACTORY), land(7), ctx)).toEqual(NO_COMMAND); // the new rule won over 'deselect-other'
      expect(resolveCommand('context', selected(4, STRUCT_CITY), land(7), ctx)).toEqual({ kind: 'deselect' });
      expect(() => registerCommandRule({ ...commandRules()[0]! })).toThrow(/twice/);
    } finally {
      off();
    }
    expect(commandRules().map((r) => r.id)).toEqual(['build-own', 'deselect-other', 'attack']);
  });
});

describe('modes on the stack: who answers a right click', () => {
  const cmd: ContextCommand = { x: 5, y: 6, cell: 10, lat: 0, lon: 0 };
  const base: InputMode = { id: 'base', context: () => (asked.push('base'), true) };
  const asked: string[] = [];

  const selTarget = (log: string[]): SelectionTarget => ({
    pickCell: () => 10,
    structureAt: () => -1,
    reselect: () => undefined,
    ended: () => undefined,
    exit: () => undefined,
    context: (id, c) => log.push(`context:${id}:${c.cell}`),
  });

  it('the selection mode hands the right click and the selected id to the page (the resolver), and takes it', () => {
    asked.length = 0;
    const log: string[] = [];
    const stack = new InputStack(base);
    stack.push(createSelectionMode(4, selTarget(log)));
    expect(stack.dispatchContext(cmd)).toBe(true);
    expect(log).toEqual(['context:4:10']);
    expect(asked).toEqual([]); // the base resolver does not also run
  });

  it('a selection mode without the hook does not take it (old behaviour)', () => {
    const stack = new InputStack(base);
    const t = selTarget([]);
    delete t.context;
    stack.push(createSelectionMode(4, t));
    expect(stack.dispatchContext(cmd)).toBe(false);
  });

  it('the placement mode leaves itself on a right click and sends nothing', () => {
    const sent: unknown[] = [];
    let exited = 0;
    const mode = createPlacementMode(STRUCT_CITY, {
      pickCell: () => 10,
      validate: () => 0,
      send: (...a) => sent.push(a),
      setGhost: () => undefined,
      clearGhost: () => undefined,
      refused: () => undefined,
      exit: () => exited++,
      ended: () => undefined,
    });
    const stack = new InputStack(base);
    stack.push(mode);
    expect(stack.dispatchContext(cmd)).toBe(true);
    expect(exited).toBe(1);
    expect(sent).toEqual([]);
  });
});
