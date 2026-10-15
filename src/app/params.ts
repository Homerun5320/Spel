// URL parameter parsing for the client: ONE parser for `location.search` and `location.hash`. Pure (no DOM access) so it
// can be unit-tested.
//
// Hash grammar (an Artifact link cannot carry `?params`, but an anchor reaches the page): only the characters
// A-Z a-z 0-9 - . _ ~ ; a token is `key` or `key-value` (split at the FIRST hyphen); tokens are separated by `_`; a key
// without a value means `key=1`. So `#perf` = `?perf=1`, `#scene-perf` = `?scene=perf`, `#scenario-slice_sam-1` =
// `?scenario=slice&sam=1`, `#view-alps-valley` = `?view=alps-valley`, `#seed-7` = `?seed=7`. A key present in both the
// query and the hash takes its value from the hash.

export type RawParams = Record<string, string>;

const HASH_TOKEN = /^[A-Za-z0-9.~]+(-[A-Za-z0-9\-.~]*)?$/;

/** Key/value pairs of a hash (`#perf_seed-7`). Tokens with other characters or an empty key are ignored. */
export function parseHash(hash: string): RawParams {
  const out: RawParams = {};
  const body = hash.startsWith('#') ? hash.slice(1) : hash;
  for (const token of body.split('_')) {
    if (!HASH_TOKEN.test(token)) continue;
    const dash = token.indexOf('-');
    if (dash < 0) out[token] = '1';
    else if (dash < token.length - 1) out[token.slice(0, dash)] = token.slice(dash + 1);
  }
  return out;
}

/** Key/value pairs of a query string (`?perf=1&seed=7`); the last occurrence of a key wins. */
export function parseQuery(search: string): RawParams {
  const out: RawParams = {};
  for (const [k, v] of new URLSearchParams(search)) out[k] = v;
  return out;
}

/** Query and hash merged; a key in both takes the hash value. */
export function parseRaw(search: string, hash = ''): RawParams {
  return { ...parseQuery(search), ...parseHash(hash) };
}

/** The hash text (without `#`) of a parameter set: a value `1` shortens to the bare key. Throws on text the grammar cannot carry. */
export function toHash(params: Readonly<RawParams>): string {
  return Object.entries(params)
    .map(([k, v]) => {
      const tok = v === '1' ? k : `${k}-${v}`;
      if (!HASH_TOKEN.test(tok) || v === '') throw new Error(`parameter ${k}=${v} cannot be written in the hash grammar`);
      return tok;
    })
    .join('_');
}

/** The query text (without `?`) of a parameter set. */
export function toQuery(params: Readonly<RawParams>): string {
  return new URLSearchParams(Object.entries(params)).toString();
}

export interface AppParams {
  /** `?test=1`: deterministic mode (no rAF loop, fixed seed, DPR 1, MSAA off, preserveDrawingBuffer). */
  test: boolean;
  /** `?blank=1`: debug parameter, renders a deliberately empty canvas (negative e2e test). */
  blank: boolean;
  /** `?seed=N`: PRNG seed for the spike noise texture (default 1). */
  seed: number;
  /** `?w=` / `?h=`: test-mode canvas size (default 960x540; leak tests use 320x180). */
  width: number;
  height: number;
}

export const TEST_WIDTH = 960;
export const TEST_HEIGHT = 540;

function intParam(value: string | null, fallback: number, min: number, max: number): number {
  if (value === null || !/^-?\d+$/.test(value)) return fallback;
  const n = Number(value);
  return n >= min && n <= max ? n : fallback;
}

function appParamsOf(q: RawParams): AppParams {
  return {
    test: q.test === '1',
    blank: q.blank === '1',
    seed: intParam(q.seed ?? null, 1, -2147483648, 2147483647),
    width: intParam(q.w ?? null, TEST_WIDTH, 16, 4096),
    height: intParam(q.h ?? null, TEST_HEIGHT, 16, 4096),
  };
}

export function parseParams(search: string, hash = ''): AppParams {
  return appParamsOf(parseRaw(search, hash));
}

export type SceneName = 'globe' | 'spike' | 'perf';

export interface SceneParams {
  /** `?scene=spike` keeps the M00 spike, `?scene=perf` (`#scene-perf`, M08) is the performance scene on the Earth; everything else is the stylised Earth. */
  scene: SceneName;
  /** `?quality=test|low|medium|high` (raw value; `src/render/quality.ts` validates it). */
  quality: string | null;
}

function sceneParamsOf(q: RawParams): SceneParams {
  return { scene: q.scene === 'spike' ? 'spike' : q.scene === 'perf' ? 'perf' : 'globe', quality: q.quality ?? null };
}

/** M02 additions, kept apart from `parseParams` (its result shape is pinned by an M00 test). */
export function parseSceneParams(search: string, hash = ''): SceneParams {
  return sceneParamsOf(parseRaw(search, hash));
}

export type TerrainName = 'chunks' | 'fixed';

export interface TerrainParams {
  /** `?terrain=fixed` (`#terrain-fixed`) keeps the M02 lat/lon mesh; everything else is the quadtree of chunks (M07a, the default). */
  terrain: TerrainName;
  /** `?chunks=1` (`#chunks`): every chunk in its own colour (the chunk terrain only). */
  chunkDebug: boolean;
  /**
   * `?chunktier=high` (`#chunktier-high`): the chunk density (cells per chunk, split distances, chunk cap) of that quality tier. Only
   * test mode reads it: `?test=1` forces the test tier, this lets the tests render the chunk terrain of another tier headless.
   */
  chunkTier: string | null;
}

function terrainParamsOf(q: RawParams): TerrainParams {
  return { terrain: q.terrain === 'fixed' ? 'fixed' : 'chunks', chunkDebug: q.chunks === '1', chunkTier: q.chunktier ?? null };
}

/** M07a additions, kept apart from `parseSceneParams` (its result shape is pinned by an M02 test). */
export function parseTerrainParams(search: string, hash = ''): TerrainParams {
  return terrainParamsOf(parseRaw(search, hash));
}

/** The named camera starts of M07a (`?view=alps-valley`, `#view-alps-valley`): 2 km above the ground, looking toward the horizon. `src/render/views.ts` holds their numbers. */
export const GROUND_VIEW_NAMES = ['alps-valley', 'himalaya-valley'] as const;
export type GroundViewName = (typeof GROUND_VIEW_NAMES)[number];

function groundViewOf(q: RawParams): GroundViewName | null {
  const v = q.view;
  return (GROUND_VIEW_NAMES as readonly string[]).includes(v ?? '') ? (v as GroundViewName) : null;
}

/** M07a addition: the named ground view of the address, or null (an unknown name is ignored). */
export function parseViewParam(search: string, hash = ''): GroundViewName | null {
  return groundViewOf(parseRaw(search, hash));
}

export interface AppState {
  params: AppParams;
  scene: SceneParams;
  terrain: TerrainParams;
  /** `?view=alps-valley` / `#view-alps-valley` (M07a): the named ground view the page starts in, or null. */
  view: GroundViewName | null;
  /** `?perf=1` / `#perf`: the performance overlay. */
  perf: boolean;
  /** `?adapt=0` / `#adapt-0` switches the adaptive resolution (AutoTier-2) off, `?adapt=1` / `#adapt-1` forces it on (also in test mode and in the performance scene); null = the default (on in the live game, off in test mode and the performance scene). */
  adapt: boolean | null;
  /** `?devbtn=1` / `#devbtn`: show the Dev panel corner button also in test mode (it is hidden there so goldens stay clean). */
  devButton: boolean;
  /** Every key and value of the address (query merged with hash). */
  raw: RawParams;
}

/** Everything the app reads from the address, through the one parser. */
export function parseAppState(search: string, hash = ''): AppState {
  const raw = parseRaw(search, hash);
  return { params: appParamsOf(raw), scene: sceneParamsOf(raw), terrain: terrainParamsOf(raw), view: groundViewOf(raw), perf: raw.perf === '1', adapt: raw.adapt === '1' ? true : raw.adapt === '0' ? false : null, devButton: raw.devbtn === '1', raw };
}

/**
 * Is the adaptive resolution on? `?adapt=1` / `?adapt=0` decide; without it: on in the live game, off in test mode, in the performance scene and with
 * the plain `#perf` overlay (they measure the raw speed, docs/PREVIEW.md 17ag).
 */
export function adaptiveEnabled(state: AppState): boolean {
  return state.adapt ?? (!state.params.test && state.scene.scene !== 'perf' && !state.perf);
}
