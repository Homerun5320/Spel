// The DOM HUD of the match (M05 part B): the status panel (gold with income per second, troops with a cap bar and a warning at
// 80 % of the cap, land share, match time), the leaderboard (top 5 and you), the banner with the phase prompt and its countdown,
// the speed buttons, the commitment slider and a toast line. Plain DOM built from JS; the style sheet is hudStyle.ts, the
// constants are uiConfig.ts, every text goes through t() (i18n.ts).
//
// The HUD only CALLS the functions it is given (`MatchHudActions`) and READS a `SimView`; it never touches the sim. Nothing is
// allocated per frame: texts are rebuilt only when the number behind them (or the language) changed (`TextCell`), the troop
// bar moves with a transform, the leaderboard is re-ranked once per tick into a preallocated array. `data-testid` ids are the
// hooks of the e2e tests and `data-value` carries the raw number behind a formatted text.
import type { SimView } from '../sim/view';
import { fleetCapOf, fleetCountOf } from '../sim/public';
import { drawFlag, type FlagSpec } from './flag';
import type { SeatLabels } from './seatLabels';
import { TICK_HZ } from './hudCodes';
import { bannerState, phaseName, rankOf, rankTop, rejectKey, seatName, shareHundredths, troopBar } from './hudLogic';
import { formatClock, formatFixed, formatGold, formatGoldRate, formatInt, languageVersion, t, type TextKey } from './i18n';
import { mountHudStyle } from './hudStyle';
import { HudGate } from './hudGate';
import { newWinMeterState, winMeterInto } from './winMeter';
import { HUD_MIN_INTERVAL_S, COMMIT_MAX_PCT, COMMIT_MIN_PCT, COMMIT_STEP_PCT, FLAG_ROW_H, FLAG_ROW_W, LEADERBOARD_INCLUDES_TRIBES, LEADERBOARD_ROWS, PLAY_HINT_SECONDS, TOAST_SECONDS, TROOP_WARNING_FRACTION } from './uiConfig';

export interface MatchHudActions {
  setCommit(pct: number): void;
  setSpeed(speed: 1 | 2 | 4): void;
  togglePause(): void;
}

export interface MatchHudOptions {
  /** CSS colour of a seat (the territory colour on the globe), for the swatches of the leaderboard. */
  seatColor?: (seat: number) => string;
  /** Names and flags of the seats (a match built by the setup screen, M06); without it the HUD names the seats Nation n / Tribe n and draws no flags. */
  labels?: SeatLabels | null;
  /** Write at most 10 times a second (default); test mode turns the gate off so that the numbers follow every `advance`. */
  throttle?: boolean;
}

export interface MatchHudModel {
  readonly view: SimView;
  readonly localSeat: number;
  readonly commitPct: number;
  /** 0 paused, else 1 / 2 / 4. */
  readonly speed: number;
  /** HUD values already interpolated for this frame (troops in whole troops, gold in whole gold). */
  readonly troops: number;
  readonly gold: number;
  /** Every nation was placed before the match began (a match from the setup screen): the banner says so instead of "starting place chosen". */
  readonly preplaced?: boolean;
}

export interface MatchHud {
  update(model: MatchHudModel, fxNow: number): void;
  toast(text: string, fxNow: number): void;
  /** Shows or hides the whole HUD (test mode hides it so the globe goldens stay as they are; `#hud` shows it). */
  setVisible(visible: boolean): void;
  dispose(): void;
}

/** The text of a refusal reason (a REJECT_* code of the sim), in the current language. */
export function rejectText(reason: number): string {
  return t(rejectKey(reason), { code: reason });
}

/** Shown when the player clicks land that nobody can own (sea, Peak, Ice). */
export function notConquerableText(): string {
  return t('toast.notConquerable');
}

/** The banner texts by index (a TextCell holds numbers, so the key travels as an index). */
const BANNER_KEYS: readonly TextKey[] = ['phase.spawnPick', 'phase.spawnDone', 'phase.spawnMissed', 'phase.immunity', 'phase.play', 'phase.preplaced'];

type Make = (a: number, b: number) => string;

/** A text node that is rebuilt only when its numbers or the language changed. */
class TextCell {
  private a = Number.NaN;
  private b = Number.NaN;
  private lang = -1;
  constructor(
    readonly el: HTMLElement,
    private readonly make: Make,
    private readonly valueAttr = false,
  ) {}
  set(a: number, b = 0): void {
    const lv = languageVersion();
    if (a === this.a && b === this.b && lv === this.lang) return;
    this.a = a;
    this.b = b;
    this.lang = lv;
    this.el.textContent = this.make(a, b);
    if (this.valueAttr) this.el.dataset.value = String(a);
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, testid?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className !== '') e.className = className;
  if (testid !== undefined) e.dataset.testid = testid;
  return e;
}

/** A label whose text is the translation of a fixed key. */
function label(className: string, key: TextKey, testid?: string): TextCell {
  return new TextCell(el('span', className, testid), () => t(key));
}

/** A small canvas for a flag, drawn at twice its CSS size. Hidden until a flag is drawn into it. */
function flagCanvas(className: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.className = className;
  c.width = FLAG_ROW_W * 2;
  c.height = FLAG_ROW_H * 2;
  c.style.width = `${FLAG_ROW_W}px`;
  c.style.height = `${FLAG_ROW_H}px`;
  c.setAttribute('aria-hidden', 'true');
  c.hidden = true;
  return c;
}

/** Draws `spec` into a flag canvas (or hides it when there is none). Called when the seat shown there changes, never per frame. */
function paintFlag(c: HTMLCanvasElement, spec: FlagSpec | null): void {
  if (spec === null) {
    c.hidden = true;
    return;
  }
  const ctx = c.getContext('2d');
  if (ctx === null) return;
  drawFlag(ctx, spec, c.width, c.height);
  c.hidden = false;
}

const percentText = (hundredths: number): string => t('hud.percent', { n: formatFixed(hundredths / 100, 2) });

class BoardRow {
  readonly root = el('div', 'hud-row', 'leader-row');
  private readonly rank = el('span', 'hud-rank');
  private readonly swatch = el('span', 'hud-swatch');
  /** The flag canvas: only a match with names and flags has one (the standard match keeps the single canvas of the globe on the page). */
  private readonly flag: HTMLCanvasElement | null;
  private readonly name = el('span', 'hud-name');
  private readonly share = el('span', 'hud-share');
  private seat = -2;
  private rankNo = -2;
  private shareQ15 = -2;
  private lang = -1;
  constructor(withFlag: boolean) {
    this.flag = withFlag ? flagCanvas('hud-flag') : null;
    if (this.flag !== null) this.root.append(this.rank, this.swatch, this.flag, this.name, this.share);
    else this.root.append(this.rank, this.swatch, this.name, this.share);
    this.root.hidden = true;
  }
  hide(): void {
    if (!this.root.hidden) this.root.hidden = true;
    this.seat = -2;
  }
  set(seat: number, rankNo: number, shareQ15: number, players: number, localSeat: number, color: string, labels: SeatLabels | null): void {
    const lv = languageVersion();
    if (this.root.hidden) this.root.hidden = false;
    if (seat !== this.seat || lv !== this.lang) {
      if (labels !== null) {
        this.name.textContent = labels.name(seat);
        if (this.flag !== null) {
          if (seat !== this.seat) paintFlag(this.flag, labels.flag(seat));
          this.root.dataset.flag = this.flag.hidden ? '0' : '1';
        }
      } else {
        const nm = seatName(seat, players, localSeat);
        this.name.textContent = t(nm.key, { n: nm.n });
      }
      this.swatch.style.background = color;
      this.root.dataset.seat = String(seat);
      this.root.dataset.you = seat === localSeat ? '1' : '0';
      this.seat = seat;
    }
    if (rankNo !== this.rankNo || lv !== this.lang) {
      this.rank.textContent = rankNo > 0 ? t('hud.rank', { n: rankNo }) : '-';
      this.root.dataset.rank = String(rankNo);
      this.rankNo = rankNo;
    }
    if (shareQ15 !== this.shareQ15 || lv !== this.lang) {
      this.share.textContent = percentText(shareHundredths(shareQ15));
      this.root.dataset.share = String(shareQ15);
      this.shareQ15 = shareQ15;
    }
    this.lang = lv;
  }
}

export function createMatchHud(parent: HTMLElement, actions: MatchHudActions, options: MatchHudOptions = {}): MatchHud {
  const seatColor = options.seatColor ?? ((): string => '#888888');
  const labels = options.labels ?? null;
  const root = el('div', 'hud-root', 'match-hud');
  root.append(mountHudStyle(root));
  /** Texts that only depend on the language: rebuilt (cheaply, cached) by every update. */
  const statics: TextCell[] = [];
  const cell = (c: TextCell): TextCell => {
    statics.push(c);
    return c;
  };
  /** Texts that hold a number: set by name in `update`. */
  const dyn = (c: TextCell): TextCell => c;

  // --- Banner: the phase prompt and its countdown ---
  const banner = el('div', 'hud-panel hud-banner', 'phase');
  banner.setAttribute('aria-live', 'polite');
  const bannerText = el('div', 'hud-banner-text', 'phase-text');
  const bannerSeconds = el('div', 'hud-banner-seconds', 'phase-seconds');
  banner.append(bannerText, bannerSeconds);
  const bannerCell = new TextCell(bannerText, (k) => t(BANNER_KEYS[k] as TextKey));
  const secondsCell = new TextCell(bannerSeconds, (s) => t('phase.seconds', { s }), true);
  const badge = el('div', 'hud-panel hud-badge', 'paused');
  badge.hidden = true;
  cell(new TextCell(badge, () => t('phase.paused')));

  // --- Status: gold, troops with the cap bar, land share, time ---
  const status = el('div', 'hud-panel hud-status', 'status');
  const nationBox = el('div', 'hud-nation', 'nation');
  const nationFlag = labels === null ? null : flagCanvas('hud-flag');
  const nationName = el('span', 'hud-nation-name', 'nation-name');
  if (nationFlag !== null) nationBox.append(nationFlag);
  nationBox.append(nationName);
  nationBox.hidden = labels === null;
  let nationLang = -1;
  // The top bar (M20a-lite): nation, gold with income, troops with the cap bar, land share, time, and the win meter in a second row.
  const goldGrp = el('span', 'hud-grp');
  const goldLabel = cell(label('hud-label', 'hud.gold'));
  const goldNum = dyn(new TextCell(el('span', 'hud-num hud-gold', 'gold'), (a) => formatGold(a), true));
  const goldRate = dyn(new TextCell(el('span', 'hud-dim', 'gold-rate'), (a) => t('hud.goldRate', { rate: formatGoldRate(a) }), true));
  goldGrp.append(goldLabel.el, goldNum.el, goldRate.el);
  const troopsGrp = el('span', 'hud-grp hud-grp-troops');
  const troopsLabel = cell(label('hud-label', 'hud.troops'));
  const troopsNum = dyn(new TextCell(el('span', 'hud-num hud-troops', 'troops'), (a) => formatInt(a), true));
  const capText = dyn(new TextCell(el('span', 'hud-dim', 'troops-cap'), (a) => t('hud.cap', { cap: formatInt(a) }), true));
  const troopsLine = el('span', 'hud-line');
  troopsLine.append(troopsLabel.el, troopsNum.el, capText.el);
  const bar = el('div', 'hud-bar', 'troops-bar');
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-valuemin', '0');
  const barFill = el('div', 'hud-bar-fill');
  const barMark = el('div', 'hud-bar-mark');
  barMark.style.left = `${Math.round(TROOP_WARNING_FRACTION * 100)}%`;
  bar.append(barFill, barMark);
  const warn = cell(new TextCell(el('span', 'hud-warn', 'troops-warning'), () => t('hud.nearCap')));
  warn.el.hidden = true;
  const barRow = el('span', 'hud-bar-row');
  barRow.append(bar, warn.el);
  troopsGrp.append(troopsLine, barRow);
  const shareBox = el('span', 'hud-grp');
  const shareLabel = cell(label('hud-label', 'hud.landShare'));
  const shareText = dyn(new TextCell(el('span', 'hud-num', 'land-share'), (q) => percentText(shareHundredths(q)), true));
  shareBox.append(shareLabel.el, shareText.el);
  const timerBox = el('span', 'hud-grp');
  const timerLabel = cell(label('hud-label', 'hud.timer'));
  const timerText = dyn(new TextCell(el('span', 'hud-num', 'timer'), (s) => formatClock(s), true));
  timerBox.append(timerLabel.el, timerText.el);
  // M13a-1: the fleet gauge "Helikoptrar n/tak" (the cap scans the structure table, so it is read once per tick)
  const fleetBox = el('span', 'hud-grp', 'fleet-grp');
  const fleetLabel = cell(label('hud-label', 'hud.fleet'));
  const fleetText = dyn(new TextCell(el('span', 'hud-num', 'fleet'), (n, cap) => `${formatInt(n)}/${formatInt(cap)}`, true));
  fleetBox.append(fleetLabel.el, fleetText.el);
  let fleetTick = -1;
  // The win meter: the leader's share against the land condition now (MatchView), and the hold count-down. Hidden when the match has no land condition.
  const winRow = el('div', 'hud-win', 'win');
  winRow.hidden = true;
  const winLabel = cell(label('hud-win-label', 'hud.win.label')); // not `hud-label`: the language test lists those in the status panel
  const winBar = el('div', 'hud-bar hud-win-bar', 'win-bar');
  winBar.setAttribute('role', 'progressbar');
  winBar.setAttribute('aria-valuemin', '0');
  winBar.setAttribute('aria-valuemax', '100');
  const winFill = el('div', 'hud-bar-fill');
  winBar.append(winFill);
  const winLeader = el('span', 'hud-win-text', 'win-leader');
  const winHold = el('span', 'hud-win-hold', 'win-hold');
  winHold.hidden = true;
  winRow.append(winLabel.el, winBar, winLeader, winHold);
  status.append(nationBox, goldGrp, troopsGrp, shareBox, timerBox, fleetBox, winRow);

  // --- Leaderboard ---
  const board = el('div', 'hud-panel hud-board', 'leaderboard');
  board.dataset.labels = labels === null ? '0' : '1'; // names and flags need a wider board
  const boardTitle = cell(label('hud-board-title', 'hud.leaderboard'));
  const boardEmpty = cell(new TextCell(el('div', 'hud-empty', 'leaderboard-empty'), () => t('hud.leaderboardEmpty')));
  const rows: BoardRow[] = [];
  board.append(boardTitle.el, boardEmpty.el);
  for (let i = 0; i <= LEADERBOARD_ROWS; i++) {
    const r = new BoardRow(labels !== null);
    rows.push(r);
    board.append(r.root);
  }
  const top = new Int32Array(LEADERBOARD_ROWS);

  // --- Controls: speed and commitment ---
  const controls = el('div', 'hud-panel hud-controls', 'controls');
  const speedGroup = el('div', 'hud-group');
  const speedLabel = cell(label('hud-label', 'hud.speedLabel'));
  const btns = el('div', 'hud-btns');
  const buttons = new Map<string, HTMLButtonElement>();
  const mkBtn = (id: string, text: TextCell, onClick: () => void): HTMLButtonElement => {
    const b = el('button', 'hud-btn', `speed-${id}`);
    b.type = 'button';
    b.setAttribute('aria-pressed', 'false');
    b.append(text.el);
    b.addEventListener('click', () => {
      onClick();
      b.blur(); // keys (space) must keep going to the game, not to this button
    });
    buttons.set(id, b);
    return b;
  };
  const pauseText = cell(new TextCell(el('span', ''), () => t('hud.pause')));
  btns.append(
    mkBtn('pause', pauseText, () => actions.togglePause()),
    mkBtn('1', cell(new TextCell(el('span', ''), () => t('hud.speedValue', { n: 1 }))), () => actions.setSpeed(1)),
    mkBtn('2', cell(new TextCell(el('span', ''), () => t('hud.speedValue', { n: 2 }))), () => actions.setSpeed(2)),
    mkBtn('4', cell(new TextCell(el('span', ''), () => t('hud.speedValue', { n: 4 }))), () => actions.setSpeed(4)),
  );
  speedGroup.append(speedLabel.el, btns);
  const commitLine = el('div', 'hud-commit-line');
  const commitLabel = cell(label('hud-label', 'hud.commit'));
  const commitPct = dyn(new TextCell(el('span', 'hud-num', 'commit'), (p) => t('hud.percent', { n: p }), true));
  const commitTroops = dyn(new TextCell(el('span', 'hud-dim', 'commit-troops'), (n) => t('hud.commitTroops', { n: formatInt(n) })));
  const commitLeft = el('span', '');
  commitLeft.append(commitLabel.el, document.createTextNode(' '), commitPct.el);
  commitLine.append(commitLeft, commitTroops.el);
  const slider = el('input', 'hud-slider', 'commit-slider');
  slider.type = 'range';
  slider.min = String(COMMIT_MIN_PCT);
  slider.max = String(COMMIT_MAX_PCT);
  slider.step = String(COMMIT_STEP_PCT);
  slider.addEventListener('input', () => actions.setCommit(Number(slider.value)));
  slider.addEventListener('change', () => slider.blur());
  controls.append(speedGroup, commitLine, slider);

  const dock = el('div', 'hud-dock');
  dock.append(controls);
  const toastBox = el('div', 'hud-panel hud-toast', 'toast');
  toastBox.setAttribute('role', 'status');
  toastBox.hidden = true;
  root.append(banner, badge, board, status, dock, toastBox);
  // Clicks and wheel turns on the HUD stop here; the globe's listeners sit on the canvas, a sibling, and would not see them anyway.
  for (const type of ['pointerdown', 'pointerup', 'wheel', 'contextmenu']) root.addEventListener(type, (e) => e.stopPropagation());
  parent.appendChild(root);

  let toastUntil = 0;
  let playSince = -1;
  let boardTick = -1;
  let boardLang = -1;
  let boardLocalCells = -1;
  let lastPhaseName = '';
  let lastTone = '';
  let lastBarQ = -1;
  let lastWarning = -1;
  let lastSpeed = -1;
  let lastSpeedLang = -1;
  // the 10 Hz gate and the win meter's last written values
  const gate = options.throttle === false ? null : new HudGate(HUD_MIN_INTERVAL_S);
  const winState = newWinMeterState();
  let lastWinQ = -1;
  let lastWinSeat = -2;
  let lastWinHund = -1;
  let lastWinNeed = -1;
  let lastWinLang = -1;
  let lastHoldSeat = -2;
  let lastHoldSecs = -1;
  let lastHoldLang = -1;
  const nameOf = (seat: number, players: number, localSeat: number): string => {
    if (labels !== null) return labels.name(seat);
    const nm = seatName(seat, players, localSeat);
    return t(nm.key, { n: nm.n });
  };

  return {
    update(m: MatchHudModel, fxNow: number): void {
      if (root.hidden) return;
      const v = m.view;
      // At most 10 writes a second on the fx clock (M20a-lite); a click on a button (speed, commitment) or a language change goes through at once. Test mode has no gate.
      if (gate !== null && !gate.pass(m.speed, m.commitPct, languageVersion(), fxNow)) return;
      const st = v.stats;
      const L = m.localSeat;
      const spawned = (st.capital[L] as number) !== 0;

      // Banner
      const ban = bannerState(v.phase, v.phaseTicksLeft, spawned, m.preplaced === true);
      if (ban.tone === 'play') {
        if (playSince < 0) playSince = fxNow;
      } else {
        playSince = -1;
      }
      const bannerShown = !(ban.tone === 'play' && fxNow - playSince > PLAY_HINT_SECONDS);
      if (banner.hidden === bannerShown) banner.hidden = !bannerShown;
      const pn = phaseName(v.phase);
      if (pn !== lastPhaseName) {
        lastPhaseName = pn;
        banner.dataset.phase = pn;
      }
      if (ban.tone !== lastTone) {
        lastTone = ban.tone;
        banner.dataset.tone = ban.tone;
      }
      bannerCell.set(BANNER_KEYS.indexOf(ban.key));
      const hasSeconds = ban.seconds >= 0;
      if (bannerSeconds.hidden === hasSeconds) bannerSeconds.hidden = !hasSeconds;
      secondsCell.set(hasSeconds ? ban.seconds : 0);
      const paused = m.speed === 0;
      if (badge.hidden === paused) badge.hidden = !paused;

      // Status
      if (labels !== null) {
        const nl = languageVersion();
        if (nl !== nationLang) {
          if (nationLang < 0 && nationFlag !== null) paintFlag(nationFlag, labels.flag(L)); // the flag does not change with the language
          nationLang = nl;
          nationName.textContent = labels.name(L);
        }
      }
      const capTroops = Math.floor((st.capQt[L] as number) / 4);
      goldNum.set(Math.floor(m.gold));
      goldRate.set(st.goldPerSecMilli[L] as number);
      troopsNum.set(Math.floor(m.troops));
      capText.set(capTroops);
      shareText.set(st.landShareQ15[L] as number);
      timerText.set(Math.floor(v.tick / TICK_HZ));
      if (v.tick !== fleetTick) {
        fleetTick = v.tick;
        fleetText.set(fleetCountOf(v, L), fleetCapOf(v, L));
      }
      const tb = troopBar(m.troops, capTroops);
      const q = Math.round(tb.fraction * 400);
      if (q !== lastBarQ) {
        lastBarQ = q;
        barFill.style.transform = `scaleX(${q / 400})`;
        bar.setAttribute('aria-valuenow', String(Math.floor(m.troops)));
        bar.setAttribute('aria-valuemax', String(capTroops));
      }
      const w = tb.warning ? 1 : 0;
      if (w !== lastWarning) {
        lastWarning = w;
        bar.dataset.warning = String(w);
        warn.el.hidden = w === 0;
        status.dataset.warning = String(w);
      }
      // Win meter
      const wm = v.match;
      winMeterInto(winState, wm, wm.leaderSeat >= 0 ? (st.landShareQ15[wm.leaderSeat] as number) : 0);
      if (winRow.hidden === winState.active) winRow.hidden = !winState.active;
      if (winState.active) {
        if (winState.fillQ !== lastWinQ) {
          lastWinQ = winState.fillQ;
          winFill.style.transform = `scaleX(${winState.fillQ / 400})`;
          winBar.dataset.value = String(winState.fillQ);
          winBar.setAttribute('aria-valuenow', String(Math.round(winState.fillQ / 4)));
        }
        const lv0 = languageVersion();
        if (winState.leaderSeat !== lastWinSeat || winState.leaderHundredths !== lastWinHund || winState.requiredHundredths !== lastWinNeed || lv0 !== lastWinLang) {
          lastWinSeat = winState.leaderSeat;
          lastWinHund = winState.leaderHundredths;
          lastWinNeed = winState.requiredHundredths;
          lastWinLang = lv0;
          winLeader.textContent =
            winState.leaderSeat < 0 ? t('hud.win.noLeader') : t('hud.win.leader', { name: nameOf(winState.leaderSeat, v.players, L), pct: percentText(winState.leaderHundredths), need: percentText(winState.requiredHundredths) });
          winLeader.dataset.seat = String(winState.leaderSeat);
          winLeader.dataset.you = winState.leaderSeat === L ? '1' : '0';
          winBar.setAttribute('aria-label', t('hud.win.aria'));
        }
        const holding = winState.holdSeat >= 0;
        if (winHold.hidden === holding) winHold.hidden = !holding;
        if (holding && (winState.holdSeat !== lastHoldSeat || winState.holdSeconds !== lastHoldSecs || lv0 !== lastHoldLang)) {
          lastHoldSeat = winState.holdSeat;
          lastHoldSecs = winState.holdSeconds;
          lastHoldLang = lv0;
          winHold.textContent = t('hud.win.hold', { name: nameOf(winState.holdSeat, v.players, L), secs: winState.holdSeconds });
          winHold.dataset.seat = String(winState.holdSeat);
          winHold.dataset.value = String(winState.holdSeconds);
        }
      }
      for (const c of statics) c.set(0);

      // Leaderboard: once per tick (and when the language or your own start changed)
      const lv = languageVersion();
      const localCells = st.cells[L] as number;
      if (v.tick !== boardTick || lv !== boardLang || (localCells > 0 ? 1 : 0) !== boardLocalCells) {
        boardTick = v.tick;
        boardLang = lv;
        boardLocalCells = localCells > 0 ? 1 : 0;
        const seatCount = LEADERBOARD_INCLUDES_TRIBES ? v.seats : v.players;
        const n = rankTop(st, seatCount, top);
        let used = 0;
        let youShown = false;
        for (let i = 0; i < n; i++) {
          const seat = top[i] as number;
          if (seat === L) youShown = true;
          (rows[used++] as BoardRow).set(seat, i + 1, st.landShareQ15[seat] as number, v.players, L, seatColor(seat), labels);
        }
        if (!youShown && localCells > 0) {
          (rows[used++] as BoardRow).set(L, rankOf(st, seatCount, L), st.landShareQ15[L] as number, v.players, L, seatColor(L), labels);
        }
        for (let i = used; i < rows.length; i++) (rows[i] as BoardRow).hide();
        const empty = used === 0;
        if (boardEmpty.el.hidden !== !empty) boardEmpty.el.hidden = !empty;
      }

      // Controls
      if (m.speed !== lastSpeed || lv !== lastSpeedLang) {
        lastSpeed = m.speed;
        lastSpeedLang = lv;
        slider.setAttribute('aria-label', t('hud.commitAria'));
        for (const [id, b] of buttons) {
          const active = id === 'pause' ? m.speed === 0 : m.speed === Number(id);
          b.setAttribute('aria-pressed', active ? 'true' : 'false');
          b.dataset.active = active ? '1' : '0';
        }
      }
      commitPct.set(m.commitPct);
      commitTroops.set(Math.floor((m.troops * m.commitPct) / 100));
      if (slider.valueAsNumber !== m.commitPct) slider.value = String(m.commitPct);

      if (toastUntil > 0 && fxNow >= toastUntil) {
        toastBox.hidden = true;
        toastUntil = 0;
      }
    },
    toast(text: string, fxNow: number): void {
      toastBox.textContent = text;
      toastBox.hidden = false;
      toastUntil = fxNow + TOAST_SECONDS;
    },
    setVisible(visible: boolean): void {
      root.hidden = !visible;
    },
    dispose(): void {
      root.remove();
    },
  };
}
