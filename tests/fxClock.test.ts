// "No other clocks": all cosmetic time (flyTo, owner-upload throttling, toasts, camera moves and inertia, fx, the
// tutorial hint, the autosave timer) reads src/render/clock.ts. Real time may only be read in the files listed here,
// each for a stated measurement or frame-driver reason. A later milestone that needs another file adds it HERE with a
// reason, and that line is reviewed; it must never be a cosmetic clock.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(__dirname, '../src');

/** Every way to read real time, schedule a callback or let the browser animate by its own clock. */
const CLOCK_TOKENS = [
  /\bDate\.now\b/,
  /\bnew Date\b/,
  /\bDate\(/, // Date called without `new` returns the current time as a string
  /\bperformance\.now\b/,
  /performance\.timeOrigin/,
  /\.timeStamp\b/, // Event.timeStamp
  /\brequestAnimationFrame\b/,
  /requestIdleCallback/,
  /\bsetInterval\b/,
  /\bsetTimeout\b/,
  /setImmediate/,
  /\bgetTime\(\)/,
  // The browser's own animation clocks: CSS transitions and animations (injected style strings, `el.style.transition = ...`,
  // `@keyframes`) and the Web Animations API. Cosmetic motion is driven from the fx clock in JS, never by CSS.
  /\b(?:transition|animation)(?:-[a-z-]+)?\s*:/,
  /\.style\.(?:transition|animation)\b/,
  /@keyframes/,
  /\.animate\(/,
];

/** file (relative to src) -> why it may read real time */
const ALLOWED: Record<string, string> = {
  'render/clock.ts': 'the fx clock itself (mentions the tokens in comments only)',
  'app/globeApp.ts': 'frame driver: the ONE place that turns rAF frames into advanceFx(dt); first-frame and fps measurement',
  'app/main.ts': 'M00 spike scene (frame driver of the spike, first-frame measurement)',
  'app/debugData.ts': 'load-time measurement of the data page',
  'data/loader.ts': 'timing log of the pack loader (default `now`, injectable)',
  'probe.ts': 'preview probe page measurements',
};

function listTs(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listTs(p));
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('fx clock: no other clocks', () => {
  it('every token matches the clock it names and ignores harmless text', () => {
    const bad = [
      'Date.now()', 'new Date()', 'Date()', 'String(Date())', 'performance.now()', 'performance.timeOrigin', 'e.timeStamp',
      'requestAnimationFrame(f)', 'requestIdleCallback(f)', 'setInterval(f, 10)', 'setTimeout(f, 10)', 'setImmediate(f)', 't.getTime()',
      'el.style.cssText = "transition: opacity 1s"', "const css = `.a { animation: spin 1s; }`", 'a { transition-duration: 1s }',
      'el.style.transition = "none"', 'el.style.animation = "x"', '@keyframes spin {}', 'el.animate([], 100)',
    ];
    for (const text of bad) expect(CLOCK_TOKENS.some((re) => re.test(text)), text).toBe(true);
    const fine = [
      'updateDate(x)', 'const timeStampLabel = 1', 'the animation time is the fx clock', 'zoom animation is still moving',
      'no transition here', 'fxNow()', 'advanceFx(dt)', 'performance', 'mutate(x)',
    ];
    for (const text of fine) expect(CLOCK_TOKENS.some((re) => re.test(text)), text).toBe(false);
    // each token is exercised by at least one bad sample (a typo in a regex cannot hide behind the others)
    for (const re of CLOCK_TOKENS) expect(bad.some((text) => re.test(text)), String(re)).toBe(true);
  });

  it('only the allow-listed files read real time or schedule frames', () => {
    const offenders: string[] = [];
    for (const file of listTs(SRC)) {
      const rel = path.relative(SRC, file).split(path.sep).join('/');
      if (rel in ALLOWED) continue;
      const text = fs.readFileSync(file, 'utf8');
      for (const re of CLOCK_TOKENS) if (re.test(text)) offenders.push(`${rel}: ${re}`);
    }
    expect(offenders, 'use fxNow() from src/render/clock.ts for cosmetic time; add a file to ALLOWED only for a measurement').toEqual([]);
  });

  it('every allow-listed file exists (no stale entries)', () => {
    for (const rel of Object.keys(ALLOWED)) expect(fs.existsSync(path.join(SRC, rel)), rel).toBe(true);
  });

  it('the camera and the sun read the fx clock, not real time', () => {
    for (const rel of ['render/camera.ts', 'render/geo.ts', 'render/globe.ts', 'render/heightField.ts']) {
      const text = fs.readFileSync(path.join(SRC, rel), 'utf8');
      for (const re of CLOCK_TOKENS) expect(re.test(text), `${rel} ${re}`).toBe(false);
    }
    expect(fs.readFileSync(path.join(SRC, 'render/globe.ts'), 'utf8')).toMatch(/fxNow\(\)/);
  });
});
