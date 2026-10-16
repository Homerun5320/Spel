// The research panel (M18d-2): four columns (the branches) of four cells (the steps), opened by key T or the top-bar button "Teknik" as an input mode. Plain DOM built from
// JS. The panel only SENDS Research / CancelResearch through `TechActions` and READS the sim through the model (`src/ui/techModel.ts`): every status and every button state is
// the answer of `validateResearch` / `validateCancelResearch`. The DOM is written only where a text, an attribute or a state changed, and the whole list is looked at only
// when the clock second, the researched mask, the running tech, the language or the armed cancel changed, so a resting page makes no DOM mutation at all.
import { MILLI_GOLD_PER_GOLD, TECH_COUNT, TECH_PRICE_GOLD, TICK_HZ, type SimView } from '../sim/public';
import { formatClock, formatGold, languageVersion, t, type TextKey } from './i18n';
import { techRefusalKey } from './techReasons';
import { BreakConfirm } from './diploModel';
import { buildTechCells, cancelState, techEffectText, techName, TECH_BRANCH_KEYS, TECH_BRANCHES, TECH_STEPS, type TechCell } from './techModel';
import { showToast } from './toast';
import { TECH_UI } from './uiConfig';

export interface TechActions {
  research(tech: number): void;
  cancel(): void;
  close(): void;
}

export interface TechPanel {
  readonly root: HTMLElement;
  isOpen(): boolean;
  open(): void;
  close(): void;
  /** Once per frame (cheap when nothing changed). `fxNow` is the fx clock (the cancel confirmation times out on it). */
  update(view: SimView, localSeat: number, fxNow: number): void;
  dispose(): void;
}

function mk<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, testid?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (testid !== undefined) e.dataset.testid = testid;
  return e;
}
const setText = (e: HTMLElement, s: string): void => {
  if (e.textContent !== s) e.textContent = s;
};
const setAttr = (e: HTMLElement, name: string, v: string): void => {
  if (e.getAttribute(name) !== v) e.setAttribute(name, v);
};
const setData = (e: HTMLElement, name: string, v: string): void => {
  if (e.dataset[name] !== v) e.dataset[name] = v;
};
const setHidden = (e: HTMLElement, hidden: boolean): void => {
  if (e.hidden !== hidden) e.hidden = hidden;
};

class CellView {
  readonly root = mk('div', 'tech-cell', 'tech-cell');
  private readonly name = mk('div', 'tech-name', 'tech-name');
  private readonly fx = mk('div', 'tech-fx', 'tech-fx');
  private readonly meta = mk('div', 'tech-meta', 'tech-meta');
  private readonly status = mk('div', 'tech-status', 'tech-status');
  private readonly why = mk('div', 'tech-why', 'tech-why');
  private readonly bar = mk('div', 'tech-bar', 'tech-bar');
  private readonly fill = mk('div', 'tech-bar-fill');
  readonly research = mk('button', 'tech-btn', 'tech-research');
  readonly cancel = mk('button', 'tech-btn tech-cancel', 'tech-cancel');
  private fillPct = -1;

  constructor(readonly tech: number, onResearch: (tech: number) => void, onCancel: () => void) {
    this.root.dataset.tech = String(tech);
    this.bar.append(this.fill);
    this.research.type = 'button';
    this.cancel.type = 'button';
    this.research.addEventListener('click', () => (onResearch(tech), this.research.blur())); // keys must keep going to the game
    this.cancel.addEventListener('click', () => (onCancel(), this.cancel.blur()));
    const actions = mk('div', 'tech-actions');
    actions.append(this.research, this.cancel);
    this.root.append(this.name, this.fx, this.meta, this.status, this.why, this.bar, actions);
  }

  set(c: TechCell, armed: boolean): void {
    setText(this.name, techName(c.tech));
    setText(this.fx, techEffectText(c.tech));
    setText(this.meta, `${t('tech.price', { price: formatGold(c.priceGold) })} · ${t('tech.time', { time: formatClock(c.ticks / TICK_HZ) })}`);
    setData(this.root, 'status', c.status);
    setData(this.root, 'reason', String(c.reason));
    const key: TextKey = c.status === 'done' ? 'tech.status.done' : c.status === 'active' ? 'tech.status.active' : c.status === 'available' ? 'tech.status.available' : c.status === 'locked' ? 'tech.status.locked' : 'tech.status.blocked';
    setText(this.status, t(key, { time: formatClock(Math.ceil(c.ticksLeft / TICK_HZ)), name: c.prereq >= 0 ? techName(c.prereq) : '' }));
    const whyText = c.status === 'blocked' ? t(techRefusalKey(c.reason)) : '';
    setHidden(this.why, whyText === '');
    setText(this.why, whyText);
    setHidden(this.bar, c.status !== 'active');
    if (this.fillPct !== c.progressPct) {
      this.fillPct = c.progressPct;
      this.fill.style.width = `${c.progressPct}%`;
    }
    // Research: visible for a tech you could research or that is refused for a reason that may pass (gold, a running research, the start phase).
    const showResearch = c.status === 'available' || c.status === 'blocked';
    setHidden(this.research, !showResearch);
    setText(this.research, t('tech.research'));
    setAttr(this.research, 'aria-disabled', c.canResearch ? 'false' : 'true');
    setData(this.research, 'enabled', c.canResearch ? '1' : '0');
    setAttr(this.research, 'title', c.canResearch ? '' : t(techRefusalKey(c.reason)));
    setHidden(this.cancel, c.status !== 'active');
    setText(this.cancel, armed ? t('tech.cancelConfirm') : t('tech.cancel'));
    setData(this.cancel, 'armed', armed ? '1' : '0');
  }
}

/** Which prices the purse covers, as a bit set (no allocation): the only way gold changes what a cell shows. */
function affordable(goldMilli: number): number {
  let bits = 0;
  for (let i = 0; i < TECH_COUNT; i++) if (goldMilli >= (TECH_PRICE_GOLD[i] as number) * MILLI_GOLD_PER_GOLD) bits |= 1 << i;
  return bits;
}

/** The panel. `parent` is the page wrapper (the panel is a sibling of the HUD root, above it). */
export function createTechPanel(parent: HTMLElement, actions: TechActions): TechPanel {
  const root = mk('div', 'tech-overlay', 'tech-panel');
  root.hidden = true;
  const card = mk('div', 'tech-card');
  card.setAttribute('role', 'dialog');
  const head = mk('div', 'tech-head');
  const title = mk('span', 'tech-title', 'tech-title');
  const closeBtn = mk('button', 'tech-btn tech-close', 'tech-close');
  closeBtn.type = 'button';
  closeBtn.addEventListener('click', () => actions.close());
  head.append(title, closeBtn);
  const grid = mk('div', 'tech-grid', 'tech-grid');
  const cancelNote = mk('div', 'tech-note', 'tech-note');
  cancelNote.hidden = true;
  const hint = mk('div', 'tech-hint', 'tech-hint');
  const cells: CellView[] = [];
  const heads: HTMLElement[] = [];
  const confirm = new BreakConfirm();
  let lastView: SimView | null = null;
  let lastSeat = 0;
  let lastNow = 0;
  let lastStamp = '';
  let isOpen = false;

  const onResearch = (tech: number): void => {
    const v = lastView;
    if (v === null) return;
    const c = buildTechCells(v, lastSeat)[tech] as TechCell;
    confirm.clear();
    lastStamp = '';
    if (!c.canResearch) {
      // a refused button explains itself in a toast too (a touch screen has no tooltip)
      showToast(techRefusalKey(c.reason), undefined, 'warn');
      return;
    }
    actions.research(tech);
  };
  const onCancel = (): void => {
    const v = lastView;
    if (v === null) return;
    lastStamp = '';
    const cs = cancelState(v, lastSeat);
    if (!cs.enabled) {
      confirm.clear();
      showToast(techRefusalKey(cs.reason), undefined, 'warn');
      return;
    }
    // two clicks, like "Bryt avtal": nothing is refunded
    if (confirm.click(0, lastNow, TECH_UI.confirmSeconds)) actions.cancel();
  };

  for (let b = 0; b < TECH_BRANCHES; b++) {
    const col = mk('div', 'tech-branch', 'tech-branch');
    col.dataset.branch = String(b);
    const h = mk('div', 'tech-branch-head', 'tech-branch-head');
    h.style.color = TECH_UI.branch[b] as string;
    heads.push(h);
    col.append(h);
    for (let s = 0; s < TECH_STEPS; s++) {
      const cv = new CellView(b * TECH_STEPS + s, onResearch, onCancel);
      cells.push(cv);
      col.append(cv.root);
    }
    grid.append(col);
  }
  card.append(head, grid, cancelNote, hint);
  root.append(card);
  for (const type of ['pointerdown', 'pointerup', 'wheel', 'contextmenu']) root.addEventListener(type, (e) => e.stopPropagation());
  parent.append(root);

  const draw = (v: SimView, L: number): void => {
    setText(title, t('tech.title'));
    setText(closeBtn, t('tech.close'));
    setText(hint, t('tech.hint'));
    setAttr(card, 'aria-label', t('tech.title'));
    for (let b = 0; b < TECH_BRANCHES; b++) setText(heads[b] as HTMLElement, t(TECH_BRANCH_KEYS[b] as TextKey));
    const list = buildTechCells(v, L);
    const armed = confirm.armed() === 0 && cancelState(v, L).enabled;
    for (const c of list) (cells[c.tech] as CellView).set(c, armed && c.status === 'active');
    setHidden(cancelNote, !armed);
    setText(cancelNote, armed ? t('tech.cancelWarn') : '');
  };

  return {
    root,
    isOpen: () => isOpen,
    open(): void {
      if (isOpen) return;
      isOpen = true;
      root.hidden = false;
      lastStamp = '';
    },
    close(): void {
      if (!isOpen) return;
      isOpen = false;
      root.hidden = true;
      confirm.clear();
    },
    update(v: SimView, L: number, fxNow: number): void {
      if (!isOpen) return;
      lastView = v;
      lastSeat = L;
      lastNow = fxNow;
      confirm.expire(fxNow);
      const m = v.match;
      const stamp = `${Math.floor(v.tick / TICK_HZ)}|${m.techMaskOfSeat(L)}|${m.techCurrentOfSeat(L)}|${affordable(v.stats.goldMilli[L] as number)}|${languageVersion()}|${confirm.armed()}|${v.phase}|${m.ended ? 1 : 0}`;
      if (stamp === lastStamp) return;
      lastStamp = stamp;
      draw(v, L);
    },
    dispose(): void {
      root.remove();
    },
  };
}

