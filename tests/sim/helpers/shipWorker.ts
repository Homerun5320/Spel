// Runs inside a worker_threads Worker (started by tests/sim/shipLandingCli.test.ts through shipWorkerBoot.mjs). It runs the ship-landing replay of tools/sim/shipLanding.ts and sends
// back the printed lines and the final hash, so that the test can compare them with the main thread's run.
import { parentPort } from 'node:worker_threads';
import { runShipLanding } from '../../../tools/sim/shipLanding';

if (!parentPort) throw new Error('shipWorker must run inside a worker');
const port = parentPort;

port.on('message', (job: { id: number; seed: number }) => {
  const r = runShipLanding(job.seed);
  port.postMessage({ id: job.id, lines: r.lines, hash: r.hash, landedTick: r.landedTick });
});
