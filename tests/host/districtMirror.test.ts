// Districts-1: the district table reaches the page. The signature moves with every district column (the diff carries the table only when it changed),
// a BuildDistrict through the host shows in the ViewMirror at once, and the page validates with the very functions the sim runs.
import { describe, expect, it } from 'vitest';
import { MainThreadHost } from '../../src/host/mainThreadHost';
import { cloneStructures } from '../../src/host/protocol';
import { snapshotStructures, structureSignature } from '../../src/host/structureSnapshot';
import { ViewMirror } from '../../src/host/viewMirror';
import { DISTRICT_MARKET, districtIndex, validateBuildDistrict, validateUpgradeDistrict } from '../../src/sim/districtRules';
import { REJECT_BUILD_GOLD, REJECT_DISTRICT_OCCUPIED, REJECT_NONE } from '../../src/sim/intents';
import { MILLI_GOLD_PER_GOLD } from '../../src/sim/rules';
import { createState, rebuildAggregates, type GameState } from '../../src/sim/state';
import { STRUCT_CITY } from '../../src/sim/structureRules';
import { StructureTable } from '../../src/sim/structures';
import { CLASS_PLAINS } from '../../src/sim/terrain';

describe('structureSignature and the snapshot carry the districts', () => {
  it('the signature moves when any district column or the count changes', () => {
    const t = new StructureTable(64, 3);
    t.add(STRUCT_CITY, 1, 10, 0);
    t.add(STRUCT_CITY, 2, 20, 0);
    t.setDistrict(1, 2, DISTRICT_MARKET, 2, 500, 0);
    const base = structureSignature(t);
    expect(structureSignature(t)).toBe(base);
    const cols = ['districtKind', 'districtLevel', 'districtReadyTick', 'districtUpgradeReadyTick'] as const;
    for (const c of cols) {
      const arr = t[c] as unknown as { [i: number]: number };
      const i = districtIndex(1, 2);
      const old = arr[i] as number;
      arr[i] = old + 1;
      expect(structureSignature(t), c).not.toBe(base);
      arr[i] = old;
    }
    t.districtCount++;
    expect(structureSignature(t), 'districtCount').not.toBe(base);
    t.districtCount--;
    expect(structureSignature(t)).toBe(base);
  });

  it('snapshotStructures copies the district arrays (and the counts), cloneStructures copies them again, neither shares memory with the sim', () => {
    const t = new StructureTable(64, 3);
    t.add(STRUCT_CITY, 1, 10, 0);
    t.setDistrict(0, 1, DISTRICT_MARKET, 3, 500, 0);
    const snap = snapshotStructures(t);
    expect(snap.districtKind.length).toBe(4);
    expect([snap.districtKind[1], snap.districtLevel[1], snap.districtReadyTick[1]]).toEqual([DISTRICT_MARKET, 3, 500]);
    expect(snap.districtCounts[1 * 5 + DISTRICT_MARKET]).toBe(1);
    t.districtKind[1] = 0;
    expect(snap.districtKind[1]).toBe(DISTRICT_MARKET);
    const copy = cloneStructures(snap);
    copy.districtKind[1] = 0;
    expect(snap.districtKind[1]).toBe(DISTRICT_MARKET);
    expect(copy.districtLevel[1]).toBe(3);
  });
});

describe('a BuildDistrict through the host shows in the mirror, and the page validates like the sim', () => {
  const W = 128;
  const H = 64;
  const world = (): GameState => {
    const s = createState({ width: W, height: H, seed: 3, seats: 2, config: { debugIntents: true }, terrain: new Uint8Array(W * H).fill(CLASS_PLAINS), elevation: new Uint16Array(W * H) });
    s.owner.fill(1);
    rebuildAggregates(s);
    s.gold[1] = 5000 * MILLI_GOLD_PER_GOLD;
    return s;
  };

  it('build, see it in the mirror, validate with validate*District on the mirror', async () => {
    const state = world();
    state.structures.add(STRUCT_CITY, 1, 10 * W + 10, 0);
    state.tick = 1000;
    const host = new MainThreadHost(state);
    const { mirror } = await ViewMirror.attach(host);
    expect(validateBuildDistrict(mirror, 0, 0, 0, DISTRICT_MARKET)).toBe(REJECT_NONE);
    host.submitIntent({ kind: 'BuildDistrict', seat: 0, structure: 0, slot: 0, districtKind: DISTRICT_MARKET });
    host.runTicks(5);
    expect(state.structures.districtKind[districtIndex(0, 0)]).toBe(DISTRICT_MARKET);
    expect(mirror.districts.districtKind[districtIndex(0, 0)]).toBe(DISTRICT_MARKET);
    expect(mirror.districts.districtsOwned(1, DISTRICT_MARKET)).toBe(1);
    expect(validateBuildDistrict(mirror, 0, 0, 0, DISTRICT_MARKET)).toBe(REJECT_DISTRICT_OCCUPIED);
    expect(validateUpgradeDistrict(mirror, 0, 0, 0)).not.toBe(REJECT_NONE); // still being built: busy
    // an upgrade started at once shows (only districtUpgradeReadyTick changes then)
    state.tick = 3000;
    host.runTicks(1);
    host.submitIntent({ kind: 'UpgradeDistrict', seat: 0, structure: 0, slot: 0 });
    host.runTicks(5);
    expect(state.structures.districtUpgradeReadyTick[districtIndex(0, 0)]).toBeGreaterThan(0);
    expect(mirror.districts.districtUpgradeReadyTick[districtIndex(0, 0)]).toBe(state.structures.districtUpgradeReadyTick[districtIndex(0, 0)]);
    // the purse the mirror reads is the sim's: a poor seat gets the gold reason
    state.gold[1] = 0;
    host.runTicks(1);
    expect(validateBuildDistrict(mirror, 0, 0, 1, DISTRICT_MARKET)).toBe(REJECT_BUILD_GOLD);
    host.dispose();
  });
});
