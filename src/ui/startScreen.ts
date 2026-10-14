// The start screen (M05 part B): the first thing the player sees. A card over the slowly turning globe with the title, a large
// Play button, the controls in five lines, a language switch and a small Dev button. `?test=1` never shows it. Every text goes
// through t(); a language switch rebuilds the texts at once. Play shows "loading" on the button until the match exists.
import { DEV_PANEL_REQUEST_EVENT } from './events';
import { mountHudStyle } from './hudStyle';
import { getLanguage, onLanguageChange, setLanguage, t, type TextKey } from './i18n';

export interface StartScreen {
  /** The Play button, for the caller that wants to focus or probe it. */
  readonly playButton: HTMLButtonElement;
  /** The button that opens the setup screen (null when the page offers none). */
  readonly setupButton: HTMLButtonElement | null;
  /** Hides or shows the whole screen (the setup screen takes its place while it is open). */
  setHidden(hidden: boolean): void;
  dispose(): void;
}

export interface StartScreenOptions {
  /** Called when the Dev button is pressed. The default asks the Dev panel to open (an event on `window`). */
  onDev?: () => void;
  /** Called when the setup button is pressed (M06: choose a real country or make up a nation); without it the button is not shown. */
  onSetup?: () => void;
}

const HELP_KEYS: readonly TextKey[] = ['help.click', 'help.drag', 'help.commit', 'help.speed', 'help.dev'];

/**
 * Mounts the start screen into `parent`. `onPlay` may return a promise: the button is disabled and says "loading" until it
 * settles (a rejected promise re-enables the button and is rethrown to the console).
 */
export function mountStartScreen(parent: HTMLElement, onPlay: () => void | Promise<void>, options: StartScreenOptions = {}): StartScreen {
  const root = document.createElement('div');
  root.className = 'start-root';
  root.dataset.testid = 'start-screen';
  root.append(mountHudStyle(root));
  const card = document.createElement('div');
  card.className = 'start-card';
  const title = document.createElement('h1');
  title.className = 'start-title';
  title.dataset.testid = 'start-title';
  const tagline = document.createElement('p');
  tagline.className = 'start-tagline';
  const play = document.createElement('button');
  play.type = 'button';
  play.className = 'start-btn start-play';
  play.dataset.testid = 'play';
  const playHint = document.createElement('p');
  playHint.className = 'start-hint';
  playHint.dataset.testid = 'play-hint';
  const playBox = document.createElement('div');
  playBox.className = 'start-choice';
  playBox.append(play, playHint);
  let setup: HTMLButtonElement | null = null;
  let setupHint: HTMLElement | null = null;
  const setupBox = document.createElement('div');
  setupBox.className = 'start-choice';
  if (options.onSetup) {
    setup = document.createElement('button');
    setup.type = 'button';
    setup.className = 'start-btn start-setup';
    setup.dataset.testid = 'start-setup';
    setupHint = document.createElement('p');
    setupHint.className = 'start-hint';
    setupBox.append(setup, setupHint);
  }
  const helpTitle = document.createElement('div');
  helpTitle.className = 'start-help-title';
  const help = document.createElement('ul');
  help.className = 'start-help';
  help.dataset.testid = 'start-help';
  const items = HELP_KEYS.map(() => document.createElement('li'));
  help.append(...items);
  const small = document.createElement('div');
  small.className = 'start-small';
  const lang = document.createElement('button');
  lang.type = 'button';
  lang.className = 'start-btn';
  lang.dataset.testid = 'start-language';
  const dev = document.createElement('button');
  dev.type = 'button';
  dev.className = 'start-btn';
  dev.dataset.testid = 'start-dev';
  small.append(lang, dev);
  card.append(title, tagline, playBox);
  if (setup !== null) card.append(setupBox);
  card.append(helpTitle, help, small);
  root.append(card);
  parent.appendChild(root);

  let busy = false;
  const render = (): void => {
    title.textContent = t('app.title');
    tagline.textContent = t('app.tagline');
    play.textContent = busy ? t('app.loading') : t('start.play');
    playHint.textContent = t('start.playHint');
    if (setup !== null && setupHint !== null) {
      setup.textContent = t('start.setup');
      setupHint.textContent = t('start.setupHint');
    }
    helpTitle.textContent = t('start.helpTitle');
    HELP_KEYS.forEach((k, i) => {
      (items[i] as HTMLElement).textContent = t(k);
    });
    lang.textContent = t('start.language');
    lang.setAttribute('aria-label', t('start.languageAria'));
    dev.textContent = t('start.dev');
    dev.setAttribute('aria-label', t('start.devAria'));
  };
  render();
  const stopLang = onLanguageChange(render);

  play.addEventListener('click', () => {
    if (busy) return;
    busy = true;
    play.disabled = true;
    render();
    Promise.resolve(onPlay()).catch((err: unknown) => {
      busy = false;
      play.disabled = false;
      render();
      console.error(err);
    });
  });
  setup?.addEventListener('click', () => {
    setup?.blur();
    options.onSetup?.();
  });
  lang.addEventListener('click', () => {
    setLanguage(getLanguage() === 'sv' ? 'en' : 'sv');
    lang.blur();
  });
  dev.addEventListener('click', () => {
    dev.blur();
    if (options.onDev) options.onDev();
    else window.dispatchEvent(new CustomEvent(DEV_PANEL_REQUEST_EVENT));
  });
  // Pressing the card keeps the click away from the globe below; the scrim around it does the same.
  for (const type of ['pointerdown', 'pointerup', 'wheel', 'contextmenu']) root.addEventListener(type, (e) => e.stopPropagation());
  play.focus({ preventScroll: true }); // Enter starts the match

  return {
    playButton: play,
    setupButton: setup,
    setHidden(hidden: boolean): void {
      root.hidden = hidden;
    },
    dispose(): void {
      stopLang();
      root.remove();
    },
  };
}
