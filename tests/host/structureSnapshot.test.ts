// M10: the structure table reaches the page as copies. The mirror's table equals the sim's after every change, a diff carries the table only
// when it changed, mutating the page's copy changes neither the sim nor its hash, and validateBuild / the price work on the mirror.
import { describe, expect, it } from 'vitest';
import { MainThreadHost } from '../../src/host/mainThreadHost';
import type { ClientMessage, HostMessage } from '../../src/host/protocol';
import { RemoteHost, serveHost } from '../../src/host/remote';
import { createLocalTransport } from '../../src/host/transport';
import { structureProgress } from '../../src/host/structureMirror';
import { ViewMirror } from '../../src/host/viewMirror';
import { REJECT_BUILD_GOLD, REJECT_BUILD_SPACING, REJECT_NONE } from '../../src/sim/intents';
import { BUILD_TICKS, MILLI_GOLD_PER_GOLD } from '../../src/sim/rules';
import { hashState } from '../../src/sim/serialize';
import { createState, rebuildAggregates, type GameState } from '../../src/sim/state';
import { STRUCT_CITY, buildPriceMilli, validateBuild } from '../../src/sim/structureRules';
import { CLASS_PLAINS } from '../../src/sim/terrain';

const W = 128;
const H = 64;
const at = (x: number, y: number): number => y * W + x;

function world(): GameState {
  const terrain = new Uint8Array(W * H).fill(CLASS_PLAINS);
  const s = createState({ width: W, height: H, seed: 3, seats: 2, config: { debugIntents: true }, terrain, elevation: new Uint16Array(W * H) });
  s.owner.fill(1);
  rebuildAggregates(s);
  s.gold[1] = 5000 * MILLI_GOLD_PER_GOLD;
  return s;
}

function sameTable(mirror: ViewMirror, state: GameState): void {
  const a = mirror.structures;
  const b = state.structures;
  expect(a.highWater).toBe(b.highWater);
  expect(a.liveCount).toBe(b.liveCount);
  for (let i = 0; i < b.highWater; i++) {
    expect([a.type[i], a.owner[i], a.cell[i], a.level[i], a.buildTick[i], a.readyTick[i], a.upgradeReadyTick[i]], `slot ${i}`).toEqual([
      b.type[i],
      b.owner[i],
      b.cell[i],
      b.level[i],
      b.buildTick[i],
      b.readyTick[i],
      b.upgradeReadyTick[i],
    ]);
    if ((b.owner[i] as number) !== 0) expect(a.idAt(b.cell[i] as number)).toBe(i);
  }
  for (let o = 0; o < 3; o++) {
    expect(a.deleteReadyTick(o)).toBe(b.deleteReadyTick(o));
    expect(a.ownedCount(o, STRUCT_CITY)).toBe(b.ownedCount(o, STRUCT_CITY));
  }
}

describe('the structure table in the snapshot', () => {
  it('equals the sim table after builds, carries it only when it changed, and the page cannot change the sim', async () => {
    const state = world();
    const host = new MainThreadHost(state);
    const { mirror } = await ViewMirror.attach(host);
    sameTable(mirror, state);
    expect(mirror.structures.liveCount).toBe(0);
    const carried: boolean[] = [];
    mirror.onFrame((_, d) => carried.push(d.view.structures !== null));
    host.submitIntent({ kind: 'Build', seat: 0, type: STRUCT_CITY, cell: at(10, 10) });
    host.advance(1000);
    sameTable(mirror, state);
    expect(mirror.structures.liveCount).toBe(1);
    expect(carried.some(Boolean)).toBe(true);
    const v = mirror.structuresVersion;
    carried.length = 0;
    host.advance(1000); // nothing changes in the table
    expect(carried.length).toBeGreaterThan(0);
    expect(carried.every((c) => !c)).toBe(true);
    expect(mirror.structuresVersion).toBe(v);
    // the page scribbles over its copy: the sim and its hash stay
    const before = hashState(state);
    const copy = mirror.structures as unknown as { type: Uint8Array; owner: Uint16Array };
    copy.type.fill(9);
    copy.owner.fill(0);
    expect(hashState(state)).toBe(before);
    expect(state.structures.type[0]).toBe(STRUCT_CITY);
    expect(state.structures.owner[0]).toBe(1);
  });

  it('works over the message port too, and validateBuild plus the escalating price run on the mirror', async () => {
    const state = world();
    const host = new MainThreadHost(state);
    const transport = createLocalTransport<ClientMessage, HostMessage>();
    serveHost(host, transport.host);
    const remote = new RemoteHost(transport.client);
    const att = ViewMirror.attach(remote);
    await transport.idle();
    await Promise.resolve();
    await transport.idle();
    const { mirror } = await att;
    expect(validateBuild(mirror, 0, STRUCT_CITY, at(10, 10))).toBe(REJECT_NONE);
    expect(buildPriceMilli(mirror.structures, 1, STRUCT_CITY)).toBe(400 * MILLI_GOLD_PER_GOLD);
    remote.submitIntent({ kind: 'Build', seat: 0, type: STRUCT_CITY, cell: at(10, 10) });
    remote.advance(1000);
    await transport.idle();
    expect(state.structures.liveCount).toBe(1);
    sameTable(mirror, state);
    expect(buildPriceMilli(mirror.structures, 1, STRUCT_CITY)).toBe(600 * MILLI_GOLD_PER_GOLD);
    expect(validateBuild(mirror, 0, STRUCT_CITY, at(12, 10))).toBe(REJECT_BUILD_SPACING);
    expect(validateBuild(mirror, 0, STRUCT_CITY, at(40, 10))).toBe(REJECT_NONE);
    // progress is a function of the tick: 0 at the start, 1 at the ready tick
    const id = 0;
    expect(structureProgress(mirror.structures, id, mirror.structures.buildTick[id] as number)).toBe(0);
    expect(structureProgress(mirror.structures, id, mirror.structures.readyTick[id] as number)).toBe(1);
    expect((mirror.structures.readyTick[id] as number) - (mirror.structures.buildTick[id] as number)).toBe(BUILD_TICKS[STRUCT_CITY]);
    state.gold[1] = 0;
    const poor = await ViewMirror.attach(host);
    expect(validateBuild(poor.mirror, 0, STRUCT_CITY, at(60, 10))).toBe(REJECT_BUILD_GOLD);
    host.dispose();
  });
});
