// Local GPU mode (LOCAL_GPU=1): pure helpers shared by scripts/shot.mjs, vitest.config.ts and scripts/verify-local.mjs.
//
// The cloud sandbox and CI render in software (SwiftShader); a desktop PC has a real GPU. Without LOCAL_GPU=1 every
// helper here returns exactly what the project always used (tests/localGpu.test.ts pins the Chromium argument array
// against a committed copy). With LOCAL_GPU=1:
//   - the SwiftShader switches are dropped and Chromium picks the GPU through ANGLE's defaults,
//   - CHROME_PATH (or an auto-detected Chrome / Edge, else Playwright's own Chromium) is the browser,
//   - golden image comparison only warns (the committed goldens are SwiftShader renders), the pixel rules still assert,
//   - the e2e worker count follows the CPU count.
// No bash syntax anywhere: everything is plain Node so it runs the same on Windows, macOS and Linux.
import os from 'node:os';

/** The cloud / CI Chromium switches (see docs/CHARTER.md section 6). `--enable-precise-memory-info` is its own argument. */
export const SWIFTSHADER_ARGS = [
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
  '--use-angle=swiftshader',
  '--force-color-profile=srgb',
  '--js-flags=--expose-gc',
  '--enable-precise-memory-info',
];

/** The same switches without the two SwiftShader ones: ANGLE picks the machine's GPU (D3D11 on Windows, Metal on macOS). */
export const LOCAL_GPU_ARGS = [
  '--ignore-gpu-blocklist',
  '--force-color-profile=srgb',
  '--js-flags=--expose-gc',
  '--enable-precise-memory-info',
];

/** At most this many Chromium instances run at the same time in the parallel e2e project. */
export const MAX_E2E_WORKERS = 4;

export function isLocalGpu(env = process.env) {
  return env.LOCAL_GPU === '1';
}

/** A fresh array every call (callers may not mutate the constants). */
export function chromiumArgs(env = process.env) {
  return isLocalGpu(env) ? [...LOCAL_GPU_ARGS] : [...SWIFTSHADER_ARGS];
}

/** Where a desktop Chrome or Edge usually lives, in the order they are tried. */
export function candidateBrowserPaths(platform = process.platform, env = process.env) {
  if (platform === 'win32') {
    const roots = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean);
    const rel = ['Google\\Chrome\\Application\\chrome.exe', 'Microsoft\\Edge\\Application\\msedge.exe'];
    return rel.flatMap((r) => roots.map((root) => `${root}\\${r}`));
  }
  if (platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ];
  }
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'];
}

/**
 * The browser executable for LOCAL_GPU mode: CHROMIUM_PATH, then CHROME_PATH, then the first installed Chrome / Edge,
 * then Playwright's own Chromium (`npx playwright-core install chromium`). `exists` and `playwrightPath` are injectable.
 */
export function resolveLocalBrowserPath({ env = process.env, platform = process.platform, exists, playwrightPath }) {
  if (env.CHROMIUM_PATH) return env.CHROMIUM_PATH;
  if (env.CHROME_PATH) return env.CHROME_PATH;
  for (const p of candidateBrowserPaths(platform, env)) if (exists(p)) return p;
  return playwrightPath();
}

/** Parallel e2e workers: E2E_WORKERS wins; LOCAL_GPU picks floor(cores / 2), at least 1, at most MAX_E2E_WORKERS. */
export function localWorkerCount(cpuCount = os.availableParallelism()) {
  return Math.max(1, Math.min(MAX_E2E_WORKERS, Math.floor(cpuCount / 2)));
}

export function e2eWorkerCount(env = process.env, cpuCount = os.availableParallelism(), fallback = 1) {
  const explicit = Number(env.E2E_WORKERS);
  if (Number.isInteger(explicit) && explicit >= 1) return Math.min(explicit, MAX_E2E_WORKERS);
  return isLocalGpu(env) ? localWorkerCount(cpuCount) : fallback;
}

/** 'warn' when golden comparison may only warn (LOCAL_GPU, or GOLDEN_COMPARE=warn as CI sets it), else 'fail'. */
export function goldenCompareMode(env = process.env) {
  if (env.GOLDEN_COMPARE === 'warn') return 'warn';
  if (env.GOLDEN_COMPARE === 'fail') return 'fail';
  return isLocalGpu(env) ? 'warn' : 'fail';
}
