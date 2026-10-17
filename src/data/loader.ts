// Pack loader. Everything is injected: the manifest address and `readBytes` come from src/app (browser: fetch;
// tests and tools: a file-system variant that lives in tests/ and is never imported from here).
// All packs load through the manifest {name: {file, enc: 'raw' | 'b64'}}; the pack files are resolved relative to the
// manifest address, and their integrity is checked against checksums.json (fnv1a-32 of the uncompressed payload).
import { decodeBase64, fnv1a32, gunzip, hasGzipMagic, hex8 } from './bytes';

export type ReadBytes = (url: string) => Promise<Uint8Array>;
export type PackEnc = 'raw' | 'b64';

export interface ManifestEntry {
  file: string;
  enc?: PackEnc;
}
export type Manifest = Record<string, ManifestEntry>;

export interface ChecksumLayer {
  offset: number;
  bytes: number;
  sha256: string;
  fnv1a: string;
}
export interface ChecksumRecord {
  /** Length of the uncompressed payload. */
  bytes: number;
  /** sha256 of the UNCOMPRESSED payload (authoritative; checked by bake:check and the Node tests). */
  sha256: string;
  /** fnv1a-32 of the uncompressed payload, 8 hex digits (checked by the browser loader). */
  fnv1a: string;
  /** Size and sha256 of the .gz file; informational only (gzip bytes can differ between Node versions). */
  gzBytes?: number;
  gzSha256?: string;
  layers?: Record<string, ChecksumLayer>;
}
export interface Checksums {
  version: number;
  /** Binary packs by manifest name, over the uncompressed payload. */
  packs: Record<string, ChecksumRecord & { file: string }>;
  /** JSON files next to the manifest by file name. */
  files: Record<string, ChecksumRecord>;
}

export class DataIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataIntegrityError';
  }
}

export interface LoadTiming {
  name: string;
  /** ms spent in readBytes (network or disk). */
  readMs: number;
  /** ms spent decoding base64, checking the gzip magic and inflating. */
  inflateMs: number;
  /** ms spent on the checksum. */
  checksumMs: number;
  compressedBytes: number;
  bytes: number;
}

export interface LoaderOptions {
  /** Absolute address of data/manifest.json (the app builds it with siteUrl). */
  manifestUrl: string;
  readBytes: ReadBytes;
  /** Millisecond clock for the timing log; defaults to performance.now. */
  now?: () => number;
  /** When false the checksum comparison is skipped (never in production). Default true. */
  verify?: boolean;
}

const decoder = new TextDecoder();

export function resolveRelative(manifestUrl: string, file: string): string {
  return new URL(file, manifestUrl).href;
}

export class DataLoader {
  readonly timings: LoadTiming[] = [];
  private manifestPromise: Promise<Manifest> | null = null;
  private checksumsPromise: Promise<Checksums> | null = null;
  private readonly now: () => number;
  private readonly verify: boolean;

  constructor(private readonly opts: LoaderOptions) {
    this.now = opts.now ?? ((): number => performance.now());
    this.verify = opts.verify ?? true;
  }

  manifest(): Promise<Manifest> {
    this.manifestPromise ??= this.opts.readBytes(this.opts.manifestUrl).then((b) => JSON.parse(decoder.decode(b)) as Manifest);
    return this.manifestPromise;
  }

  checksums(): Promise<Checksums> {
    this.checksumsPromise ??= this.opts
      .readBytes(resolveRelative(this.opts.manifestUrl, 'checksums.json'))
      .then((b) => JSON.parse(decoder.decode(b)) as Checksums);
    return this.checksumsPromise;
  }

  /** Loads a pack named in the manifest and returns its uncompressed payload, verified. */
  async loadPack(name: string): Promise<Uint8Array> {
    const manifest = await this.manifest();
    const entry = manifest[name];
    if (!entry) throw new Error(`unknown pack "${name}"`);
    const url = resolveRelative(this.opts.manifestUrl, entry.file);
    const t0 = this.now();
    const fileBytes = await this.opts.readBytes(url);
    const t1 = this.now();
    let gz = fileBytes;
    if (entry.enc === 'b64') gz = decodeBase64(decoder.decode(fileBytes));
    // A server may already have inflated the file: then there is no gzip magic and the bytes are the payload.
    const payload = hasGzipMagic(gz) ? await gunzip(gz) : gz;
    const t2 = this.now();
    if (this.verify) {
      const want = (await this.checksums()).packs[name];
      if (!want) throw new DataIntegrityError(`${name}: no checksum record`);
      if (payload.length !== want.bytes) throw new DataIntegrityError(`${name}: ${payload.length} bytes, expected ${want.bytes}`);
      const got = hex8(fnv1a32(payload));
      if (got !== want.fnv1a) throw new DataIntegrityError(`${name}: fnv1a ${got}, expected ${want.fnv1a}`);
    }
    const t3 = this.now();
    this.timings.push({ name, readMs: t1 - t0, inflateMs: t2 - t1, checksumMs: t3 - t2, compressedBytes: fileBytes.length, bytes: payload.length });
    return payload;
  }

  /** Loads and verifies a JSON file next to the manifest (meta.json, cities.json, ...). */
  async loadJson<T>(file: string): Promise<T> {
    const bytes = await this.opts.readBytes(resolveRelative(this.opts.manifestUrl, file));
    if (this.verify) {
      const want = (await this.checksums()).files[file];
      if (!want) throw new DataIntegrityError(`${file}: no checksum record`);
      if (bytes.length !== want.bytes) throw new DataIntegrityError(`${file}: ${bytes.length} bytes, expected ${want.bytes}`);
      const got = hex8(fnv1a32(bytes));
      if (got !== want.fnv1a) throw new DataIntegrityError(`${file}: fnv1a ${got}, expected ${want.fnv1a}`);
    }
    return JSON.parse(decoder.decode(bytes)) as T;
  }
}
