// Starts Vite programmatically on a free port and tells the tests where it is.
import type { TestProject } from 'vitest/node';
import { startViteServer } from '../scripts/shot.mjs';

declare module 'vitest' {
  export interface ProvidedContext {
    baseUrl: string;
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const vite = await startViteServer();
  project.provide('baseUrl', vite.url);
  console.log(`[e2e] vite on ${vite.url}`);
  return async () => {
    await vite.close();
  };
}
