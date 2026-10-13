import { beforeAll, describe, expect, it } from 'vitest';
import { CLASS_LABEL_SV, countryNameMap, formatMetres, tooltipText } from '../src/app/tooltip';
import { SIM_HEIGHT, SIM_WIDTH, TERRAIN_CLASS_NAMES, TerrainClass, type RenderPack, type SimGrid, type WorldMeta } from '../src/data';
import {
  NEAREST_CELL_RADIUS,
  SHALLOWS_MAX_DEPTH_M,
  describeAt,
  landClassForHeight,
  nearestSimCell,
  sampleLand,
  waterClassForDepth,
  type GlobePick,
} from '../src/render/describe';
import { HEIGHT_EXAGGERATION } from '../src/render/config';
import { latLonToCell } from '../src/render/geo';
import { HeightField } from '../src/render/heightField';
import * as bake from '../tools/bake/classify';
import { worldLoader } from './helpers/dataFiles';

describe('hover tooltip text', () => {
  it('formats metres with a thin plain space as thousands separator and a minus sign', () => {
    expect(formatMetres(0)).toBe('0 m');
    expect(formatMetres(8848.4)).toBe('8 848 m');
    expect(formatMetres(-3520.2)).toBe('-3 520 m');
    expect(formatMetres(123)).toBe('123 m');
    expect(formatMetres(1000000)).toBe('1 000 000 m');
  });

  it('has a label for every terrain class', () => {
    expect(CLASS_LABEL_SV.length).toBe(TERRAIN_CLASS_NAMES.length);
  });

  it('names land by country, class and height, and the sea without a country', async () => {
    const meta = await worldLoader().loadMeta();
    const names = countryNameMap(meta);
    const swe = meta.countries.find((c) => c.a3 === 'SWE');
    expect(swe).toBeDefined();
    expect(tooltipText({ classId: 3, countryId: swe?.id as number, elevationM: 123.4 }, names)).toBe('Sverige · Skog · 123 m');
    expect(tooltipText({ classId: 0, countryId: 0, elevationM: -3520 }, names)).toBe('Hav · Djuphav · -3 520 m');
    expect(tooltipText({ classId: 2, countryId: 0, elevationM: 5 }, names)).toBe('Okänt land · Slätt · 5 m');
  });
});

// At a coast the render raster (4096 x 2048) and the sim grid (1024 x 512) disagree: the audit found "Hav · Grunt hav · 27 m"
// (Sydney), "... 3 m" (New York) and "... 0 m" (Rio). Land or sea is now decided by the render raster (a position is land
// exactly when the filtered surface height is above 0), so a tooltip never says Hav with a positive height, and land in a sim
// water cell takes its country from the render id raster and its class from the nearest sim land cell.
describe('hover tooltip on real coasts (render raster against sim grid)', () => {
  let render: RenderPack;
  let sim: SimGrid;
  let meta: WorldMeta;
  let names: Map<number, string>;
  let field: HeightField;

  beforeAll(async () => {
    const w = worldLoader();
    [render, sim, meta] = await Promise.all([w.loadRender(), w.loadSim(), w.loadMeta()]);
    names = countryNameMap(meta);
    field = new HeightField({ height8: render.height8, width: render.width, height: render.height, maxM: meta.encoding.heightSqrt.maxM, exaggeration: HEIGHT_EXAGGERATION });
  });

  const pickAt = (lat: number, lon: number): GlobePick => describeAt({ render, sim }, lat, lon, field.heightM(lat, lon));
  const textAt = (lat: number, lon: number): string => tooltipText(pickAt(lat, lon), names);
  const simClassAt = (lat: number, lon: number): number => sim.terrainClass[pickAt(lat, lon).cell.index] as number;

  // Land in the render raster inside a sim water cell, one point for each of the three audit cities.
  const coastalLand: Array<[string, number, number, string]> = [
    ['Sydney', -33.87, 151.2, 'Australien · Slätt · 29 m'],
    ['New York (Hudson shore)', 40.75, -74.02, 'USA · Skog · 15 m'],
    ['Rio de Janeiro (Guanabara east shore)', -22.9, -43.05, 'Brasilien · Kullar · 94 m'],
  ];
  for (const [name, lat, lon, want] of coastalLand) {
    it(`${name}: the sim cell is water, the render raster land: country and land class, a positive height, no Hav`, () => {
      expect(simClassAt(lat, lon)).toBeLessThanOrEqual(TerrainClass.Shallows); // the premise: the sim cell says sea
      expect(sampleLand(render, lat, lon).mask).toBeGreaterThan(0); // the render raster says land
      expect(field.heightM(lat, lon)).toBeGreaterThan(0); // and so does the surface height
      const pick = pickAt(lat, lon);
      expect(pick.elevationM).toBeGreaterThan(0);
      expect(pick.classId).toBeGreaterThanOrEqual(TerrainClass.Plains);
      expect(pick.countryId).toBeGreaterThan(0);
      const text = tooltipText(pick, names);
      expect(text).toBe(want);
      expect(text.startsWith('Hav')).toBe(false);
    });
  }

  it('the city points themselves (cities.json) sit in the coast band: the sim cell is water, the surface height is above 0, so the tooltip says land, never "Hav · Grunt hav · N m"', async () => {
    const cities = await worldLoader().loadCities();
    const want: Record<string, string> = { 'New York': 'USA · Skog · 15 m', 'Rio de Janeiro': 'Brasilien · Slätt · 166 m', Stockholm: 'Sverige · Slätt · 37 m' };
    for (const [name, text] of Object.entries(want)) {
      const c = cities.find((x) => x.name === name);
      if (!c) throw new Error(`no ${name} in cities.json`);
      expect(field.heightM(c.lat, c.lon), name).toBeGreaterThan(0);
      const pick = pickAt(c.lat, c.lon);
      expect(pick.elevationM, name).toBeGreaterThan(0);
      expect(tooltipText(pick, names), name).toBe(text);
    }
    // the two with a sim water cell under them are the case of the audit
    for (const name of ['New York', 'Rio de Janeiro']) {
      const c = cities.find((x) => x.name === name);
      if (!c) throw new Error(`no ${name} in cities.json`);
      expect(simClassAt(c.lat, c.lon), name).toBeLessThanOrEqual(TerrainClass.Shallows);
    }
  });

  it('open ocean: Hav, a water class and the depth below 0', () => {
    expect(textAt(0, -150)).toBe('Hav · Djuphav · -3 908 m');
    const pick = pickAt(0, -150);
    expect(pick.countryId).toBe(0);
    expect(pick.classId).toBe(TerrainClass.DeepSea);
  });

  it('clear inland points keep the sim cell: country and class from the sim, the height from the render raster', () => {
    expect(textAt(48, 12)).toBe('Tyskland · Kullar · 508 m');
    const inland = pickAt(48, 12);
    expect(inland.classId).toBe(sim.terrainClass[inland.cell.index]);
    expect(inland.countryId).toBe(sim.country[inland.cell.index]);
    expect(textAt(59.9, 15)).toMatch(/^Sverige · /);
    const everest = pickAt(27.99, 86.93);
    expect(everest.classId).toBe(TerrainClass.Peak);
    expect(everest.elevationM).toBeGreaterThan(5500);
  });

  it('a sim land cell under a render sea pixel is Hav with a water class (the other direction of the same disagreement)', () => {
    // A render sea pixel whose sim cell is land: scan the coast of Norway for one (deterministic, first hit).
    let found: [number, number] | null = null;
    for (let lat = 58; lat < 71 && !found; lat += 0.05) {
      for (let lon = 4; lon < 14 && !found; lon += 0.05) {
        if (sampleLand(render, lat, lon).mask === 0 && simClassAt(lat, lon) >= TerrainClass.Plains) found = [lat, lon];
      }
    }
    expect(found, 'a sea pixel in a land cell near Norway').not.toBeNull();
    const [lat, lon] = found as [number, number];
    const pick = pickAt(lat, lon);
    expect(pick.countryId).toBe(0);
    expect(pick.classId).toBeLessThanOrEqual(TerrainClass.Shallows);
    expect(textAt(lat, lon).startsWith('Hav · ')).toBe(true);
    expect(pick.elevationM).toBeLessThanOrEqual(0);
  });

  it('everywhere: Hav exactly when the height is at or below 0, a land class and a known country exactly when it is above 0', () => {
    let land = 0;
    let sea = 0;
    // Every second render pixel in both directions, at a sub-pixel offset (about 2.1 M positions, coasts included).
    for (let y = 0; y < render.height; y += 2) {
      const lat = 90 - (y + 0.37) / render.height * 180;
      for (let x = 0; x < render.width; x += 2) {
        const lon = ((x + 0.61) / render.width) * 360 - 180;
        const pick = describeAt({ render, sim }, lat, lon, 0);
        const isLand = pick.elevationM > 0;
        if (isLand) {
          land++;
          if (pick.classId < TerrainClass.Plains || !names.has(pick.countryId)) throw new Error(`land without land class or country at ${lat}, ${lon}: ${JSON.stringify(pick)}`);
        } else {
          sea++;
          if (pick.classId > TerrainClass.Shallows || pick.countryId !== 0) throw new Error(`sea with a land class or country at ${lat}, ${lon}: ${JSON.stringify(pick)}`);
        }
        const text = tooltipText(pick, names);
        if (text.startsWith('Hav ') !== !isLand) throw new Error(`"${text}" contradicts the height at ${lat}, ${lon}`);
      }
    }
    expect(land).toBeGreaterThan(300_000);
    expect(sea).toBeGreaterThan(700_000);
  });

  it('land exactly when the filtered surface height is above 0 (300 000 random positions, coasts and open land)', () => {
    let seed = 20240611;
    const rnd = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    let landPicks = 0;
    for (let i = 0; i < 300_000; i++) {
      const lat = 90 - rnd() * 180;
      const lon = rnd() * 360 - 180;
      const h = field.heightM(lat, lon);
      const pick = describeAt({ render, sim }, lat, lon, h);
      if (h > 0 !== pick.elevationM > 0) throw new Error(`height ${h} but elevation ${pick.elevationM} at ${lat}, ${lon}`);
      if (h > 0) landPicks++;
    }
    expect(landPicks).toBeGreaterThan(50_000);
  });

  it('tooltipText alone never prints Hav with a positive height, whatever class it is handed', () => {
    const swe = meta.countries.find((c) => c.a3 === 'SWE')?.id as number;
    expect(tooltipText({ classId: 1, countryId: swe, elevationM: 27 }, names)).toBe('Sverige · Slätt · 27 m');
    expect(tooltipText({ classId: 0, countryId: swe, elevationM: 1500 }, names)).toBe('Sverige · Berg · 1 500 m');
    expect(tooltipText({ classId: 3, countryId: swe, elevationM: -5 }, names)).toBe('Hav · Grunt hav · -5 m');
    expect(tooltipText({ classId: 2, countryId: swe, elevationM: -900 }, names)).toBe('Hav · Djuphav · -900 m');
    for (const classId of [0, 1, 2, 3, 4, 5, 6, 7]) {
      for (const elevationM of [-4000, -200, -1, 0, 1, 30, 900, 6000]) {
        const text = tooltipText({ classId, countryId: swe, elevationM }, names);
        expect(text.startsWith('Hav'), `${classId} ${elevationM}`).toBe(elevationM <= 0);
      }
    }
  });
});

describe('describe.ts helpers', () => {
  it('the height and depth class thresholds are the ones of the bake', () => {
    expect(SHALLOWS_MAX_DEPTH_M).toBe(bake.SHALLOWS_MAX_DEPTH_M);
    expect(landClassForHeight(bake.PEAK_MIN_MAX_M)).toBe(TerrainClass.Peak);
    expect(landClassForHeight(bake.PEAK_MIN_MAX_M - 1)).toBe(TerrainClass.Mountain);
    expect(landClassForHeight(bake.MOUNTAIN_MIN_MAX_M)).toBe(TerrainClass.Mountain);
    expect(landClassForHeight(bake.MOUNTAIN_MIN_MAX_M - 1)).toBe(TerrainClass.Hills);
    expect(landClassForHeight(bake.HILLS_MIN_MAX_M)).toBe(TerrainClass.Hills);
    expect(landClassForHeight(bake.HILLS_MIN_MAX_M - 1)).toBe(TerrainClass.Plains);
    expect(waterClassForDepth(bake.SHALLOWS_MAX_DEPTH_M)).toBe(TerrainClass.Shallows);
    expect(waterClassForDepth(bake.SHALLOWS_MAX_DEPTH_M + 1)).toBe(TerrainClass.DeepSea);
  });

  // A tiny render raster (8 x 4 pixels) over an empty sim grid of the real size (all deep sea, no country).
  const tiny = (): { render: RenderPack; sim: SimGrid } => {
    const render = {
      width: 8,
      height: 4,
      bathyWidth: 4,
      bathyHeight: 2,
      height8: new Uint8Array(32),
      bathy8: new Uint8Array(8).fill(100),
      country8: new Uint8Array(32),
    } as unknown as RenderPack;
    const sim = { width: SIM_WIDTH, height: SIM_HEIGHT, terrainClass: new Uint8Array(SIM_WIDTH * SIM_HEIGHT), country: new Uint8Array(SIM_WIDTH * SIM_HEIGHT) } as unknown as SimGrid;
    return { render, sim };
  };

  it('with no sim land cell near, land in a water cell gets its class from the height and its country from the render raster', () => {
    const { render, sim } = tiny();
    // render pixels (2..3, 1..2) cover lon -90..-45, lat 0..45 around the point (0, -67.5): a block of land with country 9
    for (const [x, y] of [[2, 1], [3, 1], [2, 2], [3, 2]] as const) {
      render.height8[y * 8 + x] = 76; // 9000 * (76/255)^2 = 800 m
      render.country8[y * 8 + x] = 9;
    }
    expect(nearestSimCell(sim, 0, -67.5, true)).toBeNull();
    const pick = describeAt({ render, sim }, 0, -67.5, 800);
    expect(pick.elevationM).toBeGreaterThan(700);
    expect(pick.classId).toBe(TerrainClass.Hills);
    expect(pick.countryId).toBe(9);
    // a land sim cell within the radius supplies the class instead (the country still comes from the render raster)
    const c = latLonToCell(0, -67.5);
    sim.terrainClass[c.index + 2] = TerrainClass.Forest;
    sim.country[c.index + 2] = 3;
    const near = describeAt({ render, sim }, 0, -67.5, 800);
    expect(near.classId).toBe(TerrainClass.Forest);
    expect(near.countryId).toBe(9);
  });

  it('nearestSimCell picks the nearest cell of the wanted kind within the radius, wraps the date line, and finds nothing beyond the radius', () => {
    const { sim } = tiny();
    expect(NEAREST_CELL_RADIUS).toBeGreaterThanOrEqual(2);
    const c = latLonToCell(10, 10);
    const east = c.index + 1;
    sim.terrainClass[east] = TerrainClass.Hills;
    sim.country[east] = 5;
    expect(nearestSimCell(sim, 10, 10, true, 1)).toEqual({ classId: TerrainClass.Hills, countryId: 5 });
    expect(nearestSimCell(sim, 10, 10, true, 0)).toBeNull();
    expect(nearestSimCell(sim, 10, 10, false, 0)).toEqual({ classId: TerrainClass.DeepSea, countryId: 0 });
    // the date line: a land cell in column 0 is the east neighbour of a position in the last column
    const edge = latLonToCell(10, 179.9);
    expect(edge.x).toBe(SIM_WIDTH - 1);
    sim.terrainClass[edge.y * SIM_WIDTH] = TerrainClass.Mountain;
    expect(nearestSimCell(sim, 10, 179.9, true, 1)?.classId).toBe(TerrainClass.Mountain);
    // the nearer of two land cells wins
    sim.terrainClass[c.index - 2] = TerrainClass.Plains;
    sim.country[c.index - 2] = 6;
    expect(nearestSimCell(sim, 10, 10, true, 2)?.countryId).toBe(5);
  });
});
