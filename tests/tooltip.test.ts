import { describe, expect, it } from 'vitest';
import { CLASS_LABEL_SV, countryNameMap, formatMetres, tooltipText } from '../src/app/tooltip';
import { TERRAIN_CLASS_NAMES } from '../src/data';
import { worldLoader } from './helpers/dataFiles';

describe('hover tooltip text', () => {
  it('formats metres with a thin plain space as thousands separator and a minus sign', () => {
    expect(formatMetres(0)).toBe('0 m');
    expect(formatMetres(8848.4)).toBe('8 848 m');
    expect(formatMetres(-3520.2)).toBe('-3 520 m');
    expect(formatMetres(123)).toBe('123 m');
    expect(formatMetres(1000000)).toBe('1 000 000 m');
  });

  it('has a label for every terrain class', () => {
    expect(CLASS_LABEL_SV.length).toBe(TERRAIN_CLASS_NAMES.length);
  });

  it('names land by country, class and height, and the sea without a country', async () => {
    const meta = await worldLoader().loadMeta();
    const names = countryNameMap(meta);
    const swe = meta.countries.find((c) => c.a3 === 'SWE');
    expect(swe).toBeDefined();
    expect(tooltipText({ classId: 3, countryId: swe?.id as number, elevationM: 123.4 }, names)).toBe('Sverige · Skog · 123 m');
    expect(tooltipText({ classId: 0, countryId: 0, elevationM: -3520 }, names)).toBe('Hav · Djuphav · -3 520 m');
    expect(tooltipText({ classId: 2, countryId: 0, elevationM: 5 }, names)).toBe('Okänt land · Slätt · 5 m');
  });
});
