/** Supabase Auth sign-in, sign-out, session bootstrap and auth events. */
import type { AuthChangeEvent, User } from '@supabase/supabase-js';
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

export async function getSessionUser(): Promise<User | null> {
  const activeClient = getClient();
  if (!activeClient) return null;
  const revision = getAuthSessionRevision();
  const superseded = () => getClient() !== activeClient || revision !== getAuthSessionRevision();
  const startedAt = performance.now();
  try {
    const { data: { session }, error } = await activeClient.auth.getSession();
    // An auth event may supersede this read while the SDK recovers its session.
    if (superseded()) return getCurrentSessionUser();
    if (error) throw error;
    if (session?.user) {
      recordAuthSession(session);
      recordOperationalEvent({
        domain: 'auth',
        operation: 'session',
        outcome: 'ok',
        reason: 'initial_session',
        durationMs: performance.now() - startedAt,
      });
      return session.user;
    }
  } catch (error) {
    if (superseded()) return getCurrentSessionUser();
    logWarn('Supabase', `Session bootstrap failed: ${error instanceof Error ? error.message : String(error)}`);
    recordAuthSession(null);
    recordOperationalEvent({
      domain: 'auth',
      operation: 'session',
      outcome: 'failed',
      reason: classifyOperationalFailure(error),
      durationMs: performance.now() - startedAt,
    });
    return null;
  }
  recordAuthSession(null);
  recordOperationalEvent({
    domain: 'auth',
    operation: 'session',
    outcome: 'changed',
    reason: 'signed_out',
    durationMs: performance.now() - startedAt,
  });
  return null;
}

export function onAuthStateChange(callback: (change: AuthStateChange) => void): () => void {
  const client = getClient();
  if (!client) return () => {};
  const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
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
