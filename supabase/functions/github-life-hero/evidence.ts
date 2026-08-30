export interface GithubPullRequestEvidenceInput {
  id: number;
  node_id?: string;
  user?: { id?: number } | null;
  merged_at?: string | null;
}

export interface GithubEvidenceCandidate {
  idempotencyKey: string;
  sourceReference: string;
  occurredAt: string;
  localDate: string;
  metadata: {
    provider: 'github';
    apiVersion: string;
    repositoryId: string;
    pullRequestNodeId: string;
    authorizedUserId: string;
    mergedAt: string;
    localDate: string;
    reason: 'authored_pull_request_merged';
  };
}

function validId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function githubInstallationRepositoriesPath(installationId: number | undefined): string | null {
  return validId(installationId)
    ? `/user/installations/${installationId}/repositories?per_page=100`
    : null;
}

export function githubSelectionIsInstallationScoped(
  availableRepositoryIds: readonly number[],
  selectedRepositoryIds: readonly number[],
): boolean {
  const available = new Set(availableRepositoryIds);
  return selectedRepositoryIds.every(repositoryId => available.has(repositoryId));
}

export function isSafeGithubPaginationUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.origin === 'https://api.github.com'
      && url.protocol === 'https:'
      && url.hostname === 'api.github.com'
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
}

export function githubPullRequestQualifies(
  pullRequest: GithubPullRequestEvidenceInput,
  authorizedUserId: number,
): boolean {
  return validId(pullRequest.id)
    && typeof pullRequest.node_id === 'string'
    && pullRequest.node_id.length > 0
    && validId(pullRequest.user?.id)
    && pullRequest.user?.id === authorizedUserId
    && typeof pullRequest.merged_at === 'string'
    && !Number.isNaN(Date.parse(pullRequest.merged_at));
}

export function githubEvidenceCandidate(
  repositoryId: number,
  pullRequest: GithubPullRequestEvidenceInput,
  authorizedUserId: number,
  apiVersion: string,
  localDate: string,
): GithubEvidenceCandidate | null {
  if (!githubPullRequestQualifies(pullRequest, authorizedUserId)) return null;
  const occurredAt = new Date(pullRequest.merged_at!).toISOString();
  const identity = `github:repository:${repositoryId}:pull-request:${pullRequest.node_id}`;
  return {
    idempotencyKey: `github-app-v1:${repositoryId}:${pullRequest.node_id}`,
    sourceReference: identity,
    occurredAt,
    localDate,
    metadata: {
      provider: 'github',
      apiVersion,
      repositoryId: String(repositoryId),
      pullRequestNodeId: pullRequest.node_id!,
      authorizedUserId: String(authorizedUserId),
      mergedAt: occurredAt,
      localDate,
      reason: 'authored_pull_request_merged',
    },
  };
}
