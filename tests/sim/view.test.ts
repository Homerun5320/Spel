// The per-seat statistics of the sim view (fillSeatStats), pinned against the sim itself: the unit of the gold income per second
// is the one thing a HUD that reads both sides from the same number cannot check, so it is checked here against what the economy
// really adds to the gold over one second of ticks.
import { describe, expect, it } from 'vitest';
import { applyStartValues, ownerCapQt } from '../../src/sim/economy';
import { START_GOLD_MILLI, START_TROOPS_QT, TICK_HZ } from '../../src/sim/rules';
import { step } from '../../src/sim/step';
import { setOwner } from '../../src/sim/territory';
import { fillSeatStats, statIndex, statsLength, statsViewOf } from '../../src/sim/view';
import { landState } from './helpers/worlds';

function twoSeatsAndATribe() {
  const s = landState(40, 20, { seats: 4, players: 2 }); // seats 0 and 1 are players, seats 2 and 3 tribes
  for (let y = 0; y < 14; y++) for (let x = 0; x < 14; x++) setOwner(s, y * 40 + x, 1, 0); // seat 0: 196 cells
  for (let y = 0; y < 8; y++) for (let x = 20; x < 28; x++) setOwner(s, y * 40 + x, 3, 0); // seat 2, a tribe: 64 cells
  applyStartValues(s, 1);
  applyStartValues(s, 3);
  return s;
}

describe('fillSeatStats', () => {
  it('goldPerSecMilli is milli-gold PER SECOND: over exactly TICK_HZ ticks without an attack the gold grows by exactly that amount, for a player and for a tribe', () => {
    const s = twoSeatsAndATribe();
    const out = new Uint32Array(statsLength(4));
    fillSeatStats(s, out);
    const rate = (seat: number): number => out[statIndex('goldPerSecMilli', 4, seat)] as number;
    const gold = (seat: number): number => out[statIndex('goldMilli', 4, seat)] as number;
    expect(rate(0)).toBeGreaterThan(0);
    expect(rate(2)).toBeGreaterThan(0);
    expect(rate(0)).toBeGreaterThan(rate(2)); // more land, more income
    const before = [gold(0), gold(2)];
    expect(before).toEqual([START_GOLD_MILLI, START_GOLD_MILLI]);
    for (let i = 0; i < TICK_HZ; i++) step(s, { turn: s.tick, intents: [] });
    expect(s.tick).toBe(TICK_HZ);
    fillSeatStats(s, out);
    expect(gold(0) - (before[0] as number)).toBe(rate(0));
    expect(gold(2) - (before[1] as number)).toBe(rate(2));
    // a second of 196 cells of land is a few tenths of a gold, nothing like ten times that or a tenth of it
    expect(rate(0)).toBeGreaterThan(1000 * 0.5);
    expect(rate(0)).toBeLessThan(1000 * 20);
  });

  it('a seat with no land has no income, no cap and no share, and the other fields are the sim\'s own numbers', () => {
    const s = twoSeatsAndATribe();
    const out = new Uint32Array(statsLength(4));
    fillSeatStats(s, out);
    const v = statsViewOf(4, out);
    expect([v.goldPerSecMilli[1], v.capQt[1], v.landShareQ15[1], v.cells[1], v.alive[1], v.capital[1]]).toEqual([0, 0, 0, 0, 0, 0]);
    expect([v.cells[0], v.alive[0], v.troopsQt[0], v.capQt[0]]).toEqual([196, 1, START_TROOPS_QT, ownerCapQt(s, 1)]);
    expect(v.cells[2]).toBe(64);
    expect(v.capQt[2]).toBe(ownerCapQt(s, 3));
  });
});
