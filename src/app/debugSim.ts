// debug/sim.html: runs the golden scenario of the deterministic simulation in the browser and shows the hashes.
// `?seed=N` / `#seed-N` picks the seed (default 1) and `?ticks=T` / `#ticks-T` the length (default 6000). Three runs are made:
// the plain step loop, the same script driven through MainThreadHost (submitIntent + advance) and the adversarial variant
// of the script (raw turn lists no host can build). The Playwright test
// (e2e/sim.test.ts) compares both with e2e/goldens/sim-hashes.json, and the Float64 canary with its committed value.
import { MainThreadHost } from '../host/mainThreadHost';
import { canaryHash, CANARY_VALUES } from '../sim/canary';
import { hex32 } from '../sim/hash';
import { TICK_MS } from '../sim/rules';
import { GOLDEN_SEED, GOLDEN_TICKS, createScenarioState, runScenario, scenarioBodies } from '../sim/scenario';
import { FORMAT_VERSION, hashState } from '../sim/serialize';
import { step } from '../sim/step';
import { ENGINE_VERSION } from '../sim/state';
import { scheduledTurn } from '../sim/time';
import { parseRaw } from './params';
import { siteUrl } from './paths';

export interface DebugSimHooks {
  ready: boolean;
  seed: number;
  ticks: number;
  engineVersion: number;
  formatVersion: number;
  mapHash: string;
  /** Hash per golden tick point reached (plain step loop), keyed by the tick as a string. */
  hashes: Record<string, string>;
  /** The same points reached through MainThreadHost. */
  hostHashes: Record<string, string>;
  /** The same points of the adversarial run (raw turn lists: reversed order, repeated (seat, id)); see src/sim/scenario.ts. */
  adversarialHashes: Record<string, string>;
  canary: { values: number; hash: string };
}

declare global {
  interface Window {
    __debugSim?: DebugSimHooks;
  }
}

function intParam(raw: string | undefined, fallback: number, lo: number, hi: number): number {
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : fallback;
}

async function main(): Promise<void> {
  const root = document.getElementById('root');
  if (!root) throw new Error('missing #root');
  const raw = parseRaw(window.location.search, window.location.hash);
  const seed = intParam(raw.seed, GOLDEN_SEED, -2147483648, 4294967295);
  const ticks = intParam(raw.ticks, 6000, 0, 100000);
  const points = GOLDEN_TICKS.filter((t) => t <= ticks);

  const direct = createScenarioState({ seed });
  const mapHash = hex32(direct.header.mapHash);
  const hashes: Record<string, string> = {};
  for (const t of points) {
    runScenario(direct, t);
    hashes[String(t)] = hex32(hashState(direct));
  }

  const adversarial = createScenarioState({ seed });
  const adversarialHashes: Record<string, string> = {};
  for (const t of points) {
    runScenario(adversarial, t, step, true);
    adversarialHashes[String(t)] = hex32(hashState(adversarial));
  }

  const state = createScenarioState({ seed });
  const host = new MainThreadHost(state);
  const cells = state.width * state.height;
  const hostHashes: Record<string, string> = {};
  const wanted = new Set<number>(points);
  const waits: Array<Promise<void>> = [];
  for (let i = 0; i < ticks; i++) {
    for (const b of scenarioBodies(seed, scheduledTurn(host.tick), state.header.seats, cells)) host.submitIntent(b);
    host.advance(TICK_MS);
    if (wanted.has(host.tick)) {
      waits.push(host.requestSnapshot().then((s) => void (hostHashes[String(s.tick)] = hex32(s.hash))));
    }
  }
  await Promise.all(waits);

  const canary = { values: CANARY_VALUES, hash: hex32(canaryHash()) };
  window.__debugSim = { ready: true, seed, ticks, engineVersion: ENGINE_VERSION, formatVersion: FORMAT_VERSION, mapHash, hashes, hostHashes, adversarialHashes, canary };

  const wrap = document.createElement('div');
  wrap.style.cssText = 'margin:0;padding:8px 12px;background:#101418;color:#dde;font:14px/20px system-ui,sans-serif;min-height:100vh;box-sizing:border-box;';
  const head = document.createElement('div');
  head.style.cssText = 'display:flex;gap:12px;align-items:baseline;margin-bottom:8px;';
  const title = document.createElement('strong');
  title.textContent = 'Simulering (debug)';
  const back = document.createElement('a');
  back.href = siteUrl('index.html');
  back.textContent = 'Till spelet';
  back.style.cssText = 'margin-left:auto;color:#9cf;';
  head.append(title, back);
  const info = document.createElement('div');
  info.style.cssText = 'color:#9ab;margin-bottom:8px;font:12px/18px ui-monospace,Menlo,Consolas,monospace;';
  info.textContent = `seed ${seed}, ${ticks} tick, kartans hash ${mapHash}, motor ${ENGINE_VERSION}, format ${FORMAT_VERSION}`;
  const table = document.createElement('table');
  table.id = 'hashes';
  table.style.cssText = 'border-collapse:collapse;font:13px/20px ui-monospace,Menlo,Consolas,monospace;';
  const rows: Array<[string, string, string]> = [['tick', 'step-loop', 'MainThreadHost'], ...points.map((t): [string, string, string] => [String(t), hashes[String(t)] ?? '', hostHashes[String(t)] ?? ''])];
  rows.push(['kanariefågel', canary.hash, `${canary.values} värden`]);
  for (const r of rows) {
    const tr = document.createElement('tr');
    for (const cell of r) {
      const td = document.createElement(r === rows[0] ? 'th' : 'td');
      td.textContent = cell;
      td.style.cssText = 'padding:2px 14px 2px 0;text-align:left;border-bottom:1px solid #334;';
      tr.appendChild(td);
    }
    table.appendChild(tr);
  }
  wrap.append(head, info, table);
  root.appendChild(wrap);
  document.body.dataset.ready = '1';
}

main().catch((err: unknown) => {
  console.error(err);
  document.body.dataset.error = String(err instanceof Error ? err.message : err);
});
