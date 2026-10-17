// The ship block of the Port panel (M13c-2): the button "Skicka fartyg" with the gold fee and, dimmed, the reason in words; while the ship mode is on the troop slider, the verdict
// of the preview (ready with the sailing time, or the refusal in words), the Send button and Cancel. The box only REPORTS clicks (`ShipBoxActions`); the page owns the mode, asks
// the sim's rules and sends the intent. It writes the DOM only where the numbers or the language changed (the pattern of src/ui/deployBox.ts).
import { SHIP_MAX_TROOPS, SHIP_MIN_TROOPS } from '../sim/public';
import { rejectKey } from './hudLogic';
import { formatGold, formatInt, languageVersion, t } from './i18n';
import { SHIP } from './uiConfig';

export interface ShipBoxActions {
  /** The open button was pressed (starts the mode, or leaves it when it is already on). */
  open(): void;
  /** The Send button was pressed with a valid preview. */
  confirm(): void;
  cancel(): void;
}

/** What the box shows this frame. */
export interface ShipBoxModel {
  /** 0 = the open button is live, else why it is dimmed (`shipButtonReason`). */
  readonly reason: number;
  readonly price: number;
  readonly fleet: number;
  readonly cap: number;
  /** The ship mode is on. */
  readonly active: boolean;
  /** The preview of the picked cell: nothing picked, valid, or refused with `previewReason`. */
  readonly status: 'idle' | 'valid' | 'invalid';
  readonly previewReason: number;
  readonly etaSeconds: number;
  /** The slider's top (`shipSliderMax`). */
  readonly maxTroops: number;
}

export interface ShipBox {
  readonly root: HTMLElement;
  /** The troop count of the slider, clamped to the least launch and the top. */
  troops(): number;
  update(model: ShipBoxModel): void;
  dispose(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, testid: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  e.dataset.testid = testid;
  return e;
}

function button(cls: string, testid: string): HTMLButtonElement {
  const b = el('button', cls, testid);
  b.type = 'button';
  return b;
}

export function createShipBox(parent: HTMLElement, actions: ShipBoxActions): ShipBox {
  const root = el('div', 'ship-box', 'ship-box');
  const openBtn = button('sel-btn sel-ship', 'sel-ship');
  const why = el('div', 'sel-note', 'sel-ship-why');
  const fleet = el('div', 'sel-note sel-ship-fleet', 'sel-ship-fleet');
  const controls = el('div', 'ship-controls deploy-controls', 'ship-controls');
  const hint = el('div', 'sel-note', 'ship-hint');
  const troopsLabel = el('label', 'sel-state', 'ship-troops-label');
  const slider = el('input', 'deploy-slider', 'ship-troops');
  slider.type = 'range';
  slider.min = String(SHIP_MIN_TROOPS);
  slider.max = String(SHIP_MAX_TROOPS);
  slider.step = String(SHIP.troopsStep);
  slider.value = String(SHIP.troopsDefault);
  const status = el('div', 'deploy-status', 'ship-status');
  const row = el('div', 'deploy-mode', 'ship-actions');
  const confirmBtn = button('sel-btn', 'ship-confirm');
  const cancelBtn = button('sel-btn', 'ship-cancel');
  row.append(confirmBtn, cancelBtn);
  controls.append(hint, troopsLabel, slider, status, row);
  controls.hidden = true;
  root.append(openBtn, why, fleet, controls);
  parent.appendChild(root);

  let cap = SHIP_MAX_TROOPS;
  const clampTroops = (): number => Math.max(SHIP_MIN_TROOPS, Math.min(cap, Math.round(Number(slider.value))));
  let dirty = true;
  let sReason = -1;
  let sFleet = -1;
  let sActive = false;
  let sStatus = '';
  let sPrev = -1;
  let sEta = -1;
  let sTroops = -1;
  let sLang = -1;
  openBtn.addEventListener('click', () => {
    if (openBtn.getAttribute('aria-disabled') !== 'true' || sActive) actions.open();
  });
  confirmBtn.addEventListener('click', () => {
    if (confirmBtn.getAttribute('aria-disabled') !== 'true') actions.confirm();
  });
  cancelBtn.addEventListener('click', () => actions.cancel());
  slider.addEventListener('input', () => {
    dirty = true;
  });

  return {
    root,
    troops: clampTroops,
    update(m): void {
      if (m.maxTroops !== cap) {
        cap = m.maxTroops;
        slider.max = String(cap);
        dirty = true;
      }
      const troops = clampTroops();
      const lang = languageVersion();
      if (!dirty && m.reason === sReason && m.fleet === sFleet && m.active === sActive && m.status === sStatus && m.previewReason === sPrev && m.etaSeconds === sEta && troops === sTroops && lang === sLang) return;
      dirty = false;
      sReason = m.reason;
      sFleet = m.fleet;
      sActive = m.active;
      sStatus = m.status;
      sPrev = m.previewReason;
      sEta = m.etaSeconds;
      sTroops = troops;
      sLang = lang;
      const live = m.reason === 0;
      openBtn.textContent = t('sel.ship.send', { price: formatGold(m.price) });
      openBtn.dataset.reason = String(m.reason);
      openBtn.dataset.active = m.active ? '1' : '0';
      openBtn.dataset.state = live ? 'ok' : 'dim';
      if (live) openBtn.removeAttribute('aria-disabled');
      else openBtn.setAttribute('aria-disabled', 'true');
      const text = live ? '' : t(rejectKey(m.reason), { code: m.reason });
      openBtn.title = live ? t('sel.ship.tip', { price: formatGold(m.price) }) : text;
      why.textContent = text;
      why.hidden = text === '';
      fleet.textContent = t('sel.ship.fleet', { n: m.fleet, cap: m.cap });
      fleet.dataset.n = String(m.fleet);
      controls.hidden = !m.active;
      const panel = parent.parentElement; // the Port panel: while the mode is on, the CSS shows only this block
      if (panel !== null) panel.dataset.shipping = m.active ? '1' : '0';
      hint.textContent = t('sel.ship.hint');
      troopsLabel.textContent = t('sel.ship.troops', { n: formatInt(troops) });
      troopsLabel.dataset.value = String(troops);
      status.dataset.state = m.status;
      status.dataset.reason = String(m.previewReason);
      status.textContent = m.status === 'valid' ? t('sel.ship.statusValid', { s: m.etaSeconds }) : m.status === 'invalid' ? t(rejectKey(m.previewReason), { code: m.previewReason }) : t('sel.ship.statusIdle');
      status.dataset.eta = String(m.etaSeconds);
      confirmBtn.textContent = t('sel.ship.confirm');
      confirmBtn.dataset.state = m.status === 'valid' ? 'ok' : 'dim';
      if (m.status === 'valid') confirmBtn.removeAttribute('aria-disabled');
      else confirmBtn.setAttribute('aria-disabled', 'true');
      cancelBtn.textContent = t('sel.ship.cancel');
    },
    dispose(): void {
      root.remove();
    },
  };
}
