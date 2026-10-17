import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CLASS_COLORS, countryColor, heightColor, parseMapMode } from '../src/app/debugPalette';

describe('parseMapMode', () => {
  it('reads the anchor form first, then ?map=, default class', () => {
    expect(parseMapMode('', '#map-height')).toBe('height');
    expect(parseMapMode('', 'map-country')).toBe('country');
    expect(parseMapMode('?map=country', '')).toBe('country');
    expect(parseMapMode('?map=height', '#map-class')).toBe('class');
    expect(parseMapMode('', '')).toBe('class');
    expect(parseMapMode('?map=nope', '#map-nope')).toBe('class');
    expect(parseMapMode('?a=1&map=height', '#other')).toBe('height');
  });
});

describe('palette', () => {
  it('class colours are distinct and there is one per class', () => {
    expect(CLASS_COLORS.length).toBe(8);
    expect(new Set(CLASS_COLORS.map((c) => c.join(','))).size).toBe(8);
  });
  it('height and country colours are valid bytes and differ', () => {
    for (const c of [heightColor(-5000), heightColor(0), heightColor(3000), heightColor(8000), countryColor(0), countryColor(1), countryColor(200)]) {
      for (const v of c) expect(v >= 0 && v <= 255 && Number.isInteger(v)).toBe(true);
    }
    expect(heightColor(-5000).join()).not.toBe(heightColor(5000).join());
    expect(countryColor(1).join()).not.toBe(countryColor(2).join());
  });
});

describe('index.html debug link row', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  it('has the three RELATIVE links and no absolute /debug/ address', () => {
    expect(html).toContain('Debug: <a href="./debug/data.html#map-class">klasskarta</a> / <a href="./debug/data.html#map-height">höjdkarta</a> / <a href="./debug/data.html#map-country">landkarta</a>');
    expect(html).not.toMatch(/(?:href|src)="\/debug/);
  });
  it('debug/data.html is a Vite entry and uses a relative script address', () => {
    const page = fs.readFileSync('debug/data.html', 'utf8');
    expect(page).toContain('src="../src/app/debugData.ts"');
    expect(page).not.toMatch(/(?:href|src)="\//);
    expect(fs.readFileSync('vite.config.ts', 'utf8')).toContain("debug/data.html");
  });
});
