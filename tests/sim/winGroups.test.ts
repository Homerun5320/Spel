// M18b-3: the win rules count GROUPS (a federation = seats linked by federation-bound alliances). Every condition with and without a federation, the
// elimination of one member versus the whole group, the anti-snowball price of a federation against one nation of the same size, serialisation and the view.
// Worlds are tiny with uniform weights (see win.test.ts): 400 cells, 1 percent = 4 cells.
import { describe, expect, it } from 'vitest';
import { bindFederation } from '../../src/sim/diplomacy';
import { federationRoots } from '../../src/sim/groups';
import { fillMatchView, groupMembers, matchPackedLength, matchViewOf } from '../../src/sim/matchView';
import { WIN_REASON_LAND, WIN_REASON_LAST, WIN_REASON_SCORE, type WinConfig } from '../../src/sim/matchState';
import { LEADER_COST_PCT_HIGH, LEADER_COST_PCT_MID, WEIGHT_ONE } from '../../src/sim/rules';
import { deserialize, hashState, serialize } from '../../src/sim/serialize';
import { createState, type GameState } from '../../src/sim/state';
import { step } from '../../src/sim/step';
import { setOwner } from '../../src/sim/territory';
import { CLASS_PLAINS } from '../../src/sim/terrain';
import { leaderCostPct } from '../../src/sim/win';

const W = 20;
const H = 20;
const CELLS = W * H;
const only = (k: 'land' | 'last' | 'score', extra: Partial<WinConfig> = {}): WinConfig => ({ land: false, last: false, score: false, timeLimitTicks: 1000, landSharePct: 60, holdTicks: 3, ...extra, [k]: true });

function world(seats: number, players: number, win: WinConfig): GameState {
  return createState({
    width: W,
    height: H,
    seed: 5,
    seats,
    players,
    rowCos: new Uint16Array(H).fill(WEIGHT_ONE),
    config: { debugIntents: true, win },
    terrain: new Uint8Array(CELLS).fill(CLASS_PLAINS),
    elevation: new Uint16Array(CELLS),
  });
}
function paint(s: GameState, owner: number, from: number, to: number): void {
  for (let c = from; c < to; c++) setOwner(s, c, owner, 0);
}
function tick(s: GameState, n = 1): void {
  for (let i = 0; i < n; i++) expect(step(s, { turn: s.tick, intents: [] }).ok).toBe(true);
}
/** Seats are 0-based in bindFederation. */
const fed = (s: GameState, ...seats: number[]): void => {
  for (let i = 0; i < seats.length; i++) for (let j = i + 1; j < seats.length; j++) bindFederation(s, seats[i] as number, seats[j] as number);
};

describe('the group concept', () => {
  it('is null without a bound pair and the lowest ownerId per component with them', () => {
    const s = world(5, 5, only('land'));
    expect(federationRoots(s)).toBeNull();
    fed(s, 1, 2); // owners 2 and 3
    fed(s, 3, 4); // owners 4 and 5
    const r = federationRoots(s) as Uint16Array;
    expect(Array.from(r.subarray(1, 6))).toEqual([1, 2, 2, 4, 4]);
    bindFederation(s, 2, 3); // chains the two federations: owners 3 and 4
    expect(Array.from((federationRoots(s) as Uint16Array).subarray(1, 6))).toEqual([1, 2, 2, 2, 2]);
  });
});

describe('condition (a): land of the group', () => {
  it('two members with 35 % each hold the 60 % requirement together and win as the root; without the federation nobody wins', () => {
    for (const federated of [true, false]) {
      const s = world(3, 3, only('land'));
      if (federated) fed(s, 0, 1);
      paint(s, 1, 0, 140);
      paint(s, 2, 140, 280);
      paint(s, 3, 280, 400);
      tick(s, 5);
      expect(s.match.ended).toBe(federated ? 1 : 0);
      if (federated) {
        expect(s.match.winner).toBe(1);
        expect(s.match.reason).toBe(WIN_REASON_LAND);
        expect(s.match.holdOwner).toBe(1);
      }
    }
  });
  it('the hold timer follows the group: it resets when the summed land falls below the requirement', () => {
    const s = world(3, 3, only('land', { holdTicks: 100 }));
    fed(s, 0, 1);
    paint(s, 1, 0, 140);
    paint(s, 2, 140, 280);
    paint(s, 3, 280, 400);
    tick(s, 4);
    expect(s.match.holdOwner).toBe(1);
    expect(s.match.holdCount).toBe(4);
    paint(s, 3, 140, 160); // the second member loses 60 cells: 220 of 400 = 55 %, below the 60 % requirement
    paint(s, 3, 160, 200);
    tick(s);
    expect(s.match.holdOwner).toBe(0);
    expect(s.match.holdCount).toBe(0);
  });
});

describe('condition (b): last alive', () => {
  it('a federation alone against nobody ends the match with its root; two separate seats do not', () => {
    for (const federated of [true, false]) {
      const s = world(3, 3, only('last'));
      if (federated) fed(s, 0, 1);
      paint(s, 1, 0, 100);
      paint(s, 2, 100, 200);
      paint(s, 3, 200, 300);
      tick(s, 2);
      for (let c = 200; c < 300; c++) setOwner(s, c, 0, 0);
      tick(s);
      expect(s.match.eliminated[3]).toBe(1);
      expect(s.match.ended).toBe(federated ? 1 : 0);
      if (federated) {
        expect(s.match.winner).toBe(1);
        expect(s.match.reason).toBe(WIN_REASON_LAST);
      }
    }
  });
  it('the elimination of ONE member is per seat: it leaves its group, the group stays and the match goes on', () => {
    const s = world(4, 4, only('last'));
    fed(s, 0, 1);
    paint(s, 1, 0, 100);
    paint(s, 2, 100, 200);
    paint(s, 3, 200, 300);
    paint(s, 4, 300, 400);
    tick(s, 2);
    for (let c = 100; c < 200; c++) setOwner(s, c, 0, 0);
    tick(s);
    expect(s.match.eliminated[2]).toBe(1);
    expect(s.match.eliminated[1]).toBe(0);
    expect(s.match.ended).toBe(0);
    expect(federationRoots(s)).toBeNull(); // the pair went with the eliminated seat
    for (let c = 200; c < 400; c++) setOwner(s, c, 0, 0);
    tick(s);
    expect(s.match.ended).toBe(1);
    expect(s.match.winner).toBe(1);
  });
  it('the whole group eliminated: the other seat wins', () => {
    const s = world(3, 3, only('last'));
    fed(s, 0, 1);
    paint(s, 1, 0, 100);
    paint(s, 2, 100, 200);
    paint(s, 3, 200, 300);
    tick(s, 2);
    for (let c = 0; c < 200; c++) setOwner(s, c, 0, 0);
    tick(s);
    expect(s.match.ended).toBe(1);
    expect(s.match.winner).toBe(3);
  });
});

describe('condition (c): the score of the group', () => {
  it('two members of 100 cells each beat one nation of 150 cells; without the federation the nation wins', () => {
    for (const federated of [true, false]) {
      const s = world(3, 3, only('score', { timeLimitTicks: 4 }));
      if (federated) fed(s, 0, 1);
      paint(s, 1, 0, 100);
      paint(s, 2, 100, 200);
      paint(s, 3, 200, 350);
      tick(s, 4);
      expect(s.match.ended).toBe(1);
      expect(s.match.reason).toBe(WIN_REASON_SCORE);
      expect(s.match.winner).toBe(federated ? 1 : 3);
    }
  });
});

describe('anti-snowball: the group share prices every member', () => {
  it('a federation of four with 40 % together costs the same as one nation with 40 %, and a federation of 10 % members is not discounted', () => {
    const f = world(5, 5, only('land'));
    fed(f, 0, 1, 2, 3);
    for (let i = 0; i < 4; i++) paint(f, i + 1, i * 40, i * 40 + 40); // 160 cells = 40 % over four owners (10 % each)
    paint(f, 5, 200, 300);
    const single = world(2, 2, only('land'));
    paint(single, 1, 0, 160);
    paint(single, 2, 200, 300);
    const nation = leaderCostPct(single, 1);
    expect(nation).toBe(LEADER_COST_PCT_MID);
    for (let o = 1; o <= 4; o++) expect(leaderCostPct(f, o)).toBe(nation);
    expect(leaderCostPct(f, 5)).toBe(100); // 25 % alone, below the mid threshold
    // The same four seats without the federation are plain 10 % nations: no discount (this is what the group share prevents).
    const loose = world(5, 5, only('land'));
    for (let i = 0; i < 4; i++) paint(loose, i + 1, i * 40, i * 40 + 40);
    for (let o = 1; o <= 4; o++) expect(leaderCostPct(loose, o)).toBe(100);
    // And above the high threshold the federation is priced like the nation too.
    const big = world(3, 3, only('land'));
    fed(big, 0, 1);
    paint(big, 1, 0, 150);
    paint(big, 2, 150, 300);
    paint(big, 3, 300, 400);
    expect(leaderCostPct(big, 2)).toBe(LEADER_COST_PCT_HIGH);
  });
});

describe('the view, serialisation and snapshots', () => {
  it('the packed view carries the group per seat and the leader and the winner are group roots', () => {
    const s = world(4, 4, only('land'));
    fed(s, 1, 2);
    paint(s, 1, 0, 60);
    paint(s, 2, 60, 120);
    paint(s, 3, 120, 180);
    paint(s, 4, 180, 220);
    const out = new Uint32Array(matchPackedLength(4));
    fillMatchView(s, out, new Uint32Array(5));
    const v = matchViewOf(4, out);
    expect(Array.from(v.group)).toEqual([0, 1, 1, 3]);
    expect(groupMembers(v, 2)).toEqual([1, 2]);
    expect(groupMembers(v, 0)).toEqual([0]);
    expect(v.leaderSeat).toBe(1); // seats 1 and 2 together hold 120 cells, more than seat 0 alone (60)
  });
  it('a match with a federation survives a round trip and a snapshot continues to the same hash', () => {
    const s = world(3, 3, only('land', { holdTicks: 50 }));
    fed(s, 0, 1);
    paint(s, 1, 0, 140);
    paint(s, 2, 140, 280);
    paint(s, 3, 280, 400);
    tick(s, 10);
    const bytes = serialize(s);
    const r = deserialize(bytes);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(hashState(r.state)).toBe(hashState(s));
    expect(r.state.match.holdCount).toBe(10);
    tick(s, 45);
    tick(r.state, 45);
    expect(s.match.ended).toBe(1);
    expect(hashState(r.state)).toBe(hashState(s));
    expect(r.state.match.winner).toBe(1);
  });
});
