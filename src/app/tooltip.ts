// Hover tooltip text: country, terrain class and height in metres. Pure (unit-tested). Swedish for now; the
// i18n tables (`t(key)`) arrive in M05 and take over these strings.
import type { WorldMeta } from '../data';

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

export function tooltipText(pick: TooltipPick, names: Map<number, string>): string {
  const cls = CLASS_LABEL_SV[pick.classId] ?? '?';
  const where = pick.classId <= 1 ? 'Hav' : (names.get(pick.countryId) ?? 'Okänt land');
  return `${where} · ${cls} · ${formatMetres(pick.elevationM)}`;
}
