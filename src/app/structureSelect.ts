// Selecting a structure (M10-4). Two parts, both pure TypeScript so the unit tests drive them without a browser:
//  - `pickStructure`: which structure a click on a sim cell means (the structure on that cell, else the nearest own one within one cell);
//  - `createSelectionMode`: the input mode that is on the stack while a structure is selected. Escape pops it (the stack does that), a click
//    on another own structure moves the selection, a click anywhere else deselects (and is used up: it does not also start an attack).
import type { StructureView } from '../sim/public';
import type { InputMode } from './input';

/**
 * The structure a click on `cell` selects, or -1. The structure standing on the cell wins; otherwise the nearest structure OF `ownerId` within
 * one cell (the eight neighbours, x wrapping; a tie goes to the lowest id). Other owners' structures are not selectable by a click.
 * The neighbourhood applies only when the clicked cell is the player's own land (`cellOwner` = the owner of `cell`): a click on neutral or enemy land
 * beside a structure is an attack or expand click and must reach the base action.
 */
export function pickStructure(table: StructureView, width: number, height: number, cell: number, ownerId: number, cellOwner: number): number {
  const here = table.idAt(cell);
  if (here >= 0 && table.owner[here] === ownerId) return here;
  if (cellOwner !== ownerId) return -1;
  const x = cell % width;
  const y = (cell - x) / width;
  let best = -1;
  let bestD = 99;
  for (let dy = -1; dy <= 1; dy++) {
    const yy = y + dy;
    if (yy < 0 || yy >= height) continue;
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const id = table.idAt(yy * width + ((x + dx + width) % width));
      if (id < 0 || table.owner[id] !== ownerId) continue;
      const d = dx * dx + dy * dy;
      if (d < bestD || (d === bestD && id < best)) {
        best = id;
        bestD = d;
      }
    }
  }
  return best;
}

export interface SelectionTarget {
  /** The sim cell under a pixel, or null when the ray misses the globe. */
  pickCell(x: number, y: number): number | null;
  /** The structure id a click on `cell` selects (-1 = none): `pickStructure` on the current snapshot. */
  structureAt(cell: number): number;
  /** The selection moved to another structure. */
  reselect(id: number): void;
  /** The mode ended (Escape, a click on empty ground, or the page): the UI forgets the selection. */
  ended(): void;
  /** Leaves the mode (the page pops it). */
  exit(): void;
}

export interface SelectionMode extends InputMode {
  /** The selected structure id. */
  selected(): number;
}

export function createSelectionMode(structure: number, target: SelectionTarget): SelectionMode {
  let current = structure;
  return {
    id: 'select',
    selected: () => current,
    onPop(): void {
      target.ended();
    },
    click(x: number, y: number): boolean {
      const cell = target.pickCell(x, y);
      const hit = cell === null ? -1 : target.structureAt(cell);
      if (hit >= 0) {
        if (hit !== current) {
          current = hit;
          target.reselect(hit);
        }
        return true;
      }
      target.exit();
      return true;
    },
  };
}
