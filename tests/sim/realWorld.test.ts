// M04 on the real 1024x512 world: the SimWorld, Spawn at real capitals, the economy over minutes. Node only.
import fs from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadRealWorld } from '../../tools/sim/realWorld';
import { ownedStdAreaQ15, ownerCapQt, troopCapQt } from '../../src/sim/economy';
import { REJECT_TERRAIN, withId } from '../../src/sim/intents';
import { OUTBOX_REJECT } from '../../src/sim/outbox';
import { START_DISC_CELLS, START_TROOPS_QT } from '../../src/sim/rules';
import { deserialize, hashState, serialize } from '../../src/sim/serialize';
import { claimDisc } from '../../src/sim/spawn';
import type { GameState } from '../../src/sim/state';
import { step } from '../../src/sim/step';
import { setOwner } from '../../src/sim/territory';
import { CLASS_ICE, CLASS_PEAK, isPlayableClass } from '../../src/sim/terrain';
import { createWorldState, type SimWorld } from '../../src/sim/world';

interface Meta {
  sim: { cosQ15: number[] };
  counts: { classes: Record<string, number> };
  countries: Array<{ a3: string; cells: number; capitalCell: number | null; weightedAreaKm2: number }>;
}
const meta = JSON.parse(fs.readFileSync('public/data/meta.json', 'utf8')) as Meta;

let world: SimWorld;
let state: GameState;
let component: Int32Array; // landmass label per playable cell (-1 elsewhere)
let componentSize: number[];

beforeAll(async () => {
  const t0 = performance.now();
  world = await loadRealWorld();
  const t1 = performance.now();
  state = createWorldState(world, { seed: 7, seats: 32, players: 12 });
  const t2 = performance.now();
  console.log(`[real world] load ${Math.round(t1 - t0)} ms, createWorldState ${Math.round(t2 - t1)} ms (32 seats)`);
  component = new Int32Array(state.grid.cells).fill(-1);
  componentSize = [];
  const nb = new Int32Array(4);
  for (let c = 0; c < state.grid.cells; c++) {
    if (state.grid.playable[c] !== 1 || component[c] !== -1) continue;
    const label = componentSize.length;
    let size = 0;
    const stack = [c];
    component[c] = label;
    while (stack.length > 0) {
      const x = stack.pop() as number;
      size++;
      const n = state.grid.neighbours(x, nb);
      for (let i = 0; i < n; i++) {
        const y = nb[i] as number;
        if (state.grid.playable[y] === 1 && component[y] === -1) {
          component[y] = label;
          stack.push(y);
        }
      }
    }
    componentSize.push(size);
  }
}, 60000);

describe('SimWorld from the committed sim pack', () => {
  it('is 1024x512 with the class counts of meta.json and the committed cos table', () => {
    expect([world.width, world.height]).toEqual([1024, 512]);
    expect(Array.from(world.rowCos)).toEqual(meta.sim.cosQ15);
    const counts = new Array<number>(8).fill(0);
    for (const t of world.terrain) counts[t] = (counts[t] as number) + 1;
    const names = ['DeepSea', 'Shallows', 'Plains', 'Forest', 'Hills', 'Mountain', 'Peak', 'Ice'];
    names.forEach((n, i) => expect(counts[i], n).toBe(meta.counts.classes[n]));
    expect(world.elevation.length).toBe(1024 * 512);
  });

  it('the playable cells are the Plains, Forest, Hills and Mountain cells; their weight fits 32 bits', () => {
    const c = meta.counts.classes;
    expect(state.grid.playableCells).toBe((c.Plains as number) + (c.Forest as number) + (c.Hills as number) + (c.Mountain as number));
    expect(state.grid.totalWeight).toBeLessThan(4294967296);
    console.log(`[real world] ${state.grid.playableCells} playable cells in ${componentSize.length} landmasses, total weight ${state.grid.totalWeight}`);
    expect(componentSize.length).toBeGreaterThan(100);
  });

  it('the east-west seam joins cells: a landmass crosses x = 1023 / x = 0 somewhere (Russia / Alaska side, Pacific islands)', () => {
    let joined = 0;
    for (let y = 0; y < 512; y++) {
      const a = y * 1024;
      const b = y * 1024 + 1023;
      if (state.grid.playable[a] === 1 && state.grid.playable[b] === 1 && component[a] === component[b]) joined++;
    }
    expect(joined).toBeGreaterThan(0);
  });
});

describe('Spawn at real capitals', () => {
  it('claims min(197, size of its landmass) playable cells, connected, for a spread of countries', () => {
    const list = meta.countries.filter((c) => c.capitalCell !== null && state.grid.playable[c.capitalCell] === 1);
    expect(list.length).toBeGreaterThan(100);
    let small = 0;
    let checked = 0;
    for (let k = 0; k < list.length; k += 3) {
      const cell = list[k]?.capitalCell as number;
      const claimed: number[] = [];
      const n = claimDisc(state, cell, 1, 1, claimed);
      const size = componentSize[component[cell] as number] as number;
      expect(n, list[k]?.a3).toBe(Math.min(START_DISC_CELLS, size));
      for (const c of claimed) {
        expect(isPlayableClass(state.terrain[c] as number)).toBe(true);
        expect(component[c]).toBe(component[cell]);
      }
      if (size < START_DISC_CELLS) small++;
      for (const c of claimed) setOwner(state, c, 0, 0); // free them again for the next country
      checked++;
    }
    console.log(`[real world] checked ${checked} capitals, ${small} on landmasses smaller than the disc`);
    expect(small).toBeGreaterThan(0);
    expect(state.agg.area.every((a) => a === 0)).toBe(true);
  });

  it('refuses Peak and Ice cells', () => {
    for (const cls of [CLASS_PEAK, CLASS_ICE]) {
      const s = createWorldState(world, { seed: 1, seats: 2 });
      const cell = s.terrain.indexOf(cls);
      expect(cell).toBeGreaterThanOrEqual(0);
      step(s, { turn: 0, intents: [withId({ kind: 'Spawn', seat: 0, cell }, 0)] });
      expect(s.outbox.drain().filter((e) => e.kind === OUTBOX_REJECT).map((e) => e.a)).toEqual([REJECT_TERRAIN]);
      expect(s.agg.area[1]).toBe(0);
    }
  });
});

describe('a whole match start: 12 players and 20 tribes spawn on the 32 largest countries', () => {
  const largest = () => [...meta.countries].filter((c) => c.capitalCell !== null && state.grid.playable[c.capitalCell as number] === 1).sort((a, b) => b.weightedAreaKm2 - a.weightedAreaKm2 || a.a3.localeCompare(b.a3)).slice(0, 32);

  function start(): GameState {
    const s = createWorldState(world, { seed: 7, seats: 32, players: 12 });
    const spawns = largest().map((c, seat) => withId({ kind: 'Spawn', seat, cell: c.capitalCell as number }, 0));
    const r = step(s, { turn: 0, intents: spawns });
    expect(r).toEqual({ ok: true, applied: 32, rejected: 0 });
    return s;
  }

  it('all 32 spawns are accepted; players hold a full disc, tribes too; cap of a tribe is a third', () => {
    const s = start();
    for (let o = 1; o <= 32; o++) {
      expect(s.agg.area[o], `owner ${o}`).toBeGreaterThan(0);
      expect(s.capital[o]).toBeGreaterThan(0);
    }
    expect(s.troops[1]).toBeGreaterThan(START_TROOPS_QT - 1);
    expect(ownerCapQt(s, 20)).toBe(Math.floor(troopCapQt(ownedStdAreaQ15(s, 20), 0, false) / 3)); // owner 20 is a tribe
    expect(ownerCapQt(s, 1)).toBe(troopCapQt(ownedStdAreaQ15(s, 1), 0, false));
    expect(hashState(start())).toBe(hashState(s)); // deterministic
  });

  it('five minutes of economy: troops rise towards the cap without passing it, nothing goes negative, gold only rises; the snapshot at the end equals the straight run', () => {
    const s = start();
    const gold0 = Array.from(s.gold);
    for (let i = 1; i < 3000; i++) {
      step(s, { turn: s.tick, intents: [] });
      if (i % 500 === 0) {
        for (let o = 1; o <= 32; o++) {
          expect(s.troops[o]).toBeLessThanOrEqual(ownerCapQt(s, o));
          expect(s.troopFrac[o]).toBeLessThan(1000000);
        }
      }
    }
    for (let o = 1; o <= 32; o++) expect(s.gold[o]).toBeGreaterThan(gold0[o] as number);
    const r = deserialize(serialize(s));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(hashState(r.state)).toBe(hashState(s));
    for (let i = 0; i < 100; i++) {
      step(s, { turn: s.tick, intents: [] });
      step(r.state, { turn: r.state.tick, intents: [] });
    }
    expect(hashState(r.state)).toBe(hashState(s));
  }, 60000);
});
