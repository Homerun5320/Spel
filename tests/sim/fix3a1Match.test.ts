// Fix-3A1 (audit 2): the match block of the saved state. Hash coverage of every result field, a round trip of the asymmetric win flag sets, and one
// test per guard of readMatch. A forged blob is made by tampering the in-memory state and serialising it, so its checksum is VALID and only the
// guard can refuse it ('match-range'); a control run per table proves the untampered state loads.
import { describe, expect, it } from 'vitest';
import { WIN_FLAG_LAND, WIN_FLAG_LAST, WIN_FLAG_SCORE, winFlagsOf, type WinConfig } from '../../src/sim/matchState';
import { WEIGHT_ONE } from '../../src/sim/rules';
import { deserialize, FORMAT_VERSION, hashState, serialize } from '../../src/sim/serialize';
import { createState, ENGINE_VERSION, type GameState } from '../../src/sim/state';
import { setOwner } from '../../src/sim/territory';
import { CLASS_PLAINS } from '../../src/sim/terrain';

const W = 20;
const H = 20;
const CELLS = W * H;
const WIN: WinConfig = { land: true, last: true, score: true, timeLimitTicks: 1000, landSharePct: 60, holdTicks: 300 };

function world(win: WinConfig | undefined, seats = 3): GameState {
  const s = createState({
    width: W,
    height: H,
    seed: 5,
    seats,
    players: seats,
    rowCos: new Uint16Array(H).fill(WEIGHT_ONE),
    config: { debugIntents: true, ...(win === undefined ? {} : { win }) },
    terrain: new Uint8Array(CELLS).fill(CLASS_PLAINS),
    elevation: new Uint16Array(CELLS),
  });
  for (let c = 0; c < 30; c++) setOwner(s, c, 1, 0);
  return s;
}

describe('the hash covers every field of the match block on its own', () => {
  const FIELDS: Array<[string, (s: GameState) => void]> = [
    ['ended', (s) => void (s.match.ended = 1)],
    ['winner', (s) => void (s.match.winner = 1)],
    ['reason', (s) => void (s.match.reason = 1)],
    ['endTick', (s) => void (s.match.endTick = 7)],
    ['holdOwner', (s) => void (s.match.holdOwner = 2)],
    ['holdCount', (s) => void (s.match.holdCount = 9)],
    ['eliminated', (s) => void (s.match.eliminated[2] = 1)],
    ['capitalLost', (s) => void (s.match.capitalLost[2] = 1)],
    ['peakLand', (s) => void (s.match.peakLand[2] = 4)],
    ['built', (s) => void (s.match.built[2] = 4)],
    ['conquered', (s) => void (s.match.conquered[2] = 4)],
    ['districts', (s) => void (s.match.districts[2] = 4)],
  ];
  for (const [name, set] of FIELDS) {
    it(`${name} alone changes the hash`, () => {
      const a = world(WIN);
      const b = world(WIN);
      expect(hashState(a)).toBe(hashState(b));
      set(b);
      expect(hashState(b)).not.toBe(hashState(a));
    });
  }
  it('the three win numbers and the flag set each change the hash', () => {
    const base = hashState(world(WIN));
    expect(hashState(world({ ...WIN, timeLimitTicks: 1001 }))).not.toBe(base);
    expect(hashState(world({ ...WIN, landSharePct: 59 }))).not.toBe(base);
    expect(hashState(world({ ...WIN, holdTicks: 301 }))).not.toBe(base);
    expect(hashState(world({ ...WIN, score: false }))).not.toBe(base);
  });
});

describe('every win flag combination round trips (the bit mapping cannot be swapped unnoticed)', () => {
  for (let bits = 1; bits <= 7; bits++) {
    it(`flags ${bits}: land=${bits & 1} last=${(bits >> 1) & 1} score=${(bits >> 2) & 1}`, () => {
      const win: WinConfig = { land: (bits & 1) !== 0, last: (bits & 2) !== 0, score: (bits & 4) !== 0, timeLimitTicks: 777, landSharePct: 45, holdTicks: 88 };
      expect(winFlagsOf(win)).toBe((win.land ? WIN_FLAG_LAND : 0) | (win.last ? WIN_FLAG_LAST : 0) | (win.score ? WIN_FLAG_SCORE : 0));
      expect([WIN_FLAG_LAND, WIN_FLAG_LAST, WIN_FLAG_SCORE]).toEqual([1, 2, 4]);
      const s = world(win === null ? undefined : win);
      const r = deserialize(serialize(s));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.state.header.config.win).toEqual(win);
      expect(hashState(r.state)).toBe(hashState(s));
    });
  }
});

describe('deserialize refuses a forged match block with a VALID checksum, one guard at a time', () => {
  const refusedBy = (tamper: (s: GameState) => void, win: WinConfig | null = WIN): void => {
    const s = world(win === null ? undefined : win);
    expect(deserialize(serialize(s)).ok, 'the untampered state loads').toBe(true);
    tamper(s);
    const r = deserialize(serialize(s));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('match-range');
  };
  const okAfter = (tamper: (s: GameState) => void, win: WinConfig | null = WIN): void => {
    const s = world(win === null ? undefined : win);
    tamper(s);
    expect(deserialize(serialize(s)).ok).toBe(true);
  };

  it('control: a finished match, a draw and a running hold are valid', () => {
    okAfter((s) => Object.assign(s.match, { ended: 1, winner: 2, reason: 3, endTick: 99 }));
    okAfter((s) => Object.assign(s.match, { ended: 1, winner: 0, reason: 0, endTick: 99 }));
    okAfter((s) => Object.assign(s.match, { holdOwner: 1, holdCount: WIN.holdTicks }));
  });
  it('ended must be 0 or 1', () => refusedBy((s) => void (s.match.ended = 2)));
  it('the winner must be a seat', () => refusedBy((s) => Object.assign(s.match, { ended: 1, winner: 4, reason: 1, endTick: 5 })));
  it('the reason must be 0 to 3', () => refusedBy((s) => Object.assign(s.match, { ended: 1, winner: 1, reason: 4, endTick: 5 })));
  it('the hold owner must be a seat', () => refusedBy((s) => Object.assign(s.match, { holdOwner: 4, holdCount: 1 })));
  it('a match that has not ended has no winner, no reason and no end tick (each alone)', () => {
    refusedBy((s) => void (s.match.winner = 1));
    refusedBy((s) => void (s.match.reason = 1));
    refusedBy((s) => void (s.match.endTick = 5));
  });
  it('an ended match has a winner exactly when it has a reason (both directions)', () => {
    refusedBy((s) => Object.assign(s.match, { ended: 1, winner: 1, reason: 0, endTick: 5 }));
    refusedBy((s) => Object.assign(s.match, { ended: 1, winner: 0, reason: 1, endTick: 5 }));
  });
  it('the hold owner and the hold count agree: owner 0 means count 0, an owner means count >= 1', () => {
    refusedBy((s) => void (s.match.holdCount = 1));
    refusedBy((s) => Object.assign(s.match, { holdOwner: 1, holdCount: 0 }));
  });
  it('the hold count never exceeds holdTicks, and a match without a win block has no hold', () => {
    refusedBy((s) => Object.assign(s.match, { holdOwner: 1, holdCount: WIN.holdTicks + 1 }));
    refusedBy((s) => Object.assign(s.match, { holdOwner: 1, holdCount: 1 }), null);
  });
  it('the per-seat flags are 0 or 1', () => {
    refusedBy((s) => void (s.match.eliminated[1] = 2));
    refusedBy((s) => void (s.match.capitalLost[1] = 2));
  });
  it('slot 0 of every per-owner array is empty (each array alone)', () => {
    refusedBy((s) => void (s.match.eliminated[0] = 1));
    refusedBy((s) => void (s.match.capitalLost[0] = 1));
    refusedBy((s) => void (s.match.peakLand[0] = 1));
    refusedBy((s) => void (s.match.built[0] = 1));
    refusedBy((s) => void (s.match.conquered[0] = 1));
    refusedBy((s) => void (s.match.districts[0] = 1));
  });
  it('the win numbers must be in range when a flag is on, and zero when none is (byte patches: the guard answers before the checksum is read)', () => {
    const slots = 4;
    const patched = (flags: number, limit: number, pct: number, hold: number): string => {
      const bytes = serialize(world(WIN));
      const at0 = bytes.length - 4 - (40 + 2 * slots * 4 + 4 * slots * 4);
      const v = new DataView(bytes.buffer);
      [flags, limit, pct, hold].forEach((x, i) => v.setUint32(at0 + i * 4, x, true));
      const r = deserialize(bytes);
      return r.ok ? 'ok' : r.error;
    };
    expect(patched(7, 1000, 60, 300)).toBe('ok'); // control: the same values load
    expect(patched(7, 1001, 60, 300)).toBe('checksum'); // control: in range but changed, so only the checksum refuses it
    expect(patched(7, 0, 60, 300)).toBe('match-range');
    expect(patched(7, 1000, 0, 300)).toBe('match-range');
    expect(patched(7, 1000, 101, 300)).toBe('match-range');
    expect(patched(7, 1000, 60, 0)).toBe('match-range');
    expect(patched(0, 5, 0, 0)).toBe('match-range');
    expect(patched(0, 0, 5, 0)).toBe('match-range');
    expect(patched(0, 0, 0, 5)).toBe('match-range');
  });
  it('a flag word above 7 in the bytes is refused by the guard, not by the checksum', () => {
    const s = world(WIN);
    const bytes = serialize(s);
    // the match block ends with 4 per-owner u8-in-u32 arrays of (seats + 1) words, 4 stat arrays, and the 4 byte checksum
    const slots = 4;
    const blockStart = bytes.length - 4 - (40 + 2 * slots * 4 + 4 * slots * 4);
    expect(new DataView(bytes.buffer).getUint32(blockStart, true)).toBe(7);
    new DataView(bytes.buffer).setUint32(blockStart, 8, true);
    const r = deserialize(bytes);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('match-range');
  });
});

describe('old formats and engines are refused by their own error', () => {
  it('FORMAT_VERSION - 1 and ENGINE_VERSION - 1 (and + 1)', () => {
    const bytes = serialize(world(WIN));
    for (const [offset, value, error] of [
      [4, FORMAT_VERSION - 1, 'format-version'],
      [4, FORMAT_VERSION + 1, 'format-version'],
      [8, ENGINE_VERSION - 1, 'engine-version'],
      [8, ENGINE_VERSION + 1, 'engine-version'],
    ] as const) {
      const bad = bytes.slice();
      new DataView(bad.buffer).setUint32(offset, value, true);
      const r = deserialize(bad);
      expect(r.ok, `${error} ${value}`).toBe(false);
      if (!r.ok) expect(r.error).toBe(error);
    }
  });
});
