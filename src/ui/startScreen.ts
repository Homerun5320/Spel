// TEMPORARY start screen of M05 part A (Part B replaces it with the real one: Play button, small Dev button, i18n). It is the
// entry point of a match in the normal page: a full-screen panel with one Play button. `?test=1` never shows it.
import { Z_START_SCREEN } from './uiConfig';

export interface StartScreen {
  dispose(): void;
}

export function mountStartScreen(parent: HTMLElement, onPlay: () => void): StartScreen {
  const root = document.createElement('div');
  root.dataset.testid = 'start-screen';
  root.style.cssText = `position:absolute;inset:0;z-index:${Z_START_SCREEN};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;background:rgba(4,8,16,0.55);color:#e8f0ff;font:16px system-ui,sans-serif;`;
  const title = document.createElement('div');
  title.style.cssText = 'font:700 34px system-ui,sans-serif;';
  title.textContent = 'Erövra jorden';
  const play = document.createElement('button');
  play.type = 'button';
  play.dataset.testid = 'play';
  play.textContent = 'Spela';
  play.style.cssText = 'min-width:160px;min-height:52px;padding:0 24px;border-radius:26px;border:1px solid #7fd1ff;background:#16406e;color:#fff;font:700 18px system-ui,sans-serif;cursor:pointer;';
  play.addEventListener('click', onPlay);
  root.append(title, play);
  parent.appendChild(root);
  return { dispose: () => root.remove() };
}
