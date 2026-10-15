// The graphics tip of the start screen (AutoTier-1): a small closable box that says honestly what the game chose on a weak graphics card.
// It sits inside the start card (so it never covers the card), lets every click outside its own Close button pass through, and its texts
// go through t(). The caller decides whether to show it (integrated / software class, not in test mode unless a test hook forces it).
import { onLanguageChange, t } from './i18n';

export interface GpuTip {
  readonly element: HTMLElement;
  dispose(): void;
}

/** `name` is the readable card name (`readableGpuName`); `onClose` is called once when the player closes the box. */
export function createGpuTip(name: string, onClose: () => void): GpuTip {
  const box = document.createElement('div');
  box.className = 'gpu-tip';
  box.dataset.testid = 'gpu-tip';
  box.setAttribute('role', 'note');
  const lines = [document.createElement('p'), document.createElement('p'), document.createElement('p')];
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'gpu-tip-close';
  close.dataset.testid = 'gpu-tip-close';
  const body = document.createElement('div');
  body.className = 'gpu-tip-body';
  // Polish-1: one line and a "More" disclosure, so the start card with the tip never needs scrolling to reach Play on a low window.
  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'gpu-tip-more';
  more.dataset.testid = 'gpu-tip-more';
  const extra = document.createElement('div');
  extra.className = 'gpu-tip-extra';
  extra.dataset.testid = 'gpu-tip-extra';
  extra.hidden = true;
  extra.append(lines[1] as HTMLElement, lines[2] as HTMLElement);
  body.append(lines[0] as HTMLElement, extra);
  const actions = document.createElement('div');
  actions.className = 'gpu-tip-actions';
  actions.append(more, close);
  box.append(body, actions);
  const render = (): void => {
    (lines[0] as HTMLElement).textContent = t('start.gpuChosen', { name: name === '' ? t('start.gpuNameFallback') : name });
    (lines[1] as HTMLElement).textContent = t('start.gpuBetter');
    (lines[2] as HTMLElement).textContent = t('start.gpuSeparate');
    more.textContent = extra.hidden ? t('start.gpuMore') : t('start.gpuLess');
    more.setAttribute('aria-expanded', extra.hidden ? 'false' : 'true');
    close.textContent = t('start.gpuClose');
    close.setAttribute('aria-label', t('start.gpuCloseAria'));
  };
  render();
  const stopLang = onLanguageChange(render);
  more.addEventListener('click', () => {
    extra.hidden = !extra.hidden;
    more.blur();
    render();
  });
  close.addEventListener('click', () => {
    close.blur();
    box.remove();
    onClose();
  });
  return {
    element: box,
    dispose(): void {
      stopLang();
      box.remove();
    },
  };
}
