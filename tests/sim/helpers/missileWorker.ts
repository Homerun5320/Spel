// Runs inside a worker_threads Worker (started by tests/sim/missileCli.test.ts through missileWorkerBoot.mjs). It runs the missile replay of tools/sim/missiles.ts and sends back the printed
// lines and the final hash, so that the test can compare them with the main thread's run.
import { parentPort } from 'node:worker_threads';
import { runMissiles, type MissileFixtureName } from '../../../tools/sim/missiles';

if (!parentPort) throw new Error('missileWorker must run inside a worker');
const port = parentPort;

port.on('message', (job: { id: number; fixture: MissileFixtureName; seed: number }) => {
  const r = runMissiles(job.fixture, job.seed);
  port.postMessage({ id: job.id, lines: r.lines, hash: r.hash, blastTick: r.blastTick });
});
