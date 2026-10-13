// The stylised Earth scene (M02): loads the packs through the data layer, builds the Globe, wires mouse input, hover
// tooltip, the F3 overlay and the `?test=1` hooks. The only code in `src` that drives the fx clock from real frames.
import { createWorldLoader } from '../data';
import { advanceFx, fxNow, setFxTime } from '../render/clock';
import { wrapLon } from '../render/geo';
import { buildOwnerPalette } from '../render/ownerPalette';
import type { ViewState } from '../render/camera';
import { Globe, type GlobeInfo, type GlobePick, type ScreenHit, type WorldData } from '../render/globe';
import type { WorldTextureName } from '../render/textures';
import { DEFAULT_START_TIME, DEFAULT_START_VIEW } from '../render/views';
import { resolveQuality } from '../render/quality';
import { FrameStats } from '../ui/frameStats';
import { createPerfOverlay, type PerfOverlay } from '../ui/perfOverlay';
import { ClickTracker } from '../ui/clickTracker';
import { createMatchHud, notConquerableText, rejectText, type MatchHud, type MatchHudModel } from '../ui/matchHud';
import { getLanguage, languageOf, onLanguageChange, setLanguage, setStrictI18n, t, type TextKey } from '../ui/i18n';
import { START_SPIN_DEG_PER_S } from '../ui/uiConfig';
import { mountStartScreen, type StartScreen } from '../ui/startScreen';
import { PHASE_IMMUNITY, PHASE_SPAWN } from '../sim/flow';
import { REJECT_NOT_SPAWNED } from '../sim/intents';
import { seatToOwner } from '../sim/state';
import { isPlayableClass } from '../sim/terrain';
import type { IntentBody } from '../sim/intents';
import { resolveClickCell } from './clickTarget';
import { LOCAL_SEAT, MatchSession } from './match';
import { matchKeyAction } from './matchKeys';
import type { AppParams, AppState, SceneParams } from './params';
import { siteUrl } from './paths';
import { countryNameMap, tooltipText } from './tooltip';

export interface GlobeAppContext {
  wrapper: HTMLElement;
  canvas: HTMLCanvasElement;
  overlay: HTMLPreElement;
  params: AppParams;
  scene: SceneParams;
  /** The parsed address (perf flag and the raw key/values for the perf report). */
  state: AppState;
  /** False once the scene was stopped (a hash change restarted the mode) while the packs were still loading. */
  isActive?: () => boolean;
}

export interface GlobeTestInfo extends GlobeInfo {
  /** ms from page start (performance.now) to the end of the first render call; null before it. */
  firstFrameMs: number | null;
  frames: number;
  testMode: boolean;
  /** Fx clock seconds. */
  fx: number;
}

/** What `__test.state()` reports of the match (plain data, copies). */
export interface MatchStateInfo {
  tick: number;
  phase: 'spawn' | 'immunity' | 'play';
  speed: number;
  paused: boolean;
  seed: number;
  rejects: number;
  lastRejectReason: number;
  commitPct: number;
  /** The local player (seat 0). */
  local: { spawned: boolean; cells: number; troops: number; troopsQt: number; capQt: number; gold: number; goldMilli: number; goldPerSecMilli: number; landShareQ15: number; landSharePct: number; alive: boolean };
  /** Per seat, same fields as the sim statistics. */
  seats: Array<{ seat: number; cells: number; troopsQt: number; goldMilli: number; landShareQ15: number; alive: boolean }>;
  ownership: { uploads: number; gpuUploads: number; dirty: boolean };
  hostAdvance: { frames: number; meanMs: number; p95Ms: number; maxMs: number };
}

export interface GlobeTestHooks {
  /** Renders one frame; `dt` (default 0) first steps the fx clock, which also moves camera inertia and the sun. */
  render(dt?: number): void;
  info(): GlobeTestInfo;
  /** Sets the camera (and the fx clock when `time` is given). Does not render. */
  setView(v: Partial<ViewState> & { time?: number }): void;
  /** Screen position of a position on the displaced surface. */
  project(lat: number, lon: number): ScreenHit;
  /** Steps the fx clock by `dt` seconds and then runs exactly `ticks` sim ticks (default 0), whatever the speed. With ticks the ownership texture is flushed (the throttle is bypassed) so the next render shows them. */
  advance(dt: number, ticks?: number): void;
  /** The match as plain data; null before the match started (it starts at once in test mode). */
  state(): MatchStateInfo | null;
  /** Sends a raw intent body of any seat through the host (what a UI would; used to try illegal ones). Effective T + 2 ticks later. */
  submit(body: IntentBody): void;
  /** Test-only gift: sends a DebugGive intent (valid only when the match config has debugIntents, which test mode sets). Effective T + 2 ticks later. */
  give(seat: number, gift: { gold?: number; troops?: number }): void;
  /** The sim state hash (through a snapshot request). */
  hash(): Promise<number>;
  /** The text of an i18n key in the current language; throws in test mode when the key is missing from a table (D98). */
  text(key: string, params?: Record<string, string | number>): string;
  /** The UI language ('sv' or 'en'). */
  language(): string;
  /** Runs the HUD refresh `n` times without changing anything; returns the milliseconds it took (a DOM-free steady state does no work). */
  hudRefresh(n: number): number;
  /** Runs `seconds` of wall time in frames of 1/fps without drawing: fx clock, host.advance and the throttled ownership flush, as the live loop does. Returns the ownership uploads and ticks it caused. */
  run(seconds: number, fps?: number): { uploads: number; ticks: number };
  /** Owners (ownerId) of sim cells as the GPU texture holds them. */
  readOwnership(cells: number[]): number[];
  /** The mirror's owner of a cell (what the renderer was told). */
  ownerOf(cell: number): number;
  /** Sets the speed: 0 pause, 1, 2 or 4. */
  setSpeed(speed: 0 | 1 | 2 | 4): void;
  /** Surface pick under a canvas pixel. */
  pick(x: number, y: number): GlobePick | null;
  /** Texels of a data texture as the GPU holds them. */
  readTexels(name: WorldTextureName, points: Array<[number, number]>): number[];
  /** Height exaggeration of shader and picking (0 = flat control). */
  setExaggeration(x: number): void;
  /** Strength of the country border lines (0 = none). */
  setBorderStrength(x: number): void;
  view(): ViewState;
  /** Text of the hover tooltip for a pick, as the page shows it. */
  tooltip(x: number, y: number): string | null;
}

async function readBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

// The packs are loaded once per page: a restart of the mode (hashchange) reuses them.
let worldCache: Promise<WorldData> | null = null;
function loadWorld(): Promise<WorldData> {
  if (!worldCache) {
    const loader = createWorldLoader({ manifestUrl: siteUrl('data/manifest.json'), readBytes });
    worldCache = Promise.all([loader.loadRender(), loader.loadSim(), loader.loadMeta(), loader.loadCities()]).then(([render, sim, meta, cities]) => ({ render, sim, meta, cities }));
    worldCache.catch(() => {
      worldCache = null;
    });
  }
  return worldCache;
}

/** Boots the globe scene; the promise resolves to a function that stops it (listeners, frame loop, GL resources, DOM). */
export async function bootGlobe(ctx: GlobeAppContext): Promise<() => void> {
  const { wrapper, canvas, overlay, params } = ctx;
  // Language and strictness first: every text below goes through t(). Test mode fails on a missing key (D98).
  setLanguage(languageOf(ctx.state.raw));
  setStrictI18n(params.test);
  const status = document.createElement('div');
  status.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#9bd;font:14px system-ui,sans-serif;pointer-events:none;';
  status.textContent = t('app.loading');
  if (!params.test) wrapper.appendChild(status);

  const world = await loadWorld();
  const { meta } = world;
  status.remove();
  if (ctx.isActive && !ctx.isActive()) return () => undefined; // stopped while loading: build nothing

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

  const globe = new Globe({ canvas, width, height, dpr, quality, world, preserveDrawingBuffer: params.test });
  globe.setView(DEFAULT_START_VIEW);
  if (params.blank) canvas.style.visibility = 'hidden'; // debug: the negative e2e test needs an empty picture
  setFxTime(DEFAULT_START_TIME); // the sun starts 67 degrees west of the default view so that the terminator is visible at once

  const abort = new AbortController();
  const { signal } = abort;
  let alive = true;
  let names = countryNameMap(meta, getLanguage());
  const stopNames = onLanguageChange((l) => {
    names = countryNameMap(meta, l);
  });
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

  // --- The match (M05) ----------------------------------------------------------------------------------------------------
  // A session is the sim behind its host plus the page's read-only mirror of it. Test mode starts one at once (no start screen);
  // the normal page starts it when Play is pressed. The UI below only sends intents (`session.submit`) and reads `session.view`.
  let session = null as MatchSession | null;
  let hud = null as MatchHud | null;
  let startScreen = null as StartScreen | null;
  const ownerPalette = buildOwnerPalette();
  const ownerCss: string[] = [];
  for (let id = 0; id < ownerPalette.length / 4; id++) ownerCss.push(`rgb(${ownerPalette[id * 4]}, ${ownerPalette[id * 4 + 1]}, ${ownerPalette[id * 4 + 2]})`);
  /** CSS colour of a seat: the colour its territory has on the globe (ownerId = seat + 1). */
  const seatColor = (seat: number): string => ownerCss[seatToOwner(seat)] ?? '#888888';
  const hostAdvance = new FrameStats(240); // ms per frame that ran ticks: the cost of the sim stepping in the browser
  const hudCost = new FrameStats(240); // ms per frame of the HUD refresh (live loop only)
  const startMatch = async (): Promise<void> => {
    if (session !== null) return;
    const s = await MatchSession.create(
      { width: world.sim.width, height: world.sim.height, terrainClass: world.sim.terrainClass, meanElev: world.sim.meanElev, cosQ15: world.meta.sim.cosQ15 },
      { seed: params.seed, debugIntents: params.test, interpolate: !params.test, ai: ctx.state.raw.ai !== '0' },
    );
    if (!alive) {
      s.dispose();
      return;
    }
    session = s;
    globe.ownership.setFromOwners(s.view.owner);
    s.view.onFrame((m, d) => {
      if (d.fullOwner !== null) globe.ownership.setFromOwners(m.owner);
      else globe.ownership.applyCells(d.cells, d.owners);
    });
    hud = createMatchHud(wrapper, { setCommit: (p) => s.setCommit(p), setSpeed: (sp) => s.setSpeed(sp), togglePause: () => s.togglePause() }, { seatColor });
    hud.setVisible(!params.test || ctx.state.raw.hud === '1'); // test mode hides it (the globe goldens), `#hud` / `?hud=1` shows it
    // The two link chips of the start page sit above the HUD (they are outside the wrapper); the Dev panel lists the same pages.
    for (const id of ['probe-link', 'debug-links']) {
      const chip = document.getElementById(id);
      if (chip) chip.hidden = true;
    }
    refreshHud(); // the HUD is filled before its first frame is drawn
  };
  /** The one model object the HUD reads each frame (rewritten in place: nothing is allocated per frame). */
  let model: { -readonly [K in keyof MatchHudModel]: MatchHudModel[K] } | null = null;
  const refreshHud = (): void => {
    if (session === null || hud === null) return;
    const alpha = session.alpha();
    model ??= { view: session.view, localSeat: LOCAL_SEAT, commitPct: 0, speed: 0, troops: 0, gold: 0 };
    model.commitPct = session.commitPct;
    model.speed = session.speed;
    model.troops = session.stats.value('troopsQt', LOCAL_SEAT, alpha) / 4;
    model.gold = session.stats.value('goldMilli', LOCAL_SEAT, alpha) / 1000;
    hud.update(model, fxNow());
    const refused = session.takeNewReject();
    if (refused !== 0) hud.toast(rejectText(refused), fxNow());
  };
  /** One click on the globe: spawn in the spawn phase, otherwise attack the land under the cursor. */
  const onGlobeClick = (x: number, y: number): void => {
    const sess = session;
    if (sess === null) return;
    const pick = globe.pick(x, y);
    if (pick === null) return;
    const v = sess.view;
    const cell = resolveClickCell(pick, v.terrainClass, v.width, v.height);
    const cls = v.terrainClass[cell] as number;
    const spawned = (v.stats.capital[LOCAL_SEAT] as number) !== 0;
    if (v.phase === PHASE_SPAWN) {
      if (!spawned) sess.spawnAt(cell); // anything else is the sim's to refuse (sea, Peak, Ice, owned) and the toast says why
      return;
    }
    if (!spawned) {
      hud?.toast(rejectText(REJECT_NOT_SPAWNED), fxNow());
      return;
    }
    if (!isPlayableClass(cls)) {
      hud?.toast(notConquerableText(), fxNow());
      return;
    }
    const target = v.owner[cell] as number;
    if (target === sess.localOwner) return; // your own land: nothing to attack
    sess.attack(target);
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
  window.addEventListener(
    'keydown',
    (e: KeyboardEvent) => {
      if (e.key === 'F3') {
        e.preventDefault();
        overlay.hidden = !overlay.hidden;
        if (!overlay.hidden) refreshOverlay();
        return;
      }
      if (session === null) return;
      const t = e.target instanceof HTMLElement ? e.target : null;
      const action = matchKeyAction({ key: e.key, code: e.code, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey, repeat: e.repeat, targetTag: t?.tagName, targetType: t instanceof HTMLInputElement ? t.type : undefined });
      if (action === null) return;
      e.preventDefault();
      if (action === 'commit-down') session.adjustCommit(-1);
      else if (action === 'commit-up') session.adjustCommit(1);
      else if (action === 'pause') session.togglePause();
      else if (action === 'slower') session.slower();
      else session.faster();
    },
    { signal },
  );

  // --- Performance overlay (?perf=1 / #perf) ------------------------------------------------------------------------
  const stats = new FrameStats();
  let perf: PerfOverlay | null = null;
  if (ctx.state.perf) {
    perf = createPerfOverlay(wrapper, {
      snapshot: () => globe.info(),
      stats,
      mode: { test: params.test ? '1' : '0', quality: quality.tier, scene: ctx.scene.scene },
      match: () =>
        session === null
          ? null
          : {
              tick: session.view.tick,
              speed: session.speed,
              hostAdvanceMs: { mean: hostAdvance.meanMs(), p95: hostAdvance.p95Ms(), max: hostAdvance.maxMs(), frames: hostAdvance.frames },
              hudUpdateMs: { mean: hudCost.meanMs(), p95: hudCost.p95Ms(), max: hudCost.maxMs(), frames: hudCost.frames },
              ownershipUploads: globe.ownership.uploads,
              ownershipGpuUploads: globe.ownership.gpuUploads,
            },
    });
  }
  const disposeAll = (): void => {
    if (!alive) return;
    alive = false;
    abort.abort();
    perf?.dispose();
    hud?.dispose();
    startScreen?.dispose();
    stopNames();
    session?.dispose();
    tip.remove();
    status.remove();
    globe.dispose();
  };

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
  const clicks = new ClickTracker();
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
      clicks.down(p.x, p.y);
      globe.rig.dragStart(p.x, p.y, fxNow());
    }
  });
  canvas.addEventListener('pointermove', (e: PointerEvent) => {
    const p = local(e);
    if (mode === 'drag') {
      clicks.move(p.x, p.y);
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
    if (mode === 'drag') {
      const p = local(e);
      const wasClick = e.type === 'pointerup' && clicks.up(p.x, p.y);
      if (!wasClick) clicks.cancel();
      globe.rig.dragEnd(fxNow());
      if (wasClick) onGlobeClick(p.x, p.y);
    }
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
  const matchState = (): MatchStateInfo | null => {
    const sess = session;
    if (sess === null) return null;
    const v = sess.view;
    const st = v.stats;
    const L = LOCAL_SEAT;
    const seats: MatchStateInfo['seats'] = [];
    for (let seat = 0; seat < v.seats; seat++) {
      seats.push({ seat, cells: st.cells[seat] as number, troopsQt: st.troopsQt[seat] as number, goldMilli: st.goldMilli[seat] as number, landShareQ15: st.landShareQ15[seat] as number, alive: st.alive[seat] === 1 });
    }
    return {
      tick: v.tick,
      phase: v.phase === PHASE_SPAWN ? 'spawn' : v.phase === PHASE_IMMUNITY ? 'immunity' : 'play',
      speed: sess.speed,
      paused: sess.isPaused,
      seed: params.seed,
      rejects: v.rejects,
      lastRejectReason: v.lastRejectReason,
      commitPct: sess.commitPct,
      local: {
        spawned: (st.capital[L] as number) !== 0,
        cells: st.cells[L] as number,
        troops: Math.floor((st.troopsQt[L] as number) / 4),
        troopsQt: st.troopsQt[L] as number,
        capQt: st.capQt[L] as number,
        gold: Math.floor((st.goldMilli[L] as number) / 1000),
        goldMilli: st.goldMilli[L] as number,
        goldPerSecMilli: st.goldPerSecMilli[L] as number,
        landShareQ15: st.landShareQ15[L] as number,
        landSharePct: ((st.landShareQ15[L] as number) / 32768) * 100,
        alive: st.alive[L] === 1,
      },
      seats,
      ownership: { uploads: globe.ownership.uploads, gpuUploads: globe.ownership.gpuUploads, dirty: globe.ownership.isDirty },
      hostAdvance: { frames: hostAdvance.frames, meanMs: hostAdvance.meanMs(), p95Ms: hostAdvance.p95Ms(), maxMs: hostAdvance.maxMs() },
    };
  };
  if (params.test) {
    await startMatch(); // test mode has no start screen: the match exists from the first line of the test
    refreshHud();
    const hooks: GlobeTestHooks = {
      render(dt = 0): void {
        advanceFx(dt);
        refreshHud();
        renderFrame();
        if (!overlay.hidden) refreshOverlay();
        perf?.update();
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
      advance(dt, ticks = 0): void {
        advanceFx(dt);
        if (ticks > 0 && session !== null) {
          session.runTicks(ticks);
          globe.ownership.flush(fxNow(), true);
        }
        refreshHud();
      },
      state: matchState,
      submit(body): void {
        session?.submit(body);
      },
      give(seat, gift): void {
        session?.submit({ kind: 'DebugGive', seat, gold: gift.gold ?? 0, troops: gift.troops ?? 0 });
      },
      hash: () => (session === null ? Promise.resolve(0) : session.hash()),
      text: (key, params) => t(key as TextKey, params),
      language: () => getLanguage(),
      hudRefresh(n): number {
        const t0 = performance.now();
        for (let i = 0; i < n; i++) refreshHud();
        return performance.now() - t0;
      },
      run(seconds, fps = 60): { uploads: number; ticks: number } {
        const sess = session;
        if (sess === null) return { uploads: 0, ticks: 0 };
        const u0 = globe.ownership.uploads;
        const t0 = sess.view.tick;
        const n = Math.round(seconds * fps);
        for (let i = 0; i < n; i++) {
          advanceFx(1 / fps);
          sess.frame(1000 / fps);
          globe.ownership.flush(fxNow());
        }
        refreshHud();
        return { uploads: globe.ownership.uploads - u0, ticks: sess.view.tick - t0 };
      },
      readOwnership: (cells) => Array.from(globe.readOwnership(cells)),
      ownerOf: (cell) => (session === null ? 0 : (session.view.owner[cell] as number)),
      setSpeed(speed): void {
        if (session === null) return;
        if (speed === 0) session.setPaused(true);
        else {
          session.setPaused(false);
          session.setSpeed(speed);
        }
      },
      pick: (x, y) => globe.pick(x, y),
      readTexels: (name, points) => Array.from(globe.readTexels(name, points)),
      setExaggeration: (x) => globe.setExaggeration(x),
      setBorderStrength: (x) => globe.setBorderStrength(x),
      view: () => globe.rig.view,
      tooltip: tipFor,
    };
    window.__test = hooks;
    return disposeAll; // deterministic mode: no requestAnimationFrame loop
  }

  window.addEventListener('resize', () => globe.resize(window.innerWidth, window.innerHeight, Math.min(window.devicePixelRatio || 1, quality.maxDpr)), { signal });
  // The normal page opens with the start screen; the match begins when Play is pressed.
  // Building the match takes a moment on the main thread: let the button show "loading" first (two frames), then start.
  const nextPaint = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  startScreen = mountStartScreen(wrapper, async () => {
    await nextPaint();
    await startMatch();
    startScreen?.dispose();
    startScreen = null;
  });
  let last = performance.now();
  let sinceOverlay = 0;
  const spinFrom = fxNow();
  const loop = (now: number): void => {
    if (!alive) return;
    const dt = (now - last) / 1000;
    last = now;
    if (dt > 0) {
      fps = fps * 0.9 + (1 / dt) * 0.1;
      stats.push(dt * 1000);
      advanceFx(Math.min(dt, 0.1));
      if (startScreen !== null) globe.setView({ lon: wrapLon(DEFAULT_START_VIEW.lon + (fxNow() - spinFrom) * START_SPIN_DEG_PER_S) }); // the globe turns slowly behind the start screen
      if (session !== null) {
        const before = session.view.tick;
        const t0 = performance.now();
        session.frame(Math.min(dt * 1000, 250));
        if (session.view.tick !== before) hostAdvance.push(performance.now() - t0);
        const h0 = performance.now();
        refreshHud();
        hudCost.push(performance.now() - h0);
      }
    }
    renderFrame();
    if (!overlay.hidden) refreshOverlay();
    if (perf && ++sinceOverlay >= 15) {
      sinceOverlay = 0;
      perf.update();
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  return disposeAll;
}
