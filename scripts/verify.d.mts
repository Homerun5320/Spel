export interface Stage {
  name: string;
  title: string;
  args: string[];
  browser?: boolean;
  fatal?: boolean;
}
export function stageGroups(opts?: { fast?: boolean; local?: boolean }): Stage[][];
export function formatDuration(ms: number): string;
export function formatSummary(results: Array<{ title: string; status: 'PASS' | 'FAIL' | 'SKIPPED'; ms: number }>, totalMs: number): string;
export function main(argv?: string[]): Promise<void>;
