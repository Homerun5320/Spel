// Fix-6A2: audit 5 mutation holes. Each test fails on the one-line mutant named in docs/DECISIONS.md (Fix-6A2).
import { describe, expect, it } from 'vitest';
import { losOf, navViewOf } from '../../src/sim/access';
import { bindFederation } from '../../src/sim/diplomacy';
import { ALT_MODE_LOW } from '../../src/sim/los/cache';
import type { WinConfig } from '../../src/sim/matchState';
import { WEIGHT_ONE } from '../../src/sim/rules';
import { createState, type GameState } from '../../src/sim/state';
import { step } from '../../src/sim/step';
import { STRUCT_SAM } from '../../src/sim/structureRules';
import { setOwner } from '../../src/sim/territory';
import { CLASS_PLAINS } from '../../src/sim/terrain';
import { federationLineModel } from '../../src/app/federationStarts';

describe('the Los memo sees an OWNER change (conquest of a SAM) inside the tick', () => {
  it('after structures.transfer the same-tick query sees the new owner', () => {
    const W = 64;
    const s = createState({ width: W, height: W, seed: 1, seats: 2, config: { debugIntents: true }, terrain: new Uint8Array(W * W).fill(CLASS_PLAINS), elevation: new Uint16Array(W * W).fill(5), maxElev: new Int16Array(W * W).fill(5) });
    const sam = s.structures.add(STRUCT_SAM, 2, 30 * W + 30, 0);
    s.structures.readyTick[sam] = s.tick;
    const los = losOf(s);
    los.sync(navViewOf(s));
    const near = 30 * W + 32;
    expect(los.detected(2, near, ALT_MODE_LOW)).toBe(true);
    expect(los.detected(1, near, ALT_MODE_LOW)).toBe(false);
    s.structures.transfer(sam, 1, 1); // conquest in phase 2 of the same tick
    los.sync(navViewOf(s));
    expect(los.detected(2, near, ALT_MODE_LOW)).toBe(false);
    expect(los.detected(1, near, ALT_MODE_LOW)).toBe(true);
  });
});

describe('the hold timer moves only when ITS holder is eliminated, and only to a member of the holder\'s own group', () => {
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

  it('a seat of ANOTHER federation is knocked out: the holder and the count are untouched', () => {
    const s = world();
    bindFederation(s, 0, 1); // owners 1 and 2
    bindFederation(s, 2, 3); // owners 3 and 4
    paint(s, 1, 0, 150);
    paint(s, 2, 150, 300);
    paint(s, 3, 300, 380);
    paint(s, 4, 380, 388); // the small one that will fall
    tick(s, 40);
    expect(s.match.holdOwner).toBe(1);
    const before = s.match.holdCount;
    expect(before).toBeGreaterThan(20);
    for (let c = 380; c < 388; c++) setOwner(s, c, 0, 0);
    tick(s, 1);
    expect(s.match.eliminated[4]).toBe(1);
    expect(s.match.holdOwner).toBe(1);
    expect(s.match.holdCount).toBe(before + 1);
  });

  it('the root falls while a lower-numbered OUTSIDER lives: the heir is the next member of the root\'s own group', () => {
    const s = world();
    bindFederation(s, 1, 2); // owners 2 and 3
    paint(s, 2, 0, 8); // the root of {2, 3}
    paint(s, 3, 40, 300);
    paint(s, 1, 300, 340); // an outsider with a LOWER number than the heir
    paint(s, 4, 340, 400);
    tick(s, 50);
    expect(s.match.holdOwner).toBe(2);
    const before = s.match.holdCount;
    expect(before).toBeGreaterThan(20);
    for (let c = 0; c < 8; c++) setOwner(s, c, 0, 0);
    tick(s, 1);
    expect(s.match.eliminated[2]).toBe(1);
    expect(s.match.holdOwner).toBe(3);
    expect(s.match.holdCount).toBe(before + 1); // the count is kept, not restarted
  });
});

describe('the setup line of "Dela upp stormakter" counts exactly', () => {
  it('two startable sub-nations are a federation (one partner); three give two partners and the AI nations on top', () => {
    expect(federationLineModel(2, 1, 10)).toEqual({ key: 'setup.federation.sub', members: 2, ai: 2 });
    expect(federationLineModel(3, 2, 10)).toEqual({ key: 'setup.federation.sub', members: 3, ai: 4 });
    expect(federationLineModel(1, 2, 10).key).toBe('setup.federation.none');
  });
});
