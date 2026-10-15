// debug/viewshed.html (M11b): the radar shadow and the helicopter routes on the real baked world, drawn with Canvas2D. A developer tool:
// Swedish text only (D98). Click places a SAM (radius slider), High / Low switches the flight mode, the routes A to B are drawn twice
// (the exposure-weighted one coloured by exposure, the straightest one dashed white), hovering a cell shows the landing-zone verdict.
// Data goes through siteUrl() and the world loader (never an absolute path); the page builds a Los and a Nav exactly like the game will.
import { createWorldLoader } from '../data';
import {
  ALT_MODE_HIGH,
  ALT_MODE_LOW,
  AIR_EXPOSURE_LAMBDA,
  HELI_FUEL_CELLS,
  LZ_OK,
  LZ_REASON_NAMES,
  STRUCT_CITY,
  createLos,
  createLosTerrain,
  createNav,
  navFingerprint,
  planRoute,
  scoreLz,
  type AltMode,
  type Los,
  type Nav,
  type NavView,
  type StructureView,
} from '../sim/public';
import { TICK_HZ } from '../sim/rules';
import { CLASS_COLORS, heightColor } from './debugPalette';
import { siteUrl } from './paths';

const W = 1024;
const H = 512;
const VIEW_W = 96;
const VIEW_H = 54;
const PX = 10;
const DEFENDER = 2; // owner id of the SAMs and the cities; the helicopter belongs to seat 0 (owner 1)

interface Region {
  id: string;
  label: string;
  centre: [number, number];
  a: [number, number];
  b: [number, number];
  sam: [number, number];
}
export const REGIONS: readonly Region[] = [
  { id: 'alps', label: 'Alperna', centre: [46.6, 10.4], a: [48.1, 11.6], b: [45.2, 9.5], sam: [46.5, 9.5] },
  { id: 'himalaya', label: 'Himalaya', centre: [29.0, 85.0], a: [31.5, 80.5], b: [26.5, 90.0], sam: [27.7, 85.3] },
  { id: 'plains', label: 'Great Plains', centre: [38.5, -98.0], a: [34.5, -104.0], b: [42.5, -92.0], sam: [38.5, -98.0] },
];

export interface ViewshedHooks {
  ready: boolean;
  region(id: string): void;
  placeSam(cell: number, radius?: number): void;
  clearSams(): void;
  setMode(mode: 'high' | 'low'): void;
  samCount(): number;
  /** The last planned route pair as plain numbers (fuel, eta, exposed for the weighted and the straight route; -1 = no route). */
  stats(): { weighted: number[]; straight: number[]; mode: string };
  /** Runs `n` seeded planRoute queries (the leak test measures the heap around it). */
  runQueries(n: number): number;
  /** The result hash of the fixed fixture routes (compared with the pinned Node hash by the e2e). */
  fingerprint(): string;
}
declare global {
  interface Window {
    __viewshed?: ViewshedHooks;
  }
}

async function readBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, css: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.style.cssText = css;
  if (text !== undefined) e.textContent = text;
  return e;
}

const BTN = 'height:28px;padding:0 10px;border:1px solid #567;border-radius:4px;background:#223;color:#dde;font:inherit;cursor:pointer;box-sizing:border-box;';

function cellOf(lat: number, lon: number): number {
  const x = Math.min(W - 1, Math.floor(((lon + 180) / 360) * W));
  const y = Math.min(H - 1, Math.max(0, Math.floor(((90 - lat) / 180) * H)));
  return y * W + x;
}

async function boot(): Promise<void> {
  const root = document.getElementById('root');
  if (!root) throw new Error('missing #root');
  const loader = createWorldLoader({ manifestUrl: siteUrl('data/manifest.json'), readBytes });
  const [sim, meta, cities] = await Promise.all([loader.loadSim(), loader.loadMeta(), loader.loadCities()]);

  // --- the sim side: height field, radar cache, nav grid and a minimal read-only view with the real cities as the defender's cities
  const los: Los = createLos(createLosTerrain(W, H, meta.sim.cosQ15, sim.meanElev, sim.maxElev));
  const nav: Nav = createNav({ width: W, height: H, terrainClass: sim.terrainClass, meanElev: sim.meanElev }, los);
  const n = cities.length;
  const cellArr = new Int32Array(n);
  cities.forEach((c, i) => (cellArr[i] = c.cell));
  const structures: StructureView = {
    capacity: n,
    highWater: n,
    liveCount: n,
    type: new Uint8Array(n).fill(STRUCT_CITY),
    owner: new Uint8Array(n).fill(DEFENDER),
    cell: cellArr,
    level: new Uint8Array(n).fill(1),
    buildTick: new Int32Array(n),
    readyTick: new Int32Array(n),
    upgradeReadyTick: new Int32Array(n),
    idAt: () => -1,
    ownedCount: () => 0,
    deleteReadyTick: () => 0,
  };
  const view: NavView = { tick: 1_000_000, structures, terrainClass: sim.terrainClass, seats: 2 };

  // --- state
  let mode: AltMode = ALT_MODE_LOW;
  let vx = 0; // top-left sim cell of the viewport
  let vy = 0;
  let a = 0;
  let b = 0;
  let tool: 'sam' | 'a' | 'b' = 'sam';
  let radius = 24;
  let sams = 0;
  let hover = -1;
  let last = { weighted: [-1, -1, -1], straight: [-1, -1, -1] };

  // --- page
  const wrap = el('div', 'margin:0;padding:8px 12px;background:#101418;color:#dde;font:14px/20px system-ui,sans-serif;min-height:100vh;box-sizing:border-box;');
  const bar = el('div', 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:6px;');
  bar.appendChild(el('strong', 'margin-right:6px;', 'Radarskugga och flygrutter (debug)'));
  const regionBtns = new Map<string, HTMLButtonElement>();
  for (const r of REGIONS) {
    const btn = el('button', BTN, r.label);
    btn.type = 'button';
    btn.dataset.region = r.id;
    regionBtns.set(r.id, btn);
    bar.appendChild(btn);
  }
  const modeBtns = new Map<AltMode, HTMLButtonElement>();
  for (const [m, label] of [[ALT_MODE_LOW, 'Lågt (NOE)'], [ALT_MODE_HIGH, 'Högt']] as const) {
    const btn = el('button', BTN, label);
    btn.type = 'button';
    btn.dataset.mode = m === ALT_MODE_LOW ? 'low' : 'high';
    modeBtns.set(m, btn);
    bar.appendChild(btn);
  }
  const toolBtns = new Map<string, HTMLButtonElement>();
  for (const [t, label] of [['sam', 'Placera SAM'], ['a', 'Sätt A'], ['b', 'Sätt B']] as const) {
    const btn = el('button', BTN, label);
    btn.type = 'button';
    btn.dataset.tool = t;
    toolBtns.set(t, btn);
    bar.appendChild(btn);
  }
  const clearBtn = el('button', BTN, 'Rensa SAM');
  clearBtn.type = 'button';
  clearBtn.dataset.action = 'clear';
  bar.appendChild(clearBtn);
  const slider = el('input', 'width:120px;');
  slider.type = 'range';
  slider.min = '8';
  slider.max = '64';
  slider.value = String(radius);
  slider.id = 'radius';
  const sliderLabel = el('span', 'min-width:90px;', `Radie ${radius}`);
  bar.appendChild(slider);
  bar.appendChild(sliderLabel);
  const back = el('a', 'margin-left:auto;color:#9cf;', 'Till spelet');
  back.href = siteUrl('index.html');
  bar.appendChild(back);
  wrap.appendChild(bar);
  wrap.appendChild(el('div', 'color:#9ab;font-size:12px;margin-bottom:4px;', 'Klick placerar enligt valt verktyg, dra för att panorera, pilarna panorerar också. Rött = täckt av radarn (hål bakom bergen), grönt = rutten dold, orange = rutten exponerad, vit streckad = rakaste rutten.'));
  const canvas = el('canvas', `display:block;width:${VIEW_W * PX}px;max-width:100%;height:auto;aspect-ratio:${VIEW_W}/${VIEW_H};background:#000;cursor:crosshair;`);
  canvas.id = 'map';
  canvas.width = VIEW_W * PX;
  canvas.height = VIEW_H * PX;
  wrap.appendChild(canvas);
  const stats = el('div', 'margin-top:6px;min-height:40px;font:12px/18px ui-monospace,Menlo,Consolas,monospace;color:#cde;white-space:pre;');
  stats.id = 'stats';
  wrap.appendChild(stats);
  const info = el('div', 'min-height:18px;font:12px/18px ui-monospace,Menlo,Consolas,monospace;color:#9ab;');
  info.id = 'info';
  wrap.appendChild(info);
  root.appendChild(wrap);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  const img = ctx.createImageData(canvas.width, canvas.height);

  // --- helpers
  const wrapDx = (sx: number): number => {
    let d = (((sx - vx) % W) + W) % W;
    if (d > W / 2) d -= W;
    return d;
  };
  const toPx = (cell: number): [number, number] => {
    const sx = cell % W;
    return [(wrapDx(sx) + 0.5) * PX, ((cell - sx) / W - vy + 0.5) * PX];
  };
  const fromPx = (x: number, y: number): number => {
    const cx = (((vx + Math.floor((x / canvas.clientWidth) * VIEW_W)) % W) + W) % W;
    const cy = Math.min(H - 1, Math.max(0, vy + Math.floor((y / canvas.clientHeight) * VIEW_H)));
    return cy * W + cx;
  };
  const centreOn = (lat: number, lon: number): void => {
    const c = cellOf(lat, lon);
    const cx = c % W;
    vx = (((cx - VIEW_W / 2) % W) + W) % W;
    vy = Math.min(H - VIEW_H, Math.max(0, (c - cx) / W - VIEW_H / 2));
  };
  /** The nearest cell (rings around the wish) that is playable land with an open nav cell in both modes. */
  const snap = (cell: number): number => {
    const sx = cell % W;
    const sy = (cell - sx) / W;
    for (let r = 0; r < 40; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const y = sy + dy;
          if (y < 0 || y >= H) continue;
          const c = y * W + ((sx + dx + W) % W);
          const cls = sim.terrainClass[c] as number;
          if (cls < 2 || cls === 6 || cls === 7) continue;
          const nv = nav.navOf(c);
          if (nav.blocked[0]?.[nv] === 1) continue;
          return c;
        }
    return cell;
  };
  const exposedNav = (nv: number): boolean => {
    const c = nav.lowCell[nv] as number;
    return los.detected(DEFENDER, c, mode) || los.inPostRadius(DEFENDER, c);
  };

  const plan = (): void => {
    const w = planRoute(nav, view, 0, a, b, mode, AIR_EXPOSURE_LAMBDA);
    const s = planRoute(nav, view, 0, a, b, mode, 0);
    last = {
      weighted: w.ok ? [w.fuelCells, w.etaTicks, w.exposedCells] : [-1, -1, -1],
      straight: s.ok ? [s.fuelCells, s.etaTicks, s.exposedCells] : [-1, -1, -1],
    };
    const line = (name: string, r: typeof w): string =>
      r.ok ? `${name}: ${r.fuelCells} celler (bränsle ${r.fuelCells}/${HELI_FUEL_CELLS}), ${(r.etaTicks / TICK_HZ).toFixed(1)} s, exponerade navceller ${r.exposedCells}/${r.navCells.length}, ${r.waypoints.length} punkter` : `${name}: INGEN RUTT (NO_ROUTE)`;
    stats.textContent = `Läge ${mode === ALT_MODE_LOW ? 'Lågt' : 'Högt'}, ${sams} SAM\n${line('Vägd rutt (lambda 3)', w)}\n${line('Rakaste rutten (lambda 0)', s)}`;
  };

  const draw = (): void => {
    los.sync(view);
    const px = img.data;
    for (let cy = 0; cy < VIEW_H; cy++) {
      const sy = Math.min(H - 1, vy + cy);
      for (let cx = 0; cx < VIEW_W; cx++) {
        const c = sy * W + ((vx + cx) % W);
        const cls = sim.terrainClass[c] as number;
        let rgb = cls <= 1 ? CLASS_COLORS[cls] : heightColor(sim.meanElev[c] as number);
        rgb = rgb as readonly [number, number, number];
        let r = rgb[0];
        let g = rgb[1];
        let bl = rgb[2];
        const covered = los.detected(DEFENDER, c, mode) || los.inPostRadius(DEFENDER, c);
        if (covered) {
          r = Math.floor(r * 0.5 + 140);
          g = Math.floor(g * 0.5);
          bl = Math.floor(bl * 0.5);
        }
        for (let py = 0; py < PX; py++) {
          let o = ((cy * PX + py) * canvas.width + cx * PX) * 4;
          for (let qx = 0; qx < PX; qx++) {
            px[o++] = r;
            px[o++] = g;
            px[o++] = bl;
            px[o++] = 255;
          }
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    plan();
    // routes
    const drawRoute = (lambda: number, dashed: boolean): void => {
      const r = planRoute(nav, view, 0, a, b, mode, lambda);
      if (!r.ok) return;
      ctx.lineWidth = dashed ? 2 : 4;
      ctx.setLineDash(dashed ? [8, 6] : []);
      let prev = a;
      for (let i = 0; i < r.navCells.length; i++) {
        const nv = r.navCells[i] as number;
        const cur = i === r.navCells.length - 1 ? b : nav.centerOf(nv);
        const [x0, y0] = toPx(prev);
        const [x1, y1] = toPx(cur);
        if (Math.abs(x1 - x0) < (VIEW_W * PX) / 2) {
          ctx.strokeStyle = dashed ? '#ffffff' : exposedNav(nv) ? '#ff9a1f' : '#35e06b';
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.stroke();
        }
        prev = cur;
      }
      ctx.setLineDash([]);
    };
    drawRoute(0, true);
    drawRoute(AIR_EXPOSURE_LAMBDA, false);
    for (const [cell, label] of [[a, 'A'], [b, 'B']] as const) {
      const [x, y] = toPx(cell);
      ctx.fillStyle = '#ffd400';
      ctx.fillRect(x - 5, y - 5, 10, 10);
      ctx.fillStyle = '#000';
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText(label, x - 4, y + 4);
    }
    ctx.strokeStyle = '#ff5050';
    ctx.lineWidth = 1;
    for (const s of siteList) {
      const [x, y] = toPx(s.cell);
      ctx.beginPath();
      ctx.arc(x, y, s.radius * PX, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#ff5050';
      ctx.fillRect(x - 4, y - 4, 8, 8);
    }
    for (const [m, btn] of modeBtns) btn.style.background = m === mode ? '#2a5' : '#223';
    for (const [t, btn] of toolBtns) btn.style.background = t === tool ? '#2a5' : '#223';
    document.body.dataset.mode = mode === ALT_MODE_LOW ? 'low' : 'high';
    document.body.dataset.sams = String(sams);
  };

  const siteList: Array<{ cell: number; radius: number }> = [];
  const placeSam = (cell: number, r: number = radius): void => {
    los.addSite(DEFENDER, cell, r);
    siteList.push({ cell, radius: r });
    sams++;
  };
  const clearSams = (): void => {
    los.clearExtraSites();
    siteList.length = 0;
    sams = 0;
  };
  const setRegion = (id: string): void => {
    const r = REGIONS.find((x) => x.id === id);
    if (!r) return;
    clearSams();
    centreOn(r.centre[0], r.centre[1]);
    a = snap(cellOf(r.a[0], r.a[1]));
    b = snap(cellOf(r.b[0], r.b[1]));
    placeSam(snap(cellOf(r.sam[0], r.sam[1])), 24);
    for (const [k, btn] of regionBtns) btn.style.background = k === id ? '#2a5' : '#223';
    document.body.dataset.region = id;
    draw();
  };

  // --- input
  let drag: { x: number; y: number; vx: number; vy: number; moved: boolean } | null = null;
  canvas.addEventListener('mousedown', (ev) => {
    drag = { x: ev.clientX, y: ev.clientY, vx, vy, moved: false };
  });
  window.addEventListener('mouseup', (ev) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.moved) return;
    const r = canvas.getBoundingClientRect();
    const cell = fromPx(ev.clientX - r.left, ev.clientY - r.top);
    if (tool === 'sam') placeSam(cell);
    else if (tool === 'a') a = cell;
    else b = cell;
    draw();
  });
  window.addEventListener('mousemove', (ev) => {
    if (drag) {
      const dxCells = Math.round(((ev.clientX - drag.x) / canvas.clientWidth) * VIEW_W);
      const dyCells = Math.round(((ev.clientY - drag.y) / canvas.clientHeight) * VIEW_H);
      if (Math.abs(ev.clientX - drag.x) + Math.abs(ev.clientY - drag.y) > 4) drag.moved = true;
      if (drag.moved) {
        vx = (((drag.vx - dxCells) % W) + W) % W;
        vy = Math.min(H - VIEW_H, Math.max(0, drag.vy - dyCells));
        draw();
      }
      return;
    }
    const r = canvas.getBoundingClientRect();
    if (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) return;
    const cell = fromPx(ev.clientX - r.left, ev.clientY - r.top);
    if (cell === hover) return;
    hover = cell;
    const lz = scoreLz(nav, view, 0, cell, a, mode);
    const x = cell % W;
    const lon = -180 + ((x + 0.5) * 360) / W;
    const lat = 90 - (((cell - x) / W + 0.5) * 180) / H;
    info.textContent = `cell ${x},${(cell - x) / W}  lat ${lat.toFixed(1)} lon ${lon.toFixed(1)}  ${meta.sim.classes[sim.terrainClass[cell] as number]}  ${sim.meanElev[cell]} m  LZ från A: ${LZ_REASON_NAMES[lz.reason]}${lz.reason === LZ_OK ? ` (poäng ${lz.score}, ${lz.fuelCells} celler)` : ''}`;
  });
  window.addEventListener('keydown', (ev) => {
    const step = 6;
    if (ev.key === 'ArrowLeft') vx = (vx - step + W) % W;
    else if (ev.key === 'ArrowRight') vx = (vx + step) % W;
    else if (ev.key === 'ArrowUp') vy = Math.max(0, vy - step);
    else if (ev.key === 'ArrowDown') vy = Math.min(H - VIEW_H, vy + step);
    else return;
    ev.preventDefault();
    draw();
  });
  for (const [id, btn] of regionBtns) btn.addEventListener('click', () => setRegion(id));
  for (const [m, btn] of modeBtns) btn.addEventListener('click', () => ((mode = m), draw()));
  for (const [t, btn] of toolBtns) btn.addEventListener('click', () => ((tool = t as 'sam' | 'a' | 'b'), draw()));
  clearBtn.addEventListener('click', () => (clearSams(), draw()));
  slider.addEventListener('input', () => {
    radius = Number(slider.value);
    sliderLabel.textContent = `Radie ${radius}`;
  });

  // --- hooks for the tests
  const fixtures: Array<[number, number, AltMode]> = [
    [cellOf(48.1, 11.6), cellOf(45.2, 9.5), ALT_MODE_LOW],
    [cellOf(27.7, 85.3), cellOf(28.6, 77.2), ALT_MODE_LOW],
    [cellOf(27.7, 85.3), cellOf(28.6, 77.2), ALT_MODE_HIGH],
    [cellOf(39, -98), cellOf(41, -87), ALT_MODE_LOW],
    [cellOf(-33, -70), cellOf(-34, -58), ALT_MODE_LOW],
  ];
  const landNav: number[] = [];
  for (let i = 0; i < nav.width * nav.height; i++) if ((nav.landCount[i] as number) >= 8) landNav.push(nav.centerOf(i));
  window.__viewshed = {
    ready: true,
    region: setRegion,
    placeSam: (cell, r) => (placeSam(cell, r), draw()),
    clearSams: () => (clearSams(), draw()),
    setMode: (m) => ((mode = m === 'high' ? ALT_MODE_HIGH : ALT_MODE_LOW), draw()),
    samCount: () => sams,
    stats: () => ({ ...last, mode: mode === ALT_MODE_LOW ? 'low' : 'high' }),
    runQueries: (count) => {
      let ok = 0;
      let s = 12345;
      for (let i = 0; i < count; i++) {
        s = (Math.imul(s, 1103515245) + 12345) >>> 0;
        const from = landNav[s % landNav.length] as number;
        s = (Math.imul(s, 1103515245) + 12345) >>> 0;
        const to = landNav[s % landNav.length] as number;
        if (planRoute(nav, view, 0, from, to, ALT_MODE_LOW).ok) ok++;
      }
      return ok;
    },
    fingerprint: () => {
      const saved = siteList.slice();
      clearSams();
      const h = navFingerprint(nav, view, 0, fixtures);
      for (const sd of saved) placeSam(sd.cell, sd.radius);
      return h;
    },
  };
  setRegion('alps');
  document.body.dataset.ready = '1';
}

void boot().catch((err: unknown) => {
  console.error(err);
  document.body.dataset.error = '1';
});
