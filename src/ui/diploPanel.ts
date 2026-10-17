// The diplomacy interface (M18c-2): the panel (opened by key D or the top-bar button, one row per nation with its relation and the buttons) and the proposal cards (at
// most DIPLO.cardsMax, always on screen while a proposal waits). Plain DOM built from JS. The panel only SENDS intents through `DiploActions` and READS the sim through
// the model (`src/ui/diploModel.ts`), where every button state is the answer of a `validate*` function. The DOM is written only where a text, an attribute or a state
// changed: the rows are rebuilt when the clock second, the diplomacy table, the language or the armed break changed, so a resting page makes no mutation at all.
import { PROPOSAL_TTL_TICKS, RELATION_ALLIANCE, RELATION_TRUCE, TICK_HZ, TREATY_ALLIANCE, TREATY_BREAK_COOLDOWN_TICKS, TREATY_TRUCE, type SimView } from '../sim/public';
import { BreakConfirm, buildDiploRows, incomingProposals, secondsLeft, type DiploButton, type DiploRow, type ProposalCard } from './diploModel';
import { diplomacyRefusalKey } from './diploReasons';
import { formatClock, formatFixed, languageVersion, t, type TextKey } from './i18n';
import { showToast } from './toast';
import { DIPLO, TOPBAR } from './uiConfig';

const TOPBAR_CARDS_TOP_EM = TOPBAR.wideEm + 0.4;

export interface DiploActions {
  propose(seat: number, treaty: number): void;
  accept(from: number): void;
  decline(from: number): void;
  breakTreaty(seat: number): void;
  impose(seat: number): void;
  lift(seat: number): void;
  close(): void;
}

export interface DiploUiOptions {
  nameOf(seat: number): string;
  colorOf(seat: number): string;
}

export interface DiploPanel {
  readonly root: HTMLElement;
  isOpen(): boolean;
  open(): void;
  close(): void;
  /** Once per frame. `version` is the table version of the mirror (a change redraws), `fxNow` the fx clock (the break confirmation times out on it). */
  update(view: SimView, localSeat: number, version: number, fxNow: number): void;
  dispose(): void;
}

function div(className: string, testid?: string): HTMLElement {
  const e = document.createElement('div');
  e.className = className;
  if (testid !== undefined) e.dataset.testid = testid;
  return e;
}

function span(className: string, testid?: string): HTMLElement {
  const e = document.createElement('span');
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

const RELATION_NAMES = ['war', 'truce', 'alliance'] as const;

type ActionId = 'truce' | 'alliance' | 'break' | 'embargo';

class RowView {
  readonly root = div('diplo-row', 'diplo-row');
  private readonly swatch = span('diplo-swatch');
  private readonly name = span('diplo-name', 'diplo-name');
  private readonly share = span('diplo-share');
  private readonly rel = span('diplo-rel', 'diplo-rel');
  private readonly marks = span('diplo-marks');
  private readonly embargoMark = span('diplo-mark diplo-mark-embargo', 'diplo-embargo-mark');
  private readonly traitorMark = span('diplo-mark diplo-mark-traitor', 'diplo-traitor');
  private readonly waiting = span('diplo-waiting', 'diplo-waiting');
  private readonly note = div('diplo-note', 'diplo-note');
  readonly buttons = new Map<ActionId, HTMLButtonElement>();
  /** Fix-5B: a proposal from this nation waits: its text and the Accept / Decline pair sit on the row (the cards hide while the panel is open). */
  private readonly incoming = div('diplo-incoming', 'diplo-incoming');
  private readonly incomingText = span('diplo-incoming-text', 'diplo-incoming-text');
  private readonly incomingAccept = document.createElement('button');
  private readonly incomingDecline = document.createElement('button');

  constructor(
    readonly seat: number,
    color: string,
    click: (id: ActionId, seat: number) => void,
    respond: (accept: boolean, seat: number) => void,
  ) {
    this.root.dataset.seat = String(seat);
    this.swatch.style.background = color;
    const who = div('diplo-who');
    who.append(this.swatch, this.name, this.share);
    const state = div('diplo-state');
    this.marks.append(this.embargoMark, this.traitorMark);
    state.append(this.rel, this.marks, this.waiting);
    const actions = div('diplo-actions');
    for (const id of ['truce', 'alliance', 'break', 'embargo'] as const) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'diplo-btn';
      b.dataset.testid = `diplo-${id}`;
      b.dataset.action = id;
      b.addEventListener('click', () => {
        click(id, seat);
        b.blur(); // keys must keep going to the game
      });
      this.buttons.set(id, b);
      actions.append(b);
    }
    this.note.hidden = true;
    for (const [b, id, accept] of [[this.incomingAccept, 'diplo-row-accept', true], [this.incomingDecline, 'diplo-row-decline', false]] as const) {
      b.type = 'button';
      b.className = 'diplo-btn';
      b.dataset.testid = id;
      b.addEventListener('click', () => (respond(accept, seat), b.blur()));
    }
    this.incoming.hidden = true;
    this.incoming.append(this.incomingText, this.incomingAccept, this.incomingDecline);
    this.root.append(who, state, actions, this.incoming, this.note);
  }

  /** `p` is the waiting proposal from this nation (null when none). */
  setIncoming(p: ProposalCard | null, nameText: string): void {
    setHidden(this.incoming, p === null);
    setData(this.root, 'incoming', p === null ? '0' : '1');
    if (p === null) return;
    setText(this.incomingText, `${t(p.treaty === TREATY_ALLIANCE ? 'diplo.card.alliance' : 'diplo.card.truce', { name: nameText })} (${t('phase.seconds', { s: secondsLeft(p.ticksLeft) })})`);
    setText(this.incomingAccept, t('diplo.accept'));
    setText(this.incomingDecline, t('diplo.decline'));
  }

  private button(id: ActionId, label: string, b: DiploButton, armed = false): void {
    const e = this.buttons.get(id) as HTMLButtonElement;
    setText(e, label);
    setAttr(e, 'aria-disabled', b.enabled ? 'false' : 'true');
    setData(e, 'enabled', b.enabled ? '1' : '0');
    setData(e, 'reason', String(b.reason));
    setData(e, 'armed', armed ? '1' : '0');
    setAttr(e, 'title', b.enabled ? '' : t(diplomacyRefusalKey(b.reason)));
  }

  set(row: DiploRow, nameText: string, armed: boolean, cooldownTicks: number): void {
    setText(this.name, nameText);
    setText(this.share, t('hud.percent', { n: formatFixed(Math.round((row.shareQ15 / 32768) * 1000) / 10, 1) }));
    setData(this.root, 'relation', RELATION_NAMES[row.relation] ?? 'war');
    setData(this.root, 'eliminated', row.eliminated ? '1' : '0');
    setData(this.root, 'embargo', row.embargo ? '1' : '0');
    const relText = row.eliminated ? t('diplo.eliminated') : row.relation === RELATION_TRUCE ? t('diplo.rel.truce', { time: formatClock(secondsLeft(row.truceTicksLeft)) }) : row.relation === RELATION_ALLIANCE ? t('diplo.rel.alliance') : t('diplo.rel.war');
    setText(this.rel, relText);
    setHidden(this.embargoMark, !row.embargo);
    setText(this.embargoMark, t('diplo.name.embargo'));
    setHidden(this.traitorMark, row.betrayals === 0);
    setText(this.traitorMark, t('diplo.traitor', { n: row.betrayals }));
    setAttr(this.traitorMark, 'title', t('diplo.traitorTip', { n: row.betrayals }));
    setHidden(this.waiting, row.waitingTicks === 0);
    setText(this.waiting, row.waitingTicks === 0 ? '' : t('diplo.waiting', { s: secondsLeft(row.waitingTicks) }));
    this.button('truce', t('diplo.btn.truce'), row.truce);
    this.button('alliance', t('diplo.btn.alliance'), row.alliance);
    this.button('break', armed ? t('diplo.btn.breakConfirm') : t('diplo.btn.break'), row.breakTreaty, armed);
    this.button('embargo', row.embargoOwn ? t('diplo.btn.lift') : t('diplo.btn.embargo'), row.embargoButton);
    setHidden(this.note, !armed);
    if (armed) setText(this.note, t('diplo.breakWarn', { time: formatClock(secondsLeft(cooldownTicks)) }));
  }
}

/** The panel. `parent` is the page wrapper (the panel is a sibling of the HUD root, above it). */
export function createDiploPanel(parent: HTMLElement, actions: DiploActions, opts: DiploUiOptions): DiploPanel {
  const root = div('diplo-overlay', 'diplo-panel');
  root.hidden = true;
  const card = div('diplo-card');
  card.setAttribute('role', 'dialog');
  const head = div('diplo-head');
  const title = span('diplo-title', 'diplo-title');
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'diplo-btn diplo-close';
  closeBtn.dataset.testid = 'diplo-close';
  closeBtn.addEventListener('click', () => actions.close());
  const selfMark = span('diplo-mark diplo-mark-traitor', 'diplo-self-traitor');
  selfMark.hidden = true;
  head.append(title, selfMark, closeBtn);
  const cooldown = div('diplo-cooldown', 'diplo-cooldown');
  cooldown.hidden = true;
  const list = div('diplo-list', 'diplo-list');
  const empty = div('diplo-empty', 'diplo-empty');
  empty.hidden = true;
  const hint = div('diplo-hint', 'diplo-hint');
  card.append(head, cooldown, list, empty, hint);
  root.append(card);
  for (const type of ['pointerdown', 'pointerup', 'wheel', 'contextmenu']) root.addEventListener(type, (e) => e.stopPropagation());
  parent.append(root);

  const confirm = new BreakConfirm();
  const views = new Map<number, RowView>();
  let isOpen = false;
  let lastStamp = '';
  let lastView: SimView | null = null;
  let lastSeat = 0;
  let lastNow = 0;

  const click = (id: ActionId, seat: number): void => {
    const v = lastView;
    if (v === null) return;
    const row = buildDiploRows(v, lastSeat).find((r) => r.seat === seat);
    if (row === undefined) return;
    const b = id === 'truce' ? row.truce : id === 'alliance' ? row.alliance : id === 'break' ? row.breakTreaty : row.embargoButton;
    if (id !== 'break') confirm.clear();
    if (!b.enabled) {
      // a refused button explains itself in a toast too (a touch screen has no tooltip)
      confirm.clear();
      showToast(diplomacyRefusalKey(b.reason), undefined, 'warn');
      lastStamp = '';
      return;
    }
    if (id === 'truce') actions.propose(seat, TREATY_TRUCE);
    else if (id === 'alliance') actions.propose(seat, TREATY_ALLIANCE);
    else if (id === 'embargo') (row.embargoOwn ? actions.lift : actions.impose)(seat);
    else if (confirm.click(seat, lastNow, DIPLO.confirmSeconds)) actions.breakTreaty(seat);
    lastStamp = ''; // redraw at the next frame
  };

  const draw = (v: SimView, L: number): void => {
    title.textContent = t('diplo.title');
    closeBtn.textContent = t('diplo.close');
    hint.textContent = t('diplo.hint', { s: Math.round(PROPOSAL_TTL_TICKS / TICK_HZ) });
    card.setAttribute('aria-label', t('diplo.title'));
    const rows = buildDiploRows(v, L);
    setHidden(empty, rows.length !== 0);
    setText(empty, t('diplo.empty'));
    const mine = v.match.betrayals[L] as number;
    setHidden(selfMark, mine === 0);
    setText(selfMark, t('diplo.traitor', { n: mine }));
    setAttr(selfMark, 'title', t('diplo.traitorTip', { n: mine }));
    const cd = v.diplomacy.breakCooldownLeft(L);
    setHidden(cooldown, cd === 0);
    if (cd !== 0) setText(cooldown, t('diplo.cooldown', { time: formatClock(secondsLeft(cd)) }));
    const armedSeat = confirm.armed();
    const incoming = incomingProposals(v, L, DIPLO.panelIncomingMax);
    let at = 0;
    for (const row of rows) {
      let rv = views.get(row.seat);
      if (rv === undefined) {
        rv = new RowView(row.seat, opts.colorOf(row.seat), click, (accept, seat) => {
          (accept ? actions.accept : actions.decline)(seat);
          lastStamp = '';
        });
        views.set(row.seat, rv);
      }
      if (list.children[at] !== rv.root) list.insertBefore(rv.root, list.children[at] ?? null);
      at++;
      rv.set(row, opts.nameOf(row.seat), armedSeat === row.seat && row.breakTreaty.enabled, TREATY_BREAK_COOLDOWN_TICKS);
      rv.setIncoming(incoming.find((p) => p.from === row.seat) ?? null, opts.nameOf(row.seat));
    }
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
    update(v: SimView, L: number, version: number, fxNow: number): void {
      if (!isOpen) return;
      lastView = v;
      lastSeat = L;
      lastNow = fxNow;
      confirm.expire(fxNow);
      const stamp = `${Math.floor(v.tick / TICK_HZ)}|${version}|${languageVersion()}|${confirm.armed()}`;
      if (stamp === lastStamp) return;
      lastStamp = stamp;
      draw(v, L);
    },
    dispose(): void {
      root.remove();
    },
  };
}

// ---- the proposal cards -------------------------------------------------------------------------------------------------------------

export interface DiploCards {
  readonly root: HTMLElement;
  /** Fix-5B: hide the cards (the panel is open and shows Accept / Decline on its rows) without losing the state. */
  setSuppressed(suppressed: boolean): void;
  update(view: SimView, localSeat: number, version: number): void;
  dispose(): void;
}

class CardView {
  readonly root = div('diplo-pcard', 'diplo-card-in');
  readonly text = span('diplo-pcard-text', 'diplo-card-text');
  readonly left = span('diplo-pcard-left', 'diplo-card-left');
  readonly accept = document.createElement('button');
  readonly decline = document.createElement('button');
  from = -1;
  constructor(onAccept: (from: number) => void, onDecline: (from: number) => void) {
    this.accept.type = 'button';
    this.accept.className = 'diplo-btn diplo-accept';
    this.accept.dataset.testid = 'diplo-accept';
    this.decline.type = 'button';
    this.decline.className = 'diplo-btn';
    this.decline.dataset.testid = 'diplo-decline';
    this.accept.addEventListener('click', () => (onAccept(this.from), this.accept.blur()));
    this.decline.addEventListener('click', () => (onDecline(this.from), this.decline.blur()));
    const top = div('diplo-pcard-top');
    top.append(this.text, this.left);
    const buttons = div('diplo-pcard-btns');
    buttons.append(this.accept, this.decline);
    this.root.append(top, buttons);
    this.root.hidden = true;
  }
}

/** The incoming proposals as cards (at most DIPLO.cardsMax); rebuilt when the clock second, the table or the language changed. */
export function createDiploCards(parent: HTMLElement, actions: DiploActions, opts: DiploUiOptions): DiploCards {
  const root = div('diplo-cards', 'diplo-cards');
  const cards: CardView[] = [];
  for (let i = 0; i < DIPLO.cardsMax; i++) {
    const c = new CardView((from) => actions.accept(from), (from) => actions.decline(from));
    cards.push(c);
    root.append(c.root);
  }
  for (const type of ['pointerdown', 'pointerup', 'wheel', 'contextmenu']) root.addEventListener(type, (e) => e.stopPropagation());
  parent.append(root);
  let lastStamp = '';
  let suppressed = false;
  let shown = -1;
  // the sibling HUD reads the stack height from the page wrapper: the selection panel stops below the cards instead of running under them
  const publish = (n: number): void => {
    if (n === shown) return;
    shown = n;
    parent.style.setProperty('--diplo-stack-em', n === 0 ? '0.6em' : `${TOPBAR_CARDS_TOP_EM + n * DIPLO.cardHeightEm}em`);
  };
  return {
    root,
    setSuppressed(s: boolean): void {
      if (s === suppressed) return;
      suppressed = s;
      root.hidden = s;
      publish(s ? 0 : cards.filter((c) => !c.root.hidden).length);
    },
    update(v: SimView, L: number, version: number): void {
      const stamp = `${Math.floor(v.tick / TICK_HZ)}|${version}|${languageVersion()}`;
      if (stamp === lastStamp) return;
      lastStamp = stamp;
      const list = incomingProposals(v, L, DIPLO.cardsMax);
      for (let i = 0; i < cards.length; i++) {
        const c = cards[i] as CardView;
        const p = list[i];
        if (p === undefined) {
          setHidden(c.root, true);
          c.from = -1;
          continue;
        }
        c.from = p.from;
        setHidden(c.root, false);
        setData(c.root, 'from', String(p.from));
        setData(c.root, 'treaty', String(p.treaty));
        const key: TextKey = p.treaty === TREATY_ALLIANCE ? 'diplo.card.alliance' : 'diplo.card.truce';
        setText(c.text, t(key, { name: opts.nameOf(p.from) }));
        setText(c.left, t('phase.seconds', { s: secondsLeft(p.ticksLeft) }));
        setText(c.accept, t('diplo.accept'));
        setText(c.decline, t('diplo.decline'));
      }
      publish(suppressed ? 0 : Math.min(list.length, cards.length));
    },
    dispose(): void {
      root.remove();
    },
  };
}
