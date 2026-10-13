// Serialisation of the M04 arrays: wide values survive, hostile values are refused as results.
import { describe, expect, it } from 'vitest';
import { HEADER_BYTES, deserialize, hashState, serialize, serializedLength } from '../../src/sim/serialize';
import { MICRO_QT_PER_QT } from '../../src/sim/rules';
import { landState } from './helpers/worlds';

function sample() {
  const s = landState(12, 6, { seats: 5, players: 3 });
  s.troops.set([0, 4294967295, 65536, 1, 123456789, 0]);
  s.troopFrac.set([0, 999999, 0, 1, 500000, 7]);
  s.gold.set([0, 4294967295, 4294967294, 1, 0, 65537]);
  s.capital.set([0, 72, 1, 0, 40, 71]);
  s.owner[3] = 2;
  return s;
}

describe('serialize: economy arrays', () => {
  it('round trips extreme troops, remainders, gold and capitals, players included', () => {
    const s = sample();
    const bytes = serialize(s);
    expect(bytes.length).toBe(serializedLength(12, 6, 5));
    const r = deserialize(bytes);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const name of ['troops', 'troopFrac', 'gold', 'capital', 'rowCos'] as const) expect(r.state[name]).toEqual(s[name]);
    expect(r.state.header.players).toBe(3);
    expect(hashState(r.state)).toBe(hashState(s));
    expect(Array.from(serialize(r.state))).toEqual(Array.from(bytes));
  });

  const bad = (patch: (s: ReturnType<typeof sample>) => void) => {
    const s = sample();
    patch(s);
    return deserialize(serialize(s));
  };
  const code = (r: ReturnType<typeof deserialize>) => (r.ok ? 'ok' : r.error);

  it('refuses economy arrays of a shape the sim does not produce', () => {
    expect(code(bad((s) => { s.troops[0] = 1; }))).toBe('economy-range');
    expect(code(bad((s) => { s.gold[0] = 1; }))).toBe('economy-range');
    expect(code(bad((s) => { s.capital[0] = 1; }))).toBe('economy-range');
    expect(code(bad((s) => { s.troopFrac[0] = 1; }))).toBe('economy-range');
    expect(code(bad((s) => { s.troopFrac[2] = MICRO_QT_PER_QT; }))).toBe('economy-range');
    expect(code(bad((s) => { s.capital[2] = 12 * 6 + 1; }))).toBe('economy-range');
    expect(code(bad((s) => { s.capital[2] = 12 * 6; }))).toBe('ok'); // the last cell is a cell
  });

  it('refuses a bad player count or a row weight above one', () => {
    const bytes = serialize(sample());
    const v = (patch: (d: DataView) => void) => {
      const b = bytes.slice();
      patch(new DataView(b.buffer));
      return code(deserialize(b));
    };
    expect(v((d) => d.setUint32(60, 0, true))).toBe('header');
    expect(v((d) => d.setUint32(60, 6, true))).toBe('header'); // more players than seats
    expect(v((d) => d.setUint32(60, 5, true))).toBe('checksum'); // fine as a header, the checksum notices
    const rowAt = HEADER_BYTES + 72 * 9;
    expect(v((d) => d.setUint16(rowAt, 32769, true))).toBe('header');
  });

  it('a hostile snapshot with every cell owned and playable cannot crash the loader (weights wrap, nothing throws)', () => {
    const s = landState(12, 6, { seats: 5 });
    for (let c = 0; c < 72; c++) s.owner[c] = 5;
    expect(deserialize(serialize(s)).ok).toBe(true);
  });
});
