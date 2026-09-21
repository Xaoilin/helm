import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createOptions: null as Record<string, unknown> | null,
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: (_url: string, _key: string, options: Record<string, unknown>) => {
    mocks.createOptions = options;
    return {
      auth: {
        getSession: mocks.getSession,
        onAuthStateChange: mocks.onAuthStateChange,
        signOut: vi.fn(async () => ({ error: null })),
      },
      realtime: { setAuth: vi.fn(async () => {}) },
      rpc: mocks.rpc,
      from: mocks.from,
    };
  },
}));

import {
  fetchHelmAccountSnapshot,
  getSessionUser,
  initSupabase,
} from '../store/supabase';
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
    mocks.createOptions = null;
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
    expect(url).toBe('https://project.supabase.test/functions/v1/operational-events');
    expect(init).toMatchObject({ method: 'POST', keepalive: true, signal: expect.any(AbortSignal) });
    expect(init.headers).toMatchObject({ apikey: 'public-key', Authorization: 'Bearer synthetic-current-token' });
    const body = JSON.parse(String(init.body));
    expect(body.events.length).toBeGreaterThan(0);
    expect(JSON.stringify(body)).not.toMatch(/synthetic-account|synthetic-current-token/);
    expect(getOperationalSnapshot()).toMatchObject({ sink: 'unavailable', sinkReason: 'invalid_response', pending: 0 });
  });

  it('passes a bounded abort signal to a held account snapshot query', async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    let suppliedSignal: AbortSignal | null = null;
    mocks.rpc.mockReturnValue({
      abortSignal: (signal: AbortSignal) => {
        suppliedSignal = signal;
        return new Promise(resolve => signal.addEventListener('abort', () => resolve({
          data: null,
          error: new DOMException('aborted', 'AbortError'),
        }), { once: true }));
      },
    });
    initSupabase('https://project.supabase.test', 'public-key');
    await getSessionUser();

    const pending = fetchHelmAccountSnapshot();
    await Promise.resolve();
    expect(suppliedSignal).toBe(controller.signal);
    expect(timeout).toHaveBeenCalledWith(10_000);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('maps installed Supabase heartbeat callback states without exposing SDK payloads', async () => {
    initSupabase('https://project.supabase.test', 'public-key');
    await getSessionUser();
    const heartbeat = (mocks.createOptions?.realtime as { heartbeatCallback: (status: string, latency?: number) => void }).heartbeatCallback;

    heartbeat('sent');
    heartbeat('timeout');
    heartbeat('ok', 12);

    expect(getOperationalSnapshot().events.slice(-3).map(event => ({ outcome: event.outcome, reason: event.reason }))).toEqual([
      { outcome: 'pending', reason: 'heartbeat_sent' },
      { outcome: 'failed', reason: 'heartbeat_timeout' },
      { outcome: 'recovered', reason: 'heartbeat_ok' },
    ]);
  });
});
