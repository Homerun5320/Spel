// Districts-1: the economy report of the scenario CLI has a districts line per kind (Housing / Market / Barracks / Walls), and in the solo
// AI scenario the AI really builds some by minute 10 while its land stays inside the M09c band (the economy script test holds the band itself).
import { describe, expect, it } from 'vitest';
import { SOLO_BAND } from '../../tools/sim/bands';
import { format, parseArgs, runScenario } from '../../tools/sim/scenario';

describe('the scenario economy report', () => {
  it('prints the districts per kind and the AI has built some after 10 minutes', async () => {
    const { report } = await runScenario(parseArgs(['--solo', '--ai', '--minutes', '10', '--country', SOLO_BAND.country, '--seed', String(SOLO_BAND.seed)]));
    for (const r of report.rows) expect((r.districts[0] as number[]).length).toBe(4);
    const last = report.rows[report.rows.length - 1];
    const counts = last?.districts[0] as number[];
    console.log(`[districts report] minute 10 Housing/Market/Barracks/Walls ${counts.join('/')}; Cities ${(last?.structures[0] as number[])[0]}`);
    expect(counts.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    const text = format(report);
    expect(text).toContain('districts Housing/Market/Barracks/Walls');
    expect(text).toContain(`districts Housing/Market/Barracks/Walls ${counts.join('/')}`);
  }, 120000);
});
