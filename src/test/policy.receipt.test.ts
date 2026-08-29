import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  evaluateCiWorkflow,
  evaluatePagesSpaFallback,
} from '../../scripts/lib/agentPolicy.mjs';
import {
  createTreeRecord,
  evaluateTreeRecord,
  receiptRunTitle,
} from '../../scripts/lib/ciReceipt.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sha = (character: string) => character.repeat(40);

describe('hosted build and receipt policy boundaries', () => {
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
