// The deploy block of the Factory panel (M13b): the button "Skicka helikopter", and while the deploy mode is on the troop slider, the Low / High switch, the
// verdict of the preview (valid, or the refusal in words), the flight time and fuel, and Cancel. Under it the compact list of the seat's helicopters with a
// Recall button for one that is flying. The box only REPORTS clicks (`DeployBoxActions`); the page owns the mode, asks the sim's rules and sends the intents.
// It writes the DOM only where the text or the state changed.
import { HELI_MAX_TROOPS } from '../sim/public';
import { DEPLOY } from './uiConfig';
import { heliStateKey, type HeliRow } from './heliInfo';
import { rejectKey } from './hudLogic';
import { formatInt, languageVersion, t } from './i18n';

export interface DeployBoxActions {
  /** The button was pressed (starts the mode, or leaves it when it is already on). */
  open(): void;
  cancel(): void;
  recall(heli: number): void;
}

/** What the box shows this frame. */
export interface DeployBoxModel {
  /** A helicopter stands on this Factory's pad (the button is live); else `openReason` says why not. */
  readonly canOpen: boolean;
  readonly openReason: number;
  /** The deploy mode is on. */
  readonly active: boolean;
  /** The preview for the hovered cell: nothing hovered, waiting for the answer, valid, or refused with `reason`. */
  readonly status: 'idle' | 'pending' | 'valid' | 'invalid';
  readonly reason: number;
  readonly etaSeconds: number;
  readonly fuelCells: number;
  readonly exposedCells: number;
}

export interface DeployBox {
  readonly root: HTMLElement;
  /** The troop count of the slider and the flight mode (0 Low, 1 High). */
  troops(): number;
  mode(): 0 | 1;
  update(model: DeployBoxModel, rows: readonly HeliRow[]): void;
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

export function createDeployBox(parent: HTMLElement, actions: DeployBoxActions): DeployBox {
  const root = el('div', 'deploy-box', 'deploy-box');
  const openBtn = button('sel-btn deploy-open', 'deploy-open');
  const controls = el('div', 'deploy-controls', 'deploy-controls');
  const hint = el('div', 'sel-note', 'deploy-hint');
  const troopsLabel = el('label', 'sel-state', 'deploy-troops-label');
  const slider = el('input', 'deploy-slider', 'deploy-troops');
  slider.type = 'range';
  slider.min = '1';
  slider.max = String(HELI_MAX_TROOPS);
  slider.step = String(DEPLOY.troopsStep);
  slider.value = String(DEPLOY.troopsDefault);
  slider.setAttribute('aria-labelledby', 'deploy-troops-label');
  const modeRow = el('div', 'deploy-mode', 'deploy-mode');
  const lowBtn = button('sel-btn', 'deploy-low');
  const highBtn = button('sel-btn', 'deploy-high');
  modeRow.append(lowBtn, highBtn);
  const status = el('div', 'deploy-status', 'deploy-status');
  const info = el('div', 'sel-note', 'deploy-info');
  const cancelBtn = button('sel-btn', 'deploy-cancel');
  controls.append(hint, troopsLabel, slider, modeRow, status, info, cancelBtn);
  controls.hidden = true;
  const list = el('div', 'heli-list', 'heli-list');
  const listTitle = el('div', 'sel-state', 'heli-list-title');
  const listRows = el('div', 'heli-rows', 'heli-rows');
  list.append(listTitle, listRows);
  list.hidden = true;
  root.append(openBtn, controls, list);
  parent.appendChild(root);

  let mode: 0 | 1 = 0;
  let shown = '';
  let listShown = '';
  const setMode = (m: 0 | 1): void => {
    mode = m;
    shown = ''; // redraw the pressed state at once
  };
  openBtn.addEventListener('click', () => {
    if (openBtn.getAttribute('aria-disabled') !== 'true') actions.open();
  });
  cancelBtn.addEventListener('click', () => actions.cancel());
  lowBtn.addEventListener('click', () => setMode(0));
  highBtn.addEventListener('click', () => setMode(1));
  slider.addEventListener('input', () => {
    shown = '';
  });
  listRows.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null;
    const b = target?.closest?.('[data-testid="heli-recall"]') as HTMLElement | null;
    if (b === null || b === undefined || b.getAttribute('aria-disabled') === 'true') return;
    actions.recall(Number(b.dataset.id));
  });

  return {
    root,
    troops: () => Math.max(1, Math.min(HELI_MAX_TROOPS, Math.round(Number(slider.value)))),
    mode: () => mode,
    update(m, rows): void {
      const troops = Math.max(1, Math.min(HELI_MAX_TROOPS, Math.round(Number(slider.value))));
      const sig = [m.canOpen ? 1 : 0, m.openReason, m.active ? 1 : 0, m.status, m.reason, m.etaSeconds, m.fuelCells, m.exposedCells, troops, mode, languageVersion()].join('|');
      if (sig !== shown) {
        shown = sig;
        openBtn.textContent = t('deploy.open');
        openBtn.dataset.reason = String(m.openReason);
        openBtn.dataset.active = m.active ? '1' : '0';
        if (m.canOpen) openBtn.removeAttribute('aria-disabled');
        else openBtn.setAttribute('aria-disabled', 'true');
        openBtn.dataset.state = m.canOpen ? 'ok' : 'dim';
        openBtn.title = m.canOpen ? t('deploy.openTip') : t(rejectKey(m.openReason), { code: m.openReason });
        controls.hidden = !m.active;
        hint.textContent = t('deploy.hint');
        troopsLabel.textContent = t('deploy.troops', { n: formatInt(troops) });
        troopsLabel.dataset.value = String(troops);
        modeRow.setAttribute('role', 'group');
        modeRow.setAttribute('aria-label', t('deploy.mode'));
        lowBtn.textContent = t('deploy.low');
        highBtn.textContent = t('deploy.high');
        lowBtn.title = t('deploy.lowTip');
        highBtn.title = t('deploy.highTip');
        lowBtn.setAttribute('aria-pressed', mode === 0 ? 'true' : 'false');
        highBtn.setAttribute('aria-pressed', mode === 1 ? 'true' : 'false');
        cancelBtn.textContent = t('deploy.cancel');
        status.dataset.state = m.status;
        status.dataset.reason = String(m.reason);
        status.textContent = m.status === 'valid' ? t('deploy.valid') : m.status === 'invalid' ? t(rejectKey(m.reason), { code: m.reason }) : m.status === 'pending' ? t('deploy.pending') : '';
        status.hidden = status.textContent === '';
        const hasRoute = m.fuelCells > 0;
        info.textContent = hasRoute ? t('deploy.info', { s: m.etaSeconds, fuel: m.fuelCells, exposed: m.exposedCells }) : '';
        info.hidden = !hasRoute;
        info.dataset.eta = String(m.etaSeconds);
        info.dataset.fuel = String(m.fuelCells);
      }
      // the list of helicopters
      const lsig = [languageVersion(), rows.map((r) => `${r.id},${r.state},${r.troops},${r.fuelPct},${r.canRecall ? 1 : 0}`).join(';')].join('|');
      if (lsig !== listShown) {
        listShown = lsig;
        list.hidden = rows.length === 0;
        listTitle.textContent = t('heli.list.title');
        listRows.textContent = '';
        for (const r of rows) {
          const row = el('div', 'heli-row', 'heli-row');
          row.dataset.id = String(r.id);
          row.dataset.state = String(r.state);
          row.dataset.troops = String(r.troops);
          const text = el('span', 'heli-row-text', 'heli-row-text');
          text.textContent = t('heli.row', { state: t(heliStateKey(r.state)), troops: formatInt(r.troops), fuel: r.fuelPct });
          row.appendChild(text);
          const rb = button('sel-btn heli-recall', 'heli-recall');
          rb.dataset.id = String(r.id);
          rb.textContent = t('heli.recall');
          rb.title = t('heli.recallTip');
          if (r.canRecall) rb.removeAttribute('aria-disabled');
          else {
            rb.setAttribute('aria-disabled', 'true');
            rb.dataset.state = 'dim';
          }
          rb.hidden = !r.canRecall;
          row.appendChild(rb);
          listRows.appendChild(row);
        }
      }
    },
    dispose(): void {
      root.remove();
    },
  };
}
