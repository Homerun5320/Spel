// Enclaves in a whole match on the real world: 32 seats, every one a fighter, the regions enclosed by one owner are looked
// for with a brute-force scan of the map every 50 ticks. A region that is unchanged across two scans (more than 20 ticks
// apart) was missed by the candidate rule (D86, D91). Two seeds that used to leave regions behind: a free pocket that its
// surrounding owner ate down below the size cap (seed 3), and a region of an owner that a neighbour split off (seed 4).
import { describe, expect, it } from 'vitest';
import { ENCLAVE_MAX_CELLS } from '../../src/sim/rules';
import { IdAllocator, withId, type IntentBody } from '../../src/sim/intents';
import { step } from '../../src/sim/step';
import type { GameState } from '../../src/sim/state';
import { createWorldState } from '../../src/sim/world';
import { botIntents } from '../../tools/sim/bots';
import { loadRealWorld } from '../../tools/sim/realWorld';
import { largestCountries, pickCountries } from '../../tools/sim/scenario';

/** Every region of at most ENCLAVE_MAX_CELLS cells whose outside is playable land of ONE other owner > 0, keyed by owner, surround and first cells. */
function enclosedRegions(s: GameState): Map<string, number> {
  const seen = new Uint8Array(s.grid.cells);
  const nb = new Int32Array(4);
  const out = new Map<string, number>();
  for (let start = 0; start < s.grid.cells; start++) {
    if (seen[start] || s.grid.playable[start] !== 1) continue;
    const x = s.owner[start] as number;
    const comp = [start];
    seen[start] = 1;
    let open = false;
    let surround = -1;
    for (let h = 0; h < comp.length; h++) {
      const c = comp[h] as number;
      const n = s.grid.neighbours(c, nb);
      for (let k = 0; k < n; k++) {
        const m = nb[k] as number;
        if (m === c) continue;
        if (s.grid.playable[m] !== 1) open = true;
        else if (s.owner[m] === x) {
          if (!seen[m]) {
            seen[m] = 1;
            comp.push(m);
          }
        } else if (surround === -1) surround = s.owner[m] as number;
        else if (surround !== s.owner[m]) open = true;
      }
    }
    if (!open && surround > 0 && comp.length <= ENCLAVE_MAX_CELLS) out.set(`${x}:${surround}:${comp.sort((a, b) => a - b).join(',')}`, comp.length);
  }
  return out;
}

describe('a whole match on the real world leaves no enclosed region behind', () => {
  for (const [seed, ticks] of [[1, 3000], [2, 3000], [3, 4400], [4, 6600]] as const) {
    it(`seed ${seed}, 32 fighters, ${ticks} ticks: no region of at most ${ENCLAVE_MAX_CELLS} cells enclosed by one owner is unchanged across two scans 50 ticks apart`, async () => {
      const world = await loadRealWorld();
      const seats = 32;
      const s = createWorldState(world, { seed, seats, players: 12 });
      const countries = pickCountries(largestCountries(world), seats, seed, null);
      const alloc = new IdAllocator();
      let prev = new Map<string, number>();
      let stuck = 0;
      const examples: string[] = [];
      let seenTotal = 0;
      for (let t = 0; t < ticks; t++) {
        const bodies: IntentBody[] = [];
        if (t === 0) for (let i = 0; i < seats; i++) bodies.push({ kind: 'Spawn', seat: i, cell: countries[i]?.capitalCell as number });
        else for (let i = 0; i < seats; i++) bodies.push(...botIntents(s, i, 'fighter'));
        const r = step(s, { turn: s.tick, intents: bodies.map((b) => withId(b, alloc.alloc(b.seat))) });
        expect(r.ok).toBe(true);
        s.outbox.clear();
        if ((t + 1) % 50 === 0) {
          const now = enclosedRegions(s);
          seenTotal += now.size;
          for (const k of now.keys()) {
            if (prev.has(k)) {
              stuck++;
              if (examples.length < 3) examples.push(`tick ${t + 1}: ${k.slice(0, 60)}`);
            }
          }
          prev = now;
        }
      }
      console.log(`[enclaves] seed ${seed}: ${seenTotal} enclosed regions seen across the scans, ${stuck} of them unchanged across two scans`);
      expect(stuck, examples.join(' | ')).toBe(0);
    }, 120000);
  }
});
