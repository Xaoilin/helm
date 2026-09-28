import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => {
    return {
      auth: {
        getSession: mocks.getSession,
        onAuthStateChange: mocks.onAuthStateChange,
        signOut: vi.fn(async () => ({ error: null })),
      },
      rpc: mocks.rpc,
      from: mocks.from,
    };
  },
}));

vi.mock('../config', async importOriginal => ({
  ...await importOriginal<typeof import('../config')>(),
  PROFILE_BACKEND_URL: 'https://profile.test/',
}));

import { getSessionUser, initSupabase } from '../store/supabase';
import {
  configureOperationalTransport,
  flushOperationalEvents,
  getOperationalSnapshot,
  recordOperationalEvent,
  setOperationalAccount,
} from '../services/operationalTelemetry';

const session = {
  access_token: 'synthetic-current-token',
  user: { id: 'synthetic-account', app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '' },
};

describe('Supabase operational boundaries', () => {
  beforeEach(() => {
    mocks.getSession.mockReset().mockResolvedValue({ data: { session }, error: null });
    mocks.onAuthStateChange.mockReset().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
    mocks.rpc.mockReset();
    mocks.from.mockReset();
    setOperationalAccount(null);
    configureOperationalTransport(null);
  });

  afterEach(() => {
    initSupabase('', '');
    setOperationalAccount(null);
    configureOperationalTransport(null);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uses the current session, keepalive, exact batch body, and rejects an invalid success receipt permanently', async () => {
    const fetcher = vi.fn(async () => Response.json({ ok: true, accepted: 999, schemaVersion: 1 }));
    vi.stubGlobal('fetch', fetcher);
    initSupabase('https://project.supabase.test', 'public-key');
    await getSessionUser();
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
