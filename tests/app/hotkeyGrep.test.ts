// M20a-lite: ONE place listens to the keyboard. Every file under src/ that adds a `keydown` listener must be src/app/input.ts, src/app/hotkeys.ts or on the
// documented exceptions below; a new listener anywhere else turns this test red (the mutant check at the end proves the scan sees one).
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(__dirname, '../../src');

/** The files that may listen, and why (docs/ARCHITECTURE.md "M20a-lite"). */
const ALLOWED: Record<string, string> = {
  'app/input.ts': 'the DOM adapter of the input stack (attachDomKeys)',
  'app/hotkeys.ts': 'the registry: the one listener of the game',
  'app/devpanel.ts': 'debug page: Escape closes the open panel, Enter in its fields (F2 itself is a registry entry)',
  'app/debugViewshed.ts': 'debug page: arrow keys move its own map',
  'app/setupScreen.ts': 'the setup screen owns the keyboard before a match: Enter in the search field and Escape back to the menu',
  'ui/matchPanels.ts': 'the Tab trap inside a modal dialog (scrim element, not the window)',
  'app/main.ts': 'the M00 spike scene (?scene=spike) has its own F3 box',
};

const LISTENER = /addEventListener\(\s*['"`]keydown['"`]|\bonkeydown\b|\.on\(\s*['"`]keydown['"`]/;

function walk(dir: string, out: string[]): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** The files (relative to src/) whose code, comments aside, adds a keydown listener. */
function filesWithKeydownListener(files: readonly { rel: string; text: string }[]): string[] {
  return files
    .filter((f) => LISTENER.test(f.text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')))
    .map((f) => f.rel)
    .sort();
}

const files = walk(SRC, []).map((p) => ({ rel: path.relative(SRC, p).split(path.sep).join('/'), text: fs.readFileSync(p, 'utf8') }));

describe('one keyboard listener', () => {
  it('no file outside input.ts, hotkeys.ts and the documented exceptions listens to keydown', () => {
    const found = filesWithKeydownListener(files);
    expect(found.filter((f) => !(f in ALLOWED))).toEqual([]);
  });
  it('every exception still has its listener (the list does not rot)', () => {
    const found = filesWithKeydownListener(files);
    expect(Object.keys(ALLOWED).filter((f) => !found.includes(f))).toEqual([]);
  });
  it('the scan goes red for a new listener (mutant)', () => {
    const mutant = [...files, { rel: 'ui/newThing.ts', text: "window.addEventListener('keydown', () => {});" }];
    expect(filesWithKeydownListener(mutant)).toContain('ui/newThing.ts');
    const inComment = [...files, { rel: 'ui/quiet.ts', text: "// window.addEventListener('keydown', f)\n/* addEventListener('keydown') */" }];
    expect(filesWithKeydownListener(inComment)).not.toContain('ui/quiet.ts');
  });
});
