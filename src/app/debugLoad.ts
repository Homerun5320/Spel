// Dev and diagnostic modules load on demand (Bundle-diet-1, step 2): the Dev panel and its mode list, the perf overlay, the performance scene and the
// report window. A normal player never loads them; `?perf`, `?scene=perf`, `?test=1` and the F2 key / Dev button do. Developer tools are Swedish only (D98).

/** The error of a dev module that did not load, in Swedish; the caller shows or throws it (never silent). */
export function devLoadError(what: string, err: unknown): Error {
  return new Error(`Dev-verktyget "${what}" kunde inte laddas (${err instanceof Error ? err.message : String(err)}). Ladda om sidan.`);
}

/** Loads the perf overlay and the performance scene together. */
export async function loadPerfModules(): Promise<{ overlay: typeof import('../ui/perfOverlay'); scene: typeof import('./perfScene') }> {
  try {
    const [overlay, scene] = await Promise.all([import('../ui/perfOverlay'), import('./perfScene')]);
    return { overlay, scene };
  } catch (err) {
    throw devLoadError('prestandaöverlägget', err);
  }
}

/** Loads the Dev panel and the registered modes (modes.ts holds the Swedish mode labels). */
export async function loadDevPanelModules(): Promise<{ panel: typeof import('./devpanel'); modes: typeof import('./modes') }> {
  try {
    const [panel, modes] = await Promise.all([import('./devpanel'), import('./modes')]);
    return { panel, modes };
  } catch (err) {
    throw devLoadError('Dev-panelen', err);
  }
}

const DEV_BUTTON_STYLE =
  'position:fixed;right:8px;top:8px;z-index:40;min-width:48px;min-height:48px;padding:0 10px;border-radius:24px;border:1px solid #3a5a9a;' +
  'background:rgba(14,22,38,0.82);color:#cfe3ff;font:600 13px system-ui,sans-serif;cursor:pointer;touch-action:manipulation;';

/** The plain button that stands in for the Dev panel's own corner button until the panel chunk is loaded (same attributes; hidden until the caller shows it). */
export function createDevStandIn(): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = 'Dev';
  b.setAttribute('aria-label', 'Öppna Dev-panelen (F2)');
  b.dataset.devButton = '1';
  b.style.cssText = DEV_BUTTON_STYLE;
  b.hidden = true;
  return b;
}
