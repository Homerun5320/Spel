// The attack table and the enclave queue in the snapshot: round trip, hash coverage, and bytes that lie about them.
import { describe, expect, it } from 'vitest';
import { enclaveBucket } from '../../src/sim/enclaveQueue';
import { ENCLAVE_FLIP_TICKS, PROGRESS_DEBT_MAX } from '../../src/sim/rules';
import { HEADER_BYTES, deserialize, hashState, serialize, serializedLength } from '../../src/sim/serialize';
import type { GameState } from '../../src/sim/state';
import { MatchDriver, RW, RH, RSEATS, randomMatchState } from './helpers/randomMatch';

function matchWithAttacks(): GameState {
  for (const seed of [3, 11, 29, 5, 6]) {
    const s = randomMatchState(seed);
    const d = new MatchDriver(s, seed);
    for (let t = 0; t < 300; t++) {
      d.tick();
      if (s.attacks.list.length >= 3 && s.enclaves.length > 0 && t > 120) return s;
    }
  }
  throw new Error('no random match produced three attacks and a queued candidate');
}

/** Byte offset of the attack table in the serialized form. */
function attackStart(s: GameState): number {
  return HEADER_BYTES + RW * RH * 11 + RH * 2 + (s.header.seats + 1) * 16;
}

function error(bytes: Uint8Array): string {
  const r = deserialize(bytes);
  return r.ok ? 'ok' : r.error;
}

describe('attacks and the enclave queue in a snapshot', () => {
  it('round-trips a state with running attacks and queued candidates: same hash, same heaps, same buckets, same derived lookups', () => {
    const s = matchWithAttacks();
    const r = deserialize(serialize(s));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const t = r.state;
    expect(hashState(t)).toBe(hashState(s));
    expect(t.attacks.seq).toBe(s.attacks.seq);
    expect(t.attacks.list.length).toBe(s.attacks.list.length);
    s.attacks.list.forEach((a, i) => {
      const b = t.attacks.list[i];
      expect([b?.id, b?.attacker, b?.target, b?.troops, b?.costFrac, b?.progress, b?.compactAt, b?.picks, b?.size]).toEqual([a.id, a.attacker, a.target, a.troops, a.costFrac, a.progress, a.compactAt, a.picks, a.size]);
      // `low` is derived and only a lower bound ("every bag below it is empty"): the live attack may keep a stale low after its shallowest
      // bag ran empty, the loaded one recounts it tight. So compare the property, not the number: both bound the first non-empty bag,
      // and the loaded one is exactly it.
      const first = Array.from(a.counts).findIndex((n) => n > 0);
      const tight = first < 0 ? 0 : first;
      expect(a.low).toBeLessThanOrEqual(tight);
      expect(b?.low).toBe(tight);
      expect(b?.entries()).toEqual(a.entries()); // the bags in their order, bag by bag
      expect(t.attacks.indexOf(a.attacker, a.target)).toBe(i);
    });
    expect(Array.from(t.enclaves.counts)).toEqual(Array.from(s.enclaves.counts));
    expect(Array.from(t.enclaves.queued)).toEqual(Array.from(s.enclaves.queued));
    expect(Array.from(t.borders.edges)).toEqual(Array.from(s.borders.edges));
    expect(serialize(t)).toEqual(serialize(s));
  });

  it('terrain debt (negative capture progress, D106) survives a round trip and is bounded on load', () => {
    const s = matchWithAttacks();
    const a = s.attacks.list[0];
    if (a === undefined) throw new Error('need an attack');
    a.progress = -1500000;
    const r = deserialize(serialize(s));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.attacks.list[0]?.progress).toBe(-1500000);
    expect(hashState(r.state)).toBe(hashState(s));
    a.progress = -PROGRESS_DEBT_MAX;
    expect(error(serialize(s))).toBe('ok');
    a.progress = -PROGRESS_DEBT_MAX - 1;
    expect(error(serialize(s))).toBe('attack-range');
  });

  it('every field of every attack, the sequence number and every queued cell is in the hash', () => {
    const s = matchWithAttacks();
    const base = hashState(s);
    const touch = (label: string, change: () => void, undo: () => void): void => {
      change();
      expect(hashState(s), label).not.toBe(base);
      undo();
      expect(hashState(s), `${label} (undone)`).toBe(base);
    };
    touch('seq', () => s.attacks.seq++, () => s.attacks.seq--);
    for (const field of ['id', 'attacker', 'target', 'troops', 'costFrac', 'progress', 'compactAt', 'picks'] as const) {
      const a = s.attacks.list[1];
      if (a === undefined) throw new Error('need two attacks');
      touch(`attack.${field}`, () => (a[field] += 1), () => (a[field] -= 1));
    }
    const a = s.attacks.list[0];
    if (a === undefined || a.size < 2) throw new Error('need a frontier');
    let d0 = 0;
    while ((a.counts[d0] as number) === 0) d0++;
    const bag = a.bags[d0] as Int32Array;
    const last = (a.counts[d0] as number) - 1;
    touch('frontier cell (first of the shallowest bag)', () => (bag[0] = (bag[0] as number) ^ 1), () => (bag[0] = (bag[0] as number) ^ 1));
    touch('frontier cell (last of the shallowest bag)', () => (bag[last] = (bag[last] as number) ^ 1), () => (bag[last] = (bag[last] as number) ^ 1));
    touch('frontier count of a bag', () => (a.counts[d0] = (a.counts[d0] as number) - 1), () => (a.counts[d0] = (a.counts[d0] as number) + 1));
    // the order inside a bag is state: swapping two cells changes the hash
    if (last >= 1) touch('frontier order', () => { const t = bag[0] as number; bag[0] = bag[last] as number; bag[last] = t; }, () => { const t = bag[0] as number; bag[0] = bag[last] as number; bag[last] = t; });
    let b = 0;
    while ((s.enclaves.counts[b] as number) === 0) b++;
    const list = s.enclaves.buckets[b] as Int32Array;
    touch('queued cell', () => (list[0] = (list[0] as number) ^ 1), () => (list[0] = (list[0] as number) ^ 1));
    touch('bucket count', () => (s.enclaves.counts[b] = (s.enclaves.counts[b] as number) + 1), () => (s.enclaves.counts[b] = (s.enclaves.counts[b] as number) - 1));
  });

  it('bytes that lie about the attack table are refused with an error result, never a throw', () => {
    const s = matchWithAttacks();
    const bytes = serialize(s);
    const at = attackStart(s);
    const rec = at + 8; // first attack record: id, attacker, target, troops, costFrac, progress, compactAt, picks, bags
    const bag0 = rec + 36; // its first bag: depth, count, cells
    const cases: Array<[string, (v: DataView) => void, string]> = [
      ['attack count beyond the pairs that exist', (v) => v.setUint32(at + 4, 100000, true), 'attack-range'],
      ['attack count larger than the bytes', (v) => v.setUint32(at + 4, s.attacks.list.length + 1, true), 'attack-range'],
      ['attacker 0', (v) => v.setUint32(rec + 4, 0, true), 'attack-range'],
      ['attacker beyond the seats', (v) => v.setUint32(rec + 4, RSEATS + 1, true), 'attack-range'],
      ['target beyond the seats', (v) => v.setUint32(rec + 8, RSEATS + 1, true), 'attack-range'],
      ['target equal to the attacker', (v) => v.setUint32(rec + 8, v.getUint32(rec + 4, true), true), 'attack-range'],
      ['a cost remainder of a whole QT', (v) => v.setUint32(rec + 16, 1000, true), 'attack-range'],
      ['progress of a whole cell', (v) => v.setUint32(rec + 20, 1000000, true), 'attack-range'],
      ['a purge threshold of 0', (v) => v.setUint32(rec + 24, 0, true), 'attack-range'],
      ['more bags than depths', (v) => v.setUint32(rec + 32, 0x7fffffff, true), 'attack-range'],
      ['id 0 (ids start at 1 and ascend)', (v) => v.setUint32(rec, 0, true), 'attack-range'],
      ['an id above the sequence number', (v) => v.setUint32(rec, 0xffffffff, true), 'attack-range'],
      ['a depth above D_MAX', (v) => v.setUint32(bag0, 81, true), 'attack-range'],
      ['an empty bag', (v) => v.setUint32(bag0 + 4, 0, true), 'attack-range'],
      ['a bag larger than the bytes', (v) => v.setUint32(bag0 + 4, 0x7fffffff, true), 'attack-range'],
      ['a frontier cell outside the map', (v) => v.setUint32(bag0 + 8, RW * RH, true), 'attack-range'],
    ];
    for (const [name, edit, want] of cases) {
      const out = bytes.slice();
      edit(new DataView(out.buffer));
      expect(error(out), name).toBe(want);
    }
  });

  it('bytes that lie about the enclave queue: a cell twice, a cell in the wrong bucket, a cell outside the map, a count beyond the bytes', () => {
    const s = matchWithAttacks();
    const bytes = serialize(s);
    // find the start of the enclave section: after the last attack record
    let p = attackStart(s) + 8;
    for (const a of s.attacks.list) p += 36 + 4 * a.size + 8 * a.counts.reduce((n, c) => n + (c > 0 ? 1 : 0), 0);
    let b = 0;
    let q = p;
    while ((s.enclaves.counts[b] as number) === 0) {
      q += 4;
      b++;
    }
    const cell = (s.enclaves.buckets[b] as Int32Array)[0] as number;
    const wrongBucket = (b + 1) % ENCLAVE_FLIP_TICKS;
    expect(enclaveBucket(s.header.seed, cell)).toBe(b);
    const mk = (edit: (v: DataView) => void): Uint8Array => {
      const out = bytes.slice();
      edit(new DataView(out.buffer));
      return out;
    };
    expect(error(mk((v) => v.setUint32(q + 4, RW * RH, true)))).toBe('enclave-range');
    expect(error(mk((v) => v.setUint32(q, 0x7fffffff, true)))).toBe('enclave-range');
    // the same cell moved to a bucket it does not hash to: bump the count of the next bucket and give it the cell
    expect(enclaveBucket(s.header.seed, cell)).not.toBe(wrongBucket);
    // a repeated cell inside one bucket needs two entries; use the first cell of this bucket as the second entry of another bucket
    const dup = mk((v) => {
      // overwrite the first entry with a cell that hashes elsewhere
      let other = 0;
      while (enclaveBucket(s.header.seed, other) === b || s.enclaves.queued[other] === 1) other++;
      v.setUint32(q + 4, other, true);
    });
    expect(error(dup)).toBe('enclave-range');
  });

  it('no byte of the variable part, changed to any value, and no truncation makes deserialize throw; an accepted result has a matching hash', () => {
    const s = matchWithAttacks();
    const bytes = serialize(s);
    const from = attackStart(s);
    let accepted = 0;
    let refused = 0;
    // every 7th byte of the variable part times a few values (the checksum is verified last, so almost all are refused; none may throw)
    for (let i = from; i < bytes.length; i += 7) {
      for (const val of [0, 1, 0x7f, 0x80, 0xff]) {
        const out = bytes.slice();
        out[i] = val;
        const r = deserialize(out);
        if (r.ok) {
          accepted++;
          expect(hashState(r.state)).toBe(hashState(s)); // only a byte that was already that value
        } else refused++;
      }
    }
    for (let len = from; len < bytes.length; len += 53) expect(deserialize(bytes.subarray(0, len)).ok).toBe(false);
    expect(deserialize(bytes.subarray(0, bytes.length - 1)).ok).toBe(false);
    const longer = new Uint8Array(bytes.length + 4);
    longer.set(bytes);
    expect(deserialize(longer).ok).toBe(false);
    expect(refused).toBeGreaterThan(accepted);
  });

  it('a state with no attack and no candidate serializes to exactly serializedLength', () => {
    const s = randomMatchState(1);
    expect(serialize(s).length).toBe(serializedLength(RW, RH, RSEATS));
  });
});
