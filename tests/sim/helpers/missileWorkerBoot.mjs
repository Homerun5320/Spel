// Entry of the missile test worker: registers tsx's ESM hooks inside the worker thread (execArgv `--import tsx` does not reach it), then loads the TypeScript worker.
import { register } from 'tsx/esm/api';

register();
await import('./missileWorker.ts');
