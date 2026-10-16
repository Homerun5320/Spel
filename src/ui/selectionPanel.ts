// The selection panel (M10-4): bottom left above the HUD status panel, shows the selected structure's name, level, what it gives (the sim's numbers,
// see structureInfo.ts), the upgrade price and the delete cooldown, with the buttons Upgrade and Delete. The panel only reports clicks: the page sends
// the intents. A button the sim would refuse is dimmed (aria-disabled) and its tooltip says why.
import { fxNow } from '../render/clock';
import { formatGold, languageVersion, t } from './i18n';
import { deleteArmed, deleteClick, deleteWhyKey, effectLines, structureNameKey, upgradeWhyKey, type DeleteArm, type SelectionInfo } from './structureInfo';
import { STRUCT_CITY, STRUCT_FACTORY, maxLevelOf } from '../sim/public';
import { rejectKey } from './hudLogic';
import type { HeliPanelInfo } from './heliInfo';

export interface SelectionPanel {
  readonly root: HTMLElement;
  /** Per frame: null hides the panel. `onMountain` selects the sim's SAM radius. */
  update(info: SelectionInfo | null, onMountain: boolean, heli?: HeliPanelInfo | null): void;
  dispose(): void;
}

export function createSelectionPanel(parent: HTMLElement, actions: { upgrade(id: number): void; remove(id: number): void; openCity?(id: number): void; produceHeli?(id: number): void }): SelectionPanel {
  const root = document.createElement('div');
  root.className = 'sel-panel hud-panel';
  root.dataset.testid = 'sel-panel';
  root.hidden = true;
  root.setAttribute('role', 'region');
  const name = el('div', 'sel-name', 'sel-name');
  const level = el('div', 'sel-level', 'sel-level');
  const state = el('div', 'sel-state', 'sel-state');
  const fx = el('div', 'sel-fx', 'sel-fx');
  const row = document.createElement('div');
  row.className = 'sel-row';
  const up = button('sel-upgrade');
  const del = button('sel-delete');
  const openCity = button('sel-open-city'); // Districts-2a: only for an own City
  row.append(up, del, openCity);
  const note = el('div', 'sel-note', 'sel-note');
  // M13a-1: the helicopter block of an own Factory: the build button, the queue line, the fleet gauge and (dimmed) the reason in text
  const heliBox = document.createElement('div');
  heliBox.className = 'sel-heli';
  heliBox.dataset.testid = 'sel-heli-box';
  const heliBtn = button('sel-heli');
  const heliQueue = el('div', 'sel-state', 'sel-heli-queue');
  const heliFleet = el('div', 'sel-note sel-heli-fleet', 'sel-heli-fleet');
  const heliWhy = el('div', 'sel-note', 'sel-heli-why');
  heliBox.append(heliBtn, heliQueue, heliFleet, heliWhy);
  heliBox.hidden = true;
  root.append(name, level, state, fx, row, heliBox, note);
  parent.appendChild(root);
  let shown = '';
  let current = -1;
  up.addEventListener('click', () => {
    if (current >= 0 && up.getAttribute('aria-disabled') !== 'true') actions.upgrade(current);
  });
  heliBtn.addEventListener('click', () => {
    if (current >= 0 && heliBtn.getAttribute('aria-disabled') !== 'true') actions.produceHeli?.(current);
  });
  openCity.addEventListener('click', () => {
    if (current >= 0) actions.openCity?.(current);
  });
  // Delete takes two clicks: the first arms it for DELETE_ARM_MS (label "Bekräfta"), the second deletes; the next frame's update shows the label
  let arm: DeleteArm | null = null;
  const clock = (): number => fxNow() * 1000; // the fx clock in ms (the same clock as the toasts)
  del.addEventListener('click', () => {
    if (current < 0 || del.getAttribute('aria-disabled') === 'true') return;
    const r = deleteClick(arm, current, clock());
    arm = r.arm;
    if (r.send) actions.remove(current);
    else {
      shown = ''; // redraw with the armed label at once
      del.dataset.armed = '1';
      del.textContent = t('sel.deleteConfirm');
      del.title = t('sel.deleteConfirmTip');
    }
  });
  return {
    root,
    update(info, onMountain, heli = null): void {
      if (info === null) {
        if (!root.hidden) root.hidden = true;
        current = -1;
        arm = null;
        shown = '';
        return;
      }
      current = info.id;
      const armed = deleteArmed(arm, info.id, clock());
      if (!armed) arm = null;
      const sig = [armed ? 1 : 0, info.id, info.type, info.level, info.owned ? 1 : 0, info.finished ? 1 : 0, info.upgrading ? 1 : 0, info.upgradePrice, info.upgradeReason, info.deleteReason, info.deleteSeconds, onMountain ? 1 : 0, languageVersion(), heli === null ? 'x' : [heli.reason, heli.fleet, heli.cap, heli.queueSeconds].join(',')].join('|');
      if (sig === shown && !root.hidden) return;
      shown = sig;
      root.hidden = false;
      root.dataset.id = String(info.id);
      root.dataset.type = String(info.type);
      root.dataset.level = String(info.level);
      root.setAttribute('aria-label', t('sel.panel'));
      name.textContent = t(structureNameKey(info.type));
      level.textContent = `${t(info.level >= maxLevelOf(info.type) ? 'sel.levelTop' : 'sel.level', { level: info.level })} · ${t(info.owned ? 'sel.owner.you' : 'sel.owner.other')}`;
      state.textContent = info.upgrading ? t('sel.state.upgrading') : info.finished ? '' : t('sel.state.building');
      state.hidden = state.textContent === '';
      const fxNow = effectLines(info.type, info.level, onMountain)
        .map((l) => t(l.key, l.params))
        .join(' ');
      // Look-2: levels are unlimited and the steps gentle, so the next level's numbers are shown too (only when they differ and the building can still level up)
      const fxUp =
        info.upgradePrice > 0
          ? effectLines(info.type, info.level + 1, onMountain)
              .map((l) => t(l.key, l.params))
              .join(' ')
          : '';
      fx.textContent = fxUp !== '' && fxUp !== fxNow ? `${fxNow} ${t('sel.fxNext', { fx: fxUp })}` : fxNow;
      // Upgrade
      up.textContent = info.upgradePrice > 0 ? t('sel.upgrade', { price: formatGold(info.upgradePrice) }) : t('sel.upgradeMax');
      up.dataset.price = String(info.upgradePrice);
      up.dataset.reason = String(info.upgradeReason);
      setDimmed(up, info.upgradeReason !== 0, info.upgradeReason !== 0 ? t(upgradeWhyKey(info.upgradeReason), { price: formatGold(info.upgradePrice) }) : t('sel.upgradeTip', { price: formatGold(info.upgradePrice), level: info.level + 1, seconds: info.upgradeSeconds }));
      // Delete
      del.textContent = armed ? t('sel.deleteConfirm') : t('sel.delete');
      del.dataset.armed = armed ? '1' : '0';
      del.dataset.reason = String(info.deleteReason);
      setDimmed(del, info.deleteReason !== 0, info.deleteReason !== 0 ? t(deleteWhyKey(info.deleteReason), { seconds: info.deleteSeconds }) : armed ? t('sel.deleteConfirmTip') : t('sel.deleteTip', { seconds: info.cooldownSeconds }));
      openCity.hidden = !(info.type === STRUCT_CITY && info.owned && actions.openCity !== undefined);
      openCity.textContent = t('sel.city.open');
      openCity.title = t('sel.city.openTip');
      note.textContent = t('sel.hint');
      const showHeli = info.type === STRUCT_FACTORY && info.owned && heli !== null && actions.produceHeli !== undefined;
      heliBox.hidden = !showHeli;
      if (showHeli && heli !== null) {
        heliBtn.textContent = t('sel.heli.build', { price: formatGold(heli.price) });
        heliBtn.dataset.reason = String(heli.reason);
        const why = heli.reason !== 0 ? t(rejectKey(heli.reason), { code: heli.reason }) : '';
        setDimmed(heliBtn, heli.reason !== 0, heli.reason !== 0 ? why : t('sel.heli.tip', { price: formatGold(heli.price), seconds: heli.buildSeconds }));
        heliWhy.textContent = why;
        heliWhy.hidden = why === '';
        heliQueue.textContent = heli.queueSeconds > 0 ? t('sel.heli.queue', { s: heli.queueSeconds }) : '';
        heliQueue.hidden = heli.queueSeconds === 0;
        heliQueue.dataset.value = String(heli.queueSeconds);
        heliFleet.textContent = t('sel.heli.fleet', { n: heli.fleet, cap: heli.cap });
        heliFleet.dataset.n = String(heli.fleet);
        heliFleet.dataset.cap = String(heli.cap);
        heliFleet.dataset.full = heli.fleet >= heli.cap ? '1' : '0';
      }
    },
    dispose(): void {
      root.remove();
    },
  };
}

function el(tag: string, cls: string, testid: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  e.dataset.testid = testid;
  return e;
}

function button(testid: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'sel-btn';
  b.dataset.testid = testid;
  return b;
}

function setDimmed(b: HTMLButtonElement, dimmed: boolean, tip: string): void {
  if (dimmed) b.setAttribute('aria-disabled', 'true');
  else b.removeAttribute('aria-disabled');
  b.dataset.state = dimmed ? 'dim' : 'ok';
  b.title = tip;
}
