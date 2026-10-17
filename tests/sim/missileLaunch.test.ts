// M14a: the LaunchMissile intent: wire codec, shape check, every refusal code ONE BY ONE, the price rise of +25 percent per earlier launch, the Silo cooldown, and the parity between the
// page-side `validateMissileLaunch` (on a StateView) and the sim's own `applyLaunchMissile` (both run `checkLaunchMissile`). The world is tools/sim/missiles.ts `missileFixture`.
import { describe, expect, it } from 'vitest';
import { decodeIntent, encodeIntent } from '../../src/sim/codec';
import { RELATION_ALLIANCE, RELATION_TRUCE } from '../../src/sim/diplomacyTable';
import {
  REJECT_CELL,
  REJECT_MISSILE_BAD_CLASS,
  REJECT_MISSILE_COOLDOWN,
  REJECT_MISSILE_NEED_SILO_L2,
  REJECT_MISSILE_NOT_HOSTILE,
  REJECT_MISSILE_NOT_OWNER,
  REJECT_MISSILE_NO_GOLD,
  REJECT_MISSILE_NO_SILO,
  REJECT_MISSILE_OUT_OF_RANGE,
  REJECT_MISSILE_SILO_NOT_READY,
  REJECT_MISSILE_TABLE_FULL,
  REJECT_MISSILE_TARGET_NOT_LAND,
  REJECT_NONE,
  REJECT_SHAPE,
  REJECT_STRUCT_ID,
  compareIntents,
  launchMissileBody,
  validateIntent,
  withId,
  type Intent,
} from '../../src/sim/intents';
import { OUTBOX_MISSILE_LAUNCHED, OUTBOX_MISSILE_WARNING, OUTBOX_REJECT } from '../../src/sim/outbox';
import { MILLI_GOLD_PER_GOLD, MISSILE_BASE_GOLD, MISSILE_CAPACITY, MISSILE_COOLDOWN_TICKS, MISSILE_REASON_BASE } from '../../src/sim/rules';
import { applyLaunchMissile } from '../../src/sim/missilePhase';
import { validateMissileLaunch } from '../../src/sim/missileRules';
import { MISSILE_FISSION, MISSILE_FUSION, MISSILE_TACTICAL } from '../../src/sim/missileTable';
import { step } from '../../src/sim/step';
import type { GameState } from '../../src/sim/state';
import { STRUCT_CITY, STRUCT_SILO } from '../../src/sim/structureRules';
import { StateView } from '../../src/sim/view';
import { missileFixture } from '../../tools/sim/missiles';

const W = 1024;
const at = (x: number, y: number): number => y * W + x;

/** Both paths on one case: the page-side answer on a StateView and the sim's answer must be the same code. */
function both(s: GameState, seat: number, silo: number, cls: number, target: number): number {
  const page = validateMissileLaunch(new StateView(s), seat, silo, cls, target);
  const sim = applyLaunchMissile(s, seat, silo, cls, target);
  expect(sim, 'the sim and the page agree').toBe(page);
  return sim;
}

describe('the wire and the shape check', () => {
  it('encodes and decodes LaunchMissile and orders it by (silo, class, target)', () => {
    const i: Intent = withId(launchMissileBody(1, 7, 2, 255286), 9);
    expect(decodeIntent(encodeIntent(i))).toEqual({ ok: true, value: i });
    const a = withId(launchMissileBody(0, 3, 0, 5), 1);
    const b = withId(launchMissileBody(0, 3, 1, 5), 2);
    const c = withId(launchMissileBody(0, 4, 0, 1), 3);
    expect([c, b, a].sort(compareIntents)).toEqual([a, b, c]);
  });

  it('refuses a class beyond 2, a silo id beyond the table and a cell off the map', () => {
    const ctx = { seats: 2, cells: 100, debugIntents: false };
    expect(validateIntent(withId(launchMissileBody(0, 1, 3, 5), 1), ctx)).toBe(REJECT_SHAPE);
    expect(validateIntent(withId(launchMissileBody(0, 100000, 0, 5), 1), ctx)).toBe(REJECT_STRUCT_ID);
    expect(validateIntent(withId(launchMissileBody(0, 1, 0, 100), 1), ctx)).toBe(REJECT_CELL);
    expect(validateIntent(withId(launchMissileBody(0, 1, 0, 99), 1), ctx)).toBe(REJECT_NONE);
  });
});

describe('every refusal, one by one (and the page agrees)', () => {
  it('a legal launch takes the price, starts the cooldown and announces the missile and the warning', () => {
    const fx = missileFixture('plain-cruise', 1);
    const s = fx.state;
    const gold = s.gold[1] as number;
    expect(both(s, 0, fx.silo, MISSILE_TACTICAL, fx.target)).toBe(REJECT_NONE);
    expect(gold - (s.gold[1] as number)).toBe((MISSILE_BASE_GOLD[0] as number) * MILLI_GOLD_PER_GOLD);
    expect(s.structures.salvoTick[fx.silo]).toBe(s.tick + MISSILE_COOLDOWN_TICKS);
    expect(s.missiles.liveCount).toBe(1);
    expect(s.missiles.impactTick[0]).toBe(s.tick + 30);
    const ev = s.outbox.drain().filter((e) => e.kind === OUTBOX_MISSILE_LAUNCHED || e.kind === OUTBOX_MISSILE_WARNING);
    expect(ev.map((e) => [e.kind, e.a, e.b])).toEqual([
      [OUTBOX_MISSILE_LAUNCHED, 0, fx.target],
      [OUTBOX_MISSILE_WARNING, 0, 30],
    ]);
  });

  it('no warning when nobody owns the target: only the launch is announced', () => {
    const fx = missileFixture('plain-cruise', 1);
    const s = fx.state;
    expect(applyLaunchMissile(s, 0, fx.silo, MISSILE_TACTICAL, at(250, 320))).toBe(REJECT_NONE);
    expect(s.outbox.drain().filter((e) => e.kind === OUTBOX_MISSILE_LAUNCHED || e.kind === OUTBOX_MISSILE_WARNING).map((e) => e.kind)).toEqual([OUTBOX_MISSILE_LAUNCHED]);
  });

  it('NO_SILO, NOT_OWNER, SILO_NOT_READY, COOLDOWN', () => {
    const fx = missileFixture('plain-cruise', 1);
    const s = fx.state;
    const city = fx.buildings[0] as number;
    expect(s.structures.type[city]).toBe(STRUCT_CITY);
    expect(both(s, 0, city, MISSILE_TACTICAL, fx.target)).toBe(REJECT_MISSILE_NO_SILO);
    expect(both(s, 0, 999, MISSILE_TACTICAL, fx.target)).toBe(REJECT_MISSILE_NO_SILO);
    expect(both(s, 1, fx.silo, MISSILE_TACTICAL, at(250, 252))).toBe(REJECT_MISSILE_NOT_OWNER);
    const fresh = s.structures.add(STRUCT_SILO, 1, at(240, 250), s.tick); // laid down now, finished in 250 ticks
    expect(both(s, 0, fresh, MISSILE_TACTICAL, fx.target)).toBe(REJECT_MISSILE_SILO_NOT_READY);
    expect(both(s, 0, fx.silo, MISSILE_TACTICAL, fx.target)).toBe(REJECT_NONE);
    expect(both(s, 0, fx.silo, MISSILE_TACTICAL, fx.target)).toBe(REJECT_MISSILE_COOLDOWN);
    s.tick += MISSILE_COOLDOWN_TICKS - 1;
    expect(both(s, 0, fx.silo, MISSILE_TACTICAL, fx.target)).toBe(REJECT_MISSILE_COOLDOWN);
    s.tick += 1;
    expect(both(s, 0, fx.silo, MISSILE_TACTICAL, fx.target)).toBe(REJECT_NONE);
  });

  it('OUT_OF_RANGE for the cruise (80 cells) and the Fission (240 cells) missile, none for Fusion', () => {
    const fx = missileFixture('plain-cruise', 1);
    const s = fx.state;
    // The Silo is at x 250 and the land goes on to x 499: 79 cells is in range for Tactical, 90 is not.
    expect(both(s, 0, fx.silo, MISSILE_TACTICAL, at(329, 250))).toBe(REJECT_NONE);
    s.tick += MISSILE_COOLDOWN_TICKS;
    expect(both(s, 0, fx.silo, MISSILE_TACTICAL, at(340, 250))).toBe(REJECT_MISSILE_OUT_OF_RANGE);
    expect(both(s, 0, fx.silo, MISSILE_TACTICAL, at(499, 250))).toBe(REJECT_MISSILE_OUT_OF_RANGE);
    // Fission reaches 240 cells and so the whole island; the far side of the globe is reachable by Fusion only.
    s.structures.level[fx.silo] = 2;
    expect(both(s, 0, fx.silo, MISSILE_FISSION, at(485, 250))).toBe(REJECT_NONE); // 235 cells
    s.tick += MISSILE_COOLDOWN_TICKS;
    expect(both(s, 0, fx.silo, MISSILE_FISSION, at(499, 250))).toBe(REJECT_MISSILE_OUT_OF_RANGE); // 249 cells
    s.tick += MISSILE_COOLDOWN_TICKS;
    expect(both(s, 0, fx.silo, MISSILE_FUSION, at(499, 250))).toBe(REJECT_NONE);
  });

  it('NEED_SILO_L2 for Fusion from a level 1 Silo, NO_GOLD, TARGET_NOT_LAND', () => {
    const fx = missileFixture('fusion-silo', 1);
    const s = fx.state;
    s.structures.level[fx.silo] = 1;
    expect(both(s, 0, fx.silo, MISSILE_FUSION, fx.target)).toBe(REJECT_MISSILE_NEED_SILO_L2);
    s.structures.level[fx.silo] = 2;
    expect(both(s, 0, fx.silo, MISSILE_FUSION, at(10, 250))).toBe(REJECT_MISSILE_TARGET_NOT_LAND);
    const rich = s.gold[1] as number;
    s.gold[1] = (MISSILE_BASE_GOLD[2] as number) * MILLI_GOLD_PER_GOLD - 1;
    expect(both(s, 0, fx.silo, MISSILE_FUSION, fx.target)).toBe(REJECT_MISSILE_NO_GOLD);
    s.gold[1] = rich;
    expect(both(s, 0, fx.silo, MISSILE_FUSION, fx.target)).toBe(REJECT_NONE);
  });

  it('NOT_HOSTILE: a truce, an alliance and the seat\'s own land are refused; unowned land and war are fine', () => {
    const fx = missileFixture('plain-cruise', 1);
    const s = fx.state;
    s.diplo.setRelation(1, 2, RELATION_TRUCE, s.tick + 1000);
    expect(both(s, 0, fx.silo, MISSILE_TACTICAL, fx.target)).toBe(REJECT_MISSILE_NOT_HOSTILE);
    s.diplo.setRelation(1, 2, RELATION_ALLIANCE, 0);
    expect(both(s, 0, fx.silo, MISSILE_TACTICAL, fx.target)).toBe(REJECT_MISSILE_NOT_HOSTILE);
    s.diplo.setRelation(1, 2, 0, 0);
    expect(both(s, 0, fx.silo, MISSILE_TACTICAL, at(260, 250))).toBe(REJECT_MISSILE_NOT_HOSTILE); // own land
    expect(both(s, 0, fx.silo, MISSILE_TACTICAL, at(250, 320))).toBe(REJECT_NONE); // unowned land (y 300 to 349 is plains nobody owns)
  });

  it('TABLE_FULL and BAD_CLASS', () => {
    const fx = missileFixture('plain-cruise', 1);
    const s = fx.state;
    for (let i = 0; i < MISSILE_CAPACITY; i++) s.missiles.add(i, 2, 0, 0, s.tick, s.tick + 10, 1, 2);
    expect(both(s, 0, fx.silo, MISSILE_TACTICAL, fx.target)).toBe(REJECT_MISSILE_TABLE_FULL);
    s.missiles.remove(63);
    expect(both(s, 0, fx.silo, MISSILE_TACTICAL, fx.target)).toBe(REJECT_NONE);
    expect(s.missiles.owner[63]).toBe(1); // the lowest free slot is the one that was freed
    expect(applyLaunchMissile(s, 0, fx.silo, 7, fx.target)).toBe(REJECT_MISSILE_BAD_CLASS);
  });

  it('the refusal block starts at MISSILE_REASON_BASE + 1 and the refusals reach the outbox as OUTBOX_REJECT through step', () => {
    expect(REJECT_MISSILE_NO_SILO).toBe(MISSILE_REASON_BASE + 1);
    expect(REJECT_MISSILE_BAD_CLASS).toBe(MISSILE_REASON_BASE + 11);
    const fx = missileFixture('plain-cruise', 1);
    const s = fx.state;
    step(s, { turn: s.tick, intents: [withId(launchMissileBody(0, fx.silo, MISSILE_TACTICAL, at(10, 250)), 1)] });
    const rej = s.outbox.drain().filter((e) => e.kind === OUTBOX_REJECT);
    expect(rej.map((e) => e.a)).toEqual([REJECT_MISSILE_TARGET_NOT_LAND]);
  });
});

describe('the price rises by 25 percent per earlier launch of the class', () => {
  it('300, 375, 450, 525 gold for the first four cruise missiles of a seat; another class starts again at its base', () => {
    const fx = missileFixture('plain-cruise', 1);
    const s = fx.state;
    const silos = [fx.silo];
    for (let i = 1; i < 4; i++) silos.push(s.structures.add(STRUCT_SILO, 1, at(250 + i, 250), 0));
    const paid: number[] = [];
    for (const silo of silos) {
      const before = s.gold[1] as number;
      expect(applyLaunchMissile(s, 0, silo, MISSILE_TACTICAL, fx.target)).toBe(REJECT_NONE);
      paid.push((before - (s.gold[1] as number)) / MILLI_GOLD_PER_GOLD);
    }
    expect(paid).toEqual([300, 375, 450, 525]);
    expect(s.missiles.launchesOf(1, MISSILE_TACTICAL)).toBe(4);
    const extra = s.structures.add(STRUCT_SILO, 1, at(255, 250), 0);
    const before = s.gold[1] as number;
    expect(applyLaunchMissile(s, 0, extra, MISSILE_FISSION, fx.target)).toBe(REJECT_NONE);
    expect((before - (s.gold[1] as number)) / MILLI_GOLD_PER_GOLD).toBe(MISSILE_BASE_GOLD[1]);
    // the other seat's counter is its own
    expect(s.missiles.launchesOf(2, MISSILE_TACTICAL)).toBe(0);
  });
});
