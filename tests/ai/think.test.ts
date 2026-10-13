// AI v0: the memory, the place search and the decisions of think(), on small hand-made worlds with the real step function.
import { describe, expect, it } from 'vitest';
import { createAiMemory, pickSpawnCell, think, type AiMemory } from '../../src/ai';
import { IdAllocator, withId, type IntentBody } from '../../src/sim/intents';
import { ownerCapQt } from '../../src/sim/economy';
import {
  AI_ATTACK_COOLDOWN_TICKS,
  AI_EXPAND_COMMIT_PCT,
  AI_NATION_CLEARANCE_CELLS,
  AI_SPAWN_FIRST_TICK,
  AI_SPAWN_LAST_TICK,
  AI_SPAWN_RETRY_TICKS,
  AI_SPAWN_SPACING_TICKS,
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
  it('gives the 20 tribes one spawn tick each (3 ticks apart from 0) and the nations a seeded slice of the window each, in seat order, at least 3 ticks apart', () => {
    const state = world(64, 48, { seats: 26, players: 6 });
    const view = new StateView(state);
    const rng = createRng(5);
    const tribes = [] as number[];
    for (let seat = 6; seat < 26; seat++) tribes.push(createAiMemory(view, seat, rng).spawnAt);
    expect(tribes).toEqual(Array.from({ length: 20 }, (_, i) => i * AI_SPAWN_SPACING_TICKS));
    const nations = [1, 2, 3, 4, 5].map((seat) => createAiMemory(view, seat, rng));
    for (const m of nations) {
      expect(m.tribe).toBe(false);
      expect(m.spawnAt).toBeGreaterThanOrEqual(AI_SPAWN_FIRST_TICK);
      expect(m.spawnAt).toBeLessThanOrEqual(AI_SPAWN_LAST_TICK);
    }
    for (let i = 1; i < nations.length; i++) expect((nations[i] as AiMemory).spawnAt - (nations[i - 1] as AiMemory).spawnAt).toBeGreaterThanOrEqual(AI_SPAWN_SPACING_TICKS);
  });

  it('is a pure function of the stream: the same seed gives the same memories, another seed another spawn ticks', () => {
    const view = new StateView(world(64, 48, { seats: 26, players: 6 }));
    const ticks = (seed: number): number[] => {
      const rng = createRng(seed);
      return [1, 2, 3, 4, 5].map((s) => createAiMemory(view, s, rng).spawnAt);
    };
    expect(ticks(9)).toEqual(ticks(9));
    expect(ticks(9)).not.toEqual(ticks(10));
  });

  it('staggers the thinking ticks of neighbouring seats', () => {
    const view = new StateView(world(64, 48, { seats: 26, players: 6 }));
    const rng = createRng(1);
    const phases = [1, 2, 3, 4, 5].map((s) => createAiMemory(view, s, rng).phase);
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

describe('think: the spawn', () => {
  it('does nothing before its tick, spawns on its tick, waits for the capital and tries another place when none appears', () => {
    const state = world(160, 96, { seats: 3, players: 2 });
    const view = new StateView(state);
    const rng = createRng(2);
    const m = createAiMemory(view, 1, rng);
    run(state, m.spawnAt - 1);
    view.refresh();
    expect(think(view, m, rng)).toEqual([]);
    run(state, m.spawnAt);
    view.refresh();
    const first = think(view, m, rng);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ kind: 'Spawn', seat: 1 });
    // Asked again before the capital can exist, it waits.
    expect(think(view, m, rng)).toEqual([]);
    run(state, m.spawnAt + AI_SPAWN_RETRY_TICKS);
    view.refresh();
    const retry = think(view, m, rng);
    expect(retry).toHaveLength(1);
    expect((retry[0] as { cell: number }).cell).not.toBe((first[0] as { cell: number }).cell);
    expect(m.attempts).toBe(2);
  });

  it('after the spawn it sends nothing during the rest of the spawn phase, and never spawns again', () => {
    const state = world(160, 96, { seats: 3, players: 2 });
    const view = new StateView(state);
    const rng = createRng(2);
    const m = createAiMemory(view, 1, rng);
    run(state, m.spawnAt);
    view.refresh();
    const spawn = think(view, m, rng)[0] as IntentBody;
    run(state, state.tick + 1, { [state.tick]: [spawn] });
    for (let t = state.tick; t < 200; t++) {
      run(state, t + 1);
      view.refresh();
      expect(think(view, m, rng), `tick ${t}`).toEqual([]);
    }
  });

  it('a tribe spawns at the tick of its number with the smaller clearance', () => {
    const state = world(160, 96, { seats: 6, players: 2 });
    const view = new StateView(state);
    const rng = createRng(1);
    const m = createAiMemory(view, 4, rng);
    expect(m.tribe).toBe(true);
    expect(m.spawnAt).toBe(2 * AI_SPAWN_SPACING_TICKS);
    run(state, m.spawnAt);
    view.refresh();
    expect(think(view, m, rng)[0]).toMatchObject({ kind: 'Spawn', seat: 4 });
  });

  it('gives up quietly when the spawn phase is over without a capital', () => {
    const state = world(160, 96, { seats: 3, players: 2 });
    const view = new StateView(state);
    const rng = createRng(2);
    const m = createAiMemory(view, 1, rng);
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
  return { state, view, a: createAiMemory(view, 1, rng), b: createAiMemory(view, 2, rng), rng };
}

describe('think: expansion and war', () => {
  it('sends nothing below the troop threshold, and expands into unowned land at it with 60 to 80 percent', () => {
    const { state, view, a, rng } = twoNations(60);
    run(state, 255);
    toThinkTick(state, a);
    const owner = seatToOwner(1);
    state.troops[owner] = Math.floor(ownerCapQt(state, owner) / 2) - 8;
    view.refresh();
    expect(think(view, a, rng)).toEqual([]);
    state.troops[owner] = Math.floor(ownerCapQt(state, owner) / 2) + 4;
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
    const b2 = createAiMemory(view, 1, createRng(3));
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
    const m = createAiMemory(view, 1, rng);
    toThinkTick(state, m);
    const me = seatToOwner(1);
    state.troops[me] = ownerCapQt(state, me);
    state.troops[seatToOwner(2)] = 900;
    state.troops[seatToOwner(3)] = 700;
    view.refresh();
    expect(view.contactLength(me, seatToOwner(2))).toBeGreaterThan(0);
    expect(view.contactLength(me, seatToOwner(3))).toBeGreaterThan(0);
    expect((think(view, m, rng)[0] as { target: number }).target).toBe(seatToOwner(3));
    const tie = createAiMemory(view, 1, createRng(3));
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
      const m = createAiMemory(view, seat, rng);
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
    const t = createAiMemory(view, 2, rng);
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
