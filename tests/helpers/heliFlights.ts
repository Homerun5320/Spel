// Shared by tests/sim/heliFlightReal.test.ts (40 flights) and tests/sim/heliFlightReal100.test.ts (100 flights): many helicopter flights on the REAL 1024x512 world
// over the Alps, the Himalaya and the Andes in both flight modes, through the real `step` (LaunchHeli intents). Every tick of every flight is checked against the
// rules; the numbers are returned for the asserts and the DECISIONS block. Seeded (a small LCG in this file), so a run is the same run every time.
import { expect } from 'vitest';
import { losOf, planRouteOf, scoreLzOf } from '../../src/sim/access';
import { HELI_CRUISE, HELI_APPROACH, HELI_DOWNED, HELI_HOVER, HELI_LIFT, HELI_NONE, HELI_PAD, HELI_POS_ONE, HELI_RETURN } from '../../src/sim/heliTable';
import { launchHeliBody, withId, type Intent } from '../../src/sim/intents';
import {
  AIR_MODE_AGL_M,
  AIR_MODE_SPEED_MILLICELLS_S,
  HELI_CLEARANCE_GAME_M,
  HELI_HOVER_TICKS,
  HELI_TAKEOFF_TICKS,
  TICK_HZ,
} from '../../src/sim/rules';
import { step } from '../../src/sim/step';
import { type GameState } from '../../src/sim/state';
import { STRUCT_FACTORY, STRUCT_SAM } from '../../src/sim/structureRules';
import { CLASS_HILLS, CLASS_PEAK, CLASS_PLAINS } from '../../src/sim/terrain';
import { createWorldState } from '../../src/sim/world';
import { loadRealWorld } from '../../tools/sim/realWorld';

const W = 1024;
const H = 512;

export interface Region {
  readonly name: string;
  /** lat0, lat1, lon0, lon1 */
  readonly box: readonly [number, number, number, number];
  /** Where the enemy SAM site stands (lat, lon): a flight may have to go around it. */
  readonly sam: readonly [number, number];
}

export const REGIONS: readonly Region[] = [
  { name: 'alps', box: [43.5, 47.5, 5.5, 15.5], sam: [46, 10] },
  { name: 'himalaya', box: [26, 32, 78, 92], sam: [29, 85] },
  { name: 'andes', box: [-38, -16, -72, -66], sam: [-28, -69] },
];

export interface FlightResult {
  readonly region: string;
  readonly mode: number;
  readonly routeCells: number;
  readonly etaTicks: number;
  readonly straightCells: number;
  /** ticks from the launch to HOVER (the outbound flight incl. take-off), -1 if it never hovered */
  readonly outTicks: number;
  /** ticks from the launch until the helicopter stood on a pad again, -1 if it did not */
  readonly homeTicks: number;
  readonly deadlineTicks: number;
  readonly meanSpeedRatio: number;
  readonly maxDistRatioRoute: number;
  readonly maxDistRatioStraight: number;
  readonly maxStepRatio: number;
  /** max over the cruise of (alt - (ground + 300)), game metres */
  readonly maxLiftOverNoe: number;
  readonly maxAlt: number;
  /** alt - (EXAG * mean + 300) at the highest ground the flight crossed (the ridge pass), game metres */
  readonly liftAtPass: number;
  readonly violations: string[];
}

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const cellOf = (lat: number, lon: number): number => {
  const x = Math.min(W - 1, Math.floor(((lon + 180) / 360) * W));
  const y = Math.min(H - 1, Math.floor(((90 - lat) / 180) * H));
  return y * W + x;
};

export async function makeFlightWorld(): Promise<GameState> {
  const world = await loadRealWorld();
  const s = createWorldState(world, { seed: 11, seats: 2, config: { debugIntents: true } });
  // one enemy SAM site per region (ownerId 2), finished
  for (const r of REGIONS) s.structures.add(STRUCT_SAM, 2, cellOf(r.sam[0], r.sam[1]), 0);
  return s;
}

interface Pending {
  region: string;
  mode: number;
  id: number;
  start: number;
  lz: number;
  routeCells: number;
  etaTicks: number;
  straightCells: number;
  launchTick: number;
  px: number;
  py: number;
  maxStep: number;
  cruiseMoved: number;
  cruiseTicks: number;
  maxDist: number;
  outTicks: number;
  homeTicks: number;
  maxLift: number;
  maxAlt: number;
  passGround: number;
  passLift: number;
  violations: string[];
}

function pick(s: GameState, r: Region, mode: number, rnd: () => number): { start: number; lz: number; routeCells: number; eta: number; straight: number } | null {
  const [la0, la1, lo0, lo1] = r.box;
  for (let attempt = 0; attempt < 400; attempt++) {
    const lat = la0 + rnd() * (la1 - la0);
    const lon = lo0 + rnd() * (lo1 - lo0);
    const start = cellOf(lat, lon);
    const cls = s.terrain[start] as number;
    if (cls !== CLASS_PLAINS && cls !== CLASS_HILLS) continue;
    const ang = rnd() * 2 * Math.PI;
    const dist = 30 + rnd() * 40;
    const sx = start % W;
    const sy = (start - sx) / W;
    const lx = Math.round(sx + Math.cos(ang) * dist);
    const ly = Math.round(sy + Math.sin(ang) * dist);
    if (lx < 0 || lx >= W || ly < 1 || ly >= H - 1) continue;
    const lz = ly * W + lx;
    const sc = scoreLzOf(s, 0, lz, start, mode as 0 | 1);
    if (sc.reason !== 0 || sc.fuelCells > 85) continue;
    const route = planRouteOf(s, 0, start, lz, mode as 0 | 1);
    if (!route.ok || route.waypoints.length < 2) continue;
    return { start, lz, routeCells: route.fuelCells, eta: route.etaTicks, straight: Math.hypot(lx - sx, ly - sy) };
  }
  return null;
}

/** Runs `rounds` rounds of six flights (3 regions x 2 modes) and returns one result per flight. */
export function runFlights(s: GameState, rounds: number, seed: number): FlightResult[] {
  const rnd = lcg(seed);
  const terr = losOf(s).terrain;
  const results: FlightResult[] = [];
  for (let round = 0; round < rounds; round++) {
    const pending: Pending[] = [];
    const intents: Intent[] = [];
    const picks: { r: Region; mode: number; pk: NonNullable<ReturnType<typeof pick>>; fid: number; hid: number }[] = [];
    for (const r of REGIONS) {
      for (const mode of [0, 1]) {
        const pk = pick(s, r, mode, rnd);
        if (pk === null) continue;
        const fid = s.structures.add(STRUCT_FACTORY, 1, pk.start, s.tick);
        s.structures.readyTick[fid] = s.tick;
        const hid = s.helis.addBuilding(1, fid, s.tick, s.tick);
        picks.push({ r, mode, pk, fid, hid });
      }
    }
    step(s, { turn: s.tick, intents: [] }); // production ends: the helicopters stand on their pads
    s.troops[1] = 4_000_000;
    for (let k = 0; k < picks.length; k++) {
      const p = picks[k] as (typeof picks)[number];
      intents.push(withId(launchHeliBody(0, p.fid, p.pk.lz, 100, p.mode), round * 16 + k));
    }
    s.outbox.clear();
    step(s, { turn: s.tick, intents });
    const refused = s.outbox.drain().filter((e) => e.kind === 2);
    const launchTick = s.tick - 1;
    for (const p of picks) {
      const id = p.hid;
      const rec: Pending = {
        region: p.r.name,
        mode: p.mode,
        id,
        start: p.pk.start,
        lz: p.pk.lz,
        routeCells: p.pk.routeCells,
        etaTicks: p.pk.eta,
        straightCells: p.pk.straight,
        launchTick,
        px: s.helis.x[id] as number,
        py: s.helis.y[id] as number,
        maxStep: 0,
        cruiseMoved: 0,
        cruiseTicks: 0,
        maxDist: 0,
        outTicks: -1,
        homeTicks: -1,
        maxLift: 0,
        maxAlt: 0,
        passGround: -1,
        passLift: 0,
        violations: [],
      };
      if (s.helis.state[id] !== HELI_LIFT) rec.violations.push(`launch refused: ${JSON.stringify(refused.map((e) => e.a))}`);
      pending.push(rec);
    }
    const sx0 = pending.map((p) => (s.helis.x[p.id] as number));
    const sy0 = pending.map((p) => (s.helis.y[p.id] as number));
    const maxTicks = Math.max(0, ...pending.map((p) => 2 * (HELI_TAKEOFF_TICKS + HELI_HOVER_TICKS + 2 * p.etaTicks))) + 50;
    for (let tick = 0; tick < maxTicks; tick++) {
      step(s, { turn: s.tick, intents: [] });
      let open = 0;
      for (let k = 0; k < pending.length; k++) {
        const p = pending[k] as Pending;
        if (p.homeTicks !== -1) continue;
        const id = p.id;
        const st = s.helis.state[id] as number;
        if (st === HELI_NONE) {
          p.violations.push(`vanished (state none) at +${s.tick - 1 - p.launchTick}`);
          p.homeTicks = -2;
          continue;
        }
        if (st === HELI_DOWNED) {
          p.homeTicks = -3; // ran dry on the way home (allowed for at most 5 % of the flights: the liveness assert)
          continue;
        }
        open++;
        const x = s.helis.x[id] as number;
        const y = s.helis.y[id] as number;
        const alt = s.helis.alt[id] as number;
        const fuel = s.helis.fuel[id] as number;
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(alt) || !Number.isFinite(fuel)) p.violations.push('non-finite value');
        let dx = Math.abs(x - p.px);
        if (dx > (W * HELI_POS_ONE) / 2) dx = W * HELI_POS_ONE - dx;
        const moved = Math.hypot(dx, y - p.py);
        if (moved > p.maxStep) p.maxStep = moved;
        const stepCap = (AIR_MODE_SPEED_MILLICELLS_S[p.mode] as number) * HELI_POS_ONE / (1000 * TICK_HZ);
        if (moved > 1.05 * stepCap) p.violations.push(`speed ${(moved / stepCap).toFixed(3)} x at +${s.tick - 1 - p.launchTick}`);
        p.px = x;
        p.py = y;
        const flying = st === HELI_CRUISE || st === HELI_APPROACH || st === HELI_HOVER || st === HELI_RETURN;
        if (flying) {
          const cell = (y >> 8) * W + (x >> 8);
          if (alt < (terr.occGm[cell] as number) + HELI_CLEARANCE_GAME_M) p.violations.push(`below the clearance at +${s.tick - 1 - p.launchTick}: alt ${alt} occ ${terr.occGm[cell]}`);
          if (alt < (terr.groundGm[cell] as number) + (AIR_MODE_AGL_M[p.mode] as number)) p.violations.push(`below ground + AGL at +${s.tick - 1 - p.launchTick}`);
          if (s.terrain[cell] === CLASS_PEAK) p.violations.push(`in a Peak cell at +${s.tick - 1 - p.launchTick} (state ${st})`);
          const lift = alt - ((terr.groundGm[cell] as number) + 300);
          if (lift > p.maxLift) p.maxLift = lift;
          if (alt > p.maxAlt) p.maxAlt = alt;
          if ((terr.groundGm[cell] as number) > p.passGround) {
            p.passGround = terr.groundGm[cell] as number;
            p.passLift = lift;
          }
        }
        if (st === HELI_CRUISE || st === HELI_APPROACH) {
          p.cruiseMoved += moved;
          p.cruiseTicks++;
        }
        let ddx = Math.abs(x - (sx0[k] as number));
        if (ddx > (W * HELI_POS_ONE) / 2) ddx = W * HELI_POS_ONE - ddx;
        const d = Math.hypot(ddx, y - (sy0[k] as number)) / HELI_POS_ONE;
        if (d > p.maxDist) p.maxDist = d;
        if (st === HELI_HOVER && p.outTicks < 0) p.outTicks = s.tick - 1 - p.launchTick;
        if (st === HELI_PAD) p.homeTicks = s.tick - 1 - p.launchTick;
      }
      if (open === 0) break;
    }
    for (const p of pending) {
      const stepNominal = ((AIR_MODE_SPEED_MILLICELLS_S[p.mode] as number) * HELI_POS_ONE) / (1000 * TICK_HZ);
      results.push({
        region: p.region,
        mode: p.mode,
        routeCells: p.routeCells,
        etaTicks: p.etaTicks,
        straightCells: p.straightCells,
        outTicks: p.outTicks,
        homeTicks: p.homeTicks,
        deadlineTicks: 2 * (HELI_TAKEOFF_TICKS + HELI_HOVER_TICKS + 2 * p.etaTicks),
        meanSpeedRatio: p.cruiseTicks === 0 ? 0 : p.cruiseMoved / p.cruiseTicks / stepNominal,
        maxDistRatioRoute: p.maxDist / p.routeCells,
        maxDistRatioStraight: p.maxDist / p.straightCells,
        maxStepRatio: p.maxStep / stepNominal,
        maxLiftOverNoe: p.maxLift,
        maxAlt: p.maxAlt,
        liftAtPass: p.passLift,
        violations: p.violations,
      });
    }
    // clean the table for the next round: the flights that came home stay parked, harmless; free the slots so the id space is reused
    for (let id = 0; id < s.helis.highWater; id++) if (s.helis.owner[id] !== 0 && s.helis.state[id] === HELI_PAD) s.helis.remove(id);
    for (const p of picks) s.structures.remove(p.fid);
  }
  return results;
}

/** Logs the numbers of a run (they go to docs/DECISIONS.md) and asserts the rules of the property test. */
export function checkFlights(label: string, rs: readonly FlightResult[]): void {
  const by = (f: (r: FlightResult) => boolean): FlightResult[] => rs.filter(f);
  const mean = (a: number[]): number => (a.length === 0 ? 0 : a.reduce((x, y) => x + y, 0) / a.length);
  const alps = by((r) => r.region === 'alps');
  console.log(
    `[heli flights ${label}] ${rs.length} flights; home ${rs.filter((r) => r.homeTicks >= 0).length}; ` +
      `route cells min/mean/max ${Math.min(...rs.map((r) => r.routeCells))}/${mean(rs.map((r) => r.routeCells)).toFixed(1)}/${Math.max(...rs.map((r) => r.routeCells))}; ` +
      `out-flight Low mean ${(mean(by((r) => r.mode === 0).map((r) => r.outTicks)) / 10).toFixed(1)} s, High ${(mean(by((r) => r.mode === 1).map((r) => r.outTicks)) / 10).toFixed(1)} s; ` +
      `speed ratio min/max ${Math.min(...rs.map((r) => r.meanSpeedRatio)).toFixed(3)}/${Math.max(...rs.map((r) => r.meanSpeedRatio)).toFixed(3)}; max step ratio ${Math.max(...rs.map((r) => r.maxStepRatio)).toFixed(3)}; ` +
      `max-dist/route min ${Math.min(...rs.map((r) => r.maxDistRatioRoute)).toFixed(3)}, max-dist/straight min ${Math.min(...rs.map((r) => r.maxDistRatioStraight)).toFixed(3)}; ` +
      `Alps alt over EXAG*mean+300: max ${Math.max(0, ...alps.map((r) => r.maxLiftOverNoe))} m (Low ${Math.max(0, ...alps.filter((r) => r.mode === 0).map((r) => r.maxLiftOverNoe))}, High ${Math.max(0, ...alps.filter((r) => r.mode === 1).map((r) => r.maxLiftOverNoe))}); max alt ${Math.max(...rs.map((r) => r.maxAlt))}; Alps lift at the ridge pass min/mean/max ${Math.min(...alps.map((r) => r.liftAtPass))}/${mean(alps.map((r) => r.liftAtPass)).toFixed(0)}/${Math.max(...alps.map((r) => r.liftAtPass))} m (Low mean ${mean(alps.filter((r) => r.mode === 0).map((r) => r.liftAtPass)).toFixed(0)})`,
  );
  const bad = rs.filter((r) => r.violations.length > 0).map((r) => `${r.region}/${r.mode}: ${r.violations[0]}`);
  expect(bad).toEqual([]);
  expect(Math.max(...rs.map((r) => r.maxStepRatio))).toBeLessThanOrEqual(1.05);
  const home = rs.filter((r) => r.homeTicks >= 0 && r.homeTicks <= r.deadlineTicks).length;
  expect(home / rs.length).toBeGreaterThanOrEqual(0.95);
  for (const r of rs) {
    expect(r.meanSpeedRatio, `${r.region}/${r.mode} speed`).toBeGreaterThan(0.9);
    expect(r.meanSpeedRatio, `${r.region}/${r.mode} speed`).toBeLessThan(1.1);
    expect(r.maxDistRatioStraight, `${r.region}/${r.mode} reached`).toBeGreaterThanOrEqual(0.8);
  }
  const raids = rs.filter((r) => r.routeCells >= 55 && r.outTicks >= 0);
  expect(raids.length).toBeGreaterThan(0);
  for (const r of raids) expect(r.outTicks, `${r.region}/${r.mode} ${r.routeCells} cells`).toBeGreaterThanOrEqual(150);
}
