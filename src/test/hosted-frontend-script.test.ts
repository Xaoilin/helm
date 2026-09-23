import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('loads the complete hosted frontend script and fails closed before fixture access without configuration', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'helm-frontend-script-'));
  try {
    const result = spawnSync(process.execPath, [
      '--import', resolve('node_modules/tsx/dist/loader.mjs'),
      resolve('scripts/verify-hosted-frontend-sync.ts'),
    ], {
      cwd: directory, encoding: 'utf8', timeout: 15_000,
      env: { ...process.env, VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '',
        SUPABASE_ACCESS_TOKEN: '', SUPABASE_PROJECT_REF: '', ASSISTANT_DEPLOY_SHA: '' },
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr.trim()).toBe('Exact protected target and fixture credentials required.');
    const receipt = JSON.parse(readFileSync(resolve(directory, 'test-results/frontend-sync-post-deploy.json'), 'utf8'));
    expect(receipt).toMatchObject({ passed: false, fixtureCount: 0, fixturesRemoved: false, browserContexts: 0, browserBindings: [] });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
