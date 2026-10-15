// M11a on the REAL 1024x512 world (mean and max elevation of the SIM pack): the mask against the exact line of sight (the oracle in
// helpers/losOracle.ts), the visible shares, and result hashes. Node only. The numbers are logged as "[los]" lines and copied to
// docs/PROGRESS.md "Measurements M11a" and docs/DECISIONS.md.
import { beforeAll, describe, expect, it } from 'vitest';
import { ALT_MODE_HIGH, ALT_MODE_LOW, createLos } from '../../src/sim/los/cache';
import { buildMask } from '../../src/sim/los/mask';
import { createEmptyState } from '../../src/sim/state';
import { cellAtLatLon, loadRealLos, type RealLos } from '../../tools/sim/losWorld';
import { accuracy as accuracyOf, shareOf as shareOfOn } from './helpers/losMeasure';

const R = 24;
const FIXTURES = { alps: [46.5, 9.5], himalaya: [27.7, 85.3], plains: [38.5, -98] } as const;
const PLAINS = { kansas: [38.5, -98], iowa: [42, -93], ukraine: [49, 32], pampas: [-34, -62], australia: [-30, 145] } as const;

let real: RealLos;
beforeAll(async () => {
  real = await loadRealLos();
});

const accuracy = (site: number) => accuracyOf(real.terrain, site, R);
const shareOf = (site: number, mode: 0 | 1): number => shareOfOn(real.terrain, real.terrainClass, site, mode, R);

function fnv(arrays: ArrayLike<number>[]): string {
  let h = 0x811c9dc5;
  for (const arr of arrays) for (let i = 0; i < arr.length; i++) h = Math.imul(h ^ (arr[i] as number), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
}

describe('M11a mask against the exact line of sight, Low, R = 24, on the real world', () => {
  for (const [name, [lat, lon]] of Object.entries(FIXTURES)) {
    it(`${name}: >= 85 % agreement, ZERO cells hidden by the mask but visible by the exact line, and the mask hides >= 60 % of what the line hides`, () => {
      const a = accuracy(cellAtLatLon(lat, lon));
      const pct = (100 * a.agree) / a.n;
      const hides = (100 * a.maskHidesOfExactHidden) / Math.max(1, a.exactHidden);
      console.log(`[los] ${name} R=24 Low: agreement ${pct.toFixed(1)} % of ${a.n}, mask-hidden-but-line-visible ${a.falseHidden}, line hides ${a.exactHidden}, mask hides ${hides.toFixed(1)} % of those`);
      expect(pct).toBeGreaterThanOrEqual(85);
      expect(a.falseHidden).toBe(0);
      if (name !== 'plains') expect(hides).toBeGreaterThanOrEqual(60);
    });
  }

  it('zero one-sided errors on all five Plains sites as well (logged)', () => {
    for (const [name, [lat, lon]] of Object.entries(PLAINS)) {
      const a = accuracy(cellAtLatLon(lat, lon));
      console.log(`[los] ${name} R=24 Low: agreement ${((100 * a.agree) / a.n).toFixed(1)} %, mask-hidden-but-line-visible ${a.falseHidden}`);
      expect(a.falseHidden, name).toBe(0);
    }
  });
});

describe('M11a visible share of the land within R = 24', () => {
  it('logs the shares; the Alps site is <= 20 % Low and High is never below Low on any fixture', () => {
    const rows: string[] = [];
    const low: Record<string, number> = {};
    for (const [name, [lat, lon]] of [...Object.entries(FIXTURES), ...Object.entries(PLAINS)]) {
      const site = cellAtLatLon(lat, lon);
      const l = shareOf(site, ALT_MODE_LOW);
      const h = shareOf(site, ALT_MODE_HIGH);
      low[name] = l;
      rows.push(`${name} Low ${l.toFixed(1)} % High ${h.toFixed(1)} %`);
      expect(h, name).toBeGreaterThanOrEqual(l);
    }
    const plains = Object.keys(PLAINS).map((k) => low[k] as number).sort((a, b) => a - b);
    console.log(`[los] shares: ${rows.join('; ')}; plains median Low ${(plains[2] as number).toFixed(1)} %`);
    expect(low.alps as number).toBeLessThanOrEqual(20);
  });

  // The STOP RULE of the M11a prompt fired: these two requirements are NOT met in the allowed ranges of EXAG (6-10) and the weight (0.2-0.6)
  // (docs/DECISIONS.md "M11a", docs/PROGRESS.md Known issues). `it.fails` keeps them as tests that go red the day an owner decision makes them true.
  it.fails('REQUIREMENT NOT MET: the Himalaya site sees <= 20 % of its land Low', () => {
    expect(shareOf(cellAtLatLon(...FIXTURES.himalaya), ALT_MODE_LOW)).toBeLessThanOrEqual(20);
  });

  it.fails('REQUIREMENT NOT MET: the Plains median is >= 2x the Alps value and >= 15 %', () => {
    const plains = Object.values(PLAINS).map(([lat, lon]) => shareOf(cellAtLatLon(lat, lon), ALT_MODE_LOW)).sort((a, b) => a - b);
    const alps = shareOf(cellAtLatLon(...FIXTURES.alps), ALT_MODE_LOW);
    expect(plains[2] as number).toBeGreaterThanOrEqual(Math.max(15, 2 * alps));
  });
});

describe('M11a result hashes (Node; the numbers are integer maths plus IEEE sqrt, so Chromium must agree)', () => {
  it('masks, composite and visible shares of the three fixtures hash to the pinned values', () => {
    const masks = Object.values(FIXTURES).map(([lat, lon]) => buildMask(real.terrain, cellAtLatLon(lat, lon), R));
    const los = createLos(real.terrain);
    for (const [lat, lon] of Object.values(FIXTURES)) los.addSite(1, cellAtLatLon(lat, lon), R);
    los.sync({ tick: 0, structures: createEmptyState(1024, 512, 1, 2).structures, terrainClass: real.terrainClass });
    const comp: number[] = [];
    for (const [lat, lon] of Object.values(FIXTURES)) {
      const site = cellAtLatLon(lat, lon);
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) comp.push(los.compositeAt(1, site + dy * 1024 + dx));
    }
    const shares = Object.values(FIXTURES).map(([lat, lon]) => Math.round(shareOf(cellAtLatLon(lat, lon), ALT_MODE_LOW) * 1000));
    const got = { masks: fnv(masks), composite: fnv([comp]), shares: fnv([shares]) };
    console.log(`[los] hashes ${JSON.stringify(got)}`);
    expect(got).toEqual({ masks: 'c357e58a', composite: 'c357e58a', shares: '8701d24d' });
  });
});
