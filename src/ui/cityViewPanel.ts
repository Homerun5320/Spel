// The city view panel (Districts-2a): a small map of one City. One tile per district slot (2 / 3 / 4 / 5 by the City's level, `districtSlotsOf`), the City's level and
// its upgrade button on top, the totals the City gives. DOM only. The panel only reports clicks (build / upgrade / remove); the page sends the
// intents. Every frame `update` computes the cheap numeric signature of `cityViewModel.ts` and rebuilds texts and attributes ONLY when it changed
// (no innerHTML, no allocation while nothing changes). Icons are inline SVG built in code.
import { fxNow } from '../render/clock';
import { DISTRICT_MAX_LEVEL, DISTRICT_MAX_SLOTS, STRUCT_CITY, maxLevelOf, type SimView } from '../sim/public';
import {
  CITY_SIG_MAX,
  DISTRICT_KINDS,
  cityInfo,
  citySignature,
  districtNameKey,
  districtWhyKey,
  removeArmed,
  removeClick,
  type BuildChoice,
  type CityInfo,
  type FxLine,
  type TileInfo,
} from './cityViewModel';
import { formatFixed, formatGold, formatGoldRate, formatInt, languageVersion, t } from './i18n';
import type { DeleteArm } from './structureInfo';
import { CITY_VIEW } from './uiConfig';

export interface CityViewActions {
  build(structure: number, slot: number, kind: number): void;
  upgrade(structure: number, slot: number): void;
  remove(structure: number, slot: number): void;
  upgradeCity(structure: number): void;
  close(): void;
}

export interface CityViewPanel {
  readonly root: HTMLElement;
  /** Per frame while the view is open. `id` < 0 hides the panel. */
  update(view: SimView, seat: number, id: number): void;
  dispose(): void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The icon of a district kind: inline SVG built in code (a house, a coin, a shield, a wall). */
export function districtIcon(kind: number, px: number = CITY_VIEW.iconPx): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(px));
  svg.setAttribute('height', String(px));
  svg.setAttribute('aria-hidden', 'true');
  svg.dataset.kind = String(kind);
  const colour = CITY_VIEW.colors.kind[kind] ?? CITY_VIEW.colors.kind[4];
  const shape = (tag: string, attrs: Record<string, string>): void => {
    const e = document.createElementNS(SVG_NS, tag);
    for (const k of Object.keys(attrs)) e.setAttribute(k, attrs[k] as string);
    e.setAttribute('fill', attrs.fill ?? colour);
    if (attrs.stroke === undefined) e.setAttribute('stroke', 'none');
    svg.appendChild(e);
  };
  switch (kind) {
    case 1: // Housing: a house
      shape('path', { d: 'M12 3 L22 12 H19 V21 H5 V12 H2 Z' });
      shape('rect', { x: '10', y: '14', width: '4', height: '7', fill: '#0d1830' });
      break;
    case 2: // Market: a coin
      shape('circle', { cx: '12', cy: '12', r: '9.5' });
      shape('rect', { x: '10.8', y: '5.5', width: '2.4', height: '13', fill: '#0d1830' });
      shape('rect', { x: '7', y: '10.8', width: '10', height: '2.4', fill: '#0d1830' });
      break;
    case 3: // Barracks: a shield
      shape('path', { d: 'M12 2 L21 5 V12 C21 17 17 20.5 12 22 C7 20.5 3 17 3 12 V5 Z' });
      shape('path', { d: 'M12 6 L13.6 10 H18 L14.4 12.6 L15.8 17 L12 14.3 L8.2 17 L9.6 12.6 L6 10 H10.4 Z', fill: '#0d1830' });
      break;
    default: // Walls: a crenellated wall
      shape('path', { d: 'M2 21 V8 H6 V5 H9 V8 H10 V5 H14 V8 H15 V5 H18 V8 H22 V21 Z' });
      shape('rect', { x: '9.5', y: '14', width: '5', height: '7', fill: '#0d1830' });
      break;
  }
  return svg;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, testid?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls !== '') e.className = cls;
  if (testid !== undefined) e.dataset.testid = testid;
  return e;
}

function btn(cls: string, testid: string): HTMLButtonElement {
  const b = el('button', cls, testid);
  b.type = 'button';
  return b;
}

function setDimmed(b: HTMLElement, dimmed: boolean, tip: string): void {
  if (dimmed) b.setAttribute('aria-disabled', 'true');
  else b.removeAttribute('aria-disabled');
  b.dataset.state = dimmed ? 'dim' : 'ok';
  b.title = tip;
}

function fxText(line: FxLine): string {
  return t(line.key, line.params);
}

interface BuildButton {
  readonly button: HTMLButtonElement;
  readonly name: HTMLElement;
  readonly time: HTMLElement;
}

interface TileDom {
  readonly root: HTMLElement;
  readonly label: HTMLElement;
  readonly emptyBox: HTMLElement;
  readonly emptyHint: HTMLElement;
  readonly builds: BuildButton[];
  readonly usedBox: HTMLElement;
  readonly iconBox: HTMLElement;
  readonly name: HTMLElement;
  readonly level: HTMLElement;
  readonly state: HTMLElement;
  readonly bar: HTMLElement;
  readonly fill: HTMLElement;
  readonly fxNow: HTMLElement;
  readonly fxNext: HTMLElement;
  readonly upgrade: HTMLButtonElement;
  readonly remove: HTMLButtonElement;
  shownKind: number;
}

export function createCityViewPanel(parent: HTMLElement, actions: CityViewActions): CityViewPanel {
  const root = el('div', 'city-view hud-panel', 'city-view');
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  const head = el('div', 'city-head');
  const title = el('div', 'city-title', 'city-title');
  const close = btn('city-btn city-close', 'city-close');
  head.append(title, close);
  const bar = el('div', 'city-bar');
  const upCity = btn('city-btn', 'city-upgrade');
  const cityState = el('div', 'city-state', 'city-state');
  bar.append(upCity, cityState);
  const totals = el('div', 'city-totals', 'city-totals');
  const totalGold = el('span', 'city-total', 'city-total-gold');
  const totalTroops = el('span', 'city-total', 'city-total-troops');
  const totalRegen = el('span', 'city-total', 'city-total-regen');
  const totalWalls = el('span', 'city-total', 'city-total-walls');
  totals.append(totalGold, totalTroops, totalRegen, totalWalls);
  const grid = el('div', 'city-grid', 'city-grid');
  const hint = el('div', 'city-hint', 'city-hint');
  root.append(head, bar, totals, grid, hint);
  parent.appendChild(root);

  let structure = -1;
  let arm: DeleteArm | null = null;
  const clock = (): number => fxNow() * 1000;
  const tiles: TileDom[] = [];

  const makeTile = (slot: number): TileDom => {
    const tile = el('div', 'city-tile', `city-tile-${slot}`);
    tile.setAttribute('role', 'group');
    const label = el('div', 'city-tile-label');
    const emptyBox = el('div', 'city-empty');
    const emptyHint = el('div', 'city-empty-hint');
    emptyBox.appendChild(emptyHint);
    const builds: BuildButton[] = [];
    for (const kind of DISTRICT_KINDS) {
      const b = btn('city-build', `city-build-${slot}-${kind}`);
      b.dataset.kind = String(kind);
      b.appendChild(districtIcon(kind, 22));
      const text = el('span', 'city-build-text');
      const name = el('span', 'city-build-name');
      const time = el('span', 'city-build-time');
      text.append(name, time);
      b.appendChild(text);
      b.addEventListener('click', () => {
        if (b.getAttribute('aria-disabled') !== 'true' && structure >= 0) actions.build(structure, slot, kind);
      });
      emptyBox.appendChild(b);
      builds.push({ button: b, name, time });
    }
    const usedBox = el('div', 'city-used');
    const topRow = el('div', 'city-used-top');
    const iconBox = el('span', 'city-icon');
    const names = el('span', 'city-used-names');
    const name = el('span', 'city-used-name', `city-name-${slot}`);
    const level = el('span', 'city-used-level', `city-level-${slot}`);
    names.append(name, level);
    topRow.append(iconBox, names);
    const state = el('div', 'city-used-state', `city-state-${slot}`);
    const barEl = el('div', 'city-progress', `city-progress-${slot}`);
    barEl.setAttribute('role', 'progressbar');
    barEl.setAttribute('aria-valuemin', '0');
    barEl.setAttribute('aria-valuemax', '100');
    const fill = el('div', 'city-progress-fill');
    barEl.appendChild(fill);
    const fxNow = el('div', 'city-fx', `city-fx-${slot}`);
    const fxNext = el('div', 'city-fx city-fx-next', `city-fxnext-${slot}`);
    const row = el('div', 'city-row');
    const upgrade = btn('city-btn', `city-district-upgrade-${slot}`);
    const remove = btn('city-btn', `city-district-remove-${slot}`);
    row.append(upgrade, remove);
    usedBox.append(topRow, state, barEl, fxNow, fxNext, row);
    tile.append(label, emptyBox, usedBox);
    grid.appendChild(tile);
    upgrade.addEventListener('click', () => {
      if (upgrade.getAttribute('aria-disabled') !== 'true' && structure >= 0) actions.upgrade(structure, slot);
    });
    remove.addEventListener('click', () => {
      if (remove.getAttribute('aria-disabled') === 'true' || structure < 0) return;
      const r = removeClick(arm, structure, slot, clock());
      arm = r.arm;
      if (r.send) actions.remove(structure, slot);
      else sigOld[0] = -1; // redraw with the armed label at once
    });
    return { root: tile, label, emptyBox, emptyHint, builds, usedBox, iconBox, name, level, state, bar: barEl, fill, fxNow, fxNext, upgrade, remove, shownKind: 0 };
  };
  for (let slot = 0; slot < DISTRICT_MAX_SLOTS; slot++) tiles.push(makeTile(slot));

  close.addEventListener('click', () => actions.close());
  upCity.addEventListener('click', () => {
    if (upCity.getAttribute('aria-disabled') !== 'true' && structure >= 0) actions.upgradeCity(structure);
  });

  const sigNew = new Int32Array(CITY_SIG_MAX + DISTRICT_MAX_SLOTS + 4);
  const sigOld = new Int32Array(CITY_SIG_MAX + DISTRICT_MAX_SLOTS + 4);
  let sigLen = 0;
  let oldLen = -1;

  const renderBuild = (b: BuildButton, c: BuildChoice): void => {
    const name = t(districtNameKey(c.kind));
    b.name.textContent = t('sel.district.build', { name, price: formatGold(c.price) });
    b.time.textContent = t('sel.district.buildTime', { seconds: c.buildSeconds });
    b.button.dataset.price = String(c.price);
    b.button.dataset.reason = String(c.reason);
    setDimmed(b.button, c.reason !== 0, c.reason !== 0 ? t(districtWhyKey(c.reason)) : t('sel.district.buildTip', { name, price: formatGold(c.price), seconds: c.buildSeconds, fx: fxText(c.fx) }));
  };

  const renderTile = (d: TileDom, info: CityInfo, ti: TileInfo, now: number): void => {
    d.root.hidden = false;
    d.root.dataset.state = ti.state;
    d.root.dataset.kind = String(ti.kind);
    d.root.dataset.level = String(ti.level);
    d.label.textContent = t('sel.city.tile', { n: ti.slot + 1 });
    d.root.setAttribute('aria-label', d.label.textContent);
    const empty = ti.state === 'empty';
    d.emptyBox.hidden = !empty;
    d.usedBox.hidden = empty;
    if (empty) {
      d.emptyHint.textContent = t('sel.city.tileEmpty');
      for (let i = 0; i < d.builds.length; i++) renderBuild(d.builds[i] as BuildButton, ti.choices[i] as BuildChoice);
      return;
    }
    if (d.shownKind !== ti.kind) {
      d.shownKind = ti.kind;
      d.iconBox.replaceChildren(districtIcon(ti.kind));
    }
    d.name.textContent = t(districtNameKey(ti.kind));
    d.level.textContent = t(ti.level >= DISTRICT_MAX_LEVEL ? 'sel.district.levelTop' : 'sel.district.level', { level: ti.level });
    const running = ti.state === 'building' || ti.state === 'upgrading';
    d.state.hidden = !running;
    d.state.textContent = ti.state === 'building' ? t('sel.district.building') : ti.state === 'upgrading' ? t('sel.district.upgrading') : '';
    d.bar.hidden = !running;
    d.fill.style.width = `${ti.progressPct}%`;
    d.bar.setAttribute('aria-valuenow', String(ti.progressPct));
    d.bar.title = t('sel.city.tileProgress', { pct: ti.progressPct });
    d.fxNow.hidden = ti.fxNow === null;
    d.fxNow.textContent = ti.fxNow === null ? '' : t('sel.district.now', { fx: fxText(ti.fxNow) });
    d.fxNext.hidden = ti.state === 'building';
    d.fxNext.textContent = ti.state === 'building' ? '' : ti.fxNext === null ? t('sel.district.maxed') : t('sel.district.next', { fx: fxText(ti.fxNext) });
    // Upgrade
    d.upgrade.textContent = ti.upgradePrice > 0 ? t('sel.district.upgrade', { price: formatGold(ti.upgradePrice) }) : t('sel.district.maxed');
    d.upgrade.dataset.price = String(ti.upgradePrice);
    d.upgrade.dataset.reason = String(ti.upgradeReason);
    setDimmed(d.upgrade, ti.upgradeReason !== 0, ti.upgradeReason !== 0 ? t(districtWhyKey(ti.upgradeReason)) : t('sel.district.upgradeTip', { level: ti.level + 1, price: formatGold(ti.upgradePrice) }));
    // Remove (two steps)
    const armed = removeArmed(arm, info.id, ti.slot, now);
    d.remove.textContent = armed ? t('sel.district.removeConfirm') : t('sel.district.remove');
    d.remove.dataset.armed = armed ? '1' : '0';
    d.remove.dataset.reason = String(ti.removeReason);
    setDimmed(d.remove, ti.removeReason !== 0, ti.removeReason !== 0 ? t(districtWhyKey(ti.removeReason), { seconds: ti.removeSeconds }) : armed ? t('sel.district.removeConfirmTip') : t('sel.district.removeTip'));
  };

  const render = (view: SimView, seat: number, id: number, now: number): void => {
    const info = cityInfo(view, seat, id);
    if (info === null) {
      root.hidden = true;
      return;
    }
    root.hidden = false;
    root.dataset.id = String(id);
    root.dataset.level = String(info.level);
    root.setAttribute('aria-label', t('sel.city.panel'));
    title.textContent = t(info.level >= maxLevelOf(STRUCT_CITY) ? 'sel.city.titleTop' : 'sel.city.title', { level: info.level });
    close.textContent = t('sel.city.close');
    close.title = t('sel.city.close');
    upCity.textContent = info.upgradePrice > 0 ? t('sel.city.upgrade', { price: formatGold(info.upgradePrice) }) : t('sel.city.upgradeMax');
    upCity.dataset.price = String(info.upgradePrice);
    upCity.dataset.reason = String(info.upgradeReason);
    setDimmed(upCity, info.upgradeReason !== 0, info.upgradeReason !== 0 ? t(districtWhyKey(info.upgradeReason)) : t('sel.city.upgradeTip', { level: info.level + 1, price: formatGold(info.upgradePrice), seconds: info.upgradeSeconds }));
    cityState.hidden = info.finished && !info.upgrading;
    cityState.textContent = !info.finished ? t('sel.city.stateBuilding') : info.upgrading ? t('sel.city.stateUpgrading') : '';
    const tt = info.totals;
    totalGold.textContent = t('sel.city.totalsGold', { gold: formatGoldRate(tt.goldMilliPerSec) });
    totalTroops.textContent = t('sel.city.totalsTroops', { troops: `+${formatInt(tt.capTroops)}` });
    totalRegen.textContent = t('sel.city.totalsRegen', { pct: tt.regenPct });
    totalWalls.textContent = tt.wallsCostPct > 100 ? t('sel.city.totalsWalls', { mult: formatFixed(tt.wallsCostPct / 100, 1) }) : t('sel.city.totalsWallsNone');
    totalGold.dataset.milli = String(tt.goldMilliPerSec);
    totalTroops.dataset.cap = String(tt.capTroops);
    totalRegen.dataset.pct = String(tt.regenPct);
    totalWalls.dataset.pct = String(tt.wallsCostPct);
    hint.textContent = t('sel.city.hint');
    for (let slot = 0; slot < DISTRICT_MAX_SLOTS; slot++) {
      const d = tiles[slot] as TileDom;
      const ti = info.tiles[slot];
      if (ti === undefined) d.root.hidden = true;
      else renderTile(d, info, ti, now);
    }
  };

  return {
    root,
    update(view, seat, id): void {
      if (id < 0) {
        if (!root.hidden) root.hidden = true;
        structure = -1;
        arm = null;
        oldLen = -1;
        return;
      }
      structure = id;
      const now = clock();
      sigLen = citySignature(view, seat, id, sigNew);
      // the extras: the armed Remove of each tile, and the language
      let armedMask = 0;
      for (let slot = 0; slot < DISTRICT_MAX_SLOTS; slot++) if (removeArmed(arm, id, slot, now)) armedMask |= 1 << slot;
      if (armedMask === 0) arm = null;
      sigNew[sigLen++] = armedMask;
      sigNew[sigLen++] = languageVersion();
      let same = !root.hidden && sigLen === oldLen && sigOld[0] !== -1;
      for (let i = 0; same && i < sigLen; i++) if (sigNew[i] !== sigOld[i]) same = false;
      if (same) return;
      oldLen = sigLen;
      sigOld.set(sigNew.subarray(0, sigLen));
      render(view, seat, id, now);
    },
    dispose(): void {
      root.remove();
    },
  };
}
