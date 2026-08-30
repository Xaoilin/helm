import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  githubEvidenceCandidate,
  githubInstallationRepositoriesPath,
  githubPullRequestQualifies,
  githubSelectionIsInstallationScoped,
  isSafeGithubPaginationUrl,
  parseGithubInstallationRepositoriesPage,
  type GithubPullRequestEvidenceInput,
} from '../../supabase/functions/github-life-hero/evidence';
import { withAllowedOriginCors } from '../../supabase/functions/github-life-hero/cors';
import {
  GithubLifeHeroError,
  githubConnectionNeedsReconnect,
  githubInstalledAppId,
  parseGithubLifeHeroResponse,
} from '../services/githubLifeHero';

const githubFunctionSource = readFileSync(
  resolve(process.cwd(), 'supabase/functions/github-life-hero/index.ts'),
  'utf8',
);
const integrationsSurfaceSource = readFileSync(
  resolve(process.cwd(), 'src/surfaces/IntegrationsSurface.tsx'),
  'utf8',
);

const mergedByOwner: GithubPullRequestEvidenceInput = {
  id: 10,
  node_id: 'PR_node_10',
  user: { id: 42 },
  merged_at: '2026-08-29T12:30:00Z',
};

describe('GitHub Life Hero evidence qualification', () => {
  it('returns every hosted response to an allowed browser origin', async () => {
    const allowedOrigin = 'https://xaoilin.github.io';
    const response = withAllowedOriginCors(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
      allowedOrigin,
      new Set([allowedOrigin]),
    );
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(allowedOrigin);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    const blocked = withAllowedOriginCors(
      new Response(null, { status: 403 }),
      'https://example.com',
      new Set([allowedOrigin]),
    );
    expect(blocked.headers.has('Access-Control-Allow-Origin')).toBe(false);
  });

  it('reuses a verified existing installation callback for OAuth', () => {
    expect(githubInstalledAppId('?installation_id=157729668&setup_action=install')).toBe(157729668);
    expect(githubInstalledAppId('?installation_id=0')).toBeNull();
    expect(githubInstalledAppId('?installation_id=not-a-number')).toBeNull();
    expect(githubFunctionSource).toContain('authorizationUrl: authorization.toString(), state');
  });

  it('requires an authored merged pull request with a stable provider identity', () => {
    expect(githubPullRequestQualifies(mergedByOwner, 42)).toBe(true);
    expect(githubPullRequestQualifies({ ...mergedByOwner, merged_at: null }, 42)).toBe(false);
    expect(githubPullRequestQualifies({ ...mergedByOwner, user: { id: 7 } }, 42)).toBe(false);
    expect(githubPullRequestQualifies({ ...mergedByOwner, node_id: undefined }, 42)).toBe(false);
  });

  it('builds bounded, quantity-independent provenance and deterministic deduplication keys', () => {
    const candidate = githubEvidenceCandidate(123, mergedByOwner, 42, '2022-11-28', '2026-08-29');
    expect(candidate).toEqual({
      idempotencyKey: 'github-app-v1:123:PR_node_10',
      sourceReference: 'github:repository:123:pull-request:PR_node_10',
      occurredAt: '2026-08-29T12:30:00.000Z',
      localDate: '2026-08-29',
      metadata: {
        provider: 'github',
        apiVersion: '2022-11-28',
        repositoryId: '123',
        pullRequestNodeId: 'PR_node_10',
        authorizedUserId: '42',
        mergedAt: '2026-08-29T12:30:00.000Z',
        localDate: '2026-08-29',
        reason: 'authored_pull_request_merged',
      },
    });
    expect(githubEvidenceCandidate(123, mergedByOwner, 42, '2022-11-28', '2026-08-30')).toMatchObject({
      idempotencyKey: candidate?.idempotencyKey,
      sourceReference: candidate?.sourceReference,
    });
    expect(JSON.stringify(candidate)).not.toMatch(/title|body|commit|token|secret|content/iu);
  });

  it('preserves visible provider failure states at the client boundary', () => {
    for (const code of ['rate_limited', 'revoked', 'partial_sync', 'not_configured'] as const) {
      expect(() => parseGithubLifeHeroResponse({ ok: false, error: code, message: `${code} message` }))
        .toThrow(`${code} message`);
      try {
        parseGithubLifeHeroResponse({ ok: false, error: code, message: `${code} message` });
      } catch (error) {
        expect(error).toBeInstanceOf(GithubLifeHeroError);
        expect((error as GithubLifeHeroError).code).toBe(code);
      }
    }
  });

  it('keeps repository discovery and selection inside the GitHub App installation', () => {
    expect(githubInstallationRepositoriesPath(9876)).toBe('/user/installations/9876/repositories?per_page=100');
    expect(githubInstallationRepositoriesPath(0)).toBeNull();
    expect(githubSelectionIsInstallationScoped([1, 2], [2])).toBe(true);
    expect(githubSelectionIsInstallationScoped([1, 2], [3])).toBe(false);
    expect(githubFunctionSource).toContain('githubInstallationRepositoriesPath(credential.installationId)');
    expect(githubFunctionSource).toContain('githubSelectionIsInstallationScoped(repositories.map(repository => repository.id), credential.selectedRepositoryIds)');
  });

  it('parses the documented installation repository response envelope', () => {
    const repository = { id: 123, full_name: 'octocat/hello-world' };
    expect(parseGithubInstallationRepositoriesPage({ total_count: 1, repositories: [repository] }))
      .toEqual([repository]);
    expect(parseGithubInstallationRepositoriesPage([repository])).toBeNull();
    expect(githubFunctionSource).toContain('parseGithubInstallationRepositoriesPage');
  });

  it('rejects malicious pagination targets before an authenticated request can follow them', () => {
    expect(isSafeGithubPaginationUrl('https://api.github.com/user/installations/1/repositories?page=2')).toBe(true);
    expect(isSafeGithubPaginationUrl('https://evil.example/steal')).toBe(false);
    expect(isSafeGithubPaginationUrl('http://api.github.com/user/repos?page=2')).toBe(false);
    expect(isSafeGithubPaginationUrl('https://api.github.com@evil.example/steal')).toBe(false);
    expect(githubFunctionSource).toContain('throw new GithubSyncError(\'partial_sync\', \'GitHub returned an unsafe pagination link.\')');
  });

  it('keeps disconnect failures and OAuth state consumption failures visible and fail closed', () => {
    expect(githubFunctionSource).toMatch(/const \{ error \} = await service\.rpc\('delete_github_life_hero_connection'[\s\S]*?if \(error\) return failure\('temporary_unavailable'/u);
    expect(githubFunctionSource).toMatch(/\.update\(\{ used_at: nowIso\(\) \}\)[\s\S]*?\.is\('used_at', null\)[\s\S]*?\.maybeSingle\(\)[\s\S]*?if \(consumeError\)[\s\S]*?if \(!consumedState\)/u);
  });

  it('offers reconnect for revoked state and does not treat it as a usable connection', () => {
    expect(githubConnectionNeedsReconnect({ status: 'revoked', connection: null })).toBe(true);
    expect(githubConnectionNeedsReconnect({ status: 'connected', connection: null })).toBe(false);
    expect(integrationsSurfaceSource).toContain('githubNeedsReconnect ? \'Reconnect GitHub App\'');
  });
});
