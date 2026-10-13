// Client entry (M00 spike). Builds the DOM from JS (index.html stays a bare fragment with no
// attributes on <html>/<body>), starts the spike renderer and exposes the test hooks.
import { createSpike, TEST_SUN_LAT_DEG, TEST_SUN_LON_DEG, type Spike, type SpikeInfo } from '../render/spike';
import { parseParams } from './params';
import { siteUrl } from './paths';

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
    __test?: TestHooks;
  }
}

function boot(): void {
  const params = parseParams(window.location.search);
  const root = document.getElementById('root');
  if (!root) throw new Error('missing #root');

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
    'font:12px/1.4 ui-monospace,Menlo,Consolas,monospace;white-space:pre;pointer-events:none;';
  // Hidden by default in test mode; F3 toggles it.
  overlay.hidden = params.test;
  wrapper.appendChild(overlay);
  root.appendChild(wrapper);

  // Link to the preview probe page (declared in index.html). Hidden in test mode so the golden is unaffected.
  const probeLink = document.getElementById('probe-link');
  if (probeLink instanceof HTMLAnchorElement) {
    probeLink.href = siteUrl('probe.html');
    probeLink.style.cssText =
      'position:fixed;right:8px;bottom:8px;z-index:10;padding:4px 8px;border-radius:4px;' +
      'background:rgba(0,0,0,0.6);color:#9cf;font:12px/1.4 system-ui,sans-serif;text-decoration:none;';
    probeLink.hidden = params.test;
  }

  // Link row to the data maps (M01); the Dev panel (M02) takes over later. Hidden in test mode like the probe link.
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

  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'F3') {
      e.preventDefault();
      overlay.hidden = !overlay.hidden;
      if (!overlay.hidden) refreshOverlay();
    }
  });

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

  window.addEventListener('resize', () => {
    spike.resize(window.innerWidth, window.innerHeight, Math.min(window.devicePixelRatio || 1, 2));
  });
  let last = performance.now();
  const loop = (now: number): void => {
    const dt = now - last;
    last = now;
    if (dt > 0) fps = fps * 0.9 + (1000 / dt) * 0.1;
    // The sun drifts 12 degrees of longitude per second.
    renderFrame(TEST_SUN_LON_DEG + (now / 1000) * 12, TEST_SUN_LAT_DEG);
    if (!overlay.hidden) refreshOverlay();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

boot();
