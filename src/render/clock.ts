// The fx clock: the ONE cosmetic clock of the app. flyTo, owner-upload throttling, toasts, camera moves and inertia,
// fx, the tutorial hint and the autosave timer all read `fxNow()`; no other clock is created in `src` (unit test
// tests/fxClock.test.ts lists the few files that may touch real time).
//
// In `?test=1` the clock is frozen: only `__test.render(dt)`, `__test.advance(dt)` and `__test.setView({time})` step it.
// In the normal loop the frame driver (src/app) calls `advanceFx(dtSeconds)` once per frame.

let now = 0;

/** Current fx time in seconds. */
export function fxNow(): number {
  return now;
}

/** Steps the fx clock by `dt` seconds (negative or non-finite steps are ignored). Returns the new time. */
export function advanceFx(dt: number): number {
  if (Number.isFinite(dt) && dt > 0) now += dt;
  return now;
}

/** Sets the fx clock to `t` seconds (test hooks, restarts). */
export function setFxTime(t: number): void {
  if (Number.isFinite(t)) now = t;
}
