import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config', async importOriginal => ({
  ...await importOriginal<typeof import('../config')>(),
  PROFILE_BACKEND_URL: 'https://profile.test/',
}));

import { getSessionUser, initAccessService } from '../store/supabase';
import {
  configureOperationalTransport,
  flushOperationalEvents,
  getOperationalSnapshot,
  recordOperationalEvent,
  setOperationalAccount,
} from '../services/operationalTelemetry';

const session = {
  accessToken: 'synthetic-current-token', expiresAt: new Date(Date.now() + 600_000).toISOString(),
  user: { id: 'synthetic-account' },
};

describe('native identity operational boundaries', () => {
  beforeEach(() => {
    setOperationalAccount(null);
    configureOperationalTransport(null);
  });

  afterEach(() => {
    initAccessService('');
    setOperationalAccount(null);
    configureOperationalTransport(null);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uses the current session, keepalive, exact batch body, and rejects an invalid success receipt permanently', async () => {
    const fetcher = vi.fn(async (url: string) => Response.json(url.endsWith('/session') ? session : { ok: true, accepted: 999, schemaVersion: 1 }));
    vi.stubGlobal('fetch', fetcher);
    initAccessService('https://api.sabah.example/api/access');
    await getSessionUser();
    fetcher.mockClear();
    recordOperationalEvent({ domain: 'database', operation: 'read', outcome: 'ok', freshness: 'fresh' });

    await flushOperationalEvents();

    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://profile.test/api/profile/v1/operational-events');
    expect(init).toMatchObject({ method: 'POST', keepalive: true, signal: expect.any(AbortSignal) });
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer synthetic-current-token' });
    const body = JSON.parse(String(init.body));
    expect(body.events.length).toBeGreaterThan(0);
    expect(JSON.stringify(body)).not.toMatch(/synthetic-account|synthetic-current-token/);
    expect(getOperationalSnapshot()).toMatchObject({ sink: 'unavailable', sinkReason: 'invalid_response', pending: 0 });
  });
});
