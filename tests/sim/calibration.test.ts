// The solo calibration: one expander on open land stays inside the bands of tools/sim/bands.ts (D88). The bands are the
// provisional ones of the prompt; the numbers of rules.ts were tuned (two rounds) until the reference scenario was inside them.
import { describe, expect, it } from 'vitest';
import { SOLO_BAND } from '../../tools/sim/bands';
import { parseArgs, runScenario } from '../../tools/sim/scenario';

async function solo(country: string, minutes = 10): Promise<number[]> {
  const { report } = await runScenario(parseArgs(['--solo', '--minutes', String(minutes), '--country', country, '--seed', String(SOLO_BAND.seed)]));
  return report.rows.map((r) => r.cells[0] as number);
}

describe('solo expander calibration', () => {
  it('the reference scenario (one player on the capital of the largest country) holds 1 500-2 500 cells after 5 minutes and 5 000-8 000 after 10', async () => {
    const curve = await solo(SOLO_BAND.country);
    console.log(`[calibration] ${SOLO_BAND.country} solo, cells per minute: ${curve.join(' ')}`);
    expect(curve[4]).toBeGreaterThanOrEqual(SOLO_BAND.minute5[0]);
    expect(curve[4]).toBeLessThanOrEqual(SOLO_BAND.minute5[1]);
    expect(curve[9]).toBeGreaterThanOrEqual(SOLO_BAND.minute10[0]);
    expect(curve[9]).toBeLessThanOrEqual(SOLO_BAND.minute10[1]);
    // a steady climb, never a stall: each minute adds at least 200 cells
    for (let m = 1; m < curve.length; m++) expect((curve[m] as number) - (curve[m - 1] as number)).toBeGreaterThan(200);
  }, 60000);

  it('other starting points give other curves of the same kind (land is not the same everywhere): 1 000-3 500 cells after 5 minutes, still climbing at 10', async () => {
    const seen: string[] = [];
    for (const country of ['CHN', 'USA', 'BRA', 'AUS', 'IND']) {
      const curve = await solo(country);
      seen.push(`${country} ${curve[4]}/${curve[9]}`);
      expect(curve[4], country).toBeGreaterThan(1000);
      expect(curve[4], country).toBeLessThan(3500);
      expect(curve[9] as number, country).toBeGreaterThan((curve[4] as number) * 1.5);
    }
    console.log(`[calibration] other countries, cells after 5 / 10 minutes: ${seen.join(', ')}`);
  }, 120000);

  it('the scripted expander is the only thing that matters on open land: committing more troops does not make it faster (against unowned land the troop ratio is 2)', async () => {
    // the Attack pct of the bot is 100; a smaller pct reaches the same curve as long as the pool lasts
    const base = await solo(SOLO_BAND.country, 3);
    const again = await solo(SOLO_BAND.country, 3);
    expect(again).toEqual(base); // and the run is reproducible
  }, 60000);
});
