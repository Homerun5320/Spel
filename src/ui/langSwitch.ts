// Switching the language from a button (Bundle-diet-2): the other table may still have to load, so the button shows a short busy state until it is
// there, and a failed load is told to the player in the language that IS loaded (never silently). When the table is already loaded the switch is
// immediate and synchronous, as before.
import { LANGUAGE_NAMES, getLanguage, isLanguageLoaded, switchLanguage, t, type Lang } from './i18n';
import { LANG_NOTICE } from './uiConfig';

/** A transient notice in the current language: the table of `failed` could not be loaded. */
export function notifyLanguageError(host: HTMLElement, failed: Lang): void {
  const box = document.createElement('div');
  box.setAttribute('role', 'alert');
  box.dataset.langError = failed;
  box.style.cssText = `position:absolute;left:50%;top:12px;transform:translateX(-50%);z-index:50;max-width:min(90vw,520px);padding:8px 12px;border-radius:6px;background:${LANG_NOTICE.background};color:${LANG_NOTICE.color};font:${LANG_NOTICE.font};pointer-events:none;`;
  box.textContent = t('app.langError', { lang: LANGUAGE_NAMES[getLanguage()] });
  host.appendChild(box);
  setTimeout(() => box.remove(), LANG_NOTICE.showMs);
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
