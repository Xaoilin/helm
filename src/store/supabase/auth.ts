/** Supabase Auth sign-in, sign-out, session bootstrap and auth events. */
import { isAuthRetryableFetchError, type AuthChangeEvent, type User } from '@supabase/supabase-js';
import { logWarn } from '../../services/logger';
import { classifyOperationalFailure, recordOperationalEvent } from '../../services/operationalTelemetry';
import {
  advanceAuthSessionRevision,
  getAuthSessionRevision,
  getClient,
  getCurrentSessionUser,
  recordAuthSession,
} from './client';

const GOOGLE_SIGN_IN_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar',
].join(' ');

export interface AuthStateChange {
  event: AuthChangeEvent;
  user: User | null;
}

export async function signInWithGoogle(redirectTo?: string): Promise<void> {
  const client = getClient();
  if (!client) throw new Error('Supabase is not configured.');
  const { error } = await client.auth.signInWithOAuth({
    provider: 'google',
    options: {
      scopes: GOOGLE_SIGN_IN_SCOPES,
      redirectTo: redirectTo || window.location.origin + (window.location.pathname.includes('/helm') ? '/helm/' : '/'),
      queryParams: {
        access_type: 'offline',
        include_granted_scopes: 'true',
        prompt: 'consent select_account',
      },
    },
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  const client = getClient();
  if (!client) return;
  const { error } = await client.auth.signOut();
  if (error) throw error;
  advanceAuthSessionRevision();
  recordAuthSession(null);
  recordOperationalEvent({ domain: 'auth', operation: 'session', outcome: 'changed', reason: 'signed_out' });
}

/** Startup waits this long between attempts when the auth server cannot be reached. */
const SESSION_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000];
/** A token this close to expiry is renewed before use, so a request never leaves with a dead token. */
const TOKEN_EXPIRY_MARGIN_SECONDS = 60;

/**
 * The auth server could not be reached to renew a stored session. The session may still be valid,
 * so this is never treated as "signed out".
 */
export class SessionUnavailableError extends Error {
  constructor(cause: unknown) {
    super('Sabah One could not reach its sign-in service to renew your session.');
    this.name = 'SessionUnavailableError';
    this.cause = cause;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * The signed-in user at startup, or null only when there is genuinely no session.
 *
 * A stored session whose renewal fails for a network reason is retried; if the auth server stays
 * unreachable, {@link SessionUnavailableError} is thrown so the app can offer a retry instead of a
 * sign-in screen (the SDK keeps such sessions stored, and signing in again would not help).
 */
export async function getSessionUser(): Promise<User | null> {
  const activeClient = getClient();
  if (!activeClient) return null;
  const revision = getAuthSessionRevision();
  const superseded = () => getClient() !== activeClient || revision !== getAuthSessionRevision();
  const startedAt = performance.now();
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= SESSION_RETRY_DELAYS_MS.length; attempt += 1) {
    if (attempt > 0) await sleep(SESSION_RETRY_DELAYS_MS[attempt - 1]);
    // An auth event may supersede this read while the SDK recovers its session.
    if (superseded()) return getCurrentSessionUser();
    const { data: { session }, error } = await activeClient.auth.getSession();
    if (superseded()) return getCurrentSessionUser();
    if (!error) {
      recordAuthSession(session);
      recordOperationalEvent({
        domain: 'auth',
        operation: 'session',
        outcome: session?.user ? 'ok' : 'changed',
        reason: session?.user ? 'initial_session' : 'signed_out',
        durationMs: performance.now() - startedAt,
      });
      return session?.user ?? null;
    }
    lastError = error;
    if (!isAuthRetryableFetchError(error)) break;
    logWarn('Supabase', `Session renewal failed; retrying: ${error.message}`);
  }
  recordOperationalEvent({
    domain: 'auth',
    operation: 'session',
    outcome: 'failed',
    reason: classifyOperationalFailure(lastError),
    durationMs: performance.now() - startedAt,
  });
  if (isAuthRetryableFetchError(lastError)) throw new SessionUnavailableError(lastError);
  // The refresh token was rejected: the session has ended and the SDK has removed it.
  logWarn('Supabase', `Session ended: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  recordAuthSession(null);
  return null;
}

let refreshInFlight: Promise<string | null> | null = null;

/**
 * An access token that is valid for at least a minute, renewing the session first when needed.
 * Every call to a Sabah One service uses this rather than a cached token, so a tab that slept or
 * sat in the background never sends an expired one.
 *
 * @param forceRefresh renew even if the current token looks valid (after a 401)
 * @returns null only when there is no session: the user is signed out
 * @throws SessionUnavailableError when the auth server cannot be reached; the session is kept
 */
export async function getFreshAccessToken(options: { forceRefresh?: boolean } = {}): Promise<string | null> {
  const activeClient = getClient();
  if (!activeClient) return null;
  if (!options.forceRefresh) {
    const { data: { session }, error } = await activeClient.auth.getSession();
    if (error && isAuthRetryableFetchError(error)) throw new SessionUnavailableError(error);
    if (!session) return null;
    if ((session.expires_at ?? 0) - TOKEN_EXPIRY_MARGIN_SECONDS > Date.now() / 1000) return session.access_token;
  }
  // One renewal at a time; the SDK also serialises renewals across tabs.
  refreshInFlight ??= activeClient.auth.refreshSession()
    .then(async ({ data, error }) => {
      if (!error) return data.session?.access_token ?? null;
      if (isAuthRetryableFetchError(error)) throw new SessionUnavailableError(error);
      // Another tab may have renewed the session first; use whatever session storage now holds.
      const { data: { session } } = await activeClient.auth.getSession();
      return session?.access_token ?? null;
    })
    .finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

export function onAuthStateChange(callback: (change: AuthStateChange) => void): () => void {
  const client = getClient();
  if (!client) return () => {};
  const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
    // The SDK reports INITIAL_SESSION as null when renewing a stored session fails for a network
    // reason, while keeping that session. getSessionUser decides the startup state instead.
    if (event === 'INITIAL_SESSION' && !session) return;
    advanceAuthSessionRevision();
    const user = session?.user || null;
    recordAuthSession(session ?? null);
    recordOperationalEvent({
      domain: 'auth',
      operation: event === 'TOKEN_REFRESHED' ? 'refresh' : 'session',
      outcome: event === 'INITIAL_SESSION' ? 'ok' : 'changed',
      reason: event === 'INITIAL_SESSION'
        ? 'initial_session'
        : event === 'TOKEN_REFRESHED'
          ? 'token_refreshed'
          : user ? 'signed_in' : 'signed_out',
    });
    callback({ event, user });
  });
  return () => subscription.unsubscribe();
}
