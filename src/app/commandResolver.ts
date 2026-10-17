// The command resolver (M20a-lite): selection + target => command, as a TABLE of rules. Pure functions over plain data, no DOM and no sim writes: the page
// turns the returned command into an intent, a toast or a mode change. A later milestone adds a command by `registerCommandRule` and touches neither this
// function nor the modes: M13b adds "Factory selected + right click on land => LaunchHeli" and M15b "Silo selected => target mode" as rules with a smaller
// `priority` than the attack rule (see `docs/ARCHITECTURE.md`, "M20a-lite").
//
// TRIGGERS. `primary` is a left click, `context` a right click or a long press. The rules below cover: building on own ground (placement mode), the selected
// structure against another cell (deselect / reselect) and the attack on land. Today the placement mode and the selection mode keep handling their own left
// clicks (D157, unchanged); the table models those commands too so that the unit tests pin them and the next rules can sit in front of them.
import { STRUCT_FACTORY } from '../sim/public';
import { isPlayableClass } from '../sim/terrain';

export type CommandTrigger = 'primary' | 'context';

/** What is marked right now. */
export interface CommandSelection {
  /** The selected structure id, -1 = none. */
  readonly structure: number;
  /** Its type number (STRUCT_*), 0 = none. */
  readonly structureType: number;
  /** The structure type being placed (placement mode), 0 = none. */
  readonly placing: number;
}

/** What the click points at. */
export interface CommandTarget {
  readonly cell: number;
  readonly terrainClass: number;
  /** The owner id of the cell (0 = nobody). */
  readonly owner: number;
  /** The id of YOUR structure on this cell (or beside it, `pickStructure`), -1 = none. */
  readonly ownStructure: number;
}

/** What the table needs to know about the match. */
export interface CommandContext {
  readonly localOwner: number;
  /** You have a capital (you spawned). */
  readonly spawned: boolean;
  /** The spawn phase is on (a click spawns; a right click does nothing). */
  readonly spawnPhase: boolean;
}

/** Why a target is refused (the page maps it to a toast). */
export type InvalidReason = 'unplayable' | 'not-own-ground' | 'not-spawned';

export type Command =
  | { readonly kind: 'none' }
  | { readonly kind: 'attack'; readonly target: number }
  | { readonly kind: 'build'; readonly type: number; readonly cell: number }
  | { readonly kind: 'deselect' }
  | { readonly kind: 'select'; readonly structure: number }
  /** M13b: open the deploy mode (send a helicopter) with this Factory chosen. */
  | { readonly kind: 'deploy'; readonly factory: number }
  | { readonly kind: 'invalid'; readonly reason: InvalidReason };

export const NO_COMMAND: Command = { kind: 'none' };

export interface CommandRule {
  readonly id: string;
  /** Lower runs first; the first rule that applies decides. */
  readonly priority: number;
  readonly triggers: readonly CommandTrigger[];
  applies(trigger: CommandTrigger, sel: CommandSelection, target: CommandTarget, ctx: CommandContext): boolean;
  resolve(trigger: CommandTrigger, sel: CommandSelection, target: CommandTarget, ctx: CommandContext): Command;
}

/** "Build on own ground": a structure type is being placed. A target that is not your land is refused. */
const BUILD_OWN: CommandRule = {
  id: 'build-own',
  priority: 10,
  triggers: ['primary'],
  applies: (_t, sel) => sel.placing > 0,
  resolve: (_t, sel, target, ctx) => (isPlayableClass(target.terrainClass) && target.owner === ctx.localOwner ? { kind: 'build', type: sel.placing, cell: target.cell } : { kind: 'invalid', reason: 'not-own-ground' }),
};

/**
 * M13b, "Factory selected + right click": opens the deploy mode with that Factory chosen (anywhere on the map, also on its own cell). The second click, in the
 * mode, picks the landing zone. Sending straight from the first right click was rejected: the player would not see the verdict and the route before the helicopter
 * left (DECISIONS M13b). A left click does not use this rule (it still selects or deselects).
 */
const FACTORY_DEPLOY: CommandRule = {
  id: 'factory-deploy',
  priority: 15,
  triggers: ['context'],
  applies: (_t, sel) => sel.structure >= 0 && sel.structureType === STRUCT_FACTORY && sel.placing === 0,
  resolve: (_t, sel) => ({ kind: 'deploy', factory: sel.structure }),
};

/** "Selected structure + another cell": a left click on another own structure reselects, any other cell deselects; a right click deselects (the selected structure's own cell keeps it). */
const SELECTED_AGAINST_CELL: CommandRule = {
  id: 'deselect-other',
  priority: 20,
  triggers: ['primary', 'context'],
  applies: (_t, sel) => sel.structure >= 0 && sel.placing === 0,
  resolve: (trigger, sel, target) => {
    if (target.ownStructure === sel.structure) return NO_COMMAND;
    if (trigger === 'primary' && target.ownStructure >= 0) return { kind: 'select', structure: target.ownStructure };
    return { kind: 'deselect' };
  },
};

/** "Attack": nothing special is marked; land that is not yours is attacked (the target is its owner, 0 = unowned land), your own land does nothing, sea / peaks / ice are refused. */
const ATTACK: CommandRule = {
  id: 'attack',
  priority: 100,
  triggers: ['primary', 'context'],
  applies: (_t, sel) => sel.placing === 0,
  resolve: (_t, _sel, target, ctx) => {
    if (ctx.spawnPhase) return NO_COMMAND;
    if (!ctx.spawned) return { kind: 'invalid', reason: 'not-spawned' };
    if (!isPlayableClass(target.terrainClass)) return { kind: 'invalid', reason: 'unplayable' };
    if (target.owner === ctx.localOwner) return NO_COMMAND;
    return { kind: 'attack', target: target.owner };
  },
};

const rules: CommandRule[] = [BUILD_OWN, FACTORY_DEPLOY, SELECTED_AGAINST_CELL, ATTACK];

/** The rules in the order they are tried. */
export function commandRules(): readonly CommandRule[] {
  return rules;
}

/** Adds a rule (M13b, M15b); returns the function that removes it. Throws on a duplicate id. */
export function registerCommandRule(rule: CommandRule): () => void {
  if (rules.some((r) => r.id === rule.id)) throw new Error(`command rule ${rule.id} is registered twice`);
  rules.push(rule);
  rules.sort((a, b) => a.priority - b.priority);
  return () => {
    const i = rules.indexOf(rule);
    if (i >= 0) rules.splice(i, 1);
  };
}

/** The command for a click: the first rule (by priority) whose trigger and `applies` match; `none` when no rule applies. */
export function resolveCommand(trigger: CommandTrigger, sel: CommandSelection, target: CommandTarget, ctx: CommandContext): Command {
  for (const r of rules) {
    if (r.triggers.includes(trigger) && r.applies(trigger, sel, target, ctx)) return r.resolve(trigger, sel, target, ctx);
  }
  return NO_COMMAND;
}
