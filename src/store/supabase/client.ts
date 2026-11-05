/** Product-owned browser session; access tokens are held only in memory. */
import { independentEndpoint } from '../../config/nativeIdentity';
import { configureOperationalTransport, setOperationalAccount } from '../../services/operationalTelemetry';
import { operationalEventsUrl } from '../../services/backend/profileServiceApi';
import { operationalReceiptSchema } from '../../services/backend/contracts';

export interface AuthUser {
  id: string;
  email?: string;
  user_metadata?: { full_name?: string };
}
export interface BrowserSession {
  user: AuthUser | null;
  accessToken: string | null;
  expiresAt: string | null;
}
let endpoint = '';
let session: BrowserSession | null = null;
let revision = 0;

export function initAccessService(url: string): void {
  revision += 1;
  endpoint = url ? independentEndpoint(url).replace(/\/$/, '') : '';
  session = null;
  setOperationalAccount(null);
  const collector = operationalEventsUrl();
  configureOperationalTransport(endpoint && collector ? async (events, signal) => {
    const { getFreshAccessToken } = await import('./auth');
    const token = await getFreshAccessToken();
    if (!token) throw Object.assign(new Error('Sign-in is required.'), { status: 401 });
    const response = await fetch(collector, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ events }), signal, keepalive: true,
    });
    if (!response.ok) throw Object.assign(new Error('Operational collection unavailable.'), { status: response.status });
    const receipt = operationalReceiptSchema.safeParse(await response.json().catch(() => null));
    if (!receipt.success || receipt.data.accepted !== events.length) {
      throw Object.assign(new Error('Operational collection returned an invalid receipt.'), { code: 'invalid_response' });
    }
  } : null);
}
export function isAccessReady(): boolean { return Boolean(endpoint); }
export function accessServiceUrl(path = ''): string {
  if (!endpoint) throw new Error('Sabah One sign-in is not configured.');
  return endpoint + path;
}
export function getAuthSessionRevision(): number { return revision; }
export function advanceAuthSessionRevision(): void { revision += 1; }
export function currentBrowserSession(): BrowserSession | null { return session; }
export function getCurrentSessionUser(): AuthUser | null { return session?.user ?? null; }
export function recordAuthSession(next: BrowserSession | null): void {
  session = next;
  setOperationalAccount(next?.user?.id ?? null);
}
export function getAuthSessionSnapshot() {
  if (!session?.user) return null;
  return {
    userId: session.user.id, email: session.user.email ?? null,
    accessTokenPresent: Boolean(session.accessToken), providerToken: null, providerRefreshToken: null,
    provider: 'google', expiresAt: session.expiresAt ? Date.parse(session.expiresAt) / 1000 : null,
  };
}

/** A browser cookie and synchronizer CSRF token protect every account/consent management write. */
export async function accessRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  const method = options.method || 'GET';
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const csrf = await accessRequest<{ headerName: string; token: string }>('/csrf');
    headers.set(csrf.headerName, csrf.token);
  }
  const response = await fetch(accessServiceUrl(path), { ...options, headers, credentials: 'include', cache: 'no-store' });
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { message?: string } | null;
    throw Object.assign(new Error(error?.message || 'Sabah One could not complete this request.'), { status: response.status });
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}
