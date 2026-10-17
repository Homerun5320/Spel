// Perf project setup: the project runs with `retry: 1`; any retried test is logged loudly.
import { afterEach } from 'vitest';

console.log('[perf] project uses retry: 1 (perf project only); retried tests are logged');

afterEach(({ task }) => {
  const retries = task.result?.retryCount ?? 0;
  if (retries > 0) console.warn(`[perf] RETRY: "${task.name}" needed ${retries} retr${retries === 1 ? 'y' : 'ies'}`);
});
