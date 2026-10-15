// The selection panel (M10-4): bottom left above the HUD status panel, shows the selected structure's name, level, what it gives (the sim's numbers,
// see structureInfo.ts), the upgrade price and the delete cooldown, with the buttons Upgrade and Delete. The panel only reports clicks: the page sends
// the intents. A button the sim would refuse is dimmed (aria-disabled) and its tooltip says why.
import { languageVersion, t } from './i18n';
import { deleteArmed, deleteClick, deleteWhyKey, effectLines, structureNameKey, upgradeWhyKey, type DeleteArm, type SelectionInfo } from './structureInfo';
import { STRUCT_MAX_LEVEL } from '../sim/public';

export interface SelectionPanel {
  readonly root: HTMLElement;
  /** Per frame: null hides the panel. `onMountain` selects the sim's SAM radius. */
  update(info: SelectionInfo | null, onMountain: boolean): void;
  dispose(): void;
}

export function createSelectionPanel(parent: HTMLElement, actions: { upgrade(id: number): void; remove(id: number): void }): SelectionPanel {
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
  row.append(up, del);
  const note = el('div', 'sel-note', 'sel-note');
  root.append(name, level, state, fx, row, note);
  parent.appendChild(root);
  let shown = '';
  let current = -1;
  up.addEventListener('click', () => {
    if (current >= 0 && up.getAttribute('aria-disabled') !== 'true') actions.upgrade(current);
  });
  // Delete takes two clicks: the first arms it for DELETE_ARM_MS (label "Bekräfta"), the second deletes; the next frame's update shows the label
  let arm: DeleteArm | null = null;
  const clock = (): number => (typeof performance === 'undefined' ? Date.now() : performance.now());
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
    update(info, onMountain): void {
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
      const sig = [armed ? 1 : 0, info.id, info.type, info.level, info.owned ? 1 : 0, info.finished ? 1 : 0, info.upgrading ? 1 : 0, info.upgradePrice, info.upgradeReason, info.deleteReason, info.deleteSeconds, onMountain ? 1 : 0, languageVersion()].join('|');
      if (sig === shown && !root.hidden) return;
      shown = sig;
      root.hidden = false;
      root.dataset.id = String(info.id);
      root.dataset.type = String(info.type);
      root.dataset.level = String(info.level);
      root.setAttribute('aria-label', t('sel.panel'));
      name.textContent = t(structureNameKey(info.type));
      level.textContent = `${t('sel.level', { level: info.level, max: STRUCT_MAX_LEVEL })} · ${t(info.owned ? 'sel.owner.you' : 'sel.owner.other')}`;
      state.textContent = info.upgrading ? t('sel.state.upgrading') : info.finished ? '' : t('sel.state.building');
      state.hidden = state.textContent === '';
      fx.textContent = effectLines(info.type, info.level, onMountain)
        .map((l) => t(l.key, l.params))
        .join(' ');
      // Upgrade
      up.textContent = info.upgradePrice > 0 ? t('sel.upgrade', { price: info.upgradePrice }) : t('sel.upgradeMax');
      up.dataset.price = String(info.upgradePrice);
      up.dataset.reason = String(info.upgradeReason);
      setDimmed(up, info.upgradeReason !== 0, info.upgradeReason !== 0 ? t(upgradeWhyKey(info.upgradeReason), { price: info.upgradePrice }) : t('sel.upgradeTip', { price: info.upgradePrice, level: info.level + 1 }));
      // Delete
      del.textContent = armed ? t('sel.deleteConfirm') : t('sel.delete');
      del.dataset.armed = armed ? '1' : '0';
      del.dataset.reason = String(info.deleteReason);
      setDimmed(del, info.deleteReason !== 0, info.deleteReason !== 0 ? t(deleteWhyKey(info.deleteReason), { seconds: info.deleteSeconds }) : armed ? t('sel.deleteConfirmTip') : t('sel.deleteTip', { seconds: info.cooldownSeconds }));
      note.textContent = t('sel.hint');
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
