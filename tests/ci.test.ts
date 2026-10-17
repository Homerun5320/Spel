import { describe, expect, it } from 'vitest';
import { allRunCommands, loadWorkflow } from './helpers/ciWorkflow';

describe('CI workflow file', () => {
  const wf = loadWorkflow();
  const doc = wf.doc;
  const job = Object.values<any>(doc.jobs)[0];

  it('exists in one of the two accepted locations and parses', () => {
    expect(['.github/workflows/ci.yml', 'docs/ci/ci.yml.txt']).toContain(wf.path);
    expect(typeof doc).toBe('object');
  });

  it('has the required triggers', () => {
    expect(doc.on.pull_request.types).toEqual(['opened', 'reopened', 'synchronize', 'ready_for_review']);
    expect('workflow_dispatch' in doc.on).toBe(true);
    expect(doc.on.push.branches).toContain('main');
  });

  it('skips drafts and cancels superseded runs per ref', () => {
    expect(job.if).toBe("github.event.pull_request.draft == false || github.event_name != 'pull_request'");
    expect(doc.concurrency['cancel-in-progress']).toBe(true);
    expect(String(doc.concurrency.group)).toContain('github.ref');
  });

  it('runs Node 22, npm ci, the Chromium install and npm run verify', () => {
    const uses = job.steps.filter((s: any) => String(s.uses ?? '').startsWith('actions/setup-node'));
    expect(String(uses[0]?.with?.['node-version'])).toBe('22');
    const runs = allRunCommands(doc).join('\n');
    expect(runs).toContain('npm ci');
    expect(runs).toContain('npx playwright-core install --with-deps chromium');
    expect(runs).toContain('npm run verify');
    expect(runs).toContain('CHROMIUM_PATH=');
    expect(runs).toContain('GITHUB_ENV');
  });

  it('compares goldens in warn mode and uploads screenshots/diffs', () => {
    const verify = job.steps.find((s: any) => s.run === 'npm run verify');
    expect(verify.env.GOLDEN_COMPARE).toBe('warn');
    const upload = job.steps.find((s: any) => String(s.uses ?? '').startsWith('actions/upload-artifact'));
    expect(upload).toBeTruthy();
    expect(String(upload.with.path)).toContain('test-results');
  });
});
