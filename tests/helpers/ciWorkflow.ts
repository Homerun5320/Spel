// Shared helper: locate and parse the CI workflow file (later milestones reuse it).
// The workflow lives in .github/workflows/ci.yml, or in docs/ci/ci.yml.txt when pushing .github/workflows/* was refused.
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

export const WORKFLOW_CANDIDATES = ['.github/workflows/ci.yml', 'docs/ci/ci.yml.txt'];

export interface WorkflowFile {
  path: string;
  text: string;
  doc: any;
}

export function loadWorkflow(root = process.cwd()): WorkflowFile {
  for (const rel of WORKFLOW_CANDIDATES) {
    const full = path.join(root, rel);
    if (fs.existsSync(full)) {
      const text = fs.readFileSync(full, 'utf8');
      return { path: rel, text, doc: parse(text) };
    }
  }
  throw new Error(`no CI workflow found (looked for ${WORKFLOW_CANDIDATES.join(' or ')})`);
}

/** All `run:` commands of every job, flattened, for substring checks. */
export function allRunCommands(doc: any): string[] {
  const out: string[] = [];
  for (const job of Object.values<any>(doc.jobs ?? {})) {
    for (const step of job.steps ?? []) if (typeof step.run === 'string') out.push(step.run);
  }
  return out;
}
