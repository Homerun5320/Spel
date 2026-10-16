// The stylised Earth scene (M02): loads the packs through the data layer, builds the Globe, wires mouse input, hover
// tooltip, the F3 overlay and the `?test=1` hooks. The only code in `src` that drives the fx clock from real frames.
import { createWorldLoader, type WorldLoad } from '../data';
import { advanceFx, fxNow, setFxTime } from '../render/clock';
import { heightAt } from '../render/detail';
import { wrapLon } from '../render/geo';
import { buildOwnerPalette } from '../render/ownerPalette';
import { rgbOfHex } from '../ui/flag';
import type { ViewState } from '../render/camera';
import type { FlyOptions } from '../render/flyTo';
import { Globe, probeGpuStrings, type GlobeInfo, type GlobePick, type ScreenHit, type WorldData } from '../render/globe';
import { AdaptiveResolution } from '../render/adaptive';
import { classifyRenderer, readableGpuName, type GpuClass } from '../render/gpuClass';
import type { WorldTextureName } from '../render/textures';
import { fitViewDistKm } from '../render/fit';
import { BOOKMARKS, CAPITAL_BOOKMARK, DEFAULT_START_TIME, DEFAULT_START_VIEW, GROUND_VIEWS, type BookmarkName } from '../render/views';
import { cellToLatLon, groundHeightAt, latLonToCell } from '../render/transforms';
import { STRUCTURE_MODELS } from '../render/structureModels';
import type { DrawnStructure } from '../render/structures';
import type { DrawnHeli } from '../render/heliLayer';
import type { DrawnDistrict } from '../render/districts';
import { setBookmarkHandler } from './bookmarks';
import { InputStack, attachDomInput, createBaseMode, setContextHandler, setPauseHandler, type ContextCommand, type ContextHandler, type InputTarget } from './input';
import { isQualityTier, resolveQualityChoice } from '../render/quality';
import type { TerrainMode } from '../render/terrainMaterial';
import { FrameStats } from '../ui/frameStats';
import { latLonOfCell } from './cellGeo';
import { buildPerfReport, createPerfOverlay, type PerfContext, type PerfOverlay, type PerfReport } from '../ui/perfOverlay';
import type { PerfSceneSection } from '../ui/perfSceneReport';
import { PerfSceneRun, type PerfSceneHost } from './perfScene';
import { createBuildBar, type BuildBar } from '../ui/buildBar';
import { buildRejectKey, spawnPhaseBlocks } from '../ui/buildReasons';
import { REJECT_PHASE } from '../ui/hudCodes';
import { BEACH_ESTABLISHED, BEACH_REVERTED, BeachheadWatcher, beachSecondsLeft, ownBeachSeeds } from '../ui/beachheadInfo';
import { HeliWatcher, MISSION_LANDED, MISSION_LOST, MissionWatcher, heliPanelInfo, ownHeliRows, padHeliOf, type HeliRow } from '../ui/heliInfo';
import { createDeployBox, type DeployBox } from '../ui/deployBox';
import { createDeployMode, type DeployMode } from './deployMode';
import { LaunchPreviewer, previewLaunch, type PreviewRequest, type PreviewResult } from './launchPreview';
import { rejectKey } from '../ui/hudLogic';
import { mountToasts, showToast, tickToasts, visibleToastKeys } from '../ui/toast';
import { createHelpOverlay, type HelpOverlay } from '../ui/helpOverlay';
import { createDiploCards, createDiploPanel, type DiploActions, type DiploCards, type DiploPanel } from '../ui/diploPanel';
import { attackBlock, DiploWatcher, NEWS_ACCEPTED, NEWS_DECLINED, NEWS_EXPIRED, NEWS_INCOMING } from '../ui/diploModel';
import { diplomacyRefusalKey } from '../ui/diploReasons';
import { attachHotkeys, hotkeys, registerGameHotkeys } from './hotkeys';
import { createPlacementMode, type PlacementMode, type PlacementState } from './placement';
import { AIR_MODE_AGL_M, REJECT_HELI_NO_PAD, REJECT_HELI_NO_ROUTE, createLos, createLosTerrain, createNav, launchHeliBody, recallHeliBody, validateLaunchHeli, type Nav } from '../sim/public';
import { STRUCT_CITY, STRUCT_FACTORY, produceHeliBody, buildBody, buildDistrictBody, deleteBody, removeDistrictBody, upgradeBody, upgradeDistrictBody, validateBuild } from '../sim/public';
import { createCityViewPanel, type CityViewPanel } from '../ui/cityViewPanel';
import { BEACH_RING_MAX, CAMERA_FOV_DEG, EARTH_RADIUS_KM } from '../render/config';
import type { DrawnFront } from '../render/frontLayer';
import type { SimView } from '../sim/public';
import { NationLabels, type LabelCamera, type LabelInfo, type LabelSource } from '../ui/nationLabels';
import { LABELS } from '../ui/uiConfig';
import { cityFitFlight, cityFlightNeeded, createCityViewMode, isDoubleClick } from './cityViewMode';
import type { InputMode } from './input';
import { CLASS_MOUNTAIN } from '../sim/terrain';
import { createSelectionPanel, type SelectionPanel } from '../ui/selectionPanel';
import { rangeRingCells, selectionInfo } from '../ui/structureInfo';
import { createSelectionMode, pickStructure, type SelectionMode } from './structureSelect';
import { createMatchHud, notConquerableText, rejectText, type MatchHud, type MatchHudModel } from '../ui/matchHud';
import { getLanguage, onLanguageChange, setStrictI18n, t, type TextKey } from '../ui/i18n';
import { CITY_VIEW, DEPLOY, GPU_TIP_PREF_KEY, START_FLY_KM, START_SPIN_DEG_PER_S, SETUP_IDLE_DIST_KM } from '../ui/uiConfig';
import { mountStartScreen, type StartScreen } from '../ui/startScreen';
import { applyStartLanguage } from './langPref';
import { getPref, setPref } from './prefs';
import { rememberCityStyle, startCityStyle } from './cityStyle';
import type { CityStyle } from '../render/cityTiers';
import { createMatch, type BuiltMatch, type MatchSetupConfig } from './matchSetup';
import { countryEligibility } from './eligibility';
import { regionMask, type RegionId } from '../data/regions';
import { prepareWorld, type PreparedWorld } from './matchWorld';
import { mountSetupScreen, type SetupScreen } from './setupScreen';
import { SETUP_PREF_KEY, checkDraft, defaultDraft, draftFromStored, isStoredSetup, parseSeed, storedOf, type SetupDraft, type StoredSetup } from './setupModel';
import { hashBuiltMatch } from './match';
import { createMatchPanels, type MatchPanels, type ResultView } from '../ui/matchPanels';
import { MatchWatcher, RESTART_PREF, humanStatus, reasonLine, resultRows } from '../ui/matchFlow';
import { createSeatLabels, type SeatLabels } from '../ui/seatLabels';
import { winInfoOfView, winSummaryText } from './winSetup';
import { nextFlagSeed } from './setupScreen';
import type { MatchView } from '../sim/public';
import { TREATY_ALLIANCE, acceptTreatyBody, breakTreatyBody, declineTreatyBody, imposeEmbargoBody, liftEmbargoBody, proposeTreatyBody } from '../sim/public';
import { PHASE_IMMUNITY, PHASE_SPAWN } from '../sim/flow';
import { DEBUG_GIVE_MAX, REJECT_NOT_SPAWNED } from '../sim/intents';
import { seatToOwner } from '../sim/state';
import type { IntentBody } from '../sim/intents';
import { clickMeaning, resolveClickCell } from './clickTarget';
import { resolveCommand, type CommandSelection, type CommandTarget } from './commandResolver';
import { MatchSession, winForPlay } from './match';
import { adaptiveEnabled, type AppParams, type AppState, type SceneParams } from './params';
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
  /** M10: the structures of the snapshot (every owner): how many are alive, and per type number (index = type). */
  structures: { count: number; byType: number[] };
}

/** What `__test.props()` reports of the structure layer and the placement mode (plain data). */
export interface PropsInfo {
  /** Instances in the draw per structure type number (only types with a model). */
  counts: Record<number, number>;
  /** All instances in the draw. */
  total: number;
  /** Structures left out because a type's instance cap was reached. */
  dropped: number;
  /** Triangles of one City instance (the model's size). */
  cityTriangles: number;
  /** The drawn structures with their float64 placement (id, type, owner, cell, level, lat, lon, base radius, base height in render metres after the exaggeration). */
  list: readonly DrawnStructure[];
  /** Districts-2b: the district layer: instances per kind (index = kind), the total, the triangles in the draw, the left-out count, whether the mesh is drawn, the drawn districts. */
  districts: { counts: readonly number[]; total: number; triangles: number; dropped: number; drawn: boolean; list: readonly DrawnDistrict[] };
  /** Look-1: the City style now drawn. */
  cityStyle: CityStyle;
  /** The placement mode: the type being placed (0 = none) and the ghost. */
  placing: number;
  ghost: PlacementState | null;
  /** The text keys of the toasts on screen. */
  toasts: string[];
  /** Whether the build bar is shown, and the price on the City button. */
  buildBar: { visible: boolean; cityPrice: number };
  /** M10-4: the selected structure id (-1 = none), the ring mesh, the icons and the lit night lights. */
  selection: { id: number; panelVisible: boolean; ring: { visible: boolean; rangeCells: number; drawIndices: number } };
  icons: number;
  /** Lit city lights (levels of finished Cities on the night side). */
  litLights: number;
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

/** M13b: what `__test.deploy()` reports. */
export interface DeployInfo {
  active: boolean;
  factory: number;
  hover: number;
  markerCell: number;
  markerState: number;
  routeVertices: number;
  visibleMeshes: number;
  status: 'idle' | 'pending' | 'ready';
  reason: number;
  etaSeconds: number;
  fuelCells: number;
  troops: number;
  queriesSent: number;
  queriesDropped: number;
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
   * M08 (RTS camera): flies to a ground point (`lat`, `lon`) and arrives `altAglM` metres over it (kept in the options of `FlyOptions`: tilt,
   * heading, durationS; 0 jumps at once); with `distKm` and no altitude it is the classic orbit flight. `bookmark(name, durationS?)` flies to
   * 'alps', 'himalaya', 'andes' or 'capital' (false when the place is unknown yet). All time is the fx clock (`advance` and `render(dt)` step it).
   */
  flyTo(lat: number, lon: number, distKm: number, options?: FlyOptions): void;
  bookmark(name: BookmarkName, durationS?: number): boolean;
  /** True while a flight is under way; `cameraMix()` is the weight of the RTS camera (0 globe .. 1 RTS) and `holdAgl()` the height it keeps over the ground (null: none). */
  flightActive(): boolean;
  cameraMix(): number;
  /**
   * M08 (the performance scene): runs the SHORTENED script (`?scene=perf` in test mode; flights of one fx second, rests of 0.2, fx steps of `dt`
   * seconds, default 0.1) frame by frame with a real draw each and returns the section of the report; `perfReport()` is the whole report the
   * overlay's "Kopiera rapport" shows (with the scene section once a run exists). The numbers are logged, never asserted against wall time.
   */
  runPerfScene(o?: { dt?: number; maxFrames?: number }): PerfSceneSection;
  perfReport(): PerfReport;
  /**
   * AutoTier-2 (D160, the adaptive resolution; off in test mode unless `?adapt=1` / `enable(true)`): `enable(on)` switches the regulator, `feed(ms, n)` hands it
   * `n` frame times (the apply step included), `simulate(a, b, frames)` feeds `frames` frames of a synthetic GPU whose frame time is `a + b * scale^2` ms (a cost per
   * pixel), `info()` is the state: the scale, the drawing buffer against the CSS size, the steps taken.
   */
  adaptive: {
    enable(on: boolean): void;
    feed(ms: number, n?: number): AdaptiveInfo;
    simulate(a: number, b: number, frames: number): AdaptiveInfo;
    info(): AdaptiveInfo;
  };
  holdAgl(): number | null;
  /** M08: the ground under a pixel (`pickGround`): latitude, longitude, radius (Earth radii) and seen height (render metres) of the hit; null when the ray misses the globe. */
  pickGround(x: number, y: number): { lat: number; lon: number; radius: number; seenHeightM: number } | null;
  /**
   * M08 audit pass: installs the handler of the input stack's context command (what M20a's resolver will be: a right click without a drag, or a long press,
   * with an empty stack) or of its pause command (Escape with an empty stack, M18's pause menu), so that an e2e can watch the real page's wiring.
   */
  onContext(fn: ContextHandler): void;
  onPause(fn: () => void): void;
  /** M18-2 (test only): makes the panels see this seat (0-based) as eliminated, whatever the sim says; -1 undoes it. */
  forceEliminated(seat: number): void;
  /** M20a-lite: the entries of the hotkey registry (the help overlay lists the ones that are not hidden). */
  hotkeys(): Array<{ id: string; keys: string[]; scope: string; hidden: boolean }>;
  /** M20a-lite: the help overlay (`?`) is open. */
  helpOpen(): boolean;
  /** M18-2 (test only): the sim's match view as plain data (result and per-seat statistics), null before the match exists. */
  matchInfo(): { winFlags: number; leaderSeat: number; requiredPct: number; holdSeat: number; holdTicksLeft: number; ended: boolean; winnerSeat: number; reason: number; endTick: number; players: number; score: number[]; landStd: number[]; peakLand: number[]; built: number[]; conquered: number[]; eliminated: number[] } | null;
  /** M08: `groundHeightAt` (the very function `heightAt`, render metres, all octaves unless given) bound to the page's raster. */
  groundHeightAt(lat: number, lon: number, octaves?: number): number;
  /**
   * M07b (debug hooks, ARCHITECTURE "Terrain detail"): the readback probe runs the SAME GLSL functions as the chunk vertex shader.
   * `probeEncoding()` is 'float' (an RGBA32F target, EXT_color_buffer_float) or 'bytes' (packed RGBA8); `probeHash(items, encoding?)` returns the
   * integer hash of each [ix, iy, iz, seed] (lattice coordinates already shifted by 2^20, the seed a uint32); `probeHeight(points, encoding?)`
   * the height in render metres of each [latitude, longitude, octaves] (latitude and longitude are float32 on the GPU).
   */
  probeEncoding(): 'float' | 'bytes';
  probeHash(items: Array<[number, number, number, number]>, encoding?: 'float' | 'bytes'): number[];
  probeHeight(points: Array<[number, number, number]>, encoding?: 'float' | 'bytes'): number[];
  /** M07b audit: the GLSL local relief in metres of each [latitude, longitude] (-1 on sea): the 3x3 rule, the 100 m floor and the polar fade read back. */
  probeRelief(points: Array<[number, number]>, encoding?: 'float' | 'bytes'): number[];
  /** M07b audit (run-time levers of the terrain cost, M24a): `setDetailBias(octaves)` moves the distance law of the vertex octaves (0 .. -3, GPU and picking together), `setFineDetail(on)` switches the near-view mottling of the fragment shader; the getters return the current values. */
  setDetailBias(octaves: number): void;
  detailBias(): number;
  setFineDetail(on: boolean): void;
  fineDetail(): boolean;
  /** M07b audit: the controls of the pop tests (D154): `setOctaveLimit('level')` switches the distance law of the octaves off (octaves by the chunk's level alone), `'none'` every limit (12 octaves everywhere), `'law'` is the real thing. */
  setOctaveLimit(mode: 'law' | 'level' | 'none'): void;
  /** M07b audit: the chunk density lever (every split distance times `scale`, 0.5 .. 2; the octave law follows below 1) and the current value. */
  setChunkDensity(scale: number): void;
  chunkDensity(): number;
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
  /** M10: the structure layer (instance counts per type, the drawn structures) and the placement mode. */
  props(): PropsInfo;
  /** M13a-1: the helicopters the layer drew (id, owner, state, cell position, lat / lon, metres above the ground, parked). */
  helis(): readonly DrawnHeli[];
  /** M13a-1: forces the rotor angle (radians; null = the fx clock) and switches the helicopter layer on or off, so a test can tell the rotor's pixels and the layer's draw call. */
  heliSpin(angle: number | null): void;
  heliLayer(on: boolean): void;
  /** M20a-2: the front arrows the layer drew, the layer's state (arrows, fade, whether its draw call is made) and a switch for a draw-call count. */
  fronts(): { arrows: readonly DrawnFront[]; count: number; fade: number; visible: boolean };
  frontLayer(on: boolean): void;
  /** M20a-2: the nation labels shown now (boxes in window pixels), their DOM write count and whether the labels are switched on; `labelsOn` switches labels and arrows together (key N). */
  labels(): { shown: LabelInfo[]; writes: number; on: boolean };
  labelsOn(on: boolean): void;
  /** Fix-4B: the own beachhead rows of the mirror (slot, seed cell, landing tick, cells held, seconds left) and what the ring layer draws. */
  beach(): { rows: Array<{ slot: number; seed: number; landTick: number; cells: number; seconds: number }>; ring: { count: number; cells: number[]; drawIndices: number } };
  /** M13b: the deploy mode (active, the Factory, the hovered cell, what the layer shows, the preview's verdict and counters) and the deploy layer's switch for a draw-call count. */
  deploy(): DeployInfo;
  deployLayer(on: boolean): void;
  /** M13b: the preview of a request answered now, synchronously, from the page's own Nav (a test compares it with the sim; null = no Nav). */
  previewNow(factory: number, lzCell: number, troops: number, mode: 0 | 1): { reason: number; waypoints: number; etaSeconds: number } | null;
  /** Look-1: switches the City style live (the preference is not written in test mode). */
  setCityStyle(style: CityStyle): void;
  /** Look-2: draws structure `id` (and the districts of a City) as if it had `level`; render only. `null` clears. */
  setLevelOverride(id: number, level: number | null): void;
  /** Sends a raw intent body of any seat through the host (what a UI would; used to try illegal ones). Effective T + 2 ticks later. */
  submit(body: IntentBody): void;
  /** Test-only gift: sends a DebugGive intent (valid only when the match config has debugIntents, which test mode sets). Effective T + 2 ticks later. At most DEBUG_GIVE_MAX (1 000 000) of each per call: more throws (the sim would drop the intent silently). */
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
  /** CamFix (D158): the tilt the camera shows (the user's tilt eased down at the far distances where the whole globe has to fit) and the farthest distance of this window, km. */
  shownTilt(): number;
  maxDist(): number;
  /** Polish-1: what a window resize does (the camera rig's viewport and the buffer), at CSS size `w` x `h` (test mode has no resize listener). */
  resize(w: number, h: number): void;
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

/** What `__test.adaptive` reports. */
export interface AdaptiveInfo {
  enabled: boolean;
  scale: number;
  density: number;
  steps: number;
  scaleMean: number;
  scaleMin: number;
  bufferWidth: number;
  bufferHeight: number;
  cssWidth: number;
  cssHeight: number;
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
          sim: { width: world.sim.width, height: world.sim.height, terrainClass: world.sim.terrainClass, meanElev: world.sim.meanElev, maxElev: world.sim.maxElev, cosQ15: world.meta.sim.cosQ15 },
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

  // The card class (AutoTier-1), read once: the real strings in the live page, the `?gpu=<string>` hook in test mode (the tip and the report only;
  // the test tier stays). The automatic tier is never written to the prefs; a stored `quality` pref (a valid tier) is read as the player's choice.
  const gpuStrings = params.test ? (ctx.state.raw.gpu !== undefined ? { renderer: ctx.state.raw.gpu, vendor: '' } : null) : probeGpuStrings();
  const gpuClass: GpuClass = gpuStrings === null ? 'capable' : classifyRenderer(gpuStrings.renderer, gpuStrings.vendor);
  const qualityPref = getPref<string | null>('quality', null, (v): v is string => typeof v === 'string' && isQualityTier(v));
  const fromDev = /(^|[#_])quality-/.test(window.location.hash);
  const choice = resolveQualityChoice({ test: params.test, quality: ctx.scene.quality, chunkTier: ctx.state.terrain.chunkTier, gpuClass, pref: qualityPref, fromDev });
  const quality = choice.settings;
  const tierSource = choice.source;
  // The tip says "the game chose low graphics": true only when the card class made that choice (an explicit tier or a pref says nothing like it).
  // In test mode the tier stays `test`, so the `?gpu=` hook shows the tip of a weak class directly.
  const weakGpu = gpuClass !== 'capable' && gpuStrings !== null && (tierSource === 'auto' || (params.test && ctx.state.raw.gpu !== undefined));
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

  const globe = new Globe({ canvas, width, height, dpr, quality, world, preserveDrawingBuffer: params.test, terrain: ctx.state.terrain.terrain, chunkDebug: ctx.state.terrain.chunkDebug, detail: ctx.state.raw.detail !== '0', fineDetail: ctx.state.raw.mottle !== '0' });
  globe.helis.recordDrawn = params.test; // the list of drawn helicopters is read only by the test hooks (Fix-4B: no garbage per table otherwise)
  globe.deploy.setStyle(DEPLOY.style); // M13b: the colours of the route and the landing-zone marker (src/ui/uiConfig.ts)
  globe.setView({ ...DEFAULT_START_VIEW, distKm: fitViewDistKm(DEFAULT_START_VIEW.distKm, width / height) }); // CamFix-2: a tall window starts farther out so that the disc fits
  const groundView = ctx.state.view !== null && globe.terrainMode === 'chunks' ? GROUND_VIEWS[ctx.state.view] : null; // `?view=alps-valley` (M07a)
  if (groundView !== null) globe.setGroundView(groundView);
  if (params.blank) canvas.style.visibility = 'hidden'; // debug: the negative e2e test needs an empty picture
  setFxTime(groundView?.time ?? DEFAULT_START_TIME); // the sun starts 67 degrees west of the default view so that the terminator is visible at once

  // Look-1: the City style ('old' / 'new'): the address, else the stored choice; a change is live (the vertex buffers of the City are swapped) and remembered.
  const applyCityStyle = (style: CityStyle): void => {
    globe.structures.setCityStyle(style);
    rememberCityStyle(style, params.test);
  };
  globe.structures.setCityStyle(startCityStyle(ctx.state.raw, params.test));

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

  const unmountToasts = mountToasts(wrapper);
  let firstFrameMs: number | null = null;
  let frames = 0;
  // the input stack's per-frame tick (the long-press timer of the touch input); set where the stack is built
  let tickInput: (now: number) => void = () => undefined;
  // Fix-4B: the pulsing rings of the own beachheads follow the beachhead table (written only when its version moved)
  let beachRingVersion = -1;
  const beachSeeds = new Int32Array(BEACH_RING_MAX);
  /** M20a-2: the nation labels follow the camera every frame (they return at once when neither the picture nor the data moved). */
  const updateLabels = (force: boolean): void => {
    if (session === null || nationLabels === null) return;
    const v = globe.rig.view;
    const vw = globe.viewWidth;
    const vh = globe.viewHeight;
    labelCam.altR = v.distKm / EARTH_RADIUS_KM;
    labelCam.viewW = vw;
    labelCam.viewH = vh;
    labelCam.pxPerKm = vh / 2 / Math.tan((CAMERA_FOV_DEG * Math.PI) / 360) / Math.max(1, v.distKm);
    labelCam.poseKey = v.lat * 3.1 + v.lon * 1.7 + v.distKm * 0.013 + v.heading * 0.37 + v.tilt * 0.91 + vw * 0.0011 + vh * 0.0013;
    labelSource.view = session.view;
    labelSource.localSeat = session.localSeat;
    nationLabels.update(labelSource as LabelSource, labelCam, fxNow(), force);
  };
  const renderFrame = (draw = true): void => {
    tickInput(fxNow());
    tickToasts(fxNow());
    if (session !== null) {
      updateMatchFlow();
      // the structures follow the snapshot's table; the construction look follows the interpolated tick
      globe.structures.setTable(session.view.structures, session.view.structuresVersion);
      globe.districts.setTable(session.view.structures, session.view.districts, session.view.structuresVersion); // Districts-2b
      globe.helis.setTable(session.view.helis, session.view.helisVersion); // M13a-1
      if (session.view.beachheadsVersion !== beachRingVersion) {
        beachRingVersion = session.view.beachheadsVersion;
        globe.structures.setBeachRings(beachSeeds, ownBeachSeeds(session.view, session.localSeat, beachSeeds), session.localOwner);
      }
      globe.fronts.setTable(session.view.fronts, session.view.frontsVersion); // M20a-2
      globe.setTickFraction(session.view.tick + (params.test ? 0 : session.alpha()));
    }
    globe.render(draw);
    if (session !== null && nationLabels !== null && labelsWanted) updateLabels(draw && params.test);
    frames++;
    if (draw && firstFrameMs === null) firstFrameMs = performance.now();
  };

  // --- The match (M05, M06) -----------------------------------------------------------------------------------------------
  // A session is the sim behind its host plus the page's read-only mirror of it. Test mode starts one at once (no start screen, unless
  // `#menu` asks for the menus); the normal page starts it when Play is pressed (the standard M05 match: click to spawn) or when the setup
  // screen's Start has built a match with `createMatch`. The UI below only sends intents (`session.submit`) and reads `session.view`.
  let session = null as MatchSession | null;
  let hud = null as MatchHud | null;
  // M20a-2: the nation labels and the front arrows share one switch (key N, remembered in the preference LABELS.prefKey); a test page starts with them off unless `labels=1` (the goldens)
  let nationLabels = null as NationLabels | null;
  let labelsWanted = params.test ? ctx.state.raw.labels === '1' : getPref<boolean>(LABELS.prefKey, true, (v): v is boolean => typeof v === 'boolean');
  const labelCam: { -readonly [K in keyof LabelCamera]: LabelCamera[K] } = { project: (la, lo) => globe.project(la, lo), altR: 0, viewW: 0, viewH: 0, poseKey: 0, pxPerKm: 0 };
  const labelSource: { view: SimView; localSeat: number; nameOf(seat: number): string; colorOf(seat: number): string } = {
    view: null as unknown as SimView,
    localSeat: 0,
    nameOf: (seat) => (flowLabels ?? createSeatLabels([], 1, 0)).name(seat),
    colorOf: (seat) => seatColor(seat),
  };
  const setLabelsWanted = (on: boolean): void => {
    labelsWanted = on;
    nationLabels?.setEnabled(on);
    globe.fronts.setEnabled(on);
    if (!params.test) setPref(LABELS.prefKey, on);
  };
  globe.fronts.setEnabled(labelsWanted);
  let help = null as HelpOverlay | null;
  let helpMode = null as InputMode | null;
  // M18c-2: the diplomacy panel (an input mode while it is open), the proposal cards and the watcher that turns the proposal table into toasts
  let diploPanel = null as DiploPanel | null;
  let diploCards = null as DiploCards | null;
  let diploMode = null as InputMode | null;
  let diploWatcher = null as DiploWatcher | null;
  let buildBar = null as BuildBar | null;
  let buildRoot = null as HTMLElement | null;
  let buildBarWanted = false;
  /** The structure type being placed (0 = none) and its mode on the input stack. */
  let placing = 0;
  let placementMode = null as PlacementMode | null;
  /** M10-4: the selected structure (-1 = none), its mode on the input stack and the panel. */
  let selectedId = -1;
  let selectionMode = null as SelectionMode | null;
  let selectPanel = null as SelectionPanel | null;
  /** M13b: the deploy mode (send a helicopter) on the input stack, the Factory it sends from, the box in the Factory panel and the throttled preview. */
  let deployMode = null as DeployMode | null;
  let deployFactory = -1;
  let deployBox = null as DeployBox | null;
  let deployHover = -1;
  const deployPreviewer = new LaunchPreviewer((req) => Promise.resolve(runPreview(req)), DEPLOY.previewIntervalS);
  /** Districts-2a: the city view (the City id while open, -1 = closed), its input mode and panel. */
  let cityId = -1;
  /** The open-city flight is the flight running (Escape or closing the view cancels it; a drag or the wheel already do). */
  let cityFlightOn = false;
  let cityMode = null as InputMode | null;
  let cityPanel = null as CityViewPanel | null;
  let lastSelClickId = -1;
  let lastSelClickMs = 0;
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
  // --- The match flow (M18-2): pause menu, result screen, elimination, spectating, restart --------------------------------------------
  // The rules live in the sim (`session.view.match`); this block only shows them. The game is paused behind every panel. "Restart", "Play again"
  // and "To the menu" reload the page: a restart leaves the one-shot pref `RESTART_PREF` that the next boot reads (the same stored setup, a new seed).
  let panels = null as MatchPanels | null;
  let stopPanelLang = null as (() => void) | null;
  const watcher = new MatchWatcher();
  let flowLabels = null as SeatLabels | null;
  let pausedBeforeMenu = false;
  let flowEnded = false;
  let elimHandled = false;
  let forcedElim = -1;
  let forcedFrom = null as MatchView | null;
  let forcedView = null as MatchView | null;
  /** The match view the panels read: the sim's, or (test hook) the sim's with one seat forced to eliminated. */
  const flowMatch = (): MatchView => {
    const m = (session as MatchSession).view.match;
    if (forcedElim < 0) return m;
    if (forcedFrom !== m || forcedView === null || forcedView.eliminated[forcedElim] !== 1) {
      const eliminated = Uint32Array.from(m.eliminated);
      eliminated[forcedElim] = 1;
      forcedFrom = m;
      forcedView = { ...m, eliminated };
    }
    return forcedView;
  };
  const nameOfSeat = (seat: number): string => flowLabels?.name(seat) ?? '';
  const resultView = (): ResultView | null => {
    const s = session;
    if (s === null) return null;
    const m = flowMatch();
    const landShare = s.view.stats.landShareQ15;
    return {
      reason: reasonLine(m, s.localSeat, nameOfSeat),
      rows: resultRows(m, s.view.players, s.localSeat, nameOfSeat, seatColor, (seat) => ((landShare[seat] as number) / 32768) * 100),
    };
  };
  const reloadPage = (): void => {
    window.location.reload();
  };
  /** Restart / play again: the same setup with the next seed, through a reload. */
  const restartMatch = (): void => {
    const s = session;
    if (s === null) return;
    if (s.built === null) {
      setPref(RESTART_PREF, 'standard');
    } else {
      const stored = getPref<StoredSetup | null>(SETUP_PREF_KEY, null, isStoredSetup as (v: unknown) => v is StoredSetup);
      if (stored === null) setPref(RESTART_PREF, null);
      else {
        const seed = parseSeed(stored.seed);
        setPref(SETUP_PREF_KEY, { ...stored, seed: String(nextFlagSeed(seed ?? s.built.config.seed)) });
        setPref(RESTART_PREF, 'built');
      }
    }
    reloadPage();
  };
  const toMenu = (): void => {
    setPref(RESTART_PREF, null);
    reloadPage();
  };
  const resumeFromMenu = (): void => {
    if (session === null || panels === null || !panels.pauseOpen) return;
    panels.closePause();
    session.setPaused(pausedBeforeMenu);
  };
  /** Escape with an empty input stack (the stack itself closes a mode first): opens the pause menu, or closes it again. */
  const togglePauseMenu = (): void => {
    if (session === null || panels === null) return;
    if (panels.pauseOpen) {
      resumeFromMenu();
      return;
    }
    if (panels.modalOpen || flowEnded) return;
    pausedBeforeMenu = session.isPaused;
    session.setPaused(true);
    panels.openPause();
  };
  /** A modal (pause menu, elimination panel, result screen) is open or the match is over: the match keys and the reserved keys but Escape are dead (Fix-3B). */
  let structToastShown = false;
  const keysBlockedByModal = (): boolean => panels !== null && (panels.modalOpen || flowEnded);
  /** Once per frame: the toasts for other nations' elimination and capital loss, the elimination panel, the result screen. Allocates only when something happens. */
  const updateMatchFlow = (): void => {
    const s = session;
    if (s !== null && !structToastShown && globe.structures.dropped > 0) {
      structToastShown = true; // Fix-3B: said once per match when the structure layer first runs out of allowance (the rest keep their icon)
      showToast('toast.structuresSimplified', {}, 'info');
    }
    if (s === null || panels === null || flowEnded) return;
    const m = flowMatch();
    const ev = watcher.scan(m, s.view.players, s.localSeat);
    if (ev !== null) {
      if (ev.eliminated.length > 0) showToast('toast.eliminated', { names: ev.eliminated.map(nameOfSeat).join(', ') }, 'info');
      if (ev.capitalLost.length > 0) showToast('toast.capitalLost', { names: ev.capitalLost.map(nameOfSeat).join(', ') }, 'warn');
    }
    const status = humanStatus(m, s.localSeat);
    if (status === 'over') {
      flowEnded = true;
      panels.setSpectating(false);
      panels.hideEliminated();
      panels.closePause();
      s.setPaused(true); // the match is decided: the clock stops
      panels.showResult();
    } else if (status === 'eliminated' && !elimHandled) {
      elimHandled = true;
      s.setPaused(true);
      panels.showEliminated();
    }
  };
  const mountFlow = (s: MatchSession): void => {
    flowLabels = s.labels ?? createSeatLabels([], s.view.players, s.localSeat);
    flowEnded = false;
    elimHandled = false;
    structToastShown = false;
    globe.structures.setLocalOwner(s.localOwner);
    beachRingVersion = -1;
    beachWatcher.reset();
    panels = createMatchPanels(
      wrapper,
      {
        resume: resumeFromMenu,
        restart: restartMatch,
        toMenu,
        setSpeed: (sp) => s.setSpeed(sp),
        spectate: () => {
          elimHandled = true;
          panels?.hideEliminated();
          panels?.setSpectating(true);
          s.setPaused(false);
        },
        playAgain: restartMatch,
      },
      { summary: () => winSummaryText(winInfoOfView(s.view.match)), speed: () => (s.speed === 0 ? 1 : s.speed), result: resultView },
    );
    stopPanelLang = onLanguageChange(() => panels?.refresh());
    setPauseHandler(togglePauseMenu);
  };
  /** Everything that follows a started session (the globe shows its ownership, the HUD is built and filled before its first frame). */
  const attachSession = (s: MatchSession): void => {
    session = s;
    globe.ownership.setFromOwners(s.view.owner);
    s.view.onFrame((m, d) => {
      if (d.fullOwner !== null) globe.ownership.setFromOwners(m.owner);
      else globe.ownership.applyCells(d.cells, d.owners);
    });
    hud = createMatchHud(wrapper, { setCommit: (p) => s.setCommit(p), setSpeed: (sp) => s.setSpeed(sp), togglePause: () => s.togglePause(), openDiplomacy: () => toggleDiplomacy() }, { seatColor, labels: s.labels, throttle: !params.test });
    hud.setVisible(!params.test || ctx.state.raw.hud === '1'); // test mode hides it (the globe goldens), `#hud` / `?hud=1` shows it
    help = createHelpOverlay(wrapper, () => hotkeys.listed()); // generated from the registry (M20a-lite)
    nationLabels?.dispose();
    nationLabels = new NationLabels(wrapper);
    nationLabels.setEnabled(labelsWanted);
    globe.fronts.setLocalOwner(s.localOwner);
    // The build bar (M10): its own layer over the canvas, shown with the HUD and once you have spawned.
    buildRoot = document.createElement('div');
    buildRoot.className = 'hud-root';
    buildRoot.dataset.testid = 'build-root';
    wrapper.appendChild(buildRoot);
    buildBar = createBuildBar(buildRoot, { select: (type) => enterPlacement(type) });
    buildBarWanted = !params.test || ctx.state.raw.hud === '1';
    selectPanel = createSelectionPanel(buildRoot, { upgrade: (id) => s.submit(upgradeBody(s.localSeat, id)), remove: (id) => s.submit(deleteBody(s.localSeat, id)), openCity: (id) => openCity(id), produceHeli: (id) => s.submit(produceHeliBody(s.localSeat, id)) });
    // M13b: the deploy block and the helicopter list live in the Factory panel's helicopter box
    deployBox = createDeployBox(selectPanel.heliBox, {
      open: () => (deployMode !== null ? exitDeploy() : enterDeploy(selectedId)),
      cancel: () => exitDeploy(),
      recall: (heli) => s.submit(recallHeliBody(s.localSeat, heli)),
    });
    cityPanel = createCityViewPanel(buildRoot, {
      build: (id, slot, kind) => s.submit(buildDistrictBody(s.localSeat, id, slot, kind)),
      upgrade: (id, slot) => s.submit(upgradeDistrictBody(s.localSeat, id, slot)),
      remove: (id, slot) => s.submit(removeDistrictBody(s.localSeat, id, slot)),
      upgradeCity: (id) => s.submit(upgradeBody(s.localSeat, id)),
      close: () => closeCity(),
    });
    buildBar.setVisible(false);
    mountFlow(s);
    // M18c-2: diplomacy. The panel and the cards only SEND intents (the sim refuses what the rules forbid) and read the sim; the watcher makes the toasts.
    const L0 = s.localSeat;
    const diploActions: DiploActions = {
      propose: (seat, treaty) => s.submit(proposeTreatyBody(L0, seat, treaty)),
      accept: (from) => s.submit(acceptTreatyBody(L0, from)),
      decline: (from) => s.submit(declineTreatyBody(L0, from)),
      breakTreaty: (seat) => s.submit(breakTreatyBody(L0, seat)),
      impose: (seat) => s.submit(imposeEmbargoBody(L0, seat)),
      lift: (seat) => s.submit(liftEmbargoBody(L0, seat)),
      close: () => closeDiplomacy(),
    };
    const diploOpts = { nameOf: nameOfSeat, colorOf: seatColor };
    diploPanel = createDiploPanel(wrapper, diploActions, diploOpts);
    diploCards = createDiploCards(wrapper, diploActions, diploOpts);
    diploWatcher = new DiploWatcher((kind, seat, treaty) => {
      const name = nameOfSeat(seat);
      if (kind === NEWS_INCOMING) showToast(treaty === TREATY_ALLIANCE ? 'toast.diplo.incomingAlliance' : 'toast.diplo.incomingTruce', { name }, 'info');
      else if (kind === NEWS_ACCEPTED) showToast('toast.diplo.accepted', { name }, 'info');
      else if (kind === NEWS_DECLINED) showToast('toast.diplo.declined', { name }, 'warn');
      else if (kind === NEWS_EXPIRED) showToast('toast.diplo.expired', { name }, 'warn');
    });
    // The two link chips of the start page sit above the HUD (they are outside the wrapper); the Dev panel lists the same pages.
    setLinkChipsHidden(true);
    refreshHud(); // the HUD is filled before its first frame is drawn
  };
  /** The standard match of M05: you + 5 AI nations + 20 tribes, click anywhere to spawn. */
  const startMatch = async (): Promise<void> => {
    if (session !== null) return;
    const s = await MatchSession.create(
      { width: world.sim.width, height: world.sim.height, terrainClass: world.sim.terrainClass, meanElev: world.sim.meanElev, maxElev: world.sim.maxElev, cosQ15: world.meta.sim.cosQ15 },
      { seed: params.seed, debugIntents: params.test, interpolate: !params.test, ai: ctx.state.raw.ai !== '0', win: winForPlay(params.test && ctx.state.raw.win !== '1') },
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
  const heliWatcher = new HeliWatcher();
  const missionWatcher = new MissionWatcher();
  const beachWatcher = new BeachheadWatcher();
  // the Factory panel's helicopter numbers are asked once per tick, not once per frame
  let heliKeyTick = -1;
  let heliKeyVersion = -1;
  let heliKeyFactory = -1;
  let heliKeySeat = -1;
  let heliCache: ReturnType<typeof heliPanelInfo> | null = null;
  const heliInfoOf = (view: MatchSession['view'], seat: number, factory: number): ReturnType<typeof heliPanelInfo> => {
    if (heliCache === null || view.tick !== heliKeyTick || view.helisVersion !== heliKeyVersion || factory !== heliKeyFactory || seat !== heliKeySeat) {
      heliKeyTick = view.tick;
      heliKeyVersion = view.helisVersion;
      heliKeyFactory = factory;
      heliKeySeat = seat;
      heliCache = heliPanelInfo(view, seat, factory);
    }
    return heliCache;
  };
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
    if (buildBar !== null) {
      buildBar.setVisible(buildBarWanted && (session.view.stats.capital[L] as number) !== 0);
      buildBar.update(session.view, L, placing);
    }
    if (selectedId >= 0) {
      const info = selectionInfo(session.view, L, selectedId);
      if (info === null || !info.owned) {
        exitSelection(); // destroyed, deleted or conquered
      } else {
        const onMountain = session.view.terrainClass[session.view.structures.cell[selectedId] as number] === CLASS_MOUNTAIN;
        globe.structures.setSelection(selectedId, rangeRingCells(info.type, info.level, onMountain));
        selectPanel?.update(buildBarWanted && cityId < 0 ? info : null, onMountain, info.type === STRUCT_FACTORY ? heliInfoOf(session.view, L, selectedId) : null);
        if (info.type === STRUCT_FACTORY && buildBarWanted && cityId < 0) deployBoxFrame(session, selectedId);
      }
    }
    deployFrame(session);
    if (cityId >= 0) {
      const ci = selectionInfo(session.view, L, cityId);
      if (ci === null || !ci.owned || ci.type !== STRUCT_CITY) closeCity(); // destroyed, deleted or conquered
      else cityPanel?.update(session.view, L, buildBarWanted ? cityId : -1);
    }
    const heliNews = heliWatcher.update(session.view, session.view.helisVersion, L);
    if (heliNews === 'produced') showToast('toast.heli.produced', {}, 'info');
    else if (heliNews === 'scrapped') showToast('toast.heli.scrapped', {}, 'warn');
    const mission = missionWatcher.update(session.view, session.view.helisVersion, L);
    if ((mission & MISSION_LANDED) !== 0) showToast('toast.heli.landed', {}, 'info');
    if ((mission & MISSION_LOST) !== 0) showToast('toast.heli.lost', {}, 'warn');
    const beach = beachWatcher.update(session.view, session.view.beachheadsVersion, L);
    if ((beach & BEACH_REVERTED) !== 0) showToast('toast.beach.reverted', {}, 'warn');
    if ((beach & BEACH_ESTABLISHED) !== 0) showToast('toast.beach.established', {}, 'info');
    // M18c-2: the proposals (cards and toasts) and the open panel; all write only when something changed
    diploWatcher?.update(session.view, L);
    if (buildBarWanted) {
      diploCards?.update(session.view, L, session.view.diplomacyVersion);
      diploPanel?.update(session.view, L, session.view.diplomacyVersion, fxNow());
    }
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
  /** An attack click: a treaty party is not attacked (M18c-2): the toast says why and no intent is sent; the sim would refuse it with the same code. */
  const attackOrExplain = (sess: MatchSession, target: number): void => {
    const block = attackBlock(sess.view, sess.localSeat, target);
    if (block !== 0) showToast(diplomacyRefusalKey(block), undefined, 'warn');
    else sess.attack(target);
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
    if (trySelectStructure(x, y)) return;
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
    else if (meaning.kind === 'attack') attackOrExplain(sess, meaning.target); // your own land (kind 'own') does nothing
  };

  // --- Bookmarks and "F" (M08): the RTS camera flies to a place ------------------------------------------------------------------
  const capitalLatLon = (): { lat: number; lon: number } | null => {
    const sess = session;
    if (sess === null) return null;
    const cap = (sess.view.stats.capital[sess.localSeat] as number) - 1; // the stat is cell + 1, 0 = not spawned
    return cap >= 0 ? cellToLatLon(cap, world.sim.width, world.sim.height) : null;
  };
  const flyToBookmark = (name: BookmarkName, durationS?: number): boolean => {
    if (globe.terrainMode !== 'chunks') return false; // the fixed mesh has no ground to fly over
    const opts = durationS === undefined ? {} : { durationS };
    if (name === 'capital') {
      const c = capitalLatLon();
      if (c === null) return false;
      globe.flyTo(c.lat, c.lon, 0, { ...opts, altAglM: CAPITAL_BOOKMARK.altAglM, tilt: CAPITAL_BOOKMARK.tilt, heading: CAPITAL_BOOKMARK.heading });
      return true;
    }
    const b = BOOKMARKS[name];
    globe.flyTo(b.lat, b.lon, 0, { ...opts, altAglM: b.altAglM, tilt: b.tilt, heading: b.heading });
    return true;
  };
  const focusCapital = (): void => {
    flyToBookmark('capital');
  };
  setBookmarkHandler((name) => flyToBookmark(name));

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
      `${i.width}x${i.height} @${i.dpr}x  tier ${i.tier} (${i.meshCols}x${i.meshRows})  gpu ${gpuClass}, tier source ${tierSource}`,
      `adaptive resolution: ${adaptiveOn ? `on, scale ${adaptive.scale}${adaptive.densityReduced ? ', chunk density reduced' : ''} (${canvas.width}x${canvas.height} px)` : 'off'}`,
      terrainLine(),
    ].join('\n');
  };
  // The keys: see the registry below (`registerGameHotkeys`, src/app/hotkeys.ts); the F3 overlay is one of its entries.

  // --- Performance overlay (?perf=1 / #perf) ------------------------------------------------------------------------
  const isPerfScene = ctx.scene.scene === 'perf';
  const stats = new FrameStats(isPerfScene ? 6000 : 600); // the scene's whole run (about 40 s) fits the window
  let perf: PerfOverlay | null = null;
  // The performance scene (M08): the run object exists in the live page from the start and in test mode once `runPerfScene` ran.
  let perfRun: PerfSceneRun | null = null;
  const perfHost: PerfSceneHost = {
    setView: (v) => globe.setView(v),
    flyTo: (lat, lon, distKm, options) => globe.flyTo(lat, lon, distKm, options),
    flightActive: () => globe.flight.active,
    cameraAglM: () => globe.cameraAglM(),
    counters: () => globe.frameCounters(),
    canvas: () => {
      const i = globe.info();
      return { cssWidth: i.width, cssHeight: i.height, pixelWidth: canvas.width, pixelHeight: canvas.height, dpr: i.dpr, devicePixelRatio: window.devicePixelRatio || 1 };
    },
    gpuMs: () => globe.takeGpuMs(),
    gpuAvailable: () => gpuTimerOk,
  };
  let gpuTimerOk = false;
  const perfContext: PerfContext = {
    snapshot: () => ({ ...globe.info(), gpuClass, tierSource, adaptive: adaptiveReport() }),
    stats,
    mode: { test: params.test ? '1' : '0', quality: quality.tier, scene: ctx.scene.scene },
    scene: () => perfRun?.section() ?? null,
    sceneLine: () => perfRun?.line() ?? null,
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
  };
  // --- Adaptive resolution (AutoTier-2, D160) -------------------------------------------------------------------------------
  // On in the live game, off in test mode and in the performance scene (which measures the raw speed) unless `?adapt=1`; `?adapt=0` is always off.
  // The frame time is the GPU time of the draw (the timer extension, when the browser has it: a slow CPU cannot be helped by fewer pixels), else the
  // interval between animation frames. The fx clock is for effects, not for measuring (D160).
  const adaptive = new AdaptiveResolution();
  let adaptiveOn = adaptiveEnabled(ctx.state);
  const applyAdaptive = (): void => {
    globe.setRenderScale(adaptive.scale);
    globe.setChunkDensity(adaptive.density);
    const last = adaptive.steps[adaptive.steps.length - 1];
    if (last !== undefined) console.info(`adaptive resolution: scale ${last.scale}${last.densityReduced ? ', chunk density reduced' : ''} (window median ${last.statMs.toFixed(1)} ms)`);
  };
  const feedAdaptive = (ms: number): void => {
    if (adaptive.push(ms)) applyAdaptive();
  };
  // In the frame loop a step is only noted here and applied at the START of the next frame, right before drawing: resizing the drawing buffer clears it,
  // and applying it after the draw showed one blank frame at every step (Fix-UI).
  let adaptiveDirty = false;
  const feedAdaptiveInLoop = (ms: number): void => {
    if (adaptive.push(ms)) adaptiveDirty = true;
  };
  const adaptiveReport = (): { enabled: boolean; scale: number; scaleMean: number; scaleMin: number; steps: number; densityReduced: boolean } => ({
    enabled: adaptiveOn,
    scale: adaptive.scale,
    scaleMean: adaptive.scaleMean,
    scaleMin: adaptive.scaleMin,
    steps: adaptive.steps.length,
    densityReduced: adaptive.densityReduced,
  });
  const adaptiveInfo = (): AdaptiveInfo => ({
    enabled: adaptiveOn,
    scale: adaptive.scale,
    density: adaptive.density,
    steps: adaptive.steps.length,
    scaleMean: adaptive.scaleMean,
    scaleMin: adaptive.scaleMin,
    bufferWidth: canvas.width,
    bufferHeight: canvas.height,
    cssWidth: globe.info().width,
    cssHeight: globe.info().height,
  });
  // `?scene=perf` turns the overlay on by itself: it carries the progress line and the button that copies the report.
  if (ctx.state.perf || isPerfScene) perf = createPerfOverlay(wrapper, perfContext);
  if (isPerfScene && !params.test) {
    gpuTimerOk = globe.enableGpuTimer();
    perfRun = new PerfSceneRun(perfHost, { quick: false, now: fxNow });
  }
  if (adaptiveOn && !params.test && !isPerfScene) gpuTimerOk = globe.enableGpuTimer();
  const disposeAll = (): void => {
    if (!alive) return;
    alive = false;
    setBookmarkHandler(null);
    abort.abort();
    perf?.dispose();
    hud?.dispose();
    nationLabels?.dispose();
    help?.dispose();
    diploPanel?.dispose();
    diploCards?.dispose();
    buildBar?.dispose();
    buildRoot?.remove();
    unmountToasts();
    stopPanelLang?.();
    panels?.dispose();
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
  // The input mode stack (src/app/input.ts, M08): the base mode is the camera and the click on the match, exactly what this block did inline in
  // M05 and M06; later modes push themselves on top. The events come from the canvas (Pointer Events, `touch-action: none`).
  const inputTarget: InputTarget = {
    camera: globe.rig,
    now: fxNow,
    cancelFlight: () => {
      cityFlightOn = false;
      globe.cancelFlight();
    },
    click: (x, y) => onGlobeClick(x, y),
    pickCell: (x, y) => {
      const p = globe.pick(x, y);
      return p === null ? null : { cell: p.cell.index, lat: p.lat, lon: p.lon };
    },
    hover: showTip,
    hoverEnd: () => {
      tip.style.display = 'none';
    },
    focusCapital: () => focusCapital(),
    build: (type) => enterPlacement(type),
  };
  const inputStack = new InputStack(createBaseMode(inputTarget));
  tickInput = (now) => inputStack.tick(now);
  // --- Selection (M10-4): a click on an own structure selects it (outline ring, panel; Esc or a click on empty ground deselects) -------------------------------
  const closeCity = (): void => {
    if (cityMode !== null && inputStack.top === cityMode) inputStack.pop();
  };
  /** Districts-2a: opens the city view of own City `id` (a button of the selection panel or a double click): an input mode, the panel, and a flight to the City. */
  const openCity = (id: number): void => {
    const sess = session;
    if (sess === null || cityMode !== null || setupScreen !== null) return;
    const info = selectionInfo(sess.view, sess.localSeat, id);
    if (info === null || !info.owned || info.type !== STRUCT_CITY) return;
    cityId = id;
    const mode = createCityViewMode({
      closed: () => {
        if (cityFlightOn && globe.flight.active) globe.cancelFlight(); // Fix-3B: closing the view (Escape) ends the open-city flight too
        cityFlightOn = false;
        cityId = -1;
        cityMode = null;
        cityPanel?.update(sess.view, sess.localSeat, -1);
      },
    });
    cityMode = mode;
    inputStack.push(mode);
    if (globe.terrainMode === 'chunks') {
      const at = latLonOfCell(sess.view.structures.cell[id] as number, world.sim.width, world.sim.height);
      const p = globe.project(at.lat, at.lon);
      if (cityFlightNeeded(globe.cameraAglM(), p.facing && p.inView)) {
        // Fix-3B: high enough and shifted away from the panel so that the City and its district ring fit the free part of the window
        cityPanel?.update(sess.view, sess.localSeat, cityId); // shows the panel now so that its box can be measured
        const box = cityPanel?.root.getBoundingClientRect();
        const cvs = canvas.getBoundingClientRect();
        const fit = cityFitFlight(cvs.width, cvs.height, box === undefined ? { x: cvs.width, y: cvs.height } : { x: box.left - cvs.left, y: box.top - cvs.top }, CAMERA_FOV_DEG, CITY_VIEW.flyTiltDeg);
        const mPerDeg = (Math.PI / 180) * EARTH_RADIUS_KM * 1000;
        const toLat = at.lat + fit.offNorthM / mPerDeg;
        const toLon = at.lon + fit.offEastM / (mPerDeg * Math.max(0.05, Math.cos((at.lat * Math.PI) / 180)));
        globe.flyTo(toLat, toLon, 0, { altAglM: fit.altAglM, tilt: CITY_VIEW.flyTiltDeg, heading: 0, fast: true });
        cityFlightOn = true;
      }
    }
    refreshHud();
  };
  const exitSelection = (): void => {
    closeCity();
    if (selectionMode !== null && inputStack.top === selectionMode) inputStack.pop();
    selectPanel?.update(null, false);
  };
  const structureAtCell = (cell: number): number => {
    const sess = session;
    return sess === null ? -1 : pickStructure(sess.view.structures, world.sim.width, world.sim.height, cell, sess.localOwner, sess.view.owner[cell] as number);
  };
  const cellAt = (x: number, y: number): number | null => {
    const h = globe.pickGroundAt(x, y);
    return h === null ? null : latLonToCell(h.lat, h.lon, world.sim.width, world.sim.height).index;
  };
  const selectStructure = (id: number): void => {
    if (selectionMode !== null && selectedId === id) return;
    if (selectionMode !== null) {
      selectedId = id; // the mode stays on the stack, the selection moved
      return;
    }
    selectedId = id;
    lastSelClickId = id;
    lastSelClickMs = performance.now();
    const mode = createSelectionMode(id, {
      pickCell: cellAt,
      structureAt: structureAtCell,
      reselect: (next) => {
        selectedId = next;
        refreshHud();
      },
      ended: () => {
        selectedId = -1;
        selectionMode = null;
        globe.structures.setSelection(-1);
        selectPanel?.update(null, false);
      },
      exit: exitSelection,
      context: (_id, cmd) => runContext(cmd),
      again: (hit) => {
        // a second click on the selected own City inside CITY_VIEW.doubleClickMs opens the city view
        const now = performance.now();
        const dbl = isDoubleClick(lastSelClickId, lastSelClickMs, hit, now);
        lastSelClickId = hit;
        lastSelClickMs = now;
        if (dbl && session !== null && session.view.structures.type[hit] === STRUCT_CITY) openCity(hit);
      },
    });
    selectionMode = mode;
    inputStack.push(mode);
    refreshHud();
  };
  /** The base mode's click: true when it selected a structure (then it does not also attack). */
  const trySelectStructure = (x: number, y: number): boolean => {
    const sess = session;
    if (sess === null || placing !== 0 || (sess.view.stats.capital[sess.localSeat] as number) === 0) return false;
    const cell = cellAt(x, y);
    if (cell === null) return false;
    const id = structureAtCell(cell);
    if (id < 0) return false;
    selectStructure(id);
    return true;
  };
  /**
   * A right click (or a long press) without a drag: asked of the command resolver (src/app/commandResolver.ts, M20a-lite) with what is marked and what is
   * under the cursor. The selection mode passes it on while a structure is selected; with an empty stack the base mode calls it through `setContextHandler`.
   * The placement mode takes its own right click (it leaves the mode, no intent).
   */
  const runContext = (cmd: ContextCommand): void => {
    const sess = session;
    if (sess === null || setupScreen !== null) return;
    const pick = globe.pick(cmd.x, cmd.y);
    if (pick === null) return;
    const v = sess.view;
    const cell = resolveClickCell(pick, v.terrainClass, v.width, v.height);
    const sel: CommandSelection = { structure: selectedId, structureType: selectedId >= 0 ? (v.structures.type[selectedId] as number) : 0, placing };
    const target: CommandTarget = { cell, terrainClass: v.terrainClass[cell] as number, owner: v.owner[cell] as number, ownStructure: structureAtCell(cell) };
    const command = resolveCommand('context', sel, target, { localOwner: sess.localOwner, spawned: (v.stats.capital[sess.localSeat] as number) !== 0, spawnPhase: v.phase === PHASE_SPAWN });
    switch (command.kind) {
      case 'attack':
        attackOrExplain(sess, command.target);
        break;
      case 'build':
        sess.submit(buildBody(sess.localSeat, command.type, command.cell));
        break;
      case 'deselect':
        exitSelection();
        break;
      case 'select':
        selectStructure(command.structure);
        break;
      case 'deploy':
        enterDeploy(command.factory);
        break;
      case 'invalid':
        if (command.reason === 'unplayable') hud?.toast(notConquerableText(), fxNow());
        else if (command.reason === 'not-spawned') hud?.toast(rejectText(REJECT_NOT_SPAWNED), fxNow());
        else showToast('toast.cmd.notOwnGround', {}, 'error');
        break;
      case 'none':
        break;
    }
  };
  setContextHandler(runContext);
  // --- The help overlay (`?`, M20a-lite): an input mode while it is open, so Escape (or a click) closes it and no other mode sees the keys ------------------
  const closeHelp = (): void => {
    if (helpMode !== null && inputStack.top === helpMode) inputStack.pop();
  };
  const toggleHelp = (): void => {
    if (session === null || help === null) return;
    if (helpMode !== null) {
      closeHelp();
      return;
    }
    const mode: InputMode = {
      id: 'help',
      onPop: () => {
        help?.close();
        helpMode = null;
      },
      key: () => true, // the reserved keys do nothing behind the overlay
      click: () => (closeHelp(), true),
      context: () => (closeHelp(), true),
      longPress: () => (closeHelp(), true),
    };
    helpMode = mode;
    help.open();
    inputStack.push(mode);
  };
  // --- The diplomacy panel (key D or the top-bar button, M18c-2): an input mode while it is open, so Escape (or a click on the globe) closes it ------------------
  const closeDiplomacy = (): void => {
    if (diploMode !== null && inputStack.top === diploMode) inputStack.pop();
  };
  const toggleDiplomacy = (): void => {
    if (session === null || diploPanel === null || setupScreen !== null || helpMode !== null) return;
    if (diploMode !== null) {
      closeDiplomacy();
      return;
    }
    const mode: InputMode = {
      id: 'diplomacy',
      onPop: () => {
        diploPanel?.close();
        diploMode = null;
      },
      key: () => true, // the build keys do nothing behind the panel
      click: () => (closeDiplomacy(), true),
      context: () => (closeDiplomacy(), true),
      longPress: () => (closeDiplomacy(), true),
    };
    diploMode = mode;
    diploPanel.open();
    inputStack.push(mode);
  };
  // --- Placement (M10): key 1 or the build button pushes the placement mode; the ghost is the layer's, the rules are the sim's (validateBuild) --------------
  const exitPlacement = (): void => {
    if (placementMode !== null && inputStack.top === placementMode) inputStack.pop();
  };
  const enterPlacement = (type: number): void => {
    const sess = session;
    if (sess === null || setupScreen !== null || !(type in STRUCTURE_MODELS)) return; // the other build keys stay unbound until their models exist
    const L = sess.localSeat;
    if ((sess.view.stats.capital[L] as number) === 0) return; // nothing to build on before the spawn
    const same = placing === type;
    exitSelection();
    exitPlacement();
    if (same) return; // the key or the button again leaves the mode
    placing = type;
    const mode = createPlacementMode(type, {
      pickCell: (x, y) => {
        const h = globe.pickGroundAt(x, y);
        return h === null ? null : latLonToCell(h.lat, h.lon, world.sim.width, world.sim.height).index;
      },
      validate: (ty, cell) => (spawnPhaseBlocks(sess.view) ? REJECT_PHASE : validateBuild(sess.view, L, ty, cell)),
      send: (ty, cell) => sess.submit(buildBody(L, ty, cell)),
      setGhost: (ty, cell, ok) => globe.structures.setGhost(ty, cell, ok),
      clearGhost: () => globe.structures.clearGhost(),
      refused: (reason) => showToast(buildRejectKey(reason), { code: reason }, 'error'),
      exit: exitPlacement,
      ended: () => {
        placing = 0;
        placementMode = null;
      },
    });
    placementMode = mode;
    inputStack.push(mode);
  };
  // --- Deploy (M13b): send a helicopter. The Nav the rules read is built once per session on the world's elevation layers (like the sim's own); the verdict is
  // `validateLaunchHeli` (the sim's check), the preview is throttled (src/app/launchPreview.ts), the layer draws the route and the marker (3 draw calls) -------
  let previewCache: { session: MatchSession; nav: Nav } | null = null;
  const previewNavOf = (sess: MatchSession): Nav | null => {
    if (previewCache !== null && previewCache.session === sess) return previewCache.nav;
    const maxElev = world.sim.maxElev;
    if (maxElev === undefined) return null;
    const los = createLos(createLosTerrain(world.sim.width, world.sim.height, world.meta.sim.cosQ15, world.sim.meanElev, maxElev));
    const nav = createNav({ width: world.sim.width, height: world.sim.height, terrainClass: sess.view.terrainClass, meanElev: world.sim.meanElev }, los);
    previewCache = { session: sess, nav };
    return nav;
  };
  const runPreview = (req: PreviewRequest): PreviewResult => {
    const sess = session;
    const nav = sess === null ? null : previewNavOf(sess);
    if (sess === null || nav === null) return { request: req, reason: REJECT_HELI_NO_ROUTE, waypoints: null, exposed: null, etaSeconds: 0, fuelCells: 0, exposedCells: 0 };
    return previewLaunch(nav, sess.view, sess.localSeat, req);
  };
  const exitDeploy = (): void => {
    if (deployMode !== null && inputStack.top === deployMode) inputStack.pop();
  };
  const enterDeploy = (factory: number): void => {
    const sess = session;
    if (sess === null || setupScreen !== null || deployBox === null) return;
    const L = sess.localSeat;
    const v = sess.view;
    if (factory < 0 || factory >= v.structures.highWater || v.structures.type[factory] !== STRUCT_FACTORY || v.structures.owner[factory] !== sess.localOwner) {
      showToast('toast.heli.noFactory', {}, 'error');
      return;
    }
    if (padHeliOf(v, L, factory) < 0) {
      showToast(rejectKey(REJECT_HELI_NO_PAD), { code: REJECT_HELI_NO_PAD }, 'error');
      return;
    }
    if (deployMode !== null) {
      if (deployFactory === factory) return;
      exitDeploy();
    }
    exitPlacement();
    deployFactory = factory;
    deployHover = -1;
    deployPreviewer.clear();
    const box = deployBox;
    const mode = createDeployMode(factory, {
      pickCell: cellAt,
      cameraMoved: () => globe.rig.poseChanged(deployPose),
      hover: (c) => {
        deployHover = c === null ? -1 : c;
      },
      decide: (cell) => {
        const nav = previewNavOf(sess);
        return nav === null ? REJECT_HELI_NO_ROUTE : validateLaunchHeli(sess.view, nav, L, factory, cell, box.troops(), box.mode());
      },
      send: (cell) => {
        sess.submit(launchHeliBody(L, factory, cell, box.troops(), box.mode()));
        showToast('deploy.sent', {}, 'info');
      },
      refused: (reason) => showToast(rejectKey(reason), { code: reason }, 'error'),
      exit: exitDeploy,
      ended: () => {
        deployMode = null;
        deployFactory = -1;
        deployHover = -1;
        deployPreviewer.clear();
        deployReq = null;
        deployRouteFor = null;
        deployMarkerCell = -2;
        deployMarkerState = -1;
        globe.deploy.setRoute(null, null, 0);
        globe.deploy.setMarker(-1, 0);
      },
    });
    deployMode = mode;
    inputStack.push(mode);
  };
  let deployReq = null as PreviewRequest | null;
  let deployRouteFor = null as PreviewResult | null;
  let deployMarkerCell = -2;
  let deployMarkerState = -1;
  /** The camera numbers the deploy mode last picked at (`CameraRig.poseChanged`): a resting cursor under a resting camera is not picked again. */
  const deployPose = new Float64Array(7).fill(Number.NaN);
  /** Once per frame while the mode is on: the wanted request, the throttled poll, the marker and the route. Allocates only when the cell or a slider moved. */
  const deployFrame = (sess: MatchSession): void => {
    const box = deployBox;
    if (deployMode === null || box === null) return;
    const v = sess.view;
    if (deployFactory >= v.structures.highWater || v.structures.owner[deployFactory] !== sess.localOwner || v.structures.type[deployFactory] !== STRUCT_FACTORY) {
      exitDeploy(); // the Factory was lost
      return;
    }
    const troops = box.troops();
    const flight = box.mode();
    if (deployHover < 0) deployReq = null;
    else if (deployReq === null || deployReq.lzCell !== deployHover || deployReq.troops !== troops || deployReq.mode !== flight || deployReq.factory !== deployFactory) {
      deployReq = { factory: deployFactory, lzCell: deployHover, troops, mode: flight };
    }
    deployPreviewer.want(deployReq);
    deployPreviewer.poll(fxNow());
    const cur = deployPreviewer.current();
    const state = cur === null ? 0 : cur.reason === 0 ? 1 : 2;
    if (deployHover !== deployMarkerCell || state !== deployMarkerState) {
      deployMarkerCell = deployHover;
      deployMarkerState = state;
      globe.deploy.setMarker(deployHover, state);
    }
    if (deployHover < 0) {
      if (deployRouteFor !== null) {
        deployRouteFor = null;
        globe.deploy.setRoute(null, null, 0);
      }
    } else if (cur !== null && cur !== deployRouteFor) {
      deployRouteFor = cur;
      globe.deploy.setRoute(cur.waypoints, cur.exposed, AIR_MODE_AGL_M[cur.request.mode] as number);
    }
  };
  const heliRowsBuf: HeliRow[] = [];
  let rowsTick = -1;
  let rowsVersion = -1;
  let rowsFactory = -2;
  /** The one model object of the deploy block, rewritten in place each frame (Fix-4B: no literal per frame). */
  const boxModel = { canOpen: false, openReason: 0, active: false, status: 'idle' as 'idle' | 'pending' | 'valid' | 'invalid', reason: 0, etaSeconds: 0, fuelCells: 0, exposedCells: 0 };
  /** The deploy block and the helicopter list in the Factory panel (only while a Factory is selected). */
  const deployBoxFrame = (sess: MatchSession, factory: number): void => {
    const box = deployBox;
    if (box === null) return;
    const v = sess.view;
    const L = sess.localSeat;
    const pad = padHeliOf(v, L, factory);
    const cur = deployMode === null || deployHover < 0 ? null : deployPreviewer.current();
    const status = deployMode === null || deployHover < 0 ? 'idle' : cur === null ? 'pending' : cur.reason === 0 ? 'valid' : 'invalid';
    boxModel.canOpen = pad >= 0 || deployMode !== null;
    boxModel.openReason = pad >= 0 ? 0 : REJECT_HELI_NO_PAD;
    boxModel.active = deployMode !== null;
    boxModel.status = status;
    boxModel.reason = cur === null ? 0 : cur.reason;
    boxModel.etaSeconds = cur === null ? 0 : cur.etaSeconds;
    boxModel.fuelCells = cur === null ? 0 : cur.fuelCells;
    boxModel.exposedCells = cur === null ? 0 : cur.exposedCells;
    // the helicopter rows only change with the table or the tick (the Recall verdict is a function of both): ask again then, not every frame
    if (v.tick !== rowsTick || v.helisVersion !== rowsVersion || factory !== rowsFactory) {
      rowsTick = v.tick;
      rowsVersion = v.helisVersion;
      rowsFactory = factory;
      ownHeliRows(v, L, heliRowsBuf);
    }
    box.update(boxModel, heliRowsBuf);
  };
  // Every game key is an entry of the registry (src/app/hotkeys.ts); the reserved keys are handed to the stack while a match is on (the setup screen and the menus own the keyboard before it).
  hotkeys.context = { matchOn: () => setupScreen === null && session !== null, modalOpen: keysBlockedByModal };
  registerGameHotkeys(
    hotkeys,
    {
      stack: inputStack,
      toggleOverlay: () => {
        overlay.hidden = !overlay.hidden;
        if (!overlay.hidden) refreshOverlay();
      },
      commit: (dir) => session?.adjustCommit(dir),
      togglePause: () => session?.togglePause(),
      slower: () => session?.slower(),
      faster: () => session?.faster(),
      toggleHelp: () => toggleHelp(),
      toggleDiplomacy: () => toggleDiplomacy(),
      deploy: () => (deployMode !== null ? exitDeploy() : enterDeploy(selectedId)),
      toggleLabels: () => {
        setLabelsWanted(!labelsWanted);
        showToast(labelsWanted ? 'toast.labels.on' : 'toast.labels.off', {}, 'info');
      },
    },
    signal,
  );
  attachHotkeys(window);
  let inputOn = false;
  const attachInput = (): void => {
    if (inputOn) return;
    inputOn = true;
    attachDomInput(canvas, inputStack, () => {
      tip.style.display = 'none';
    }, signal);
  };
  // The live performance scene flies the camera by itself: the mouse is off until the run is over (a touched camera would spoil the numbers).
  if (!(isPerfScene && !params.test)) attachInput();

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
        cityStyle: { get: () => globe.structures.cityStyleNow, set: (st) => applyCityStyle(st) },
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
      {
        onSetup: () => void openSetup(),
        // The graphics tip: weak card, not closed before (`?gpu=` forces it in test mode; the pref remembers the closing).
        ...(weakGpu && gpuStrings !== null && getPref<boolean>(GPU_TIP_PREF_KEY, false) !== true
          ? { gpuTip: { name: readableGpuName(gpuStrings.renderer), onClose: () => void setPref(GPU_TIP_PREF_KEY, true) } }
          : {}),
      },
    );
  };

  /** The boot of the menus: a restart (see `restartMatch`) starts its match at once, the plain boot shows the start screen. */
  const autoStartBuilt = async (): Promise<void> => {
    const prepared = await loadPrepared(world);
    if (!alive || session !== null) return;
    const base = defaultDraft(1, t('setup.nation.defaultName'));
    const stored = getPref<StoredSetup | null>(SETUP_PREF_KEY, null, isStoredSetup as (v: unknown) => v is StoredSetup);
    if (stored === null) return;
    const check = checkDraft(prepared, draftFromStored(stored, prepared, base), params.test);
    if (!check.ok) return;
    await nextPaint();
    const r = createMatch(prepared, check.config);
    if (!r.ok || !alive || session !== null) return;
    await startBuilt(r.match);
    startScreen?.dispose();
    startScreen = null;
  };
  const bootMenu = (): void => {
    const pending = getPref<string | null>(RESTART_PREF, null);
    if (pending !== null) setPref(RESTART_PREF, null);
    if (pending === 'standard') {
      void startMatch();
      return;
    }
    mountMenu();
    if (pending === 'built') void autoStartBuilt();
  };

  // --- Test hooks or the frame loop ---------------------------------------------------------------------------------
  const terrainState = (): TerrainStateInfo => {
    const t = globe.terrainInfo();
    return { chunkCount: t.chunkCount, lodLevels: t.lodLevels, triangles: t.triangles, drawCalls: t.drawCalls, levels: t.levels, capped: t.capped, finite: globe.chunks?.allFinite() ?? true };
  };
  const structuresState = (v: { readonly structures: { readonly highWater: number; readonly owner: ArrayLike<number>; readonly type: ArrayLike<number> } }): MatchStateInfo['structures'] => {
    const st = v.structures;
    const byType = [0, 0, 0, 0, 0, 0, 0];
    let count = 0;
    for (let i = 0; i < st.highWater; i++) {
      if ((st.owner[i] as number) === 0) continue;
      count++;
      byType[st.type[i] as number] = (byType[st.type[i] as number] as number) + 1;
    }
    return { count, byType };
  };
  const propsInfo = (): PropsInfo => {
    const layer = globe.structures;
    const counts = layer.counts();
    let total = 0;
    for (const n of Object.values(counts)) total += n;
    const price = Number(buildBar?.root.querySelector('[data-testid="build-city"]')?.getAttribute('data-price') ?? 0);
    return {
      counts,
      total,
      dropped: layer.dropped,
      cityTriangles: layer.trianglesOf(STRUCT_CITY),
      list: layer.instances(),
      districts: { counts: globe.districts.counts(), total: globe.districts.total(), triangles: globe.districts.trianglesDrawn, dropped: globe.districts.dropped, drawn: globe.districts.drawnNow, list: globe.districts.instances() },
      cityStyle: globe.structures.cityStyleNow,
      placing,
      ghost: placementMode === null ? null : placementMode.state(),
      toasts: visibleToastKeys(),
      buildBar: { visible: buildBar !== null && !buildBar.root.hidden, cityPrice: price },
      selection: { id: selectedId, panelVisible: selectPanel !== null && !selectPanel.root.hidden, ring: layer.ringInfo() },
      icons: layer.iconCount(),
      litLights: layer.litLights(),
    };
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
      structures: structuresState(v),
    };
  };
  if (params.test) {
    // Test mode has no start screen: the match exists from the first line of the test. `#menu` asks for the menus instead (the setup tests).
    if (ctx.state.raw.menu === '1') bootMenu();
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
      flyTo: (lat, lon, distKm, options) => globe.flyTo(lat, lon, distKm, options),
      bookmark: (name, durationS) => flyToBookmark(name, durationS),
      flightActive: () => globe.flight.active,
      cameraMix: () => globe.rig.rtsWeight,
      runPerfScene(o = {}): PerfSceneSection {
        const dt = o.dt ?? 0.1;
        gpuTimerOk = globe.enableGpuTimer();
        const run = new PerfSceneRun(perfHost, { quick: true, now: fxNow });
        perfRun = run;
        let prev = performance.now();
        for (let i = 0; i < (o.maxFrames ?? 2000) && !run.done; i++) {
          advanceFx(dt);
          run.beforeFrame();
          const t0 = performance.now();
          renderFrame();
          globe.sync(); // no frame is presented between the calls: wait until the GPU is done with this one (finish() only flushes)
          const t1 = performance.now();
          run.afterFrame(t1 - prev, t1 - t0);
          prev = t1;
        }
        perf?.update();
        return run.section();
      },
      perfReport: () => buildPerfReport(perfContext),
      adaptive: {
        enable: (on) => {
          adaptiveOn = on;
        },
        feed: (ms, n = 1) => {
          if (adaptiveOn) for (let i = 0; i < n; i++) feedAdaptive(ms);
          return adaptiveInfo();
        },
        simulate: (a, b, frames) => {
          if (adaptiveOn) for (let i = 0; i < frames; i++) feedAdaptive(a + b * adaptive.scale * adaptive.scale);
          return adaptiveInfo();
        },
        info: adaptiveInfo,
      },
      holdAgl: () => globe.rig.holdAgl,
      pickGround: (x, y) => {
        const h = globe.pickGroundAt(x, y);
        return h === null ? null : { lat: h.lat, lon: h.lon, radius: h.radius, seenHeightM: h.seenHeightM };
      },
      groundHeightAt: (lat, lon, octaves) => groundHeightAt(lat, lon, octaves),
      probeEncoding: () => globe.probeEncoding(),
      probeHash: (items, encoding) => Array.from(globe.probeHashes(items, encoding)),
      probeHeight: (points, encoding) => Array.from(globe.probeHeights(points, encoding)),
      probeRelief: (points, encoding) => Array.from(globe.probeReliefs(points, encoding)),
      setDetailBias: (octaves) => globe.setDetailBias(octaves),
      detailBias: () => globe.detailBias,
      setOctaveLimit: (mode) => globe.setOctaveLimit(mode),
      setChunkDensity: (scale) => globe.setChunkDensity(scale),
      chunkDensity: () => globe.chunkDensity,
      setFineDetail: (on) => globe.setFineDetail(on),
      fineDetail: () => globe.fineDetail,
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
      props: propsInfo,
      helis: () => globe.helis.drawn().map((d) => ({ ...d })),
      heliSpin: (angle) => {
        globe.helis.spinOverride = angle;
      },
      heliLayer: (on) => globe.helis.setEnabled(on),
      fronts: () => ({ arrows: globe.fronts.info().map((d) => ({ ...d })), count: globe.fronts.count, fade: globe.fronts.fade, visible: globe.fronts.visible }),
      frontLayer: (on) => globe.fronts.setEnabled(on && labelsWanted),
      labels: () => ({ shown: nationLabels?.info() ?? [], writes: nationLabels?.writes ?? 0, on: labelsWanted }),
      labelsOn: (on) => setLabelsWanted(on),
      beach: () => {
        const rows: Array<{ slot: number; seed: number; landTick: number; cells: number; seconds: number }> = [];
        if (session !== null) {
          const b = session.view.beachheads;
          for (let i = 0; i < b.capacity; i++) {
            if (b.owner[i] !== session.localOwner) continue;
            rows.push({ slot: i, seed: b.seed[i] as number, landTick: b.landTick[i] as number, cells: b.cellsOf(i), seconds: beachSecondsLeft(b.landTick[i] as number, session.view.tick) });
          }
        }
        return { rows, ring: globe.structures.beachRingInfo() };
      },
      deploy: () => {
        const cur = deployPreviewer.current();
        const layer = globe.deploy.info();
        return {
          active: deployMode !== null,
          factory: deployFactory,
          hover: deployHover,
          markerCell: layer.markerCell,
          markerState: layer.markerState,
          routeVertices: layer.routeVertices,
          visibleMeshes: layer.visibleMeshes,
          status: deployPreviewer.status(),
          reason: cur === null ? -1 : cur.reason,
          etaSeconds: cur === null ? 0 : cur.etaSeconds,
          fuelCells: cur === null ? 0 : cur.fuelCells,
          troops: deployBox === null ? 0 : deployBox.troops(),
          queriesSent: deployPreviewer.sent,
          queriesDropped: deployPreviewer.dropped,
        };
      },
      deployLayer: (on) => globe.deploy.setEnabled(on),
      previewNow: (factory, lzCell, troops, mode) => {
        const r = runPreview({ factory, lzCell, troops, mode });
        return { reason: r.reason, waypoints: r.waypoints === null ? 0 : r.waypoints.length, etaSeconds: r.etaSeconds };
      },
      setCityStyle: (style) => applyCityStyle(style),
      setLevelOverride(id, level): void {
        globe.structures.setLevelOverride(id, level);
        globe.districts.setLevelOverride(id, level);
      },
      submit(body): void {
        session?.submit(body);
      },
      give(seat, gift): void {
        // Fix-3B: the sim ignores a gift above DEBUG_GIVE_MAX silently; the hook says so out loud instead
        if ((gift.gold ?? 0) > DEBUG_GIVE_MAX || (gift.troops ?? 0) > DEBUG_GIVE_MAX) throw new Error(`__test.give: gold and troops are at most DEBUG_GIVE_MAX = ${DEBUG_GIVE_MAX} per call (the sim would drop the intent); give twice`);
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
      hotkeys: () => hotkeys.entries().map((d) => ({ id: d.id, keys: [...d.keys], scope: d.scope, hidden: d.hidden === true })),
      helpOpen: () => help?.isOpen() === true,
      onContext: (fn) => setContextHandler(fn),
      onPause: (fn) => setPauseHandler(fn),
      forceEliminated: (seat) => {
        forcedElim = seat;
      },
      matchInfo: () => {
        if (session === null) return null;
        const m = session.view.match;
        return {
          winFlags: m.winFlags,
          leaderSeat: m.leaderSeat,
          requiredPct: m.requiredPct,
          holdSeat: m.holdSeat,
          holdTicksLeft: m.holdTicksLeft,
          ended: m.ended,
          winnerSeat: m.winnerSeat,
          reason: m.reason,
          endTick: m.endTick,
          players: session.view.players,
          score: Array.from(m.score),
          landStd: Array.from(m.landStd),
          peakLand: Array.from(m.peakLand),
          built: Array.from(m.built),
          conquered: Array.from(m.conquered),
          eliminated: Array.from(m.eliminated),
        };
      },
      readTexels: (name, points) => Array.from(globe.readTexels(name, points)),
      setExaggeration: (x) => globe.setExaggeration(x),
      setBorderStrength: (x) => globe.setBorderStrength(x),
      view: () => globe.rig.view,
      shownTilt: () => globe.rig.shownTilt,
      maxDist: () => globe.rig.maxDistKm,
      resize: (w, h) => globe.resize(w, h, 1),
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
  // The performance scene has no menu and no match: it draws the orbit view once, measures the display's refresh with empty callbacks,
  // then flies the script (src/app/perfScene.ts).
  if (perfRun !== null) renderFrame();
  else bootMenu();
  let last = performance.now();
  let sinceOverlay = 0;
  let overlayAt = 0; // the animation-frame time of the last overlay refresh while the performance scene runs
  const loop = (now: number): void => {
    if (!alive) return;
    const dt = (now - last) / 1000;
    last = now;
    if (perfRun !== null && perfRun.probing) {
      // Nothing is drawn and the fx clock stands still: the interval of an empty requestAnimationFrame is the display's refresh interval.
      if (dt > 0) perfRun.probeFrame(dt * 1000);
      if (now - overlayAt >= 250) {
        overlayAt = now;
        perf?.update();
      }
      requestAnimationFrame(loop);
      return;
    }
    if (dt > 0) {
      fps = fps * 0.9 + (1 / dt) * 0.1;
      if (perfRun === null || !perfRun.done) stats.push(dt * 1000);
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
    if (adaptiveDirty) {
      adaptiveDirty = false;
      applyAdaptive();
    }
    perfRun?.beforeFrame();
    const drawStart = performance.now();
    renderFrame();
    if (perfRun !== null) {
      perfRun.afterFrame(dt * 1000, performance.now() - drawStart);
      if (perfRun.done) attachInput(); // the run is over: the camera is the player's again
    }
    if (adaptiveOn && dt > 0) {
      if (gpuTimerOk && !isPerfScene) {
        for (let g = globe.takeGpuMs(); g !== null; g = globe.takeGpuMs()) feedAdaptiveInLoop(g);
      } else feedAdaptiveInLoop(dt * 1000);
    }
    if (!overlay.hidden) refreshOverlay();
    // The scene's report section sorts copies of the recorded frames: once a second while it runs (not every 15 frames), so the measuring does not show up in the numbers.
    if (perfRun !== null && !perfRun.done) {
      if (perf && now - overlayAt >= 1000) {
        overlayAt = now;
        perf.update();
      }
    } else if (perf && ++sinceOverlay >= 15) {
      sinceOverlay = 0;
      perf.update();
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  return disposeAll;
}
