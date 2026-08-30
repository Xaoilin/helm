import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.100.1';
import {
  githubEvidenceCandidate,
  githubInstallationIsAccessible,
  githubInstallationRepositoriesPath,
  githubPullRequestQualifies,
  githubSelectionIsInstallationScoped,
  isSafeGithubPaginationUrl,
  parseGithubInstallationRepositoriesPage,
  parseGithubInstallationsPage,
  type GithubInstallationInput,
  type GithubPullRequestEvidenceInput,
} from './evidence.ts';
import { withAllowedOriginCors } from './cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const GITHUB_APP_CLIENT_ID = Deno.env.get('GITHUB_APP_CLIENT_ID') || '';
const GITHUB_APP_CLIENT_SECRET = Deno.env.get('GITHUB_APP_CLIENT_SECRET') || '';
const GITHUB_APP_SLUG = Deno.env.get('GITHUB_APP_SLUG') || '';
const GITHUB_API_VERSION = Deno.env.get('GITHUB_API_VERSION') || '2022-11-28';
const GITHUB_ALLOWED_ORIGINS = new Set(
  (Deno.env.get('GITHUB_LIFE_HERO_ALLOWED_ORIGINS') || 'https://xaoilin.github.io,http://localhost:5173,http://localhost:5174')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean),
);
const GITHUB_API = 'https://api.github.com';
const GITHUB_OAUTH = 'https://github.com/login/oauth';
const MAX_REPOSITORIES = 25;
const MAX_PAGES = 100;
const MAX_CANDIDATES = 500;
const ACCESS_TOKEN_BUFFER_MS = 60_000;

type Action =
  | 'begin_authorization'
  | 'complete_installation'
  | 'complete_authorization'
  | 'get_status'
  | 'list_repositories'
  | 'save_selection'
  | 'sync'
  | 'disconnect';

type FailureCode =
  | 'invalid_request'
  | 'not_configured'
  | 'sign_in_required'
  | 'needs_reconnect'
  | 'revoked'
  | 'forbidden'
  | 'unavailable'
  | 'rate_limited'
  | 'partial_sync'
  | 'empty'
  | 'temporary_unavailable';

interface RequestBody {
  action?: Action;
  code?: string;
  state?: string;
  installationId?: number;
  redirectUri?: string;
  repositoryIds?: number[];
  localDate?: string;
  timeZone?: string;
}

interface ConnectionState {
  githubUserId: number;
  selectedRepositoryIds: number[];
  apiVersion: string;
  installationId?: number;
  authorizedAt: string;
  lastSyncAt?: string;
  lastSyncStatus: string;
  lastSyncErrorCode?: string;
  lastSyncErrorMessage?: string;
}

interface CredentialState extends ConnectionState {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt?: string;
  refreshTokenExpiresAt?: string;
}

interface GithubUser {
  id: number;
}

interface GithubRepository {
  id: number;
  full_name: string;
  private?: boolean;
}

class GithubApiError extends Error {
  constructor(
    readonly status: number,
    readonly rateLimited: boolean,
    readonly retryAfter?: string,
  ) {
    super(rateLimited ? 'GitHub rate limit reached.' : `GitHub API request failed (${status}).`);
    this.name = 'GithubApiError';
  }
}

class GithubSyncError extends Error {
  constructor(readonly code: FailureCode, message: string) {
    super(message);
    this.name = 'GithubSyncError';
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function jsonResponse(body: unknown, status = 200, origin?: string): Response {
  const headers = new Headers({
    'Content-Type': 'application/json',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  });
  if (origin && GITHUB_ALLOWED_ORIGINS.has(origin)) headers.set('Access-Control-Allow-Origin', origin);
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
}

function success<T>(result: T): Response {
  return jsonResponse({ ok: true, result, checkedAt: nowIso(), apiVersion: GITHUB_API_VERSION });
}

function failure(code: FailureCode, message: string, status = 200): Response {
  return jsonResponse({ ok: false, error: code, message, checkedAt: nowIso() }, status);
}

function configured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY
    && GITHUB_APP_CLIENT_ID && GITHUB_APP_CLIENT_SECRET && GITHUB_APP_SLUG);
}

function createUserClient(authHeader: string): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function createServiceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function getUser(authHeader: string | null): Promise<{ id: string; githubUser?: GithubUser } | Response> {
  if (!authHeader) return failure('sign_in_required', 'Sign in to Sabah One before connecting GitHub.');
  const { data, error } = await createUserClient(authHeader).auth.getUser();
  if (error || !data.user) return failure('sign_in_required', 'Sign in to Sabah One before connecting GitHub.');
  return { id: data.user.id };
}

async function hashState(state: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(state));
  return Array.from(new Uint8Array(digest)).map(value => value.toString(16).padStart(2, '0')).join('');
}

function validRedirectUri(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2_048) return false;
  try {
    const url = new URL(value);
    return GITHUB_ALLOWED_ORIGINS.has(url.origin) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function numericId(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function positiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function parseRepositoryIds(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length > MAX_REPOSITORIES) return null;
  const ids = value.map(numericId);
  if (ids.some(id => id === null)) return null;
  return [...new Set(ids as number[])];
}

function assertLocalDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new GithubSyncError('invalid_request', 'A local date in YYYY-MM-DD format is required.');
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new GithubSyncError('invalid_request', 'The local date is invalid.');
  }
  return value;
}

function assertTimeZone(value: unknown): string {
  if (typeof value !== 'string' || value.length > 128) {
    throw new GithubSyncError('invalid_request', 'A valid app time zone is required.');
  }
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: value }).format();
    return value;
  } catch {
    throw new GithubSyncError('invalid_request', 'The app time zone is invalid.');
  }
}

function localDateFor(instant: string, timeZone: string): string {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) throw new GithubSyncError('partial_sync', 'GitHub returned an invalid merged time.');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function githubRequest<T>(path: string, accessToken: string, apiVersion = GITHUB_API_VERSION): Promise<{ data: T; response: Response }> {
  const response = await fetch(`${GITHUB_API}${path}`, {
    redirect: 'error',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${accessToken}`,
      'X-GitHub-Api-Version': apiVersion,
    },
  });
  if (!response.ok) {
    const rateLimited = response.status === 429 || (
      response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0'
    );
    throw new GithubApiError(response.status, rateLimited, response.headers.get('retry-after') || undefined);
  }
  const data = await response.json().catch(() => null) as T | null;
  if (!data) throw new GithubSyncError('partial_sync', 'GitHub returned an invalid response.');
  return { data, response };
}

function nextPage(response: Response): string | null {
  const link = response.headers.get('link') || '';
  const match = link.match(/<([^>]+)>;\s*rel="next"/u);
  const next = match?.[1];
  if (!next) return null;
  if (!isSafeGithubPaginationUrl(next)) {
    throw new GithubSyncError('partial_sync', 'GitHub returned an unsafe pagination link.');
  }
  return next;
}

async function fetchAllPages<T>(
  path: string,
  accessToken: string,
  apiVersion: string,
  parsePage: (value: unknown) => T[] | null = value => Array.isArray(value) ? value as T[] : null,
): Promise<T[]> {
  const values: T[] = [];
  let nextUrl: string | null = `${GITHUB_API}${path}`;
  let pageCount = 0;
  while (nextUrl) {
    pageCount += 1;
    if (pageCount > MAX_PAGES) throw new GithubSyncError('partial_sync', 'GitHub pagination exceeded the safe bound.');
    const response = await fetch(nextUrl, {
      redirect: 'error',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${accessToken}`,
        'X-GitHub-Api-Version': apiVersion,
      },
    });
    if (!response.ok) {
      const rateLimited = response.status === 429 || (
        response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0'
      );
      throw new GithubApiError(response.status, rateLimited, response.headers.get('retry-after') || undefined);
    }
    const page = parsePage(await response.json().catch(() => null));
    if (!page) throw new GithubSyncError('partial_sync', 'GitHub returned an invalid paginated response.');
    values.push(...page);
    nextUrl = nextPage(response);
  }
  return values;
}

function mapConnection(value: unknown): ConnectionState | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const githubUserId = numericId(row.githubUserId);
  const selectedRepositoryIds = parseRepositoryIds(row.selectedRepositoryIds);
  if (!githubUserId || !selectedRepositoryIds || typeof row.apiVersion !== 'string'
    || typeof row.authorizedAt !== 'string' || typeof row.lastSyncStatus !== 'string') return null;
  return {
    githubUserId,
    selectedRepositoryIds,
    apiVersion: row.apiVersion,
    ...(numericId(row.installationId) ? { installationId: numericId(row.installationId)! } : {}),
    authorizedAt: row.authorizedAt,
    ...(typeof row.lastSyncAt === 'string' ? { lastSyncAt: row.lastSyncAt } : {}),
    lastSyncStatus: row.lastSyncStatus,
    ...(typeof row.lastSyncErrorCode === 'string' ? { lastSyncErrorCode: row.lastSyncErrorCode } : {}),
    ...(typeof row.lastSyncErrorMessage === 'string' ? { lastSyncErrorMessage: row.lastSyncErrorMessage } : {}),
  };
}

function mapCredential(value: unknown): CredentialState | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const connection = mapConnection(value);
  if (!connection || typeof row.accessToken !== 'string' || typeof row.refreshToken !== 'string') return null;
  return {
    ...connection,
    accessToken: row.accessToken,
    refreshToken: row.refreshToken,
    ...(typeof row.accessTokenExpiresAt === 'string' ? { accessTokenExpiresAt: row.accessTokenExpiresAt } : {}),
    ...(typeof row.refreshTokenExpiresAt === 'string' ? { refreshTokenExpiresAt: row.refreshTokenExpiresAt } : {}),
  };
}

async function loadCredential(service: SupabaseClient, userId: string): Promise<CredentialState | null> {
  const { data, error } = await service.rpc('get_github_life_hero_credential', { p_user_id: userId });
  if (error) throw new GithubSyncError('temporary_unavailable', 'GitHub connection state is unavailable.');
  return mapCredential(data);
}

async function markSync(service: SupabaseClient, userId: string, status: string, code?: string, message?: string): Promise<void> {
  await service.rpc('mark_github_life_hero_sync', {
    p_user_id: userId,
    p_status: status,
    p_error_code: code || null,
    p_error_message: message || null,
  });
}

async function getFreshCredential(service: SupabaseClient, userId: string): Promise<CredentialState> {
  const current = await loadCredential(service, userId);
  if (!current) throw new GithubSyncError('needs_reconnect', 'Reconnect the GitHub App to continue.');
  if (current.refreshTokenExpiresAt && new Date(current.refreshTokenExpiresAt).getTime() <= Date.now()) {
    throw new GithubSyncError('needs_reconnect', 'The GitHub refresh token has expired. Reconnect the GitHub App.');
  }
  if (!current.accessTokenExpiresAt || new Date(current.accessTokenExpiresAt).getTime() > Date.now() + ACCESS_TOKEN_BUFFER_MS) {
    return current;
  }

  const response = await fetch(`${GITHUB_OAUTH}/access_token`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: GITHUB_APP_CLIENT_ID,
      client_secret: GITHUB_APP_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: current.refreshToken,
    }),
  });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || typeof payload?.access_token !== 'string' || typeof payload.refresh_token !== 'string'
    || !positiveNumber(payload.expires_in) || !positiveNumber(payload.refresh_token_expires_in)) {
    throw new GithubSyncError('needs_reconnect', 'GitHub access needs an explicit reconnect.');
  }

  const { error } = await service.rpc('save_github_life_hero_credential', {
    p_user_id: userId,
    p_github_user_id: current.githubUserId,
    p_access_token: payload.access_token,
    p_refresh_token: payload.refresh_token,
    p_access_token_expires_at: positiveNumber(payload.expires_in)
      ? new Date(Date.now() + payload.expires_in * 1_000).toISOString()
      : null,
    p_refresh_token_expires_at: positiveNumber(payload.refresh_token_expires_in)
      ? new Date(Date.now() + payload.refresh_token_expires_in * 1_000).toISOString()
      : current.refreshTokenExpiresAt || null,
    p_installation_id: current.installationId || null,
    p_api_version: current.apiVersion,
  });
  if (error) throw new GithubSyncError('temporary_unavailable', 'The refreshed GitHub credential could not be saved.');
  return {
    ...current,
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    ...(positiveNumber(payload.expires_in)
      ? { accessTokenExpiresAt: new Date(Date.now() + payload.expires_in * 1_000).toISOString() }
      : {}),
    ...(positiveNumber(payload.refresh_token_expires_in)
      ? { refreshTokenExpiresAt: new Date(Date.now() + payload.refresh_token_expires_in * 1_000).toISOString() }
      : {}),
  };
}

async function loadState(service: SupabaseClient, state: string): Promise<Record<string, unknown> | null> {
  const stateHash = await hashState(state);
  const { data, error } = await service
    .from('github_life_hero_oauth_states')
    .select('state_hash,user_id,redirect_uri,installation_id,expires_at,used_at')
    .eq('state_hash', stateHash)
    .maybeSingle();
  if (error || !data || new Date(data.expires_at).getTime() <= Date.now() || data.used_at) return null;
  return data as Record<string, unknown>;
}

async function beginAuthorization(service: SupabaseClient, userId: string, redirectUri: string): Promise<Response> {
  if (!validRedirectUri(redirectUri)) return failure('invalid_request', 'The GitHub callback origin is not allowed.');
  const state = crypto.randomUUID();
  const stateHash = await hashState(state);
  const { error } = await service.from('github_life_hero_oauth_states').insert({
    state_hash: stateHash,
    user_id: userId,
    redirect_uri: redirectUri,
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  });
  if (error) return failure('temporary_unavailable', 'GitHub authorization could not be started.');

  const installation = new URL(`https://github.com/apps/${encodeURIComponent(GITHUB_APP_SLUG)}/installations/new`);
  installation.searchParams.set('state', state);
  const authorization = new URL(`${GITHUB_OAUTH}/authorize`);
  authorization.searchParams.set('client_id', GITHUB_APP_CLIENT_ID);
  authorization.searchParams.set('redirect_uri', redirectUri);
  authorization.searchParams.set('state', state);
  return success({ installationUrl: installation.toString(), authorizationUrl: authorization.toString(), state });
}

async function completeInstallation(service: SupabaseClient, userId: string, state: string, installationId: number): Promise<Response> {
  const row = await loadState(service, state);
  if (!row || row.user_id !== userId) return failure('needs_reconnect', 'The GitHub authorization session expired. Start again.');
  const stateHash = await hashState(state);
  const { data, error } = await service.from('github_life_hero_oauth_states')
    .update({ installation_id: installationId })
    .eq('state_hash', stateHash)
    .eq('user_id', userId)
    .is('used_at', null)
    .select('state_hash')
    .maybeSingle();
  if (error) return failure('temporary_unavailable', 'The GitHub installation could not be recorded.');
  if (!data) return failure('needs_reconnect', 'The GitHub authorization session has already been used. Start again.');
  const authorization = new URL(`${GITHUB_OAUTH}/authorize`);
  authorization.searchParams.set('client_id', GITHUB_APP_CLIENT_ID);
  authorization.searchParams.set('redirect_uri', String(row.redirect_uri));
  authorization.searchParams.set('state', state);
  return success({ authorizationUrl: authorization.toString() });
}

async function completeAuthorization(
  service: SupabaseClient,
  userId: string,
  state: string,
  code: string,
): Promise<Response> {
  const row = await loadState(service, state);
  const installationId = numericId(row?.installation_id);
  if (!row || row.user_id !== userId || !installationId) {
    return failure('needs_reconnect', 'Complete the selected-repository GitHub App installation before authorizing.');
  }
  const stateHash = await hashState(state);
  const { data: consumedState, error: consumeError } = await service.from('github_life_hero_oauth_states')
    .update({ used_at: nowIso() })
    .eq('state_hash', stateHash)
    .eq('user_id', userId)
    .is('used_at', null)
    .select('state_hash')
    .maybeSingle();
  if (consumeError) return failure('temporary_unavailable', 'The GitHub authorization session could not be finalized securely.');
  if (!consumedState) return failure('needs_reconnect', 'The GitHub authorization session has already been used. Start again.');
  const response = await fetch(`${GITHUB_OAUTH}/access_token`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: GITHUB_APP_CLIENT_ID,
      client_secret: GITHUB_APP_CLIENT_SECRET,
      code,
      redirect_uri: row.redirect_uri,
    }),
  });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || typeof payload?.access_token !== 'string' || typeof payload.refresh_token !== 'string'
    || !positiveNumber(payload.expires_in) || !positiveNumber(payload.refresh_token_expires_in)) {
    return failure('needs_reconnect', 'GitHub authorization was not completed. Start the explicit reconnect again.');
  }

  let githubUser: GithubUser;
  try {
    githubUser = (await githubRequest<GithubUser>('/user', payload.access_token)).data;
  } catch {
    return failure('unavailable', 'GitHub authorization succeeded, but the GitHub account could not be verified.');
  }
  const githubUserId = numericId(githubUser.id);
  if (!githubUserId) return failure('unavailable', 'GitHub returned an invalid account identity.');

  let installations: GithubInstallationInput[];
  try {
    installations = await fetchAllPages<GithubInstallationInput>(
      '/user/installations?per_page=100',
      payload.access_token,
      GITHUB_API_VERSION,
      parseGithubInstallationsPage,
    );
  } catch {
    return failure('unavailable', 'The GitHub App installation could not be verified for this account.');
  }
  if (!githubInstallationIsAccessible(installations, installationId)) {
    return failure('forbidden', 'The GitHub App installation is not available to the authorized account.');
  }

  const { data, error } = await service.rpc('save_github_life_hero_credential', {
    p_user_id: userId,
    p_github_user_id: githubUserId,
    p_access_token: payload.access_token,
    p_refresh_token: payload.refresh_token,
    p_access_token_expires_at: positiveNumber(payload.expires_in)
      ? new Date(Date.now() + payload.expires_in * 1_000).toISOString()
      : null,
    p_refresh_token_expires_at: positiveNumber(payload.refresh_token_expires_in)
      ? new Date(Date.now() + payload.refresh_token_expires_in * 1_000).toISOString()
      : null,
    p_installation_id: installationId,
    p_api_version: GITHUB_API_VERSION,
  });
  if (error || !mapConnection(data)) return failure('temporary_unavailable', 'The GitHub credential could not be stored securely.');
  return success(mapConnection(data));
}

async function getStatus(service: SupabaseClient, userId: string): Promise<Response> {
  const credential = await loadCredential(service, userId);
  return success(credential ? {
    status: credential.lastSyncStatus === 'revoked' || credential.lastSyncStatus === 'needs_reconnect' ? 'revoked' : 'connected',
    connection: mapConnection(credential),
  } : { status: 'disconnected', connection: null });
}

async function listRepositories(credential: CredentialState): Promise<Array<{ id: number; fullName: string; private: boolean }>> {
  const path = githubInstallationRepositoriesPath(credential.installationId);
  if (!path) throw new GithubSyncError('needs_reconnect', 'The GitHub App installation is unavailable. Reconnect explicitly.');
  const repositories = await fetchAllPages<GithubRepository>(
    path,
    credential.accessToken,
    credential.apiVersion,
    parseGithubInstallationRepositoriesPage,
  );
  return repositories.map(repository => {
    if (!numericId(repository.id) || typeof repository.full_name !== 'string') {
      throw new GithubSyncError('partial_sync', 'GitHub returned an invalid repository response.');
    }
    return { id: repository.id, fullName: repository.full_name, private: repository.private === true };
  });
}

async function selectRepositories(service: SupabaseClient, userId: string, ids: number[]): Promise<Response> {
  const credential = await getFreshCredential(service, userId);
  const repositories = await listRepositories(credential);
  if (!githubSelectionIsInstallationScoped(repositories.map(repository => repository.id), ids)) {
    return failure('forbidden', 'Select only repositories available to the installed GitHub App.');
  }
  const { data, error } = await service.rpc('set_github_life_hero_selection', {
    p_user_id: userId,
    p_repository_ids: ids,
  });
  if (error || !mapConnection(data)) return failure('temporary_unavailable', 'The selected GitHub repositories could not be saved.');
  return success({ repositories, connection: mapConnection(data) });
}

async function syncEvidence(
  service: SupabaseClient,
  userId: string,
  localDateInput: unknown,
  timeZoneInput: unknown,
): Promise<Response> {
  const localDate = assertLocalDate(localDateInput);
  const timeZone = assertTimeZone(timeZoneInput);
  const credential = await getFreshCredential(service, userId);
  if (credential.selectedRepositoryIds.length === 0) {
    await markSync(service, userId, 'empty', 'empty_selection', 'Select at least one repository before syncing GitHub evidence.');
    return success({ status: 'empty', scanned: 0, qualifying: 0, accepted: 0, duplicates: 0 });
  }

  const repositories = await listRepositories(credential);
  if (!githubSelectionIsInstallationScoped(repositories.map(repository => repository.id), credential.selectedRepositoryIds)) {
    await markSync(service, userId, 'unavailable', 'selection_out_of_scope', 'A selected repository is no longer available to the installed GitHub App.');
    throw new GithubSyncError('unavailable', 'A selected repository is no longer available to the installed GitHub App.');
  }

  const githubUser = (await githubRequest<GithubUser>('/user', credential.accessToken, credential.apiVersion)).data;
  if (githubUser.id !== credential.githubUserId) {
    await markSync(service, userId, 'needs_reconnect', 'account_mismatch', 'The authorized GitHub account changed. Reconnect explicitly.');
    throw new GithubSyncError('needs_reconnect', 'The authorized GitHub account changed. Reconnect explicitly.');
  }

  const candidates: Array<Record<string, unknown>> = [];
  let scanned = 0;
  for (const repositoryId of credential.selectedRepositoryIds) {
    const pullRequests = await fetchAllPages<GithubPullRequestEvidenceInput>(
      `/repositories/${repositoryId}/pulls?state=closed&sort=updated&direction=desc&per_page=100`,
      credential.accessToken,
      credential.apiVersion,
    );
    for (const pullRequest of pullRequests) {
      scanned += 1;
      if (!githubPullRequestQualifies(pullRequest, credential.githubUserId)) continue;
      const mergedLocalDate = localDateFor(pullRequest.merged_at!, timeZone);
      if (mergedLocalDate > localDate) continue;
      if (candidates.length >= MAX_CANDIDATES) throw new GithubSyncError('partial_sync', 'GitHub evidence exceeded the safe sync bound.');
      const candidate = githubEvidenceCandidate(repositoryId, pullRequest, credential.githubUserId, credential.apiVersion, mergedLocalDate);
      if (candidate) candidates.push(candidate);
    }
  }

  if (candidates.length === 0) {
    await markSync(service, userId, 'empty', 'no_qualifying_pull_requests', 'No authored merged pull requests were found in the selected repositories.');
    return success({ status: 'empty', scanned, qualifying: 0, accepted: 0, duplicates: 0 });
  }

  const { data, error } = await service.rpc('accept_github_life_hero_evidence', {
    p_user_id: userId,
    p_candidates: candidates,
    p_as_of_local_date: localDate,
  });
  if (error || !data || typeof data !== 'object') {
    throw new GithubSyncError('temporary_unavailable', 'GitHub evidence could not be committed atomically. Existing progress is unchanged.');
  }
  const result = data as Record<string, unknown>;
  const accepted = typeof result.accepted === 'number' ? result.accepted : 0;
  const duplicates = typeof result.duplicates === 'number' ? result.duplicates : 0;
  await markSync(service, userId, 'success');
  return success({ status: 'success', scanned, qualifying: candidates.length, accepted, duplicates });
}

async function handle(request: Request): Promise<Response> {
  const origin = request.headers.get('origin') || undefined;
  if (origin && !GITHUB_ALLOWED_ORIGINS.has(origin)) return failure('forbidden', 'This browser origin is not allowed to use the GitHub App route.', 403);
  if (request.method === 'OPTIONS') return jsonResponse(null, 204, origin);
  if (request.method !== 'POST') return failure('invalid_request', 'GitHub Life Hero requests must use POST.', 405);
  if (!configured()) return failure('not_configured', 'The hosted GitHub App route is not configured.');

  let body: RequestBody;
  try {
    body = await request.json() as RequestBody;
  } catch {
    return failure('invalid_request', 'The GitHub request body is invalid.');
  }
  if (!body || typeof body !== 'object' || typeof body.action !== 'string') {
    return failure('invalid_request', 'A GitHub action is required.');
  }
  const identity = await getUser(request.headers.get('authorization'));
  if (identity instanceof Response) return identity;
  const service = createServiceClient();

  try {
    switch (body.action) {
      case 'begin_authorization':
        return beginAuthorization(service, identity.id, body.redirectUri);
      case 'complete_installation': {
        const installationId = numericId(body.installationId);
        if (!installationId || typeof body.state !== 'string') return failure('invalid_request', 'The GitHub installation callback is incomplete.');
        return completeInstallation(service, identity.id, body.state, installationId);
      }
      case 'complete_authorization':
        if (typeof body.state !== 'string' || typeof body.code !== 'string' || !body.code.trim()) {
          return failure('invalid_request', 'The GitHub authorization callback is incomplete.');
        }
        return completeAuthorization(service, identity.id, body.state, body.code);
      case 'get_status':
        return getStatus(service, identity.id);
      case 'list_repositories': {
        const credential = await getFreshCredential(service, identity.id);
        return success({ repositories: await listRepositories(credential) });
      }
      case 'save_selection': {
        const ids = parseRepositoryIds(body.repositoryIds);
        if (!ids) return failure('invalid_request', 'Select no more than 25 valid GitHub repositories.');
        return selectRepositories(service, identity.id, ids);
      }
      case 'sync':
        return await syncEvidence(service, identity.id, body.localDate, body.timeZone);
      case 'disconnect':
        {
          const { error } = await service.rpc('delete_github_life_hero_connection', { p_user_id: identity.id });
          if (error) return failure('temporary_unavailable', 'GitHub disconnect could not be completed. Existing credential state is unchanged.');
        }
        return success({ disconnected: true });
      default:
        return failure('invalid_request', 'The GitHub action is unsupported.');
    }
  } catch (error) {
    if (error instanceof GithubApiError) {
      if (error.rateLimited) {
        const message = error.retryAfter
          ? `GitHub rate limit reached. Retry after ${error.retryAfter}.`
          : 'GitHub rate limit reached. Retry later.';
        await markSync(service, identity.id, 'rate_limited', 'rate_limited', message).catch(() => undefined);
        return failure('rate_limited', message);
      }
      const code: FailureCode = error.status === 401
        ? 'needs_reconnect'
        : error.status === 403 ? 'forbidden' : error.status === 404 ? 'unavailable' : 'temporary_unavailable';
      const message = code === 'needs_reconnect'
        ? 'GitHub authorization was revoked or expired. Reconnect explicitly.'
        : code === 'forbidden'
          ? 'The GitHub App cannot read the selected repository.'
          : code === 'unavailable'
            ? 'The selected GitHub repository is unavailable to the App.'
            : 'GitHub is temporarily unavailable. Existing progress is unchanged.';
      await markSync(service, identity.id, code === 'needs_reconnect' ? 'needs_reconnect' : code === 'unavailable' ? 'unavailable' : 'error', code, message).catch(() => undefined);
      return failure(code, message);
    }
    if (error instanceof GithubSyncError) {
      const status = error.code === 'partial_sync' ? 'partial_sync' : error.code;
      if (body.action === 'sync') await markSync(service, identity.id, status, error.code, error.message).catch(() => undefined);
      return failure(error.code, error.message);
    }
    await markSync(service, identity.id, 'error', 'temporary_unavailable', 'The hosted GitHub route is temporarily unavailable.').catch(() => undefined);
    return failure('temporary_unavailable', 'The hosted GitHub route is temporarily unavailable.');
  }
}

Deno.serve(async request => withAllowedOriginCors(
  await handle(request),
  request.headers.get('origin'),
  GITHUB_ALLOWED_ORIGINS,
));
