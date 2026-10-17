// The hotkey registry (M20a-lite). EVERY game shortcut is a registered entry here, and the help overlay (`?`, src/ui/helpOverlay.ts) is generated from the
// entries, so the list on screen cannot drift from what the keys do. `attachHotkeys` is the ONE `keydown` listener of the game: `tests/app/hotkeyGrep.test.ts`
// fails when another file under src/ adds a listener that is not on its short documented list.
//
// SCOPES
//  - `global`: works whenever the page is up, also on the menus and in a text field (F2 Dev panel, F3 overlay). Never blocked by a modal.
//  - `match`: works while a match is on (`context.matchOn`), is dead behind a modal (pause menu, elimination panel, result screen: `context.modalOpen`,
//    Fix-3B) and in a text field, and refuses ctrl / meta (AltGr, ctrl + alt, is allowed because a Swedish keyboard types `[` with it).
//  - `stack`: the RESERVED keys of the input stack (1 to 6, E, H, F, Escape: `RESERVED_KEYS` in src/app/input.ts). Only a `stack` entry may use a reserved key and
//    a `stack` entry may use nothing else, so no other code can bind them. The entry's `run` hands the key to `InputStack.key`. Behind a modal only Escape passes.
// `run` returns true (used: the browser default is prevented), 'quiet' (used, default NOT prevented: an Escape that opens the pause menu must not be swallowed
// before the browser's own full-screen exit) or false (not used).
import { DEV_PANEL_REQUEST_EVENT } from '../ui/events';
import type { TextKey } from '../ui/i18n';
import { isReservedKey, type InputStack } from './input';
import { typingInField } from './matchKeys';

export type HotkeyScope = 'global' | 'match' | 'stack';

/** A key event reduced to plain data (the DOM adapter fills it; the unit tests build it by hand). */
export interface HotkeyEvent {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  readonly repeat: boolean;
  /** A text field has the focus. */
  readonly typing: boolean;
}

export interface HotkeyDef {
  readonly id: string;
  /** The `KeyboardEvent.key` values; a single character matches in either case. */
  readonly keys: readonly string[];
  /** The text key of the one-line description in the help overlay. */
  readonly labelKey: TextKey;
  readonly scope: HotkeyScope;
  run(e: HotkeyEvent): boolean | 'quiet';
  /** A held key does not repeat the action (pause). */
  readonly noRepeat?: boolean;
  /** Not listed in the help overlay (a reserved key whose feature comes later: E and H). */
  readonly hidden?: boolean;
}

export interface HotkeyContext {
  /** A match is on (the setup screen and the menus own the keyboard before it). */
  matchOn(): boolean;
  /** A modal is open or the match is over: only Escape passes (Fix-3B). */
  modalOpen(): boolean;
}

const norm = (key: string): string => (key.length === 1 ? key.toLowerCase() : key);

export class HotkeyRegistry {
  private readonly defs: HotkeyDef[] = [];
  private readonly byKey = new Map<string, HotkeyDef>();
  context: HotkeyContext = { matchOn: () => false, modalOpen: () => false };

  /** Registers an entry; returns the function that removes it. Throws on a duplicate id or key and on a reserved key outside the `stack` scope. */
  register(def: HotkeyDef, signal?: AbortSignal): () => void {
    if (this.defs.some((d) => d.id === def.id)) throw new Error(`hotkey ${def.id} is registered twice`);
    for (const k of def.keys) {
      const reserved = isReservedKey(k);
      if (def.scope === 'stack' && !reserved) throw new Error(`hotkey ${def.id}: "${k}" is not a reserved key, a stack entry may only take reserved keys`);
      if (def.scope !== 'stack' && reserved) throw new Error(`hotkey ${def.id}: "${k}" is reserved for the input stack`);
      const taken = this.byKey.get(norm(k));
      if (taken !== undefined) throw new Error(`hotkey ${def.id}: "${k}" is already bound by ${taken.id}`);
    }
    this.defs.push(def);
    for (const k of def.keys) this.byKey.set(norm(k), def);
    const remove = (): void => {
      const i = this.defs.indexOf(def);
      if (i < 0) return;
      this.defs.splice(i, 1);
      for (const k of def.keys) this.byKey.delete(norm(k));
    };
    signal?.addEventListener('abort', remove, { once: true });
    return remove;
  }

  entries(): readonly HotkeyDef[] {
    return this.defs;
  }

  /** The entries the help overlay lists, in registration order. */
  listed(): HotkeyDef[] {
    return this.defs.filter((d) => d.hidden !== true);
  }

  /** The entry bound to `key`, or null. */
  find(key: string): HotkeyDef | null {
    return this.byKey.get(norm(key)) ?? null;
  }

  /** Offers a key press to the registry. Returns what the entry returned (false when nothing used it). */
  handle(e: HotkeyEvent): boolean | 'quiet' {
    const def = this.byKey.get(norm(e.key));
    if (def === undefined) return false;
    if (def.scope === 'global') return def.run(e);
    if (!this.context.matchOn()) return false;
    if (e.key !== 'Escape' && this.context.modalOpen()) return false;
    if (def.scope === 'stack') return def.run(e); // the stack refuses ctrl, alt, meta and typing itself
    if (e.typing || e.metaKey || (e.ctrlKey && !e.altKey)) return false;
    if (e.repeat && def.noRepeat === true) return false;
    return def.run(e);
  }
}

/** The page's registry. */
export const hotkeys = new HotkeyRegistry();

/** The targets that already carry the listener: attaching to one again does nothing (Fix-4B: per target, not per module, so a test can attach to its own fake target). */
const attachedTo = new WeakSet<EventTarget>();

/** The ONE `keydown` listener of the game (once per page target; the Escape of a Dev panel or a setup screen that already used the key is not ours). */
export function attachHotkeys(target: EventTarget, registry: HotkeyRegistry = hotkeys): void {
  if (attachedTo.has(target)) return;
  attachedTo.add(target);
  target.addEventListener('keydown', (ev: Event) => {
    const e = ev as KeyboardEvent;
    if (e.defaultPrevented) return;
    const el = e.target as { tagName?: string; type?: string } | null;
    const typing = typingInField({ key: e.key, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey, targetTag: el?.tagName, targetType: el?.type });
    const used = registry.handle({ key: e.key, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey, repeat: e.repeat, typing });
    if (used === true) e.preventDefault();
  });
}

/** How a key is printed in the help overlay: a letter in capitals; the space bar is spelt out by the overlay (`hotkey.key.space`). */
export function keyCaption(key: string): string {
  return key.length === 1 ? key.toUpperCase() : key;
}

// ---- the entries of the game ---------------------------------------------------------------------------------------------------------

/** What the entries of a match act on (the page fills it in). */
export interface GameHotkeyActions {
  readonly stack: InputStack;
  toggleOverlay(): void;
  commit(direction: -1 | 1): void;
  togglePause(): void;
  slower(): void;
  faster(): void;
  toggleHelp(): void;
  /** M18e-1: keys 7 to 9, start placing the Airfield, Lab or Plant (the type number). Optional so that older callers keep compiling. */
  buildType?(type: number): void;
  /** M13b: key L, send a helicopter from the selected Factory (the deploy mode). Optional so that older callers keep compiling. */
  deploy?(): void;
  /** M13c-2: key B, send a ship from the selected Port (the ship mode). Optional so that older callers keep compiling. */
  ship?(): void;
  /** M18c-2: key D, open or close the diplomacy panel. Optional so that older callers keep compiling. */
  toggleDiplomacy?(): void;
  /** M18d-2: key T, open or close the research panel. Optional so that older callers keep compiling. */
  toggleTech?(): void;
  /** M20a-2: key N, nation labels and front arrows on or off. Optional so that older callers keep compiling. */
  toggleLabels?(): void;
}

/**
 * F2 (the Dev panel; the panel listens to its request event, as the corner button does). Registered by the page entry (main.ts) for every scene,
 * once: a restart of the scene keeps it.
 */
export function registerPageHotkeys(registry: HotkeyRegistry = hotkeys): void {
  if (registry.find('F2') !== null) return;
  registry.register({
    id: 'devpanel',
    keys: ['F2'],
    labelKey: 'hotkey.devpanel',
    scope: 'global',
    run: () => {
      window.dispatchEvent(new CustomEvent(DEV_PANEL_REQUEST_EVENT));
      return true;
    },
  });
}

/** Registers the shortcuts of the match scene (every one that existed before M20a-lite, plus `?`). Removed again when `signal` aborts. */
export function registerGameHotkeys(registry: HotkeyRegistry, a: GameHotkeyActions, signal?: AbortSignal): void {
  const toStack = (e: HotkeyEvent): boolean | 'quiet' => {
    const depth = a.stack.depth;
    const used = a.stack.key({ key: e.key, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey, repeat: e.repeat, typing: e.typing });
    if (!used) return false;
    // an Escape that opens the pause menu (empty stack) must not be swallowed before the browser's own full-screen exit
    return e.key === 'Escape' && depth === 0 ? 'quiet' : true;
  };
  const add = (def: HotkeyDef): void => void registry.register(def, signal);
  add({ id: 'focus-capital', keys: ['f'], labelKey: 'hotkey.focus', scope: 'stack', run: toStack });
  add({ id: 'build', keys: ['1', '2', '3', '4', '5', '6'], labelKey: 'hotkey.build', scope: 'stack', run: toStack });
  add({ id: 'build-extra', keys: ['7', '8', '9'], labelKey: 'hotkey.buildExtra', scope: 'match', noRepeat: true, run: (e) => (a.buildType?.(Number(e.key)), true) }); // M18e-1: not reserved keys, so a plain match entry
  add({ id: 'exposure', keys: ['e'], labelKey: 'hotkey.focus', scope: 'stack', run: toStack, hidden: true }); // reserved for M13
  add({ id: 'chase', keys: ['h'], labelKey: 'hotkey.chase', scope: 'stack', run: toStack, hidden: true }); // M13a-2: the chase camera (the base mode starts it, the chase mode ends it); not in the help overlay (two old tests pin H hidden), the list button "Åk med" is the visible way
  add({ id: 'escape', keys: ['Escape'], labelKey: 'hotkey.escape', scope: 'stack', run: toStack });
  add({ id: 'pause', keys: [' ', 'Spacebar'], labelKey: 'hotkey.pause', scope: 'match', noRepeat: true, run: () => (a.togglePause(), true) });
  add({ id: 'slower', keys: [','], labelKey: 'hotkey.slower', scope: 'match', run: () => (a.slower(), true) });
  add({ id: 'faster', keys: ['.'], labelKey: 'hotkey.faster', scope: 'match', run: () => (a.faster(), true) });
  add({ id: 'commit-down', keys: ['[', '-'], labelKey: 'hotkey.commitDown', scope: 'match', run: () => (a.commit(-1), true) });
  add({ id: 'commit-up', keys: [']', '+'], labelKey: 'hotkey.commitUp', scope: 'match', run: () => (a.commit(1), true) });
  add({ id: 'deploy', keys: ['l'], labelKey: 'hotkey.deploy', scope: 'match', noRepeat: true, run: () => (a.deploy?.(), true) });
  add({ id: 'ship', keys: ['b'], labelKey: 'hotkey.ship', scope: 'match', noRepeat: true, run: () => (a.ship?.(), true) });
  add({ id: 'diplomacy', keys: ['d'], labelKey: 'hotkey.diplo', scope: 'match', noRepeat: true, run: () => (a.toggleDiplomacy?.(), true) });
  add({ id: 'tech', keys: ['t'], labelKey: 'hotkey.tech', scope: 'match', noRepeat: true, run: () => (a.toggleTech?.(), true) });
  add({ id: 'labels', keys: ['n'], labelKey: 'hotkey.labels', scope: 'match', noRepeat: true, run: () => (a.toggleLabels?.(), true) });
  add({ id: 'help', keys: ['?'], labelKey: 'hotkey.help', scope: 'match', run: () => (a.toggleHelp(), true) });
  add({ id: 'overlay', keys: ['F3'], labelKey: 'hotkey.overlay', scope: 'global', run: () => (a.toggleOverlay(), true) });
}
