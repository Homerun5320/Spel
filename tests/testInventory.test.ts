// The TestSpeed inventory script (scripts/test-inventory.mjs): proves that "no test case and no assertion was lost" is a real check.
import { describe, expect, it } from 'vitest';
import { compareInventories, countExpects, inventoryFromReports } from '../scripts/test-inventory.mjs';

const inv = (tests: string[], expects: number): { tests: string[]; expects: number } => ({ tests, expects });

describe('countExpects', () => {
  it('counts expect( and expect.soft( call sites', () => {
    expect(countExpects('expect(a).toBe(1); expect(b).toBe(2);\nexpect.soft(c).toBe(3)')).toBe(3);
    expect(countExpects('const expected = 1; // no calls here')).toBe(0);
  });
});

describe('inventoryFromReports', () => {
  it('uses the test names of the run and keeps the path from the first e2e/ folder on (another checkout)', () => {
    const report = { testResults: [{ name: '/elsewhere/Spel/e2e/a.test.ts', assertionResults: [{ fullName: 'd > b', title: 'b' }, { title: 'only title' }] }] };
    const out = inventoryFromReports([report]);
    expect(Object.keys(out)).toEqual(['e2e/a.test.ts']);
    expect(out['e2e/a.test.ts']?.tests).toEqual(['d > b', 'only title']);
  });
});

describe('compareInventories', () => {
  const before = { 'e2e/a.test.ts': inv(['one', 'two'], 10), 'e2e/b.test.ts': inv(['three'], 4) };

  it('equal inventories lose nothing', () => {
    const r = compareInventories(before, before);
    expect([r.missing, r.countDrops, r.expectDrops, r.added, r.moved]).toEqual([[], [], [], [], []]);
  });
  it('a deleted test is reported as missing', () => {
    const r = compareInventories(before, { ...before, 'e2e/a.test.ts': inv(['one'], 10) });
    expect(r.missing).toEqual(['e2e/a.test.ts: two']);
    expect(r.countDrops).toHaveLength(1);
  });
  it('a renamed test is reported as missing plus added (a rename needs a note)', () => {
    const r = compareInventories(before, { ...before, 'e2e/a.test.ts': inv(['one', 'two renamed'], 10) });
    expect(r.missing).toEqual(['e2e/a.test.ts: two']);
    expect(r.added).toEqual(['e2e/a.test.ts: two renamed']);
  });
  it('fewer expect() calls in a file are reported, also when the test names are all still there', () => {
    const r = compareInventories(before, { ...before, 'e2e/b.test.ts': inv(['three'], 3) });
    expect(r.expectDrops[0]).toContain('e2e/b.test.ts: 4 -> 3');
  });
  it('a test moved to another file is reported as moved, not as lost; the grand total of expect() calls still may not drop', () => {
    const moved = { 'e2e/a.test.ts': inv(['one'], 8), 'e2e/b.test.ts': inv(['three', 'two'], 6) };
    const r = compareInventories(before, moved);
    expect(r.moved).toEqual(['e2e/a.test.ts -> e2e/b.test.ts: two']);
    expect([r.missing, r.countDrops, r.expectDrops]).toEqual([[], [], []]);
    const lossy = compareInventories(before, { 'e2e/a.test.ts': inv(['one'], 8), 'e2e/b.test.ts': inv(['three', 'two'], 5) });
    expect(lossy.expectDrops).toEqual(['TOTAL: 14 -> 13 expect() calls']);
  });
  it('a vanished file loses all its tests', () => {
    const r = compareInventories(before, { 'e2e/a.test.ts': before['e2e/a.test.ts'] });
    expect(r.missing).toEqual(['e2e/b.test.ts: three']);
  });
  it('new tests and new files are only reported as added', () => {
    const r = compareInventories(before, { ...before, 'e2e/c.test.ts': inv(['x'], 1) });
    expect(r.added).toEqual(['e2e/c.test.ts: new file (1 tests)']);
    expect([r.missing, r.countDrops, r.expectDrops]).toEqual([[], [], []]);
  });
});
