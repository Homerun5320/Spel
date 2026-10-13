// "No other clocks": all cosmetic time (flyTo, owner-upload throttling, toasts, camera moves and inertia, fx, the
// tutorial hint, the autosave timer) reads src/render/clock.ts. Real time may only be read in the files listed here,
// each for a stated measurement or frame-driver reason. A later milestone that needs another file adds it HERE with a
// reason, and that line is reviewed; it must never be a cosmetic clock.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(__dirname, '../src');

const CLOCK_TOKENS = [/\bDate\.now\b/, /\bnew Date\b/, /\bperformance\.now\b/, /\brequestAnimationFrame\b/, /\bsetInterval\b/, /\bsetTimeout\b/, /\bgetTime\(\)/];

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
