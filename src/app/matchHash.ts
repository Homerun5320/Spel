// The state hash of a built match played with the AI (a test hook). Its own module so that the host and the AI stay out of the page's first chunk
// (Bundle-diet-1): match.ts loads them with import() when a match starts, this file imports them statically and is itself loaded on demand.
import { AiDriver } from '../host/aiDriver';
import { MainThreadHost } from '../host/mainThreadHost';
import { hex32 } from '../sim/hash';
import { hashState } from '../sim/serialize';
import type { BuiltMatch } from './matchSetup';

/**
 * The state hash of a match the setup built, at tick 0 and after `ticks` ticks played with the AI (the test hook behind "the same config and
 * seed give the same hash in Node and in the browser"). Consumes the match: its state is stepped.
 */
export function hashBuiltMatch(match: BuiltMatch, ticks: number): { initial: string; after: string } {
  const initial = hashState(match.state);
  const host = new MainThreadHost(match.state, { speed: 1, driver: new AiDriver(match.config.seed, { humanSeats: [match.humanSeat] }) });
  host.runTicks(ticks);
  const after = hashState(match.state);
  host.dispose();
  return { initial: hex32(initial), after: hex32(after) };
}
