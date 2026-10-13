// AI v0: the memory, the place search and the decisions of think(), on small hand-made worlds with the real step function.
import { describe, expect, it } from 'vitest';
import { createAiMemory, pickSpawnCell, think, type AiMemory } from '../../src/ai';
import { IdAllocator, withId, type IntentBody } from '../../src/sim/intents';
import { ownerCapQt } from '../../src/sim/economy';
import {
  AI_ATTACK_COOLDOWN_TICKS,
  AI_EXPAND_COMMIT_PCT,
  AI_EXPAND_TROOP_PCT,
  AI_NATION_CLEARANCE_CELLS,
  AI_NATION_REACH_CELLS,
  AI_SPAWN_RETRY_TICKS,
  AI_SPAWN_SPACING_TICKS,
  AI_SPAWN_WAIT_TICKS,
  AI_TRIBE_REACH_CELLS,
  AI_THINK_PERIOD_TICKS,
  AI_TRIBE_COOLDOWN_TICKS,
  AI_TRIBE_MAX_CELLS,
  AI_WAR_COMMIT_PCT,
  START_DISC_RADIUS_CELLS,
} from '../../src/sim/rules';
import { createRng } from '../../src/sim/rng';
import { createState, seatToOwner, type GameState } from '../../src/sim/state';
import { step } from '../../src/sim/step';
import { CLASS_DEEP_SEA, CLASS_PLAINS } from '../../src/sim/terrain';
import { StateView } from '../../src/sim/view';

const R = START_DISC_RADIUS_CELLS;

interface Opts {
  seats: number;
  players: number;
  classAt?: (x: number, y: number) => number;
}

/** A match-flow world (spawnPhase on) of Plains unless `classAt` says otherwise. */
function world(width: number, height: number, o: Opts, seed = 1): GameState {
  const terrain = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) terrain[y * width + x] = o.classAt ? o.classAt(x, y) : CLASS_PLAINS;
  return createState({
    width,
    height,
    seed,
    seats: o.seats,
    players: o.players,
    config: { debugIntents: false, spawnPhase: true },
    terrain,
    elevation: new Uint16Array(width * height),
  });
}

/** Runs the sim to `tick`, sending `scripted` (tick -> bodies) on the way. Intents run the tick they are sent for (the test calls step directly). */
function run(state: GameState, tick: number, scripted: Record<number, IntentBody[]> = {}): void {
  const ids = new IdAllocator();
  while (state.tick < tick) {
    const bodies = scripted[state.tick] ?? [];
    const r = step(state, { turn: state.tick, intents: bodies.map((b) => withId(b, ids.alloc(b.seat))) });
    if (!r.ok) throw new Error(r.error);
    state.outbox.clear();
  }
}

/** Steps until `memory` thinks (tick + phase is a multiple of the period). */
function toThinkTick(state: GameState, memory: AiMemory): void {
  while ((state.tick + memory.phase) % AI_THINK_PERIOD_TICKS !== 0) run(state, state.tick + 1);
}

describe('createAiMemory', () => {
  it('orders the spawns: the five nations first, then the 20 tribes, AI_SPAWN_SPACING_TICKS apart, none released yet', () => {
    const view = new StateView(world(64, 48, { seats: 26, players: 6 }));
    const memories = Array.from({ length: 25 }, (_, i) => createAiMemory(view, i + 1));
    expect(memories.map((m) => m.slot)).toEqual(Array.from({ length: 25 }, (_, i) => i * AI_SPAWN_SPACING_TICKS));
    expect(memories.map((m) => m.tribe)).toEqual(Array.from({ length: 25 }, (_, i) => i >= 5));
    for (const m of memories) {
      expect(m.release).toBe(-1);
      expect(m.attempts).toBe(0);
      expect(m.lastAttack).toHaveLength(27);
    }
  });

  it('the last tribe is down before the spawn phase ends even when the wait runs out (a release at the wait limit)', () => {
    const view = new StateView(world(64, 48, { seats: 26, players: 6 }));
    const last = createAiMemory(view, 25);
    expect(AI_SPAWN_WAIT_TICKS + last.slot + AI_SPAWN_RETRY_TICKS).toBeLessThan(200);
  });

  it('staggers the thinking ticks of neighbouring seats', () => {
    const view = new StateView(world(64, 48, { seats: 26, players: 6 }));
    const phases = [1, 2, 3, 4, 5].map((s) => createAiMemory(view, s).phase);
    expect(new Set(phases).size).toBe(5);
    for (const p of phases) expect(p).toBeLessThan(AI_THINK_PERIOD_TICKS);
  });
});

describe('pickSpawnCell', () => {
  it('returns a cell with a whole capital disc of playable land around it that the sim accepts, and is deterministic in the stream', () => {
    const state = world(160, 96, { seats: 4, players: 4 }, 3);
    const view = new StateView(state);
    for (let seed = 1; seed <= 20; seed++) {
      const cell = pickSpawnCell(view, createRng(seed), AI_NATION_CLEARANCE_CELLS);
      expect(cell).toBeGreaterThanOrEqual(0);
      expect(pickSpawnCell(view, createRng(seed), AI_NATION_CLEARANCE_CELLS)).toBe(cell);
      const x = cell % 160;
      const y = (cell - x) / 160;
      expect(y).toBeGreaterThanOrEqual(R);
      expect(y).toBeLessThan(96 - R);
    }
    // The sim takes a Spawn on the chosen cell and claims a full disc.
    const cell = pickSpawnCell(view, createRng(4), AI_NATION_CLEARANCE_CELLS);
    run(state, 3, { 0: [{ kind: 'Spawn', seat: 0, cell }] });
    expect(state.rejects).toBe(0);
    expect(state.agg.area[seatToOwner(0)]).toBe(197);
  });

  it('keeps its distance from Spawns that are still in flight (sent, not yet run), as it does from owned land', () => {
    const state = world(160, 96, { seats: 4, players: 4 });
    const view = new StateView(state);
    const flying = 48 * 160 + 80; // nothing owns it yet: only the caller knows that a Spawn is on its way there
    for (let seed = 1; seed <= 30; seed++) {
      const free = pickSpawnCell(view, createRng(seed), AI_NATION_CLEARANCE_CELLS);
      expect(free).toBeGreaterThanOrEqual(0);
      const cell = pickSpawnCell(view, createRng(seed), AI_NATION_CLEARANCE_CELLS, -1, 0, [free, flying]);
      expect(cell, `seed ${seed}`).toBeGreaterThanOrEqual(0);
      for (const avoid of [free, flying]) {
        const dx = Math.abs((cell % 160) - (avoid % 160));
        const dy = Math.abs(Math.floor(cell / 160) - Math.floor(avoid / 160));
        expect(Math.max(Math.min(dx, 160 - dx), dy), `seed ${seed} against ${avoid}`).toBeGreaterThanOrEqual(R + 2);
      }
    }
    // with nothing in flight the pick is the one without the argument (the argument costs nothing)
    expect(pickSpawnCell(view, createRng(7), AI_NATION_CLEARANCE_CELLS, -1, 0, [])).toBe(pickSpawnCell(view, createRng(7), AI_NATION_CLEARANCE_CELLS));
  });

  it('keeps its distance from owned land, and chooses other places for other streams', () => {
    const state = world(160, 96, { seats: 4, players: 4 });
    run(state, 3, { 0: [{ kind: 'Spawn', seat: 0, cell: 48 * 160 + 80 }] });
    const view = new StateView(state);
    const seen = new Set<number>();
    for (let seed = 1; seed <= 30; seed++) {
      const cell = pickSpawnCell(view, createRng(seed), AI_NATION_CLEARANCE_CELLS);
      const x = cell % 160;
      const y = (cell - x) / 160;
      const dx = Math.min(Math.abs(x - 80), 160 - Math.abs(x - 80));
      expect(Math.max(dx, Math.abs(y - 48)), `seed ${seed}`).toBeGreaterThan(AI_NATION_CLEARANCE_CELLS - 1);
      seen.add(cell);
    }
    expect(seen.size).toBeGreaterThan(20);
  });

  it('with an anchor it stays within the reach of it, with no anchor it uses the whole map, and a human on a small island does not leave it without a capital', () => {
    const view = new StateView(world(400, 200, { seats: 4, players: 4 }));
    const anchor = 100 * 400 + 200;
    const far = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) {
      const cell = pickSpawnCell(view, createRng(seed), 14, anchor, AI_TRIBE_REACH_CELLS);
      const x = cell % 400;
      const y = (cell - x) / 400;
      expect(Math.max(Math.min(Math.abs(x - 200), 400 - Math.abs(x - 200)), Math.abs(y - 100)), `seed ${seed}`).toBeLessThanOrEqual(AI_TRIBE_REACH_CELLS);
      const free = pickSpawnCell(view, createRng(seed), 14);
      far.add(Math.max(Math.abs((free % 400) - 200), 0));
    }
    expect(Math.max(...far)).toBeGreaterThan(AI_NATION_REACH_CELLS);
    // The anchor sits on a 30 x 30 island; the only other land is 150 cells away: the second half of the tries finds it.
    const islands = world(400, 200, { seats: 4, players: 4, classAt: (x, y) => ((x >= 185 && x < 215 && y >= 85 && y < 115) || (x >= 20 && x < 90 && y >= 40 && y < 110) ? CLASS_PLAINS : CLASS_DEEP_SEA) });
    const cell = pickSpawnCell(new StateView(islands), createRng(2), 14, 100 * 400 + 200, AI_TRIBE_REACH_CELLS);
    expect(cell).toBeGreaterThanOrEqual(0);
  });

  it('finds nothing on a world of sea, or of islands smaller than a capital disc, and a crowded map relaxes the clearance instead of failing', () => {
    expect(pickSpawnCell(new StateView(world(160, 96, { seats: 2, players: 2, classAt: () => CLASS_DEEP_SEA })), createRng(1), 28)).toBe(-1);
    const specks = world(160, 96, { seats: 2, players: 2, classAt: (x, y) => (x % 12 < 6 && y % 12 < 6 ? CLASS_PLAINS : CLASS_DEEP_SEA) });
    expect(pickSpawnCell(new StateView(specks), createRng(1), 28)).toBe(-1);
    // One continent of 56 x 40 cells holding a capital in its middle: a clearance of 28 fits nowhere else, half of it does.
    const small = world(160, 96, { seats: 2, players: 2, classAt: (x, y) => (x >= 20 && x < 76 && y >= 28 && y < 68 ? CLASS_PLAINS : CLASS_DEEP_SEA) });
    run(small, 3, { 0: [{ kind: 'Spawn', seat: 0, cell: 48 * 160 + 28 }] });
    const cell = pickSpawnCell(new StateView(small), createRng(1), AI_NATION_CLEARANCE_CELLS);
    expect(cell).toBeGreaterThanOrEqual(0);
  });
});

/** A 160 x 96 match with the human (seat 0) spawned at the centre when `human`, and the AI seats 1.. as `players` / `seats` say. */
function spawnWorld(seats: number, players: number, human: boolean): { state: GameState; view: StateView; rng: Uint32Array } {
  const state = world(160, 96, { seats, players });
  if (human) run(state, 3, { 0: [{ kind: 'Spawn', seat: 0, cell: 48 * 160 + 80 }] });
  return { state, view: new StateView(state), rng: createRng(2) };
}

describe('think: the spawn', () => {
  it('waits for the human capital; once it exists the nations Spawn one after the other near it, a nation first, then a tribe 3 ticks later', () => {
    const { state, view, rng } = spawnWorld(3, 2, false);
    const nation = createAiMemory(view, 1);
    const tribe = createAiMemory(view, 2);
    for (let t = 0; t < 40; t++) {
      view.refresh();
      expect(think(view, nation, rng), `tick ${state.tick}`).toEqual([]);
      run(state, state.tick + 1);
    }
    // the human spawns (a direct step runs its intent on the tick it is sent for); the capital shows from the next tick on
    run(state, 41, { 40: [{ kind: 'Spawn', seat: 0, cell: 48 * 160 + 80 }] });
    view.refresh();
    const first = think(view, nation, rng);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ kind: 'Spawn', seat: 1 });
    expect(nation.release).toBe(41);
    const cellOf = (b: IntentBody): { x: number; y: number } => {
      const c = (b as { cell: number }).cell;
      return { x: c % 160, y: Math.floor(c / 160) };
    };
    const near = cellOf(first[0] as IntentBody);
    expect(Math.max(Math.abs(near.x - 80), Math.abs(near.y - 48))).toBeLessThanOrEqual(AI_NATION_REACH_CELLS);
    // the tribe has the slot after the nation's
    expect(think(view, tribe, rng)).toEqual([]);
    run(state, 41 + AI_SPAWN_SPACING_TICKS - 1);
    view.refresh();
    expect(think(view, tribe, rng)).toEqual([]);
    run(state, 41 + AI_SPAWN_SPACING_TICKS);
    view.refresh();
    const second = think(view, tribe, rng);
    expect(second[0]).toMatchObject({ kind: 'Spawn', seat: 2 });
    const t = cellOf(second[0] as IntentBody);
    expect(Math.max(Math.abs(t.x - 80), Math.abs(t.y - 48))).toBeLessThanOrEqual(AI_TRIBE_REACH_CELLS);
  });

  it('without a human capital it goes ahead at AI_SPAWN_WAIT_TICKS, anywhere on the map', () => {
    const { state, view, rng } = spawnWorld(3, 2, false);
    const m = createAiMemory(view, 1);
    run(state, AI_SPAWN_WAIT_TICKS - 1);
    view.refresh();
    expect(think(view, m, rng)).toEqual([]);
    run(state, AI_SPAWN_WAIT_TICKS);
    view.refresh();
    const out = think(view, m, rng);
    expect(out).toHaveLength(1);
    expect(m.release).toBe(AI_SPAWN_WAIT_TICKS);
  });

  it('waits for the capital to show up and tries another place when none appears', () => {
    const { state, view, rng } = spawnWorld(3, 2, true);
    const m = createAiMemory(view, 1);
    view.refresh();
    const first = think(view, m, rng);
    expect(first).toHaveLength(1);
    // Asked again before the capital can exist, it waits.
    run(state, state.tick + 1);
    view.refresh();
    expect(think(view, m, rng)).toEqual([]);
    run(state, 3 + AI_SPAWN_RETRY_TICKS);
    view.refresh();
    const retry = think(view, m, rng);
    expect(retry).toHaveLength(1);
    expect((retry[0] as { cell: number }).cell).not.toBe((first[0] as { cell: number }).cell);
    expect(m.attempts).toBe(2);
  });

  it('after the spawn it sends nothing during the rest of the spawn phase, and never spawns again', () => {
    const { state, view, rng } = spawnWorld(3, 2, true);
    const m = createAiMemory(view, 1);
    view.refresh();
    const spawn = think(view, m, rng)[0] as IntentBody;
    run(state, state.tick + 1, { [state.tick]: [spawn] });
    for (let t = state.tick; t < 200; t++) {
      run(state, t + 1);
      view.refresh();
      expect(think(view, m, rng), `tick ${t}`).toEqual([]);
    }
  });

  it('gives up quietly when the spawn phase is over without a capital', () => {
    const { state, view, rng } = spawnWorld(3, 2, false);
    const m = createAiMemory(view, 1);
    run(state, 260);
    view.refresh();
    expect(think(view, m, rng)).toEqual([]);
  });
});

/** Two AI nations side by side (their discs touch) plus a human seat 0 that never acts; both spawned at tick 2. Returns the state and the views. */
function twoNations(gapX = 16): { state: GameState; view: StateView; a: AiMemory; b: AiMemory; rng: Uint32Array } {
  const state = world(120, 64, { seats: 3, players: 3 });
  const view = new StateView(state);
  const rng = createRng(3);
  run(state, 3, {
    0: [
      { kind: 'Spawn', seat: 1, cell: 32 * 120 + 40 },
      { kind: 'Spawn', seat: 2, cell: 32 * 120 + 40 + gapX },
    ],
  });
  return { state, view, a: createAiMemory(view, 1), b: createAiMemory(view, 2), rng };
}

describe('think: expansion and war', () => {
  it('sends nothing below the troop threshold, and expands into unowned land at it with 60 to 80 percent', () => {
    const { state, view, a, rng } = twoNations(60);
    run(state, 255);
    toThinkTick(state, a);
    const owner = seatToOwner(1);
    state.troops[owner] = Math.floor((ownerCapQt(state, owner) * AI_EXPAND_TROOP_PCT) / 100) - 8;
    view.refresh();
    expect(think(view, a, rng)).toEqual([]);
    state.troops[owner] = Math.floor((ownerCapQt(state, owner) * AI_EXPAND_TROOP_PCT) / 100) + 4;
    view.refresh();
    const out = think(view, a, rng);
    expect(out).toHaveLength(1);
    const body = out[0] as { kind: string; seat: number; target: number; pct: number };
    expect(body).toMatchObject({ kind: 'Attack', seat: 1, target: 0 });
    expect(body.pct).toBeGreaterThanOrEqual(AI_EXPAND_COMMIT_PCT - 10);
    expect(body.pct).toBeLessThanOrEqual(AI_EXPAND_COMMIT_PCT + 10);
    expect(body.pct % 5).toBe(0);
  });

  it('thinks only on its own ticks', () => {
    const { state, view, a, rng } = twoNations(60);
    run(state, 255);
    const owner = seatToOwner(1);
    state.troops[owner] = ownerCapQt(state, owner);
    let thoughts = 0;
    for (let t = 0; t < 40; t++) {
      run(state, state.tick + 1);
      state.troops[owner] = ownerCapQt(state, owner);
      view.refresh();
      a.lastAttack.fill(-1);
      if (think(view, a, rng).length > 0) {
        thoughts++;
        expect((state.tick + a.phase) % AI_THINK_PERIOD_TICKS).toBe(0);
      }
    }
    expect(thoughts).toBe(4);
  });

  it('attacks the neighbour it outnumbers by the margin, with 40 to 60 percent, and expands when it does not', () => {
    const { state, view, a, rng } = twoNations();
    run(state, 255);
    toThinkTick(state, a);
    const [mine, theirs] = [seatToOwner(1), seatToOwner(2)];
    expect(view.contactLength(mine, theirs)).toBeGreaterThan(0);
    state.troops[mine] = ownerCapQt(state, mine);
    state.troops[theirs] = Math.floor((ownerCapQt(state, mine) * 100) / 140);
    view.refresh();
    const war = think(view, a, rng)[0] as { target: number; pct: number };
    expect(war.target).toBe(theirs);
    expect(war.pct).toBeGreaterThanOrEqual(AI_WAR_COMMIT_PCT - 10);
    expect(war.pct).toBeLessThanOrEqual(AI_WAR_COMMIT_PCT + 10);
    // Fresh memory, the neighbour is now stronger than the margin allows: no war, expansion instead.
    const b2 = createAiMemory(view, 1);
    state.troops[theirs] = Math.floor((ownerCapQt(state, mine) * 100) / 110);
    view.refresh();
    expect((think(view, b2, rng)[0] as { target: number }).target).toBe(0);
  });

  it('picks the WEAKEST of several neighbours, ties to the lower owner id', () => {
    const state = world(160, 64, { seats: 4, players: 4 });
    const view = new StateView(state);
    const rng = createRng(3);
    run(state, 3, {
      0: [
        { kind: 'Spawn', seat: 1, cell: 32 * 160 + 80 },
        { kind: 'Spawn', seat: 2, cell: 32 * 160 + 96 },
        { kind: 'Spawn', seat: 3, cell: 32 * 160 + 64 },
      ],
    });
    run(state, 255);
    const m = createAiMemory(view, 1);
    toThinkTick(state, m);
    const me = seatToOwner(1);
    state.troops[me] = ownerCapQt(state, me);
    state.troops[seatToOwner(2)] = 900;
    state.troops[seatToOwner(3)] = 700;
    view.refresh();
    expect(view.contactLength(me, seatToOwner(2))).toBeGreaterThan(0);
    expect(view.contactLength(me, seatToOwner(3))).toBeGreaterThan(0);
    expect((think(view, m, rng)[0] as { target: number }).target).toBe(seatToOwner(3));
    const tie = createAiMemory(view, 1);
    state.troops[seatToOwner(2)] = 700;
    view.refresh();
    expect((think(view, tie, rng)[0] as { target: number }).target).toBe(seatToOwner(2));
  });

  it('does not attack the same target again within the cooldown, and does again after it', () => {
    const { state, view, a, rng } = twoNations();
    run(state, 255);
    toThinkTick(state, a);
    const me = seatToOwner(1);
    const fill = (): void => {
      state.troops[me] = ownerCapQt(state, me);
      state.troops[seatToOwner(2)] = 100;
      view.refresh();
    };
    fill();
    expect((think(view, a, rng)[0] as { target: number }).target).toBe(seatToOwner(2));
    let next = -1;
    for (let t = 0; t < 4; t++) {
      run(state, state.tick + AI_THINK_PERIOD_TICKS);
      fill();
      const out = think(view, a, rng);
      if (out.length > 0 && (out[0] as { target: number }).target === seatToOwner(2)) {
        next = t;
        break;
      }
    }
    // The first thought after 10, 20, 30 ticks is on cooldown (40 ticks); the one 40 ticks later attacks again.
    expect(next * AI_THINK_PERIOD_TICKS + AI_THINK_PERIOD_TICKS).toBeGreaterThanOrEqual(AI_ATTACK_COOLDOWN_TICKS);
  });

  it('waits out the cooldown between two expansions too (a nation 40 ticks, a tribe 100)', () => {
    const cases: Array<[string, number, number]> = [
      ['nation', 1, AI_ATTACK_COOLDOWN_TICKS],
      ['tribe', 3, AI_TRIBE_COOLDOWN_TICKS],
    ];
    for (const [name, seat, cooldown] of cases) {
      const state = world(160, 64, { seats: 4, players: 3 });
      const view = new StateView(state);
      const rng = createRng(3);
      run(state, 3, { 0: [{ kind: 'Spawn', seat, cell: 32 * 160 + 80 }] });
      run(state, 255);
      const m = createAiMemory(view, seat);
      toThinkTick(state, m);
      const me = seatToOwner(seat);
      const fill = (): void => {
        state.troops[me] = ownerCapQt(state, me);
        view.refresh();
      };
      fill();
      expect(think(view, m, rng), name).toHaveLength(1);
      const first = state.tick;
      let again = -1;
      for (let i = 0; i < 20 && again < 0; i++) {
        run(state, state.tick + AI_THINK_PERIOD_TICKS);
        fill();
        if (think(view, m, rng).length > 0) again = state.tick - first;
      }
      expect(again, name).toBe(cooldown);
    }
  });

  it('does not attack another seat during the immunity (unowned land is still fine)', () => {
    const { state, view, a, rng } = twoNations();
    run(state, 205);
    toThinkTick(state, a);
    expect(state.tick).toBeLessThan(250);
    const me = seatToOwner(1);
    state.troops[me] = ownerCapQt(state, me);
    state.troops[seatToOwner(2)] = 100;
    view.refresh();
    expect((think(view, a, rng)[0] as { target: number }).target).toBe(0);
  });

  it('does nothing without land and does not act in the spawn phase', () => {
    const { state, view, a, rng } = twoNations();
    run(state, 150);
    toThinkTick(state, a);
    state.troops[seatToOwner(1)] = ownerCapQt(state, seatToOwner(1));
    view.refresh();
    expect(think(view, a, rng)).toEqual([]);
  });
});

describe('think: tribes', () => {
  function tribeWorld(): { state: GameState; view: StateView; t: AiMemory; rng: Uint32Array } {
    const state = world(120, 64, { seats: 4, players: 2 });
    const view = new StateView(state);
    const rng = createRng(3);
    run(state, 3, {
      0: [
        { kind: 'Spawn', seat: 1, cell: 32 * 120 + 40 },
        { kind: 'Spawn', seat: 2, cell: 32 * 120 + 56 },
      ],
    });
    run(state, 255);
    const t = createAiMemory(view, 2);
    toThinkTick(state, t);
    return { state, view, t, rng };
  }

  it('expands into unowned land, never attacks another seat even when it could', () => {
    const { state, view, t, rng } = tribeWorld();
    const me = seatToOwner(2);
    state.troops[me] = ownerCapQt(state, me);
    state.troops[seatToOwner(1)] = 4;
    view.refresh();
    expect(view.contactLength(me, seatToOwner(1))).toBeGreaterThan(0);
    expect(t.tribe).toBe(true);
    const out = think(view, t, rng);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'Attack', seat: 2, target: 0 });
  });

  it('stops expanding at AI_TRIBE_MAX_CELLS', () => {
    const { state, view, t, rng } = tribeWorld();
    const me = seatToOwner(2);
    state.troops[me] = ownerCapQt(state, me);
    expect(state.agg.area[me]).toBeLessThan(AI_TRIBE_MAX_CELLS);
    view.refresh();
    expect(think(view, t, rng)).toHaveLength(1);
    // Fake a big tribe through the statistics the AI reads: grow it with a long run of its own attacks.
    for (let i = 0; i < 4000 && (state.agg.area[me] as number) < AI_TRIBE_MAX_CELLS; i++) {
      run(state, state.tick + 1, { [state.tick]: state.tick % 10 === 0 ? [{ kind: 'Attack', seat: 2, target: 0, pct: 100 }] : [] });
      state.troops[me] = ownerCapQt(state, me);
    }
    expect(state.agg.area[me]).toBeGreaterThanOrEqual(AI_TRIBE_MAX_CELLS);
    toThinkTick(state, t);
    t.lastAttack.fill(-1);
    view.refresh();
    expect(think(view, t, rng)).toEqual([]);
  });
});
