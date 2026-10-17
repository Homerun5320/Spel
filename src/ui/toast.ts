// Toasts (M10): short messages over the game, `showToast(key, params?, kind)` with a text KEY (tests check the key in `data-key`, never the text).
// At most `TOAST_MAX_VISIBLE` are on screen: a new one pushes the oldest out (this is the only cap; later milestones reuse the function and do not
// change it). A toast with the key of one that is still showing renews that one instead of stacking a copy. Time is the fx clock: `tickToasts(fxNow())`
// is called once per frame by the page, so a paused or test-mode clock keeps a toast on screen. No CSS animation (tests/fxClock.test.ts).
import { fxNow } from '../render/clock';
import { t, type TextKey, type TextParams } from './i18n';
import { TOAST_MAX_VISIBLE, TOAST_SECONDS } from './uiConfig';

export type ToastKind = 'info' | 'warn' | 'error';

interface Shown {
  readonly key: TextKey;
  readonly el: HTMLElement;
  until: number;
}

let box: HTMLElement | null = null;
let shown: Shown[] = [];

/** Creates the toast stack inside `parent` (the page's wrapper). Returns the function that removes it. */
export function mountToasts(parent: HTMLElement): () => void {
  unmountToasts();
  const el = document.createElement('div');
  el.className = 'toast-stack';
  el.dataset.testid = 'toasts';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  parent.appendChild(el);
  box = el;
  return unmountToasts;
}

function unmountToasts(): void {
  box?.remove();
  box = null;
  shown = [];
}

/** Shows a toast now (fx time). Without a mounted stack it does nothing. */
export function showToast(key: TextKey, params?: TextParams, kind: ToastKind = 'info'): void {
  if (box === null) return;
  const now = fxNow();
  const text = t(key, params);
  const same = shown.find((s) => s.key === key);
  if (same !== undefined) {
    same.until = now + TOAST_SECONDS;
    same.el.textContent = text;
    return;
  }
  const el = document.createElement('div');
  el.className = 'toast';
  el.dataset.testid = 'toast';
  el.dataset.key = key;
  el.dataset.kind = kind;
  el.textContent = text;
  box.appendChild(el);
  shown.push({ key, el, until: now + TOAST_SECONDS });
  while (shown.length > TOAST_MAX_VISIBLE) (shown.shift() as Shown).el.remove();
}

/** Once per frame with the fx time: removes the toasts whose time is up. */
export function tickToasts(now: number): void {
  if (shown.length === 0) return;
  const keep: Shown[] = [];
  for (const s of shown) {
    if (now >= s.until) s.el.remove();
    else keep.push(s);
  }
  shown = keep;
}

/** The keys on screen, oldest first (tests). */
export function visibleToastKeys(): TextKey[] {
  return shown.map((s) => s.key);
}
