export const SWIFTSHADER_ARGS: string[];
export const LOCAL_GPU_ARGS: string[];
export const MAX_E2E_WORKERS: number;
export function isLocalGpu(env?: Record<string, string | undefined>): boolean;
export function chromiumArgs(env?: Record<string, string | undefined>): string[];
export function candidateBrowserPaths(platform?: string, env?: Record<string, string | undefined>): string[];
export function resolveLocalBrowserPath(opts: {
  env?: Record<string, string | undefined>;
  platform?: string;
  exists: (path: string) => boolean;
  playwrightPath: () => string;
}): string;
export function localWorkerCount(cpuCount?: number): number;
export function e2eWorkerCount(env?: Record<string, string | undefined>, cpuCount?: number, fallback?: number): number;
export function goldenCompareMode(env?: Record<string, string | undefined>): 'warn' | 'fail';
export function isDriverPerformanceHint(text: string): boolean;
export function downgradeDriverHints<T extends { type(): string; text(): string }>(proto: T): T;
