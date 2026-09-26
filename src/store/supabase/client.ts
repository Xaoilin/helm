/**
 * The one Supabase client and the signed-in session it serves.
 *
 * This module owns the mutable client and session state. Readers use the
 * exported getters; only `auth.ts` records session changes, through
 * `recordAuthSession` and `advanceAuthSessionRevision`.
 */
import { createClient, type Session, type SupabaseClient, type User } from '@supabase/supabase-js';
import {
  configureOperationalTransport,
  recordOperationalEvent,
  setOperationalAccount,
} from '../../services/operationalTelemetry';
import { operationalEventsUrl } from '../../services/backend/profileServiceApi';
import { operationalReceiptSchema } from '../../services/backend/contracts';

let client: SupabaseClient | null = null;
let currentUserId: string | null = null;
let currentSession: Session | null = null;
let authSessionBootstrapped = false;
let authSessionRevision = 0;

export interface AuthSessionSnapshot {
  userId: string;
  email: string | null;
  accessTokenPresent: boolean;
  providerToken: string | null;
  providerRefreshToken: string | null;
  provider: string | null;
  expiresAt: number | null;
}

export function initSupabase(url: string, publishableKey: string): void {
  authSessionRevision += 1;
  if (!url || !publishableKey) {
    client = null;
    currentUserId = null;
    currentSession = null;
    authSessionBootstrapped = false;
    configureOperationalTransport(null);
    setOperationalAccount(null);
    return;
  }
  // Operational events become metrics in the profile service (and from there Grafana). Without a
  // profile service there is nowhere to send them, so they stay in the local diagnostics buffer.
  const collectorUrl = operationalEventsUrl();
  configureOperationalTransport(collectorUrl ? async (events, signal) => {
    const accessToken = currentSession?.access_token;
    if (!accessToken) {
      const error = new Error('Operational telemetry requires a current signed-in session.') as Error & { status?: number };
      error.status = 401;
      throw error;
    }
    const response = await fetch(collectorUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ events }),
      signal,
      keepalive: true,
    });
    if (!response.ok) {
      const code = response.status === 400
        ? 'invalid_response'
        : response.status === 401
          ? 'unauthorized'
          : response.status === 403 ? 'forbidden' : response.status === 429 ? 'rate_limited' : undefined;
      throw Object.assign(new Error('Operational collection unavailable.'), { status: response.status, code });
    }
    const receipt = operationalReceiptSchema.safeParse(await response.json().catch(() => null));
    if (!receipt.success || receipt.data.accepted !== events.length) {
      throw Object.assign(new Error('Operational collection returned an invalid receipt.'), { code: 'invalid_response' });
    }
  } : null);
  client = createClient(url, publishableKey, {
    realtime: {
      // Removing an exhausted subscription must also stop socket retries when
      // no other channel owns the connection (the SDK otherwise waits 50s).
      disconnectOnEmptyChannelsAfterMs: 0,
      heartbeatCallback: (status, latency) => {
        if (status === 'sent') {
          recordOperationalEvent({ domain: 'realtime', operation: 'heartbeat', outcome: 'pending', reason: 'heartbeat_sent' });
        } else if (status === 'ok') {
          recordOperationalEvent({ domain: 'realtime', operation: 'heartbeat', outcome: 'ok', reason: 'heartbeat_ok', durationMs: latency });
        } else {
          recordOperationalEvent({
            domain: 'realtime',
            operation: 'heartbeat',
            outcome: 'failed',
            reason: status === 'timeout' ? 'heartbeat_timeout' : 'heartbeat_error',
          });
        }
      },
    },
  });
  authSessionBootstrapped = false;
}

export function initFromEnv(): void {
  const url = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_URL) || '';
  const key = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_ANON_KEY) || '';
  if (url && key) initSupabase(url, key);
}

export function isSupabaseReady(): boolean {
  return client !== null;
}

export function getClient(): SupabaseClient | null {
  return client;
}

/** The configured client for a signed-in account; throws otherwise. */
export function requireClient(): SupabaseClient {
  if (!client) throw new Error('Supabase is not configured.');
  if (!currentUserId) throw new Error('A signed-in Sabah One account is required.');
  return client;
}

export function getCurrentUserId(): string | null {
  return currentUserId;
}

export function setCurrentUserId(userId: string | null): void {
  if (currentUserId !== userId) authSessionRevision += 1;
  currentUserId = userId;
  setOperationalAccount(userId);
}

export function getAuthSessionSnapshot(): AuthSessionSnapshot | null {
  if (!currentSession?.user) return null;
  return {
    userId: currentSession.user.id,
    email: currentSession.user.email ?? null,
    accessTokenPresent: Boolean(currentSession.access_token),
    providerToken: currentSession.provider_token ?? null,
    providerRefreshToken: currentSession.provider_refresh_token ?? null,
    provider: currentSession.user.app_metadata?.provider ?? null,
    expiresAt: currentSession.expires_at ?? null,
  };
}

export function getCurrentAccessToken(): string | null {
  return currentSession?.access_token ?? null;
}

export function isAuthSessionBootstrapped(): boolean {
  return authSessionBootstrapped;
}

export function isAuthenticated(): boolean {
  return currentUserId !== null;
}

/** Monotonic counter that lets an in-flight session read detect a newer auth event. */
export function getAuthSessionRevision(): number {
  return authSessionRevision;
}

/** Mark every in-flight session read as superseded. Used by `auth.ts` only. */
export function advanceAuthSessionRevision(): void {
  authSessionRevision += 1;
}

/** The user of the last recorded session, if any. */
export function getCurrentSessionUser(): User | null {
  return currentSession?.user ?? null;
}

/**
 * Record the session the SDK reported (or `null` when signed out) and mark the
 * session as bootstrapped. Used by `auth.ts` only.
 */
export function recordAuthSession(session: Session | null): void {
  currentUserId = session?.user?.id || null;
  currentSession = session;
  authSessionBootstrapped = true;
  setOperationalAccount(currentUserId);
}
