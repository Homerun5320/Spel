// Network access of the bake tool. ONLY the hosts below may be contacted; everything is cached in the
// gitignored folder .cache/bake so a second bake needs no network at all. A blocked or failing host aborts
// the bake with a clear message and writes nothing to public/data (the caller writes output last).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const TERRARIUM_HOST = 'elevation-tiles-prod.s3.amazonaws.com';
export const NE_HOST = 'raw.githubusercontent.com';
export const ALLOWED_HOSTS: readonly string[] = [TERRARIUM_HOST, NE_HOST];

/** Verified on 2026-10-13 (git ls-remote ... HEAD); used only when neither meta.json nor ls-remote gives a SHA. */
export const NE_FALLBACK_SHA = 'ca96624a56bd078437bca8184e78163e5039ad19';

export const NE_FILES = {
  countries: 'ne_50m_admin_0_countries.geojson',
  places: 'ne_10m_populated_places_simple.geojson',
  ports: 'ne_10m_ports.geojson',
  /** M18b-1: states and provinces for the federations pack (the 50 m file is 2.3 MB and covers RUS USA IND IDN CHN BRA CAN AUS ZAF). */
  admin1: 'ne_50m_admin_1_states_provinces.geojson',
} as const;

export const TERRARIUM_ZOOM = 4;
export const TERRARIUM_TILES = 1 << TERRARIUM_ZOOM; // 16 x 16 = 256 tiles

export class BlockedError extends Error {
  constructor(
    public readonly url: string,
    detail: string,
  ) {
    super(
      `BLOCKED: cannot fetch ${url} (${detail}).\n` +
        `The bake may only contact ${ALLOWED_HOSTS.join(' and ')}. Nothing was written to public/data.\n` +
        `Host blocked by the sandbox network policy? Run the bake where these hosts are reachable, or restore the cache in .cache/bake.\n` +
        `(Node's built-in fetch ignores HTTPS_PROXY unless started with NODE_USE_ENV_PROXY=1 on Node >= 22.21.)`,
    );
    this.name = 'BlockedError';
  }
}

export const CACHE_DIR = path.resolve(import.meta.dirname, '../../.cache/bake');

function assertAllowed(url: string): void {
  const host = new URL(url).hostname;
  if (!ALLOWED_HOSTS.includes(host)) throw new Error(`host ${host} is not allowed for the bake (${url})`);
}

async function download(url: string): Promise<Uint8Array> {
  assertAllowed(url);
  let last = '';
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (res.status === 403 || res.status === 407) throw new BlockedError(url, `HTTP ${res.status}`);
      if (!res.ok) {
        last = `HTTP ${res.status}`;
        if (res.status === 404) break;
        continue;
      }
      return new Uint8Array(await res.arrayBuffer());
    } catch (err) {
      if (err instanceof BlockedError) throw err;
      last = err instanceof Error ? `${err.message}${err.cause ? ` / ${String((err.cause as Error).message ?? err.cause)}` : ''}` : String(err);
    }
  }
  throw new BlockedError(url, last);
}

/** Cached download. The file is written atomically (temp file + rename) so a killed bake never leaves half a file. */
export async function cachedFetch(url: string, cacheRel: string): Promise<Uint8Array> {
  const target = path.join(CACHE_DIR, cacheRel);
  if (fs.existsSync(target)) return new Uint8Array(fs.readFileSync(target));
  const bytes = await download(url);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp${process.pid}`;
  fs.writeFileSync(tmp, bytes);
  fs.renameSync(tmp, target);
  return bytes;
}

export function terrariumUrl(x: number, y: number): string {
  return `https://${TERRARIUM_HOST}/terrarium/${TERRARIUM_ZOOM}/${x}/${y}.png`;
}

export function neUrl(sha: string, file: string): string {
  return `https://${NE_HOST}/nvkelso/natural-earth-vector/${sha}/geojson/${file}`;
}

/** Looks the Natural Earth commit up once with git ls-remote (github.com over HTTP/API is blocked, git is not). */
export function lookupNeSha(): string | null {
  const res = spawnSync('git', ['ls-remote', 'https://github.com/nvkelso/natural-earth-vector.git', 'HEAD'], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (res.status !== 0) return null;
  const m = /^([0-9a-f]{40})\s+HEAD/m.exec(res.stdout);
  return m ? (m[1] as string) : null;
}

export interface TileSet {
  /** tiles[y * 16 + x] = raw PNG bytes */
  tiles: Uint8Array[];
}

/** Downloads (or reads from the cache) all 256 Terrarium z4 tiles with limited concurrency. */
export async function fetchTerrarium(log: (s: string) => void = console.log): Promise<TileSet> {
  const n = TERRARIUM_TILES;
  const tiles: Uint8Array[] = new Array<Uint8Array>(n * n);
  let next = 0;
  let done = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= n * n) return;
      const x = i % n;
      const y = Math.floor(i / n);
      tiles[i] = await cachedFetch(terrariumUrl(x, y), `terrarium/${TERRARIUM_ZOOM}/${x}/${y}.png`);
      done++;
      if (done % 64 === 0) log(`  terrarium tiles ${done}/${n * n}`);
    }
  };
  await Promise.all(Array.from({ length: 8 }, () => worker()));
  return { tiles };
}

export async function fetchNe(sha: string, file: string): Promise<string> {
  const bytes = await cachedFetch(neUrl(sha, file), `ne/${sha}/${file}`);
  return new TextDecoder().decode(bytes);
}
