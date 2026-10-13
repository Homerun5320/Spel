// Cancelling an attack and launching it again must not make conquest cheaper or faster: the depth term of the price is a
// property of the map (the per-cell exposure record), not of one Attack object (D91).
import { describe, expect, it } from 'vitest';
import { applyAttack, applyCancelAttack } from '../../src/sim/conquest';
import { D_MAX_CELLS } from '../../src/sim/rules';
import { IdAllocator, withId, type Intent, type IntentBody } from '../../src/sim/intents';
import { deserialize, hashState, serialize } from '../../src/sim/serialize';
import type { GameState } from '../../src/sim/state';
import { step } from '../../src/sim/step';
import { setOwner } from '../../src/sim/territory';
import { CLASS_DEEP_SEA, CLASS_PLAINS } from '../../src/sim/terrain';
import { createWorldState } from '../../src/sim/world';
import { loadRealWorld } from '../../tools/sim/realWorld';
import { largestCountries, pickCountries } from '../../tools/sim/scenario';
import { landState } from './helpers/worlds';

const W = 120;

/** A 120 x 3 world with land only in the middle row (and not the last column, so that the world does not wrap into it): one front of length 1, owner 1 holds the west end and a huge pool of troops. */
function corridor(): GameState {
  const s = landState(W, 3, { seats: 2, classAt: (x, y) => (y === 1 && x < W - 1 ? CLASS_PLAINS : CLASS_DEEP_SEA) });
  setOwner(s, 1 * W, 1, 0);
  s.troops[1] = 4000000;
  return s;
}

/** Runs the corridor conquest until `cells` cells are taken; `relaunchEvery` > 0 cancels and relaunches the attack after every that many captures. Returns the QT paid and the ticks it took. */
function corridorRun(cells: number, relaunchEvery: number): { paid: number; ticks: number } {
  const s = corridor();
  expect(applyAttack(s, 0, 0, 100)).toBe(0);
  let a = s.attacks.find(1, 0);
  let pool = a?.troops ?? 0;
  let paid = 0;
  let sinceLaunch = 0;
  let ticks = 0;
  let area = s.agg.area[1] as number;
  while ((s.agg.area[1] as number) < 1 + cells && ticks < 20000) {
    step(s, { turn: s.tick, intents: [] });
    ticks++;
    const now = s.agg.area[1] as number;
    sinceLaunch += now - area;
    area = now;
    if (relaunchEvery > 0 && sinceLaunch >= relaunchEvery && now < 1 + cells) {
      a = s.attacks.find(1, 0);
      if (a === null || a === undefined) throw new Error('the attack ended');
      paid += pool - a.troops + (a.costFrac > 0 ? 1 : 0); // what it spent, and the QT that the cancel charges for the cell it still owed
      expect(applyCancelAttack(s, 0, 0)).toBe(0);
      expect(applyAttack(s, 0, 0, 100)).toBe(0);
      a = s.attacks.find(1, 0);
      pool = a?.troops ?? 0;
      sinceLaunch = 0;
    }
  }
  a = s.attacks.find(1, 0);
  if (a !== null && a !== undefined) paid += pool - a.troops;
  return { paid, ticks };
}

describe('cancel and relaunch cannot reset the depth term of the price (D91)', () => {
  it('the corridor: relaunching after every capture, every 5 or every 20 pays what one attack pays (no more than 12 % less, no more than 15 % more), and is not faster', () => {
    const single = corridorRun(80, 0);
    expect(single.paid).toBeGreaterThan(400); // the depth term is in it: 80 cells at the flat 3 QT would be 240
    for (const every of [1, 5, 20]) {
      const r = corridorRun(80, every);
      console.log(`[relaunch] corridor 80 cells, relaunch every ${every}: paid ${r.paid} QT in ${r.ticks} ticks (one attack: ${single.paid} QT in ${single.ticks} ticks)`);
      expect(r.paid, `every ${every}`).toBeGreaterThan(single.paid * 0.88);
      expect(r.paid, `every ${every}`).toBeLessThan(single.paid * 1.15);
      expect(r.ticks, `every ${every}`).toBeGreaterThanOrEqual(single.ticks * 0.99);
    }
  });

  it('the exposure record of a cell is what a capture of an attack left: attacker << 8 | depth, cleared when the cell changes owner', () => {
    const s = corridor();
    applyAttack(s, 0, 0, 100);
    const at = (x: number): number => W + x;
    for (let t = 0; t < 4000 && (s.agg.area[1] as number) < 6; t++) step(s, { turn: s.tick, intents: [] });
    expect(s.agg.area[1]).toBeGreaterThanOrEqual(6);
    const taken = s.agg.area[1] as number;
    // the cells it owns carry no record; the cell next to the front was exposed by the capture before it, one deeper than that one
    for (let x = 0; x < taken; x++) expect(s.exposure[at(x)], `x ${x}`).toBe(0);
    expect(s.exposure[at(taken)]).toBe((1 << 8) | (taken - 1));
    // taking the cell clears its record
    setOwner(s, at(taken), 2, 0);
    expect(s.exposure[at(taken)]).toBe(0);
    // the record survives a snapshot and a hostile one is refused
    const r = deserialize(serialize(s));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Array.from(r.state.exposure)).toEqual(Array.from(s.exposure));
      expect(hashState(r.state)).toBe(hashState(s));
    }
  });

  it('a new attack starts a cell at the depth of ITS attacker\'s record, and at 0 for the record of another attacker or none', () => {
    const s = landState(20, 5, { seats: 3 });
    for (let y = 0; y < 5; y++) setOwner(s, y * 20 + 4, 1, 0); // owner 1 holds column 4
    s.troops[1] = 100000;
    s.exposure[2 * 20 + 5] = (1 << 8) | 30; // its own record: depth 30
    s.exposure[1 * 20 + 5] = (2 << 8) | 30; // another attacker's record: ignored
    s.exposure[3 * 20 + 5] = (1 << 8) | D_MAX_CELLS; // the deepest allowed
    expect(applyAttack(s, 0, 0, 100)).toBe(0);
    const a = s.attacks.find(1, 0);
    if (a === null || a === undefined) throw new Error('no attack');
    const depthOf = (cell: number): number => {
      for (let d = 0; d < a.counts.length; d++) {
        const bag = a.bags[d];
        for (let i = 0; i < (a.counts[d] as number); i++) if ((bag as Int32Array)[i] === cell) return d;
      }
      return -1;
    };
    expect(depthOf(2 * 20 + 5)).toBe(30);
    expect(depthOf(1 * 20 + 5)).toBe(0);
    expect(depthOf(0 * 20 + 5)).toBe(0);
    expect(depthOf(3 * 20 + 5)).toBe(D_MAX_CELLS);
    expect(depthOf(4 * 20 + 5)).toBe(0);
    // the shallowest bag is taken first, so the deep cells wait
    expect(a.low).toBe(0);
  });

  it('hostile exposure bytes (an attacker that does not exist, a depth beyond D_MAX_CELLS) are refused with an error result, never a throw', () => {
    const s = landState(8, 4, { seats: 2 });
    const bytes = serialize(s);
    // the exposure array sits after the stamp array: header 64, terrain n, elevation 2n, owner 2n, stamp 4n
    const n = 32;
    const at = 64 + n + 2 * n + 2 * n + 4 * n;
    for (const bad of [(3 << 8) | 1, (1 << 8) | (D_MAX_CELLS + 1), (1 << 8) | 255, 5, 0xff00]) {
      const b = bytes.slice();
      new DataView(b.buffer).setUint16(at + 2 * 3, bad, true);
      const r = deserialize(b);
      expect(r.ok, `value ${bad}`).toBe(false);
      if (!r.ok) expect(r.error, `value ${bad}`).toBe('exposure-range');
    }
    // a valid record at that place is accepted once the checksum is right again: the state itself round-trips
    const ok = landState(8, 4, { seats: 2 });
    ok.exposure[3] = (2 << 8) | D_MAX_CELLS;
    expect(deserialize(serialize(ok)).ok).toBe(true);
  });
});

describe('the solo expander on the real world: relaunching does not beat the plain one (the calibration band belongs to the reference bot)', () => {
  /** The cells owned after 5 minutes by a solo player on Moscow who attacks free land at 100 %; `period` > 0 cancels and relaunches every `period` ticks (as one intent turn). */
  async function fiveMinutes(period: number): Promise<number> {
    const world = await loadRealWorld();
    const country = pickCountries(largestCountries(world), 1, 1, 'RUS')[0];
    if (country === undefined) throw new Error('no RUS');
    const s = createWorldState(world, { seed: 1, seats: 1, players: 1 });
    const alloc = new IdAllocator();
    for (let t = 0; t < 3000; t++) {
      const bodies: IntentBody[] = [];
      if (t === 0) bodies.push({ kind: 'Spawn', seat: 0, cell: country.capitalCell });
      else if (t % 10 === 0) {
        const running = s.attacks.find(1, 0) !== null;
        if (running && period > 0 && t % period === 0) bodies.push({ kind: 'CancelAttack', seat: 0, target: 0 }, { kind: 'Attack', seat: 0, target: 0, pct: 100 });
        else if (!running) bodies.push({ kind: 'Attack', seat: 0, target: 0, pct: 100 });
      }
      const intents: Intent[] = bodies.map((b) => withId(b, alloc.alloc(b.seat)));
      const r = step(s, { turn: s.tick, intents });
      if (!r.ok) throw new Error(r.error);
      s.outbox.clear();
    }
    return s.agg.area[1] as number;
  }

  it('cancel and relaunch every 100 or every 20 ticks leaves the territory after 5 minutes within +5 % / -15 % of the plain expander (it was +13 % and +44 % before the exposure record)', async () => {
    const plain = await fiveMinutes(0);
    const slow = await fiveMinutes(100);
    const fast = await fiveMinutes(20);
    console.log(`[relaunch] Moscow solo, cells after 5 minutes: plain ${plain}, relaunch every 100 ticks ${slow}, every 20 ticks ${fast}`);
    for (const v of [slow, fast]) {
      expect(v).toBeLessThanOrEqual(plain * 1.05);
      expect(v).toBeGreaterThanOrEqual(plain * 0.85);
    }
  }, 120000);
});
