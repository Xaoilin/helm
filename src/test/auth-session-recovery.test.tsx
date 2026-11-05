import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthSessionProvider, useAuthSession } from '../store/AuthSessionContext';
import { getAuthSessionSnapshot, initAccessService, type BrowserSession } from '../store/supabase/client';
import { getFreshAccessToken, getSessionUser, SessionUnavailableError, signOut } from '../store/supabase/auth';

function session(id: string): BrowserSession {
  return { user: { id }, accessToken: `synthetic-${id}`, expiresAt: new Date(Date.now() + 600_000).toISOString() };
}
const signedOut = { user: null, accessToken: null, expiresAt: null };
describe('native browser session recovery', () => {
  beforeEach(() => { initAccessService('https://api.sabah.example/api/access'); });
  afterEach(() => { cleanup(); initAccessService(''); vi.unstubAllGlobals(); vi.useRealTimers(); });
  it('uses the HTTP-only session cookie and never persists access or refresh tokens in browser storage', async () => {
    const fetcher = vi.fn(async () => Response.json(session('account')));
    vi.stubGlobal('fetch', fetcher);
    await expect(getFreshAccessToken()).resolves.toBe('synthetic-account');
    expect(fetcher.mock.calls[0]).toEqual(['https://api.sabah.example/api/access/session', expect.objectContaining({ credentials: 'include', cache: 'no-store' })]);
    expect(JSON.stringify(localStorage)).not.toContain('synthetic-account');
    expect(JSON.stringify(sessionStorage)).not.toContain('synthetic-account');
  });
  it('renews a sleeping tab before sending an expired token and coalesces concurrent renewal', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ ...session('account'), expiresAt: new Date(Date.now() + 1000).toISOString() }))
      .mockResolvedValueOnce(Response.json({ ...session('account'), accessToken: 'renewed' }));
    vi.stubGlobal('fetch', fetcher);
    await getFreshAccessToken();
    expect(await Promise.all([getFreshAccessToken(), getFreshAccessToken()])).toEqual(['renewed', 'renewed']);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('keeps a valid account during an auth-service outage', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(session('account'))).mockRejectedValue(new TypeError('offline'));
    vi.stubGlobal('fetch', fetcher);
    await getFreshAccessToken();
    await expect(getFreshAccessToken({ forceRefresh: true })).rejects.toBeInstanceOf(SessionUnavailableError);
    expect(getAuthSessionSnapshot()?.userId).toBe('account');
  });
  it('keeps sign-out when an older session read completes afterwards', async () => {
    let complete!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.endsWith('/csrf')) return Promise.resolve(Response.json({ headerName: 'X-CSRF-TOKEN', token: 'synthetic-csrf' }));
      if (url.endsWith('/signout')) return Promise.resolve(new Response(null, { status: 204 }));
      return new Promise<Response>(resolve => { complete = resolve; });
    }));
    const { result } = renderHook(useAuthSession, { wrapper: AuthSessionProvider });
    await act(async () => { await signOut(); });
    const key = result.current.sessionKey;
    await act(async () => { complete(Response.json(session('old-account'))); });
    expect(result.current.authUser).toBeNull();
    expect(result.current.sessionKey).toBe(key);
    expect(getAuthSessionSnapshot()).toBeNull();
  });
  it('bootstraps genuine signed-out sessions without retrying or opening account providers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(signedOut)));
    const { result } = renderHook(useAuthSession, { wrapper: AuthSessionProvider });
    await waitFor(() => expect(result.current.bootstrapped).toBe(true));
    expect(result.current.authUser).toBeNull();
    expect(result.current.sessionUnavailable).toBe(false);
  });
  it('offers retry after bounded startup failures instead of pretending the account signed out', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    const pending = expect(getSessionUser()).rejects.toBeInstanceOf(SessionUnavailableError);
    await vi.runAllTimersAsync();
    await pending;
  });
});
