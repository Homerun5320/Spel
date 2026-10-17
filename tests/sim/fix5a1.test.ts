// Fix-5A1 (audit 4): rule fixes in the Los memo, the air-defence bucket scan, the federation land timer and the research of eliminated seats, plus the
// test holes the mutation review found in air defence and research. Every test drives the real phases; the mutants are tabulated in the Fix-5A1 block of
// docs/DECISIONS.md.
import { describe, expect, it } from 'vitest';
import { scoreLzOf } from '../../src/sim/access';
import { airDefensePhase, samRoll } from '../../src/sim/airDefense';
import { bindFederation } from '../../src/sim/diplomacy';
import { HELI_BUILDING, HELI_CRUISE, HELI_APPROACH, HELI_DOWNED, HELI_HOVER, HELI_LIFT, HELI_PAD, HELI_RETURN, HELI_UNLOAD, cellCentreQ8 } from '../../src/sim/heliTable';
import { HELI_DOWN_POST, HELI_DOWN_SAM } from '../../src/sim/heliTable';
import { researchBody, withId } from '../../src/sim/intents';
import type { WinConfig } from '../../src/sim/matchState';
import { OUTBOX_HELI_DOWNED } from '../../src/sim/outbox';
import { HELI_HP_TENTHS, MILLI_GOLD_PER_GOLD, POST_AA_RADIUS_CELLS, POST_AA_TENTHS_PER_TICK, SAM_HIT_PCT, SAM_SALVO_PERIOD_TICKS, TECH_TICKS, WEIGHT_ONE } from '../../src/sim/rules';
import { deserialize, hashState, serialize } from '../../src/sim/serialize';
import { createState, rebuildAggregates, type GameState } from '../../src/sim/state';
import { step } from '../../src/sim/step';
import { samRadiusCells } from '../../src/sim/structureEffects';
import { STRUCT_CITY, STRUCT_POST, STRUCT_SAM } from '../../src/sim/structureRules';
import { TECH_FX_GOLD } from '../../src/sim/techTable';
import { setOwner } from '../../src/sim/territory';
import { CLASS_MOUNTAIN, CLASS_PLAINS } from '../../src/sim/terrain';
import { MainThreadHost } from '../../src/host/mainThreadHost';
import { seatToOwner } from '../../src/sim/state';
import { StateView } from '../../src/sim/view';
import { syntheticFixture } from '../../tools/sim/heliRaid';

/** A flat plains world with an occluder layer (so SAM sites can see), seats 1 and 2 at war. */
function flat(width: number, height: number, seed = 1): GameState {
  const n = width * height;
  return createState({ width, height, seed, seats: 2, config: { debugIntents: true }, terrain: new Uint8Array(n).fill(CLASS_PLAINS), elevation: new Uint16Array(n).fill(5), maxElev: new Int16Array(n).fill(5) });
}

/** An airborne helicopter of `owner` standing still at (x, y). */
function heli(s: GameState, owner: number, x: number, y: number, mode: 0 | 1, state: number = HELI_HOVER): number {
  const t = s.helis;
  const id = t.addBuilding(owner, 0, s.tick, s.tick);
  t.state[id] = state;
  t.x[id] = cellCentreQ8(x);
  t.y[id] = cellCentreQ8(y);
  t.mode[id] = mode;
  t.hp[id] = HELI_HP_TENTHS;
  t.load[id] = 100;
  return id;
}

function finished(s: GameState, type: number, x: number, y: number, owner = 2): number {
  const id = s.structures.add(type, owner, y * s.width + x, s.tick);
  s.structures.readyTick[id] = s.tick;
  return id;
}

/** A match seed whose first salvo of SAM `sid` at tick 0 hits (`want`) or misses. */
function seedWithRoll(sid: number, tick: number, hit: boolean): number {
  for (let seed = 1; seed < 500; seed++) if ((samRoll(seed, tick, sid) < SAM_HIT_PCT) === hit) return seed;
  throw new Error('no seed');
}

describe('[0.1] the Los memo sees a level change inside the tick', () => {
  it('a read-only query on the live state before a step does not change the hash after it, with a SAM upgrade finishing in that step', () => {
    const run = (query: boolean): { hash: number; level: number; fired: number } => {
      const fx = syntheticFixture('plains-sam', 3);
      const s = fx.state;
      const sam = fx.sams[0] as number;
      s.structures.remove(fx.sams[1] as number);
      const c = s.structures.cell[sam] as number;
      s.helis.state[fx.heli] = HELI_HOVER;
      // Between a level-1 radius (24) and a level-2 radius: only the upgraded site can shoot, and only if the Los cache saw the new level.
      const dist = samRadiusCells(1, false) + 1;
      expect(samRadiusCells(2, false)).toBeGreaterThanOrEqual(dist);
      s.helis.x[fx.heli] = cellCentreQ8(c % s.width);
      s.helis.y[fx.heli] = cellCentreQ8(Math.floor(c / s.width) - dist);
      s.helis.mode[fx.heli] = 1;
      s.helis.hp[fx.heli] = HELI_HP_TENTHS;
      s.structures.upgradeReadyTick[sam] = s.tick;
      if (query) scoreLzOf(s, 0, fx.lz, c, 0); // syncs the Los cache at the current tick with the level-1 radius
      step(s, { turn: s.tick, intents: [] });
      return { hash: hashState(s), level: s.structures.level[sam] as number, fired: s.structures.salvoTick[sam] as number };
    };
    const a = run(false);
    const b = run(true);
    expect(a.level).toBe(2);
    expect(a.fired).not.toBe(0); // control: the upgraded site did shoot
    expect(b).toEqual(a);
  });
});

describe('[0.2] the air-defence bucket scan across the date line, for a width that is no multiple of 32', () => {
  it('matches a brute-force oracle (Post damage with the wrapped Euclid distance) for widths 96, 100, 128, 130, 1024', () => {
    let seed = 7;
    const rnd = (n: number): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return Math.floor((seed / 4294967296) * n);
    };
    let wrapped = 0;
    for (const w of [96, 100, 128, 130, 1024]) {
      for (let scenario = 0; scenario < 120; scenario++) {
        const s = flat(w, 64, 1 + scenario);
        const hx = rnd(w);
        const hy = 8 + rnd(48);
        const id = heli(s, 1, hx, hy, scenario & 1 ? 1 : 0, HELI_CRUISE);
        const posts: Array<[number, number]> = [];
        for (let k = 0; k < 1 + rnd(4); k++) {
          const px = (((hx + rnd(31) - 15) % w) + w) % w;
          const py = Math.max(0, Math.min(63, hy + rnd(31) - 15));
          if (posts.some((p) => p[0] === px && p[1] === py) || (px === hx && py === hy && false)) continue;
          finished(s, STRUCT_POST, px, py);
          posts.push([px, py]);
        }
        let expected = 0;
        for (const [px, py] of posts) {
          let dx = Math.abs(px - hx);
          if (dx > w - dx) dx = w - dx;
          if (dx > Math.abs(px - hx)) throw new Error('unreachable');
          if (dx * dx + (py - hy) * (py - hy) <= POST_AA_RADIUS_CELLS * POST_AA_RADIUS_CELLS) {
            expected++;
            if (Math.abs(px - hx) > w / 2) wrapped++;
          }
        }
        airDefensePhase(s);
        expect(HELI_HP_TENTHS - (s.helis.hp[id] as number), `width ${w} scenario ${scenario}`).toBe(expected * POST_AA_TENTHS_PER_TICK);
      }
    }
    expect(wrapped).toBeGreaterThan(20); // the scenarios did cross the date line
  });
});

describe('[0.3] the land hold timer of a federation survives the elimination of its root', () => {
  const W = 20;
  const only: WinConfig = { land: true, last: false, score: false, timeLimitTicks: 100000, landSharePct: 60, holdTicks: 100 };
  const world = (): GameState =>
    createState({ width: W, height: W, seed: 5, seats: 4, players: 4, rowCos: new Uint16Array(W).fill(WEIGHT_ONE), config: { debugIntents: true, win: only }, terrain: new Uint8Array(W * W).fill(CLASS_PLAINS), elevation: new Uint16Array(W * W) });
  const paint = (s: GameState, o: number, from: number, to: number): void => {
    for (let c = from; c < to; c++) setOwner(s, c, o, 0);
  };
  const tick = (s: GameState, n: number): void => {
    for (let i = 0; i < n; i++) step(s, { turn: s.tick, intents: [] });
  };

  it('moves the holder to the new root and keeps holdCount while the rest of the group still holds the share', () => {
    const s = world();
    bindFederation(s, 0, 1);
    bindFederation(s, 0, 2);
    bindFederation(s, 1, 2);
    paint(s, 1, 0, 8); // the root owns eight cells (about two standard cells of land, so its loss counts as an elimination)
    paint(s, 2, 40, 190); // cells 8..39 stay free: a root enclosed by one owner would be absorbed as an enclave
    paint(s, 3, 190, 340);
    paint(s, 4, 340, 400);
    tick(s, 50);
    expect(s.match.holdOwner).toBe(1);
    const before = s.match.holdCount;
    expect(before).toBeGreaterThan(20);
    for (let c = 0; c < 8; c++) setOwner(s, c, 0, 0); // the root loses its last cells
    tick(s, 1);
    expect(s.match.eliminated[1]).toBe(1);
    expect(s.match.holdOwner).toBe(2);
    expect(s.match.holdCount).toBe(before + 1);
    tick(s, 3);
    expect(s.match.holdCount).toBe(before + 4);
  });

  it('a group that no longer holds the share after the loss starts over (no free timer)', () => {
    const s = world();
    bindFederation(s, 0, 1);
    bindFederation(s, 0, 2);
    bindFederation(s, 1, 2);
    paint(s, 1, 0, 120); // the root carries the share: without it the others hold 150 of 400 = 37 %
    paint(s, 2, 120, 200);
    paint(s, 3, 200, 270);
    paint(s, 4, 270, 400);
    tick(s, 30);
    expect(s.match.holdOwner).toBe(1);
    for (let c = 0; c < 120; c++) setOwner(s, c, 0, 0);
    tick(s, 1);
    expect(s.match.eliminated[1]).toBe(1);
    expect(s.match.holdCount).toBeLessThanOrEqual(1);
  });
});

describe('[0.4] an eliminated seat has no running research', () => {
  const W = 64;
  const H = 32;
  const GOLD = 100000 * MILLI_GOLD_PER_GOLD;
  const world = (): GameState => {
    const s = createState({ width: W, height: H, seed: 5, seats: 2, config: { debugIntents: true }, terrain: new Uint8Array(W * H).fill(CLASS_PLAINS), elevation: new Uint16Array(W * H) });
    for (let c = 0; c < W * H; c++) s.owner[c] = c % W < 20 ? 1 : c % W >= W - 20 ? 2 : 0;
    rebuildAggregates(s);
    s.gold[1] = GOLD;
    s.gold[2] = GOLD;
    return s;
  };

  it('the elimination clears the research without a refund, and the tech is never finished', () => {
    const s = world();
    step(s, { turn: s.tick, intents: [withId(researchBody(1, 0), 1)] });
    const goldAfterStart = s.gold[2] as number;
    expect(s.match.techCurrent[2]).toBe(1);
    tick(s, 5);
    for (let c = 0; c < W * H; c++) if (s.owner[c] === 2) setOwner(s, c, 0, 0);
    tick(s, 1);
    expect(s.match.eliminated[2]).toBe(1);
    expect(s.match.techCurrent[2]).toBe(0);
    expect(s.match.techDone[2]).toBe(0);
    tick(s, TECH_TICKS[0]! + 5);
    expect(s.match.techMask[2]).toBe(0);
    expect(s.gold[2] as number).toBeLessThan(GOLD); // the price is not refunded
    expect(goldAfterStart).toBeLessThan(GOLD);
  });

  it('deserialize refuses an eliminated seat with a running research, and accepts it without', () => {
    const s = world();
    tick(s, 3);
    for (let c = 0; c < W * H; c++) if (s.owner[c] === 2) setOwner(s, c, 0, 0);
    tick(s, 1);
    expect(s.match.eliminated[2]).toBe(1);
    expect(deserialize(serialize(s)).ok).toBe(true);
    s.match.techCurrent[2] = 1;
    s.match.techDone[2] = s.tick + 100;
    const bad = deserialize(serialize(s));
    expect(bad.ok ? 'ok' : bad.error).toBe('match-range');
  });

  it('[2.0] the research of the LAST seat finishes and its cached effect is live', () => {
    const s = world();
    step(s, { turn: s.tick, intents: [withId(researchBody(1, 0), 1)] });
    tick(s, TECH_TICKS[0]! - 1);
    expect((s.match.techMask[2] as number) & 1).toBe(1);
    expect(s.match.techMask[1]).toBe(0);
    expect(s.match.fx(2, TECH_FX_GOLD)).toBeGreaterThan(0);
    expect(s.match.fx(1, TECH_FX_GOLD)).toBe(0);
  });

  function tick(s: GameState, n: number): void {
    for (let i = 0; i < n; i++) step(s, { turn: s.tick, intents: [] });
  }
});

describe('[2.2] air defence engages every airborne state and ignores the others', () => {
  const AIRBORNE = [HELI_LIFT, HELI_CRUISE, HELI_APPROACH, HELI_HOVER, HELI_UNLOAD, HELI_RETURN];
  const GROUNDED = [HELI_BUILDING, HELI_PAD, HELI_DOWNED];

  it('a Defense Post wears down a helicopter in LIFT, CRUISE, APPROACH, HOVER, UNLOAD and RETURN, not one that is building, parked or down', () => {
    for (const state of [...AIRBORNE, ...GROUNDED]) {
      const s = flat(128, 64);
      finished(s, STRUCT_POST, 60, 30);
      const id = heli(s, 1, 62, 30, 0, state);
      airDefensePhase(s);
      expect(s.helis.hp[id], `state ${state}`).toBe(AIRBORNE.includes(state) ? HELI_HP_TENTHS - POST_AA_TENTHS_PER_TICK : HELI_HP_TENTHS);
    }
  });

  it('a SAM site fires at a helicopter in every airborne state and never at the others', () => {
    for (const state of [...AIRBORNE, ...GROUNDED]) {
      const s = flat(128, 64);
      const sam = finished(s, STRUCT_SAM, 60, 30);
      heli(s, 1, 66, 30, 1, state);
      airDefensePhase(s);
      expect((s.structures.salvoTick[sam] as number) !== 0, `state ${state}`).toBe(AIRBORNE.includes(state));
    }
  });
});

describe('[2.3] the SAM target rule and the spatial hash', () => {
  it('a SAM with two helicopters in range takes the LOWEST id and fires once per period', () => {
    const seed = seedWithRoll(0, 0, true);
    const s = flat(128, 64, seed);
    const sam = finished(s, STRUCT_SAM, 60, 30);
    expect(sam).toBe(0);
    const lo = heli(s, 1, 66, 30, 1);
    const hi = heli(s, 1, 67, 31, 1);
    airDefensePhase(s);
    expect(s.structures.salvoTick[sam]).toBe(SAM_SALVO_PERIOD_TICKS);
    expect(s.helis.state[lo]).toBe(HELI_DOWNED);
    expect(s.helis.state[hi]).toBe(HELI_HOVER);
    // one salvo per period: while the clock runs the other helicopter is not shot at
    for (let i = 0; i < SAM_SALVO_PERIOD_TICKS - 1; i++) {
      s.tick++;
      airDefensePhase(s);
    }
    expect(s.helis.state[hi]).toBe(HELI_HOVER);
    expect(s.structures.salvoTick[sam]).toBe(SAM_SALVO_PERIOD_TICKS);
  });

  it('a level 4 mountain SAM (radius over 32) reaches a High helicopter 33 cells away (the report said 35: the level curve ends at 33), two buckets over', () => {
    const s = flat(160, 64, seedWithRoll(0, 0, true));
    s.terrain[30 * 160 + 31] = CLASS_MOUNTAIN;
    const sam = finished(s, STRUCT_SAM, 31, 30);
    s.structures.level[sam] = 4;
    expect(samRadiusCells(4, true)).toBeGreaterThan(32);
    const id = heli(s, 1, 64, 30, 1); // bucket column 0 versus 2, exactly at the radius
    airDefensePhase(s);
    expect(s.structures.salvoTick[sam]).not.toBe(0);
    expect(s.helis.state[id]).toBe(HELI_DOWNED);
  });

  it('finds a Post in the bucket row above the helicopter', () => {
    const s = flat(128, 96);
    finished(s, STRUCT_POST, 50, 31); // bucket row 0
    const id = heli(s, 1, 50, 40, 0); // bucket row 1, 9 cells away
    airDefensePhase(s);
    expect(s.helis.hp[id]).toBe(HELI_HP_TENTHS - POST_AA_TENTHS_PER_TICK);
  });

  it('wraps the date line in both the distance and the bucket columns, in both directions', () => {
    for (const [px, hx] of [
      [3, 253],
      [253, 3],
    ] as const) {
      const s = flat(256, 64);
      finished(s, STRUCT_POST, px, 30);
      const id = heli(s, 1, hx, 30, 0);
      airDefensePhase(s);
      expect(s.helis.hp[id], `post ${px} heli ${hx}`).toBe(HELI_HP_TENTHS - POST_AA_TENTHS_PER_TICK);
    }
  });
});

describe('[2.4] the salvo clock is reset when a row is allocated and when it is freed', () => {
  it('a City built on the recycled row of a SAM starts at 0 and the state round-trips; the clock survives a conquest', () => {
    const s = flat(64, 64);
    const sam = finished(s, STRUCT_SAM, 10, 10);
    s.structures.salvoTick[sam] = s.tick + 50;
    s.structures.transfer(sam, 1, 1);
    expect(s.structures.salvoTick[sam]).toBe(s.tick + 50); // conquest keeps the clock
    s.structures.remove(sam);
    expect(s.structures.salvoTick[sam]).toBe(0); // reset on release
    s.structures.salvoTick[sam] = 77; // a stale value on the free row: the allocation must clear it by itself
    const city = s.structures.add(STRUCT_CITY, 1, 20 * 64 + 20, s.tick);
    expect(city).toBe(sam);
    expect(s.structures.salvoTick[city]).toBe(0);
    const r = deserialize(serialize(s), { maxElev: s.env.maxElev as Int16Array });
    expect(r.ok ? 'ok' : r.error).toBe('ok');
  });
});

describe('[2.13] a SAM kill wins over Post wear, the hit roll boundary and the fronts view', () => {
  it('a tick where a SAM hit and the last Post damage coincide is a SAM kill (cause SAM)', () => {
    const s = flat(128, 64, seedWithRoll(1, 0, true));
    finished(s, STRUCT_POST, 60, 34); // id 0
    const sam = finished(s, STRUCT_SAM, 60, 30); // id 1
    expect(sam).toBe(1);
    const id = heli(s, 1, 64, 32, 1);
    s.helis.hp[id] = POST_AA_TENTHS_PER_TICK; // the Post alone would finish it this tick
    s.outbox.clear();
    airDefensePhase(s);
    expect(s.helis.state[id]).toBe(HELI_DOWNED);
    const ev = s.outbox.drain().filter((e) => e.kind === OUTBOX_HELI_DOWNED);
    expect(ev.map((e) => e.b)).toEqual([HELI_DOWN_SAM]);
    // control: without the SAM the Post is the cause
    const t = flat(128, 64);
    finished(t, STRUCT_POST, 60, 34);
    const h2 = heli(t, 1, 64, 32, 1);
    t.helis.hp[h2] = POST_AA_TENTHS_PER_TICK;
    t.outbox.clear();
    airDefensePhase(t);
    expect(t.outbox.drain().filter((e) => e.kind === OUTBOX_HELI_DOWNED).map((e) => e.b)).toEqual([HELI_DOWN_POST]);
  });

  it('the hit count of 10 000 seeded rolls is exact: roll < SAM_HIT_PCT', () => {
    const s = flat(128, 64, 9);
    const sam = finished(s, STRUCT_SAM, 60, 30);
    const id = heli(s, 1, 66, 30, 1);
    let hits = 0;
    let expected = 0;
    for (let i = 0; i < 10000; i++) {
      s.tick = i;
      s.helis.state[id] = HELI_HOVER;
      s.structures.salvoTick[sam] = 0;
      airDefensePhase(s);
      if (s.helis.state[id] === HELI_DOWNED) hits++;
      if (samRoll(9, i, sam) < SAM_HIT_PCT) expected++;
      s.outbox.clear();
    }
    expect(hits).toBe(expected);
    expect(hits).toBe(HITS_OF_10000);
  });

  it('StateView.fronts is refreshed every tick (read before and after a step)', () => {
    const w = 120;
    const state = createState({ width: w, height: 64, seed: 3, seats: 2, players: 2, config: { debugIntents: false, spawnPhase: false }, terrain: new Uint8Array(w * 64).fill(CLASS_PLAINS), elevation: new Uint16Array(w * 64) });
    const host = new MainThreadHost(state);
    host.submitIntent({ kind: 'Spawn', seat: 0, cell: 32 * w + 40 });
    host.submitIntent({ kind: 'Spawn', seat: 1, cell: 32 * w + 52 });
    host.runTicks(300);
    host.submitIntent({ kind: 'Attack', seat: 0, target: seatToOwner(1), pct: 100 });
    host.runTicks(4);
    const live = new StateView(state);
    expect(live.fronts.count).toBe(1);
    host.submitIntent({ kind: 'CancelAttack', seat: 0, target: seatToOwner(1) });
    let ticks = 0;
    while (live.attackRunning(seatToOwner(0), seatToOwner(1)) && ticks < 200) {
      host.runTicks(1);
      ticks++;
    }
    expect(ticks).toBeLessThan(200);
    expect(live.fronts.count).toBe(0); // read once at the earlier tick (count 1), again after the attack ended
  });
});

/** Pinned: how many of the 10 000 rolls (match seed 9, ticks 0..9999, SAM id 0) are below SAM_HIT_PCT. */
const HITS_OF_10000 = 5497;
