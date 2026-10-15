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
  body.append(...lines);
  box.append(body, close);
  const render = (): void => {
    (lines[0] as HTMLElement).textContent = t('start.gpuChosen', { name: name === '' ? t('start.gpuNameFallback') : name });
    (lines[1] as HTMLElement).textContent = t('start.gpuBetter');
    (lines[2] as HTMLElement).textContent = t('start.gpuSeparate');
    close.textContent = t('start.gpuClose');
    close.setAttribute('aria-label', t('start.gpuCloseAria'));
  };
  render();
  const stopLang = onLanguageChange(render);
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
