// The build bar (M10 slice 1): one button per modelled structure type, bottom centre. Slice 1 has the City (key 1); the other types add an
// entry to BUILD_ITEMS with their model and nothing else changes. The price on a button is the ESCALATING price from the sim function
// (`buildPriceMilli` on the snapshot's table), never a number of the UI. A button the player cannot afford is dimmed and its tooltip says why;
// it still starts the placement mode (the ghost then shows the same reason in red). The bar only reports a choice: placing is `src/app/placement.ts`.
import { STRUCT_CITY, STRUCT_FACTORY, STRUCT_PORT, STRUCT_POST, STRUCT_SAM, STRUCT_SILO, buildPriceMilli, hasFinishedFactory, seatToOwner, type SimView } from '../sim/public';
import { languageVersion, t, type TextKey } from './i18n';

interface BuildItem {
  readonly type: number;
  readonly testid: string;
  readonly key: string;
  readonly nameKey: TextKey;
  readonly tipKey: TextKey;
  /** The tooltip of a button the player cannot pay (it names the type and the price). */
  readonly poorKey: TextKey;
  /** M10-3: the Silo needs a finished Factory; the button is dimmed with this tooltip until the player has one. */
  readonly needsFactory?: boolean;
}

const BUILD_ITEMS: readonly BuildItem[] = [
  { type: STRUCT_CITY, testid: 'build-city', key: '1', nameKey: 'hud.build.city', tipKey: 'hud.build.cityTip', poorKey: 'hud.build.tooPoor' },
  // M10-2: Factory and Port.
  { type: STRUCT_FACTORY, testid: 'build-factory', key: '2', nameKey: 'hud.build.factory', tipKey: 'hud.build.factoryTip', poorKey: 'hud.build.tooPoorFactory' },
  { type: STRUCT_PORT, testid: 'build-port', key: '3', nameKey: 'hud.build.port', tipKey: 'hud.build.portTip', poorKey: 'hud.build.tooPoorPort' },
  // M10-3: Silo, SAM and Defense Post.
  { type: STRUCT_SILO, testid: 'build-silo', key: '4', nameKey: 'hud.build.silo', tipKey: 'hud.build.siloTip', poorKey: 'hud.build.tooPoorOf', needsFactory: true },
  { type: STRUCT_SAM, testid: 'build-sam', key: '5', nameKey: 'hud.build.sam', tipKey: 'hud.build.samTip', poorKey: 'hud.build.tooPoorOf' },
  { type: STRUCT_POST, testid: 'build-post', key: '6', nameKey: 'hud.build.post', tipKey: 'hud.build.postTip', poorKey: 'hud.build.tooPoorOf' },
];

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
        const locked = e.item.needsFactory === true && !hasFinishedFactory(view, owner);
        const sig = `${gp}|${poor ? 1 : 0}|${locked ? 1 : 0}|${active === e.item.type ? 1 : 0}|${l}`;
        if (sig === e.shown && lang === l) continue;
        e.shown = sig;
        e.b.dataset.price = String(gp);
        e.b.dataset.state = locked ? 'locked' : poor ? 'poor' : 'ok';
        e.b.dataset.active = active === e.item.type ? '1' : '0';
        e.b.setAttribute('aria-pressed', active === e.item.type ? 'true' : 'false');
        if (poor || locked) e.b.setAttribute('aria-disabled', 'true');
        else e.b.removeAttribute('aria-disabled');
        e.name.textContent = t(e.item.nameKey);
        e.price.textContent = t('hud.build.cityCost', { price: gp });
        const name = t(e.item.nameKey);
        const tip = locked ? t('hud.build.needFactory', { name }) : poor ? t(e.item.poorKey, { price: gp, name }) : t(e.item.tipKey, { price: gp });
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
