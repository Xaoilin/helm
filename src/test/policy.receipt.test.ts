import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  evaluateCiWorkflow,
  evaluateDeployWorkflow,
  evaluatePagesSpaFallback,
} from '../../scripts/lib/agentPolicy.mjs';
import {
  findSuccessfulRunForHead,
  findVersionedJavaScriptAsset,
} from '../../scripts/lib/handoffVerification.mjs';
import {
  createTreeRecord,
  evaluateCiReceipt,
  evaluateDeploymentSource,
  evaluateTreeRecord,
  findReusableWorkflowDispatch,
  REQUIRED_SOURCE_JOBS,
  receiptRunTitle,
  resolveDeploymentInputs,
} from '../../scripts/lib/ciReceipt.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sha = (character: string) => character.repeat(40);

function receiptFixture() {
  const record = createTreeRecord({ repository: 'Xaoilin/helm', sourceHeadSha: sha('a'), sourceMergeSha: sha('b'), sourcePr: 252, sourceRunAttempt: 1, sourceRunId: 9876, testedTree: sha('c') });
  const sourceRun = { id: 9876, run_attempt: 1, repository: { full_name: 'Xaoilin/helm' }, path: '.github/workflows/ci.yml', event: 'pull_request', status: 'completed', conclusion: 'success', head_sha: sha('a') };
  return {
    currentSha: sha('d'), currentTree: sha('c'), liveMasterSha: sha('d'), liveMasterTree: sha('c'),
    repository: 'Xaoilin/helm', sourcePr: 252, sourceRunId: 9876, testedTree: sha('c'), record, sourceRun, latestSourceRun: sourceRun,
    jobs: REQUIRED_SOURCE_JOBS.map((name: string, id: number) => ({ id, name, status: 'completed', conclusion: 'success', run_attempt: 1 })),
    pullRequest: { number: 252, merged_at: '2026-09-07T00:00:00Z', base: { ref: 'master' }, head: { sha: sha('a') }, merge_commit_sha: sha('d') },
  };
}

describe('hosted build and receipt policy boundaries', () => {
  it.each(['failure', null])('rejects an older success when the latest matching run is %s', (conclusion) => {
    const older = { databaseId: 10, headSha: sha('a'), status: 'completed', conclusion: 'success' };
    const latest = { databaseId: 11, headSha: sha('a'), status: conclusion ? 'completed' : 'in_progress', conclusion };
    expect(findSuccessfulRunForHead([older, latest], sha('a'))).toBeNull();
  });

  it.each(['deploy.yml', 'deploy-supabase-assistant.yml'])('verifies the candidate before deployment work in %s', (workflow) => {
    const text = readFileSync(resolve(root, '.github/workflows', workflow), 'utf8');
    const workflowName = workflow === 'deploy.yml' ? 'Deploy to GitHub Pages' : 'Deploy Supabase Assistant Function';
    expect(evaluateDeployWorkflow(text, workflowName).ok).toBe(true);
    expect(evaluateDeployWorkflow(text.replaceAll('verify-ci-receipt.mjs deployment', 'echo unverified'), workflowName).ok).toBe(false);
    expect(evaluateDeployWorkflow(text.replaceAll('required: true', 'required: false'), workflowName).ok).toBe(false);
    expect(text).toContain('node ./scripts/verify-ci-receipt.mjs deployment');
    expect(text.indexOf('node ./scripts/verify-ci-receipt.mjs deployment')).toBeLessThan(text.indexOf('run: npm ci'));
    expect(text).not.toContain('required: false');
    expect(text).not.toContain("|| 'master'");
    expect(text).toContain('ref: master');
    if (workflow === 'deploy.yml') {
      const deployJob = text.slice(text.indexOf('\n  deploy:'));
      expect(deployJob.indexOf('verify-ci-receipt.mjs deployment')).toBeLessThan(deployJob.indexOf('uses: actions/deploy-pages'));
    }
  });

  it('requires both manual inputs and the protected workflow ref', () => {
    const input = { event: { inputs: { deploy_sha: sha('d'), source_run_id: '9876' } }, eventName: 'workflow_dispatch', ref: 'refs/heads/master' };
    expect(resolveDeploymentInputs(input)).toEqual({ deploySha: sha('d'), sourceRunId: 9876, eventName: 'workflow_dispatch' });
    for (const inputs of [{}, { deploy_sha: sha('d') }, { deploy_sha: 'master', source_run_id: '9876' }, { deploy_sha: sha('d'), source_run_id: '0' }]) {
      expect(() => resolveDeploymentInputs({ ...input, event: { inputs } })).toThrow();
    }
    expect(() => resolveDeploymentInputs({ ...input, ref: 'refs/heads/topic' })).toThrow('protected master');
    expect(() => resolveDeploymentInputs({ ...input, eventName: 'push' })).toThrow('Unsupported');
  });

  it('accepts a verified manual source and rejects missing, stale, failed or mismatched evidence', () => {
    const fixture = receiptFixture();
    const input = { ...fixture, inputs: { deploySha: sha('d'), sourceRunId: 9876, eventName: 'workflow_dispatch' } };
    expect(evaluateDeploymentSource(input)).toEqual({ ok: true, failures: [] });
    for (const changed of [
      { currentSha: sha('e') },
      { repository: 'other/repository' },
      { sourceRun: { ...fixture.sourceRun, id: 9 } },
      { sourceRun: { ...fixture.sourceRun, path: '.github/workflows/other.yml' } },
      { sourceRun: { ...fixture.sourceRun, status: 'in_progress', conclusion: null } },
      { sourceRun: { ...fixture.sourceRun, conclusion: 'failure' } },
      { latestSourceRun: { ...fixture.sourceRun, id: 9999, conclusion: 'failure' } },
      { latestSourceRun: { ...fixture.sourceRun, run_attempt: 2, conclusion: 'failure' } },
    ]) expect(evaluateDeploymentSource({ ...input, ...changed }).ok).toBe(false);
    expect(evaluateCiReceipt(fixture)).toEqual({ ok: true, failures: [] });
    for (const changed of [
      { currentTree: sha('e') },
      { liveMasterSha: sha('e') },
      { record: { ...fixture.record, testedTree: sha('e') } },
      { record: { ...fixture.record, sourceRunAttempt: 2 } },
      { latestSourceRun: { ...fixture.sourceRun, id: 9999, status: 'in_progress' } },
      { jobs: fixture.jobs.filter((job: { name: string }) => job.name !== 'database') },
    ]) expect(evaluateCiReceipt({ ...fixture, ...changed }).ok).toBe(false);
  });

  it('derives automatic inputs from the event and requires complete matching master CI', () => {
    const fixture = receiptFixture();
    const sourceRun = { ...fixture.sourceRun, event: 'push', head_branch: 'master', head_sha: sha('d') };
    const inputs = resolveDeploymentInputs({ event: { workflow_run: sourceRun }, eventName: 'workflow_run', ref: 'refs/heads/master' });
    const input = { ...fixture, inputs, sourceRun, latestSourceRun: sourceRun };
    expect(evaluateDeploymentSource(input)).toEqual({ ok: true, failures: [] });
    expect(evaluateDeploymentSource({ ...input, sourceRun: { ...sourceRun, head_sha: sha('e') } }).ok).toBe(false);
    expect(evaluateDeploymentSource({ ...input, jobs: fixture.jobs.map((job: object) => ({ ...job, conclusion: 'skipped' })) }).ok).toBe(false);
    expect(() => resolveDeploymentInputs({ event: {}, eventName: 'workflow_run', ref: 'refs/heads/master' })).toThrow();
  });

  it('uses the latest matching attempt, including reruns, and keeps successful promotion reusable', () => {
    const older = { databaseId: 10, headSha: sha('a'), status: 'completed', conclusion: 'success', startedAt: '2026-09-07T00:00:00Z' };
    const latest = { ...older, databaseId: 11, startedAt: '2026-09-07T01:00:00Z' };
    expect(findSuccessfulRunForHead([older, latest, { ...latest, databaseId: 12, headSha: sha('b'), conclusion: 'failure' }], sha('a'))).toEqual(latest);
    expect(findSuccessfulRunForHead([latest, { ...older, startedAt: '2026-09-07T02:00:00Z', conclusion: 'failure' }], sha('a'))).toBeNull();
    expect(findReusableWorkflowDispatch([{ ...older, display_title: 'receipt' }, { ...latest, display_title: 'receipt', conclusion: 'failure' }], 'receipt')).toBeNull();
    expect(findReusableWorkflowDispatch([{ ...latest, display_title: 'receipt' }], 'receipt')).toMatchObject({ databaseId: 11 });
  });

  it('proves the checked-in Vite config retains the hosted browser boundary', () => {
    const config = readFileSync(resolve(root, 'vite.config.ts'), 'utf8');
    expect(config).toContain("return '/helm/'");
    expect(config).toContain("['node_modules', 'e2e', '.codex_tmp/**', '.ai/**']");
  });

  it('proves the checked-in CI workflow declares the required named gates', () => {
    const result = evaluateCiWorkflow(
      readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8'),
    );
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('proves the web build emits the configured SPA fallback', () => {
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
    const result = evaluatePagesSpaFallback(
      manifest,
      existsSync(resolve(root, 'scripts/copy-spa-fallback.mjs')),
    );
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('finds the deployed version when Rollup moves it into a shared preload', async () => {
    const pagesUrl = 'https://example.test/helm/';
    const entryUrl = `${pagesUrl}assets/app.js`;
    const sharedUrl = `${pagesUrl}assets/shared.js`;
    const fetched: string[] = [];
    const result = await findVersionedJavaScriptAsset({
      fetchAsset: async (url: string) => {
        fetched.push(url);
        return url === sharedUrl ? 'const release = "0.2.140";' : 'const app = true;';
      },
      html: `
        <script type="module" src="/helm/assets/app.js"></script>
        <link rel="modulepreload" href="/helm/assets/shared.js">
      `,
      pagesUrl,
      version: '0.2.140',
    });

    expect(fetched).toEqual([entryUrl, sharedUrl]);
    expect(result.assetUrl).toBe(sharedUrl);
  });

  it('proves a receipt binds source run, pull request, and exact tested tree', () => {
    const record = createTreeRecord({
      repository: 'xaoilin/helm',
      sourceHeadSha: sha('a'),
      sourceMergeSha: sha('b'),
      sourcePr: 252,
      sourceRunAttempt: 1,
      sourceRunId: 9876,
      testedTree: sha('c'),
    });

    expect(receiptRunTitle(9876, sha('c'))).toBe(
      `CI receipt source 9876 tree ${sha('c')}`,
    );
    expect(evaluateTreeRecord(record, {
      repository: 'xaoilin/helm',
      sourcePr: 252,
      sourceRunId: 9876,
      testedTree: sha('c'),
    })).toEqual({ failures: [], ok: true });
    expect(evaluateTreeRecord(record, {
      repository: 'xaoilin/helm',
      sourcePr: 252,
      sourceRunId: 9876,
      testedTree: sha('d'),
    }).failures).toContain('Source tree record does not match the requested tested tree.');
  });
});
