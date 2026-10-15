// M11b: debug/viewshed.html is a Vite entry, uses relative addresses only, and is linked from the Dev panel by a RELATIVE link.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { clearDevModes, devModes } from '../src/app/devpanel';
import { registerAppModes } from '../src/app/modes';

describe('debug/viewshed.html', () => {
  it('is a Vite entry with a relative script address and no absolute /debug address anywhere', () => {
    const page = fs.readFileSync('debug/viewshed.html', 'utf8');
    expect(page).toContain('src="../src/app/debugViewshed.ts"');
    expect(page).not.toMatch(/(?:href|src)="\//);
    expect(fs.readFileSync('vite.config.ts', 'utf8')).toContain("debug/viewshed.html");
    const script = fs.readFileSync('src/app/debugViewshed.ts', 'utf8');
    expect(script).not.toMatch(/['"`]\/debug/);
    expect(script).toContain("siteUrl('data/manifest.json')");
  });

  it('is registered in the Dev panel with the relative link ./debug/viewshed.html', () => {
    clearDevModes();
    registerAppModes();
    expect(devModes().find((m) => m.id === 'debug-viewshed')?.href).toBe('./debug/viewshed.html');
  });
});
