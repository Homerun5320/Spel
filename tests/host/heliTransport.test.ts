// Fix-4B (audit 3, 1.7): the page-side and host-to-page code of the helicopters and of diplomacy, which was almost unit-untested: the helicopter table on its way to the page
// (snapshot, signature, mirror), the diplomacy table the same way, and every pure function of src/ui/heliInfo.ts and src/ui/diploReasons.ts. Each test names the mutant it was shown
// to kill (the table is in docs/DECISIONS.md, Fix-4B).
import { describe, expect, it } from 'vitest';
import { MirrorDiplomacy } from '../../src/host/diplomacyMirror';
import { snapshotDiplomacy } from '../../src/host/diplomacySnapshot';
import { MirrorHelis } from '../../src/host/heliMirror';
import { heliSignature, snapshotHelis } from '../../src/host/heliSnapshot';
import { cloneHelis } from '../../src/host/protocol';
import { DiplomacyTable, RELATION_ALLIANCE, RELATION_TRUCE, RELATION_WAR } from '../../src/sim/diplomacyTable';
import { HELI_APPROACH, HELI_BUILDING, HELI_CRUISE, HELI_DOWNED, HELI_HOVER, HELI_LIFT, HELI_PAD, HELI_POS_ONE, HELI_RETURN, HELI_UNLOAD, HeliTable } from '../../src/sim/heliTable';
import {
  REJECT_DIPLO_ALLIED,
  REJECT_DIPLO_AT_PEACE,
  REJECT_DIPLO_COOLDOWN,
  REJECT_DIPLO_ELIMINATED,
  REJECT_DIPLO_EMBARGO_NONE,
  REJECT_DIPLO_EMBARGO_SET,
  REJECT_DIPLO_FULL,
  REJECT_DIPLO_MATCH_ENDED,
  REJECT_DIPLO_NOT_PLAYER,
  REJECT_DIPLO_NO_PROPOSAL,
  REJECT_DIPLO_NO_TREATY,
  REJECT_DIPLO_PENDING,
  REJECT_DIPLO_SELF,
  REJECT_DIPLO_TREATY_BOUND,
  REJECT_STRUCT_ID,
} from '../../src/sim/intents';
import { HELI_FUEL_CELLS, TICK_HZ } from '../../src/sim/rules';
import { DiplomacyReader } from '../../src/sim/diplomacyTable';
import type { SimView } from '../../src/sim/public';
import { diplomacyRefusalKey } from '../../src/ui/diploReasons';
import { HeliWatcher, MISSION_LANDED, MISSION_LOST, MissionWatcher, heliPanelInfo, heliStateKey, ownHeliRows, padHeliOf } from '../../src/ui/heliInfo';
import { TABLES } from '../../src/ui/i18n';
import { createState } from '../../src/sim/state';
import { CLASS_PLAINS } from '../../src/sim/terrain';
import { STRUCT_FACTORY } from '../../src/sim/structureRules';
import { StateView } from '../../src/sim/view';

const OWNERS = 4; // owner slots: 0 = nobody, 1..3 = seats 0..2

/** A table with helicopters of different owners, states and every numeric field distinct per slot (so a field that is copied from the wrong slot or column shows). */
function table(): HeliTable {
  const t = new HeliTable(OWNERS);
  const specs: Array<[number, number, number]> = [
    [1, HELI_PAD, 3],
    [2, HELI_CRUISE, 5],
    [1, HELI_HOVER, 3],
    [3, HELI_DOWNED, 9],
  ];
  specs.forEach(([owner, state, factory], i) => {
    const id = t.addBuilding(owner, factory, 10 + i, 100 + i);
    t.state[id] = state;
    t.x[id] = 256 * (7 + i) + 3 * i;
    t.y[id] = 256 * (20 + i) + 5 * i;
    t.alt[id] = 1200 + 17 * i;
    t.hp[id] = 400 - 11 * i;
    t.load[id] = 50 + 25 * i;
    t.fuel[id] = 30000 + 123 * i;
  });
  return t;
}

describe('the helicopter table on its way to the page', () => {
  it('snapshotHelis -> MirrorHelis keeps every field of every slot, the counts and the totals (mutants: a column copied from the wrong array, a count off by one)', () => {
    const t = table();
    const m = new MirrorHelis();
    m.adopt(snapshotHelis(t, OWNERS));
    expect(m.version).toBe(1);
    expect(m.capacity).toBe(t.capacity);
    expect(m.highWater).toBe(4);
    expect(m.liveCount).toBe(4);
    for (const field of ['owner', 'state', 'factory', 'readyTick', 'x', 'y', 'alt', 'hp', 'load', 'fuel'] as const) {
      expect(Array.from(m[field] as ArrayLike<number>), field).toEqual(Array.from(t[field] as ArrayLike<number>).slice(0, 4));
    }
    expect([m.countOf(0), m.countOf(1), m.countOf(2), m.countOf(3)]).toEqual([0, 2, 1, 1]);
    expect(m.countOf(-1)).toBe(0);
    expect(m.countOf(99)).toBe(0);
    // a freed slot below the high-water mark stays a hole (owner 0), and the counts follow
    t.remove(1);
    m.adopt(snapshotHelis(t, OWNERS));
    expect(m.owner[1]).toBe(0);
    expect(m.highWater).toBe(4);
    expect(m.liveCount).toBe(3);
    expect(m.countOf(2)).toBe(0);
    expect(m.version).toBe(2);
  });

  it('a snapshot is a copy: changing the sim table afterwards does not change it, and cloneHelis is a deep copy too', () => {
    const t = table();
    const s = snapshotHelis(t, OWNERS);
    const c = cloneHelis(s);
    t.hp[0] = 1;
    t.fuel[0] = 1;
    expect(s.hp[0]).toBe(400);
    expect(s.fuel[0]).toBe(30000);
    c.hp[0] = 7;
    expect(s.hp[0]).toBe(400);
  });

  it('heliSignature moves when ANY field of ANY slot moves, and when a helicopter comes or goes; it is stable otherwise (mutants: a field left out of the fold, the totals left out)', () => {
    const t = table();
    const base = heliSignature(t);
    expect(heliSignature(t)).toBe(base);
    const seen = new Set<number>([base]);
    for (const field of ['owner', 'state', 'factory', 'readyTick', 'x', 'y', 'alt', 'hp', 'load', 'fuel'] as const) {
      for (const slot of [0, 3]) {
        const arr = t[field] as unknown as Uint32Array;
        const was = arr[slot] as number;
        arr[slot] = was + 1;
        const sig = heliSignature(t);
        expect(seen.has(sig), `${field}[${slot}]`).toBe(false);
        seen.add(sig);
        arr[slot] = was;
        expect(heliSignature(t), `${field}[${slot}] undone`).toBe(base);
      }
    }
    t.liveCount += 1; // the total alone (a helicopter under production that has no row yet)
    expect(heliSignature(t)).not.toBe(base);
    t.liveCount -= 1;
    t.highWater = 3;
    expect(heliSignature(t)).not.toBe(base);
  });
});

describe('the diplomacy table on its way to the page', () => {
  /** Seats 0..2 = owners 1..3. */
  function diplo(): DiplomacyTable {
    const d = new DiplomacyTable(OWNERS);
    d.setRelation(1, 2, RELATION_TRUCE, 900);
    d.setRelation(2, 3, RELATION_ALLIANCE, 0);
    d.embargoBy[1 * OWNERS + 3] = 1;
    d.cooldownUntil[3] = 700;
    d.addProposal(1, 3, 1, 500);
    d.addProposal(3, 1, 2, 520);
    return d;
  }

  it('snapshotDiplomacy -> MirrorDiplomacy: relations with their end ticks, embargoes, cooldowns and every proposal reach the view (mutants: a copy left out)', () => {
    const d = diplo();
    let now = 100;
    const m = new MirrorDiplomacy(OWNERS, 3, () => now);
    m.adopt(snapshotDiplomacy(d));
    expect(m.version).toBe(1);
    const v = m.view;
    expect(v.relation(0, 1)).toBe(RELATION_TRUCE);
    expect(v.relation(1, 0)).toBe(RELATION_TRUCE);
    expect(v.relation(1, 2)).toBe(RELATION_ALLIANCE);
    expect(v.relation(0, 2)).toBe(RELATION_WAR);
    expect(v.truceTicksLeft(0, 1)).toBe(800);
    expect(v.embargoFrom(0, 2)).toBe(true);
    expect(v.embargoFrom(2, 0)).toBe(false);
    expect(v.breakCooldownLeft(2)).toBe(600);
    expect(v.breakCooldownLeft(0)).toBe(0);
    expect(v.proposalCount).toBe(2);
    expect([v.proposalFrom(0), v.proposalTo(0), v.proposalTreaty(0), v.proposalLeft(0)]).toEqual([0, 2, 1, 400]);
    expect([v.proposalFrom(1), v.proposalTo(1), v.proposalTreaty(1), v.proposalLeft(1)]).toEqual([2, 0, 2, 420]);
    expect(v.proposalKind(0, 2)).toBe(1);
    expect(v.proposalKind(2, 0)).toBe(2);
    // the view reads the mirror's own clock: a truce that ran out reads as war before the next snapshot arrives
    now = 950;
    expect(v.relation(0, 1)).toBe(RELATION_WAR);
  });

  it('a newer table REPLACES the older one: a gone proposal, a lifted cooldown and a ended relation do not linger (mutants: the stale proposals are not cleared, `cooldownUntil` not copied)', () => {
    const d = diplo();
    const m = new MirrorDiplomacy(OWNERS, 3, () => 100);
    m.adopt(snapshotDiplomacy(d));
    d.removeProposalAt(0);
    d.removeProposalAt(0);
    d.cooldownUntil[3] = 0;
    d.embargoBy[1 * OWNERS + 3] = 0;
    d.setRelation(1, 2, RELATION_WAR, 0);
    m.adopt(snapshotDiplomacy(d));
    expect(m.version).toBe(2);
    const v = m.view;
    expect(v.proposalCount).toBe(0);
    expect(v.proposalKind(0, 2)).toBe(0);
    expect(v.breakCooldownLeft(2)).toBe(0);
    expect(v.embargoFrom(0, 2)).toBe(false);
    expect(v.relation(0, 1)).toBe(RELATION_WAR);
    // and the read-through of a live reader over the same table agrees with the mirror
    const live = new DiplomacyReader(d, 3, () => 100);
    expect([live.proposalCount, live.relation(1, 2)]).toEqual([v.proposalCount, v.relation(1, 2)]);
  });
});

describe('src/ui/diploReasons.ts: every refusal code has its own text key', () => {
  const CODES = [
    REJECT_DIPLO_NOT_PLAYER,
    REJECT_DIPLO_SELF,
    REJECT_DIPLO_AT_PEACE,
    REJECT_DIPLO_ALLIED,
    REJECT_DIPLO_PENDING,
    REJECT_DIPLO_NO_PROPOSAL,
    REJECT_DIPLO_COOLDOWN,
    REJECT_DIPLO_NO_TREATY,
    REJECT_DIPLO_ELIMINATED,
    REJECT_DIPLO_MATCH_ENDED,
    REJECT_DIPLO_TREATY_BOUND,
    REJECT_DIPLO_EMBARGO_SET,
    REJECT_DIPLO_EMBARGO_NONE,
    REJECT_DIPLO_FULL,
  ];
  it('the 14 codes map to 14 different keys, each with text in both tables and named after the code (mutant: two cases share a key)', () => {
    const keys = CODES.map((c) => diplomacyRefusalKey(c));
    expect(new Set(keys).size).toBe(CODES.length);
    for (const k of keys) {
      expect(k.startsWith('reject.diplo.')).toBe(true);
      expect(TABLES.sv[k], k).toBeTruthy();
      expect(TABLES.en[k], k).toBeTruthy();
    }
    expect(keys).toEqual([
      'reject.diplo.notPlayer',
      'reject.diplo.self',
      'reject.diplo.atPeace',
      'reject.diplo.allied',
      'reject.diplo.pending',
      'reject.diplo.noProposal',
      'reject.diplo.cooldown',
      'reject.diplo.noTreaty',
      'reject.diplo.eliminated',
      'reject.diplo.matchEnded',
      'reject.diplo.treatyBound',
      'reject.diplo.embargoSet',
      'reject.diplo.embargoNone',
      'reject.diplo.full',
    ]);
  });
  it('any other code goes on to the structure refusals (mutant: the default case is dropped)', () => {
    expect(diplomacyRefusalKey(REJECT_STRUCT_ID)).toBe('toast.struct.gone');
    expect(diplomacyRefusalKey(REJECT_STRUCT_ID)).not.toMatch(/^reject\.diplo\./);
  });
});

// ---- src/ui/heliInfo.ts ----------------------------------------------------------------------------------------------------------------

function fakeView(t: HeliTable, tick = 1): SimView {
  return { helis: t, tick, seats: 3 } as unknown as SimView;
}

describe('heliStateKey', () => {
  it('names each state on its own (mutants: labels swapped, a state falls through to the downed text)', () => {
    expect([HELI_PAD, HELI_LIFT, HELI_CRUISE, HELI_APPROACH, HELI_HOVER, HELI_UNLOAD, HELI_RETURN, HELI_DOWNED].map((s) => heliStateKey(s))).toEqual([
      'heli.state.pad',
      'heli.state.lift',
      'heli.state.cruise',
      'heli.state.approach',
      'heli.state.hover',
      'heli.state.unload',
      'heli.state.return',
      'heli.state.downed',
    ]);
    for (const k of new Set([HELI_PAD, HELI_LIFT, HELI_CRUISE, HELI_APPROACH, HELI_HOVER, HELI_UNLOAD, HELI_RETURN, HELI_DOWNED].map((s) => heliStateKey(s)))) {
      expect(TABLES.sv[k], k).toBeTruthy();
      expect(TABLES.en[k], k).toBeTruthy();
    }
  });
});

describe('padHeliOf / ownHeliRows', () => {
  it("only the seat's helicopter parked on THIS Factory's pad is the one that is sent (mutants: another Factory's pad, another seat's, a helicopter that is flying)", () => {
    const t = table(); // slot 0: seat 0 on pad of factory 3; slot 2: seat 0 hovering from factory 3
    const v = fakeView(t);
    expect(padHeliOf(v, 0, 3)).toBe(0);
    expect(padHeliOf(v, 0, 5)).toBe(-1); // factory 5 belongs to seat 1's helicopter (cruising)
    expect(padHeliOf(v, 1, 3)).toBe(-1); // seat 1 has nothing parked on factory 3
    t.state[0] = HELI_CRUISE;
    expect(padHeliOf(v, 0, 3)).toBe(-1);
    t.state[2] = HELI_PAD;
    expect(padHeliOf(v, 0, 3)).toBe(2);
  });

  it('the list shows the seat\'s helicopters with their fuel in percent, and the Recall button is live only for one that flies (mutants: always live, another seat\'s rows)', () => {
    const t = table();
    t.fuel[2] = (HELI_FUEL_CELLS * HELI_POS_ONE) / 4;
    const rows = ownHeliRows(fakeView(t), 0, []);
    expect(rows.map((r) => r.id)).toEqual([0, 2]);
    expect(rows.map((r) => r.fuelPct)).toEqual([Math.round(((30000 * 100) / (HELI_FUEL_CELLS * HELI_POS_ONE))), 25]);
    expect(rows.map((r) => r.troops)).toEqual([50, 100]);
    expect(rows.map((r) => r.canRecall)).toEqual([false, true]); // the one on the pad cannot be recalled, the hovering one can
    t.state[2] = HELI_PAD;
    expect(ownHeliRows(fakeView(t), 0, []).map((r) => r.canRecall)).toEqual([false, false]);
  });
});

describe('heliPanelInfo', () => {
  it("the build queue of THIS Factory only, rounded up and never below one second; the fleet and the cap of the seat (mutants: another Factory's queue, floor)", () => {
    const s = createState({ width: 64, height: 32, seed: 1, seats: 2, config: {}, terrain: new Uint8Array(64 * 32).fill(CLASS_PLAINS), elevation: new Uint16Array(64 * 32), maxElev: new Int16Array(64 * 32) });
    for (let c = 0; c < 64 * 32; c++) s.owner[c] = 1;
    const f1 = s.structures.add(STRUCT_FACTORY, 1, 100, 0);
    const f2 = s.structures.add(STRUCT_FACTORY, 1, 200, 0);
    s.tick = 50;
    s.helis.addBuilding(1, f1, 40, 50 + 15); // 15 ticks left = 2 s (1.5 rounded up)
    s.helis.addBuilding(1, f2, 40, 50 + 1); // 1 tick left of ANOTHER Factory
    const view = new StateView(s);
    const a = heliPanelInfo(view, 0, f1);
    expect(a.queueSeconds).toBe(Math.ceil(15 / TICK_HZ));
    expect(heliPanelInfo(view, 0, f2).queueSeconds).toBe(1); // 0.1 s left is shown as 1 s
    expect(heliPanelInfo(view, 0, 99).queueSeconds).toBe(0);
    expect(a.fleet).toBe(2);
    expect(a.cap).toBeGreaterThanOrEqual(2);
  });
});

describe('MissionWatcher (landing / loss news)', () => {
  it('a landing is the leave of HELI_UNLOAD, a loss the entry into HELI_DOWNED; the first look, an unchanged version and a reused id say nothing (mutants: news on the first look, on every version, for a reused id)', () => {
    const t = new HeliTable(OWNERS);
    const id = t.addBuilding(1, 3, 0, 0);
    t.state[id] = HELI_UNLOAD;
    const w = new MissionWatcher();
    const v = fakeView(t);
    expect(w.update(v, 1, 0)).toBe(0); // the first look
    expect(w.update(v, 1, 0)).toBe(0);
    t.state[id] = HELI_RETURN;
    expect(w.update(v, 1, 0)).toBe(0); // same version: no work, no news
    expect(w.update(v, 2, 0)).toBe(MISSION_LANDED);
    expect(w.update(v, 3, 0)).toBe(0); // the news is given once, not on every version
    t.state[id] = HELI_DOWNED;
    expect(w.update(v, 4, 0)).toBe(MISSION_LOST);
    expect(w.update(v, 5, 0)).toBe(0);
    // a helicopter that leaves the hover (a recall) has not landed
    const t2 = new HeliTable(OWNERS);
    const h2 = t2.addBuilding(1, 3, 0, 0);
    t2.state[h2] = HELI_HOVER;
    const w2 = new MissionWatcher();
    w2.update(fakeView(t2), 1, 0);
    t2.state[h2] = HELI_RETURN;
    expect(w2.update(fakeView(t2), 2, 0)).toBe(0);
    // the id is reused: seat 1's helicopter was unloading in the slot, now OUR helicopter sits in it in another state: that is no landing of ours
    const t3 = new HeliTable(OWNERS);
    const h3 = t3.addBuilding(2, 3, 0, 0);
    t3.state[h3] = HELI_UNLOAD;
    const w3 = new MissionWatcher();
    w3.update(fakeView(t3), 1, 0);
    t3.owner[h3] = 1;
    t3.state[h3] = HELI_RETURN;
    expect(w3.update(fakeView(t3), 2, 0)).toBe(0);
    // another seat's landing is not ours
    const t4 = new HeliTable(OWNERS);
    const h4 = t4.addBuilding(2, 3, 0, 0);
    t4.state[h4] = HELI_UNLOAD;
    const w4 = new MissionWatcher();
    w4.update(fakeView(t4), 1, 0);
    t4.state[h4] = HELI_RETURN;
    expect(w4.update(fakeView(t4), 2, 0)).toBe(0);
    // reset starts over with a first look
    w.reset();
    t.state[id] = HELI_UNLOAD;
    expect(w.update(v, 6, 0)).toBe(0);
  });
});

describe('HeliWatcher (produced / scrapped news)', () => {
  it('a build that finished is "produced", a build that vanished is "scrapped"; growth alone and the first look are not news (mutants: news on any growth, on the first look)', () => {
    const t = new HeliTable(OWNERS);
    const w = new HeliWatcher();
    const v = fakeView(t);
    const a = t.addBuilding(1, 3, 0, 100);
    expect(w.update(v, 1, 0)).toBeNull(); // the first look, even though a build is under way
    expect(w.update(v, 1, 0)).toBeNull();
    t.addBuilding(1, 5, 0, 100); // a second build starts: the fleet grew, but nothing finished
    expect(w.update(v, 2, 0)).toBeNull();
    const extra = t.addBuilding(1, 7, 0, 100);
    t.state[extra] = HELI_PAD; // a helicopter that simply appears READY (nothing was under production for it): the fleet grew, nothing finished
    expect(w.update(v, 3, 0)).toBeNull();
    t.state[a] = HELI_PAD; // one finished
    expect(w.update(v, 4, 0)).toBe('produced');
    expect(w.update(v, 5, 0)).toBeNull();
    t.remove(1); // the other build is scrapped (its Factory went)
    expect(w.update(v, 6, 0)).toBe('scrapped');
    // somebody else's helicopter changing is not ours
    t.addBuilding(2, 3, 0, 100);
    expect(w.update(v, 7, 0)).toBeNull();
    t.state[2] = HELI_PAD;
    expect(w.update(v, 8, 0)).toBeNull();
    w.reset();
    expect(w.update(v, 9, 0)).toBeNull();
  });
});
