// DOM events that UI modules use to keep out of each other's way without importing each other.

/** Dispatched on `window` by the Dev panel whenever it opens or closes (`detail` is a `DevPanelEventDetail`). */
export const DEV_PANEL_EVENT = 'dev-panel-toggle';

export interface DevPanelEventDetail {
  open: boolean;
  /** Client rectangle of the open panel (null when it is closed). */
  rect: { left: number; top: number; right: number; bottom: number } | null;
}

/** True when two client rectangles share any area. */
export function rectsOverlap(a: { left: number; top: number; right: number; bottom: number }, b: { left: number; top: number; right: number; bottom: number }): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}
