import { describe, expect, it } from 'vitest';
import {
  githubEvidenceCandidate,
  githubPullRequestQualifies,
  type GithubPullRequestEvidenceInput,
} from '../../supabase/functions/github-life-hero/evidence';
import { GithubLifeHeroError, parseGithubLifeHeroResponse } from '../services/githubLifeHero';

const mergedByOwner: GithubPullRequestEvidenceInput = {
  id: 10,
  node_id: 'PR_node_10',
  user: { id: 42 },
  merged_at: '2026-08-29T12:30:00Z',
};

describe('GitHub Life Hero evidence qualification', () => {
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
});
