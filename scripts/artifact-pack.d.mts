export const ALLOWED_EXT: Set<string>;
export const LIMITS: {
  textFileBytes: number;
  binaryFileBytes: number;
  batchFiles: number;
  batchBytes: number;
  artifactFiles: number;
  artifactBytes: number;
};
export const CONTAINERS: Record<'png' | 'wasm' | 'b64', { ext: string; enc: 'raw' | 'b64' }>;
export const REPO_ROOT: string;

export interface PackOptions {
  container: 'png' | 'wasm' | 'b64';
  prev: string | null;
  probe: boolean;
  dist: string;
  out: string;
}
export interface PackResult {
  code: number;
  errors: string[];
  files?: number;
  batches?: number;
  bytes?: number;
  removed?: string[];
  converted?: string[];
}
export interface BatchFile {
  path: string;
  source: string;
  size: number;
}
export type Batch = Record<string, string | null>;

export function toFragment(html: string): string;
export function fnv1a32(bytes: Uint8Array): number;
export function listFiles(dir: string): string[];
export function parseArgs(argv: string[]): { opts: PackOptions; errors: string[] };
export function makeProbePack(): { gz: Buffer; expected: { len: number; fnv1a: number } };
export function checkLinks(outDir: string): string[];
export function makeBatches(files: BatchFile[], removed: string[], maxFiles?: number, maxBytes?: number): Batch[];
export function readPrev(file: string): Set<string>;
export function pack(argv?: string[], options?: { cwd?: string; log?: (line: string) => void }): PackResult;
export function main(argv?: string[]): number;
