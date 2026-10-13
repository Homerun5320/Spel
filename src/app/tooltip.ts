// Hover tooltip text: country, terrain class and height in metres. Pure (unit-tested). The words come from the i18n tables
// (`t`, `src/ui/i18n.ts`); country names follow the UI language (`name_sv` / `name_en` of meta.json).
import type { WorldMeta } from '../data';
import { landClassForHeight, waterClassForDepth } from '../render/describe';
import { TABLES, t, type Lang, type TextKey } from '../ui/i18n';

const CLASS_KEYS: readonly TextKey[] = ['class.0', 'class.1', 'class.2', 'class.3', 'class.4', 'class.5', 'class.6', 'class.7'];

/** The Swedish class names (the `sv` table), index = terrain class of the sim pack. */
export const CLASS_LABEL_SV: readonly string[] = CLASS_KEYS.map((k) => TABLES.sv[k] as string);

/** The class name in the current language. */
export function classLabel(classId: number): string {
  const key = CLASS_KEYS[classId];
  return key === undefined ? '?' : t(key);
}

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

/** Country names in `lang` (the other language when one is empty). */
export function countryNameMap(meta: WorldMeta, lang: Lang = 'sv'): Map<number, string> {
  const m = new Map<number, string>();
  for (const c of meta.countries) m.set(c.id, (lang === 'sv' ? c.name_sv || c.name_en : c.name_en || c.name_sv));
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
  const where = land ? (names.get(pick.countryId) ?? t('tooltip.unknownCountry')) : t('tooltip.sea');
  return `${where} · ${classLabel(classId)} · ${formatMetres(pick.elevationM)}`;
}
