// Fix-Sim: structureSignature decides whether the page is told about the structure table, so EVERY column must move it. A conquered level-1
// structure changes only its owner; the start of an Upgrade changes only upgradeReadyTick: both must still reach the page.
import { describe, expect, it } from 'vitest';
import { MainThreadHost } from '../../src/host/mainThreadHost';
import { structureSignature } from '../../src/host/structureSnapshot';
import { ViewMirror } from '../../src/host/viewMirror';
import { MILLI_GOLD_PER_GOLD } from '../../src/sim/rules';
import { createState, rebuildAggregates, type GameState } from '../../src/sim/state';
import { STRUCT_CITY } from '../../src/sim/structureRules';
import { StructureTable } from '../../src/sim/structures';
import { setOwner } from '../../src/sim/territory';
import { CLASS_PLAINS } from '../../src/sim/terrain';

describe('structureSignature', () => {
  it('moves when any single column, either counter or a Delete cooldown changes', () => {
    const t = new StructureTable(64, 3);
    t.add(STRUCT_CITY, 1, 10, 0);
    t.add(STRUCT_CITY, 2, 20, 0);
    const base = structureSignature(t);
    expect(structureSignature(t)).toBe(base);
    const cols = ['owner', 'type', 'cell', 'level', 'buildTick', 'readyTick', 'upgradeReadyTick'] as const;
    for (const c of cols) {
      for (const slot of [0, 1]) {
        const arr = t[c] as unknown as { [i: number]: number };
        const old = arr[slot] as number;
        arr[slot] = old + 1;
        expect(structureSignature(t), `${c}[${slot}]`).not.toBe(base);
        arr[slot] = old;
      }
    }
    t.deleteReady[2] = 5;
    expect(structureSignature(t), 'deleteReady').not.toBe(base);
    t.deleteReady[2] = 0;
    t.liveCount++;
    expect(structureSignature(t), 'liveCount').not.toBe(base);
    t.liveCount--;
    t.highWater++;
    expect(structureSignature(t), 'highWater').not.toBe(base);
    t.highWater--;
    expect(structureSignature(t)).toBe(base);
  });
});

describe('the host tells the page about a conquest and an Upgrade start', () => {
  const W = 128;
  const H = 64;
  const world = (): GameState => {
    const s = createState({ width: W, height: H, seed: 3, seats: 2, config: { debugIntents: true }, terrain: new Uint8Array(W * H).fill(CLASS_PLAINS), elevation: new Uint16Array(W * H) });
    s.owner.fill(1);
    rebuildAggregates(s);
    s.gold[1] = 5000 * MILLI_GOLD_PER_GOLD;
    return s;
  };

  it('a level-1 City taken by the other seat changes only its owner, and the mirror shows the new owner', async () => {
    const state = world();
    const cell = 10 * W + 10;
    state.structures.add(STRUCT_CITY, 1, cell, 0);
    state.tick = 1000;
    const host = new MainThreadHost(state);
    const { mirror } = await ViewMirror.attach(host);
    expect(mirror.structures.owner[0]).toBe(1);
    for (let c = 0; c < W * H; c++) if (c % W < 64) setOwner(state, c, 2, 0); // a big block: a tiny enclave would flip back
    expect(state.structures.owner[0]).toBe(2);
    expect(state.structures.level[0]).toBe(1);
    host.runTicks(10);
    expect(mirror.structures.owner[0]).toBe(2);
    host.dispose();
  });

  it('the start of an Upgrade is shown at once (only upgradeReadyTick changed)', async () => {
    const state = world();
    state.structures.add(STRUCT_CITY, 1, 10 * W + 10, 0);
    state.tick = 1000;
    const host = new MainThreadHost(state);
    const { mirror } = await ViewMirror.attach(host);
    expect(mirror.structures.upgradeReadyTick[0]).toBe(0);
    host.submitIntent({ kind: 'Upgrade', seat: 0, structure: 0 });
    host.runTicks(5);
    expect(state.structures.upgradeReadyTick[0]).toBeGreaterThan(0);
    expect(mirror.structures.upgradeReadyTick[0]).toBe(state.structures.upgradeReadyTick[0]);
    host.dispose();
  });
});
