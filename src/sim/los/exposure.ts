// The exposure queries for later milestones (helicopter routes, missiles, the AI): read-only functions over a Los cache and a SimView.
import { seatToOwner } from '../state';
import { ALT_MODE_LOW, EXPOSED_DETECTED, EXPOSED_NONE, EXPOSED_POST, type AltMode, type Los, type LosSource } from './cache';

/**
 * Is an aircraft of mode `mode` over `cell` exposed to the sensors of `seat` (the DEFENDER whose SAM / radar sites and Defense Posts count)?
 * Returns a bit set: EXPOSED_DETECTED (the union of the seat's finished SAM masks sees it), EXPOSED_POST (inside a finished Post radius,
 * both modes), 0 = hidden. The caller decides whether the aircraft is an enemy's.
 */
export function exposure(los: Los, view: LosSource, seat: number, cell: number, mode: AltMode = ALT_MODE_LOW): number {
  los.sync(view);
  const owner = seatToOwner(seat);
  let bits = EXPOSED_NONE;
  if (los.detected(owner, cell, mode)) bits |= EXPOSED_DETECTED;
  if (los.inPostRadius(owner, cell)) bits |= EXPOSED_POST;
  return bits;
}

/** Shorthand: exposed at all? */
export function isExposed(los: Los, view: LosSource, seat: number, cell: number, mode: AltMode = ALT_MODE_LOW): boolean {
  return exposure(los, view, seat, cell, mode) !== EXPOSED_NONE;
}

/** Can the finished SAM `structureId` (or an added site's handle) fire at an aircraft over `cell`: its own mask and radius. */
export function fireControlExposed(los: Los, view: LosSource, handle: number, cell: number, mode: AltMode = ALT_MODE_LOW): boolean {
  los.sync(view);
  return los.fireControl(handle, cell, mode);
}
