// The build bar (M10 slice 1): one button per modelled structure type, bottom centre. Slice 1 has the City (key 1); the other types add an
// entry to BUILD_ITEMS with their model and nothing else changes. The price on a button is the ESCALATING price from the sim function
// (`buildPriceMilli` on the snapshot's table), never a number of the UI. A button the player cannot afford is dimmed and its tooltip says why;
// it still starts the placement mode (the ghost then shows the same reason in red). The bar only reports a choice: placing is `src/app/placement.ts`.
import { STRUCT_CITY, buildPriceMilli, seatToOwner, type SimView } from '../sim/public';
import { languageVersion, t, type TextKey } from './i18n';

interface BuildItem {
  readonly type: number;
  readonly testid: string;
  readonly key: string;
  readonly nameKey: TextKey;
  readonly tipKey: TextKey;
}

const BUILD_ITEMS: readonly BuildItem[] = [{ type: STRUCT_CITY, testid: 'build-city', key: '1', nameKey: 'hud.build.city', tipKey: 'hud.build.cityTip' }];

export interface BuildBar {
  readonly root: HTMLElement;
  /** Per frame: the prices and the dimming follow the snapshot; `active` is the type being placed (0 = none). */
  update(view: SimView, seat: number, active: number): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}

export function createBuildBar(parent: HTMLElement, actions: { select(type: number): void }): BuildBar {
  const root = document.createElement('div');
  root.className = 'build-bar hud-panel';
  root.dataset.testid = 'build-bar';
  root.setAttribute('role', 'toolbar');
  root.setAttribute('aria-label', t('hud.build.bar'));
  const hint = document.createElement('div');
  hint.className = 'build-hint hud-panel';
  hint.dataset.testid = 'build-hint';
  hint.hidden = true;
  const buttons = BUILD_ITEMS.map((item) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'build-btn';
    b.dataset.testid = item.testid;
    b.dataset.type = String(item.type);
    const k = document.createElement('span');
    k.className = 'build-key';
    k.textContent = item.key;
    const name = document.createElement('span');
    name.className = 'build-name';
    const price = document.createElement('span');
    price.className = 'build-price';
    price.dataset.testid = `${item.testid}-price`;
    b.append(k, name, price);
    b.addEventListener('click', () => actions.select(item.type));
    root.appendChild(b);
    return { item, b, name, price, shown: '' };
  });
  parent.append(root, hint);
  let lang = -1;
  return {
    root,
    update(view, seat, active): void {
      const owner = seatToOwner(seat);
      const gold = view.stats.goldMilli[seat] as number;
      const l = languageVersion();
      for (const e of buttons) {
        const priceMilli = buildPriceMilli(view.structures, owner, e.item.type);
        const gp = Math.floor(priceMilli / 1000);
        const poor = gold < priceMilli;
        const sig = `${gp}|${poor ? 1 : 0}|${active === e.item.type ? 1 : 0}|${l}`;
        if (sig === e.shown && lang === l) continue;
        e.shown = sig;
        e.b.dataset.price = String(gp);
        e.b.dataset.state = poor ? 'poor' : 'ok';
        e.b.dataset.active = active === e.item.type ? '1' : '0';
        e.b.setAttribute('aria-pressed', active === e.item.type ? 'true' : 'false');
        if (poor) e.b.setAttribute('aria-disabled', 'true');
        else e.b.removeAttribute('aria-disabled');
        e.name.textContent = t(e.item.nameKey);
        e.price.textContent = t('hud.build.cityCost', { price: gp });
        const tip = poor ? t('hud.build.tooPoor', { price: gp }) : t(e.item.tipKey, { price: gp });
        e.b.title = tip;
        e.b.setAttribute('aria-label', `${t(e.item.nameKey)} ${gp}`);
      }
      lang = l;
      const placing = active !== 0 && !root.hidden;
      if (hint.hidden === placing) {
        hint.hidden = !placing;
        if (placing) hint.textContent = t('hud.build.placing');
      }
    },
    setVisible(visible): void {
      if (root.hidden === visible) root.hidden = !visible;
      if (!visible) hint.hidden = true;
    },
    dispose(): void {
      root.remove();
      hint.remove();
    },
  };
}
