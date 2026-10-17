// The selection table of the setup screen: which country ids the terrain shader outlines.
import { describe, expect, it } from 'vitest';
import { SELECTION_SIZE, selectionBytes } from '../../src/render/selection';

describe('selectionBytes', () => {
  it('marks exactly the ids asked for (red and alpha 255), clears the rest, and ignores ids outside 1..255', () => {
    const b = selectionBytes([3, 17, 255, 0, -4, 256, 2.5]);
    expect(b.length).toBe(SELECTION_SIZE * 4);
    const on: number[] = [];
    for (let i = 0; i < SELECTION_SIZE; i++) if (b[i * 4] === 255) on.push(i);
    expect(on).toEqual([3, 17, 255]);
    for (const i of on) expect(b[i * 4 + 3]).toBe(255);
    expect(b[0]).toBe(0);
  });

  it('writes into a given buffer and a second call replaces the first (a new selection clears the old one)', () => {
    const buf = new Uint8Array(SELECTION_SIZE * 4);
    selectionBytes([5], buf);
    expect(buf[5 * 4]).toBe(255);
    selectionBytes([6], buf);
    expect(buf[5 * 4]).toBe(0);
    expect(buf[6 * 4]).toBe(255);
    selectionBytes([], buf);
    expect(buf.every((x) => x === 0)).toBe(true);
  });
});
