export interface Stage {
  name: string;
  title: string;
  args: string[];
  browser?: boolean;
  fatal?: boolean;
  timesFile?: string;
}
export function stageGroups(opts?: { fast?: boolean; local?: boolean; shard?: string | null }): Stage[][];
export function shardOf(argv: string[]): string | null;
export function slowestFiles(json: unknown, n?: number): string[];
export function formatDuration(ms: number): string;
export function formatSummary(results: Array<{ title: string; status: 'PASS' | 'FAIL' | 'SKIPPED'; ms: number }>, totalMs: number): string;
export interface StageRun {
  ok: boolean;
  ms: number;
  logPath: string;
  output: Buffer;
}
export interface MainDeps {
  runStage?: (stage: Stage, env: NodeJS.ProcessEnv, opts: { live: boolean }) => Promise<StageRun>;
  writeLocalReport?: (summary: string, workers: number, cores: number) => void;
}
export function main(argv?: string[], deps?: MainDeps): Promise<void>;
