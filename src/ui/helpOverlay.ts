// The help overlay (M20a-lite): a small box listing the shortcuts, GENERATED from the hotkey registry (`src/app/hotkeys.ts`): the page passes a function that
// returns the listed entries, so a key that is registered but missing here (or the other way round) cannot exist (`tests/ui/helpOverlay.test.ts`). The overlay
// has no key listener of its own: `?` is a registry entry and Escape pops the input mode the page pushes while the overlay is open. Rows are rebuilt when it
// opens and when the language changed, never per frame.
import { languageVersion, t, type TextKey } from './i18n';

/** The part of a registry entry the overlay needs. */
export interface HelpEntry {
  readonly id: string;
  readonly keys: readonly string[];
  readonly labelKey: TextKey;
}

export interface HelpOverlay {
  readonly root: HTMLElement;
  isOpen(): boolean;
  open(): void;
  close(): void;
  dispose(): void;
}

/** "1 2 3 4 5 6" prints as "1-6"; a letter in capitals; the space bar spelt out; alternatives joined by " / ". */
export function keysText(keys: readonly string[]): string {
  const digits = keys.length > 2 && keys.every((k) => k.length === 1 && k >= '0' && k <= '9') && keys.every((k, i) => i === 0 || k.charCodeAt(0) === (keys[i - 1] as string).charCodeAt(0) + 1);
  if (digits) return `${keys[0]}-${keys[keys.length - 1]}`;
  const shown: string[] = [];
  for (const k of keys) {
    if (k === 'Spacebar') continue; // the old name of the space bar: one caption is enough
    shown.push(k === ' ' ? t('hotkey.key.space') : k.length === 1 ? k.toUpperCase() : k);
  }
  return shown.join(' / ');
}

function div(className: string, testid?: string): HTMLElement {
  const e = document.createElement('div');
  e.className = className;
  if (testid !== undefined) e.dataset.testid = testid;
  return e;
}

export function createHelpOverlay(parent: HTMLElement, entries: () => readonly HelpEntry[]): HelpOverlay {
  const root = div('help-overlay', 'help-overlay');
  root.hidden = true;
  const card = div('help-card');
  card.setAttribute('role', 'dialog');
  const title = div('help-title', 'help-title');
  const list = div('help-list');
  const hint = div('help-hint', 'help-hint');
  card.append(title, list, hint);
  root.append(card);
  for (const type of ['pointerdown', 'pointerup', 'wheel', 'contextmenu']) root.addEventListener(type, (e) => e.stopPropagation());
  parent.append(root);
  let builtFor = -1;
  const build = (): void => {
    title.textContent = t('help.title');
    hint.textContent = t('help.hint');
    card.setAttribute('aria-label', t('help.title'));
    list.replaceChildren();
    for (const e of entries()) {
      const row = div('help-row', 'help-row');
      row.dataset.id = e.id;
      const keys = document.createElement('kbd');
      keys.className = 'help-keys';
      keys.textContent = keysText(e.keys);
      const label = document.createElement('span');
      label.textContent = t(e.labelKey);
      row.append(keys, label);
      list.append(row);
    }
    builtFor = languageVersion();
  };
  return {
    root,
    isOpen: () => !root.hidden,
    open(): void {
      if (!root.hidden && builtFor === languageVersion()) return;
      build();
      root.hidden = false;
    },
    close(): void {
      root.hidden = true;
    },
    dispose(): void {
      root.remove();
    },
  };
}
