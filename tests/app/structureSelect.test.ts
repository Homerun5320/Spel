// M10-4: the pure parts of the selection: which structure a click means, the selection mode, the ring and icon numbers, the panel's numbers.
import { describe, expect, it } from 'vitest';
import { createSelectionMode, pickStructure } from '../../src/app/structureSelect';
import { ICON_FADE_PX_HI, STRUCT_MAX_SCALE } from '../../src/render/config';
import { iconSwitchDistanceM, modelRadiusM, modelRadiusPx, selectRingRadiusM, SELECT_RING_FACTOR } from '../../src/render/rings';
import {
  CAP_CITY_LEVEL_TROOPS,
  POST_RADIUS_CELLS,
  REJECT_BUILD_GOLD,
  REJECT_DELETE_COOLDOWN,
  REJECT_STRUCT_BUSY,
  STRUCT_CITY,
  STRUCT_POST,
  STRUCT_SAM,
  samRadiusCells,
  type StructureView,
} from '../../src/sim/public';
import { deleteWhyKey, effectLines, rangeRingCells, upgradeWhyKey } from '../../src/ui/structureInfo';

const W = 64;
const H = 32;

/** A structure table with the given (cell, owner) pairs; ids are the indices. */
function table(entries: Array<[number, number]>): StructureView {
  const byCell = new Map<number, number>();
  entries.forEach(([cell], id) => byCell.set(cell, id));
  return {
    capacity: 100,
    highWater: entries.length,
    liveCount: entries.length,
    type: entries.map(() => STRUCT_CITY),
    owner: entries.map(([, o]) => o),
    cell: entries.map(([c]) => c),
    level: entries.map(() => 1),
    buildTick: entries.map(() => 0),
    readyTick: entries.map(() => 0),
    upgradeReadyTick: entries.map(() => 0),
    idAt: (c: number) => byCell.get(c) ?? -1,
    ownedCount: () => 0,
    deleteReadyTick: () => 0,
  };
}
const at = (x: number, y: number): number => y * W + x;

describe('pickStructure', () => {
  it('takes the structure on the cell, else the nearest own one within one cell, never one two cells away or one of another owner', () => {
    const t = table([
      [at(10, 10), 1],
      [at(20, 10), 1],
      [at(30, 10), 2],
      [at(40, 10), 1],
    ]);
    expect(pickStructure(t, W, H, at(10, 10), 1, 1)).toBe(0);
    expect(pickStructure(t, W, H, at(11, 11), 1, 1)).toBe(0); // diagonal neighbour
    expect(pickStructure(t, W, H, at(12, 10), 1, 1)).toBe(-1); // two cells away
    expect(pickStructure(t, W, H, at(30, 10), 1, 1)).toBe(-1); // somebody else's
    expect(pickStructure(t, W, H, at(31, 10), 1, 1)).toBe(-1);
    expect(pickStructure(t, W, H, at(19, 10), 1, 1)).toBe(1);
  });

  it('the nearest wins, a tie goes to the lowest id, and the world wraps in x', () => {
    const t = table([
      [at(5, 5), 1],
      [at(7, 5), 1],
      [at(63, 20), 1],
    ]);
    expect(pickStructure(t, W, H, at(6, 5), 1, 1)).toBe(0); // both are one cell away: the lowest id
    expect(pickStructure(t, W, H, at(6, 6), 1, 1)).toBe(0);
    expect(pickStructure(t, W, H, at(0, 20), 1, 1)).toBe(2); // wraps
    expect(pickStructure(t, W, H, at(5, 5), 1, 1)).toBe(0);
  });
});

describe('pickStructure: neighbourhood rules', () => {
  it('a click on neutral or enemy land beside an own structure is not a selection (it reaches the attack), the own land is', () => {
    const t = table([[at(10, 10), 1]]);
    expect(pickStructure(t, W, H, at(11, 10), 1, 0)).toBe(-1); // unowned neighbour
    expect(pickStructure(t, W, H, at(11, 10), 1, 2)).toBe(-1); // enemy neighbour
    expect(pickStructure(t, W, H, at(11, 10), 1, 1)).toBe(0); // own neighbour
    expect(pickStructure(t, W, H, at(10, 10), 1, 0)).toBe(0); // the structure's own cell
  });

  it('with every neighbour at distance one the orthogonal one wins over a diagonal one with a lower id, and the x seam wraps', () => {
    const t = table([
      [at(9, 9), 1], // diagonal, id 0
      [at(10, 9), 1], // orthogonal (north of the click), id 1
    ]);
    expect(pickStructure(t, W, H, at(10, 10), 1, 1)).toBe(1);
    const seam = table([[at(63, 20), 1]]);
    expect(pickStructure(seam, W, H, at(0, 19), 1, 1)).toBe(0); // west of the seam, diagonal, found only by wrapping
    const east = table([[at(0, 10), 1]]);
    expect(pickStructure(east, W, H, at(63, 10), 1, 1)).toBe(0);
  });
});

describe('the selection mode', () => {
  it('a click on another own structure moves the selection, a click on empty ground leaves the mode', () => {
    const log: string[] = [];
    const mode = createSelectionMode(3, {
      pickCell: (x) => (x < 0 ? null : x),
      structureAt: (c) => (c === 7 ? 7 : -1),
      reselect: (id) => log.push(`re${id}`),
      ended: () => log.push('ended'),
      exit: () => log.push('exit'),
    });
    const e = { id: 1, kind: 'mouse', x: 0, y: 0, button: 0, ctrlKey: false, shiftKey: false } as const;
    expect(mode.click?.(7, 0, e)).toBe(true);
    expect(mode.selected()).toBe(7);
    expect(mode.click?.(5, 0, e)).toBe(true); // empty ground
    expect(mode.click?.(-1, 0, e)).toBe(true); // off the globe
    mode.onPop?.();
    expect(log).toEqual(['re7', 'exit', 'exit', 'ended']);
  });
});

describe('rings and icons', () => {
  it('the model radius follows the scale policy: true size close up, a share of the distance further out, capped', () => {
    expect(modelRadiusM(1000, 700, 1)).toBe(700);
    expect(modelRadiusM(300000, 700, 1)).toBeCloseTo(300000 * 0.011, 6);
    expect(modelRadiusM(1e9, 700, 1)).toBe(700 * STRUCT_MAX_SCALE);
    expect(modelRadiusM(1000, 700, 3)).toBe(700 * 1.5);
    expect(selectRingRadiusM(1000, 700, 1)).toBeCloseTo(700 * SELECT_RING_FACTOR, 6);
  });

  it('the icon takes over exactly where the model falls under the fade pixels', () => {
    const viewH = 540;
    const tanHalf = Math.tan((50 * Math.PI) / 360);
    const d = iconSwitchDistanceM(700, ICON_FADE_PX_HI, viewH, tanHalf);
    expect(modelRadiusPx(d * 0.98, 700, 1, viewH, tanHalf)).toBeGreaterThan(ICON_FADE_PX_HI);
    expect(modelRadiusPx(d * 1.02, 700, 1, viewH, tanHalf)).toBeLessThan(ICON_FADE_PX_HI);
    expect(d / 1000).toBeGreaterThan(3000); // models stay readable out to thousands of km, the icons begin beyond
  });

  it('range ring radii come from the sim: SAM per level (+20 % on a mountain), Defense Post fixed, others none', () => {
    expect(rangeRingCells(STRUCT_SAM, 2, false)).toBe(samRadiusCells(2, false));
    expect(rangeRingCells(STRUCT_SAM, 2, true)).toBeGreaterThan(rangeRingCells(STRUCT_SAM, 2, false));
    expect(rangeRingCells(STRUCT_POST, 1, false)).toBe(POST_RADIUS_CELLS);
    expect(rangeRingCells(STRUCT_CITY, 1, false)).toBe(0);
  });
});

describe('the panel numbers', () => {
  it('a City gives the sim numbers per level, and every refusal has its own tooltip key', () => {
    const l1 = effectLines(STRUCT_CITY, 1)[0];
    const l3 = effectLines(STRUCT_CITY, 3)[0];
    expect(l1?.params.troops).toBe(CAP_CITY_LEVEL_TROOPS);
    expect(l3?.params.troops).toBe(CAP_CITY_LEVEL_TROOPS * 3);
    expect(upgradeWhyKey(REJECT_BUILD_GOLD)).toBe('sel.why.gold');
    expect(upgradeWhyKey(REJECT_STRUCT_BUSY)).toBe('sel.why.busy');
    expect(deleteWhyKey(REJECT_DELETE_COOLDOWN)).toBe('sel.why.cooldown');
  });
});
