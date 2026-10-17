// Fix-6A2 [1.11]: the unit-testable parts of the build bar, the ship box and the hotkey registry (no layout, no CSS: those stay in the e2e files). The two UI modules need a
// document, so a minimal fake element class stands in for it. Mutants: the Fix-6A2 block of docs/DECISIONS.md.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HotkeyRegistry, registerGameHotkeys, type GameHotkeyActions, type HotkeyEvent } from '../../src/app/hotkeys';
import { InputStack } from '../../src/app/input';
import { MILLI_GOLD_PER_GOLD, SHIP_MAX_TROOPS, SHIP_MIN_TROOPS } from '../../src/sim/rules';
import { createState, type GameState } from '../../src/sim/state';
import { buildPriceGold, STRUCT_CITY, STRUCT_FACTORY, STRUCT_SILO } from '../../src/sim/structureRules';
import { CLASS_PLAINS } from '../../src/sim/terrain';
import { StateView } from '../../src/sim/view';
import { createBuildBar } from '../../src/ui/buildBar';
import { formatGold, setLanguage, t } from '../../src/ui/i18n';
import { createShipBox, type ShipBoxModel } from '../../src/ui/shipBox';

class FakeEl {
  className = '';
  dataset: Record<string, string> = {};
  hidden = false;
  textContent = '';
  title = '';
  type = '';
  min = '';
  max = '';
  step = '';
  value = '';
  style: Record<string, string> = {};
  children: FakeEl[] = [];
  parentElement: FakeEl | null = null;
  private attrs = new Map<string, string>();
  private handlers = new Map<string, Array<() => void>>();
  constructor(readonly tag: string) {}
  setAttribute(k: string, v: string): void {
    this.attrs.set(k, v);
  }
  getAttribute(k: string): string | null {
    return this.attrs.get(k) ?? null;
  }
  removeAttribute(k: string): void {
    this.attrs.delete(k);
  }
  append(...c: FakeEl[]): void {
    for (const e of c) this.appendChild(e);
  }
  appendChild(c: FakeEl): FakeEl {
    c.parentElement = this;
    this.children.push(c);
    return c;
  }
  remove(): void {
    const p = this.parentElement;
    if (p !== null) p.children = p.children.filter((c) => c !== this);
    this.parentElement = null;
  }
  addEventListener(type: string, h: () => void): void {
    const list = this.handlers.get(type) ?? [];
    list.push(h);
    this.handlers.set(type, list);
  }
  fire(type: string): void {
    for (const h of this.handlers.get(type) ?? []) h();
  }
  find(testid: string): FakeEl | null {
    if (this.dataset.testid === testid) return this;
    for (const c of this.children) {
      const f = c.find(testid);
      if (f !== null) return f;
    }
    return null;
  }
}

beforeEach(() => {
  vi.stubGlobal('document', { createElement: (tag: string) => new FakeEl(tag) });
  setLanguage('sv');
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function world(): GameState {
  const n = 64 * 64;
  return createState({ width: 64, height: 64, seed: 1, seats: 2, config: { debugIntents: true }, terrain: new Uint8Array(n).fill(CLASS_PLAINS), elevation: new Uint16Array(n).fill(5), maxElev: new Int16Array(n).fill(5) });
}

describe('createBuildBar', () => {
  const setup = (s: GameState): { bar: ReturnType<typeof createBuildBar>; parent: FakeEl; picks: number[]; view: StateView } => {
    const parent = new FakeEl('div');
    const picks: number[] = [];
    const bar = createBuildBar(parent as unknown as HTMLElement, { select: (type) => void picks.push(type) });
    return { bar, parent, picks, view: new StateView(s) };
  };
  const stateOf = (parent: FakeEl, id: string): string => parent.find(id)?.dataset.state ?? '?';

  it('has nine buttons in the order of the types, each click reports its type, and the key digit is shown on the button', () => {
    const { parent, picks } = setup(world());
    const ids = ['build-city', 'build-factory', 'build-port', 'build-silo', 'build-sam', 'build-post', 'build-airfield', 'build-lab', 'build-plant'];
    ids.forEach((id, i) => {
      const b = parent.find(id);
      expect(b, id).not.toBeNull();
      expect(b?.dataset.type).toBe(String(i + 1));
      expect(b?.children[0]?.textContent).toBe(String(i + 1));
      b?.fire('click');
    });
    expect(picks).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('the Silo is locked (and says so) until the seat has a FINISHED Factory; every other button is ok with plenty of gold', () => {
    const s = world();
    s.gold[1] = 5000 * MILLI_GOLD_PER_GOLD;
    const { bar, parent, view } = setup(s);
    view.refresh();
    bar.update(view, 0, 0);
    expect(stateOf(parent, 'build-silo')).toBe('locked');
    expect(parent.find('build-silo')?.getAttribute('aria-disabled')).toBe('true');
    expect(parent.find('build-silo')?.title).toBe(t('hud.build.needFactory', { name: t('hud.build.silo') }));
    for (const id of ['build-city', 'build-factory', 'build-port', 'build-sam', 'build-post', 'build-airfield', 'build-lab', 'build-plant']) expect(stateOf(parent, id), id).toBe('ok');
    expect(parent.find('build-city')?.getAttribute('aria-disabled')).toBeNull();
    const f = s.structures.add(STRUCT_FACTORY, 1, 10 * 64 + 10, s.tick);
    s.structures.readyTick[f] = s.tick + 100; // still under construction
    view.refresh();
    bar.update(view, 0, 0);
    expect(stateOf(parent, 'build-silo')).toBe('locked');
    s.structures.readyTick[f] = s.tick;
    view.refresh();
    bar.update(view, 0, 0);
    expect(stateOf(parent, 'build-silo')).toBe('ok');
  });

  it('the poor boundary is exact: gold == price is ok, one milli less is poor with the "too poor" tooltip, and the price on the button is the escalating one', () => {
    const s = world();
    const price = buildPriceGold(STRUCT_CITY, 0) * MILLI_GOLD_PER_GOLD;
    s.gold[1] = price;
    const { bar, parent, view } = setup(s);
    view.refresh();
    bar.update(view, 0, 0);
    expect(stateOf(parent, 'build-city')).toBe('ok');
    expect(parent.find('build-city')?.dataset.price).toBe(String(price / MILLI_GOLD_PER_GOLD));
    s.gold[1] = price - 1;
    view.refresh();
    bar.update(view, 0, 0);
    expect(stateOf(parent, 'build-city')).toBe('poor');
    expect(parent.find('build-city')?.getAttribute('aria-disabled')).toBe('true');
    expect(parent.find('build-city')?.title).toContain(formatGold(price / MILLI_GOLD_PER_GOLD));
    // a second City costs more (the price follows the table, not a constant)
    s.gold[1] = 100000 * MILLI_GOLD_PER_GOLD;
    s.structures.add(STRUCT_CITY, 1, 20 * 64 + 20, s.tick);
    view.refresh();
    bar.update(view, 0, 0);
    expect(Number(parent.find('build-city')?.dataset.price)).toBe(buildPriceGold(STRUCT_CITY, 1));
    expect(buildPriceGold(STRUCT_CITY, 1)).toBeGreaterThan(buildPriceGold(STRUCT_CITY, 0));
  });

  it('the active button is marked and pressed, the hint shows only while placing and the bar is visible, and the bar can be hidden', () => {
    const s = world();
    s.gold[1] = 5000 * MILLI_GOLD_PER_GOLD;
    const { bar, parent, view } = setup(s);
    view.refresh();
    bar.update(view, 0, STRUCT_SILO);
    expect(parent.find('build-silo')?.dataset.active).toBe('1');
    expect(parent.find('build-silo')?.getAttribute('aria-pressed')).toBe('true');
    expect(parent.find('build-city')?.dataset.active).toBe('0');
    const hint = parent.find('build-hint');
    expect(hint?.hidden).toBe(false);
    expect(hint?.textContent).toBe(t('hud.build.placing'));
    bar.update(view, 0, 0);
    expect(hint?.hidden).toBe(true);
    bar.setVisible(false);
    bar.update(view, 0, STRUCT_SILO);
    expect(hint?.hidden).toBe(true); // a hidden bar shows no hint
    bar.setVisible(true);
    bar.update(view, 0, STRUCT_SILO);
    expect(hint?.hidden).toBe(false);
    expect(parent.find('build-city')?.title).not.toBe('');
  });
});

describe('createShipBox', () => {
  const model = (over: Partial<ShipBoxModel> = {}): ShipBoxModel => ({ reason: 0, price: 50, fleet: 1, cap: 4, active: false, status: 'idle', previewReason: 0, etaSeconds: 0, maxTroops: SHIP_MAX_TROOPS, ...over });
  const setup = (): { box: ReturnType<typeof createShipBox>; root: FakeEl; log: string[] } => {
    const panel = new FakeEl('section');
    const parent = new FakeEl('div');
    panel.appendChild(parent);
    const log: string[] = [];
    const box = createShipBox(parent as unknown as HTMLElement, { open: () => void log.push('open'), confirm: () => void log.push('confirm'), cancel: () => void log.push('cancel') });
    return { box, root: panel, log };
  };

  it('a live open button reports the click; a dimmed one (reason != 0) does not, but it still ends an active mode', () => {
    const { box, root, log } = setup();
    box.update(model());
    const open = root.find('sel-ship') as FakeEl;
    expect(open.dataset.state).toBe('ok');
    expect(open.getAttribute('aria-disabled')).toBeNull();
    open.fire('click');
    box.update(model({ reason: 3 }));
    expect(open.dataset.state).toBe('dim');
    expect(open.getAttribute('aria-disabled')).toBe('true');
    expect(root.find('sel-ship-why')?.hidden).toBe(false);
    open.fire('click');
    expect(log).toEqual(['open']);
    box.update(model({ reason: 3, active: true }));
    open.fire('click');
    expect(log).toEqual(['open', 'open']); // the mode is on: the button leaves it even when dimmed
  });

  it('the controls show only while the mode is on, the panel flag follows, and the fleet line shows n of cap', () => {
    const { box, root } = setup();
    box.update(model());
    expect(root.find('ship-controls')?.hidden).toBe(true);
    expect(root.dataset.shipping).toBe('0');
    expect(root.find('sel-ship-fleet')?.dataset.n).toBe('1');
    box.update(model({ active: true, fleet: 2 }));
    expect(root.find('ship-controls')?.hidden).toBe(false);
    expect(root.dataset.shipping).toBe('1');
    expect(root.find('sel-ship-fleet')?.dataset.n).toBe('2');
    expect(root.find('sel-ship-fleet')?.textContent).toBe(t('sel.ship.fleet', { n: 2, cap: 4 }));
  });

  it('Send is live only with a valid preview, Cancel always reports; the status line follows the preview', () => {
    const { box, root, log } = setup();
    box.update(model({ active: true, status: 'idle' }));
    const confirm = root.find('ship-confirm') as FakeEl;
    expect(confirm.getAttribute('aria-disabled')).toBe('true');
    confirm.fire('click');
    box.update(model({ active: true, status: 'invalid', previewReason: 5 }));
    expect(root.find('ship-status')?.dataset.state).toBe('invalid');
    confirm.fire('click');
    expect(log).toEqual([]);
    box.update(model({ active: true, status: 'valid', etaSeconds: 42 }));
    expect(confirm.getAttribute('aria-disabled')).toBeNull();
    expect(root.find('ship-status')?.textContent).toBe(t('sel.ship.statusValid', { s: 42 }));
    expect(root.find('ship-status')?.dataset.eta).toBe('42');
    confirm.fire('click');
    (root.find('ship-cancel') as FakeEl).fire('click');
    expect(log).toEqual(['confirm', 'cancel']);
  });

  it('the troop slider is clamped to the least launch and the top given by the model, and the label shows the value', () => {
    const { box, root } = setup();
    box.update(model({ maxTroops: 300 }));
    const slider = root.find('ship-troops') as FakeEl;
    expect(slider.max).toBe('300');
    slider.value = '999999';
    expect(box.troops()).toBe(300);
    slider.value = '-5';
    expect(box.troops()).toBe(SHIP_MIN_TROOPS);
    slider.value = '120';
    slider.fire('input');
    box.update(model({ maxTroops: 300 }));
    expect(root.find('ship-troops-label')?.dataset.value).toBe('120');
  });
});

describe('the hotkey registry entries 7 to 9 and B, and the whole table', () => {
  const ev = (key: string, extra: Partial<HotkeyEvent> = {}): HotkeyEvent => ({ key, ctrlKey: false, altKey: false, metaKey: false, repeat: false, typing: false, ...extra });
  const setup = (): { reg: HotkeyRegistry; log: string[] } => {
    const log: string[] = [];
    const reg = new HotkeyRegistry();
    reg.context = { matchOn: () => true, modalOpen: () => false };
    const actions: GameHotkeyActions = {
      stack: new InputStack({ id: 'base' }),
      toggleOverlay: () => void log.push('overlay'),
      commit: (d) => void log.push(`commit${d}`),
      togglePause: () => void log.push('pause'),
      slower: () => void log.push('slower'),
      faster: () => void log.push('faster'),
      toggleHelp: () => void log.push('help'),
      buildType: (type) => void log.push(`build${type}`),
      deploy: () => void log.push('deploy'),
      ship: () => void log.push('ship'),
      toggleDiplomacy: () => void log.push('diplo'),
      toggleTech: () => void log.push('tech'),
      toggleLabels: () => void log.push('labels'),
    };
    registerGameHotkeys(reg, actions);
    return { reg, log };
  };

  it('the table (id, keys, scope, noRepeat, hidden) is pinned: a changed key, scope or flag fails here', () => {
    const { reg } = setup();
    const table = reg.entries().map((d) => [d.id, d.keys.join(' '), d.scope, d.noRepeat === true, d.hidden === true]);
    expect(table).toEqual([
      ['focus-capital', 'f', 'stack', false, false],
      ['build', '1 2 3 4 5 6', 'stack', false, false],
      ['build-extra', '7 8 9', 'match', true, false],
      ['exposure', 'e', 'stack', false, true],
      ['chase', 'h', 'stack', false, true],
      ['escape', 'Escape', 'stack', false, false],
      ['pause', '  Spacebar', 'match', true, false],
      ['slower', ',', 'match', false, false],
      ['faster', '.', 'match', false, false],
      ['commit-down', '[ -', 'match', false, false],
      ['commit-up', '] +', 'match', false, false],
      ['deploy', 'l', 'match', true, false],
      ['ship', 'b', 'match', true, false],
      ['diplomacy', 'd', 'match', true, false],
      ['tech', 't', 'match', true, false],
      ['labels', 'n', 'match', true, false],
      ['help', '?', 'match', false, false],
      ['overlay', 'F3', 'global', false, false],
    ]);
  });

  it('B opens the ship mode (either case), once per press: a held key, typing and a modifier do nothing', () => {
    const { reg, log } = setup();
    expect(reg.handle(ev('b'))).toBe(true);
    expect(reg.handle(ev('B'))).toBe(true);
    expect(log).toEqual(['ship', 'ship']);
    expect(reg.handle(ev('b', { repeat: true }))).toBe(false);
    expect(reg.handle(ev('b', { typing: true }))).toBe(false);
    expect(reg.handle(ev('b', { ctrlKey: true }))).toBe(false);
    expect(log).toEqual(['ship', 'ship']);
  });

  it('7, 8 and 9 start the Airfield, Lab and Plant by their type number', () => {
    const { reg, log } = setup();
    for (const k of ['7', '8', '9']) expect(reg.handle(ev(k))).toBe(true);
    expect(log).toEqual(['build7', 'build8', 'build9']);
  });
});
