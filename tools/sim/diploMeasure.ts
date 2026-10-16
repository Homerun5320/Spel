// Measures the AI's diplomacy temperament (M18c-2) on the real world:
//
//   npx tsx tools/sim/diploMeasure.ts [--seed N] [--minutes 10] [--ais 6] [--tribes 8]
//
// Seat 0 is a scripted "human" (the fighter bot of tools/sim/bots.ts) that proposes a truce to one living AI every PROPOSE_EVERY ticks (round robin). The other seats are AIs. It
// prints how many of the human's proposals were accepted / declined / expired, split by whether the AI fought another party or was below the median (the "conditions
// match" case of the M18c-2 prompt), and how many proposals the AIs made and how many treaties were made in all. Nothing here is part of the game.
import { pathToFileURL } from 'node:url';
import { AiDriver } from '../../src/host/aiDriver';
import { IdAllocator, withId, type Intent, type IntentBody } from '../../src/sim/intents';
import { PROPOSAL_TTL_TICKS, TICK_HZ } from '../../src/sim/rules';
import { RELATION_TRUCE } from '../../src/sim/diplomacyTable';
import { seatToOwner } from '../../src/sim/state';
import { step } from '../../src/sim/step';
import { createWorldState } from '../../src/sim/world';
import { StateView } from '../../src/sim/view';
import { proposeTreatyBody, validateProposeTreaty, TREATY_TRUCE, WEIGHT_ONE } from '../../src/sim/public';
import { botIntents } from './bots';
import { largestCountries, pickCountries } from './scenario';
import { loadRealWorld } from './realWorld';

const PROPOSE_EVERY = 300;
const FIRST = 2400;

export interface DiploStats {
  proposals: number;
  accepted: number;
  declined: number;
  expired: number;
  matchProposals: number;
  matchAccepted: number;
  aiProposals: number;
  aiProposalsToHuman: number;
  treatiesMade: number;
  treatiesBroken: number;
}

export async function measure(seed: number, minutes: number, ais: number, tribes: number): Promise<DiploStats> {
  const world = await loadRealWorld();
  const players = ais + 1;
  const seats = players + tribes;
  const state = createWorldState(world, { seed, seats, players });
  const countries = pickCountries(largestCountries(world), seats, seed, null);
  const alloc = new IdAllocator();
  const ai = new AiDriver(seed, { humanSeats: [0], build: true });
  const view = new StateView(state);
  const out: DiploStats = { proposals: 0, accepted: 0, declined: 0, expired: 0, matchProposals: 0, matchAccepted: 0, aiProposals: 0, aiProposalsToHuman: 0, treatiesMade: 0, treatiesBroken: 0 };
  const open: { to: number; at: number; cond: boolean }[] = [];
  let rr = 0;
  const total = minutes * 60 * TICK_HZ;
  const seen = new Set<number>();
  for (let t = 0; t < total; t++) {
    const bodies: IntentBody[] = [];
    view.refresh();
    if (t === 0) for (let seat = 0; seat < seats; seat++) bodies.push({ kind: 'Spawn', seat, cell: (countries[seat % countries.length] as { capitalCell: number }).capitalCell });
    else {
      bodies.push(...botIntents(state, 0, 'fighter'));
      ai.onTick(view, (b) => bodies.push(b));
      if (t >= FIRST && t % PROPOSE_EVERY === 0) {
        for (let k = 0; k < ais; k++) {
          const to = 1 + ((rr + k) % ais);
          if ((view.stats.alive[to] as number) === 0 || validateProposeTreaty(view, 0, to, TREATY_TRUCE) !== 0) continue;
          rr = rr + k + 1;
          // the "conditions match" test: the AI fights a party other than the human, or its land is below the median of the living players
          const me = seatToOwner(to);
          let war = false;
          const shares: number[] = [];
          for (let o = 0; o < players; o++) {
            if ((view.stats.alive[o] as number) === 1) shares.push(view.stats.landShareQ15[o] as number);
            if (o !== to && o !== 0 && (view.stats.alive[o] as number) === 1 && (view.attackRunning(me, seatToOwner(o)) || view.attackRunning(seatToOwner(o), me))) war = true;
          }
          shares.sort((a, b) => a - b);
          const median = shares[shares.length >> 1] as number;
          const cond = war || (view.stats.landShareQ15[to] as number) < median;
          void WEIGHT_ONE;
          open.push({ to, at: t, cond });
          out.proposals++;
          if (cond) out.matchProposals++;
          bodies.push(proposeTreatyBody(0, to, TREATY_TRUCE));
          break;
        }
      }
    }
    const intents: Intent[] = bodies.map((b) => withId(b, alloc.alloc(b.seat)));
    const r = step(state, { turn: state.tick, intents });
    if (!r.ok) throw new Error(`step failed: ${r.error}`);
    state.outbox.clear();
    view.refresh();
    const d = view.diplomacy;
    for (let i = open.length - 1; i >= 0; i--) {
      const p = open[i] as { to: number; at: number; cond: boolean };
      if (t <= p.at + 1) continue;
      if (d.relation(0, p.to) === RELATION_TRUCE) {
        out.accepted++;
        if (p.cond) out.matchAccepted++;
        open.splice(i, 1);
      } else if (d.proposalKind(0, p.to) === 0) {
        if (t - p.at >= PROPOSAL_TTL_TICKS - 2) out.expired++;
        else out.declined++;
        open.splice(i, 1);
      }
    }
    for (let i = 0; i < d.proposalCount; i++) {
      const from = d.proposalFrom(i);
      if (from === 0) continue;
      const key = from * 100000 + d.proposalTo(i) * 10000000 + (t + d.proposalLeft(i));
      if (seen.has(key)) continue;
      seen.add(key);
      out.aiProposals++;
      if (d.proposalTo(i) === 0) out.aiProposalsToHuman++;
    }
  }
  for (let s = 0; s < players; s++) {
    out.treatiesMade += state.match.treatiesMade[s] as number;
    out.treatiesBroken += state.match.treatiesBroken[s] as number;
  }
  return out;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const get = (name: string, dflt: number): number => {
    const i = argv.indexOf(name);
    return i >= 0 ? Number(argv[i + 1]) : dflt;
  };
  const minutes = get('--minutes', 10);
  const ais = get('--ais', 6);
  const tribes = get('--tribes', 8);
  const seeds = argv.includes('--seed') ? [get('--seed', 1)] : [1, 2, 3, 4];
  const sum: Record<string, number> = {};
  for (const seed of seeds) {
    const s = await measure(seed, minutes, ais, tribes);
    console.log(`seed ${seed}: ${JSON.stringify(s)}`);
    for (const [k, v] of Object.entries(s)) sum[k] = (sum[k] ?? 0) + v;
  }
  const pct = (a: number | undefined, b: number | undefined): string => ((b ?? 0) === 0 ? 'n/a' : `${Math.round((100 * (a ?? 0)) / (b ?? 1))} %`);
  console.log(`total: ${JSON.stringify(sum)}`);
  console.log(`human truce proposals accepted: ${pct(sum.accepted, sum.proposals)} of ${sum.proposals}; where the conditions match: ${pct(sum.matchAccepted, sum.matchProposals)} of ${sum.matchProposals}`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
