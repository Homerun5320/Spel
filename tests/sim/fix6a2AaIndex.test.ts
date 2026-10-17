// Fix-6A2 [1.8]: AaIndex.collect with a SAM site (the largest radius: a level 4 SAM on a mountain), on worlds narrow enough that the merge and wrap branches are entered
// (2 * maxR + 33 > width), against an oracle: every indexed structure within the wrapped column distance maxR (same row) is collected, and none twice.
import { describe, expect, it } from 'vitest';
import { AaIndex } from '../../src/sim/airDefense';
import { createState, type GameState } from '../../src/sim/state';
import { samRadiusCells } from '../../src/sim/structureEffects';
import { STRUCT_POST, STRUCT_SAM } from '../../src/sim/structureRules';
import { CLASS_MOUNTAIN, CLASS_PLAINS } from '../../src/sim/terrain';

const H = 64;
const ROW = 20;

function world(w: number, samX: number, postX: number | null): GameState {
  const terrain = new Uint8Array(w * H).fill(CLASS_PLAINS);
  terrain[ROW * w + samX] = CLASS_MOUNTAIN;
  const s = createState({ width: w, height: H, seed: 1, seats: 2, config: { debugIntents: true }, terrain, elevation: new Uint16Array(w * H).fill(5), maxElev: new Int16Array(w * H).fill(5) });
  const sam = s.structures.add(STRUCT_SAM, 2, ROW * w + samX, s.tick);
  s.structures.readyTick[sam] = s.tick;
  s.structures.level[sam] = 4;
  if (postX !== null) {
    const post = s.structures.add(STRUCT_POST, 2, ROW * w + postX, s.tick);
    s.structures.readyTick[post] = s.tick;
  }
  return s;
}

describe('AaIndex.collect with SAM sites', () => {
  const R = samRadiusCells(4, true);

  it('the level 4 mountain SAM is the radius that makes narrow worlds merge (sanity of the setup)', () => {
    expect(R).toBeGreaterThan(30);
  });

  it('finds every structure within the wrapped distance maxR, exactly once, on widths around 2 * maxR (merge and wrap branches), for every site column and query column', () => {
    const out = new Int32Array(64);
    let merged = 0;
    for (let w = 2 * R - 4; w <= 2 * R + 40; w++) {
      for (let samX = 0; samX < w; samX += samX < 4 || samX > w - 6 ? 1 : 9) {
        const postX = (samX + 7) % w;
        const s = world(w, samX, postX);
        const idx = new AaIndex(w, H);
        expect(idx.rebuild(s, false)).toBe(2);
        expect(idx.maxR).toBe(R);
        for (let cx = 0; cx < w; cx++) {
          const n = idx.collect(w, cx, ROW, out);
          const got = Array.from(out.subarray(0, n));
          expect(new Set(got).size, `w ${w} sam ${samX} cx ${cx}: duplicate ids`).toBe(n);
          for (const [id, x] of [[0, samX], [1, postX]] as const) {
            let dx = Math.abs(x - cx);
            if (dx > w - dx) dx = w - dx;
            if (dx <= R) expect(got, `w ${w} sam ${samX} cx ${cx} id ${id}`).toContain(id);
          }
          // tightness: a collected structure sits in a bucket that has at least one column within the wrapped distance maxR (no needless bucket is visited)
          for (const [id, x] of [[0, samX], [1, postX]] as const) {
            if (!got.includes(id)) continue;
            const b0 = Math.floor(x / 32) * 32;
            let near = false;
            for (let c = b0; c < Math.min(w, b0 + 32); c++) {
              let dx = Math.abs(c - cx);
              if (dx > w - dx) dx = w - dx;
              if (dx <= R) near = true;
            }
            expect(near, `w ${w} sam ${samX} cx ${cx} id ${id}: needless bucket`).toBe(true);
          }
          if (n === 2 && w < 2 * R + 33) merged++;
        }
      }
    }
    expect(merged).toBeGreaterThan(1000); // the narrow worlds did take the merged ranges
  });
});
