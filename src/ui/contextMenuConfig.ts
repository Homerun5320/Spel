// The tokens of the right-click menu (Ctx-1): sizes in em of the HUD font, colours from UI_COLORS. Lazy, like the menu itself.
import { UI_COLORS as C, Z_HUD } from './uiConfig';

export const CTX_MENU = {
  /** Above the diplomacy panel (33) and the help overlay (34), below the match panels (36). */
  z: Math.max(Z_HUD, 35),
  /** The box keeps this many pixels free from the window edge. */
  marginPx: 8,
  widthEm: 21,
  /** Opaque enough to read over the map (the panels use 0.97 too). */
  background: 'rgba(8, 13, 24, 0.97)',
  rowHover: C.buttonActive,
  reason: C.barWarning,
} as const;
