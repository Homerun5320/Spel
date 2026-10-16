// The match panels (M18-2): the pause menu, the result screen, the elimination panel and the spectator bar. Plain DOM built from JS, no
// canvas and no per-frame work: a panel is drawn when it opens (and again when the language changes) and then only waits for a click.
// Every text goes through t(), every colour and size is in uiConfig / hudStyle. Each dialog traps Tab and gives the focus back where it came from.
import { mountHudStyle } from './hudStyle';
import { formatFixed, t } from './i18n';
import { drawFlag } from './flag';
import { FED_BOARD, FLAG_ROW_H, FLAG_ROW_W } from './uiConfig';
import type { ResultGroup } from './groupModel';
import type { ReasonLine, ResultRow } from './matchFlow';

export interface ResultView {
  readonly reason: ReasonLine;
  readonly rows: readonly ResultRow[];
  /** M18b-3: the groups (federations and single nations), present only in a match with federations. */
  readonly groups?: readonly ResultGroup[];
}

/**
 * M18b-3: the group table of the result screen: a row per group (rank, flag, name, summed land and score; the winner first), a federation's living and fallen
 * members under it. Separate from the per-nation table below, which stays as it is.
 */
function appendGroupTable(card: HTMLElement, v: ResultView): void {
  const groups = v.groups;
  if (groups === undefined || !groups.some((g) => g.fed >= 0)) return;
  addText(card, 'h3', 'mp-subtitle', t('result.groups.title'), 'result-groups-title');
  const wrap = el('div', 'mp-table-wrap');
  const table = el('table', 'mp-table', 'result-groups');
  const head = el('tr', '');
  for (const k of ['result.col.rank', 'result.col.group', 'result.col.land', 'result.col.score'] as const) {
    const th = el('th', k === 'result.col.group' ? 'mp-left' : '');
    th.scope = 'col';
    th.textContent = t(k);
    head.append(th);
  }
  table.createTHead().append(head);
  const body = table.createTBody();
  const byseat = new Map<number, ResultRow>();
  for (const r of v.rows) byseat.set(r.seat, r);
  const nameCell = (parent: HTMLElement, color: string, text: string, g: ResultGroup | null): void => {
    const td = el('td', 'mp-left mp-name');
    if (g !== null && g.flag !== null) {
      const c = document.createElement('canvas');
      c.className = 'mp-flag';
      c.width = FLAG_ROW_W * 2;
      c.height = FLAG_ROW_H * 2;
      c.style.width = `${FLAG_ROW_W}px`;
      c.style.height = `${FLAG_ROW_H}px`;
      c.setAttribute('aria-hidden', 'true');
      const ctx = c.getContext('2d');
      if (ctx !== null) drawFlag(ctx, g.flag, c.width, c.height);
      td.append(c);
    } else {
      const sw = el('span', 'mp-swatch');
      sw.style.background = color;
      td.append(sw);
    }
    const name = el('span', 'mp-name-text');
    name.textContent = text;
    td.append(name);
    parent.append(td);
  };
  for (const g of groups) {
    const first = byseat.get(g.members[0] as number);
    const tr = el('tr', '', 'result-group');
    tr.dataset.fed = String(g.fed);
    tr.dataset.rank = String(g.rank);
    tr.dataset.winner = g.winner ? '1' : '0';
    tr.dataset.you = g.you ? '1' : '0';
    tr.dataset.group = g.fed >= 0 ? '1' : '0';
    tr.dataset.members = g.members.join(',');
    const rank = el('td', '');
    rank.textContent = String(g.rank);
    tr.append(rank);
    const alive = g.members.filter((s) => byseat.get(s)?.eliminated !== true).length;
    nameCell(tr, first?.color ?? FED_BOARD.accent, g.fed >= 0 ? `${g.name} (${t('result.groups.alive', { alive, total: g.members.length })})` : g.name, g);
    const land = el('td', '');
    land.textContent = `${formatFixed(g.landPct, 1)} %`;
    const score = el('td', '');
    score.textContent = String(g.score);
    tr.append(land, score);
    body.append(tr);
    if (g.fed < 0) continue;
    for (const s of g.members) {
      const r = byseat.get(s);
      if (r === undefined) continue;
      const sub = el('tr', '', 'result-group-member');
      sub.dataset.sub = '1';
      sub.dataset.seat = String(s);
      sub.dataset.eliminated = r.eliminated ? '1' : '0';
      sub.dataset.you = r.you ? '1' : '0';
      sub.append(el('td', ''));
      nameCell(sub, r.color, r.name, null);
      const l = el('td', '');
      l.textContent = `${formatFixed(r.landPct, 1)} %`;
      const sc = el('td', '');
      sc.textContent = String(r.score);
      sub.append(l, sc);
      body.append(sub);
    }
  }
  wrap.append(table);
  card.append(wrap);
}

export interface PanelActions {
  resume(): void;
  restart(): void;
  toMenu(): void;
  setSpeed(speed: 1 | 2 | 4): void;
  /** The eliminated human chose to watch. */
  spectate(): void;
  /** The result screen's "play again" (the same setup, a new seed). */
  playAgain(): void;
}

/** What the panels read when they are drawn. */
export interface PanelData {
  /** The one-line summary of the win conditions. */
  summary(): string;
  /** The speed the player chose (1, 2 or 4). */
  speed(): number;
  result(): ResultView | null;
}

export interface MatchPanels {
  readonly root: HTMLElement;
  openPause(): void;
  closePause(): void;
  readonly pauseOpen: boolean;
  showResult(): void;
  readonly resultOpen: boolean;
  showEliminated(): void;
  hideEliminated(): void;
  readonly eliminatedOpen: boolean;
  /** The small bar of a spectating player (badge, speeds, menu). */
  setSpectating(on: boolean): void;
  readonly spectating: boolean;
  /** Draws the open panels again (the language changed, the speed changed). */
  refresh(): void;
  /** Is any modal panel open (the pause key is not ours then). */
  readonly modalOpen: boolean;
  dispose(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, testid?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className !== '') e.className = className;
  if (testid !== undefined) e.dataset.testid = testid;
  return e;
}

function button(testid: string, text: string, onClick: () => void, primary = false): HTMLButtonElement {
  const b = el('button', primary ? 'mp-btn mp-primary' : 'mp-btn', testid);
  b.type = 'button';
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

/** Appends a text element to `parent` and returns it. */
function addText<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, className: string, text: string, testid?: string): HTMLElementTagNameMap[K] {
  const e = el(tag, className, testid);
  e.textContent = text;
  parent.append(e);
  return e;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled])';

/** A modal dialog: a scrim with a card, a Tab trap and the focus given back on close. */
class Dialog {
  readonly scrim: HTMLElement;
  readonly card: HTMLElement;
  private returnTo: Element | null = null;
  isOpen = false;

  constructor(parent: HTMLElement, testid: string, cardClass: string, private readonly build: (card: HTMLElement) => void) {
    this.scrim = el('div', 'mp-scrim', testid);
    this.scrim.hidden = true;
    this.card = el('div', `mp-card ${cardClass}`);
    this.card.setAttribute('role', 'dialog');
    this.card.setAttribute('aria-modal', 'true');
    this.scrim.append(this.card);
    parent.append(this.scrim);
    // The dialog keeps its clicks and wheel turns from whatever is below it.
    for (const type of ['pointerdown', 'pointerup', 'wheel', 'contextmenu']) this.scrim.addEventListener(type, (e) => e.stopPropagation());
    this.scrim.addEventListener('keydown', (e) => this.trap(e));
  }

  private trap(e: KeyboardEvent): void {
    if (e.key !== 'Tab') return;
    const items = Array.from(this.card.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) return;
    const first = items[0] as HTMLElement;
    const last = items[items.length - 1] as HTMLElement;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !this.card.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !this.card.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  }

  draw(): void {
    const active = document.activeElement;
    const keep = active instanceof HTMLElement && this.card.contains(active) ? active.dataset.testid : undefined;
    this.card.textContent = '';
    this.build(this.card);
    if (keep !== undefined) this.card.querySelector<HTMLElement>(`[data-testid="${keep}"]`)?.focus({ preventScroll: true });
  }

  open(): void {
    if (this.isOpen) return;
    this.isOpen = true;
    this.returnTo = document.activeElement;
    this.draw();
    this.scrim.hidden = false;
    (this.card.querySelector<HTMLElement>('[data-initial="1"]') ?? this.card.querySelector<HTMLElement>(FOCUSABLE))?.focus({ preventScroll: true });
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.scrim.hidden = true;
    const back = this.returnTo;
    this.returnTo = null;
    if (back instanceof HTMLElement && back.isConnected) back.focus({ preventScroll: true });
    else if (document.activeElement instanceof HTMLElement && this.card.contains(document.activeElement)) document.activeElement.blur();
  }
}

export function createMatchPanels(parent: HTMLElement, actions: PanelActions, data: PanelData): MatchPanels {
  const root = el('div', 'mp-root', 'match-panels');
  root.append(mountHudStyle(root));
  parent.append(root);

  const speedGroup = (card: HTMLElement, redraw: () => void): void => {
    addText(card, 'div', 'mp-label', t('pause.speed'));
    const row = el('div', 'mp-row', 'pause-speeds');
    for (const s of [1, 2, 4] as const) {
      const b = button(`pause-speed-${s}`, t('hud.speedValue', { n: s }), () => {
        actions.setSpeed(s);
        redraw();
      });
      b.setAttribute('aria-pressed', data.speed() === s ? 'true' : 'false');
      row.append(b);
    }
    card.append(row);
  };

  const pause: Dialog = new Dialog(root, 'pause-menu', 'mp-small', (card) => {
    addText(card, 'h2', 'mp-title', t('pause.title'), 'pause-title');
    addText(card, 'p', 'mp-text', data.summary(), 'pause-summary');
    const col = el('div', 'mp-col');
    const resume = button('pause-resume', t('pause.resume'), () => actions.resume(), true);
    resume.dataset.initial = '1';
    col.append(resume, button('pause-restart', t('pause.restart'), () => actions.restart()), button('pause-menu-btn', t('pause.menu'), () => actions.toMenu()));
    card.append(col);
    speedGroup(card, () => pause.draw());
  });

  const result: Dialog = new Dialog(root, 'result-screen', 'mp-wide', (card) => {
    const v = data.result();
    if (v === null) return;
    const title = el('h2', 'mp-title', 'result-title');
    title.textContent = t(v.reason.titleKey, v.reason.titleParams);
    const reason = el('p', 'mp-reason', 'result-reason');
    reason.textContent = t(v.reason.reasonKey, v.reason.reasonParams);
    card.append(title, reason);
    appendGroupTable(card, v);
    const wrap = el('div', 'mp-table-wrap');
    const table = el('table', 'mp-table', 'result-table');
    const head = el('tr', '');
    for (const k of ['result.col.rank', 'result.col.nation', 'result.col.land', 'result.col.score', 'result.col.peak', 'result.col.built', 'result.col.conquered', 'result.col.treaties', 'result.col.betrayals'] as const) {
      const th = el('th', k === 'result.col.nation' ? 'mp-left' : '');
      th.scope = 'col';
      th.textContent = t(k);
      head.append(th);
    }
    table.createTHead().append(head);
    const body = table.createTBody();
    for (const r of v.rows) {
      const tr = el('tr', '', 'result-row');
      tr.dataset.seat = String(r.seat);
      tr.dataset.rank = String(r.rank);
      tr.dataset.you = r.you ? '1' : '0';
      tr.dataset.winner = r.winner ? '1' : '0';
      tr.dataset.eliminated = r.eliminated ? '1' : '0';
      const cells: string[] = [String(r.rank), '', `${formatFixed(r.landPct, 1)} %`, String(r.score), String(r.peakLand), String(r.built), String(r.conquered), String(r.treaties), String(r.betrayals)];
      cells.forEach((text, i) => {
        const td = el('td', i === 1 ? 'mp-left mp-name' : '');
        if (i === 1) {
          const sw = el('span', 'mp-swatch');
          sw.style.background = r.color;
          const name = el('span', 'mp-name-text');
          name.textContent = r.name;
          td.append(sw, name);
        } else td.textContent = text;
        tr.append(td);
      });
      body.append(tr);
    }
    wrap.append(table);
    card.append(wrap);
    const row = el('div', 'mp-row mp-actions');
    const again = button('result-again', t('result.playAgain'), () => actions.playAgain(), true);
    again.dataset.initial = '1';
    row.append(again, button('result-menu', t('result.toMenu'), () => actions.toMenu()));
    card.append(row);
  });

  const eliminated: Dialog = new Dialog(root, 'eliminated-panel', 'mp-small', (card) => {
    addText(card, 'h2', 'mp-title', t('elim.title'), 'eliminated-title');
    addText(card, 'p', 'mp-text', t('elim.text'));
    const col = el('div', 'mp-col');
    const watch = button('elim-spectate', t('elim.spectate'), () => actions.spectate(), true);
    watch.dataset.initial = '1';
    col.append(watch, button('elim-restart', t('pause.restart'), () => actions.restart()), button('elim-menu', t('pause.menu'), () => actions.toMenu()));
    card.append(col);
  });

  // The spectator bar: a small badge with the speeds and a way out, top centre under the countdown banner of the spawn phase.
  const bar = el('div', 'mp-spectator', 'spectator-bar');
  bar.hidden = true;
  let spectating = false;
  const drawBar = (): void => {
    bar.textContent = '';
    addText(bar, 'span', 'mp-badge', t('spectator.badge'), 'spectator-badge');
    for (const s of [1, 2, 4] as const) {
      const b = button(`spectator-speed-${s}`, t('hud.speedValue', { n: s }), () => {
        actions.setSpeed(s);
        drawBar();
      });
      b.setAttribute('aria-pressed', data.speed() === s ? 'true' : 'false');
      bar.append(b);
    }
    bar.append(button('spectator-menu', t('pause.menu'), () => actions.toMenu()));
  };
  root.append(bar);

  return {
    root,
    openPause: () => pause.open(),
    closePause: () => pause.close(),
    get pauseOpen() {
      return pause.isOpen;
    },
    showResult: () => {
      eliminated.close();
      pause.close();
      result.open();
    },
    get resultOpen() {
      return result.isOpen;
    },
    showEliminated: () => eliminated.open(),
    hideEliminated: () => eliminated.close(),
    get eliminatedOpen() {
      return eliminated.isOpen;
    },
    setSpectating(on: boolean) {
      spectating = on;
      bar.hidden = !on;
      if (on) drawBar();
    },
    get spectating() {
      return spectating;
    },
    refresh() {
      for (const d of [pause, result, eliminated]) if (d.isOpen) d.draw();
      if (spectating) drawBar();
    },
    get modalOpen() {
      return pause.isOpen || result.isOpen || eliminated.isOpen;
    },
    dispose() {
      root.remove();
    },
  };
}
