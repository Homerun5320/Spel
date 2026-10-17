// CLAUDE.md "Time rule": heap and memory asserts use heapDelta(page, fn) (gc before and after, median of 3). A raw read of the heap size without a gc
// is noise (the flake of the HUD test at M05 and M06 was one). This scan keeps raw reads out of the test code; the one allowed file reads the
// size on purpose to check the precision of the reading.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');
const RAW = new RegExp(['usedJS' + 'HeapSize', 'performance' + '\\.memory', 'process' + '\\.memoryUsage', 'read' + 'UsedHeap', 'getHeap' + 'Statistics'].join('|'));
const ALLOWED = new Set([path.join('e2e', 'heap.test.ts'), path.join('tests', 'rawHeap.test.ts')]);

function listTs(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listTs(p));
    else if (/\.(ts|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe('no raw heap read in the test code', () => {
  it('e2e/ and tests/ read the heap only through heapDelta (the self-test of the reading itself is the one exception)', () => {
    const offenders: string[] = [];
    for (const dir of ['e2e', 'tests']) {
      for (const file of listTs(path.join(ROOT, dir))) {
        const rel = path.relative(ROOT, file);
        if (ALLOWED.has(rel)) continue;
        if (RAW.test(fs.readFileSync(file, 'utf8'))) offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the scan sees what it looks for (the allowed file really holds a raw read)', () => {
    expect(RAW.test(fs.readFileSync(path.join(ROOT, 'e2e', 'heap.test.ts'), 'utf8'))).toBe(true);
    expect(RAW.test('const h = performance.memory.' + 'usedJS' + 'HeapSize;')).toBe(true);
  });
});
