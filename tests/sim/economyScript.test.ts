// M09 part B: the economy script (tools/sim/scenario.ts) on the real world. (a) the build-free scripted expander is still inside the M04 band;
// (b) AI v0 with its build move in the same solo scenario. The asked factor is [1.0, 1.5] of the band's upper limit after 10 minutes. M09b
// missed it (0.90); M09c met it (AI_EXPAND_TROOP_PCT 40 -> 37, the AI upgrades when rich, build places without a foreign neighbour: D-M09c in
// docs/DECISIONS.md). The factor is logged in docs/BALANCE.md.
import { describe, expect, it } from 'vitest';
import { SOLO_BAND } from '../../tools/sim/bands';
import { parseArgs, runScenario } from '../../tools/sim/scenario';
import { BUILD_BASE_GOLD, CITY_GOLD_MILLI_PER_SEC_PER_LEVEL } from '../../src/sim/rules';
import { STRUCT_CITY } from '../../src/sim/structureRules';

describe('the economy script', () => {
  it('(a) the build-free scripted solo expander is still inside the M04 calibration band', async () => {
    const { report } = await runScenario(parseArgs(['--solo', '--minutes', '10', '--country', SOLO_BAND.country, '--seed', String(SOLO_BAND.seed)]));
    const curve = report.rows.map((r) => r.cells[0] as number);
    expect(curve[4]).toBeGreaterThanOrEqual(SOLO_BAND.minute5[0]);
    expect(curve[4]).toBeLessThanOrEqual(SOLO_BAND.minute5[1]);
    expect(curve[9]).toBeGreaterThanOrEqual(SOLO_BAND.minute10[0]);
    expect(curve[9]).toBeLessThanOrEqual(SOLO_BAND.minute10[1]);
    expect(report.rows.every((r) => (r.structures[0] as number[]).every((n) => n === 0))).toBe(true); // the scripted bot builds nothing
  }, 120000);

  it('(b) AI v0 with building: land after 10 minutes is 1.0 to 1.5 times the upper limit of the band, income per minute only rises, a City pays back in at least 3 minutes, and it really builds', async () => {
    const { report } = await runScenario(parseArgs(['--solo', '--ai', '--minutes', '10', '--country', SOLO_BAND.country, '--seed', String(SOLO_BAND.seed)]));
    const land = report.rows.map((r) => r.cells[0] as number);
    const income = report.rows.map((r) => r.incomeGoldPerMin[0] as number);
    const factor = (land[9] as number) / SOLO_BAND.minute10[1];
    console.log(`[economy script] AI v0 with building, ${SOLO_BAND.country} solo: land per minute ${land.join(' ')}; income gold/min ${income.join(' ')}; factor against the band's upper limit ${factor.toFixed(2)}`);
    expect(factor).toBeGreaterThanOrEqual(1.0);
    expect(factor).toBeLessThanOrEqual(1.5);
    for (let m = 1; m < income.length; m++) expect(income[m], `minute ${m + 1}`).toBeGreaterThan(income[m - 1] as number);
    const cities = (report.rows[9]?.structures[0] as number[])[0] as number;
    expect(cities, 'Cities after 10 minutes').toBeGreaterThanOrEqual(5);
    const payBackMinutes = (BUILD_BASE_GOLD[STRUCT_CITY] as number) / ((CITY_GOLD_MILLI_PER_SEC_PER_LEVEL * 60) / 1000);
    expect(payBackMinutes).toBeGreaterThanOrEqual(3);
    expect(report.rejects, 'the AI never sends a Build or Upgrade the sim refuses').toBe(0);
  }, 120000);
});
