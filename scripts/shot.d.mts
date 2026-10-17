import type { Browser, Page } from 'playwright-core';

export const REPO_ROOT: string;
export const GOLDEN_DIR: string;
export const OUT_DIR: string;
export const HANG_GUARD_MS: number;
export const CHROMIUM_ARGS: string[];
export const ALLOWED_CONSOLE_WARNINGS: string[];
export const GOLDEN_MISSING_TEXT: string;

export interface Thresholds {
  minDistinctColors: number;
  minLumaStd: number;
  minCentreCornerLuma: number;
  minLeftRightRatio: number;
  lumaFloor: number;
  silhouetteDelta: number;
  minCoverage: number;
  maxCoverage: number;
}
export const THRESHOLDS: Thresholds;

export interface RawImage {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray | Buffer;
}

export interface ImageMetrics {
  width: number;
  height: number;
  distinctColors: number;
  lumaStd: number;
  centreLuma: number;
  cornerLuma: number;
  centreCornerDiff: number;
  leftMeanLuma: number;
  rightMeanLuma: number;
  leftRightRatio: number;
  coverage: number;
}

export interface ConsoleMessage {
  type: 'error' | 'warning';
  text: string;
}

export interface SpikeShotInfo {
  renderer: string;
  vendor: string;
  glVersion: string;
  webgl2: boolean;
  drawCalls: number;
  triangles: number;
  textures: number;
  geometries: number;
  width: number;
  height: number;
  dpr: number;
  firstFrameMs: number | null;
  frames: number;
  testMode: boolean;
}

export interface ShotResult {
  png: Buffer;
  image: RawImage;
  info: SpikeShotInfo;
  consoleMessages: ConsoleMessage[];
  timings: { loadMs: number; renderMs: number; screenshotMs: number };
}

export function resolveChromiumPath(env?: Record<string, string | undefined>): string;
export function median(values: number[]): number;
export function guard<T>(promise: Promise<T>, label: string, ms?: number): Promise<T>;
export function decodePng(buffer: Buffer): RawImage;
export function encodePng(image: RawImage): Buffer;
export function luma(r: number, g: number, b: number): number;
export function analyzeImage(image: RawImage, thresholds?: Thresholds): ImageMetrics;
export function checkImageStats(metrics: ImageMetrics, thresholds?: Thresholds): string[];
export function disallowedConsole(messages: ConsoleMessage[], allowed?: string[]): ConsoleMessage[];
export function checkShot(shot: Pick<ShotResult, 'image' | 'info' | 'consoleMessages'>, thresholds?: Thresholds): string[];
export function assertShotOk(shot: Pick<ShotResult, 'image' | 'info' | 'consoleMessages'>, thresholds?: Thresholds): void;

export function launchBrowser(options?: { executablePath?: string }): Promise<{
  browser: Browser;
  executablePath: string;
  version: string;
}>;
export function openPage(
  browser: Browser,
  baseUrl: string,
  query: string,
  viewport?: { width: number; height: number },
  options?: { isolated?: boolean },
): Promise<{ page: Page; consoleMessages: ConsoleMessage[]; loadMs: number }>;
export function newTestPage(browser: Browser, viewport?: { width: number; height: number }, options?: { isolated?: boolean }): Promise<Page>;
export function takeShot(
  browser: Browser,
  baseUrl: string,
  opts?: { query?: string; viewport?: { width: number; height: number } },
): Promise<ShotResult>;
export function renderAndCapture(page: Page): Promise<Buffer>;
export function waitFrames(page: Page, n?: number): Promise<void>;
export const LIVE_POLL_MS: number;
export function waitVisible(page: Page, selector: string, timeout?: number): Promise<unknown>;
export function fastClick(page: Page, selector: string, timeout?: number): Promise<void>;

export interface GoldenResult {
  status: 'updated' | 'match' | 'missing-warn' | 'mismatch-warn';
  diffPixels: number;
  ratio: number;
}
export function compareGolden(
  actualPng: Buffer,
  name: string,
  options?: { env?: Record<string, string | undefined>; goldenDir?: string; outDir?: string },
): GoldenResult;

export function readUsedHeap(page: Page): Promise<number>;
export function heapDelta(page: Page, fn: () => Promise<unknown> | unknown): Promise<number>;
export function startViteServer(): Promise<{ url: string; close: () => Promise<void> }>;
export function main(argv?: string[]): Promise<void>;
