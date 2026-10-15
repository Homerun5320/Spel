// The stylised Earth scene (M02): loads the packs through the data layer, builds the Globe, wires mouse input, hover
// tooltip, the F3 overlay and the `?test=1` hooks. The only code in `src` that drives the fx clock from real frames.
import { createWorldLoader, type WorldLoad } from '../data';
import { advanceFx, fxNow, setFxTime } from '../render/clock';
import { heightAt } from '../render/detail';
import { wrapLon } from '../render/geo';
import { buildOwnerPalette } from '../render/ownerPalette';
import { rgbOfHex } from '../ui/flag';
import type { ViewState } from '../render/camera';
import { Globe, type GlobeInfo, type GlobePick, type ScreenHit, type WorldData } from '../render/globe';
import type { WorldTextureName } from '../render/textures';
import { DEFAULT_START_TIME, DEFAULT_START_VIEW, GROUND_VIEWS } from '../render/views';
import { resolveQuality } from '../render/quality';
import type { TerrainMode } from '../render/terrainMaterial';
import { FrameStats } from '../ui/frameStats';
import { latLonOfCell } from './cellGeo';
import { createPerfOverlay, type PerfOverlay } from '../ui/perfOverlay';
import { ClickTracker } from '../ui/clickTracker';
import { createMatchHud, notConquerableText, rejectText, type MatchHud, type MatchHudModel } from '../ui/matchHud';
import { getLanguage, onLanguageChange, setStrictI18n, t, type TextKey } from '../ui/i18n';
import { START_FLY_KM, START_SPIN_DEG_PER_S, SETUP_IDLE_DIST_KM } from '../ui/uiConfig';
import { mountStartScreen, type StartScreen } from '../ui/startScreen';
import { applyStartLanguage } from './langPref';
import { getPref, setPref } from './prefs';
import { createMatch, type BuiltMatch, type MatchSetupConfig } from './matchSetup';
import { countryEligibility } from './eligibility';
import { regionMask, type RegionId } from '../data/regions';
import { prepareWorld, type PreparedWorld } from './matchWorld';
import { mountSetupScreen, type SetupScreen } from './setupScreen';
import { SETUP_PREF_KEY, defaultDraft, draftFromStored, isStoredSetup, parseSeed, storedOf, type SetupDraft, type StoredSetup } from './setupModel';
import { hashBuiltMatch } from './match';
import { PHASE_IMMUNITY, PHASE_SPAWN } from '../sim/flow';
import { REJECT_NOT_SPAWNED } from '../sim/intents';
import { seatToOwner } from '../sim/state';
import type { IntentBody } from '../sim/intents';
import { clickMeaning, resolveClickCell } from './clickTarget';
import { MatchSession } from './match';
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
  /** M07a: `'chunks'` (the quadtree, default) or `'fixed'` (`?terrain=fixed`). */
  terrainMode: TerrainMode;
  /** M07a: the terrain of the last rendered frame: chunks drawn, distinct LOD levels, triangles and draw calls of the terrain. */
  terrain: TerrainStateInfo;
}

/** The terrain numbers of the last rendered frame (`__test.state().terrain`, `__test.terrain()`). */
export interface TerrainStateInfo {
  chunkCount: number;
  /** Distinct quadtree levels among the chunks drawn. */
  lodLevels: number;
  triangles: number;
  drawCalls: number;
  /** The levels themselves, ascending. */
  levels: number[];
  /** True when the tier's chunk cap refused splits the camera distance asked for (the far detail is lower than wanted). */
  capped: boolean;
  /** Every float of the instance data is finite. */
  finite: boolean;
}

export interface GlobeTestHooks {
  /** Renders one frame; `dt` (default 0) first steps the fx clock, which also moves camera inertia and the sun. */
  render(dt?: number): void;
  /**
   * `n` frames of `dt` seconds each, of which only the last is drawn: exactly the state `n` calls of `render(dt)` leave behind (the fx clock,
   * flights, camera inertia, chunk LOD hysteresis, the HUD and the frame counter all see every frame), at the cost of one GL draw. For waits
   * in which nobody looks at the intermediate pictures (D144).
   */
  settle(dt: number, n: number): void;
  info(): GlobeTestInfo;
  /**
   * Sets the camera (and the fx clock when `time` is given). Does not render. M07a: with `altAglM` the camera is put that many metres
   * above the displaced ground under it; the user's zoom limit and the tilt clamp (up to 89.5 degrees) do not apply and the near / far planes
   * follow the height. Every call forgets the chunk LOD hysteresis, so a view does not depend on the path that led to it.
   */
  setView(v: Partial<ViewState> & { time?: number; altAglM?: number }): void;
  /**
   * M07a: the camera given by its own position (`lat`, `lon`, `aglM` metres above the displaced ground), `heading` and `pitchDeg` below the
   * horizon (what `?view=alps-valley` uses); the user's zoom and tilt limits do not apply. `time` (fx seconds) sets the sun. Does not render.
   */
  setGroundView(spec: { lat: number; lon: number; heading: number; pitchDeg: number; aglM: number; time?: number }): void;
  /** M07a: the terrain numbers of the last rendered frame (the same object as `state().terrain`, available without a match). */
  terrain(): TerrainStateInfo;
  /** M07a: the chunks of the last rendered frame (level, column, row, levels the four neighbours are coarser); empty in the fixed mode. */
  terrainLeaves(): Array<{ level: number; ix: number; iy: number; coarser: number[] }>;
  /** M07a: the skirts of the chunks (on by default); off, every LOD seam is an open crack (the crack test proves its detector with it). */
  setSkirts(on: boolean): void;
  /** M07a: the `?chunks=1` colouring on or off. */
  setChunkDebug(on: boolean): void;
  /** M07a: the colour (0xRRGGBB) the frame is cleared to; the crack test uses magenta, `0x000000` is the default. */
  setClearColor(rgb: number): void;
  /** M07a: the camera's height above the displaced ground under it, metres. */
  cameraAglM(): number;
  /**
   * M07b (debug hooks, ARCHITECTURE "Terrain detail"): the readback probe runs the SAME GLSL functions as the chunk vertex shader.
   * `probeEncoding()` is 'float' (an RGBA32F target, EXT_color_buffer_float) or 'bytes' (packed RGBA8); `probeHash(items, encoding?)` returns the
   * integer hash of each [ix, iy, iz, seed] (lattice coordinates already shifted by 2^20, the seed a uint32); `probeHeight(points, encoding?)`
   * the height in render metres of each [latitude, longitude, octaves] (latitude and longitude are float32 on the GPU).
   */
  probeEncoding(): 'float' | 'bytes';
  probeHash(items: Array<[number, number, number, number]>, encoding?: 'float' | 'bytes'): number[];
  probeHeight(points: Array<[number, number, number]>, encoding?: 'float' | 'bytes'): number[];
  /** M07b: the 3D value noise of the GLSL function at each [x, y, z, seed], or with `ridge` true its ridge value 1 - |2 n - 1|. */
  probeNoise(items: Array<[number, number, number, number]>, ridge?: boolean): number[];
  /** M07b: the vertex path of the detail: the height the chunk vertex shader draws at each [latitude, longitude, chunk level, camera x, y, z in Earth radii] (octaves = the smaller of the level's and the distance law's). */
  probeVertex(points: Array<[number, number, number, number, number, number]>, encoding?: 'float' | 'bytes'): number[];
  /** M07b (tests): the surface point the picking finds under a pixel (latitude, longitude, radius in Earth radii, detail included) and the camera position in Earth radii. */
  pickSurface(x: number, y: number): { lat: number; lon: number; radius: number } | null;
  cameraPosition(): [number, number, number];
  /** M07b: the material's law of detail [offset of the distance law, level bias, 1 = on]; null in the fixed mode. */
  detailLod(): [number, number, number] | null;
  /** M07b: `heightAt` of src/render/detail.ts bound to the page's raster (the ground height in render metres, detail included). */
  heightAt(lat: number, lon: number, octaves?: number): number;
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
  /** M06: the countries of the setup as the page sees them in a region (eligibility included), prepared on first use. */
  setupCountries(region?: RegionId): Promise<SetupCountryInfo[]>;
  /** M06: builds a match from a config with the page's own `createMatch` and returns its state hash at tick 0 and after `ticks` ticks with the AI (nothing is started). */
  buildHash(config: MatchSetupConfig, ticks: number): Promise<{ ok: true; initial: string; after: string; seats: number } | { ok: false; code: string; key: string }>;
  /** M06: how many cells outside the playable mask of a region are owned right now (must always be 0 in a match of that region). */
  ownedOutside(region: RegionId): number;
  /** M06: how many cells each seat owns right now (index = seat) and, per seat, the capital cell (-1 when none); null before the match started. */
  seatCells(): { cells: number[]; capitals: number[] } | null;
}

/** One country of `setupCountries`. */
export interface SetupCountryInfo {
  id: number;
  a3: string;
  nameEn: string;
  nameSv: string;
  cells: number;
  ok: boolean;
  reasonKey: string | null;
  landmass: number;
  capitalCell: number;
}

async function readBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

// The packs are loaded once per page: a restart of the mode (hashchange) reuses them.
let loaderCache: WorldLoad | null = null;
function getLoader(): WorldLoad {
  loaderCache ??= createWorldLoader({ manifestUrl: siteUrl('data/manifest.json'), readBytes });
  return loaderCache;
}
let worldCache: Promise<WorldData> | null = null;
function loadWorld(): Promise<WorldData> {
  if (!worldCache) {
    const loader = getLoader();
    worldCache = Promise.all([loader.loadRender(), loader.loadSim(), loader.loadMeta(), loader.loadCities()]).then(([render, sim, meta, cities]) => ({ render, sim, meta, cities }));
    worldCache.catch(() => {
      worldCache = null;
    });
  }
  return worldCache;
}

// The match setup's view of the world (M06): the packs plus the overrides (merged territories, neutral names), analysed once per page.
let preparedCache: Promise<PreparedWorld> | null = null;
function loadPrepared(world: WorldData): Promise<PreparedWorld> {
  if (!preparedCache) {
    preparedCache = getLoader()
      .loadOverrides()
      .then((overrides) =>
        prepareWorld({
          sim: { width: world.sim.width, height: world.sim.height, terrainClass: world.sim.terrainClass, meanElev: world.sim.meanElev, cosQ15: world.meta.sim.cosQ15 },
          country: world.sim.country,
          coast: world.sim.coast,
          meta: world.meta,
          overrides,
        }),
      );
    preparedCache.catch(() => {
      preparedCache = null;
    });
  }
  return preparedCache;
}

/** Boots the globe scene; the promise resolves to a function that stops it (listeners, frame loop, GL resources, DOM). */
export async function bootGlobe(ctx: GlobeAppContext): Promise<() => void> {
  const { wrapper, canvas, overlay, params } = ctx;
  // Language and strictness first: every text below goes through t(). Test mode fails on a missing key (D98).
  const stopLanguagePref = applyStartLanguage(ctx.state.raw, params.test);
  setStrictI18n(params.test);
  const status = document.createElement('div');
  status.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#9bd;font:14px system-ui,sans-serif;pointer-events:none;';
  status.textContent = t('app.loading');
  if (!params.test) wrapper.appendChild(status);

  const world = await loadWorld();
  const { meta } = world;
  status.remove();
  if (ctx.isActive && !ctx.isActive()) {
    stopLanguagePref();
    return () => undefined; // stopped while loading: build nothing
  }

  const quality = resolveQuality({ test: params.test, quality: ctx.scene.quality, chunkTier: ctx.state.terrain.chunkTier });
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

  const globe = new Globe({ canvas, width, height, dpr, quality, world, preserveDrawingBuffer: params.test, terrain: ctx.state.terrain.terrain, chunkDebug: ctx.state.terrain.chunkDebug, detail: ctx.state.raw.detail !== '0' });
  globe.setView(DEFAULT_START_VIEW);
  const groundView = ctx.state.view !== null && globe.terrainMode === 'chunks' ? GROUND_VIEWS[ctx.state.view] : null; // `?view=alps-valley` (M07a)
  if (groundView !== null) globe.setGroundView(groundView);
  if (params.blank) canvas.style.visibility = 'hidden'; // debug: the negative e2e test needs an empty picture
  setFxTime(groundView?.time ?? DEFAULT_START_TIME); // the sun starts 67 degrees west of the default view so that the terminator is visible at once

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
  const renderFrame = (draw = true): void => {
    globe.render(draw);
    frames++;
    if (draw && firstFrameMs === null) firstFrameMs = performance.now();
  };

  // --- The match (M05, M06) -----------------------------------------------------------------------------------------------
  // A session is the sim behind its host plus the page's read-only mirror of it. Test mode starts one at once (no start screen, unless
  // `#menu` asks for the menus); the normal page starts it when Play is pressed (the standard M05 match: click to spawn) or when the setup
  // screen's Start has built a match with `createMatch`. The UI below only sends intents (`session.submit`) and reads `session.view`.
  let session = null as MatchSession | null;
  let hud = null as MatchHud | null;
  let startScreen = null as StartScreen | null;
  let setupScreen = null as SetupScreen | null;
  const ownerCss: string[] = [];
  /** (Re)builds the CSS colour of every owner; `own` is a custom nation's chosen colour (0xRRGGBB) or null for the magenta of the standard match. */
  const setOwnerColors = (own: number | null): void => {
    const palette = buildOwnerPalette(own === null ? undefined : rgbOfHex(own));
    globe.setOwnerPalette(palette);
    ownerCss.length = 0;
    for (let id = 0; id < palette.length / 4; id++) ownerCss.push(`rgb(${palette[id * 4]}, ${palette[id * 4 + 1]}, ${palette[id * 4 + 2]})`);
  };
  setOwnerColors(null);
  /** CSS colour of a seat: the colour its territory has on the globe (ownerId = seat + 1). */
  const seatColor = (seat: number): string => ownerCss[seatToOwner(seat)] ?? '#888888';
  const hostAdvance = new FrameStats(240); // ms per frame that ran ticks: the cost of the sim stepping in the browser
  const hudCost = new FrameStats(240); // ms per frame of the HUD refresh (live loop only)
  let neutralNames = false;
  /** The two fixed link chips of the start page (probe page, debug maps): they must never cover the setup panel or the HUD; test mode never shows them. */
  const setLinkChipsHidden = (hidden: boolean): void => {
    for (const id of ['probe-link', 'debug-links']) {
      const chip = document.getElementById(id);
      if (chip) chip.hidden = hidden || params.test;
    }
  };
  /** Everything that follows a started session (the globe shows its ownership, the HUD is built and filled before its first frame). */
  const attachSession = (s: MatchSession): void => {
    session = s;
    globe.ownership.setFromOwners(s.view.owner);
    s.view.onFrame((m, d) => {
      if (d.fullOwner !== null) globe.ownership.setFromOwners(m.owner);
      else globe.ownership.applyCells(d.cells, d.owners);
    });
    hud = createMatchHud(wrapper, { setCommit: (p) => s.setCommit(p), setSpeed: (sp) => s.setSpeed(sp), togglePause: () => s.togglePause() }, { seatColor, labels: s.labels });
    hud.setVisible(!params.test || ctx.state.raw.hud === '1'); // test mode hides it (the globe goldens), `#hud` / `?hud=1` shows it
    // The two link chips of the start page sit above the HUD (they are outside the wrapper); the Dev panel lists the same pages.
    setLinkChipsHidden(true);
    refreshHud(); // the HUD is filled before its first frame is drawn
  };
  /** The standard match of M05: you + 5 AI nations + 20 tribes, click anywhere to spawn. */
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
    attachSession(s);
  };
  /** A match the setup screen built: every nation already stands on its start disc; the camera flies to yours. */
  const startBuilt = async (match: BuiltMatch): Promise<void> => {
    if (session !== null) return;
    const s = await MatchSession.fromMatch(match, { interpolate: !params.test, ai: ctx.state.raw.ai !== '0' });
    if (!alive) {
      s.dispose();
      return;
    }
    setOwnerColors(match.humanColor);
    globe.setCountryLines(!match.config.neutral);
    globe.setSelection([]);
    neutralNames = match.config.neutral;
    attachSession(s);
    const cap = match.seats[match.humanSeat]?.capitalCell ?? -1;
    if (cap >= 0) {
      const at = latLonOfCell(cap, world.sim.width, world.sim.height);
      globe.flyTo(at.lat, at.lon, START_FLY_KM);
    }
  };
  /** The one model object the HUD reads each frame (rewritten in place: nothing is allocated per frame). */
  let model: { -readonly [K in keyof MatchHudModel]: MatchHudModel[K] } | null = null;
  const refreshHud = (): void => {
    if (session === null || hud === null) return;
    const alpha = session.alpha();
    const L = session.localSeat;
    model ??= { view: session.view, localSeat: L, commitPct: 0, speed: 0, troops: 0, gold: 0, preplaced: session.built !== null };
    model.commitPct = session.commitPct;
    model.speed = session.speed;
    model.troops = session.stats.value('troopsQt', L, alpha) / 4;
    model.gold = session.stats.value('goldMilli', L, alpha) / 1000;
    hud.update(model, fxNow());
    const refused = session.takeNewReject();
    if (refused !== 0) hud.toast(rejectText(refused), fxNow());
  };

  // --- The start marker of the setup screen: a ring on the chosen start place, kept on it every frame --------------------------
  let markerCell = -1;
  let markerEl: HTMLElement | null = null;
  const updateMarker = (): void => {
    if (markerEl === null) return;
    if (markerCell < 0) {
      markerEl.hidden = true;
      return;
    }
    const at = latLonOfCell(markerCell, world.sim.width, world.sim.height);
    const p = globe.project(at.lat, at.lon);
    const visible = p.facing && p.inView;
    markerEl.hidden = !visible;
    if (visible) markerEl.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
  };
  /** One click on the globe: spawn in the spawn phase, otherwise attack the land under the cursor. */
  const onGlobeClick = (x: number, y: number): void => {
    const pick = globe.pick(x, y);
    if (setupScreen !== null) {
      if (pick !== null) setupScreen.globeClick(pick);
      return;
    }
    const sess = session;
    if (sess === null) return;
    if (pick === null) return;
    const v = sess.view;
    const L = sess.localSeat;
    const cell = resolveClickCell(pick, v.terrainClass, v.width, v.height);
    const spawned = (v.stats.capital[L] as number) !== 0;
    if (v.phase === PHASE_SPAWN) {
      if (!spawned) sess.spawnAt(cell); // anything else is the sim's to refuse (sea, Peak, Ice, owned) and the toast says why
      return;
    }
    if (!spawned) {
      hud?.toast(rejectText(REJECT_NOT_SPAWNED), fxNow());
      return;
    }
    const meaning = clickMeaning(cell, v.terrainClass, v.owner, sess.localOwner);
    if (meaning.kind === 'unplayable') hud?.toast(notConquerableText(), fxNow());
    else if (meaning.kind === 'attack') sess.attack(meaning.target); // your own land (kind 'own') does nothing
  };

  // --- Overlay (F3) -----------------------------------------------------------------------------------------------
  let fps = 0;
  const terrainLine = (): string => {
    const t = globe.terrainInfo();
    if (t.mode === 'fixed') return `terrain: fixed mesh ${globe.meshTriangleCount} triangles`;
    return `terrain: ${t.chunkCount} chunks, levels ${t.levels.length > 0 ? `${t.levels[0]}-${t.levels[t.levels.length - 1]}` : '-'}, ${t.triangles} triangles, ${t.capped ? 'capped' : 'uncapped'}`;
  };
  const refreshOverlay = (): void => {
    const i = globe.info();
    overlay.textContent = [
      `GL renderer: ${i.renderer}`,
      `GL version:  ${i.glVersion}`,
      `fps: ${fps.toFixed(1)}`,
      `draw calls: ${i.drawCalls}  triangles: ${i.triangles}  textures: ${i.textures}`,
      `${i.width}x${i.height} @${i.dpr}x  tier ${i.tier} (${i.meshCols}x${i.meshRows})`,
      terrainLine(),
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
    setupScreen?.dispose();
    stopNames();
    stopLanguagePref();
    session?.dispose();
    tip.remove();
    status.remove();
    globe.dispose();
  };

  // --- Mouse ------------------------------------------------------------------------------------------------------
  const tipFor = (x: number, y: number): string | null => {
    const p = globe.pick(x, y);
    return p ? tooltipText(p, names, neutralNames) : null;
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
    globe.cancelFlight(); // any grab of the camera ends a flight
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
      globe.cancelFlight();
      const p = local(e);
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      globe.rig.zoomAt(p.x, p.y, e.deltaY * unit);
    },
    { passive: false },
  );

  // --- The menus: the start screen (Play = the standard match, or the setup) and the setup screen ----------------------------------
  // Building a match takes a moment on the main thread: let the button show "loading" first (two frames), then start.
  const nextPaint = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  const closeSetup = (): void => {
    setupScreen?.dispose();
    setupScreen = null;
    markerEl = null;
    markerCell = -1;
  };
  /** Back to the plain globe of the start screen: no outline, country lines and names as usual. */
  const leaveSetup = (): void => {
    closeSetup();
    globe.setSelection([]);
    globe.setCountryLines(true);
    neutralNames = false;
    setLinkChipsHidden(false);
    startScreen?.setHidden(false);
    startScreen?.playButton.focus({ preventScroll: true });
  };
  const openSetup = async (): Promise<void> => {
    if (setupScreen !== null || session !== null) return;
    const btn = startScreen?.setupButton ?? null;
    if (btn !== null) {
      btn.disabled = true;
      btn.textContent = t('setup.loading');
    }
    await nextPaint();
    let prepared: PreparedWorld;
    try {
      prepared = await loadPrepared(world);
      prepared.analyse('world');
    } catch (err) {
      console.error(err);
      if (btn !== null) {
        btn.disabled = false;
        btn.textContent = t('start.setup');
      }
      return;
    }
    if (!alive || session !== null) return;
    if (btn !== null) {
      btn.disabled = false;
      btn.textContent = t('start.setup');
    }
    // The seed: the address wins (the Dev panel's seed field writes `seed-N` there), else the stored choice, else 1.
    const addressSeed = ctx.state.raw.seed !== undefined && parseSeed(ctx.state.raw.seed) !== null ? params.seed : null;
    const base = defaultDraft(addressSeed ?? 1, t('setup.nation.defaultName'));
    const stored = getPref<StoredSetup | null>(SETUP_PREF_KEY, null, isStoredSetup as (v: unknown) => v is StoredSetup);
    let draft = stored === null ? base : draftFromStored(stored, prepared, base);
    if (addressSeed !== null) draft = { ...draft, seed: String(addressSeed) };
    const applyNeutralPreview = (d: SetupDraft): void => {
      const neutral = d.tab === 'custom' && d.neutral;
      globe.setCountryLines(!neutral);
      neutralNames = neutral;
    };
    const screen = mountSetupScreen(
      wrapper,
      prepared,
      draft,
      {
        flyTo: (lat, lon, distKm, shiftX, shiftY) => globe.flyTo(lat, lon, distKm, { shiftX, shiftY }),
        select: (ids) => globe.setSelection(ids),
        marker: (cell) => {
          markerCell = cell === null ? -1 : cell;
          updateMarker();
        },
        changed: (d) => {
          setPref(SETUP_PREF_KEY, storedOf(d, prepared));
          applyNeutralPreview(d);
        },
        start: async (config) => {
          await nextPaint();
          const r = createMatch(prepared, config);
          if (!r.ok) return r.error;
          await startBuilt(r.match);
          if (!alive) return null;
          closeSetup();
          startScreen?.dispose();
          startScreen = null;
          return null;
        },
        back: leaveSetup,
      },
      { debugIntents: params.test },
    );
    setupScreen = screen;
    markerEl = document.createElement('div');
    markerEl.className = 'setup-marker';
    markerEl.dataset.testid = 'setup-marker';
    markerEl.hidden = true;
    screen.root.append(markerEl);
    startScreen?.setHidden(true);
    setLinkChipsHidden(true); // they sit on the primary button of the panel otherwise (and a click on them would leave the draft)
    applyNeutralPreview(screen.draft());
    const d = screen.draft();
    if ((d.tab === 'real' && d.countryId !== 0) || (d.tab === 'custom' && d.cell >= 0)) screen.refly();
    else {
      const v = globe.rig.view;
      const s = screen.panelShift();
      globe.flyTo(v.lat, v.lon, SETUP_IDLE_DIST_KM, { shiftX: s.x, shiftY: s.y });
    }
    updateMarker();
  };
  const mountMenu = (): void => {
    startScreen = mountStartScreen(
      wrapper,
      async () => {
        await nextPaint();
        await startMatch();
        startScreen?.dispose();
        startScreen = null;
      },
      { onSetup: () => void openSetup() },
    );
  };

  // --- Test hooks or the frame loop ---------------------------------------------------------------------------------
  const terrainState = (): TerrainStateInfo => {
    const t = globe.terrainInfo();
    return { chunkCount: t.chunkCount, lodLevels: t.lodLevels, triangles: t.triangles, drawCalls: t.drawCalls, levels: t.levels, capped: t.capped, finite: globe.chunks?.allFinite() ?? true };
  };
  const matchState = (): MatchStateInfo | null => {
    const sess = session;
    if (sess === null) return null;
    const v = sess.view;
    const st = v.stats;
    const L = sess.localSeat;
    const seats: MatchStateInfo['seats'] = [];
    for (let seat = 0; seat < v.seats; seat++) {
      seats.push({ seat, cells: st.cells[seat] as number, troopsQt: st.troopsQt[seat] as number, goldMilli: st.goldMilli[seat] as number, landShareQ15: st.landShareQ15[seat] as number, alive: st.alive[seat] === 1 });
    }
    return {
      tick: v.tick,
      phase: v.phase === PHASE_SPAWN ? 'spawn' : v.phase === PHASE_IMMUNITY ? 'immunity' : 'play',
      speed: sess.speed,
      paused: sess.isPaused,
      seed: sess.built?.config.seed ?? params.seed,
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
      terrainMode: globe.terrainMode,
      terrain: terrainState(),
    };
  };
  if (params.test) {
    // Test mode has no start screen: the match exists from the first line of the test. `#menu` asks for the menus instead (the setup tests).
    if (ctx.state.raw.menu === '1') mountMenu();
    else await startMatch();
    refreshHud();
    const hooks: GlobeTestHooks = {
      render(dt = 0): void {
        advanceFx(dt);
        refreshHud();
        updateMarker();
        renderFrame();
        globe.finish(); // no frame is presented between the calls of a test: wait for the commands (see Globe.finish)
        if (!overlay.hidden) refreshOverlay();
        perf?.update();
      },
      settle(dt: number, n: number): void {
        for (let i = 0; i < n - 1; i++) {
          advanceFx(dt);
          refreshHud();
          updateMarker();
          renderFrame(false);
          if (!overlay.hidden) refreshOverlay();
          perf?.update();
        }
        hooks.render(dt);
      },
      info(): GlobeTestInfo {
        return { ...globe.info(), firstFrameMs, frames, testMode: true, fx: fxNow() };
      },
      setView(v): void {
        const { time, altAglM, ...view } = v;
        if (time !== undefined) setFxTime(time);
        if (altAglM !== undefined) globe.setViewAgl(view, altAglM);
        else globe.setView(view);
        globe.resetTerrain();
      },
      setGroundView(spec): void {
        const { time, ...cam } = spec;
        if (time !== undefined) setFxTime(time);
        globe.setGroundView(cam);
        globe.resetTerrain();
      },
      terrain: terrainState,
      terrainLeaves: () => globe.chunks?.leaves().map((l) => ({ ...l, coarser: [...l.coarser] })) ?? [],
      setSkirts: (on) => globe.setSkirts(on),
      setChunkDebug: (on) => globe.setChunkDebug(on),
      setClearColor: (rgb) => globe.setClearColor(rgb),
      cameraAglM: () => globe.cameraAglM(),
      probeEncoding: () => globe.probeEncoding(),
      probeHash: (items, encoding) => Array.from(globe.probeHashes(items, encoding)),
      probeHeight: (points, encoding) => Array.from(globe.probeHeights(points, encoding)),
      probeNoise: (items, ridge = false) => Array.from(globe.probeNoiseValues(items, ridge)),
      probeVertex: (points, encoding) => Array.from(globe.probeVertexHeights(points, encoding)),
      detailLod: () => globe.detailLodUniform(),
      pickSurface: (x, y) => globe.pickSurface(x, y),
      cameraPosition: () => globe.cameraPosition(),
      heightAt: (lat, lon, octaves) => heightAt(lat, lon, octaves),
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
      async setupCountries(region = 'world'): Promise<SetupCountryInfo[]> {
        const prepared = await loadPrepared(world);
        const analysis = prepared.analyse(region);
        return prepared.countries.map((c) => {
          const e = countryEligibility(analysis, c);
          return { id: c.id, a3: c.a3, nameEn: c.nameEn, nameSv: c.nameSv, cells: c.cells, ok: e.ok, reasonKey: e.key, landmass: e.landmass, capitalCell: c.capitalCell };
        });
      },
      async buildHash(config, ticks) {
        const prepared = await loadPrepared(world);
        const r = createMatch(prepared, config);
        if (!r.ok) return { ok: false, code: r.error.code, key: r.error.key };
        const seats = r.match.seats.length;
        const h = hashBuiltMatch(r.match, ticks);
        return { ok: true, initial: h.initial, after: h.after, seats };
      },
      ownedOutside(region): number {
        if (session === null) return -1;
        const mask = regionMask(region, world.sim.width, world.sim.height);
        if (mask === null) return 0;
        const owner = session.view.owner;
        let n = 0;
        for (let i = 0; i < owner.length; i++) if ((owner[i] as number) !== 0 && mask[i] === 0) n++;
        return n;
      },
      seatCells(): { cells: number[]; capitals: number[] } | null {
        if (session === null) return null;
        const st = session.view.stats;
        const cells: number[] = [];
        const capitals: number[] = [];
        for (let seat = 0; seat < session.view.seats; seat++) {
          cells.push(st.cells[seat] as number);
          capitals.push((st.capital[seat] as number) - 1);
        }
        return { cells, capitals };
      },
    };
    window.__test = hooks;
    return disposeAll; // deterministic mode: no requestAnimationFrame loop
  }

  window.addEventListener('resize', () => globe.resize(window.innerWidth, window.innerHeight, Math.min(window.devicePixelRatio || 1, quality.maxDpr)), { signal });
  // The normal page opens with the start screen; the match begins when Play is pressed (or Start on the setup screen).
  mountMenu();
  let last = performance.now();
  let sinceOverlay = 0;
  const loop = (now: number): void => {
    if (!alive) return;
    const dt = (now - last) / 1000;
    last = now;
    if (dt > 0) {
      fps = fps * 0.9 + (1 / dt) * 0.1;
      stats.push(dt * 1000);
      advanceFx(Math.min(dt, 0.1));
      if (groundView === null && startScreen !== null && setupScreen === null && session === null) globe.setView({ lon: wrapLon(globe.rig.view.lon + Math.min(dt, 0.1) * START_SPIN_DEG_PER_S) }); // the globe turns slowly behind the start screen
      updateMarker();
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
