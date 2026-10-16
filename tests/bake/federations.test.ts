// M18b-1: the federations pack. Real data tests read the COMMITTED pack in public/data (no network); the determinism test on the
// real admin-1 file runs only when the gitignored bake cache is present, a synthetic one always runs.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { fnv1a32, hex8 } from '../../src/data/bytes';
import { FederationDataError, federationOfCell, isFederationCandidate, membersOfCountry, packFederations, parseFederations, type Federations } from '../../src/data/federations';
import { SIM_HEIGHT, SIM_WIDTH } from '../../src/data/format';
import { simGridView } from '../../src/data/world';
import { FEDERATION_MAX_SUBNATIONS, FEDERATION_MIN_PROVINCE_CELLS } from '../../tools/bake/classify';
import { buildFederations, type Admin1Feature } from '../../tools/bake/federations';
import { checkData } from '../../tools/bake/check';

const DIR = path.resolve(import.meta.dirname, '../../public/data');
const read = (n: string): Uint8Array => new Uint8Array(fs.readFileSync(path.join(DIR, n)));
const meta = JSON.parse(fs.readFileSync(path.join(DIR, 'meta.json'), 'utf8')) as { countries: Array<{ id: number; a3: string; name_en: string; cells: number }> };
const payload = new Uint8Array(zlib.gunzipSync(read('federations.bin.gz')));
const fed = parseFederations(payload, meta.countries.length);
const sim = simGridView(new Uint8Array(zlib.gunzipSync(read('sim.bin.gz'))));
const N = SIM_WIDTH * SIM_HEIGHT;
const indexOf = (a3: string): number => meta.countries.findIndex((c) => c.a3 === a3);

describe('federations pack: format', () => {
  it('round-trips: pack(parse(bytes)) is the same bytes and the tables survive', () => {
    const again = packFederations(fed);
    expect(again.length).toBe(payload.length);
    expect(hex8(fnv1a32(again))).toBe(hex8(fnv1a32(payload)));
    const back = parseFederations(again);
    expect(back.subNations).toEqual(fed.subNations);
    expect(back.provinces).toEqual(fed.provinces);
    expect([...back.federationRaster]).toEqual([...fed.federationRaster]);
  });

  it('rejects corrupt packs', () => {
    const mut = (f: (b: Uint8Array) => void): Uint8Array => {
      const b = payload.slice();
      f(b);
      return b;
    };
    const dv = (b: Uint8Array): DataView => new DataView(b.buffer);
    const bad: Array<[string, Uint8Array]> = [
      ['empty', new Uint8Array(0)],
      ['truncated', payload.subarray(0, payload.length - 5)],
      ['trailing byte', new Uint8Array([...payload, 0])],
      ['magic', mut((b) => (b[0] = 0))],
      ['version', mut((b) => dv(b).setUint32(4, 99, true))],
      ['grid', mut((b) => dv(b).setUint16(8, 512, true))],
      ['federation raster value out of range', mut((b) => (b[b.length - 1] = 250))],
      ['federation raster moves a cell', mut((b) => (b[b.length - N + 10 * SIM_WIDTH + 400] = fed.federationRaster[10 * SIM_WIDTH + 400] === 1 ? 2 : 1))],
      ['province raster value out of range', mut((b) => dv(b).setUint16(b.length - N * 3, 65535, true))],
    ];
    for (const [name, bytes] of bad) expect(() => parseFederations(bytes, meta.countries.length), name).toThrow(FederationDataError);
    expect(() => parseFederations(payload, meta.countries.length + 1)).toThrow(FederationDataError);
  });
});

describe('federations pack: raster invariants on the committed data', () => {
  it('candidate list holds the great powers and nothing small', () => {
    const cands = meta.countries.filter((_, i) => isFederationCandidate(fed, i)).map((c) => c.a3);
    expect(cands.sort()).toEqual(['AUS', 'BRA', 'CAN', 'CHN', 'IND', 'RUS', 'USA']);
    expect(isFederationCandidate(fed, indexOf('IDN'))).toBe(false);
    expect(isFederationCandidate(fed, indexOf('FRA'))).toBe(false);
    expect(isFederationCandidate(fed, 9999)).toBe(false);
  });

  it('every land cell of a candidate has exactly one sub-nation of its own country; no sub-nation elsewhere', () => {
    const counted = new Uint32Array(fed.subNations.length + 1);
    for (let i = 0; i < N; i++) {
      const c = (sim.country[i] as number) - 1;
      const f = federationOfCell(fed, i);
      if (sim.land[i] === 1 && c >= 0 && isFederationCandidate(fed, c)) {
        expect(f, `cell ${i}`).toBeGreaterThan(0);
        expect((fed.subNations[f - 1] as { country: number }).country).toBe(c);
        counted[f] = (counted[f] as number) + 1;
        expect(fed.provinceRaster[i]).toBeGreaterThan(0);
      } else {
        expect(f, `cell ${i}`).toBe(0);
      }
    }
    for (const s of fed.subNations) expect(counted[s.id], s.name).toBe(s.cells);
  });

  it('no sub-nation is empty or small, the counts fit, the sizes sum to the country', () => {
    for (let c = 0; c < meta.countries.length; c++) {
      if (!isFederationCandidate(fed, c)) {
        expect(membersOfCountry(fed, c)).toEqual([]);
        continue;
      }
      const members = membersOfCountry(fed, c);
      expect(members.length).toBeGreaterThanOrEqual(2);
      expect(members.length).toBeLessThanOrEqual(FEDERATION_MAX_SUBNATIONS);
      let sum = 0;
      for (const id of members) {
        const s = fed.subNations[id - 1] as { cells: number; name: string };
        expect(s.cells, s.name).toBeGreaterThanOrEqual(FEDERATION_MIN_PROVINCE_CELLS);
        sum += s.cells;
      }
      expect(sum).toBe((meta.countries[c] as { cells: number }).cells);
    }
  });

  it('sub-nations are contiguous: the largest connected part holds at least 90 percent, loose parts are islands (documented)', () => {
    const seen = new Uint8Array(N);
    const largest = new Map<number, number>();
    const stack: number[] = [];
    for (let i = 0; i < N; i++) {
      const f = federationOfCell(fed, i);
      if (f === 0 || seen[i]) continue;
      let size = 0;
      seen[i] = 1;
      stack.push(i);
      while (stack.length > 0) {
        const j = stack.pop() as number;
        size++;
        const x = j % SIM_WIDTH;
        for (const k of [j - (x === 0 ? -(SIM_WIDTH - 1) : 1), j + (x === SIM_WIDTH - 1 ? -(SIM_WIDTH - 1) : 1), j - SIM_WIDTH, j + SIM_WIDTH]) {
          if (k >= 0 && k < N && !seen[k] && federationOfCell(fed, k) === f) {
            seen[k] = 1;
            stack.push(k);
          }
        }
      }
      largest.set(f, Math.max(largest.get(f) ?? 0, size));
    }
    // Documented exceptions: arctic archipelagos (Nunavut, Northwest Territories, Novaya Zemlya in Arkhangelsk), Newfoundland,
    // and north-east India behind the narrow neck that the 39 km grid cuts (Bihar Region). Measured shares 0.53 to 0.77.
    const islandy = new Set(['Nunavut', 'Northwest Territories', 'Arkhangelsk Region', 'Newfoundland and Labrador', 'Bihar Region']);
    for (const s of fed.subNations) expect((largest.get(s.id) as number) / s.cells, s.name).toBeGreaterThanOrEqual(islandy.has(s.name) ? 0.5 : 0.9);
  });

  it('every province keeps a row: tiny ones are flagged, and the centroid lies inside the province', () => {
    expect(fed.provinces.length).toBe(294);
    for (const p of fed.provinces) {
      expect(p.tiny).toBe(p.cells <= 1);
      if (p.cells > 0) expect(fed.provinceRaster[p.centroid]).toBe(p.id);
      expect(p.key.length).toBeGreaterThan(0);
    }
    for (const s of fed.subNations) expect(federationOfCell(fed, s.centroid), s.name).toBe(s.id);
  });
});

describe('federations pack: existing data is untouched', () => {
  it('the old packs and JSON files keep their pinned hashes and bake:check is clean', () => {
    const checks = JSON.parse(new TextDecoder().decode(read('checksums.json'))) as { packs: Record<string, { fnv1a: string }>; files: Record<string, { fnv1a: string }> };
    expect(checks.packs.sim?.fnv1a).toBe('eb1a4718');
    expect(checks.packs.render?.fnv1a).toBe('6fda3803');
    expect(checks.files['meta.json']?.fnv1a).toBe('963b4c26');
    expect(checks.files['cities.json']?.fnv1a).toBe('f736d8cf');
    expect(checks.files['ports.json']?.fnv1a).toBe('714a711d');
    expect(checks.files['overrides.json']?.fnv1a).toBe('586715ed');
    expect(checks.packs.federations).toBeDefined();
    expect(checkData(DIR).problems).toEqual([]);
  });
});

// ---- determinism ------------------------------------------------------------------------------------------------------

function box(a3: string, name: string, lon0: number, lat0: number, lon1: number, lat1: number): Admin1Feature {
  return {
    properties: { adm0_a3: a3, name, iso_3166_2: `${a3}-${name}` },
    geometry: { type: 'Polygon', coordinates: [[[lon0, lat0], [lon1, lat0], [lon1, lat1], [lon0, lat1], [lon0, lat0]]] },
  };
}

describe('federations bake: determinism', () => {
  // A 60 x 30 degree country made of a 3 x 2 grid of provinces plus one province that straddles a gap, on the real grid.
  const country = new Uint8Array(N);
  const land = new Uint8Array(N);
  for (let y = 100; y < 160; y++) for (let x = 400; x < 520; x++) {
    country[y * SIM_WIDTH + x] = 1;
    land[y * SIM_WIDTH + x] = 1;
  }
  const lon = (x: number): number => -180 + (x / SIM_WIDTH) * 360;
  const lat = (y: number): number => 90 - (y / SIM_HEIGHT) * 180;
  const feats: Admin1Feature[] = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) feats.push(box('AAA', `P${i}${j}`, lon(400 + i * 40), lat(100 + j * 30 + 28), lon(440 + i * 40 - 1), lat(100 + j * 30))); // 1 cell gaps
  const countries = [{ id: 1, a3: 'AAA', name_en: 'Aland' }];

  it('two builds give identical bytes; gaps are filled; cells and members agree', () => {
    const a = buildFederations(country, land, countries, feats).federations;
    const b = buildFederations(country, land, countries, feats.slice().reverse()).federations;
    expect(hex8(fnv1a32(packFederations(a)))).toBe(hex8(fnv1a32(packFederations(b))));
    let landCells = 0;
    for (let i = 0; i < N; i++) if (land[i]) landCells++;
    expect(a.provinceRaster.filter((v) => v > 0).length).toBe(landCells);
    expect(a.candidate[0]).toBe(1); // 7200 cells, over the minimum area
  });

  const cache = path.resolve(import.meta.dirname, '../../.cache/bake/ne');
  const sha = meta.countries.length > 0 ? (JSON.parse(fs.readFileSync(path.join(DIR, 'meta.json'), 'utf8')) as { source: { naturalEarth: { sha: string } } }).source.naturalEarth.sha : '';
  const admin1File = path.join(cache, sha, 'ne_50m_admin_1_states_provinces.geojson');
  it.skipIf(!fs.existsSync(admin1File))('rebuilding from the real admin-1 file reproduces the committed pack byte for byte', () => {
    const features = (JSON.parse(fs.readFileSync(admin1File, 'utf8')) as { features: Admin1Feature[] }).features;
    const built = buildFederations(sim.country, sim.land, meta.countries, features).federations as Federations;
    expect(hex8(fnv1a32(packFederations(built)))).toBe(hex8(fnv1a32(payload)));
  });
});
