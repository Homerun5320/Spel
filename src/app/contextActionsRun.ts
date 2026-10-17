// The page side of the right-click menu (Ctx-1): opens the menu for a cell, keeps its input mode on the stack while it is open, and turns a chosen entry's `effect` into the SAME
// intents, modes and confirmations the buttons use (attack: `attackOrExplain`; build / upgrade / delete: the intent bodies; send a helicopter or a ship: the deploy and ship modes with the
// target already picked; diplomacy: the panel's own actions). It holds no rule and no state of the match. Loaded lazily (import()) at the first right click, with the model and the DOM.
import type { InputMode, InputStack } from './input';
import { buildBody, deleteBody, imposeEmbargoBody, liftEmbargoBody, produceHeliBody, proposeTreatyBody, breakTreatyBody, upgradeBody, type Nav, type SimView } from '../sim/public';
import { createContextMenu, type ContextMenu } from '../ui/contextMenu';
import { languageVersion, type TextKey, type TextParams } from '../ui/i18n';
import { contextActionsFor, type ContextEffect, type ContextEntry } from './contextActions';

/** The part of the match the menu needs (the page hands its `MatchSession` in). */
export interface ContextMatch {
  readonly view: SimView;
  readonly localSeat: number;
  readonly localOwner: number;
  readonly commitPct: number;
  readonly isPaused: boolean;
  submit(body: unknown): void;
}

/** What the runner needs of the page. */
export interface ContextHost {
  match(): ContextMatch | null;
  readonly stack: InputStack;
  /** The element the menu is drawn in (the page wrapper, the same box as the canvas). */
  readonly parent: HTMLElement;
  nav(): Nav | null;
  heliTroops(): number;
  heliMode(): number;
  nameOf(seat: number): string;
  /** The attack of a plain right click, with its treaty gate and toast. */
  attack(owner: number): void;
  toast(key: TextKey, params: TextParams, kind: 'info' | 'warn' | 'error'): void;
  select(id: number): void;
  openCity(id: number): void;
  deploy(factory: number, cell: number): void;
  ship(port: number, cell: number): void;
  /** The match is over or a modal covers the page: the menu closes. */
  shouldClose(): boolean;
  /** An entry of a registered provider (M15b). */
  extension?(id: string, cell: number): void;
}

export interface ContextRunner {
  /** Opens the menu for the cell at the pointer (`x`, `y` in pixels of the parent) and your structure `structure` there (-1 = none). Returns false when there is no menu (a toast said why). */
  open(x: number, y: number, cell: number, structure: number): boolean;
  close(): void;
  isOpen(): boolean;
  /** Once per frame: closes the menu when the match paused / ended, a modal opened, the language changed or another mode was pushed over it. */
  frame(): void;
  /** What the tests read. */
  info(): { open: boolean; entries: number };
  dispose(): void;
}

export function createContextRunner(host: ContextHost): ContextRunner {
  let mode: InputMode | null = null;
  let lang = -1;
  let entries = 0;

  const act = (e: ContextEffect, m: ContextMatch): void => {
    const L = m.localSeat;
    switch (e.kind) {
      case 'none':
        break;
      case 'attack':
        host.attack(e.owner);
        break;
      case 'build':
        m.submit(buildBody(L, e.type, e.cell));
        break;
      case 'upgrade':
        m.submit(upgradeBody(L, e.id));
        break;
      case 'delete':
        m.submit(deleteBody(L, e.id));
        break;
      case 'openCity':
        host.openCity(e.id);
        break;
      case 'select':
        host.select(e.id);
        break;
      case 'produceHeli':
        m.submit(produceHeliBody(L, e.id));
        break;
      case 'deploy':
        host.deploy(e.factory, e.cell);
        break;
      case 'ship':
        host.ship(e.port, e.cell);
        break;
      case 'propose':
        m.submit(proposeTreatyBody(L, e.seat, e.treaty));
        break;
      case 'break':
        m.submit(breakTreatyBody(L, e.seat));
        break;
      case 'embargo':
        m.submit(e.lift ? liftEmbargoBody(L, e.seat) : imposeEmbargoBody(L, e.seat));
        break;
      case 'extension':
        host.extension?.(e.id, e.cell);
        break;
    }
  };

  const menu: ContextMenu = createContextMenu(host.parent, {
    choose: (entry: ContextEntry) => {
      const m = host.match();
      if (m !== null && entry.state === 'ok') act(entry.effect, m);
    },
    closed: () => {
      const mine = mode;
      mode = null;
      if (mine === null) return;
      if (host.stack.top === mine) host.stack.pop();
      else host.stack.remove(mine);
    },
  });

  /** The menu's mode: it takes every pointer press, wheel notch and click on the map (the map does not drag, zoom or act while the menu is open); a press closes it. */
  const makeMode = (): InputMode => ({
    id: 'ctx-menu',
    pointerDown: () => {
      menu.close();
      return true;
    },
    pointerMove: () => true,
    pointerUp: () => true,
    pointerCancel: () => true,
    wheel: () => true,
    click: () => true,
    context: () => true,
    longPress: () => true,
    key: () => true, // the reserved keys (1 to 6, E, H, F) do nothing while the menu is open; Escape is the stack's and pops the mode
    onPop: () => menu.close(),
  });

  return {
    open(x, y, cell, structure): boolean {
      const m = host.match();
      if (m === null) return false;
      const model = contextActionsFor(m.view, m.localSeat, { cell, structure }, { nameOf: host.nameOf, commitPct: m.commitPct, nav: host.nav(), heliTroops: host.heliTroops(), heliMode: host.heliMode() });
      if (model.blocked !== null || model.entries.length === 0) {
        host.toast(model.blocked === 'not-spawned' ? 'reject.notSpawned' : 'ctx.toast.noMenu', {}, 'warn');
        return false;
      }
      if (mode !== null) menu.close();
      lang = languageVersion();
      entries = model.entries.length;
      const next = makeMode();
      mode = next;
      host.stack.push(next);
      menu.open(model, x, y);
      return true;
    },
    close: () => menu.close(),
    isOpen: () => menu.isOpen(),
    frame(): void {
      if (!menu.isOpen()) return;
      const m = host.match();
      if (m === null || m.isPaused || host.shouldClose() || languageVersion() !== lang || host.stack.top !== mode) menu.close();
    },
    info: () => ({ open: menu.isOpen(), entries }),
    dispose(): void {
      menu.dispose();
    },
  };
}
