// Entry of the test worker: registers tsx's ESM hooks inside the worker thread (execArgv `--import tsx` does not reach it),
// then loads the TypeScript worker. Only used by tests/sim/worker.test.ts.
import { register } from 'tsx/esm/api';

register();
await import('./simWorker.ts');
