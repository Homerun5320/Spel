// TEMPORARY match controls of M05 part A (Part B replaces this file's content with the real HUD and moves every string into
// the i18n tables): a phase banner with the countdown, speed buttons, the commitment slider, two readouts and a toast line.
// Everything is plain DOM built from JS. It only CALLS functions it is given (`MatchHudActions`) and READS a SimView; it
// never touches the sim. Elements carry `data-testid` for the e2e tests. No CSS transitions or animations (the fx clock is
// the only cosmetic clock): the toast's lifetime is measured in fx seconds by the caller of `update`.
import {
  PHASE_IMMUNITY,
  PHASE_PLAY,
  PHASE_SPAWN,
  REJECT_AMOUNT,
  REJECT_IMMUNE,
  REJECT_NOT_SPAWNED,
  REJECT_NO_CONTACT,
  REJECT_NO_TROOPS,
  REJECT_OWNED,
  REJECT_PHASE,
  REJECT_SELF,
  REJECT_SPAWNED,
  REJECT_TERRAIN,
} from './hudCodes';
import type { SimView } from '../sim/view';
import { COMMIT_MAX_PCT, COMMIT_MIN_PCT, COMMIT_STEP_PCT, TOAST_SECONDS, Z_HUD } from './uiConfig';

export interface MatchHudActions {
  setCommit(pct: number): void;
  setSpeed(speed: 1 | 2 | 4): void;
  togglePause(): void;
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
}

export interface MatchHud {
  update(model: MatchHudModel, fxNow: number): void;
  toast(text: string, fxNow: number): void;
  /** Shows or hides the whole HUD (test mode hides it so the globe goldens stay as they are; `#hud` shows it). */
  setVisible(visible: boolean): void;
  dispose(): void;
}

/** Shown when the player clicks land that nobody can own (sea, Peak, Ice). */
export const NOT_CONQUERABLE_TEXT = 'Det går inte att erövra (hav, bergstopp eller is).';

/** Swedish text of a refusal (temporary, Part B moves it to the tables). */
export function rejectText(reason: number): string {
  switch (reason) {
    case REJECT_TERRAIN:
      return 'Du kan inte spawna där (hav, bergstopp eller is).';
    case REJECT_OWNED:
      return 'Någon äger redan marken där.';
    case REJECT_SPAWNED:
      return 'Du har redan spawnat.';
    case REJECT_PHASE:
      return 'Det går inte i den här fasen.';
    case REJECT_IMMUNE:
      return 'Skyddad de första sekunderna.';
    case REJECT_NO_CONTACT:
      return 'Du gränsar inte till den marken.';
    case REJECT_NO_TROOPS:
      return 'Inga trupper att skicka.';
    case REJECT_SELF:
      return 'Det är din egen mark.';
    case REJECT_NOT_SPAWNED:
      return 'Spawna först.';
    case REJECT_AMOUNT:
      return 'Ogiltigt belopp.';
    default:
      return `Avvisat (kod ${reason}).`;
  }
}

/** Writes text only when it changed (a DOM write every frame would cost layout and allocate). */
function setText(e: HTMLElement, text: string): void {
  if (e.textContent !== text) e.textContent = text;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, css: string, testid?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.style.cssText = css;
  if (testid !== undefined) e.dataset.testid = testid;
  return e;
}

const PANEL = 'background:rgba(10,16,28,0.78);color:#e8f0ff;border:1px solid #2a3d63;border-radius:8px;font:14px system-ui,sans-serif;';

export function createMatchHud(parent: HTMLElement, actions: MatchHudActions): MatchHud {
  const root = el('div', `position:absolute;inset:0;z-index:${Z_HUD};pointer-events:none;`, 'match-hud');
  // Top: phase banner
  const banner = el('div', `${PANEL}position:absolute;left:50%;top:12px;transform:translateX(-50%);padding:8px 16px;text-align:center;pointer-events:none;max-width:70vw;`, 'phase');
  const bannerText = el('div', 'font-weight:600;', 'phase-text');
  const bannerSeconds = el('div', 'font:600 20px ui-monospace,Menlo,Consolas,monospace;', 'phase-seconds');
  banner.append(bannerText, bannerSeconds);
  // Bottom: controls
  const bar = el('div', `${PANEL}position:absolute;left:50%;bottom:12px;transform:translateX(-50%);display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:center;padding:8px 12px;pointer-events:auto;max-width:calc(100vw - 16px);box-sizing:border-box;`, 'controls');
  const troops = el('span', 'min-width:90px;', 'troops');
  const gold = el('span', 'min-width:80px;', 'gold');
  const buttons = new Map<string, HTMLButtonElement>();
  const mkBtn = (id: string, label: string, onClick: () => void): HTMLButtonElement => {
    const b = el('button', 'min-width:44px;min-height:36px;padding:0 8px;border-radius:6px;border:1px solid #3a5a9a;background:#16294a;color:#e8f0ff;font:600 13px system-ui,sans-serif;cursor:pointer;', `speed-${id}`);
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', () => {
      onClick();
      b.blur(); // keys (space) must keep going to the game, not to this button
    });
    buttons.set(id, b);
    return b;
  };
  const speedBox = el('span', 'display:flex;gap:4px;');
  speedBox.append(mkBtn('pause', 'II', () => actions.togglePause()), mkBtn('1', '1x', () => actions.setSpeed(1)), mkBtn('2', '2x', () => actions.setSpeed(2)), mkBtn('4', '4x', () => actions.setSpeed(4)));
  const commitLabel = el('label', 'display:flex;gap:8px;align-items:center;');
  const commitText = el('span', 'min-width:96px;', 'commit');
  const slider = el('input', 'width:140px;', 'commit-slider');
  slider.type = 'range';
  slider.min = String(COMMIT_MIN_PCT);
  slider.max = String(COMMIT_MAX_PCT);
  slider.step = String(COMMIT_STEP_PCT);
  slider.addEventListener('input', () => actions.setCommit(Number(slider.value)));
  slider.addEventListener('change', () => slider.blur());
  commitLabel.append(commitText, slider);
  bar.append(troops, gold, speedBox, commitLabel);
  // Toast line
  const toastBox = el('div', `${PANEL}position:absolute;left:50%;bottom:76px;transform:translateX(-50%);padding:6px 12px;display:none;pointer-events:none;`, 'toast');
  root.append(banner, bar, toastBox);
  // Clicks and wheel turns on the HUD stop here; the globe's listeners sit on the canvas, a sibling, and would not see them anyway.
  for (const type of ['pointerdown', 'pointerup', 'wheel', 'contextmenu']) root.addEventListener(type, (e) => e.stopPropagation());
  parent.appendChild(root);

  let toastUntil = 0;
  return {
    update(m: MatchHudModel, fxNow: number): void {
      const v = m.view;
      if (v.phase === PHASE_SPAWN) {
        setText(bannerText, 'Klicka på marken för att spawna');
        setText(bannerSeconds, `${Math.ceil(v.phaseTicksLeft / 10)} s`);
      } else if (v.phase === PHASE_IMMUNITY) {
        setText(bannerText, 'Skyddad en kort stund');
        setText(bannerSeconds, `${Math.ceil(v.phaseTicksLeft / 10)} s`);
      } else {
        setText(bannerText, 'Klicka på fiende- eller oägd mark för att anfalla');
        setText(bannerSeconds, '');
      }
      const phaseName = v.phase === PHASE_SPAWN ? 'spawn' : v.phase === PHASE_IMMUNITY ? 'immunity' : v.phase === PHASE_PLAY ? 'play' : '?';
      if (banner.dataset.phase !== phaseName) banner.dataset.phase = phaseName;
      const secondsDisplay = v.phase === PHASE_PLAY ? 'none' : 'block';
      if (bannerSeconds.style.display !== secondsDisplay) bannerSeconds.style.display = secondsDisplay;
      setText(troops, `Trupper ${Math.floor(m.troops)}`);
      setText(gold, `Guld ${Math.floor(m.gold)}`);
      setText(commitText, `Insats ${m.commitPct} %`);
      if (slider.value !== String(m.commitPct)) slider.value = String(m.commitPct);
      for (const [id, b] of buttons) {
        const active = id === 'pause' ? m.speed === 0 : m.speed === Number(id);
        const flag = active ? '1' : '0';
        if (b.dataset.active !== flag) {
          b.dataset.active = flag;
          b.style.borderColor = active ? '#7fd1ff' : '#3a5a9a';
        }
      }
      if (toastUntil > 0 && fxNow >= toastUntil) {
        toastBox.style.display = 'none';
        toastUntil = 0;
      }
    },
    toast(text: string, fxNow: number): void {
      toastBox.textContent = text;
      toastBox.style.display = 'block';
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
