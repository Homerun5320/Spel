// LOCAL_GPU=1 plumbing (docs/LOCAL.md). The default behaviour without the switch must be byte-identical to what the cloud
// session and CI always used: the SwiftShader argument array below is a committed copy of the baseline.
// What this file cannot prove: that a real GPU renders anything (no GPU in the sandbox), see docs/LOCAL.md "Known limitations".
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LOCAL_GPU_ARGS,
  MAX_E2E_WORKERS,
  SWIFTSHADER_ARGS,
  applyLocalFlag,
  candidateBrowserPaths,
  chromiumArgs,
  downgradeDriverHints,
  e2eWorkerCount,
  goldenCompareMode,
  isDriverPerformanceHint,
  isLocalGpu,
  localWorkerCount,
  resolveLocalBrowserPath,
} from '../scripts/localGpu.mjs';
import { CHROMIUM_ARGS, compareGolden, encodePng, resolveChromiumPath, type RawImage } from '../scripts/shot.mjs';

/** The baseline array as committed before the TestSpeed pass (docs/CHARTER.md section 6). Never edit this copy. */
const BASELINE_ARGS = [
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
  '--use-angle=swiftshader',
  '--force-color-profile=srgb',
  '--js-flags=--expose-gc',
  '--enable-precise-memory-info',
];

describe('default Chromium arguments (no LOCAL_GPU)', () => {
  it('are byte-identical to the committed baseline array', () => {
    expect(JSON.stringify(chromiumArgs({}))).toBe(JSON.stringify(BASELINE_ARGS));
    expect(JSON.stringify(CHROMIUM_ARGS)).toBe(JSON.stringify(BASELINE_ARGS));
    expect(JSON.stringify(SWIFTSHADER_ARGS)).toBe(JSON.stringify(BASELINE_ARGS));
  });
  it('stay the baseline for every value of LOCAL_GPU except "1"', () => {
    for (const v of [undefined, '', '0', 'true', 'yes', ' 1']) {
      expect(chromiumArgs({ LOCAL_GPU: v })).toEqual(BASELINE_ARGS);
      expect(isLocalGpu({ LOCAL_GPU: v })).toBe(false);
    }
  });
  it('are a fresh copy each call (a caller cannot corrupt the constant)', () => {
    const a = chromiumArgs({});
    a.push('--x');
    expect(chromiumArgs({})).toEqual(BASELINE_ARGS);
  });
  it('the default browser path logic is unchanged: CHROMIUM_PATH wins, CHROME_PATH is ignored without the switch', () => {
    expect(resolveChromiumPath({ CHROMIUM_PATH: '/x/chrome', CHROME_PATH: '/y/chrome' })).toBe('/x/chrome');
  });
  it('golden comparison stays strict without the switch and warns only for GOLDEN_COMPARE=warn', () => {
    expect(goldenCompareMode({})).toBe('fail');
    expect(goldenCompareMode({ GOLDEN_COMPARE: 'warn' })).toBe('warn');
  });
  it('the e2e worker count is the fallback without the switch (and E2E_WORKERS overrides it)', () => {
    expect(e2eWorkerCount({}, 10, 1)).toBe(1);
    expect(e2eWorkerCount({}, 10, 2)).toBe(2);
    expect(e2eWorkerCount({ E2E_WORKERS: '3' }, 10, 1)).toBe(3);
  });
});

describe('LOCAL_GPU=1', () => {
  const env = { LOCAL_GPU: '1' };

  it('drops exactly the two SwiftShader switches and keeps the rest in the same order', () => {
    const local = chromiumArgs(env);
    expect(local).toEqual(LOCAL_GPU_ARGS);
    expect(local).toEqual(BASELINE_ARGS.filter((a) => a !== '--enable-unsafe-swiftshader' && a !== '--use-angle=swiftshader'));
    expect(local.some((a) => /swiftshader/i.test(a))).toBe(false);
    expect(local.some((a) => a.startsWith('--use-angle'))).toBe(false); // ANGLE defaults pick the GPU
  });
  it('keeps --enable-precise-memory-info as its own argument and --expose-gc for heapDelta', () => {
    const local = chromiumArgs(env);
    expect(local).toContain('--enable-precise-memory-info');
    expect(local.find((a) => a.startsWith('--js-flags='))).toBe('--js-flags=--expose-gc');
  });

  it('picks the browser: CHROMIUM_PATH, CHROME_PATH, an installed Chrome / Edge, then Playwright', () => {
    const never = (): boolean => false;
    const pw = (): string => '/pw/chromium';
    expect(resolveLocalBrowserPath({ env: { ...env, CHROMIUM_PATH: '/a', CHROME_PATH: '/b' }, exists: never, playwrightPath: pw })).toBe('/a');
    expect(resolveLocalBrowserPath({ env: { ...env, CHROME_PATH: '/b' }, exists: never, playwrightPath: pw })).toBe('/b');
    const win = { ...env, PROGRAMFILES: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' };
    const edge = 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe';
    expect(resolveLocalBrowserPath({ env: win, platform: 'win32', exists: (p) => p === edge, playwrightPath: pw })).toBe(edge);
    expect(resolveLocalBrowserPath({ env: win, platform: 'win32', exists: never, playwrightPath: pw })).toBe('/pw/chromium');
  });
  it('lists Chrome before Edge on every platform and only existing-looking absolute paths', () => {
    const win = candidateBrowserPaths('win32', { PROGRAMFILES: 'C:\\P', 'PROGRAMFILES(X86)': 'C:\\P86', LOCALAPPDATA: 'C:\\L' });
    expect(win[0]).toBe('C:\\P\\Google\\Chrome\\Application\\chrome.exe');
    expect(win.findIndex((p) => p.includes('msedge'))).toBeGreaterThan(win.findIndex((p) => p.includes('chrome.exe')));
    expect(candidateBrowserPaths('darwin', {})[0]).toContain('Google Chrome');
    expect(candidateBrowserPaths('linux', {})[0]).toBe('/usr/bin/google-chrome');
    expect(candidateBrowserPaths('win32', {})).toEqual([]); // no Windows variables: nothing to probe
  });
  it('resolveChromiumPath honours CHROME_PATH under the switch', () => {
    expect(resolveChromiumPath({ ...env, CHROME_PATH: '/my/chrome' })).toBe('/my/chrome');
  });

  it('the worker count follows the CPU count: floor(cores / 2), at least 1, at most 4', () => {
    expect(localWorkerCount(1)).toBe(1);
    expect(localWorkerCount(2)).toBe(1);
    expect(localWorkerCount(4)).toBe(2);
    expect(localWorkerCount(6)).toBe(3);
    expect(localWorkerCount(10)).toBe(4);
    expect(localWorkerCount(64)).toBe(MAX_E2E_WORKERS);
    expect(e2eWorkerCount(env, 10, 1)).toBe(4);
    expect(e2eWorkerCount({ ...env, E2E_WORKERS: '2' }, 10, 1)).toBe(2);
    expect(e2eWorkerCount({ ...env, E2E_WORKERS: '99' }, 10, 1)).toBe(MAX_E2E_WORKERS);
    expect(e2eWorkerCount({ ...env, E2E_WORKERS: 'x' }, 10, 1)).toBe(4);
  });

  it('golden comparison warns by default, unless GOLDEN_COMPARE=fail is asked for', () => {
    expect(goldenCompareMode(env)).toBe('warn');
    expect(goldenCompareMode({ ...env, GOLDEN_COMPARE: 'fail' })).toBe('fail');
  });

  describe('compareGolden', () => {
    const W = 64;
    const H = 36;
    function image(seed: number): RawImage {
      const data = new Uint8Array(W * H * 4);
      for (let i = 0; i < W * H; i++) {
        const v = (i * seed) % 251;
        data[i * 4] = v;
        data[i * 4 + 1] = (v * 3) % 256;
        data[i * 4 + 2] = 255 - v;
        data[i * 4 + 3] = 255;
      }
      return { width: W, height: H, data };
    }
    const dirs = (): { goldenDir: string; outDir: string } => {
      const base = fs.mkdtempSync(path.join(os.tmpdir(), 'golden-local-'));
      return { goldenDir: path.join(base, 'goldens'), outDir: path.join(base, 'out') };
    };

    it('a different render only warns and still writes the actual and diff images to the output folder', () => {
      const d = dirs();
      const golden = encodePng(image(7));
      const other = encodePng(image(13));
      compareGolden(golden, 'x', { ...d, env: { UPDATE_GOLDENS: '1' } });
      expect(() => compareGolden(other, 'x', { ...d, env: {} })).toThrow(/differs/); // strict without the switch
      expect(compareGolden(other, 'x', { ...d, env }).status).toBe('mismatch-warn');
      expect(fs.existsSync(path.join(d.outDir, 'x.actual.png'))).toBe(true);
      expect(fs.existsSync(path.join(d.outDir, 'x.diff.png'))).toBe(true);
      expect(() => compareGolden(other, 'x', { ...d, env: { ...env, GOLDEN_COMPARE: 'fail' } })).toThrow(/differs/);
    });
    it('a missing golden only warns', () => {
      const d = dirs();
      expect(compareGolden(encodePng(image(7)), 'nope', { ...d, env }).status).toBe('missing-warn');
    });
    it('UPDATE_GOLDENS=1 is refused (the committed goldens are SwiftShader renders)', () => {
      const d = dirs();
      expect(() => compareGolden(encodePng(image(7)), 'x', { ...d, env: { ...env, UPDATE_GOLDENS: '1' } })).toThrow(/refused/);
      expect(fs.existsSync(d.goldenDir)).toBe(false);
    });
  });
});

describe('driver performance hints (a real GPU reports them as console warnings)', () => {
  const hint = '[.WebGL-0xac00118200]GL Driver Message (OpenGL, Performance, GL_CLOSE_PATH_NV, High): GPU stall due to ReadPixels';
  const fallback = '[GroupMarkerNotSet(crbug.com/242999)!:A07020007C270000]Automatic fallback to software WebGL has been deprecated.';

  it('only the GL Driver Message performance hints match; the software fallback and real errors do not', () => {
    expect(isDriverPerformanceHint(hint)).toBe(true);
    expect(isDriverPerformanceHint('[.WebGL-0x1]GL Driver Message (OpenGL, Performance, GL_FOO, Medium): something')).toBe(true);
    expect(isDriverPerformanceHint(fallback)).toBe(false); // means: the GPU is NOT used, must stay visible
    expect(isDriverPerformanceHint('[.WebGL-0x1]GL Driver Message (OpenGL, Error, GL_INVALID_OPERATION, High): bad call')).toBe(false);
    expect(isDriverPerformanceHint('Uncaught TypeError: x is not a function')).toBe(false);
  });

  class FakeMessage {
    constructor(
      private readonly kind: string,
      private readonly body: string,
    ) {}
    type(): string {
      return this.kind;
    }
    text(): string {
      return this.body;
    }
  }

  it('downgradeDriverHints turns such a warning into debug, leaves every other message alone, and is idempotent', () => {
    downgradeDriverHints(FakeMessage.prototype);
    downgradeDriverHints(FakeMessage.prototype);
    expect(new FakeMessage('warning', hint).type()).toBe('debug');
    expect(new FakeMessage('warning', fallback).type()).toBe('warning');
    expect(new FakeMessage('error', hint).type()).toBe('error');
    expect(new FakeMessage('log', 'hello').type()).toBe('log');
  });

  it('the pinned playwright-core still has the ConsoleMessage class that LOCAL_GPU mode patches by path', () => {
    const require = createRequire(import.meta.url);
    const dir = require.resolve('playwright-core/package.json').replace(/package\.json$/, '');
    const { ConsoleMessage } = require(`${dir}lib/client/consoleMessage.js`);
    const m = new ConsoleMessage({}, { type: 'warning', text: hint, args: [], location: {} }, null);
    expect([m.type(), m.text()]).toEqual(['warning', hint]);
  });
});

describe('npm run shots:local (the screenshot CLI in LOCAL_GPU mode without shell syntax)', () => {
  it('package.json has the script and it is plain node with --local', () => {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['shots:local']).toBe('node scripts/shot.mjs --local');
    expect(pkg.scripts['shots']).toBe('node scripts/shot.mjs');
  });
  it('--local sets LOCAL_GPU=1 and is removed from the arguments; without it nothing changes', () => {
    const env: Record<string, string | undefined> = {};
    expect(applyLocalFlag(['test=1', 'smoke'], env)).toEqual(['test=1', 'smoke']);
    expect(env.LOCAL_GPU).toBeUndefined();
    expect(applyLocalFlag(['--local', 'test=1'], env)).toEqual(['test=1']);
    expect(env.LOCAL_GPU).toBe('1');
    expect(isLocalGpu(env)).toBe(true);
    expect(chromiumArgs(env)).toEqual(LOCAL_GPU_ARGS);
  });
  it('docs/LOCAL.md sends the user to shots:local, not to the SwiftShader shots script', () => {
    const doc = fs.readFileSync('docs/LOCAL.md', 'utf8');
    expect(doc).toContain('npm run shots:local');
    expect(doc).not.toMatch(/skärmdump och renderern: `npm run shots`/);
  });
});
