// Switching the language from a button (Bundle-diet-2): the other table may still have to load, so the button shows a short busy state until it is
// there, and a failed load is told to the player in the language that IS loaded (never silently). When the table is already loaded the switch is
// immediate and synchronous, as before.
import { LANGUAGE_NAMES, getLanguage, isLanguageLoaded, switchLanguage, t, type Lang } from './i18n';
import { LANG_NOTICE } from './uiConfig';

/**
 * Fix-6B: puts a notice (gone at the next click, never two at once) where it covers nothing. On the start page it goes INTO the start card, under the tagline (it
 * used to sit over the title); elsewhere (the setup header) it stays a floating box at the top.
 */
function placeNotice(host: HTMLElement, box: HTMLElement): void {
  for (const old of host.querySelectorAll('[data-app-notice]')) old.remove();
  box.setAttribute('role', 'alert');
  box.dataset.appNotice = '1';
  const base = `max-width:min(90vw,520px);padding:8px 12px;border-radius:6px;background:${LANG_NOTICE.background};color:${LANG_NOTICE.color};font:${LANG_NOTICE.font};pointer-events:none;`;
  const tagline = host.querySelector<HTMLElement>('.start-card .start-tagline');
  if (tagline !== null && tagline.getClientRects().length > 0) {
    box.style.cssText = `${base}box-sizing:border-box;width:100%;max-width:100%;text-align:center;`;
    tagline.after(box);
  } else {
    box.style.cssText = `${base}position:absolute;left:50%;top:12px;transform:translateX(-50%);z-index:50;`;
    host.appendChild(box);
  }
  window.addEventListener('pointerdown', () => box.remove(), { once: true }); // stays until the next click (no timer: cosmetic time goes through the fx clock)
}

/** A notice (gone at the next click) in the current language: the table of `failed` could not be loaded. */
export function notifyLanguageError(host: HTMLElement, failed: Lang): void {
  const box = document.createElement('div');
  box.dataset.langError = failed;
  box.textContent = t('app.langError', { lang: LANGUAGE_NAMES[getLanguage()] });
  placeNotice(host, box);
}

/** Fix-6B: the sim host or the AI chunk could not be fetched when Play / Start was pressed: say so (the button stays usable, the text tells the player to reload). */
export function notifyMatchLoadError(host: HTMLElement): void {
  const box = document.createElement('div');
  box.dataset.matchLoadError = '1';
  box.textContent = t('app.matchLoadError');
  placeNotice(host, box);
}

/** The click handler body of a language button: toggles sv <-> en, waiting for the table when it is not loaded yet. */
export function toggleLanguage(button: HTMLButtonElement): void {
  const next: Lang = getLanguage() === 'sv' ? 'en' : 'sv';
  const wait = !isLanguageLoaded(next);
  if (wait) {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.style.opacity = String(LANG_NOTICE.busyOpacity);
  }
  switchLanguage(next)
    .catch((err: unknown) => {
      console.error(err);
      notifyLanguageError(button.closest<HTMLElement>('.app') ?? document.body, next);
    })
    .finally(() => {
      if (!wait) return;
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.style.opacity = '';
    });
}
