// M14a: the flight geometry (src/sim/missileGeom.ts) against the real sphere: unit vectors, the chord to arc table, the flight time and the position of the normalised lerp. The tests may
// use Math.sin / asin; the sim may not.
import { describe, expect, it } from 'vitest';
import { RANGE_CHORD, angleOfChord, cellVector, chordQ15, flightTicksOf, inRange, missilePosition, newTrack, trackOf } from '../../src/sim/missileGeom';
import { MISSILE_FISSION, MISSILE_FUSION, MISSILE_TACTICAL } from '../../src/sim/missileTable';
import { MISSILE_MAX_FLIGHT_TICKS, MISSILE_RANGE_ANGLE, MISSILE_SPEED_ANGLE_PER_TICK } from '../../src/sim/rules';

const W = 1024;
const H = 512;
const at = (x: number, y: number): number => y * W + x;

describe('cell vectors', () => {
  it('are unit vectors (within 3 Q15 units) at the true longitude and latitude of the cell centre', () => {
    const v = new Int32Array(3);
    for (const [x, y] of [[0, 0], [100, 255], [512, 256], [777, 100], [1023, 511], [300, 85]] as const) {
      cellVector(at(x, y), W, H, v, 0);
      const len = Math.hypot(v[0] as number, v[1] as number, v[2] as number);
      expect(Math.abs(len - 32768), `${x},${y}`).toBeLessThan(4);
      const lat = Math.PI / 2 - ((y + 0.5) * Math.PI) / H;
      const lon = ((x + 0.5) * 2 * Math.PI) / W;
      expect(Math.abs((v[2] as number) / 32768 - Math.sin(lat))).toBeLessThan(0.0004);
      expect(Math.abs((v[0] as number) / 32768 - Math.cos(lat) * Math.cos(lon))).toBeLessThan(0.0004);
      expect(Math.abs((v[1] as number) / 32768 - Math.cos(lat) * Math.sin(lon))).toBeLessThan(0.0004);
    }
  });
});

describe('the chord table', () => {
  it('turns a chord into the arc (angle units) within 0.5 percent or 6 units', () => {
    for (let angle = 20; angle <= 32768; angle += 97) {
      const chord = Math.round(2 * Math.sin((angle / 65536) * Math.PI) * 32768);
      const got = angleOfChord(chord);
      expect(Math.abs(got - angle), `angle ${angle}`).toBeLessThanOrEqual(Math.max(6, angle * 0.005));
    }
    expect(angleOfChord(0)).toBe(0);
    expect(angleOfChord(70000)).toBe(32768);
  });

  it('the range chords are those of 5120 and 15360 units; Fusion has none', () => {
    expect(MISSILE_RANGE_ANGLE).toEqual([5120, 15360, 0]);
    for (const cls of [MISSILE_TACTICAL, MISSILE_FISSION]) {
      const want = 2 * Math.sin(((MISSILE_RANGE_ANGLE[cls] as number) / 65536) * Math.PI) * 32768;
      expect(Math.abs((RANGE_CHORD[cls] as number) - want)).toBeLessThan(3);
      expect(inRange(RANGE_CHORD[cls] as number, cls)).toBe(true);
      expect(inRange((RANGE_CHORD[cls] as number) + 1, cls)).toBe(false);
    }
    expect(inRange(1e9, MISSILE_FUSION)).toBe(true);
  });
});

describe('the flight time', () => {
  it('is ceil(arc / speed): 60 cells at the cruise speed 30 ticks, 150 cells at the ballistic speed 50 ticks, half the globe 171', () => {
    const t = newTrack();
    trackOf(at(250, 250), at(310, 250), W, H, MISSILE_TACTICAL, t);
    expect(Math.abs(t.angle - 60 * 64 * Math.cos((1.4 * Math.PI) / 180))).toBeLessThan(40); // 60 reference cells along a parallel near the equator
    expect(t.ticks).toBe(Math.ceil(t.angle / (MISSILE_SPEED_ANGLE_PER_TICK[0] as number)));
    expect(t.ticks).toBe(30);
    trackOf(at(250, 250), at(400, 250), W, H, MISSILE_FUSION, t);
    expect(t.ticks).toBe(50);
    trackOf(at(0, 256), at(512, 256), W, H, MISSILE_FUSION, t);
    expect(t.ticks).toBe(171);
    expect(t.ticks).toBeLessThanOrEqual(MISSILE_MAX_FLIGHT_TICKS);
    expect(flightTicksOf(0, MISSILE_TACTICAL)).toBe(1);
    expect(flightTicksOf(128, MISSILE_TACTICAL)).toBe(1);
    expect(flightTicksOf(129, MISSILE_TACTICAL)).toBe(2);
    expect(flightTicksOf(129, MISSILE_FUSION)).toBe(1);
  });

  it('a flight over the date line takes the short way', () => {
    const t = newTrack();
    trackOf(at(1020, 250), at(4, 250), W, H, MISSILE_TACTICAL, t);
    expect(t.ticks).toBeLessThanOrEqual(5);
    const a = new Int32Array(3);
    const b = new Int32Array(3);
    cellVector(at(1020, 250), W, H, a, 0);
    cellVector(at(4, 250), W, H, b, 0);
    expect(chordQ15(a, 0, b, 0)).toBe(t.chord);
  });
});

describe('the position', () => {
  it('is exactly the start at the launch and exactly the target at the blast, for any pair of cells', () => {
    const p = new Int32Array(3);
    const s = new Int32Array(3);
    const e = new Int32Array(3);
    for (const [a, b] of [[at(250, 250), at(310, 250)], [at(10, 40), at(900, 400)], [at(500, 100), at(20, 300)], [at(0, 0), at(512, 256)], [at(77, 123), at(78, 124)]] as const) {
      cellVector(a, W, H, s, 0);
      cellVector(b, W, H, e, 0);
      missilePosition(a, b, 7, 37, 7, W, H, p);
      expect(Array.from(p), `start of ${a} to ${b}`).toEqual(Array.from(s));
      missilePosition(a, b, 7, 37, 37, W, H, p);
      expect(Array.from(p), `target of ${a} to ${b}`).toEqual(Array.from(e));
    }
  });

  it('starts at the start cell, ends at the target cell, stays on the unit sphere and moves monotonically towards the target', () => {
    const start = at(250, 250);
    const target = at(400, 250);
    const s = new Int32Array(3);
    const e = new Int32Array(3);
    cellVector(start, W, H, s, 0);
    cellVector(target, W, H, e, 0);
    const p = new Int32Array(3);
    missilePosition(start, target, 100, 150, 100, W, H, p);
    expect(Array.from(p)).toEqual(Array.from(s).map((x) => x));
    missilePosition(start, target, 100, 150, 150, W, H, p);
    expect(Array.from(p)).toEqual(Array.from(e));
    missilePosition(start, target, 100, 150, 99, W, H, p);
    expect(Array.from(p)).toEqual(Array.from(s)); // before the launch: the start
    missilePosition(start, target, 100, 150, 999, W, H, p);
    expect(Array.from(p)).toEqual(Array.from(e)); // after the blast: the target
    let last = 1e12;
    for (let tick = 100; tick <= 150; tick += 5) {
      missilePosition(start, target, 100, 150, tick, W, H, p);
      expect(Math.abs(Math.hypot(p[0] as number, p[1] as number, p[2] as number) - 32768)).toBeLessThan(3);
      const d = chordQ15(p, 0, e, 0);
      expect(d).toBeLessThanOrEqual(last);
      last = d;
    }
    missilePosition(start, target, 100, 150, 125, W, H, p);
    // the middle is the middle of the arc: as far from the start as from the target within a few percent
    expect(Math.abs(chordQ15(p, 0, s, 0) - chordQ15(p, 0, e, 0))).toBeLessThan(40);
  });
});
