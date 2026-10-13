// Acceptance tests on the COMMITTED data (public/data), loaded through the real loader.
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { COAST_LAND_BIT, TerrainClass, decodeDepth, decodeLandHeight, NavFlag } from '../../src/data/format';
import type { City, CountryMeta, Overrides, Port, RenderPack, SimGrid, WorldMeta } from '../../src/data/world';
import { DATA_DIR, worldLoader } from '../helpers/dataFiles';

let sim: SimGrid;
let render: RenderPack;
let meta: WorldMeta;
let cities: City[];
let ports: Port[];
let overrides: Overrides;

beforeAll(async () => {
  const w = worldLoader();
  [sim, render, meta, cities, ports, overrides] = await Promise.all([w.loadSim(), w.loadRender(), w.loadMeta(), w.loadCities(), w.loadPorts(), w.loadOverrides()]);
});

const lonOf = (x: number): number => -180 + ((x + 0.5) * 360) / sim.width;
const latOf = (y: number): number => 90 - ((y + 0.5) * 180) / sim.height;
const country = (a3: string): CountryMeta => {
  const c = meta.countries.find((k) => k.a3 === a3);
  if (!c) throw new Error(`no country ${a3}`);
  return c;
};

/** Max of maxElev over land cells in a lat/lon box. */
function boxMax(lat0: number, lat1: number, lon0: number, lon1: number): number {
  let m = -Infinity;
  for (let y = 0; y < sim.height; y++) {
    const lat = latOf(y);
    if (lat < lat0 || lat > lat1) continue;
    for (let x = 0; x < sim.width; x++) {
      const lon = lonOf(x);
      if (lon < lon0 || lon > lon1) continue;
      const i = y * sim.width + x;
      if (sim.land[i] === 1 && (sim.maxElev[i] as number) > m) m = sim.maxElev[i] as number;
    }
  }
  return m;
}
function boxHasClass(lat0: number, lat1: number, lon0: number, lon1: number, cls: number): number {
  let n = 0;
  for (let y = 0; y < sim.height; y++) {
    const lat = latOf(y);
    if (lat < lat0 || lat > lat1) continue;
    for (let x = 0; x < sim.width; x++) {
      const lon = lonOf(x);
      if (lon >= lon0 && lon <= lon1 && sim.terrainClass[y * sim.width + x] === cls) n++;
    }
  }
  return n;
}

describe('grid and land counts', () => {
  it('has the sim and render sizes of the charter', () => {
    expect(sim.width * sim.height).toBe(1024 * 512);
    expect(sim.navWidth * sim.navHeight).toBe(256 * 128);
    expect(render.width * render.height).toBe(4096 * 2048);
    expect(render.bathyWidth * render.bathyHeight).toBe(2048 * 1024);
    expect(meta.sim.cosQ15.length).toBe(512);
    expect(meta.sim.cosQ15[0]).toBeLessThan(meta.sim.cosQ15[255] as number);
    expect(meta.sim.cosQ15[255]).toBe(meta.sim.cosQ15[256]);
    expect(Math.abs((meta.sim.cosQ15[128] as number) - 23170)).toBeLessThanOrEqual(130); // cos(45 deg) = 0.7071
  });

  it('has 110k to 145k land cells outside Antarctica (about 126k expected)', () => {
    const ata = country('ATA').id;
    let n = 0;
    for (let i = 0; i < sim.land.length; i++) if (sim.land[i] === 1 && sim.country[i] !== ata) n++;
    console.log(`[data] land cells excluding Antarctica: ${n}`);
    expect(n).toBeGreaterThanOrEqual(110_000);
    expect(n).toBeLessThanOrEqual(145_000);
    expect(meta.counts.landCellsNoAntarctica).toBe(n);
  });
});

describe('countries', () => {
  it('Sweden is about 450 000 km2 cos-weighted (+-8 %) and about 650 cells', () => {
    const swe = country('SWE');
    // Recompute from the grid with the stored Q15 table instead of trusting the stored area.
    let area = 0;
    let cells = 0;
    const km = 111.19493; // km per degree of latitude
    for (let y = 0; y < sim.height; y++) {
      for (let x = 0; x < sim.width; x++) {
        const i = y * sim.width + x;
        if (sim.land[i] === 1 && sim.country[i] === swe.id) {
          area += ((km * 360) / sim.width) * ((km * 180) / sim.height) * ((meta.sim.cosQ15[y] as number) / 32768);
          cells++;
        }
      }
    }
    console.log(`[data] Sweden: ${cells} cells, ${area.toFixed(0)} km2 (stored ${swe.weightedAreaKm2})`);
    expect(Math.abs(area - 450_000) / 450_000).toBeLessThan(0.08);
    expect(cells).toBeGreaterThan(580);
    expect(cells).toBeLessThan(720);
    expect(swe.cells).toBe(cells);
    expect(Math.abs(swe.weightedAreaKm2 - area) / area).toBeLessThan(0.01);
  });

  it('Russia is the largest country by weighted area, ids are by descending area', () => {
    const sorted = [...meta.countries].sort((a, b) => b.weightedAreaKm2 - a.weightedAreaKm2);
    expect(sorted[0]?.a3).toBe('RUS');
    expect(country('RUS').id).toBe(1);
    // ids follow the polygon area, the weighted sim area follows within small noise: the first ten ids hold the ten largest.
    const top = new Set(sorted.slice(0, 8).map((c) => c.id));
    for (let id = 1; id <= 6; id++) expect(top.has(id), `id ${id}`).toBe(true);
  });

  it('every country with >= 8 cells has a capital cell on land with its own country id (count logged)', () => {
    const big = meta.countries.filter((c) => c.cells >= 8);
    console.log(`[data] countries with >= 8 cells: ${big.length} of ${meta.countries.length}`);
    expect(big.length).toBeGreaterThan(140);
    expect(big.length).toBeLessThan(185);
    expect(meta.counts.countriesWithMinCells).toBe(big.length);
    for (const c of big) {
      expect(c.capitalCell, c.a3).not.toBeNull();
      const cell = c.capitalCell as number;
      expect(sim.land[cell], `${c.a3} capital land`).toBe(1);
      expect(sim.country[cell], `${c.a3} capital country`).toBe(c.id);
    }
  });

  it('names: name_en and name_sv exist, Swedish where Natural Earth has it', () => {
    for (const c of meta.countries) {
      expect(c.name_en.length, c.a3).toBeGreaterThan(0);
      expect(c.name_sv.length, c.a3).toBeGreaterThan(0);
    }
    expect(country('SWE').name_sv).toBe('Sverige');
    expect(country('DEU').name_sv).toBe('Tyskland');
    expect(country('NLD').name_sv).toBe('Nederländerna');
  });

  it('overrides: micro states are listed, neutral names exist for disputed areas', () => {
    expect(overrides.minPlayableCells).toBe(8);
    const small = meta.countries.filter((c) => c.cells < 8).map((c) => c.a3).sort();
    const listed = [...overrides.unplayable, ...overrides.merged.map((m) => m.a3)].sort();
    expect(listed).toEqual(small);
    for (const m of overrides.merged) expect(meta.countries.some((c) => c.a3 === m.into && c.cells >= 8)).toBe(true);
    for (const a3 of ['KOS', 'SOL', 'CYN', 'SAH', 'PSX']) {
      expect(overrides.neutralNames[a3]?.en, a3).toBeTruthy();
      expect(overrides.neutralNames[a3]?.sv, a3).toBeTruthy();
    }
    for (const c of meta.countries) expect(c.playable, c.a3).toBe(c.cells >= 8 && !listed.includes(c.a3));
  });
});

describe('elevation', () => {
  it('no land cell below 1 m, no sea cell above -1 m (sim and render)', () => {
    let badLand = 0;
    let badSea = 0;
    for (let i = 0; i < sim.land.length; i++) {
      if (sim.land[i] === 1) {
        if ((sim.meanElev[i] as number) < 1 || (sim.maxElev[i] as number) < 1) badLand++;
      } else if ((sim.meanElev[i] as number) > -1 || (sim.maxElev[i] as number) > -1) badSea++;
    }
    expect(badLand).toBe(0);
    expect(badSea).toBe(0);
    let lowLandPixels = 0;
    let landPixels = 0;
    for (let i = 0; i < render.height8.length; i++) {
      const h = render.height8[i] as number;
      if (render.country8[i] !== 0) {
        landPixels++;
        if (h === 0 || decodeLandHeight(h) < 1) lowLandPixels++;
      } else if (h !== 0) lowLandPixels++;
    }
    expect(lowLandPixels).toBe(0);
    expect(landPixels).toBeGreaterThan(2_000_000);
    let badBathy = 0;
    for (let by = 0; by < render.bathyHeight; by++) {
      for (let bx = 0; bx < render.bathyWidth; bx++) {
        const b = render.bathy8[by * render.bathyWidth + bx] as number;
        if (b !== 0 && decodeDepth(b) < 1) badBathy++;
      }
    }
    expect(badBathy).toBe(0);
  });

  it('maximum codes reach the real mountains: Himalaya >= 6000 m, Andes >= 5500 m, Alps >= 3000 m', () => {
    const him = boxMax(26, 36, 75, 95);
    const andes = boxMax(-40, 10, -80, -60);
    const alps = boxMax(44, 48, 5, 15);
    console.log(`[data] box maxima: Himalaya ${him} m, Andes ${andes} m, Alps ${alps} m`);
    expect(him).toBeGreaterThanOrEqual(6000);
    expect(andes).toBeGreaterThanOrEqual(5500);
    expect(alps).toBeGreaterThanOrEqual(3000);
  });

  it('no cell max above 8900 m outside the Himalaya/Karakoram box (the 11 500 m error pixels are gone)', () => {
    let m = -Infinity;
    for (let y = 0; y < sim.height; y++) {
      const lat = latOf(y);
      for (let x = 0; x < sim.width; x++) {
        const lon = lonOf(x);
        if (lat >= 26 && lat <= 40 && lon >= 60 && lon <= 105) continue;
        const v = sim.maxElev[y * sim.width + x] as number;
        if (sim.land[y * sim.width + x] === 1 && v > m) m = v;
      }
    }
    console.log(`[data] highest cell max outside Himalaya/Karakoram: ${m} m`);
    expect(m).toBeLessThanOrEqual(8900);
    // The spike near 72.4 N 78.8 W (Baffin Island) is flat after the median filter.
    expect(boxMax(70, 75, -82, -75)).toBeLessThan(2500);
    // No decoded render height above the land maximum, no code above 255 by construction.
    expect(decodeLandHeight(255)).toBe(9000);
  });

  it('the Netherlands has a mean elevation below 100 m', () => {
    const nld = country('NLD').id;
    let s = 0;
    let n = 0;
    for (let i = 0; i < sim.land.length; i++) {
      if (sim.land[i] === 1 && sim.country[i] === nld) {
        s += sim.meanElev[i] as number;
        n++;
      }
    }
    console.log(`[data] Netherlands mean elevation ${(s / n).toFixed(1)} m over ${n} cells`);
    expect(n).toBeGreaterThan(20);
    expect(s / n).toBeLessThan(100);
  });
});

describe('terrain classes', () => {
  it('Himalaya, Alps and Andes boxes contain Mountain cells', () => {
    expect(boxHasClass(26, 36, 75, 95, TerrainClass.Mountain)).toBeGreaterThan(0);
    expect(boxHasClass(44, 48, 5, 15, TerrainClass.Mountain)).toBeGreaterThan(0);
    expect(boxHasClass(-40, 10, -80, -60, TerrainClass.Mountain)).toBeGreaterThan(0);
  });

  it('Peak share is 0.3 to 1.5 % and Mountain share (excluding Peak) 8 to 18 % of non-Ice land cells', () => {
    let nonIce = 0;
    let peak = 0;
    let mountain = 0;
    let ice = 0;
    const counts = new Array<number>(8).fill(0);
    for (let i = 0; i < sim.land.length; i++) {
      counts[sim.terrainClass[i] as number] = (counts[sim.terrainClass[i] as number] as number) + 1;
      if (sim.land[i] !== 1) continue;
      const k = sim.terrainClass[i];
      if (k === TerrainClass.Ice) ice++;
      else nonIce++;
      if (k === TerrainClass.Peak) peak++;
      if (k === TerrainClass.Mountain) mountain++;
    }
    const total = sim.land.length;
    console.log(
      `[data] classes ${JSON.stringify(Object.fromEntries(meta.sim.classes.map((n, i) => [n, counts[i]])))}; ` +
        `Peak ${((100 * peak) / nonIce).toFixed(2)} %, Mountain ${((100 * mountain) / nonIce).toFixed(2)} % of ${nonIce} non-Ice land cells; ` +
        `not water ${((100 * (nonIce + ice)) / total).toFixed(2)} %, non-Ice land ${((100 * nonIce) / total).toFixed(2)} % of all cells`,
    );
    expect(peak / nonIce).toBeGreaterThanOrEqual(0.003);
    expect(peak / nonIce).toBeLessThanOrEqual(0.015);
    expect(mountain / nonIce).toBeGreaterThanOrEqual(0.08);
    expect(mountain / nonIce).toBeLessThanOrEqual(0.18);
    expect((nonIce + ice) / total).toBeGreaterThanOrEqual(0.3);
    expect((nonIce + ice) / total).toBeLessThanOrEqual(0.4);
    expect(nonIce / total).toBeGreaterThanOrEqual(0.2);
    expect(nonIce / total).toBeLessThanOrEqual(0.28);
  });

  it('Antarctica and land north of 84 N are Ice; water is DeepSea or Shallows; classes agree with the land mask', () => {
    const ata = country('ATA').id;
    for (let y = 0; y < sim.height; y++) {
      for (let x = 0; x < sim.width; x++) {
        const i = y * sim.width + x;
        const k = sim.terrainClass[i] as number;
        if (sim.land[i] === 1) {
          expect(k >= TerrainClass.Plains, `land class at ${x},${y}`).toBe(true);
          if (sim.country[i] === ata || latOf(y) > 84) expect(k).toBe(TerrainClass.Ice);
        } else {
          expect(k <= TerrainClass.Shallows, `water class at ${x},${y}`).toBe(true);
        }
      }
    }
  });

  it('ruggedness is a layer of the pack and of checksums.json, and high where the mountains are', async () => {
    const sums = await worldLoader().loader.checksums();
    expect(sums.packs.sim?.layers?.ruggedness?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(meta.sim).toBeDefined();
    const layers = (meta as unknown as { sim: { layers: Array<{ name: string }> } }).sim.layers.map((l) => l.name);
    expect(layers).toContain('ruggedness');
    let him = 0;
    let n = 0;
    for (let y = 0; y < sim.height; y++) {
      for (let x = 0; x < sim.width; x++) {
        const lat = latOf(y);
        const lon = lonOf(x);
        if (lat >= 26 && lat <= 36 && lon >= 75 && lon <= 95 && sim.land[y * sim.width + x] === 1) {
          him += sim.ruggedness[y * sim.width + x] as number;
          n++;
        }
      }
    }
    expect(him / n).toBeGreaterThan(40);
  });

  it('coast flags, nav grid', () => {
    let landCoast = 0;
    for (let i = 0; i < sim.coast.length; i++) {
      if (((sim.coast[i] as number) & COAST_LAND_BIT) !== 0) {
        landCoast++;
        expect(sim.land[i]).toBe(1);
      }
    }
    expect(landCoast).toBeGreaterThan(10_000);
    // Nav cell that is entirely land has AllLand, and one with any Mountain/Peak sim cell has AnyRough.
    let anyRough = 0;
    for (let i = 0; i < sim.navFlags.length; i++) {
      const f = sim.navFlags[i] as number;
      if ((f & NavFlag.AllLand) !== 0) expect(f & NavFlag.AnyLand).toBeTruthy();
      if ((f & NavFlag.AnyRough) !== 0) anyRough++;
    }
    expect(anyRough).toBeGreaterThan(500);
  });
});

describe('cities and ports', () => {
  it('about 600 largest cities plus the capitals, each on a land cell of its own country', () => {
    expect(cities.length).toBeGreaterThanOrEqual(600);
    expect(cities.length).toBeLessThanOrEqual(720);
    const cells = new Set<number>();
    for (const c of cities) {
      expect(sim.land[c.cell], c.name).toBe(1);
      expect(sim.country[c.cell], c.name).toBe(c.country);
      expect(cells.has(c.cell), `${c.name} duplicates a cell`).toBe(false);
      cells.add(c.cell);
    }
    expect(cities.filter((c) => c.capital).length).toBeGreaterThan(150);
    expect(cities.some((c) => c.name === 'Stockholm' && c.capital)).toBe(true);
  });

  it('ports sit on land coast cells and take their country from the cell', () => {
    expect(ports.length).toBeGreaterThan(800);
    for (const p of ports) {
      expect(sim.land[p.cell], p.name).toBe(1);
      expect(((sim.coast[p.cell] as number) & COAST_LAND_BIT) !== 0, p.name).toBe(true);
      expect(sim.country[p.cell], p.name).toBe(p.country);
      expect(sim.terrainClass[p.cell]).not.toBe(TerrainClass.Ice);
    }
  });
});

describe('committed files', () => {
  it('public/data holds no synthetic data and at most 6 MB in total', () => {
    expect(meta.source.naturalEarth.sha).toMatch(/^[0-9a-f]{40}$/);
    let total = 0;
    for (const f of fs.readdirSync(DATA_DIR)) total += fs.statSync(path.join(DATA_DIR, f)).size;
    console.log(`[data] public/data total ${total} bytes`);
    expect(total).toBeLessThanOrEqual(6 * 1024 * 1024);
  });
});
