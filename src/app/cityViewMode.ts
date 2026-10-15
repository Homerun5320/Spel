// The input mode of the city view (Districts-2a). It sits on the input stack while the panel is open: Escape pops it (the stack does that, before the
// pause handler), a click on the globe is taken and does nothing (the panel is the focus; drag and wheel still move the camera). Pure TypeScript.
import { CITY_VIEW } from '../ui/uiConfig';
import type { InputMode } from './input';

export function createCityViewMode(target: { closed(): void }): InputMode {
  return {
    id: 'cityview',
    onPop(): void {
      target.closed();
    },
    click(): boolean {
      return true;
    },
  };
}

/** Does opening the city view fly the camera to the City? Not when it already stands within `CITY_VIEW.flyNearM` of the ground and the City is on screen. */
export function cityFlightNeeded(cameraAglM: number, cityOnScreen: boolean): boolean {
  return !(cityOnScreen && cameraAglM < CITY_VIEW.flyNearM);
}

/** Two clicks on the same structure within `CITY_VIEW.doubleClickMs` are a double click. `prevId` -1 = none. */
export function isDoubleClick(prevId: number, prevMs: number, id: number, nowMs: number): boolean {
  return prevId === id && nowMs - prevMs <= CITY_VIEW.doubleClickMs;
}
