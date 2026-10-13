// The stylised Earth scene (M02): loads the packs through the data layer, builds the Globe, wires mouse input, hover
// tooltip, the F3 overlay and the `?test=1` hooks. The only code in `src` that drives the fx clock from real frames.
import { createWorldLoader } from '../data';
import { advanceFx, fxNow, setFxTime } from '../render/clock';
import type { ViewState } from '../render/camera';
import { Globe, type GlobeInfo, type GlobePick, type ScreenHit } from '../render/globe';
import type { WorldTextureName } from '../render/textures';
import { DEFAULT_START_TIME, DEFAULT_START_VIEW } from '../render/views';
import { resolveQuality } from '../render/quality';
import type { AppParams, SceneParams } from './params';
import { siteUrl } from './paths';
import { countryNameMap, tooltipText } from './tooltip';

export interface GlobeAppContext {
  wrapper: HTMLElement;
  canvas: HTMLCanvasElement;
  overlay: HTMLPreElement;
  params: AppParams;
  scene: SceneParams;
}

export interface GlobeTestInfo extends GlobeInfo {
  /** ms from page start (performance.now) to the end of the first render call; null before it. */
  firstFrameMs: number | null;
  frames: number;
  testMode: boolean;
  /** Fx clock seconds. */
  fx: number;
}

export interface GlobeTestHooks {
  /** Renders one frame; `dt` (default 0) first steps the fx clock, which also moves camera inertia and the sun. */
  render(dt?: number): void;
  info(): GlobeTestInfo;
  /** Sets the camera (and the fx clock when `time` is given). Does not render. */
  setView(v: Partial<ViewState> & { time?: number }): void;
  /** Screen position of a position on the displaced surface. */
  project(lat: number, lon: number): ScreenHit;
  /** Steps ONLY the fx clock (M05 adds sim ticks). */
  advance(dt: number): void;
  /** Surface pick under a canvas pixel. */
  pick(x: number, y: number): GlobePick | null;
  /** Texels of a data texture as the GPU holds them. */
  readTexels(name: WorldTextureName, points: Array<[number, number]>): number[];
  /** Height exaggeration of shader and picking (0 = flat control). */
  setExaggeration(x: number): void;
  view(): ViewState;
  /** Text of the hover tooltip for a pick, as the page shows it. */
  tooltip(x: number, y: number): string | null;
}

async function readBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function bootGlobe(ctx: GlobeAppContext): Promise<void> {
  const { wrapper, canvas, overlay, params } = ctx;
  const status = document.createElement('div');
  status.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#9bd;font:14px system-ui,sans-serif;pointer-events:none;';
  status.textContent = 'Laddar världen...';
  if (!params.test) wrapper.appendChild(status);

  const loader = createWorldLoader({ manifestUrl: siteUrl('data/manifest.json'), readBytes });
  const [render, sim, meta] = await Promise.all([loader.loadRender(), loader.loadSim(), loader.loadMeta()]);
  status.remove();

  const quality = resolveQuality({ test: params.test, quality: ctx.scene.quality });
  const dpr = params.test ? 1 : Math.min(window.devicePixelRatio || 1, quality.maxDpr);
  const width = params.test ? params.width : window.innerWidth;
  const height = params.test ? params.height : window.innerHeight;
  if (params.test) {
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  } else {
    canvas.style.width = '100%';
    canvas.style.height = '100%';
  }
  canvas.style.touchAction = 'none';

  const globe = new Globe({ canvas, width, height, dpr, quality, world: { render, sim, meta }, preserveDrawingBuffer: params.test });
  globe.setView(DEFAULT_START_VIEW);
  if (params.blank) canvas.style.visibility = 'hidden'; // debug: the negative e2e test needs an empty picture
  setFxTime(DEFAULT_START_TIME); // the sun starts 67 degrees west of the default view so that the terminator is visible at once

  const names = countryNameMap(meta);
  const tip = document.createElement('div');
  tip.style.cssText =
    'position:absolute;left:0;top:0;display:none;padding:3px 8px;border-radius:4px;background:rgba(10,16,28,0.82);color:#e8f0ff;' +
    'font:13px/1.4 system-ui,sans-serif;pointer-events:none;white-space:nowrap;z-index:5;';
  wrapper.appendChild(tip);

  let firstFrameMs: number | null = null;
  let frames = 0;
  const renderFrame = (): void => {
    globe.render();
    frames++;
    if (firstFrameMs === null) firstFrameMs = performance.now();
  };

  // --- Overlay (F3) -----------------------------------------------------------------------------------------------
  let fps = 0;
  const refreshOverlay = (): void => {
    const i = globe.info();
    overlay.textContent = [
      `GL renderer: ${i.renderer}`,
      `GL version:  ${i.glVersion}`,
      `fps: ${fps.toFixed(1)}`,
      `draw calls: ${i.drawCalls}  triangles: ${i.triangles}  textures: ${i.textures}`,
      `${i.width}x${i.height} @${i.dpr}x  tier ${i.tier} (${i.meshCols}x${i.meshRows})`,
    ].join('\n');
  };
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'F3') {
      e.preventDefault();
      overlay.hidden = !overlay.hidden;
      if (!overlay.hidden) refreshOverlay();
    }
  });

  // --- Mouse ------------------------------------------------------------------------------------------------------
  const tipFor = (x: number, y: number): string | null => {
    const p = globe.pick(x, y);
    return p ? tooltipText(p, names) : null;
  };
  const showTip = (x: number, y: number): void => {
    const text = tipFor(x, y);
    if (text === null) {
      tip.style.display = 'none';
      return;
    }
    tip.textContent = text;
    tip.style.display = 'block';
    tip.style.transform = `translate(${Math.min(x + 14, width - 220)}px, ${Math.min(y + 16, height - 30)}px)`;
  };
  let mode: 'none' | 'drag' | 'rotate' = 'none';
  let lastX = 0;
  let lastY = 0;
  const local = (e: MouseEvent): { x: number; y: number } => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e: PointerEvent) => {
    const p = local(e);
    canvas.setPointerCapture(e.pointerId);
    lastX = p.x;
    lastY = p.y;
    tip.style.display = 'none';
    if (e.button === 2 || e.ctrlKey || e.shiftKey) {
      mode = 'rotate';
    } else if (e.button === 0) {
      mode = 'drag';
      globe.rig.dragStart(p.x, p.y, fxNow());
    }
  });
  canvas.addEventListener('pointermove', (e: PointerEvent) => {
    const p = local(e);
    if (mode === 'drag') {
      globe.rig.dragMove(p.x, p.y, fxNow());
    } else if (mode === 'rotate') {
      globe.rig.rotateBy(p.x - lastX, p.y - lastY);
    } else {
      showTip(p.x, p.y);
    }
    lastX = p.x;
    lastY = p.y;
  });
  const release = (e: PointerEvent): void => {
    if (mode === 'drag') globe.rig.dragEnd(fxNow());
    mode = 'none';
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointerleave', () => {
    if (mode === 'none') tip.style.display = 'none';
  });
  canvas.addEventListener(
    'wheel',
    (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e);
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      globe.rig.zoomAt(p.x, p.y, e.deltaY * unit);
    },
    { passive: false },
  );

  // --- Test hooks or the frame loop ---------------------------------------------------------------------------------
  if (params.test) {
    const hooks: GlobeTestHooks = {
      render(dt = 0): void {
        advanceFx(dt);
        renderFrame();
        if (!overlay.hidden) refreshOverlay();
      },
      info(): GlobeTestInfo {
        return { ...globe.info(), firstFrameMs, frames, testMode: true, fx: fxNow() };
      },
      setView(v): void {
        const { time, ...view } = v;
        if (time !== undefined) setFxTime(time);
        globe.setView(view);
      },
      project: (lat, lon) => globe.project(lat, lon),
      advance(dt): void {
        advanceFx(dt);
      },
      pick: (x, y) => globe.pick(x, y),
      readTexels: (name, points) => Array.from(globe.readTexels(name, points)),
      setExaggeration: (x) => globe.setExaggeration(x),
      view: () => globe.rig.view,
      tooltip: tipFor,
    };
    window.__test = hooks;
    return; // deterministic mode: no requestAnimationFrame loop
  }

  window.addEventListener('resize', () => {
    globe.resize(window.innerWidth, window.innerHeight, Math.min(window.devicePixelRatio || 1, quality.maxDpr));
  });
  let last = performance.now();
  const loop = (now: number): void => {
    const dt = (now - last) / 1000;
    last = now;
    if (dt > 0) {
      fps = fps * 0.9 + (1 / dt) * 0.1;
      advanceFx(Math.min(dt, 0.1));
    }
    renderFrame();
    if (!overlay.hidden) refreshOverlay();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
