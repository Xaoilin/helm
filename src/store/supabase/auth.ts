/** Identity-only Google sign-in and product-owned HTTP-only browser sessions. */
import { recordOperationalEvent } from '../../services/operationalTelemetry';
import {
  accessRequest, accessServiceUrl, advanceAuthSessionRevision, currentBrowserSession,
  getAuthSessionRevision, getCurrentSessionUser, isAccessReady, recordAuthSession,
  type AuthUser, type BrowserSession,
} from './client';

export type AuthChangeEvent = 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED' | 'USER_UPDATED';
interface AuthStateChange { event: AuthChangeEvent; user: AuthUser | null }
const listeners = new Set<(change: AuthStateChange) => void>();
let refresh: Promise<string | null> | null = null;
let channel: BroadcastChannel | null = null;

export class SessionUnavailableError extends Error {
  constructor(cause: unknown) {
    super('Sabah One could not reach its sign-in service to renew your session.', { cause });
    this.name = 'SessionUnavailableError';
  }
}
function notify(event: AuthChangeEvent): void {
  const user = getCurrentSessionUser();
  listeners.forEach(callback => callback({ event, user }));
}
function notifyOtherTabs(): void { channel?.postMessage('session-changed'); }
function observeOtherTabs(): void {
  if (channel || typeof BroadcastChannel === 'undefined') return;
  channel = new BroadcastChannel('helm:browser-session');
  channel.onmessage = () => {
    // Only an invalidation hint crosses tabs; user data and credentials never do.
    advanceAuthSessionRevision();
    void renewSession().catch(() => {});
  };
}
export async function signInWithGoogle(): Promise<void> {
  window.location.assign(accessServiceUrl('/signin'));
}
export async function signOut(): Promise<void> {
  if (!isAccessReady()) return;
  await accessRequest<void>('/signout', { method: 'POST' });
  advanceAuthSessionRevision();
  recordAuthSession(null);
  notify('SIGNED_OUT');
  notifyOtherTabs();
  recordOperationalEvent({ domain: 'auth', operation: 'session', outcome: 'changed', reason: 'signed_out' });
}
async function renewSession(): Promise<string | null> {
  const revision = getAuthSessionRevision();
  const previous = getCurrentSessionUser()?.id;
  let next: BrowserSession;
  try {
    next = await accessRequest<BrowserSession>('/session');
    if ((next.user && (typeof next.user.id !== 'string' || typeof next.accessToken !== 'string'
        || !Number.isFinite(Date.parse(next.expiresAt || '')))) || (!next.user && next.accessToken)) {
      throw new Error('Invalid sign-in service response.');
    }
  } catch (error) {
    throw new SessionUnavailableError(error);
  }
  if (revision !== getAuthSessionRevision()) return currentBrowserSession()?.accessToken ?? null;
  recordAuthSession(next);
  notify(!next.user ? 'SIGNED_OUT' : previous === next.user.id ? 'TOKEN_REFRESHED' : 'SIGNED_IN');
  return next.accessToken;
}
export async function getFreshAccessToken(options: { forceRefresh?: boolean } = {}): Promise<string | null> {
  if (!isAccessReady()) return null;
  const current = currentBrowserSession();
  if (!options.forceRefresh && current && (!current.user || Date.parse(current.expiresAt || '') > Date.now() + 60_000)) {
    return current.accessToken;
  }
  refresh ??= renewSession().finally(() => { refresh = null; });
  return refresh;
}
export async function getSessionUser(): Promise<AuthUser | null> {
  if (!isAccessReady()) return null;
  const delays = [0, 1000, 2000, 4000, 8000];
  let failure: unknown;
  for (const delay of delays) {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    try {
      await getFreshAccessToken({ forceRefresh: true });
      return getCurrentSessionUser();
    } catch (error) { failure = error; }
  }
  throw failure;
}
export function onAuthStateChange(callback: (change: AuthStateChange) => void): () => void {
  observeOtherTabs();
  listeners.add(callback);
  const recheck = () => {
    if (document.visibilityState === 'visible') void getFreshAccessToken({ forceRefresh: true }).catch(() => {});
  };
  window.addEventListener('focus', recheck);
  document.addEventListener('visibilitychange', recheck);
  return () => {
    listeners.delete(callback);
    window.removeEventListener('focus', recheck);
    document.removeEventListener('visibilitychange', recheck);
    if (!listeners.size) { channel?.close(); channel = null; }
  };
}
