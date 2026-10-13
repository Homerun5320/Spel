// M04 additions to the state: players and tribes, the row table, the per-owner economy arrays, the derived parts, setOwner.
import { describe, expect, it } from 'vitest';
import { rowCosFromLut } from '../../src/sim/grid';
import { OUTBOX_PAINT } from '../../src/sim/outbox';
import { WEIGHT_ONE } from '../../src/sim/rules';
import { deserialize, hashState, serialize } from '../../src/sim/serialize';
import { STATE_ARRAY_NAMES, createEmptyState, createState, ownerSlots, rebuildAggregates, seatToOwner } from '../../src/sim/state';
import { landShareQ15, setOwner } from '../../src/sim/territory';
import { landState } from './helpers/worlds';

describe('createState: players, tribes and the new arrays', () => {
  it('players default to all seats; tribes are the seats after the players', () => {
    expect(createEmptyState(4, 4, 1, 5).header.players).toBe(5);
    expect(landState(4, 4, { seats: 7, players: 3 }).header.players).toBe(3);
    expect(landState(4, 4, { seats: 7, players: 7 }).header.players).toBe(7);
  });

  it('refuses a player count outside 1..seats', () => {
    for (const players of [0, -1, 8, 2.5]) expect(() => landState(4, 4, { seats: 7, players })).toThrow(RangeError);
  });

  it('per-owner arrays have one slot per ownerId plus the unowned slot 0, all zero at the start', () => {
    const s = landState(8, 8, { seats: 6 });
    expect(ownerSlots(6)).toBe(7);
    for (const name of ['troops', 'troopFrac', 'gold', 'capital'] as const) {
      expect(s[name].length).toBe(7);
      expect(Array.from(s[name]).every((v) => v === 0)).toBe(true);
    }
    expect(s.agg.area.length).toBe(7);
    expect(s.agg.warea.length).toBe(7);
  });

  it('the row table is the sine-table cos by default, copied when given, and validated', () => {
    const s = landState(8, 16);
    expect(s.rowCos).toEqual(rowCosFromLut(16));
    const given = new Uint16Array(16).fill(1000);
    const t = createState({ width: 8, height: 16, seed: 1, seats: 1, terrain: new Uint8Array(128), elevation: new Uint16Array(128), rowCos: given });
    given[0] = 5;
    expect(t.rowCos[0]).toBe(1000);
    expect(() => createState({ width: 8, height: 16, seed: 1, seats: 1, terrain: new Uint8Array(128), elevation: new Uint16Array(128), rowCos: new Uint16Array(15) })).toThrow(RangeError);
    const heavy = new Uint16Array(16).fill(WEIGHT_ONE + 1);
    expect(() => createState({ width: 8, height: 16, seed: 1, seats: 1, terrain: new Uint8Array(128), elevation: new Uint16Array(128), rowCos: heavy })).toThrow(RangeError);
  });

  it('every new array is in the registry (hash and serialisation), the derived parts are not', () => {
    for (const name of ['rowCos', 'troops', 'troopFrac', 'gold', 'capital']) expect(STATE_ARRAY_NAMES).toContain(name);
    const s = landState(8, 8);
    expect(ArrayBuffer.isView(s.grid)).toBe(false);
    expect(ArrayBuffer.isView(s.agg)).toBe(false);
    expect(ArrayBuffer.isView(s.scratch)).toBe(false);
  });

  it('the header takes part in the hash: players', () => {
    const a = hashState(landState(8, 8, { seats: 4, players: 4 }));
    const b = hashState(landState(8, 8, { seats: 4, players: 2 }));
    expect(a).not.toBe(b);
  });
});

describe('setOwner keeps the aggregates, the stamp and the outbox in step', () => {
  it('moves area and weight between owners, stamps the cell and reports one paint per real change', () => {
    const s = landState(16, 16, { seats: 3 });
    const c = 5 * 16 + 3;
    const w = s.grid.weight(c);
    setOwner(s, c, 1, 11);
    expect([s.agg.area[1], s.agg.warea[1], s.stamp[c]]).toEqual([1, w, 11]);
    setOwner(s, c, 2, 12);
    expect([s.agg.area[1], s.agg.warea[1], s.agg.area[2], s.agg.warea[2], s.stamp[c]]).toEqual([0, 0, 1, w, 12]);
    setOwner(s, c, 2, 13); // same owner: only the stamp moves
    expect([s.agg.area[2], s.stamp[c]]).toEqual([1, 13]);
    setOwner(s, c, 0, 14); // freed
    expect([s.agg.area[2], s.agg.warea[2], s.owner[c]]).toEqual([0, 0, 0]);
    const paints = s.outbox.drain().filter((e) => e.kind === OUTBOX_PAINT);
    expect(paints.map((e) => [e.a, e.b])).toEqual([[c, 1], [c, 2], [c, 0]]);
  });

  it('the aggregates equal a rebuild after any sequence of changes', () => {
    const s = landState(16, 16, { seats: 3 });
    let x = 12345;
    for (let i = 0; i < 2000; i++) {
      x = (Math.imul(x, 1103515245) + 12345) >>> 0;
      setOwner(s, (x >>> 8) % 256, (x >>> 4) % 4, i);
    }
    const area = Array.from(s.agg.area);
    const warea = Array.from(s.agg.warea);
    rebuildAggregates(s);
    expect(Array.from(s.agg.area)).toEqual(area);
    expect(Array.from(s.agg.warea)).toEqual(warea);
  });

  it('the land share is the owner weight over the weight of all playable land, in Q15', () => {
    const s = landState(16, 16, { seats: 2 });
    expect(landShareQ15(s, 1)).toBe(0);
    for (let c = 0; c < 256; c++) setOwner(s, c, c < 128 ? 1 : 2, 0);
    const a = landShareQ15(s, 1);
    const b = landShareQ15(s, 2);
    expect(a + b).toBeGreaterThanOrEqual(WEIGHT_ONE - 2);
    expect(a + b).toBeLessThanOrEqual(WEIGHT_ONE);
    expect(a).toBeGreaterThan(0);
    // no playable land at all: 0, not a division by zero
    const sea = createEmptyState(4, 4, 1, 2);
    expect(landShareQ15(sea, 1)).toBe(0);
  });

  it('survives a serialize / deserialize: aggregates and grid are rebuilt, not stored', () => {
    const s = landState(16, 16, { seats: 3 });
    for (let c = 0; c < 100; c++) setOwner(s, c, 1 + (c % 3), c);
    const r = deserialize(serialize(s));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Array.from(r.state.agg.area)).toEqual(Array.from(s.agg.area));
    expect(Array.from(r.state.agg.warea)).toEqual(Array.from(s.agg.warea));
    expect(Array.from(r.state.grid.playable)).toEqual(Array.from(s.grid.playable));
    expect(seatToOwner(0)).toBe(1);
  });
});
