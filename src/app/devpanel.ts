// The Dev panel (F2 or the corner button, which also works on a phone where F2 does not exist). EVERY `?` mode of the
// app is registered here with `registerDevMode`, so that nobody has to edit the address bar. A mode is written to the
// HASH (`#perf`, grammar in params.ts) and the page reloads; the app also listens to `hashchange` and restarts the mode
// without a reload. The panel never touches `location.search`.
import { GOLD_DISPLAY_FACTOR } from '../ui/uiConfig';
import { DEV_PANEL_EVENT, DEV_PANEL_REQUEST_EVENT, type DevPanelEventDetail } from '../ui/events';
import { parseHash, toHash, type RawParams } from './params';
import { siteUrl } from './paths';

export interface DevMode {
  id: string;
  /** Swedish label in the panel. */
  label: string;
  /** What the mode sets, as key/value pairs (`{perf: '1'}` is `?perf=1` and `#perf`). */
  params?: RawParams;
  /** True: choosing the mode while it is active switches it off (`perf-0`). */
  toggle?: boolean;
  /** Relative link to another page of the site (for example `./debug/data.html`), written through `siteUrl`. */
  href?: string;
  /** Custom action; without it a mode with `params` writes the hash and reloads. */
  run?: () => void;
  /** A text field for one parameter (the seed): the panel shows an input with the mode id as its element id and a Starta button that writes `param-value` into the hash. */
  field?: { param: string; placeholder?: string; pattern: RegExp };
}

const registry = new Map<string, DevMode>();

/** Registers (or replaces) a mode. A mode needs `run`, `params` or `href`. */
export function registerDevMode(mode: DevMode): void {
  if (!mode.run && !mode.params && !mode.href && !mode.field) throw new Error(`dev mode ${mode.id} has no run, params, href or field`);
  if (mode.href !== undefined && /^\//.test(mode.href)) throw new Error(`dev mode ${mode.id}: links must be relative, got ${mode.href}`);
  registry.set(mode.id, mode);
}

export function devModes(): readonly DevMode[] {
  return [...registry.values()];
}

export function clearDevModes(): void {
  registry.clear();
}

/** True when every parameter of the mode has its value in the (merged) address state. */
export function modeActive(mode: DevMode, raw: Readonly<RawParams>): boolean {
  if (!mode.params) return false;
  return Object.entries(mode.params).every(([k, v]) => raw[k] === v);
}

/**
 * The hash body (without `#`) after choosing a mode: the keys already in the hash stay, the mode's keys are set; a toggle mode that
 * is already active is switched off by writing the key with the value `0` (the query cannot be edited, the hash wins).
 */
export function hashAfterMode(mode: DevMode, currentHash: string, raw: Readonly<RawParams>): string {
  const next: RawParams = { ...parseHash(currentHash) };
  const off = mode.toggle === true && modeActive(mode, raw);
  for (const [k, v] of Object.entries(mode.params ?? {})) next[k] = off ? '0' : v;
  return toHash(next);
}

export interface DevPanelOptions {
  parent: HTMLElement;
  /** Current merged address state (query + hash). */
  getRaw: () => RawParams;
  /** Writes the hash body and reloads. The default sets `location.hash` and calls `location.reload()`. */
  navigate?: (hashBody: string) => void;
}

export interface DevPanel {
  button: HTMLButtonElement;
  panel: HTMLElement;
  isOpen(): boolean;
  open(): void;
  close(): void;
  toggle(): void;
  /** Shows or hides the corner button (it is hidden in test mode so that screenshots stay clean). */
  setButtonVisible(visible: boolean): void;
  /** Rebuilds the list (after modes were registered or the address changed). */
  refresh(): void;
  dispose(): void;
}

function defaultNavigate(hashBody: string): void {
  window.location.hash = hashBody;
  window.location.reload();
}

export function mountDevPanel(opts: DevPanelOptions): DevPanel {
  const navigate = opts.navigate ?? defaultNavigate;
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Dev';
  button.setAttribute('aria-label', 'Öppna Dev-panelen (F2)');
  button.dataset.devButton = '1';
  button.style.cssText =
    'position:fixed;right:8px;top:8px;z-index:40;min-width:48px;min-height:48px;padding:0 10px;border-radius:24px;border:1px solid #3a5a9a;' +
    'background:rgba(14,22,38,0.82);color:#cfe3ff;font:600 13px system-ui,sans-serif;cursor:pointer;touch-action:manipulation;';
  const panel = document.createElement('div');
  panel.dataset.devPanel = '1';
  panel.hidden = true;
  panel.style.cssText =
    'position:fixed;right:8px;top:64px;z-index:40;box-sizing:border-box;width:min(300px,calc(100vw - 16px));max-height:calc(100vh - 80px);overflow:auto;' +
    'padding:10px;border-radius:8px;border:1px solid #2a3d63;background:rgba(10,16,28,0.94);color:#e8f0ff;font:14px system-ui,sans-serif;';
  opts.parent.append(button, panel);

  const refresh = (): void => {
    panel.replaceChildren();
    const raw = opts.getRaw();
    const title = document.createElement('div');
    title.textContent = 'Dev-panel (F2)';
    title.style.cssText = 'font-weight:600;margin-bottom:6px;';
    panel.appendChild(title);
    const hash = window.location.hash;
    const addr = document.createElement('div');
    addr.dataset.devAddress = '1';
    addr.textContent = `Adress: ${hash && hash !== '#' ? hash : '(ingen ankare)'}`;
    addr.style.cssText = 'font:12px ui-monospace,Menlo,Consolas,monospace;color:#9bd;margin-bottom:8px;word-break:break-all;';
    panel.appendChild(addr);
    const goldHint = document.createElement('div');
    goldHint.dataset.devGoldFactor = '1';
    goldHint.textContent = `Guldvisning: visat guld = simulerat guld x ${GOLD_DISPLAY_FACTOR} (bara texten; GOLD_DISPLAY_FACTOR i src/ui/uiConfig.ts)`;
    goldHint.style.cssText = 'font:12px system-ui,sans-serif;color:#9bd;margin-bottom:8px;';
    panel.appendChild(goldHint);
    const itemStyle =
      'display:block;box-sizing:border-box;width:100%;min-height:44px;margin:0 0 6px 0;padding:8px 10px;text-align:left;border-radius:6px;' +
      'border:1px solid #3a5a9a;background:#16294a;color:#e8f0ff;font:14px system-ui,sans-serif;cursor:pointer;text-decoration:none;';
    for (const mode of devModes()) {
      const active = modeActive(mode, raw);
      if (mode.field !== undefined) {
        const field = mode.field;
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:6px;margin:0 0 6px 0;align-items:center;';
        const label = document.createElement('label');
        label.htmlFor = mode.id;
        label.textContent = mode.label;
        label.style.cssText = 'flex:0 0 auto;min-width:48px;';
        const input = document.createElement('input');
        input.type = 'text';
        input.id = mode.id;
        input.inputMode = 'numeric';
        input.autocomplete = 'off';
        input.dataset.devField = mode.id;
        input.placeholder = field.placeholder ?? '';
        input.value = raw[field.param] ?? '';
        input.style.cssText = 'flex:1 1 auto;min-width:0;min-height:44px;box-sizing:border-box;padding:0 8px;border-radius:6px;border:1px solid #3a5a9a;background:#0d1a30;color:#e8f0ff;font:14px ui-monospace,Menlo,Consolas,monospace;';
        const go = document.createElement('button');
        go.type = 'button';
        go.dataset.devFieldGo = mode.id;
        go.textContent = 'Starta';
        go.style.cssText = 'flex:0 0 auto;min-height:44px;padding:0 12px;border-radius:6px;border:1px solid #3a5a9a;background:#16294a;color:#e8f0ff;font:14px system-ui,sans-serif;cursor:pointer;';
        const submit = (): void => {
          const value = input.value.trim();
          if (!field.pattern.test(value)) {
            input.style.borderColor = '#e07070';
            return;
          }
          navigate(hashAfterMode({ id: mode.id, label: mode.label, params: { [field.param]: value } }, window.location.hash, raw));
        };
        go.addEventListener('click', submit);
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') submit();
        });
        row.append(label, input, go);
        panel.appendChild(row);
        continue;
      }
      if (mode.href !== undefined) {
        const a = document.createElement('a');
        a.href = siteUrl(mode.href.replace(/^\.\//, ''));
        a.textContent = mode.label;
        a.dataset.devMode = mode.id;
        a.style.cssText = itemStyle + 'line-height:28px;';
        panel.appendChild(a);
        continue;
      }
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.devMode = mode.id;
      b.dataset.active = active ? '1' : '0';
      const hint = mode.params ? `  #${toHash(mode.params)}` : '';
      b.textContent = `${active ? '● ' : ''}${mode.label}${hint}`;
      b.style.cssText = itemStyle + (active ? 'border-color:#7fd1ff;' : '');
      b.addEventListener('click', () => {
        if (mode.run) mode.run();
        else navigate(hashAfterMode(mode, window.location.hash, raw));
      });
      panel.appendChild(b);
    }
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.dataset.devMode = 'clear';
    clear.textContent = 'Rensa läge (tom adress)';
    clear.style.cssText = itemStyle;
    clear.addEventListener('click', () => navigate(''));
    panel.appendChild(clear);
  };

  // Other overlays (the perf overlay) listen to this and step aside when the open panel would cover them.
  const announce = (open: boolean): void => {
    const rect = open ? panel.getBoundingClientRect() : null;
    const detail: DevPanelEventDetail = { open, rect: rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } : null };
    window.dispatchEvent(new CustomEvent(DEV_PANEL_EVENT, { detail }));
  };
  const open = (): void => {
    refresh();
    panel.hidden = false;
    announce(true);
  };
  const close = (): void => {
    const wasOpen = !panel.hidden;
    panel.hidden = true;
    if (wasOpen) announce(false);
  };
  const toggle = (): void => (panel.hidden ? open() : close());
  button.addEventListener('click', toggle);
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'F2') {
      e.preventDefault();
      toggle();
    } else if (e.key === 'Escape' && !panel.hidden) {
      e.preventDefault(); // this Escape was the panel's: a screen behind it (the setup) must not also react
      close();
    }
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener(DEV_PANEL_REQUEST_EVENT, toggle);

  return {
    button,
    panel,
    isOpen: () => !panel.hidden,
    open,
    close,
    toggle,
    setButtonVisible(visible: boolean): void {
      button.hidden = !visible;
    },
    refresh: () => {
      if (!panel.hidden) refresh();
    },
    dispose(): void {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(DEV_PANEL_REQUEST_EVENT, toggle);
      close();
      button.remove();
      panel.remove();
    },
  };
}
