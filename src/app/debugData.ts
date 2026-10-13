// debug/data.html: draws the baked world as class, height or country map on a canvas (1 pixel per sim cell).
// Mode from `?map=class|height|country` or the anchor `#map-class|height|country`, and from three buttons.
// Loading goes through the manifest (siteUrl) and src/data's loader, so the page proves the packs and their checksums
// in whatever container the build serves (raw .bin.gz, or an Artifact's png / wasm / b64 container).
import { createWorldLoader, type SimGrid, type RenderPack, type WorldMeta } from '../data';
import { CLASS_COLORS, CLASS_LEGEND, MAP_MODES, countryColor, heightColor, parseMapMode, type MapMode } from './debugPalette';
import { siteUrl } from './paths';

export interface DebugDataHooks {
  mode: MapMode;
  /** Load + parse time of the last full load in ms (all packs, meta, checksums verified). */
  loadMs: number;
  timings: unknown[];
  /** Loads everything again `n` times and returns the times in ms. */
  measureLoad(n: number): Promise<number[]>;
  /** Selects a map mode (same as the buttons). */
  setMode(mode: MapMode): void;
}

declare global {
  interface Window {
    __debugData?: DebugDataHooks;
  }
}

const MODE_LABEL: Record<MapMode, string> = { class: 'Klasskarta', height: 'Höjdkarta', country: 'Landkarta' };

async function readBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

interface Loaded {
  sim: SimGrid;
  render: RenderPack;
  meta: WorldMeta;
  ms: number;
  timings: unknown[];
}

async function loadAll(): Promise<Loaded> {
  const t0 = performance.now();
  const w = createWorldLoader({ manifestUrl: siteUrl('data/manifest.json'), readBytes });
  const [sim, render, meta] = await Promise.all([w.loadSim(), w.loadRender(), w.loadMeta()]);
  return { sim, render, meta, ms: performance.now() - t0, timings: w.timings() };
}

function drawMap(ctx: CanvasRenderingContext2D, mode: MapMode, d: Loaded): void {
  const { sim, render } = d;
  const img = ctx.createImageData(sim.width, sim.height);
  const px = img.data;
  const block = render.width / sim.width;
  for (let y = 0; y < sim.height; y++) {
    for (let x = 0; x < sim.width; x++) {
      const i = y * sim.width + x;
      let rgb: readonly [number, number, number];
      if (mode === 'class') {
        rgb = CLASS_COLORS[sim.terrainClass[i] as number] as readonly [number, number, number];
      } else if (mode === 'country') {
        rgb = countryColor(sim.country[i] as number);
      } else {
        // Height map from the RENDER pack: mean of the 4 x 4 pixels of the cell (land code decoded, sea from bathymetry).
        let sum = 0;
        for (let dy = 0; dy < block; dy++) {
          for (let dx = 0; dx < block; dx++) {
            const ri = (y * block + dy) * render.width + x * block + dx;
            const h = render.height8[ri] as number;
            if (h !== 0) {
              sum += (h / 255) * (h / 255) * 9000;
            } else {
              const b = render.bathy8[((y * block + dy) >> 1) * render.bathyWidth + ((x * block + dx) >> 1)] as number;
              sum -= (b / 255) * (b / 255) * 11000;
            }
          }
        }
        rgb = heightColor(sum / (block * block));
      }
      const o = i * 4;
      px[o] = rgb[0];
      px[o + 1] = rgb[1];
      px[o + 2] = rgb[2];
      px[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, css: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.style.cssText = css;
  if (text !== undefined) e.textContent = text;
  return e;
}

async function boot(): Promise<void> {
  const root = document.getElementById('root');
  if (!root) throw new Error('missing #root');
  const wrap = el('div', 'margin:0;padding:8px 12px;background:#101418;color:#dde;font:14px/20px system-ui,sans-serif;min-height:100vh;box-sizing:border-box;');
  wrap.lang = 'sv';
  const bar = el('div', 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:8px;min-height:30px;');
  const title = el('strong', 'margin-right:8px;', 'Datakarta (debug)');
  bar.appendChild(title);
  const buttons = new Map<MapMode, HTMLButtonElement>();
  for (const mode of MAP_MODES) {
    const b = el('button', 'height:30px;padding:0 10px;border:1px solid #567;border-radius:4px;background:#223;color:#dde;font:inherit;cursor:pointer;box-sizing:border-box;', MODE_LABEL[mode]);
    b.type = 'button';
    b.dataset.map = mode;
    buttons.set(mode, b);
    bar.appendChild(b);
  }
  const back = el('a', 'margin-left:auto;color:#9cf;', 'Till spelet');
  back.href = siteUrl('index.html');
  bar.appendChild(back);
  wrap.appendChild(bar);
  const status = el('div', 'height:20px;margin-bottom:6px;color:#9ab;overflow:hidden;white-space:nowrap;', 'Laddar...');
  status.id = 'status';
  wrap.appendChild(status);
  const legend = el('div', 'display:flex;flex-wrap:wrap;gap:10px;margin-bottom:6px;font-size:12px;line-height:18px;min-height:18px;');
  legend.id = 'legend';
  for (const l of CLASS_LEGEND) {
    const item = el('span', 'display:inline-flex;align-items:center;gap:4px;');
    const sw = el('span', `display:inline-block;width:12px;height:12px;border:1px solid #556;background:rgb(${l.color.join(',')});`);
    item.appendChild(sw);
    item.appendChild(document.createTextNode(l.name));
    legend.appendChild(item);
  }
  wrap.appendChild(legend);
  const canvas = el('canvas', 'display:block;width:1024px;max-width:100%;aspect-ratio:2/1;height:auto;image-rendering:pixelated;background:#000;');
  canvas.id = 'map';
  canvas.width = 1024;
  canvas.height = 512;
  wrap.appendChild(canvas);
  const info = el('div', 'margin-top:6px;min-height:18px;color:#cde;font:12px/18px ui-monospace,Menlo,Consolas,monospace;');
  info.id = 'info';
  wrap.appendChild(info);
  root.appendChild(wrap);

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  let mode: MapMode = parseMapMode(window.location.search, window.location.hash);
  let loaded: Loaded | null = null;

  const paint = (): void => {
    for (const [m, b] of buttons) b.style.background = m === mode ? '#2a5' : '#223';
    document.body.dataset.map = mode;
    if (loaded) {
      drawMap(ctx, mode, loaded);
      if (window.__debugData) window.__debugData.mode = mode;
    }
  };
  const setMode = (m: MapMode): void => {
    mode = m;
    // Keep the address in sync (anchor form works in an Artifact too).
    if (window.location.hash !== `#map-${m}`) window.history.replaceState(null, '', `#map-${m}`);
    paint();
  };
  for (const [m, b] of buttons) b.addEventListener('click', () => setMode(m));
  window.addEventListener('hashchange', () => {
    mode = parseMapMode(window.location.search, window.location.hash);
    paint();
  });
  canvas.addEventListener('mousemove', (ev) => {
    if (!loaded) return;
    const r = canvas.getBoundingClientRect();
    const x = Math.min(1023, Math.max(0, Math.floor(((ev.clientX - r.left) / r.width) * 1024)));
    const y = Math.min(511, Math.max(0, Math.floor(((ev.clientY - r.top) / r.height) * 512)));
    const i = y * 1024 + x;
    const s = loaded.sim;
    const lon = -180 + ((x + 0.5) * 360) / 1024;
    const lat = 90 - ((y + 0.5) * 180) / 512;
    const c = loaded.meta.countries.find((k) => k.id === s.country[i]);
    info.textContent = `cell ${x},${y}  lon ${lon.toFixed(1)} lat ${lat.toFixed(1)}  ${loaded.meta.sim.classes[s.terrainClass[i] as number]}  mean ${s.meanElev[i]} m  max ${s.maxElev[i]} m  rugged ${s.ruggedness[i]}  ${c ? c.name_sv : '-'}`;
  });

  document.body.dataset.map = mode;
  try {
    loaded = await loadAll();
  } catch (err) {
    status.textContent = `Fel vid laddning: ${err instanceof Error ? err.message : String(err)}`;
    document.body.dataset.error = '1';
    throw err;
  }
  const hooks: DebugDataHooks = {
    mode,
    loadMs: loaded.ms,
    timings: loaded.timings,
    setMode,
    measureLoad: async (n: number): Promise<number[]> => {
      const out: number[] = [];
      for (let k = 0; k < n; k++) out.push((await loadAll()).ms);
      return out;
    },
  };
  window.__debugData = hooks;
  // The load time stays out of the visible text (screenshots must not change from run to run); it is in the title and in body[data-load-ms].
  status.textContent = `Laddat och kontrollerat (fnv1a): ${loaded.meta.counts.landCells} landceller, ${loaded.meta.countries.length} länder, Natural Earth ${loaded.meta.source.naturalEarth.sha.slice(0, 8)}`;
  status.title = `${loaded.ms.toFixed(0)} ms`;
  document.body.dataset.checksums = 'ok';
  document.body.dataset.loadMs = loaded.ms.toFixed(1);
  paint();
  document.body.dataset.ready = '1';
}

void boot().catch((err: unknown) => {
  console.error(err);
});
