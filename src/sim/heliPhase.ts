// The helicopter mutators (M12a-1): ProduceHeli, the production phase of `step`, and the scrapping of the helicopters of a lost Factory.
// Part 2 adds LaunchHeli / RecallHeli and the flight to this file's phase; part 3 the landing and the beachhead.
import { checkProduceHeli, HELI_PRICE_MILLI } from './heliRules';
import { HELI_BUILDING, HELI_PAD, cellCentreQ8 } from './heliTable';
import { REJECT_NONE } from './intents';
import { OUTBOX_HELI_PRODUCED, OUTBOX_HELI_QUEUED, OUTBOX_HELI_SCRAPPED } from './outbox';
import { HELI_BUILD_TICKS, HELI_FUEL_MAX_Q8, HELI_HP_TENTHS } from './rules';
import { seatToOwner, type GameState } from './state';
import { spawnPhaseRefuses } from './structures';

/** Applies a ProduceHeli: the rules (checkProduceHeli), then the price is taken and a helicopter goes under production in the Factory. */
export function applyProduceHeli(state: GameState, seat: number, factory: number): number {
  const ownerId = seatToOwner(seat);
  const why = checkProduceHeli(state, state.gold[ownerId] as number, spawnPhaseRefuses(state), seat, factory);
  if (why !== REJECT_NONE) return why;
  const id = state.helis.addBuilding(ownerId, factory, state.tick, state.tick + HELI_BUILD_TICKS);
  if (id < 0) return why; // unreachable: the fleet cap (at most 12) is far below the table
  state.gold[ownerId] = (state.gold[ownerId] as number) - HELI_PRICE_MILLI;
  state.outbox.push(OUTBOX_HELI_QUEUED, state.tick, id, factory);
  return REJECT_NONE;
}

/**
 * Scraps the helicopters that stand at or are being built in Factory `factory` (its owner lost it to conquest, or it was deleted or destroyed):
 * a queued production is lost without a refund, a parked helicopter is scrapped. Airborne helicopters (part 2) are not touched: their `factory`
 * field is only where they left from. Call BEFORE the table entry of the Factory changes.
 */
export function scrapFactoryHelis(state: GameState, factory: number): void {
  const t = state.helis;
  if (t.liveCount === 0) return;
  for (let id = 0; id < t.highWater; id++) {
    if (t.owner[id] === 0 || t.factory[id] !== factory) continue;
    const s = t.state[id] as number;
    if (s !== HELI_BUILDING && s !== HELI_PAD) continue;
    state.outbox.push(OUTBOX_HELI_SCRAPPED, state.tick, id, s);
    t.remove(id);
  }
}

/** Phase of the tick: a helicopter whose production time has run out becomes HELI_PAD at its Factory. O(highWater), nothing at all without helicopters. */
export function heliPhase(state: GameState): void {
  const t = state.helis;
  if (t.liveCount === 0) return;
  const tick = state.tick;
  const w = state.width;
  const st = state.structures;
  for (let id = 0; id < t.highWater; id++) {
    if (t.owner[id] === 0 || t.state[id] !== HELI_BUILDING || tick < (t.readyTick[id] as number)) continue;
    const factory = t.factory[id] as number;
    if (st.owner[factory] !== t.owner[id]) {
      // Defensive: the scrapping on conquest keeps this from happening; a queue entry without its Factory is dropped.
      t.remove(id);
      continue;
    }
    const cell = st.cell[factory] as number;
    const cx = cell % w;
    t.state[id] = HELI_PAD;
    t.stateTick[id] = tick;
    t.x[id] = cellCentreQ8(cx);
    t.y[id] = cellCentreQ8((cell - cx) / w);
    t.alt[id] = 0;
    t.hp[id] = HELI_HP_TENTHS;
    t.load[id] = 0;
    t.fuel[id] = HELI_FUEL_MAX_Q8;
    state.outbox.push(OUTBOX_HELI_PRODUCED, tick, id, factory);
  }
}

