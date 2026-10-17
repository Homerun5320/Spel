// Client entry. Builds the DOM from JS (index.html stays a bare fragment with no attributes on <html>/<body>), starts the
// scene chosen by the address (query and hash through the one parser in params.ts), mounts the Dev panel and restarts the
// scene when the hash changes (no page reload needed).
import type { Spike, SpikeInfo } from '../render/spike';
import type { DevPanel } from './devpanel';
import { createDevStandIn, devLoadError, loadDevPanelModules } from './debugLoad';
import { bootGlobe, type GlobeTestHooks } from './globeApp';
import { attachHotkeys, registerPageHotkeys } from './hotkeys';
import { DEV_PANEL_REQUEST_EVENT } from '../ui/events';
import { parseAppState, parseRaw } from './params';
import { siteUrl } from './paths';
import { t } from '../ui/i18n';

export interface TestHooks {
  /** Render one frame synchronously with the fixed test-view sun. */
  render(): void;
  /** Renderer facts: GL renderer string, draw calls, triangles, textures, size, DPR, first-frame time. */
  info(): TestInfo;
}

export interface TestInfo extends SpikeInfo {
  /** ms from page start (performance.now) to the end of the first render call; null before it. */
  firstFrameMs: number | null;
  frames: number;
  testMode: boolean;
}

declare global {
  interface Window {
    /** The spike scene defines render/info; the globe scene (the default since M02) adds the rest (see globeApp.ts). */
    __test?: TestHooks & Partial<Omit<GlobeTestHooks, 'render' | 'info'>>;
  }
}

/** Stops the running scene and removes its DOM. */
type Stop = () => void;

function showSceneError(wrapper: HTMLElement, err: unknown): void {
  console.error(err);
  const msg = document.createElement('div');
  msg.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#f99;font:14px system-ui,sans-serif;';
  msg.textContent = t('app.error', { message: err instanceof Error ? err.message : String(err) });
  wrapper.appendChild(msg);
}

function startScene(root: HTMLElement): Stop {
  const state = parseAppState(window.location.search, window.location.hash);
  const { params, scene } = state;
  const stops: Stop[] = [];
  let stopped = false;
  const stop: Stop = () => {
    if (stopped) return;
    stopped = true;
    for (const fn of stops.reverse()) fn();
  };

  // Classes and language go on our own wrapper, never on <html> or <body>.
  const wrapper = document.createElement('div');
  wrapper.className = 'app';
  wrapper.lang = 'sv';
  wrapper.style.cssText = 'position:fixed;inset:0;margin:0;background:#000;overflow:hidden;';
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;';
  wrapper.appendChild(canvas);
  const overlay = document.createElement('pre');
  overlay.style.cssText =
    'position:absolute;left:8px;top:8px;margin:0;padding:6px 8px;background:rgba(0,0,0,0.7);color:#cfe;' +
    'font:12px/1.4 ui-monospace,Menlo,Consolas,monospace;white-space:pre;pointer-events:none;max-width:calc(100vw - 88px);overflow:hidden;';
  // Hidden by default (the first thing the player sees is the start screen, D98); F3 toggles it.
  overlay.hidden = true;
  wrapper.appendChild(overlay);
  root.appendChild(wrapper);
  stops.push(() => {
    delete window.__test;
    wrapper.remove();
  });

  // Link to the preview probe page (declared in index.html). Hidden in test mode so the golden is unaffected.
  const probeLink = document.getElementById('probe-link');
  if (probeLink instanceof HTMLAnchorElement) {
    probeLink.href = siteUrl('probe.html');
    probeLink.style.cssText =
      'position:fixed;right:8px;bottom:8px;z-index:10;padding:4px 8px;border-radius:4px;' +
      'background:rgba(0,0,0,0.6);color:#9cf;font:12px/1.4 system-ui,sans-serif;text-decoration:none;';
    probeLink.hidden = params.test;
  }

  // Link row to the data maps (M01); the Dev panel (M02) lists the same page. Hidden in test mode like the probe link.
  const debugLinks = document.getElementById('debug-links');
  if (debugLinks instanceof HTMLElement) {
    debugLinks.style.cssText =
      'position:fixed;left:8px;bottom:8px;z-index:10;padding:4px 8px;border-radius:4px;' +
      'background:rgba(0,0,0,0.6);color:#cde;font:12px/1.4 system-ui,sans-serif;';
    for (const a of Array.from(debugLinks.querySelectorAll('a'))) {
      const hash = a.getAttribute('href')?.split('#')[1] ?? '';
      a.href = siteUrl(`debug/data.html${hash ? `#${hash}` : ''}`);
      a.style.color = '#9cf';
    }
    debugLinks.hidden = params.test;
  }

  // M02: the stylised Earth is the default scene; `?scene=spike` / `#scene-spike` keeps the M00 spike (its golden and seed test).
  if (scene.scene !== 'spike') {
    bootGlobe({ wrapper, canvas, overlay, params, scene, state, isActive: () => !stopped })
      .then((stopGlobe) => {
        if (stopped) stopGlobe();
        else stops.push(stopGlobe);
      })
      .catch((err: unknown) => showSceneError(wrapper, err));
    return stop;
  }

  // The M00 spike is a dev scene: its module (and three's spike scene) loads only for `?scene=spike`.
  startSpike().catch((err: unknown) => showSceneError(wrapper, err));
  return stop;

  async function startSpike(): Promise<void> {
    const { createSpike, TEST_SUN_LAT_DEG, TEST_SUN_LON_DEG } = await import('../render/spike').catch((err: unknown) => {
      throw devLoadError('spiken', err);
    });
    if (stopped) return;
    const dpr = params.test ? 1 : Math.min(window.devicePixelRatio || 1, 2);
    const width = params.test ? params.width : window.innerWidth;
    const height = params.test ? params.height : window.innerHeight;
    if (params.test) {
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    } else {
      canvas.style.width = '100%';
      canvas.style.height = '100%';
    }

    const spike: Spike = createSpike({
      canvas,
      width,
      height,
      dpr,
      antialias: !params.test,
      preserveDrawingBuffer: params.test,
      seed: params.seed,
      blank: params.blank,
    });
    stops.push(() => spike.dispose());

    let firstFrameMs: number | null = null;
    let frames = 0;
    const renderFrame = (lon: number, lat: number): void => {
      spike.render(lon, lat);
      frames++;
      if (firstFrameMs === null) firstFrameMs = performance.now();
    };

    let fps = 0;
    const refreshOverlay = (): void => {
      const i = spike.info();
      overlay.textContent = [
        `GL renderer: ${i.renderer}`,
        `GL version:  ${i.glVersion}`,
        `fps: ${fps.toFixed(1)}`,
        `draw calls: ${i.drawCalls}  triangles: ${i.triangles}  textures: ${i.textures}`,
        `${i.width}x${i.height} @${i.dpr}x`,
      ].join('\n');
    };

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'F3') {
        e.preventDefault();
        overlay.hidden = !overlay.hidden;
        if (!overlay.hidden) refreshOverlay();
      }
    };
    window.addEventListener('keydown', onKey);
    stops.push(() => window.removeEventListener('keydown', onKey));

    if (params.test) {
      window.__test = {
        render(): void {
          renderFrame(TEST_SUN_LON_DEG, TEST_SUN_LAT_DEG);
          if (!overlay.hidden) refreshOverlay();
        },
        info(): TestInfo {
          return { ...spike.info(), firstFrameMs, frames, testMode: true };
        },
      };
      return; // deterministic mode: no requestAnimationFrame loop
    }

    const onResize = (): void => spike.resize(window.innerWidth, window.innerHeight, Math.min(window.devicePixelRatio || 1, 2));
    window.addEventListener('resize', onResize);
    stops.push(() => window.removeEventListener('resize', onResize));
    let last = performance.now();
    let raf = 0;
    const loop = (now: number): void => {
      if (stopped) return;
      const dt = now - last;
      last = now;
      if (dt > 0) fps = fps * 0.9 + (1000 / dt) * 0.1;
      // The sun drifts 12 degrees of longitude per second.
      renderFrame(TEST_SUN_LON_DEG + (now / 1000) * 12, TEST_SUN_LAT_DEG);
      if (!overlay.hidden) refreshOverlay();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    stops.push(() => cancelAnimationFrame(raf));
  }
}

/** True when the address asks for a dev tool (`?perf`, `?scene`, `?dev`, in the query or the hash) or the match is the test mode: the panel is then loaded at once. */
function wantsDevTools(): boolean {
  const raw = parseRaw(window.location.search, window.location.hash);
  return raw.test === '1' || raw.perf === '1' || raw.scene !== undefined || raw.dev !== undefined;
}

function boot(): void {
  const root = document.getElementById('root');
  if (!root) throw new Error('missing #root');
  registerPageHotkeys(); // F2 (all scenes); the match scene adds its own entries (M20a-lite)
  attachHotkeys(window);

  // The Dev panel (and the mode list with its Swedish labels) is a separate chunk (Bundle-diet-1). Until it is loaded a plain stand-in button with the same
  // attributes sits in the corner; F2 (DEV_PANEL_REQUEST_EVENT) and a click on it load the panel and open it. Test mode and the dev addresses load it at once.
  let panel: DevPanel | null = null;
  let loading: Promise<DevPanel> | null = null;
  let buttonVisible = false;
  const standIn = createDevStandIn();
  root.appendChild(standIn);
  const loadPanel = (): Promise<DevPanel> => {
    loading ??= loadDevPanelModules().then(({ panel: mod, modes }) => {
      modes.registerAppModes();
      standIn.remove();
      const p = mod.mountDevPanel({ parent: root, getRaw: () => parseRaw(window.location.search, window.location.hash) });
      p.setButtonVisible(buttonVisible);
      panel = p;
      return p;
    });
    return loading;
  };
  const openLazily = (): void => {
    if (panel !== null) return; // the mounted panel answers the request itself
    loadPanel().then((p) => p.open(), (err: unknown) => {
      loading = null;
      console.error(err);
      standIn.textContent = 'Dev: fel';
      standIn.title = err instanceof Error ? err.message : String(err);
      window.alert(standIn.title);
    });
  };
  standIn.addEventListener('click', openLazily);
  window.addEventListener(DEV_PANEL_REQUEST_EVENT, openLazily);

  let stop: Stop | null = null;
  const restart = (): void => {
    stop?.();
    stop = startScene(root);
    const state = parseAppState(window.location.search, window.location.hash);
    // The corner button is visible everywhere (phones have no F2), except in test mode where screenshots must stay clean.
    buttonVisible = !state.params.test || state.devButton;
    standIn.hidden = !buttonVisible;
    panel?.setButtonVisible(buttonVisible);
    panel?.refresh();
  };
  const first = (): void => {
    restart();
    // A changed hash starts the mode again without a page reload.
    window.addEventListener('hashchange', restart);
  };
  if (wantsDevTools()) {
    // The test hooks and the dev scenes expect the panel (and its modes) from the first frame on; a failed import is shown, then the page starts without it.
    loadPanel().then(first, (err: unknown) => {
      console.error(err);
      first();
      const wrapper = root.querySelector('.app');
      if (wrapper instanceof HTMLElement) showSceneError(wrapper, err);
    });
  } else {
    first();
    // Not part of the first load: the panel chunks (about 3.4 kB gz) are fetched once the page is idle, so that F2 and the Dev button answer at once afterwards.
    // Until then the stand-in button and the request listener load them on demand. A failure here is silent: the click or F2 retries and shows the error.
    const idle = (fn: () => void): void => {
      if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(fn, { timeout: 2000 });
      else window.setTimeout(fn, 500);
    };
    idle(() => {
      loadPanel().catch(() => {
        loading = null;
      });
    });
  }
}

boot();
