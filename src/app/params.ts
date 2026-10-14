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

export type SceneName = 'globe' | 'spike';

export interface SceneParams {
  /** `?scene=spike` keeps the M00 spike; everything else is the stylised Earth. */
  scene: SceneName;
  /** `?quality=test|low|medium|high` (raw value; `src/render/quality.ts` validates it). */
  quality: string | null;
}

function sceneParamsOf(q: RawParams): SceneParams {
  return { scene: q.scene === 'spike' ? 'spike' : 'globe', quality: q.quality ?? null };
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

export interface AppState {
  params: AppParams;
  scene: SceneParams;
  terrain: TerrainParams;
  /** `?perf=1` / `#perf`: the performance overlay. */
  perf: boolean;
  /** `?devbtn=1` / `#devbtn`: show the Dev panel corner button also in test mode (it is hidden there so goldens stay clean). */
  devButton: boolean;
  /** Every key and value of the address (query merged with hash). */
  raw: RawParams;
}

/** Everything the app reads from the address, through the one parser. */
export function parseAppState(search: string, hash = ''): AppState {
  const raw = parseRaw(search, hash);
  return { params: appParamsOf(raw), scene: sceneParamsOf(raw), terrain: terrainParamsOf(raw), perf: raw.perf === '1', devButton: raw.devbtn === '1', raw };
}
