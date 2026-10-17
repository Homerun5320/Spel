// Ctx-1: the right-click menu MODEL (src/app/contextActions.ts) against the real validators. Every entry's state and reason code is compared with the validator it comes from (one parity test per entry
// type), the choice of the Factory / Port is checked against `validateLaunchHeli` / `validateLaunchShip`, the omitted entries are the ones the sim says can never apply, and the provider hook adds an entry.
// The mutants listed in DECISIONS "Ctx-1" were each run against this file: ("first accepting Factory", "diplomacy never-applies list", "attack gate", "build parity").
import { describe, expect, it } from 'vitest';
import { contextActionsFor, pickFactory, pickPort, registerContextProvider, type ContextEntry, type ContextModel, type ContextOptions } from '../../src/app/contextActions';
import { createLos, createLosTerrain, createNav, validateBuild, validateLaunchHeli, validateLaunchShip, validateUpgrade, validateProposeTreaty, validateBreakTreaty, validateImposeEmbargo, validateProduceHeli, type Nav } from '../../src/sim/public';
import { produceHeliBody, withId, validateIntent, type IntentBody } from '../../src/sim/intents';
import { REJECT_BUILD_GOLD, REJECT_DIPLO_TREATY_BOUND, REJECT_HELI_NO_FACTORY, REJECT_HELI_NO_PAD, REJECT_SHIP_NO_PORT, REJECT_SHIP_NO_ROUTE, REJECT_STRUCT_BUSY } from '../../src/sim/public';
import { AI_WAR_START_TICKS, BUILD_TICKS, HELI_BUILD_TICKS, MILLI_GOLD_PER_GOLD, QT_PER_TROOP } from '../../src/sim/rules';
import { applyIntent, step } from '../../src/sim/step';
import { createState, rebuildAggregates, type GameState } from '../../src/sim/state';
import { STRUCT_CITY, STRUCT_FACTORY, STRUCT_PORT } from '../../src/sim/structureRules';
import { CLASS_DEEP_SEA, CLASS_PLAINS } from '../../src/sim/terrain';
import { setOwner } from '../../src/sim/territory';
import { StateView } from '../../src/sim/view';
import { rejectKey } from '../../src/ui/hudLogic';
import { t, TABLES } from '../../src/ui/i18n';
import { SHIP_W, shipFixture } from '../../tools/sim/shipLanding';
import { landState } from '../sim/helpers/worlds';

const NAMES = ['Aland', 'Brand', 'Cora'];
const OPTS: ContextOptions = { nameOf: (s) => NAMES[s] ?? `Seat${s}`, commitPct: 40, nav: null, heliTroops: 10, heliMode: 0 };
const mk = (s: GameState): StateView => {
  const v = new StateView(s);
  v.refresh();
  return v;
};
let ids = 1;
function send(s: GameState, body: IntentBody): number {
  const i = withId(body, ids++);
  const shape = validateIntent(i, { seats: s.header.seats, cells: s.width * s.height, debugIntents: true });
  return shape !== 0 ? shape : applyIntent(s, i);
}
const ids_ = (m: ContextModel): string[] => m.entries.map((e) => e.id);
const byId = (m: ContextModel, id: string): ContextEntry => {
  const e = m.entries.find((x) => x.id === id);
  if (e === undefined) throw new Error(`no entry ${id} in ${ids_(m).join(',')}`);
  return e;
};

/** 100 x 10 plains: seat 0 owns columns 0..29, seat 1 columns 30..59, a neutral strip 60..79, a tribe (seat 3) 80..89, seat 2 90..99. 3 players + 1 tribe. */
function arena(): GameState {
  const s = landState(100, 10, { seats: 4, players: 3, debug: true });
  const owners: Array<[number, number, number]> = [
    [0, 29, 1],
    [30, 59, 2],
    [80, 89, 4],
    [90, 99, 3],
  ];
  for (const [a, b, o] of owners) for (let x = a; x <= b; x++) for (let y = 0; y < 10; y++) setOwner(s, y * 100 + x, o, 0);
  s.troops[1] = 1000 * QT_PER_TROOP;
  s.gold[1] = 100000 * MILLI_GOLD_PER_GOLD;
  s.capital[1] = 5 * 100 + 5 + 1;
  s.capital[2] = 5 * 100 + 45 + 1;
  s.capital[3] = 5 * 100 + 95 + 1;
  s.tick = AI_WAR_START_TICKS + 1000;
  return s;
}
const cellAt = (x: number, y = 5): number => y * 100 + x;

describe('who gets a menu', () => {
  it('sea and unspawned seats get none (the page toasts), playable land always gets one', () => {
    const s = landState(20, 4, { seats: 2, classAt: (x) => (x < 10 ? CLASS_PLAINS : CLASS_DEEP_SEA) });
    s.owner.fill(0);
    for (let c = 0; c < 80; c++) if (c % 20 < 10) setOwner(s, c, 1, 0);
    expect(contextActionsFor(mk(s), 0, { cell: 3, structure: -1 }, OPTS).blocked).toBe('not-spawned');
    s.capital[1] = 4;
    const v = mk(s);
    expect(contextActionsFor(v, 0, { cell: 15, structure: -1 }, OPTS)).toMatchObject({ blocked: 'unplayable', entries: [] });
    const own = contextActionsFor(v, 0, { cell: 3, structure: -1 }, OPTS);
    expect(own.blocked).toBeNull();
    expect(own.entries.length).toBe(9);
  });
});

describe('another nation\'s or neutral land', () => {
  it('neutral land: attack, helicopter, ship; no diplomacy group; a tribe is treated like neutral land', () => {
    const v = mk(arena());
    for (const x of [70, 85]) {
      const m = contextActionsFor(v, 0, { cell: cellAt(x), structure: -1 }, OPTS);
      expect(ids_(m)).toEqual(['attack', 'deployHere', 'shipHere']);
      expect(m.groups.map((g) => g.id)).toEqual(['act']);
      expect(m.title.key).toBe('ctx.title.land');
    }
  });

  it('a nation: the diplomacy group with its name; at war: truce, alliance and embargo (no break, there is nothing to break)', () => {
    const v = mk(arena());
    const m = contextActionsFor(v, 0, { cell: cellAt(40), structure: -1 }, OPTS);
    expect(ids_(m)).toEqual(['attack', 'deployHere', 'shipHere', 'diplo-truce', 'diplo-alliance', 'diplo-embargo']);
    expect(m.groups.map((g) => g.id)).toEqual(['act', 'diplo']);
    expect(m.groups[1]).toMatchObject({ titleKey: 'ctx.group.diplo', params: { name: 'Brand' }, keyHint: 'D', open: false });
    expect(m.title).toEqual({ key: 'ctx.title.nation', params: { name: 'Brand' } });
  });

  it('PARITY (diplomacy): every diplomacy entry\'s state and reason is the very button state of the panel, per relation', () => {
    const s = arena();
    const check = (label: string): ContextModel => {
      const v = mk(s);
      const m = contextActionsFor(v, 0, { cell: cellAt(40), structure: -1 }, OPTS);
      const want: Record<string, number> = {
        'diplo-truce': validateProposeTreaty(v, 0, 1, 1),
        'diplo-alliance': validateProposeTreaty(v, 0, 1, 2),
        'diplo-break': validateBreakTreaty(v, 0, 1),
        'diplo-embargo': validateImposeEmbargo(v, 0, 1),
      };
      for (const e of m.entries.filter((x) => x.group === 'diplo')) {
        expect(e.state === 'ok', `${label} ${e.id}`).toBe(want[e.id] === 0);
        expect(e.reasonCode ?? 0, `${label} ${e.id} code`).toBe(want[e.id]);
        if (want[e.id] !== 0) expect(e.reasonKey, `${label} ${e.id} key`).toBe(rejectKey(want[e.id] as number));
      }
      return m;
    };
    check('war');
    expect(send(s, { kind: 'ProposeTreaty', seat: 1, to: 0, treaty: 1 })).toBe(0);
    expect(send(s, { kind: 'AcceptTreaty', seat: 0, from: 1 })).toBe(0);
    const truce = check('truce');
    expect(ids_(truce)).toEqual(['attack', 'deployHere', 'shipHere', 'diplo-alliance', 'diplo-break', 'diplo-embargo']); // the truce proposal can never apply any more: left out
    expect(byId(truce, 'diplo-break').confirm).toBe(true);
    expect(byId(truce, 'attack')).toMatchObject({ state: 'disabled', reasonCode: REJECT_DIPLO_TREATY_BOUND, reasonKey: 'reject.diplo.treatyBound' }); // a treaty party is not attacked
  });

  it('a refusal that could pass later stays visible and dimmed with its reason (an open proposal of yours)', () => {
    const s = arena();
    expect(send(s, { kind: 'ProposeTreaty', seat: 0, to: 1, treaty: 1 })).toBe(0);
    const m = contextActionsFor(mk(s), 0, { cell: cellAt(40), structure: -1 }, OPTS);
    expect(byId(m, 'diplo-truce')).toMatchObject({ state: 'disabled', reasonKey: 'reject.diplo.pending' });
    expect(byId(m, 'diplo-alliance').state).toBe('disabled');
  });

  it('the attack entry shows the commit percent and the troops that would leave, and carries the target owner', () => {
    const v = mk(arena());
    const e = byId(contextActionsFor(v, 0, { cell: cellAt(70), structure: -1 }, OPTS), 'attack');
    expect(e.params).toEqual({ pct: 40, troops: 400 });
    expect(e.effect).toEqual({ kind: 'attack', owner: 0, cell: cellAt(70) });
    expect(e.state).toBe('ok');
  });
});

describe('your own land', () => {
  it('PARITY (build): nine types, each state and reason is validateBuild on that very cell; a broke seat sees the gold reason everywhere it can build', () => {
    const s = arena();
    const types = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    for (const cell of [cellAt(5, 2), cellAt(15, 7), cellAt(29, 0)]) {
      const v = mk(s);
      const m = contextActionsFor(v, 0, { cell, structure: -1 }, OPTS);
      expect(m.entries.map((e) => e.effect)).toEqual(types.map((type) => ({ kind: 'build', type, cell })));
      expect(m.groups).toEqual([{ id: 'build', titleKey: 'ctx.group.build', params: {}, open: true }]);
      m.entries.forEach((e, i) => {
        const want = validateBuild(v, 0, types[i] as number, cell);
        expect(e.state === 'ok', `type ${i + 1} at ${cell}`).toBe(want === 0);
        expect(e.reasonCode ?? 0).toBe(want);
        expect(e.keyHint).toBe(String(i + 1));
        expect(e.priceGold).toBeGreaterThan(0);
      });
    }
    s.gold[1] = 0;
    const poor = contextActionsFor(mk(s), 0, { cell: cellAt(15, 7), structure: -1 }, OPTS);
    expect(byId(poor, 'build.1')).toMatchObject({ state: 'disabled', reasonCode: REJECT_BUILD_GOLD, reasonKey: 'toast.build.gold' });
  });

  it('PARITY (upgrade, delete, produce helicopter): a City, a Factory and a Port show the entries of their type, with the validator\'s answer', () => {
    const s = arena();
    const city = s.structures.add(STRUCT_CITY, 1, cellAt(10, 3), s.tick - 1_000_000);
    const factory = s.structures.add(STRUCT_FACTORY, 1, cellAt(12, 3), s.tick - 1_000_000);
    const port = s.structures.add(STRUCT_PORT, 1, cellAt(14, 3), s.tick - 1_000_000);
    const v = mk(s);
    const c = contextActionsFor(v, 0, { cell: cellAt(10, 3), structure: city }, OPTS);
    expect(ids_(c)).toEqual(['upgrade', 'city', 'select', 'delete']);
    expect(byId(c, 'upgrade').reasonCode ?? 0).toBe(validateUpgrade(v, 0, city));
    expect(byId(c, 'upgrade').priceGold).toBeGreaterThan(0);
    expect(byId(c, 'delete')).toMatchObject({ confirm: true, state: 'ok', effect: { kind: 'delete', id: city } });
    const f = contextActionsFor(v, 0, { cell: cellAt(12, 3), structure: factory }, OPTS);
    expect(ids_(f)).toEqual(['upgrade', 'produceHeli', 'deploySend', 'select', 'delete']);
    expect(byId(f, 'produceHeli').reasonCode ?? 0).toBe(validateProduceHeli(v, 0, factory));
    expect(byId(f, 'deploySend')).toMatchObject({ state: 'disabled', reasonCode: REJECT_HELI_NO_PAD, keyHint: 'L', effect: { kind: 'deploy', factory, cell: -1 } }); // no helicopter on the pad yet
    const p = contextActionsFor(v, 0, { cell: cellAt(14, 3), structure: port }, OPTS);
    expect(ids_(p)).toEqual(['upgrade', 'shipSend', 'select', 'delete']);
    expect(byId(p, 'shipSend').keyHint).toBe('B');
    // an unfinished structure: the upgrade says it is busy
    const fresh = s.structures.add(STRUCT_CITY, 1, cellAt(20, 3), s.tick + 1000);
    const vf = mk(s);
    const busy = contextActionsFor(vf, 0, { cell: cellAt(20, 3), structure: fresh }, OPTS);
    expect(byId(busy, 'upgrade')).toMatchObject({ state: 'disabled', reasonCode: REJECT_STRUCT_BUSY });
  });
});

describe('the choice of the Factory (send a helicopter here)', () => {
  const W = 128;
  const H = 32;
  function heliWorld(): { s: GameState; nav: Nav; a: number; b: number; c: number } {
    const terrain = new Uint8Array(W * H).fill(CLASS_PLAINS);
    const elevation = new Uint16Array(W * H).fill(5);
    const maxElev = Int16Array.from(elevation);
    const s = createState({ width: W, height: H, seed: 5, seats: 2, config: { debugIntents: true }, terrain, elevation, maxElev });
    for (let c = 0; c < W * H; c++) s.owner[c] = c % W < 64 ? 1 : 2;
    rebuildAggregates(s);
    s.gold[1] = 100000 * MILLI_GOLD_PER_GOLD;
    s.troops[1] = 300 * QT_PER_TROOP;
    s.capital[1] = 10 * W + 10 + 1;
    const a = s.structures.add(STRUCT_FACTORY, 1, 5 * W + 20, s.tick); // first by id, but no helicopter on its pad
    const b = s.structures.add(STRUCT_FACTORY, 1, 8 * W + 20, s.tick);
    const c = s.structures.add(STRUCT_FACTORY, 1, 12 * W + 20, s.tick); // a second one with a helicopter
    for (let i = 0; i < (BUILD_TICKS[STRUCT_FACTORY] as number); i++) step(s, { turn: s.tick, intents: [] });
    step(s, { turn: s.tick, intents: [withId(produceHeliBody(0, b), 9001)] });
    step(s, { turn: s.tick, intents: [withId(produceHeliBody(0, c), 9002)] });
    for (let i = 0; i < HELI_BUILD_TICKS + 2; i++) step(s, { turn: s.tick, intents: [] });
    s.troops[1] = 300 * QT_PER_TROOP;
    const los = createLos(createLosTerrain(W, H, s.rowCos, elevation, maxElev));
    const nav = createNav({ width: W, height: H, terrainClass: s.terrain, meanElev: elevation }, los);
    return { s, nav, a, b, c };
  }

  it('picks the FIRST Factory whose launch is accepted (not the first by id, not the last), and the entry is that launch', () => {
    const { s, nav, a, b, c } = heliWorld();
    const v = mk(s);
    const cell = 10 * W + 100;
    expect(validateLaunchHeli(v, nav, 0, a, cell, 10, 0)).toBe(REJECT_HELI_NO_PAD);
    expect(validateLaunchHeli(v, nav, 0, b, cell, 10, 0)).toBe(0);
    expect(validateLaunchHeli(v, nav, 0, c, cell, 10, 0)).toBe(0);
    expect(pickFactory(v, 0, cell, nav, 10, 0)).toEqual({ id: b, reason: 0 });
    const m = contextActionsFor(v, 0, { cell, structure: -1 }, { ...OPTS, nav });
    expect(byId(m, 'deployHere')).toMatchObject({ state: 'ok', effect: { kind: 'deploy', factory: b, cell } });
  });

  it('no Factory can send: dimmed, with the reason of the best candidate (the one that got furthest), and the validator\'s code; without a Factory the reason is "no factory"', () => {
    const { s, nav, a, b } = heliWorld();
    const v = mk(s);
    const cell = 10 * W + 100;
    // too many troops asked for: every Factory fails with BAD_TROOPS, which is further along than "no pad" (Factory a)
    const pick = pickFactory(v, 0, cell, nav, 9999, 0);
    expect(pick.id).not.toBe(a);
    expect(pick.reason).toBe(validateLaunchHeli(v, nav, 0, pick.id, cell, 9999, 0));
    expect(pick.reason).not.toBe(0);
    const only = pickFactory(v, 0, cell, nav, 10, 0);
    expect(only.id).toBe(b);
    const none = landState(20, 4, { seats: 2, debug: true });
    const vn = mk(none);
    expect(pickFactory(vn, 0, 5, null, 10, 0)).toEqual({ id: -1, reason: REJECT_HELI_NO_FACTORY });
    // without a Nav (not built yet) a Factory with no pad still says "no pad"
    expect(pickFactory(v, 0, cell, null, 10, 0).reason).not.toBe(0);
  });
});

describe('the choice of the Port (send a ship here)', () => {
  it('the Port whose route reaches the coast near the target is chosen; the entry is that launch; a wall of land makes it dimmed with "no sea way"', () => {
    const fx = shipFixture(0, { island: false });
    const v = mk(fx.state);
    fx.state.capital[1] = 1;
    const v2 = mk(fx.state);
    const pick = pickPort(v2, 0, fx.target);
    expect(pick).toEqual({ id: fx.port, reason: 0 });
    expect(validateLaunchShip(v2, 0, fx.port, fx.target, 20)).toBe(0);
    const m = contextActionsFor(v2, 0, { cell: fx.target, structure: -1 }, OPTS);
    expect(byId(m, 'shipHere')).toMatchObject({ state: 'ok', effect: { kind: 'ship', port: fx.port, cell: fx.target } });
    void v;
    const w = shipFixture(0, { island: false });
    w.state.capital[1] = 1;
    for (let y = 0; y < 64; y++) w.state.terrain[y * SHIP_W + 120] = CLASS_PLAINS;
    const vw = mk(w.state);
    const walled = pickPort(vw, 0, w.target);
    expect(walled).toEqual({ id: w.port, reason: REJECT_SHIP_NO_ROUTE });
    expect(byId(contextActionsFor(vw, 0, { cell: w.target, structure: -1 }, OPTS), 'shipHere')).toMatchObject({ state: 'disabled', reasonCode: REJECT_SHIP_NO_ROUTE, reasonKey: 'reject.ship.noRoute' });
  });

  it('a seat with no Port: "no port", dimmed (it could apply once there is one)', () => {
    const s = arena();
    const m = contextActionsFor(mk(s), 0, { cell: cellAt(70), structure: -1 }, OPTS);
    expect(byId(m, 'shipHere')).toMatchObject({ state: 'disabled', reasonCode: REJECT_SHIP_NO_PORT });
    expect(byId(m, 'deployHere')).toMatchObject({ state: 'disabled', reasonCode: REJECT_HELI_NO_FACTORY });
  });
});

describe('reasons and the provider hook', () => {
  it('every reason key of every refusal code the menu can show has a text in both languages without an unfilled {placeholder}', () => {
    for (let code = 1; code <= 130; code++) {
      const key = rejectKey(code);
      for (const lang of ['sv', 'en'] as const) {
        const text = TABLES[lang][key];
        expect(text, `${lang} ${key} (code ${code})`).toBeDefined();
        expect(String(text).replace('{code}', '').replace('{max}', ''), `${lang} ${key} (code ${code})`).not.toMatch(/\{/); // the menu fills {code} (reasonParams)
      }
    }
    expect(t('ctx.attack', { pct: 40, troops: 400 })).toContain('400');
  });

  it('registerContextProvider adds entries to every menu and the returned function takes them away again (the hook M15b uses)', () => {
    const v = mk(arena());
    const base = contextActionsFor(v, 0, { cell: cellAt(70), structure: -1 }, OPTS).entries.length;
    const off = registerContextProvider((input, out) => {
      if (input.kind === 'neutral') out.push({ id: 'x.fire', group: 'act', labelKey: 'ctx.select', params: {}, state: 'disabled', reasonKey: 'reject.other', effect: { kind: 'extension', id: 'fire', cell: input.target.cell } });
    });
    const m = contextActionsFor(v, 0, { cell: cellAt(70), structure: -1 }, OPTS);
    expect(m.entries.length).toBe(base + 1);
    expect(byId(m, 'x.fire').effect).toEqual({ kind: 'extension', id: 'fire', cell: cellAt(70) });
    expect(contextActionsFor(v, 0, { cell: cellAt(40), structure: -1 }, OPTS).entries.some((e) => e.id === 'x.fire')).toBe(false); // the provider chose its own kind
    off();
    expect(contextActionsFor(v, 0, { cell: cellAt(70), structure: -1 }, OPTS).entries.length).toBe(base);
  });
});

describe('the sea is not land', () => {
  it('the deep sea cell of an island world is unplayable', () => {
    const s = landState(10, 4, { seats: 2, classAt: (x) => (x < 5 ? CLASS_PLAINS : CLASS_DEEP_SEA) });
    s.capital[1] = 1;
    expect(contextActionsFor(mk(s), 0, { cell: 7, structure: -1 }, OPTS).blocked).toBe('unplayable');
  });
});
