// Districts-1: the district table in the saved state. A round trip, a restored run equal to the straight run (with district intents in the script),
// and one test per guard of the district block of deserialize (crafted blobs with a VALID checksum, forged through serialize on a tampered
// state, plus byte patches for the count and the order).
import { describe, expect, it } from 'vitest';
import { DISTRICT_BARRACKS, DISTRICT_HOUSING, DISTRICT_MARKET, DISTRICT_WALLS, districtIndex } from '../../src/sim/districtRules';
import { MILLI_GOLD_PER_GOLD, STRUCT_LEVEL_HARD_CAP } from '../../src/sim/rules';
import { deserialize, hashState, serialize } from '../../src/sim/serialize';
import { createState, ENGINE_VERSION, type GameState } from '../../src/sim/state';
import { step } from '../../src/sim/step';
import { STRUCT_CITY, STRUCT_FACTORY } from '../../src/sim/structureRules';
import { setOwner } from '../../src/sim/territory';
import { CLASS_PLAINS } from '../../src/sim/terrain';
import { withId, type Intent, type IntentBody } from '../../src/sim/intents';
import { FORMAT_VERSION } from '../../src/sim/serialize';
import { saveLayout } from '../helpers/saveLayout';

const W = 128;
const H = 64;

/** Two seats; owner 1 has a level 3 City (id 0) with three districts, a Factory (id 1) and a level 1 City (id 2). Tick 1000. */
function base(): GameState {
  const s = createState({ width: W, height: H, seed: 4, seats: 2, terrain: new Uint8Array(W * H).fill(CLASS_PLAINS), elevation: new Uint16Array(W * H) });
  for (let c = 0; c < W * H; c++) setOwner(s, c, 1, 0);
  const city = s.structures.add(STRUCT_CITY, 1, 10, 0);
  s.structures.level[city] = 6; // four slots (Sim-Growth: slots 2/3/4/5 by level)
  s.structures.add(STRUCT_FACTORY, 1, 5000, 0);
  const small = s.structures.add(STRUCT_CITY, 1, 7000, 0);
  s.structures.setDistrict(city, 0, DISTRICT_MARKET, 3, 500, 0);
  s.structures.setDistrict(city, 2, DISTRICT_HOUSING, 2, 600, 1500); // an upgrade running
  s.structures.setDistrict(city, 3, DISTRICT_WALLS, 1, 1200, 0); // still being built
  s.structures.setDistrict(small, 1, DISTRICT_BARRACKS, 1, 700, 0);
  s.tick = 1000;
  return s;
}

function refused(tamper: (s: GameState) => void, error = 'structure-range'): void {
  const s = base();
  expect(deserialize(serialize(s)).ok, 'the untampered state round trips').toBe(true);
  tamper(s);
  const r = deserialize(serialize(s));
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error).toBe(error);
}

describe('versions', () => {
  it('ENGINE_VERSION is 21 (M18b-2: federations; 20 after M12b: air defence; 19 after Fix-4A1; 18 after M18c-2: the AI temperament; 17 after M18c-1: diplomacy; 16 after M12a-3, 15 after M12a-2, 14 after M12a-1) and FORMAT_VERSION is 15 (M18b-2: bound alliance pairs; 14 after M12b: the salvo clock of the structure rows; 13 after M18c-1: the diplomacy block; 12 after M12a-1: the air block; was 13 and 11 after Sim-Levels2, 12 and 10 after Sim-Growth)', () => {
    expect(ENGINE_VERSION).toBe(21);
    expect(FORMAT_VERSION).toBe(15);
  });
});

describe('the district table round trips', () => {
  it('every array, the counts and the hash survive serialize / deserialize', () => {
    const s = base();
    const r = deserialize(serialize(s));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const a = s.structures;
    const b = r.state.structures;
    expect(Array.from(b.districtKind)).toEqual(Array.from(a.districtKind));
    expect(Array.from(b.districtLevel)).toEqual(Array.from(a.districtLevel));
    expect(Array.from(b.districtReadyTick)).toEqual(Array.from(a.districtReadyTick));
    expect(Array.from(b.districtUpgradeReadyTick)).toEqual(Array.from(a.districtUpgradeReadyTick));
    expect(b.districtCount).toBe(4);
    expect([b.districtsOwned(1, DISTRICT_MARKET), b.districtsOwned(1, DISTRICT_WALLS), b.districtsOwned(1, DISTRICT_BARRACKS)]).toEqual([1, 1, 1]);
    expect(hashState(r.state)).toBe(hashState(s));
    expect(serialize(r.state)).toEqual(serialize(s));
  });

  it('a state without districts is 4 bytes longer than M09 wrote (the count), and a district costs 24 bytes', () => {
    const s = base();
    const withD = serialize(s).length;
    const t = base();
    for (let i = 0; i < 4 * 3; i++) t.structures.clearDistrict(Math.floor(i / 4), i % 4);
    expect(t.structures.districtCount).toBe(0);
    expect(withD - serialize(t).length).toBe(4 * 24);
  });

  it('a restored run equals the straight run when the script builds, upgrades and removes districts (snapshot = straight run)', () => {
    const intent = (i: IntentBody, id: number): Intent => withId(i, id);
    const script = (s: GameState): Intent[] => {
      const t = s.tick;
      const g = 1;
      if (t === 1010) return [intent({ kind: 'BuildDistrict', seat: 0, structure: 0, slot: 1, districtKind: DISTRICT_BARRACKS }, g)];
      if (t === 1100) return [intent({ kind: 'UpgradeDistrict', seat: 0, structure: 0, slot: 0 }, g + 1)]; // refused: top level
      if (t === 1105) return [intent({ kind: 'UpgradeDistrict', seat: 0, structure: 0, slot: 1 }, g + 2)];
      if (t === 1400) return [intent({ kind: 'RemoveDistrict', seat: 0, structure: 2, slot: 1 }, g + 3)];
      if (t === 1430) return [intent({ kind: 'BuildDistrict', seat: 0, structure: 2, slot: 0, districtKind: DISTRICT_HOUSING }, g + 4)];
      return [];
    };
    const a = base();
    a.gold[1] = 100000 * MILLI_GOLD_PER_GOLD;
    for (let i = 0; i < 60; i++) step(a, { turn: a.tick, intents: script(a) });
    const r = deserialize(serialize(a));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(hashState(r.state)).toBe(hashState(a));
    for (let i = 0; i < 500; i++) {
      step(a, { turn: a.tick, intents: script(a) });
      step(r.state, { turn: r.state.tick, intents: script(r.state) });
    }
    expect(hashState(r.state)).toBe(hashState(a));
    expect(r.state.gold[1]).toBe(a.gold[1]);
    expect(a.structures.districtCount).toBeGreaterThanOrEqual(4); // the script did something: 4 + Barracks built - Barracks removed + Housing
    expect(a.structures.districtLevel[districtIndex(0, 1)]).toBeGreaterThanOrEqual(1);
    // and the districts took part in the hash: the same run without the script ends elsewhere
    const idle = base();
    idle.gold[1] = 100000 * MILLI_GOLD_PER_GOLD;
    for (let i = 0; i < 560; i++) step(idle, { turn: idle.tick, intents: [] });
    expect(hashState(idle)).not.toBe(hashState(a));
  });
});

describe('deserialize refuses a forged district block', () => {
  it('D01 a district in a structure that is not a City', () => refused((s) => s.structures.setDistrict(1, 0, DISTRICT_MARKET, 1, 500, 0)));
  it('D02 a district in a slot the City\'s level does not have (slot 2 of the level 1 City)', () => refused((s) => s.structures.setDistrict(2, 2, DISTRICT_MARKET, 1, 500, 0)));
  it('D03 a kind beyond the four', () => refused((s) => (s.structures.districtKind[districtIndex(0, 0)] = 5)));
  it('D04 a level of 0 or above the maximum', () => {
    refused((s) => (s.structures.districtLevel[districtIndex(0, 0)] = 0));
    refused((s) => (s.structures.districtLevel[districtIndex(0, 0)] = STRUCT_LEVEL_HARD_CAP + 1));
  });
  it('D05 a ready tick earlier than the build time (no district is built before tick 0)', () => refused((s) => (s.structures.districtReadyTick[districtIndex(0, 0)] = 79)));
  it('D06 an upgrade running at the top level (the hard cap; below it a running upgrade is legal)', () => {
    refused((s) => {
      s.structures.districtLevel[districtIndex(0, 0)] = STRUCT_LEVEL_HARD_CAP;
      s.structures.districtUpgradeReadyTick[districtIndex(0, 0)] = 2000;
    });
    const ok = base();
    ok.structures.districtUpgradeReadyTick[districtIndex(0, 0)] = 2000;
    expect(deserialize(serialize(ok)).ok).toBe(true);
  });
  it('D07 a district in the slot of a deleted (recycled) structure', () =>
    refused((s) => {
      s.structures.remove(1); // the Factory
      s.structures.districtKind[districtIndex(1, 0)] = DISTRICT_MARKET;
      s.structures.districtLevel[districtIndex(1, 0)] = 1;
      s.structures.districtReadyTick[districtIndex(1, 0)] = 500;
      s.structures.districtCount++; // the derived count follows the arrays, as the sim keeps it
    }));
  it('D08 a district count beyond 5 per live structure, and a count that does not match the bytes', () => {
    const st = base();
    const bytes = serialize(st);
    const countAt = saveLayout(bytes, st.header.seats).districtCountAt(4); // Fix-4A2: offsets from tests/helpers/saveLayout.ts
    const view = (b: Uint8Array): DataView => new DataView(b.buffer);
    expect(view(bytes).getUint32(countAt, true)).toBe(4);
    const huge = bytes.slice();
    view(huge).setUint32(countAt, 3 * 5 + 1, true);
    const r = deserialize(huge);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('structure-range');
    const off = bytes.slice();
    view(off).setUint32(countAt, 3, true);
    const r2 = deserialize(off);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error).toBe('size');
  });
  it('D09 districts out of order or twice (the records must ascend by id and slot)', () => {
    const st = base();
    const bytes = serialize(st);
    const first = saveLayout(bytes, st.header.seats).districtsAt(4);
    const view = (b: Uint8Array): DataView => new DataView(b.buffer);
    const swapped = bytes.slice();
    swapped.set(bytes.subarray(first, first + 24), first + 24);
    swapped.set(bytes.subarray(first + 24, first + 48), first);
    const r = deserialize(swapped);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('structure-range');
    const twice = bytes.slice();
    twice.set(bytes.subarray(first, first + 24), first + 24);
    const r2 = deserialize(twice);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error).toBe('structure-range');
    void view;
  });
  it('a snapshot of the old format (FORMAT_VERSION 7) is refused', () => {
    const bytes = serialize(base());
    new DataView(bytes.buffer).setUint32(4, 7, true);
    const r = deserialize(bytes);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('format-version');
  });
  it('a full table (every City with four districts) is legal and round trips', () => {
    const s = createState({ width: 128, height: 64, seed: 4, seats: 2, terrain: new Uint8Array(128 * 64).fill(CLASS_PLAINS), elevation: new Uint16Array(128 * 64) });
    for (let c = 0; c < 128 * 64; c++) setOwner(s, c, 1, 0);
    for (let k = 0; k < 400; k++) {
      const id = s.structures.add(STRUCT_CITY, 1, k * 17, 0);
      s.structures.level[id] = 6;
      for (let slot = 0; slot < 4; slot++) s.structures.setDistrict(id, slot, 1 + slot, 1 + (slot % 3), 500, 0);
    }
    expect(s.structures.districtCount).toBe(1600);
    const r = deserialize(serialize(s));
    expect(r.ok).toBe(true);
    if (r.ok) expect(hashState(r.state)).toBe(hashState(s));
  });
});
