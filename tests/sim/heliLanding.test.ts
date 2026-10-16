// M12a-3: the landing, the beachhead and the cut-off cluster (src/sim/heliLanding.ts, src/sim/beachheadCluster.ts). Every test drives the real sim
// (applyLaunchHeli, heliPhase, step), so a rule removed from the landing or the cluster code fails here. The world is 512x128 plains at 5 m:
// seat 0 (ownerId 1) owns x < 256, seat 1 (ownerId 2) owns x >= 256, except a NEUTRAL band x in [280, 330) that nobody owns.
import { describe, expect, it } from 'vitest';
import { cutOffWeightOf } from '../../src/sim/beachheadCluster';
import { applyLaunchHeli, applyRecallHeli } from '../../src/sim/heliFlight';
import { landingBlockedBy, landingCell, landingCostMilli } from '../../src/sim/heliLanding';
import { heliPhase } from '../../src/sim/heliPhase';
import { BEACH_CUT_OFF, HELI_PAD, HELI_UNLOAD } from '../../src/sim/heliTable';
import { ownedStdAreaQ15, ownerCapQt } from '../../src/sim/economy';
import { produceHeliBody, REJECT_HELI_NOT_FLYING, REJECT_NONE, withId, type IntentBody } from '../../src/sim/intents';
import { LZ_ENEMY_CITY_NEAR, LZ_OUT_OF_FUEL, LZ_PEAK, LZ_STEEP, LZ_TERRAIN_CLASS, LZ_WATER } from '../../src/sim/nav/lz';
import {
  OUTBOX_BEACHHEAD_FORMED,
  OUTBOX_BEACHHEAD_REVERTED,
  OUTBOX_ELIMINATED,
  OUTBOX_HELI_LANDED,
  type OutboxEvent,
} from '../../src/sim/outbox';
import {
  BEACHHEAD_CHECK_TICKS,
  BEACHHEAD_ESTABLISH_CELLS,
  BEACHHEAD_REVERT_TICKS,
  BUILD_TICKS,
  BEACHHEAD_LANDING_CELLS,
  HELI_BUILD_TICKS,
  HELI_UNLOAD_TICKS,
  MILLI_GOLD_PER_GOLD,
  MILLI_QT_PER_QT,
  QT_PER_TROOP,
  TICK_HZ,
} from '../../src/sim/rules';
import { deserialize, hashState, serialize } from '../../src/sim/serialize';
import { step } from '../../src/sim/step';
import { createState, rebuildAggregates, type GameState } from '../../src/sim/state';
import { STRUCT_CITY, STRUCT_FACTORY } from '../../src/sim/structureRules';
import { CLASS_DEEP_SEA, CLASS_FOREST, CLASS_PEAK, CLASS_PLAINS } from '../../src/sim/terrain';
import { setOwner } from '../../src/sim/territory';

const W = 512;
const H = 128;
const at = (x: number, y: number): number => y * W + x;
const GOLD = 100000 * MILLI_GOLD_PER_GOLD;
const TROOPS_QT = 5000 * QT_PER_TROOP;
const ENEMY_LZ = at(270, 60); // 40 cells east of the Factory, in the middle of the enemy's land
const NEUTRAL_LZ = at(300, 60); // inside the neutral band

function world(): GameState {
  const terrain = new Uint8Array(W * H).fill(CLASS_PLAINS);
  const elevation = new Uint16Array(W * H).fill(5);
  const maxElev = new Int16Array(W * H).fill(5);
  const s = createState({ width: W, height: H, seed: 5, seats: 2, config: { debugIntents: true }, terrain, elevation, maxElev });
  for (let c = 0; c < W * H; c++) {
    const x = c % W;
    s.owner[c] = x < 256 ? 1 : x >= 280 && x < 330 ? 0 : 2;
  }
  rebuildAggregates(s);
  s.gold[1] = GOLD;
  s.gold[2] = GOLD;
  s.troops[1] = TROOPS_QT;
  s.troops[2] = TROOPS_QT;
  return s;
}

function idle(s: GameState, ticks: number): void {
  for (let i = 0; i < ticks; i++) expect(step(s, { turn: s.tick, intents: [] }).ok).toBe(true);
}

/** Flight and landing only: the helicopter phase and the tick counter, WITHOUT the economy, so that troops move only by what the helicopter does. */
function fly(s: GameState, ticks = 1): void {
  for (let i = 0; i < ticks; i++) {
    heliPhase(s);
    s.tick++;
  }
}

let nextId = 1;
function run(s: GameState, ...bodies: IntentBody[]): void {
  step(s, { turn: s.tick, intents: bodies.map((b) => withId(b, nextId++)) });
}

/** A finished Factory of ownerId 1 at (x, y) with a parked helicopter. Returns the structure id. */
function factoryWithHeli(s: GameState, x = 230, y = 60): number {
  const f = s.structures.add(STRUCT_FACTORY, 1, at(x, y), s.tick);
  idle(s, BUILD_TICKS[STRUCT_FACTORY] as number);
  run(s, produceHeliBody(0, f));
  idle(s, HELI_BUILD_TICKS + 1);
  s.troops[1] = TROOPS_QT;
  return f;
}

interface Landed {
  readonly events: OutboxEvent[];
  readonly landed: OutboxEvent;
  /** The tick of the step that landed (the beachhead's landTick). */
  readonly tick: number;
}

/** Launches from Factory `f` and runs `tickFn` until HELI_LANDED is announced. */
function launchAndLand(s: GameState, f: number, lz: number, troops: number, mode = 0, tickFn: (s: GameState) => void = (x) => fly(x)): Landed {
  s.outbox.clear();
  expect(applyLaunchHeli(s, 0, f, lz, troops, mode)).toBe(REJECT_NONE);
  const events: OutboxEvent[] = [];
  for (let i = 0; i < 3000; i++) {
    tickFn(s);
    const evs = s.outbox.drain();
    events.push(...evs);
    const landed = evs.find((e) => e.kind === OUTBOX_HELI_LANDED);
    if (landed !== undefined) return { events, landed, tick: landed.tick };
  }
  throw new Error('the helicopter never landed');
}

/** How many cells a load of `loadQt` quarter troops pays for at the zone `lz` (the same carry as performLanding), and their summed price in milli-QT. */
function affordable(s: GameState, lz: number, loadQt: number): { cells: number; milli: number } {
  let rem = loadQt;
  let frac = 0;
  let cells = 0;
  let milli = 0;
  for (let k = 0; k < BEACHHEAD_LANDING_CELLS; k++) {
    const c = landingCell(W, H, lz, k);
    if (c < 0 || s.owner[c] === 1) continue;
    const cost = landingCostMilli(s, c, s.owner[c] as number, 1);
    const owed = frac + cost;
    const whole = Math.floor(owed / MILLI_QT_PER_QT);
    if (rem < whole) break;
    rem -= whole;
    frac = owed - whole * MILLI_QT_PER_QT;
    cells++;
    milli += cost;
  }
  return { cells, milli };
}

/** The smallest load in whole troops that pays for exactly `n` landing cells at `lz`. */
function troopsFor(s: GameState, lz: number, n: number): number {
  for (let t = 1; t <= 600; t++) if (affordable(s, lz, t * QT_PER_TROOP).cells === n) return t;
  throw new Error('no load pays for exactly ' + n + ' cells');
}

function ownedCells(s: GameState, owner: number): number[] {
  const out: number[] = [];
  for (let c = 0; c < W * H; c++) if (s.owner[c] === owner) out.push(c);
  return out;
}

describe('the landing zone is judged by scoreLz at LaunchHeli (the refusal is the scoreLz reason)', () => {
  it('water, Peak, Forest, steep ground, an enemy City next to it and too far for the fuel are all refused', () => {
    const s = world();
    s.terrain[at(290, 30)] = CLASS_DEEP_SEA;
    s.terrain[at(290, 40)] = CLASS_PEAK;
    s.terrain[at(290, 50)] = CLASS_FOREST;
    s.elevation[at(290, 80)] = 600;
    const f = factoryWithHeli(s);
    s.structures.add(STRUCT_CITY, 2, at(290, 100), s.tick);
    const cases: Array<[number, number]> = [
      [at(290, 30), LZ_WATER],
      [at(290, 40), LZ_PEAK],
      [at(290, 50), LZ_TERRAIN_CLASS],
      [at(290, 80), LZ_STEEP],
      [at(291, 100), LZ_ENEMY_CITY_NEAR],
      [at(510, 10), LZ_OUT_OF_FUEL],
    ];
    for (const [cell, reason] of cases) expect(applyLaunchHeli(s, 0, f, cell, 100, 0), `cell ${cell}`).toBe(reason);
    expect(s.helis.state[0]).toBe(HELI_PAD);
    expect(s.troops[1]).toBe(TROOPS_QT);
    expect(applyLaunchHeli(s, 0, f, ENEMY_LZ, 100, 0)).toBe(REJECT_NONE); // a good zone passes
  });

  it('the plan\'s numbers: unload 10 ticks, nine cells, search every 10 ticks, established at 80 cells, back to neutral after 450 ticks (45 s)', () => {
    expect([HELI_UNLOAD_TICKS, BEACHHEAD_LANDING_CELLS, BEACHHEAD_CHECK_TICKS, BEACHHEAD_ESTABLISH_CELLS, BEACHHEAD_REVERT_TICKS, TICK_HZ]).toEqual([10, 9, 10, 80, 450, 10]);
  });

  it('the diplomacy hook exists and blocks nothing yet', () => {
    expect(landingBlockedBy(1, 2)).toBe(false);
    expect(landingBlockedBy(1, 0)).toBe(false);
  });
});

describe('the landing takes the zone, then N, E, S, W, NE, SE, SW, NW at the Attack price', () => {
  it('a load that pays for n cells (1 to 9) takes exactly the first n of the fixed order, forms one beachhead, and the events say so', () => {
    for (let n = 1; n <= BEACHHEAD_LANDING_CELLS; n++) {
      const s = world();
      const f = factoryWithHeli(s);
      const troops = troopsFor(s, ENEMY_LZ, n);
      const before = ownedCells(s, 1).length;
      const r = launchAndLand(s, f, ENEMY_LZ, troops);
      expect(r.landed.b, `landed cells for n = ${n}`).toBe(n);
      const mine = ownedCells(s, 1).length - before;
      expect(mine).toBe(n);
      for (let k = 0; k < BEACHHEAD_LANDING_CELLS; k++) {
        const c = landingCell(W, H, ENEMY_LZ, k);
        expect(s.owner[c], `n = ${n}, cell number ${k} of the fixed order`).toBe(k < n ? 1 : 2);
      }
      const b = s.beachheads;
      expect(b.liveCount).toBe(1);
      expect([b.owner[0], b.seed[0], b.landTick[0], b.status[0]]).toEqual([1, ENEMY_LZ, r.tick, BEACH_CUT_OFF]);
      expect(r.events.filter((e) => e.kind === OUTBOX_BEACHHEAD_FORMED)).toEqual([{ kind: OUTBOX_BEACHHEAD_FORMED, tick: r.tick, a: 0, b: ENEMY_LZ }]);
      expect(s.helis.load[0]).toBe(0);
    }
  });

  it('an enemy cell costs twice a neutral one, and the rest of the load becomes an Attack from the beachhead on the land the zone was taken from', () => {
    const s = world();
    const enemyCost = landingCostMilli(s, ENEMY_LZ, 2, 1);
    const neutralCost = landingCostMilli(s, NEUTRAL_LZ, 0, 1);
    expect(enemyCost).toBe(2 * neutralCost);
    expect(neutralCost).toBeGreaterThan(0);
    const f = factoryWithHeli(s);
    const r = launchAndLand(s, f, ENEMY_LZ, 600);
    expect(r.landed.b).toBe(9);
    const attack = s.attacks.find(1, 2);
    expect(attack).not.toBeNull();
    const { milli } = affordable(world(), ENEMY_LZ, 600 * QT_PER_TROOP);
    expect(milli).toBeGreaterThan(0);
    // Nothing from nothing: the seat's troops plus the attack's equal what the seat had at the launch minus the price of the cells.
    const paid = TROOPS_QT - (s.troops[1] as number) - (attack?.troops ?? 0);
    expect(paid).toBeGreaterThanOrEqual(Math.floor(milli / MILLI_QT_PER_QT));
    expect(paid).toBeLessThanOrEqual(Math.ceil(milli / MILLI_QT_PER_QT));
  });

  it('a zone that cannot be taken fails: no cell, no beachhead, the load is lost, HELI_LANDED says -1, and the helicopter goes home empty', () => {
    const s = world();
    const f = factoryWithHeli(s);
    expect(affordable(s, ENEMY_LZ, QT_PER_TROOP).cells).toBe(0); // one troop does not pay for even the first cell
    const owners = Array.from(s.owner);
    const r = launchAndLand(s, f, ENEMY_LZ, 1);
    expect(r.landed.b).toBe(-1);
    expect(Array.from(s.owner)).toEqual(owners);
    expect(s.beachheads.liveCount).toBe(0);
    expect(r.events.some((e) => e.kind === OUTBOX_BEACHHEAD_FORMED)).toBe(false);
    expect(s.troops[1]).toBe(TROOPS_QT - QT_PER_TROOP); // lost: nothing came back
    expect(s.helis.load[0]).toBe(0);
    let guard = 0;
    while (s.helis.state[0] !== HELI_PAD && guard++ < 3000) fly(s);
    expect(s.helis.state[0]).toBe(HELI_PAD);
    expect(s.troops[1]).toBe(TROOPS_QT - QT_PER_TROOP);
  });

  it('a zone that became unplayable while the helicopter flew fails the same way', () => {
    const s = world();
    const f = factoryWithHeli(s);
    expect(applyLaunchHeli(s, 0, f, ENEMY_LZ, 300, 0)).toBe(REJECT_NONE);
    fly(s, 30);
    s.grid.playable[ENEMY_LZ] = 0;
    s.outbox.clear();
    let b = 99;
    for (let i = 0; i < 3000 && b === 99; i++) {
      fly(s);
      for (const e of s.outbox.drain()) if (e.kind === OUTBOX_HELI_LANDED) b = e.b;
    }
    expect(b).toBe(-1);
    expect(s.beachheads.liveCount).toBe(0);
  });

  it('HELI_UNLOAD lasts HELI_UNLOAD_TICKS and the cells are taken in its last step, not before; the altitude holds the clearance floor meanwhile', () => {
    const s = world();
    const f = factoryWithHeli(s);
    expect(applyLaunchHeli(s, 0, f, ENEMY_LZ, 600, 0)).toBe(REJECT_NONE);
    let start = -1;
    for (let i = 0; i < 3000 && start < 0; i++) {
      fly(s);
      if (s.helis.state[0] === HELI_UNLOAD) start = s.helis.stateTick[0] as number;
    }
    expect(start).toBeGreaterThan(0);
    const altStart = s.helis.alt[0] as number;
    expect(altStart).toBeGreaterThan(40);
    expect(s.owner[ENEMY_LZ]).toBe(2);
    for (let k = 1; k < HELI_UNLOAD_TICKS; k++) {
      fly(s); // the step at tick start + k
      expect(s.helis.state[0]).toBe(HELI_UNLOAD);
      expect(s.owner[ENEMY_LZ], `before the last unload step (k = ${k})`).toBe(2);
    }
    expect(s.helis.alt[0]).toBe(altStart); // the hover altitude holds (the clearance floor of the flight is never broken, M12b reads it)
    expect(applyRecallHeli(s, 0, 0)).toBe(REJECT_HELI_NOT_FLYING); // a helicopter that is unloading cannot be recalled
    fly(s); // the step at tick start + HELI_UNLOAD_TICKS
    expect(s.owner[ENEMY_LZ]).toBe(1);
    expect(s.beachheads.landTick[0]).toBe(start + HELI_UNLOAD_TICKS);
  });

  it('over the date line: the neighbours wrap, and a flight across the seam lands', () => {
    for (const [fx, lzx] of [[440, 511], [480, 5]] as const) {
      const s = world();
      for (let c = 0; c < W * H; c++) {
        const x = c % W;
        s.owner[c] = x >= 256 && x < 490 ? 1 : 2;
      }
      rebuildAggregates(s);
      const f = factoryWithHeli(s, fx, 60);
      const lz = at(lzx, 60);
      const r = launchAndLand(s, f, lz, 600);
      expect(r.landed.b).toBe(9);
      const xs = new Set<number>();
      for (let k = 0; k < 9; k++) {
        const c = landingCell(W, H, lz, k);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThan(W * H);
        expect(s.owner[c]).toBe(1);
        xs.add(c % W);
      }
      expect(xs.size).toBe(3);
      if (lzx === 511) expect(xs.has(0) && xs.has(510) && xs.has(511)).toBe(true);
      if (lzx === 5) expect(xs.has(4) && xs.has(5) && xs.has(6)).toBe(true);
    }
  });
});

describe('the cut-off cluster', () => {
  it('returns to neutral EXACTLY BEACHHEAD_REVERT_TICKS after the landing (the enclave rule does not eat it first), with its event, and the row is freed', () => {
    const s = world();
    const f = factoryWithHeli(s);
    const r = launchAndLand(s, f, ENEMY_LZ, 600, 0, (x) => idle(x, 1)); // the real step: the enclave phase and the economy run
    expect(r.landed.b).toBe(9);
    const land = r.tick;
    const nine = (): number => landingCellsOwned(s, ENEMY_LZ, 1);
    expect(nine()).toBe(9);
    // idle() runs the step at s.tick; after the landing step s.tick = land + 1
    const reverted: OutboxEvent[] = [];
    while (s.tick < land + BEACHHEAD_REVERT_TICKS) {
      idle(s, 1);
      reverted.push(...s.outbox.drain().filter((e) => e.kind === OUTBOX_BEACHHEAD_REVERTED));
      expect(nine(), `still the player's at tick ${s.tick}`).toBe(9);
    }
    expect(s.tick).toBe(land + BEACHHEAD_REVERT_TICKS);
    expect(reverted).toHaveLength(0);
    idle(s, 1); // the step at tick land + 450
    reverted.push(...s.outbox.drain().filter((e) => e.kind === OUTBOX_BEACHHEAD_REVERTED));
    expect(reverted).toEqual([{ kind: OUTBOX_BEACHHEAD_REVERTED, tick: land + BEACHHEAD_REVERT_TICKS, a: 0, b: ENEMY_LZ }]);
    for (let k = 0; k < 9; k++) expect(s.owner[landingCell(W, H, ENEMY_LZ, k)], `cell ${k} is neutral again`).toBe(0);
    expect(s.beachheads.liveCount).toBe(0);
  });

  /** Paints a block of owner 1 cells around the neutral zone, leaving out `holes` cells, after the landing. */
  function paintBlock(s: GameState, holes: number[]): void {
    for (let y = 56; y <= 64; y++) for (let x = 296; x <= 304; x++) if (!holes.includes(at(x, y))) setOwner(s, at(x, y), 1, 0);
  }

  it('79 connected cells still revert at 450 ticks, 80 cells are established (the row is freed) and stay; so does a cluster with a City', () => {
    const outcomes: Record<string, { left: number; rows: number }> = {};
    const variants: Array<[string, number[], boolean]> = [
      ['79', [at(296, 56), at(304, 64)], false],
      ['80', [at(296, 56)], false],
      ['city', [], true],
    ];
    for (const [name, holes, city] of variants) {
      const s = world();
      const f = factoryWithHeli(s);
      const r = launchAndLand(s, f, NEUTRAL_LZ, 600);
      expect(r.landed.b).toBe(9);
      if (city) {
        // a City on a landed cell: the cluster is established at its first check
        s.structures.add(STRUCT_CITY, 1, at(300, 59), s.tick);
      } else paintBlock(s, holes);
      const before = ownedCells(s, 1).length;
      expect(before).toBeGreaterThan(0);
      fly(s, BEACHHEAD_REVERT_TICKS + 60);
      const nineCells = landingCellsOwned(s, NEUTRAL_LZ, 1);
      outcomes[name] = { left: nineCells, rows: s.beachheads.liveCount };
    }
    expect(outcomes['79']).toEqual({ left: 0, rows: 0 });
    expect(outcomes['80']).toEqual({ left: 9, rows: 0 });
    expect(outcomes['city']).toEqual({ left: 9, rows: 0 });
  });

  it('while cut off the cluster counts for no troop cap, regeneration or gold land; once established it does', () => {
    const s = world();
    const f = factoryWithHeli(s);
    const n0 = ownedStdAreaQ15(s, 1);
    const cap0 = ownerCapQt(s, 1);
    const r = launchAndLand(s, f, ENEMY_LZ, 600);
    expect(r.landed.b).toBe(9);
    expect(cutOffWeightOf(s, 1)).toBeGreaterThan(0);
    expect(ownedStdAreaQ15(s, 1)).toBe(n0);
    expect(ownerCapQt(s, 1)).toBe(cap0);
    // grow the cluster by hand: still cut off (fewer than 80 cells), still nothing
    for (let y = 58; y <= 62; y++) for (let x = 268; x <= 272; x++) setOwner(s, at(x, y), 1, 0);
    expect(ownedStdAreaQ15(s, 1)).toBe(n0);
    // a City on it: the cluster is established at its next check (every 10 ticks), the row is freed and the cells count
    s.structures.add(STRUCT_CITY, 1, at(270, 60), s.tick);
    fly(s, 10);
    expect(s.beachheads.liveCount).toBe(0);
    expect(ownedStdAreaQ15(s, 1)).toBeGreaterThan(n0);
    expect(cutOffWeightOf(s, 1)).toBe(0);
    // the owner with no beachhead is untouched
    expect(cutOffWeightOf(s, 2)).toBe(0);
  });

  it('two beachheads that grow together are merged: the younger row is freed and the joined cluster reverts at the older one\'s time', () => {
    const s = world();
    const f1 = factoryWithHeli(s, 230, 60);
    const f2 = factoryWithHeli(s, 230, 70);
    expect(applyLaunchHeli(s, 0, f1, at(300, 60), 600, 0)).toBe(REJECT_NONE);
    expect(applyLaunchHeli(s, 0, f2, at(303, 60), 600, 0)).toBe(REJECT_NONE);
    s.outbox.clear();
    let landed = 0;
    for (let i = 0; i < 3000 && landed < 2; i++) {
      fly(s);
      for (const e of s.outbox.drain()) if (e.kind === OUTBOX_HELI_LANDED) landed++;
    }
    expect(landed).toBe(2);
    expect(s.beachheads.liveCount).toBe(2);
    const older = Math.min(s.beachheads.landTick[0] as number, s.beachheads.landTick[1] as number);
    let guard = 0;
    while (s.beachheads.liveCount === 2 && guard++ < 40) fly(s);
    expect(s.beachheads.liveCount).toBe(1);
    const slot = s.beachheads.owner[0] !== 0 ? 0 : 1;
    expect(s.beachheads.landTick[slot]).toBe(older);
    const joined = ownedCells(s, 1).filter((c) => c % W >= 290).length;
    expect(joined).toBe(18);
    while (s.tick < older + BEACHHEAD_REVERT_TICKS) fly(s);
    expect(ownedCells(s, 1).filter((c) => c % W >= 290).length).toBe(18);
    fly(s);
    expect(ownedCells(s, 1).filter((c) => c % W >= 290).length).toBe(0);
  });

  it('a seed taken by the enemy moves to a neighbour that is still ours; with no neighbour left the row is freed', () => {
    const s = world();
    const f = factoryWithHeli(s);
    launchAndLand(s, f, NEUTRAL_LZ, 600);
    setOwner(s, NEUTRAL_LZ, 2, 0);
    fly(s, 10);
    expect(s.beachheads.liveCount).toBe(1);
    expect(s.beachheads.seed[0]).toBe(at(300, 59)); // the first of N, E, S, W, ... that is still the owner's
    for (let k = 1; k < 9; k++) setOwner(s, landingCell(W, H, NEUTRAL_LZ, k), 2, 0);
    fly(s, 10);
    expect(s.beachheads.liveCount).toBe(0);
  });
});

/** How many of the nine cells of a landing at `lz` belong to `owner`. */
function landingCellsOwned(s: GameState, lz: number, owner: number): number {
  let n = 0;
  for (let k = 0; k < 9; k++) if (s.owner[landingCell(W, H, lz, k)] === owner) n++;
  return n;
}

describe('a player whose only ground is a cut-off beachhead', () => {
  it('is not eliminated while the beachhead lives and is eliminated (flag + event) when it returns to neutral', () => {
    const s = world();
    const f = factoryWithHeli(s);
    idle(s, 2); // the match phase records the peak land of the whole player
    expect(applyLaunchHeli(s, 0, f, NEUTRAL_LZ, troopsFor(s, NEUTRAL_LZ, 9), 0)).toBe(REJECT_NONE); // exactly the nine cells: no rest of the load to grow it
    s.outbox.clear();
    // the enemy takes everything the player owned while the helicopter is on its way (the Factory's cell and a neutral cell beside it stay: a lone cell
    // inside one other owner's land is an enclave that flips within 20 ticks, a cell that also touches neutral land is not)
    s.owner[at(229, 60)] = 0;
    rebuildAggregates(s);
    for (let c = 0; c < W * H; c++) if (s.owner[c] === 1 && c !== at(230, 60)) setOwner(s, c, 2, 0); // the Factory's cell stays until the landing
    s.outbox.clear();
    let landTick = -1;
    for (let i = 0; i < 3000 && landTick < 0; i++) {
      idle(s, 1);
      for (const e of s.outbox.drain()) if (e.kind === OUTBOX_HELI_LANDED) landTick = e.tick;
    }
    expect(landTick).toBeGreaterThan(0);
    expect(s.match.eliminated[1]).toBe(0); // the Factory's cell is still the player's
    setOwner(s, at(230, 60), 2, 0); // now the player's only ground is the beachhead
    expect(ownedCells(s, 1)).toHaveLength(9);
    const events: OutboxEvent[] = [];
    while (s.tick < landTick + BEACHHEAD_REVERT_TICKS) {
      idle(s, 1);
      events.push(...s.outbox.drain());
      expect(s.match.eliminated[1], `tick ${s.tick}`).toBe(0);
      expect(ownedCells(s, 1).length).toBeGreaterThanOrEqual(9); // the rest of the load is an Attack that may grow the beachhead
    }
    expect(events.filter((e) => e.kind === OUTBOX_ELIMINATED)).toHaveLength(0);
    idle(s, 1); // the step at tick landTick + 450: the beachhead returns to neutral, and the match phase of the same step sees a player with no cell
    events.push(...s.outbox.drain());
    expect(ownedCells(s, 1)).toHaveLength(0);
    expect(events.filter((e) => e.kind === OUTBOX_BEACHHEAD_REVERTED)).toHaveLength(1);
    expect(s.match.eliminated[1]).toBe(1);
    expect(events.filter((e) => e.kind === OUTBOX_ELIMINATED).map((e) => e.a)).toEqual([0]);
  });
});

describe('the state survives a round trip with beachheads and helicopters in the middle of a landing', () => {
  it('a snapshot taken with one helicopter unloading and one beachhead cut off equals the straight run, tick by tick, through the revert', () => {
    const s = world();
    const f1 = factoryWithHeli(s, 230, 60);
    const f2 = factoryWithHeli(s, 230, 90);
    expect(applyLaunchHeli(s, 0, f1, ENEMY_LZ, 600, 0)).toBe(REJECT_NONE);
    let guard = 0;
    while (s.beachheads.liveCount === 0 && guard++ < 3000) idle(s, 1);
    expect(s.beachheads.liveCount).toBe(1);
    expect(applyLaunchHeli(s, 0, f2, at(300, 100), 600, 1)).toBe(REJECT_NONE);
    guard = 0;
    while (s.helis.state[1] !== HELI_UNLOAD && guard++ < 3000) idle(s, 1);
    expect(s.helis.state[1]).toBe(HELI_UNLOAD);
    const bytes = serialize(s);
    const back = deserialize(bytes, { maxElev: new Int16Array(W * H).fill(5) });
    if (!back.ok) throw new Error('round trip failed: ' + back.error);
    const t = back.state;
    expect(hashState(t)).toBe(hashState(s));
    expect(Array.from(serialize(t))).toEqual(Array.from(bytes));
    expect(ownedStdAreaQ15(t, 1)).toBe(ownedStdAreaQ15(s, 1)); // the derived cut-off cache is rebuilt to the same figure
    expect(cutOffWeightOf(t, 1)).toBe(cutOffWeightOf(s, 1));
    let reverts = 0;
    for (let i = 0; i < BEACHHEAD_REVERT_TICKS + 80; i++) {
      step(s, { turn: s.tick, intents: [] });
      step(t, { turn: t.tick, intents: [] });
      reverts += s.outbox.drain().filter((e) => e.kind === OUTBOX_BEACHHEAD_REVERTED).length;
      t.outbox.clear();
      if (i % 15 === 0 || i > BEACHHEAD_REVERT_TICKS - 20) expect(hashState(t), `tick ${s.tick}`).toBe(hashState(s));
    }
    expect(reverts).toBeGreaterThanOrEqual(1); // the run went through at least one revert
    expect(hashState(t)).toBe(hashState(s));
  });
});

describe('property: many landings (seeded) create no troops and no cell outside the map', () => {
  for (const fy of [10, 118]) it(`troops before == troops after + the load that was lost + the price of the cells, and only the nine cells around the zone change (Factory row ${fy}, zones up to the map edge)`, () => {
    let seed = 0x9e3779b9;
    const rnd = (n: number): number => {
      seed ^= seed << 13;
      seed >>>= 0;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      seed >>>= 0;
      return seed % n;
    };
    let landings = 0;
    let failed = 0;
    let cellsSeen = 0;
    let edgeLandings = 0;
    const s = world();
    const f = factoryWithHeli(s, 230, fy);
    for (let round = 0; landings < 25 && round < 200; round++) {
      // fresh ownership every round so that earlier landings do not pile up: the enemy half and the band come back
      for (let c = 0; c < W * H; c++) if (s.owner[c] !== 1) s.owner[c] = (c % W) >= 280 && (c % W) < 330 ? 0 : 2;
      for (let id = 0; id < s.beachheads.capacity; id++) s.beachheads.remove(id);
      rebuildAggregates(s);
      s.attacks.list.length = 0;
      s.attacks.reindex();
      const lz = at(262 + rnd(40), fy === 10 ? rnd(21) : H - 1 - rnd(21));
      const troops = rnd(3) === 0 ? 1 + rnd(3) : 1 + rnd(600); // small loads fail, large ones take all nine cells
      s.troops[1] = TROOPS_QT;
      const owners = Array.from(s.owner);
      const total = (): number => (s.troops[1] as number) + s.attacks.list.reduce((a, x) => a + x.troops, 0) + (s.helis.owner[0] === 0 ? 0 : (s.helis.load[0] as number) * QT_PER_TROOP);
      if (applyLaunchHeli(s, 0, f, lz, troops, rnd(2)) !== REJECT_NONE) continue;
      const priced = affordable(s, lz, troops * QT_PER_TROOP);
      expect(total()).toBe(TROOPS_QT);
      let b = 99;
      for (let i = 0; i < 3000 && b === 99; i++) {
        fly(s);
        for (const e of s.outbox.drain()) if (e.kind === OUTBOX_HELI_LANDED) b = e.b;
      }
      expect(b).not.toBe(99);
      landings++;
      const lost = b === -1 ? troops * QT_PER_TROOP : 0;
      if (b === -1) failed++;
      const paid = TROOPS_QT - total() - lost;
      if (b > 0) {
        expect(b).toBe(priced.cells);
        expect(paid).toBeGreaterThanOrEqual(Math.floor(priced.milli / MILLI_QT_PER_QT));
        expect(paid).toBeLessThanOrEqual(Math.ceil(priced.milli / MILLI_QT_PER_QT));
      } else expect(paid).toBe(0);
      const changed: number[] = [];
      for (let c = 0; c < W * H; c++) if (s.owner[c] !== owners[c]) changed.push(c);
      expect(changed.length).toBe(Math.max(b, 0));
      const ring = new Set<number>();
      for (let k = 0; k < 9; k++) {
        const c = landingCell(W, H, lz, k);
        if (c >= 0) ring.add(c);
      }
      for (const c of changed) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThan(W * H);
        expect(ring.has(c)).toBe(true);
      }
      cellsSeen += changed.length;
      if (b > 0 && (Math.floor(lz / W) === 0 || Math.floor(lz / W) === H - 1)) edgeLandings++;
      // let the helicopter come home before the next round
      let guard = 0;
      while (s.helis.state[0] !== HELI_PAD && guard++ < 3000) fly(s);
      expect(s.helis.state[0]).toBe(HELI_PAD);
      s.outbox.clear();
    }
    expect(landings).toBeGreaterThanOrEqual(20);
    expect(failed).toBeGreaterThan(0); // small loads fail, large ones land: both paths ran
    expect(cellsSeen).toBeGreaterThan(60);
    expect(edgeLandings).toBeGreaterThan(0); // a zone on the first or last row took its (at most six) cells and nothing off the map
  });
});
