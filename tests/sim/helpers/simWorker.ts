// Runs inside a worker_threads Worker (started by tests/sim/worker.test.ts with `--import tsx`). It holds no state of its
// own besides what the main thread sends: matches to run (hash traces back) and a SimHost served over the worker's port.
import { parentPort } from 'node:worker_threads';
import { MainThreadHost } from '../../../src/host/mainThreadHost';
import type { ClientMessage, HostMessage, Port } from '../../../src/host/protocol';
import { serveHost } from '../../../src/host/remote';
import type { Intent } from '../../../src/sim/intents';
import { GOLDEN_TICKS, createScenarioState, runScenario } from '../../../src/sim/scenario';
import { hashState } from '../../../src/sim/serialize';
import { createEmptyState } from '../../../src/sim/state';
import { step } from '../../../src/sim/step';

if (!parentPort) throw new Error('simWorker must run inside a worker');
const port = parentPort;

interface MatchJob {
  cmd: 'match';
  id: number;
  seed: number;
  debug: boolean;
  width: number;
  height: number;
  seats: number;
  turns: Intent[][];
}
interface GoldenJob {
  cmd: 'golden';
  id: number;
  seed: number;
}
interface HostInit {
  cmd: 'host';
  id: number;
  seed: number;
}
type Job = MatchJob | GoldenJob | HostInit | { channel: 'host'; m: ClientMessage };

const hostHandlers: Array<(m: ClientMessage) => void> = [];

const hostPort: Port<HostMessage, ClientMessage> = {
  post: (m, transfer) => port.postMessage({ channel: 'host', m }, transfer ?? []),
  onMessage: (h) => {
    hostHandlers.push(h);
    return () => {
      const i = hostHandlers.indexOf(h);
      if (i >= 0) hostHandlers.splice(i, 1);
    };
  },
  close: () => undefined,
};

port.on('message', (job: Job) => {
  if ('channel' in job) {
    for (const h of hostHandlers) h(job.m);
    return;
  }
  if (job.cmd === 'match') {
    const s = createEmptyState(job.width, job.height, job.seed, job.seats, { debugIntents: job.debug });
    const trace: number[] = [];
    for (const intents of job.turns) {
      step(s, { turn: s.tick, intents });
      trace.push(hashState(s));
    }
    port.postMessage({ id: job.id, trace });
  } else if (job.cmd === 'golden') {
    const s = createScenarioState({ seed: job.seed });
    const hashes: number[] = [];
    for (const t of GOLDEN_TICKS) {
      runScenario(s, t);
      hashes.push(hashState(s));
    }
    port.postMessage({ id: job.id, hashes });
  } else {
    serveHost(new MainThreadHost(createScenarioState({ seed: job.seed })), hostPort);
    port.postMessage({ id: job.id, ready: true });
  }
});
