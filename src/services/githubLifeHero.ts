import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from '@supabase/supabase-js';
import { GITHUB_LIFE_HERO_FUNCTION } from '../config';
import { API_TIMEOUT } from '../config/constants';
import { getClient, getCurrentAccessToken, isSupabaseReady } from '../store/supabase';

export type GithubLifeHeroFailureCode =
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

export type GithubLifeHeroConnectionStatus = 'connected' | 'disconnected' | 'revoked';

export interface GithubLifeHeroRepository {
  id: number;
  fullName: string;
  private: boolean;
}

export interface GithubLifeHeroConnection {
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

export interface GithubLifeHeroStatus {
  status: GithubLifeHeroConnectionStatus;
  connection: GithubLifeHeroConnection | null;
}

export function githubConnectionNeedsReconnect(status: GithubLifeHeroStatus | null): boolean {
  return status?.status === 'revoked';
}

export interface GithubLifeHeroSyncReceipt {
  status: 'success' | 'empty';
  scanned: number;
  qualifying: number;
  accepted: number;
  duplicates: number;
}

interface GithubLifeHeroSuccess<T> {
  ok: true;
  result: T;
}

interface GithubLifeHeroFailure {
  ok: false;
  error: GithubLifeHeroFailureCode;
  message: string;
}

type GithubLifeHeroResponse<T> = GithubLifeHeroSuccess<T> | GithubLifeHeroFailure;

export class GithubLifeHeroError extends Error {
  readonly code: GithubLifeHeroFailureCode;
  readonly httpStatus?: number;

  constructor(code: GithubLifeHeroFailureCode, message: string, httpStatus?: number) {
    super(message);
    this.name = 'GithubLifeHeroError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function isHttpError(error: unknown): error is FunctionsHttpError {
  return error instanceof FunctionsHttpError
    || (
      typeof error === 'object'
      && error !== null
      && 'context' in error
      && typeof error.context === 'object'
      && error.context !== null
      && 'status' in error.context
    );
}

async function functionError(error: unknown): Promise<GithubLifeHeroError> {
  if (error instanceof FunctionsFetchError || error instanceof FunctionsRelayError) {
    return new GithubLifeHeroError('temporary_unavailable', error.message);
  }
  if (isHttpError(error)) {
    return new GithubLifeHeroError(
      'temporary_unavailable',
      `The hosted GitHub route is unavailable (HTTP ${error.context.status}).`,
      error.context.status,
    );
  }
  return new GithubLifeHeroError('temporary_unavailable', 'The hosted GitHub route is unavailable.');
}

function validRepository(value: unknown): value is GithubLifeHeroRepository {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === 'number'
    && Number.isSafeInteger(row.id)
    && row.id > 0
    && typeof row.fullName === 'string'
    && row.fullName.length > 0
    && typeof row.private === 'boolean';
}

function validConnection(value: unknown): value is GithubLifeHeroConnection {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.githubUserId === 'number'
    && Number.isSafeInteger(row.githubUserId)
    && Array.isArray(row.selectedRepositoryIds)
    && row.selectedRepositoryIds.every(id => typeof id === 'number' && Number.isSafeInteger(id) && id > 0)
    && typeof row.apiVersion === 'string'
    && typeof row.authorizedAt === 'string'
    && typeof row.lastSyncStatus === 'string';
}

export function parseGithubLifeHeroResponse<T>(value: unknown): T {
  if (!value || typeof value !== 'object') {
    throw new GithubLifeHeroError('temporary_unavailable', 'The hosted GitHub route returned no response.');
  }
  const response = value as GithubLifeHeroResponse<T>;
  if (response.ok !== true) {
    throw new GithubLifeHeroError(response.error, response.message);
  }
  return response.result;
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  if (!isSupabaseReady()) throw new GithubLifeHeroError('sign_in_required', 'Supabase sign-in is required for GitHub evidence.');
  const client = getClient();
  const accessToken = getCurrentAccessToken();
  if (!client || !accessToken) throw new GithubLifeHeroError('sign_in_required', 'Sign in to Sabah One before using GitHub evidence.');

  const { data, error } = await client.functions.invoke<GithubLifeHeroResponse<T>>(GITHUB_LIFE_HERO_FUNCTION, {
    body,
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: API_TIMEOUT.GITHUB_LIFE_HERO,
  });
  if (error) throw await functionError(error);
  return parseGithubLifeHeroResponse<T>(data);
}

export async function beginGithubLifeHeroAuthorization(redirectUri: string): Promise<{
  installationUrl: string;
  authorizationUrl: string;
}> {
  const result = await invoke<{ installationUrl: string; authorizationUrl: string }>({
    action: 'begin_authorization',
    redirectUri,
  });
  if (!result || typeof result.installationUrl !== 'string' || typeof result.authorizationUrl !== 'string') {
    throw new GithubLifeHeroError('temporary_unavailable', 'The GitHub authorization response was invalid.');
  }
  return result;
}

export async function completeGithubLifeHeroInstallation(state: string, installationId: number): Promise<{ authorizationUrl: string }> {
  const result = await invoke<{ authorizationUrl: string }>({ action: 'complete_installation', state, installationId });
  if (!result || typeof result.authorizationUrl !== 'string') {
    throw new GithubLifeHeroError('temporary_unavailable', 'The GitHub installation response was invalid.');
  }
  return result;
}

export async function completeGithubLifeHeroAuthorization(code: string, state: string): Promise<GithubLifeHeroConnection> {
  const result = await invoke<GithubLifeHeroConnection>({ action: 'complete_authorization', code, state });
  if (!validConnection(result)) throw new GithubLifeHeroError('temporary_unavailable', 'The GitHub connection response was invalid.');
  return result;
}

export async function getGithubLifeHeroStatus(): Promise<GithubLifeHeroStatus> {
  const result = await invoke<GithubLifeHeroStatus>({ action: 'get_status' });
  if (!result || !['connected', 'disconnected', 'revoked'].includes(result.status)
    || (result.connection !== null && !validConnection(result.connection))) {
    throw new GithubLifeHeroError('temporary_unavailable', 'The GitHub status response was invalid.');
  }
  return result;
}

export async function listGithubLifeHeroRepositories(): Promise<GithubLifeHeroRepository[]> {
  const result = await invoke<{ repositories: GithubLifeHeroRepository[] }>({ action: 'list_repositories' });
  if (!result || !Array.isArray(result.repositories) || result.repositories.some(repository => !validRepository(repository))) {
    throw new GithubLifeHeroError('temporary_unavailable', 'The GitHub repository response was invalid.');
  }
  return result.repositories;
}

export async function saveGithubLifeHeroSelection(repositoryIds: number[]): Promise<{
  repositories: GithubLifeHeroRepository[];
  connection: GithubLifeHeroConnection;
}> {
  const result = await invoke<{ repositories: GithubLifeHeroRepository[]; connection: GithubLifeHeroConnection }>({
    action: 'save_selection',
    repositoryIds,
  });
  if (!result || !Array.isArray(result.repositories) || result.repositories.some(repository => !validRepository(repository))
    || !validConnection(result.connection)) {
    throw new GithubLifeHeroError('temporary_unavailable', 'The GitHub repository selection response was invalid.');
  }
  return result;
}

export async function syncGithubLifeHeroEvidence(localDate: string, timeZone: string): Promise<GithubLifeHeroSyncReceipt> {
  const result = await invoke<GithubLifeHeroSyncReceipt>({ action: 'sync', localDate, timeZone });
  if (!result || !['success', 'empty'].includes(result.status)
    || ![result.scanned, result.qualifying, result.accepted, result.duplicates].every(value => Number.isInteger(value) && value >= 0)) {
    throw new GithubLifeHeroError('temporary_unavailable', 'The GitHub sync response was invalid.');
  }
  return result;
}

export async function disconnectGithubLifeHero(): Promise<void> {
  await invoke<{ disconnected: true }>({ action: 'disconnect' });
}
