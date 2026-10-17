import { describe, expect, it } from 'vitest';
import { ROOT_URL, joinSiteUrl, siteUrl } from '../src/app/paths';

describe('siteUrl', () => {
  it('joinSiteUrl resolves against a root and ignores leading slashes', () => {
    expect(joinSiteUrl('https://h.example/_f/abc/', 'data/manifest.json')).toBe('https://h.example/_f/abc/data/manifest.json');
    expect(joinSiteUrl('https://h.example/_f/abc/', '/probe.html')).toBe('https://h.example/_f/abc/probe.html');
    expect(joinSiteUrl('http://127.0.0.1:5000/x/y/', 'a/b.png')).toBe('http://127.0.0.1:5000/x/y/a/b.png');
  });

  it('ROOT_URL ends with a slash and siteUrl builds on it', () => {
    expect(ROOT_URL.endsWith('/')).toBe(true);
    expect(siteUrl('data/x.json')).toBe(`${ROOT_URL}data/x.json`);
  });
});
