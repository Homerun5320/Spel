// Hover tooltip text: country, terrain class and height in metres. Pure (unit-tested). Swedish for now; the
// i18n tables (`t(key)`) arrive in M05 and take over these strings.
import type { WorldMeta } from '../data';
import { landClassForHeight, waterClassForDepth } from '../render/describe';

export const CLASS_LABEL_SV: readonly string[] = ['Djuphav', 'Grunt hav', 'Slätt', 'Skog', 'Kullar', 'Berg', 'Bergstopp', 'Is'];

export interface TooltipPick {
  classId: number;
  countryId: number;
  elevationM: number;
}

/** 1234 -> "1 234", -3520 -> "-3 520" (plain space; locale independent). */
export function formatMetres(m: number): string {
  const r = Math.round(m);
  const digits = String(Math.abs(r)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${r < 0 ? '-' : ''}${digits} m`;
}

export function countryNameMap(meta: WorldMeta): Map<number, string> {
  const m = new Map<number, string>();
  for (const c of meta.countries) m.set(c.id, c.name_sv || c.name_en);
  return m;
}

/**
 * "Where · class · height". The height decides between land and sea: a position with a height above 0 is never "Hav" and a
 * position at or below 0 always is. `describeAt` already hands over a matching class; should a caller pass a class of the
 * other kind (sim cell and render raster disagree at a coast), the class is derived from the height instead.
 */
export function tooltipText(pick: TooltipPick, names: Map<number, string>): string {
  const land = pick.elevationM > 0;
  let classId = pick.classId;
  if (land && classId <= 1) classId = landClassForHeight(pick.elevationM);
  if (!land && classId >= 2) classId = waterClassForDepth(-pick.elevationM);
  const where = land ? (names.get(pick.countryId) ?? 'Okänt land') : 'Hav';
  return `${where} · ${CLASS_LABEL_SV[classId] ?? '?'} · ${formatMetres(pick.elevationM)}`;
}
