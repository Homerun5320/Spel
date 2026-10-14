// The canonical views of the contact sheet (M02) and the default test view. `time` is fx seconds; it fixes the sun
// (see geo.ts `timeForSubsolarLon`). Goldens for these six views are committed in the last step of M02.
import type { GroundCameraSpec, ViewState } from './camera';
import { DEFAULT_VIEW } from './config';
import { timeForSubsolarLon } from './geo';

export interface CanonicalView extends ViewState {
  id: 'earth' | 'europe50' | 'himalaya' | 'andes' | 'alps' | 'night';
  /** Fx time in seconds. */
  time: number;
}

/** The view and the sun a page starts with (also the plain `?test=1` page): the whole Earth, the sun 67 degrees west of the centre (left half lit). */
export const DEFAULT_START_TIME = timeForSubsolarLon(-55);
export const DEFAULT_START_VIEW: ViewState = { ...DEFAULT_VIEW };

export const CANONICAL_VIEWS: readonly CanonicalView[] = [
  { id: 'earth', lat: 20, lon: 10, distKm: 21500, heading: 0, tilt: 0, time: timeForSubsolarLon(-25) },
  { id: 'europe50', lat: 47, lon: 12, distKm: 3200, heading: 0, tilt: 50, time: timeForSubsolarLon(40) },
  { id: 'himalaya', lat: 28, lon: 86, distKm: 1800, heading: 0, tilt: 52, time: timeForSubsolarLon(125) },
  { id: 'andes', lat: -22, lon: -68, distKm: 2500, heading: 0, tilt: 52, time: timeForSubsolarLon(-35) },
  { id: 'alps', lat: 46.3, lon: 9, distKm: 900, heading: 0, tilt: 55, time: timeForSubsolarLon(35) },
  { id: 'night', lat: 30, lon: 40, distKm: 9000, heading: 0, tilt: 0, time: timeForSubsolarLon(-140) },
];

/**
 * The named ground views (M07a, `?view=alps-valley` and `?view=himalaya-valley`): a camera about 2 km above the ground, looking toward the
 * horizon, the sun low behind it. The numbers are the camera's own (position, heading, pitch below the horizon), which the orbit rig turns
 * into a focus far away on the sea-level sphere (`viewFromGroundCamera`). The keys are `GROUND_VIEW_NAMES` of `src/app/params.ts`.
 */
export interface GroundView extends GroundCameraSpec {
  /** Fx time in seconds (the sun). */
  time: number;
}
export const GROUND_VIEWS: Readonly<Record<'alps-valley' | 'himalaya-valley', GroundView>> = {
  'alps-valley': { lat: 46.5, lon: 8.0, heading: 180, pitchDeg: 3, aglM: 2000, time: timeForSubsolarLon(-32) },
  'himalaya-valley': { lat: 28.2, lon: 86.8, heading: 0, pitchDeg: 3, aglM: 2000, time: timeForSubsolarLon(47) },
};
