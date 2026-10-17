// The right-click menu (Ctx-1): plain DOM built from JS, drawn only when it opens, when a group folds or when an entry arms (never per frame). It shows the model of
// src/app/contextActions.ts and REPORTS a choice (`ContextMenuHooks.choose`); the page owns what a choice does. Groups unfold in place (no hover submenus: a touch screen has none),
// the keyboard walks the rows (arrows, Home, End, Enter / Space, Right / Left unfold / fold a group), a click outside closes it, and Escape is the input stack's (the page pushes a
// mode while the menu is open). A disabled entry stays readable and shows its reason under the name. Loaded lazily with the first right click.
import type { ContextEntry, ContextGroup, ContextModel } from '../app/contextActions';
import { CTX_MENU } from './contextMenuConfig';
import { moveFocus, placeMenu, type MenuPlacement } from './contextMenuLayout';
import { formatGold, t } from './i18n';
import { HUD_FONT_BIAS_PX, HUD_FONT_MAX_PX, HUD_FONT_MIN_PX, HUD_FONT_VW, NARROW_MAX_PX, TARGET_MIN_PX, UI_COLORS as C } from './uiConfig';

export interface ContextMenuHooks {
  /** An enabled entry was activated (after its confirmation, when it has one). The menu closes itself afterwards. */
  choose(entry: ContextEntry): void;
  /** The menu closed (a choice, a click outside, `close()`): the page pops its input mode. */
  closed(): void;
}

export interface ContextMenu {
  readonly root: HTMLElement;
  isOpen(): boolean;
  /** Opens the menu for `model` at the pointer (`x`, `y` in pixels of the parent). */
  open(model: ContextModel, x: number, y: number): void;
  close(): void;
  /** The placement of the last open (the tests read it). */
  placement(): MenuPlacement | null;
  dispose(): void;
}

function ctxCss(): string {
  const fontSize = `clamp(${HUD_FONT_MIN_PX}px, calc(${HUD_FONT_VW}vw + ${HUD_FONT_BIAS_PX}px), ${HUD_FONT_MAX_PX}px)`;
  const target = `${TARGET_MIN_PX}px`;
  return `
.ctx-menu { position: absolute; z-index: ${CTX_MENU.z}; width: ${CTX_MENU.widthEm}em; max-width: calc(100% - ${2 * CTX_MENU.marginPx}px); overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; pointer-events: auto; user-select: none; -webkit-user-select: none; box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; font-size: ${fontSize}; line-height: 1.25; color: ${C.text}; background: ${CTX_MENU.background}; border: 1px solid ${C.panelBorder}; border-radius: 0.7em; box-shadow: 0 0.3em 1.4em rgba(0, 0, 0, 0.65); padding: 0.3em; }
.ctx-menu *, .ctx-menu *::before { box-sizing: border-box; }
.ctx-menu[hidden] { display: none !important; }
.ctx-title { color: ${C.textDim}; font-size: 0.82em; text-transform: uppercase; letter-spacing: 0.08em; padding: 0.3em 0.6em 0.35em; }
.ctx-item, .ctx-group { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; column-gap: 0.6em; align-items: center; width: 100%; min-height: ${target}; padding: 0.2em 0.6em; margin: 0; border: 0; border-radius: 0.45em; background: transparent; color: ${C.text}; font: inherit; text-align: left; cursor: pointer; touch-action: manipulation; }
.ctx-item:hover, .ctx-group:hover, .ctx-item:focus-visible, .ctx-group:focus-visible { background: ${CTX_MENU.rowHover}; outline: none; }
.ctx-item:focus-visible, .ctx-group:focus-visible { box-shadow: inset 0 0 0 2px ${C.accent}; }
.ctx-group { font-weight: 800; color: ${C.accent}; border-top: 1px solid ${C.panelBorder}; border-radius: 0; }
.ctx-group::before { content: "\\25B8"; margin-right: 0.4em; }
.ctx-group[aria-expanded="true"]::before { content: "\\25BE"; }
.ctx-group-name { grid-column: 1 / 3; }
.ctx-items[hidden] { display: none !important; }
.ctx-items { padding-left: 0.3em; }
.ctx-name { font-weight: 700; min-width: 0; overflow-wrap: anywhere; }
.ctx-price { color: ${C.gold}; font-variant-numeric: tabular-nums; font-size: 0.9em; white-space: nowrap; }
.ctx-key { font: inherit; font-size: 0.8em; font-weight: 700; color: ${C.accent}; border: 1px solid ${C.buttonBorder}; border-radius: 0.3em; padding: 0 0.35em; min-width: 1.5em; text-align: center; }
.ctx-reason { grid-column: 1 / 4; color: ${CTX_MENU.reason}; font-size: 0.85em; font-weight: 600; }
.ctx-item[data-state="disabled"] { cursor: not-allowed; }
.ctx-item[data-state="disabled"] .ctx-name { color: ${C.textDim}; }
.ctx-item[data-armed="1"] { box-shadow: inset 0 0 0 2px ${C.danger}; }
@media (pointer: coarse) { .ctx-item, .ctx-group { min-height: ${target}; } }
@media (max-width: ${NARROW_MAX_PX}px), (max-aspect-ratio: 1/1) { .ctx-menu { width: min(${CTX_MENU.widthEm}em, calc(100% - ${2 * CTX_MENU.marginPx}px)); } }
`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, testid?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (testid !== undefined) e.dataset.testid = testid;
  return e;
}

interface Row {
  readonly kind: 'group' | 'entry';
  readonly id: string;
  readonly group: string;
  readonly el: HTMLButtonElement;
  readonly entry?: ContextEntry;
  readonly name?: HTMLElement;
}

export function createContextMenu(parent: HTMLElement, hooks: ContextMenuHooks): ContextMenu {
  const root = el('div', 'ctx-menu', 'ctx-menu');
  root.hidden = true;
  root.setAttribute('role', 'menu');
  const style = document.createElement('style');
  style.dataset.ctxStyle = '1';
  style.textContent = ctxCss();
  parent.append(style, root);
  // nothing that happens on the menu reaches the map under it (a drag, a wheel notch, a right click)
  for (const type of ['pointerdown', 'pointerup', 'pointermove', 'wheel', 'contextmenu']) {
    root.addEventListener(type, (e) => {
      e.stopPropagation();
      if (type === 'contextmenu') e.preventDefault();
    });
  }

  let open = false;
  let model: ContextModel | null = null;
  let rows: Row[] = [];
  let focus = -1;
  let armed = '';
  let placed: MenuPlacement | null = null;
  const unfolded = new Set<string>();
  let outside: ((e: Event) => void) | null = null;

  const labelOf = (e: ContextEntry): string => t(e.labelKey, e.params);
  const setFocus = (i: number): void => {
    focus = i;
    rows.forEach((r, k) => {
      r.el.tabIndex = k === i ? 0 : -1;
    });
    const r = rows[i];
    if (r !== undefined) r.el.focus({ preventScroll: false });
  };

  const close = (): void => {
    if (!open) return;
    open = false;
    root.hidden = true;
    root.replaceChildren();
    rows = [];
    model = null;
    armed = '';
    focus = -1;
    if (outside !== null) {
      document.removeEventListener('pointerdown', outside, true);
      outside = null;
    }
    hooks.closed();
  };

  const activate = (r: Row): void => {
    if (r.kind === 'group') {
      toggle(r.id);
      return;
    }
    const e = r.entry as ContextEntry;
    if (e.state === 'disabled') return;
    if (e.confirm === true && armed !== e.id) {
      armed = e.id;
      rows.forEach((x) => {
        if (x.kind === 'entry') x.el.dataset.armed = x.id === armed ? '1' : '0';
      });
      if (r.name !== undefined) r.name.textContent = t('ctx.confirm', { label: labelOf(e) });
      return;
    }
    close(); // first: the page pops the menu's input mode, THEN the choice may push a mode of its own
    hooks.choose(e);
  };

  const toggle = (groupId: string, force?: boolean): void => {
    const want = force ?? !unfolded.has(groupId);
    if (want === unfolded.has(groupId)) return;
    if (want) unfolded.add(groupId);
    else unfolded.delete(groupId);
    const header = rows.find((r) => r.kind === 'group' && r.id === groupId);
    const box = header?.el.nextElementSibling as HTMLElement | null;
    if (header !== undefined) header.el.setAttribute('aria-expanded', want ? 'true' : 'false');
    if (box !== null && box !== undefined) box.hidden = !want;
    reflow();
    if (want) {
      // the first entry of the group takes the focus, so the keyboard continues inside it
      const i = rows.findIndex((r) => r.kind === 'entry' && r.group === groupId && !r.el.closest('[hidden]'));
      if (i >= 0) setFocus(i);
    }
  };

  /** The walkable rows are those not inside a folded group. */
  const walkable = (): Row[] => rows.filter((r) => r.kind === 'group' || r.el.closest('[hidden]') === null);
  const reflow = (): void => {
    if (!open) return;
    // the box grew or shrank: keep it inside the window (the same rule as at the first open)
    const box = parent.getBoundingClientRect();
    place(Number(root.dataset.px ?? '0'), Number(root.dataset.py ?? '0'), box.width, box.height);
  };
  const place = (x: number, y: number, vw: number, vh: number): void => {
    root.style.maxHeight = `${Math.max(0, vh - 2 * CTX_MENU.marginPx)}px`;
    const w = root.offsetWidth;
    const h = root.scrollHeight + 2; // content height incl. border; the max-height clips it
    placed = placeMenu(x, y, w, h, vw, vh, CTX_MENU.marginPx);
    root.style.left = `${Math.round(placed.left)}px`;
    root.style.top = `${Math.round(placed.top)}px`;
    root.style.maxHeight = `${placed.maxHeight}px`;
  };

  const entryRow = (e: ContextEntry, group: string): HTMLButtonElement => {
    const b = el('button', 'ctx-item', `ctx-${e.id}`);
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.dataset.state = e.state;
    b.dataset.id = e.id;
    b.dataset.group = group;
    b.tabIndex = -1;
    if (e.state === 'disabled') b.setAttribute('aria-disabled', 'true');
    const name = el('span', 'ctx-name');
    name.textContent = labelOf(e);
    b.append(name);
    const price = el('span', 'ctx-price');
    if (e.priceGold !== undefined) price.textContent = t('ctx.price', { price: formatGold(e.priceGold) });
    b.append(price);
    const key = el('kbd', 'ctx-key');
    if (e.keyHint !== undefined) key.textContent = e.keyHint;
    else key.hidden = true;
    b.append(key);
    if (e.state === 'disabled' && e.reasonKey !== undefined) {
      const why = el('span', 'ctx-reason', `ctx-reason-${e.id}`);
      why.textContent = t(e.reasonKey, e.reasonParams);
      b.append(why);
      b.setAttribute('aria-description', why.textContent);
    }
    return b;
  };

  const build = (m: ContextModel): void => {
    const title = el('div', 'ctx-title', 'ctx-title');
    title.textContent = t(m.title.key, m.title.params);
    root.setAttribute('aria-label', t('ctx.menu.aria'));
    root.append(title);
    rows = [];
    unfolded.clear();
    for (const g of m.groups) {
      const items = m.entries.filter((e) => e.group === g.id);
      if (items.length === 0) continue;
      const host = el('div', 'ctx-items');
      if (g.titleKey !== undefined) {
        const gb = groupHeader(g);
        rows.push({ kind: 'group', id: g.id, group: g.id, el: gb });
        root.append(gb, host);
        host.hidden = !g.open;
        gb.setAttribute('aria-expanded', g.open ? 'true' : 'false');
        if (g.open) unfolded.add(g.id);
      } else {
        root.append(host);
      }
      for (const e of items) {
        const b = entryRow(e, g.id);
        host.append(b);
        rows.push({ kind: 'entry', id: e.id, group: g.id, el: b, entry: e, name: b.querySelector('.ctx-name') as HTMLElement });
        b.addEventListener('click', () => {
          const i = rows.findIndex((r) => r.el === b);
          if (i >= 0) setFocus(i);
          activate(rows[i] as Row);
        });
      }
    }
  };

  const groupHeader = (g: ContextGroup): HTMLButtonElement => {
    const b = el('button', 'ctx-group', `ctx-group-${g.id}`);
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.setAttribute('aria-haspopup', 'true');
    b.tabIndex = -1;
    const name = el('span', 'ctx-group-name');
    name.textContent = t(g.titleKey as NonNullable<typeof g.titleKey>, g.params);
    b.append(name);
    const key = el('kbd', 'ctx-key');
    if (g.keyHint !== undefined) key.textContent = g.keyHint;
    else key.hidden = true;
    b.append(key);
    b.addEventListener('click', () => {
      const i = rows.findIndex((r) => r.el === b);
      if (i >= 0) setFocus(i);
      toggle(g.id);
    });
    return b;
  };

  root.addEventListener('keydown', (ev) => {
    const k = ev.key;
    const list = walkable();
    const cur = list.findIndex((r) => r === rows[focus]);
    if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Home' || k === 'End') {
      const next = list[moveFocus(list.length, cur, k)];
      if (next !== undefined) setFocus(rows.indexOf(next));
    } else if (k === 'Enter' || k === ' ') {
      const r = rows[focus];
      if (r !== undefined) activate(r);
    } else if (k === 'ArrowRight' || k === 'ArrowLeft') {
      const r = rows[focus];
      if (r === undefined) return;
      toggle(r.group, k === 'ArrowRight');
      if (k === 'ArrowLeft') {
        const h = rows.findIndex((x) => x.kind === 'group' && x.id === r.group);
        if (h >= 0) setFocus(h);
      }
    } else if (k === 'Escape' || k === 'Tab' || ev.ctrlKey || ev.metaKey || ev.altKey) {
      return; // Escape belongs to the input stack; Tab and shortcuts keep their browser meaning
    } else {
      // the game keys are dead while the menu is open (the menu shows the key beside each entry; it does not take them)
      ev.stopPropagation();
      ev.preventDefault();
      return;
    }
    ev.stopPropagation();
    ev.preventDefault();
  });

  return {
    root,
    isOpen: () => open,
    placement: () => placed,
    open(m: ContextModel, x: number, y: number): void {
      if (open) close();
      open = true;
      model = m;
      build(m);
      root.hidden = false;
      root.dataset.px = String(x);
      root.dataset.py = String(y);
      const box = parent.getBoundingClientRect();
      place(x, y, box.width, box.height);
      outside = (e: Event) => {
        const target = e.target as Element;
        if (target.tagName === 'CANVAS') return; // the menu's input mode takes presses on the map (it must consume them, so the click does not also act)
        if (!root.contains(target)) close();
      };
      document.addEventListener('pointerdown', outside, true);
      const list = walkable();
      const first = list.find((r) => r.kind === 'entry' && r.entry?.state === 'ok') ?? list[0];
      if (first !== undefined) setFocus(rows.indexOf(first));
    },
    close,
    dispose(): void {
      close();
      root.remove();
      style.remove();
      void model;
    },
  };
}
