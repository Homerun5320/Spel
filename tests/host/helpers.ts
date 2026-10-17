import { MainThreadHost } from '../../src/host/mainThreadHost';
import { TICK_MS } from '../../src/sim/rules';
import { scenarioBodies } from '../../src/sim/scenario';
import { scheduledTurn } from '../../src/sim/time';
import type { SimHost } from '../../src/host/protocol';

/** Submits the script's bodies for the turn that is two ticks ahead, then runs one tick. Works for any SimHost. */
export function submitScenarioFor(host: SimHost, tick: number, seed: number, seats: number, cells: number): void {
  for (const b of scenarioBodies(seed, scheduledTurn(tick), seats, cells)) host.submitIntent(b);
}

/** Drives a main-thread host through `ticks` ticks of the scenario, one tick per advance(). */
export function driveScenario(host: MainThreadHost, seed: number, seats: number, cells: number, ticks: number, each?: (tick: number) => void): void {
  for (let i = 0; i < ticks; i++) {
    submitScenarioFor(host, host.tick, seed, seats, cells);
    host.advance(TICK_MS);
    each?.(host.tick);
  }
}
