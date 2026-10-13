import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const text = fs.readFileSync('docs/PREVIEW.md', 'utf8');

describe('docs/PREVIEW.md (Swedish guide)', () => {
  it('is written in Swedish and has numbered steps', () => {
    for (const word of ['Förhandsvisning', 'Vald väg och skäl', 'Uppdateringsproceduren', 'ladda om fliken', 'Resultat per prövad väg']) {
      expect(text, word).toContain(word);
    }
    expect(text).toMatch(/^1\. /m);
    expect(text).toMatch(/^33\. /m);
  });

  it('names the Artifact URL (or its placeholder) and a result for Netlify and for local running', () => {
    expect(/<ARTIFACT_URL>|https:\/\/claude\.ai\/\S+/.test(text)).toBe(true);
    expect(text).toMatch(/Netlify \| EJ MÖJLIG/);
    expect(text).toMatch(/Lokalt: `npm ci && npm run dev` \| fungerade/);
  });

  it('spells out the update procedure commands and the hash table', () => {
    for (const needle of ['npm run build && npm run artifact:pack', '--prev=', 'files.json', '`list`', '`read`', '?x=y', '#x-y', 'Homerun5320/Spel', 'Node.js 22 LTS', 'GitHub Desktop', 'npm ci', 'npm run dev', 'package-lock.json', 'F2']) {
      expect(text, needle).toContain(needle);
    }
  });
});
