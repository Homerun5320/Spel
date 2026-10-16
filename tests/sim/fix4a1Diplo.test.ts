// Fix-4A1 [1.4]: the mutants of the cached and derived diplomacy state that survived audit 3 (D25, T18, T13, D32, T11). Each test names its mutant.
import { describe, expect, it } from 'vitest';
import { RELATION_WAR, TREATY_ALLIANCE, TREATY_TRUCE } from '../../src/sim/diplomacyTable';
import { REJECT_DIPLO_TREATY_BOUND, validateIntent, withId, type IntentBody } from '../../src/sim/intents';
import { PROPOSAL_TTL_TICKS, TRUCE_TICKS } from '../../src/sim/rules';
import { deserialize, hashState, serialize } from '../../src/sim/serialize';
import { applyIntent, step } from '../../src/sim/step';
import { type GameState } from '../../src/sim/state';
import { setOwner } from '../../src/sim/territory';
import { STRUCT_PORT } from '../../src/sim/structureRules';
import { structGoldMilliPerSec, tradeMilliPerSec } from '../../src/sim/structureEffects';
import { PORT_GOLD_MILLI_BY_LEVEL } from '../../src/sim/levelCurves';
import { createState } from '../../src/sim/state';
import { CLASS_PLAINS } from '../../src/sim/terrain';
import { landState } from './helpers/worlds';

let ids = 1;
function send(s: GameState, body: IntentBody): number {
  const i = withId(body, ids++);
  const shape = validateIntent(i, { seats: s.header.seats, cells: s.width * s.height, debugIntents: false });
  return shape !== 0 ? shape : applyIntent(s, i);
}
function arena(): GameState {
  const s = landState(40, 6, { seats: 4, players: 3 });
  for (let y = 0; y < 6; y++) for (let x = 0; x < 40; x++) setOwner(s, y * 40 + x, Math.min(4, 1 + Math.floor(x / 10)), 0);
  for (let o = 1; o <= 4; o++) s.troops[o] = 200000;
  return s;
}
const propose = (s: GameState, a: number, b: number, treaty: number): void => void expect(send(s, { kind: 'ProposeTreaty', seat: a, to: b, treaty })).toBe(0);
const accept = (s: GameState, a: number, b: number): void => void expect(send(s, { kind: 'AcceptTreaty', seat: b, from: a })).toBe(0);

describe('Fix-4A1 [1.4] diplomacy caches', () => {
  it('D25: BreakTreaty alone dirties the trade cache (a warm cache must not keep the allied rate after the break)', () => {
    const W = 300;
    const s = createState({ width: W, height: 8, seed: 5, seats: 3, players: 3, terrain: new Uint8Array(W * 8).fill(CLASS_PLAINS), elevation: new Uint16Array(W * 8) });
    for (let o = 1; o <= 3; o++) setOwner(s, 4 * W + o, o, 0);
    s.tick = 5000;
    for (const [owner, x] of [[1, 100], [2, 200]] as const) {
      setOwner(s, 4 * W + x, owner, 0);
      const id = s.structures.add(STRUCT_PORT, owner, 4 * W + x, 0);
      s.structures.level[id] = 1;
    }
    const own = PORT_GOLD_MILLI_BY_LEVEL[1] as number;
    const full = tradeMilliPerSec(100, false, false);
    const allied = tradeMilliPerSec(100, false, false, true);
    propose(s, 0, 1, TREATY_ALLIANCE);
    accept(s, 0, 1);
    expect(structGoldMilliPerSec(s, 1)).toBe(own + allied); // the cache is warm with the allied rate
    expect(send(s, { kind: 'BreakTreaty', seat: 0, with: 1 })).toBe(0); // no embargo call in between
    expect(structGoldMilliPerSec(s, 1)).toBe(own + full);
  });

  it('T18: after a restore the alliance still bans an Attack on the ally when it is the only treaty in the match (rebuildPairs keeps alliances)', () => {
    const s = arena();
    propose(s, 0, 1, TREATY_ALLIANCE);
    accept(s, 0, 1);
    const twin = deserialize(serialize(s));
    if (!twin.ok) throw new Error('twin');
    expect(send(twin.state, { kind: 'Attack', seat: 0, target: 2, pct: 50 })).toBe(REJECT_DIPLO_TREATY_BOUND);
  });

  it('T13: declining the first of two proposals keeps the expiry of the second', () => {
    const s = arena();
    propose(s, 0, 1, TREATY_TRUCE);
    s.tick += 7;
    propose(s, 1, 2, TREATY_TRUCE);
    expect(send(s, { kind: 'DeclineTreaty', seat: 1, from: 0 })).toBe(0);
    expect(s.diplo.propCount).toBe(1);
    expect(s.diplo.propExpire[0]).toBe(s.tick + PROPOSAL_TTL_TICKS);
  });

  it('D32: two truces accepted in one tick both end at the first tick of their end (not one tick late)', () => {
    const s = arena();
    propose(s, 0, 1, TREATY_TRUCE);
    accept(s, 0, 1);
    propose(s, 1, 2, TREATY_TRUCE);
    accept(s, 1, 2);
    const end = s.tick + TRUCE_TICKS;
    s.tick = end;
    expect(step(s, { turn: end, intents: [] }).ok).toBe(true);
    expect(s.diplo.relationOf(1, 2)).toBe(RELATION_WAR);
    expect(s.diplo.relationOf(2, 3)).toBe(RELATION_WAR);
  });

  it('T11: the state hash tells WHO imposed an embargo (seat 0 on 1 differs from seat 1 on 0)', () => {
    const a = arena();
    const b = arena();
    expect(send(a, { kind: 'ImposeEmbargo', seat: 0, target: 1 })).toBe(0);
    expect(send(b, { kind: 'ImposeEmbargo', seat: 1, target: 0 })).toBe(0);
    expect(hashState(a)).not.toBe(hashState(b));
  });
});
