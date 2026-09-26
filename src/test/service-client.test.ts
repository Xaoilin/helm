import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { callService, resetServiceCircuits, ServiceError } from '../services/backend/serviceClient';
import { preferencesSchema } from '../services/backend/contracts';

const auth = vi.hoisted(() => ({
  token: 'user-access-token' as string | null,
  renewed: 'renewed-access-token' as string | null,
  renewals: 0,
  unreachable: false,
}));
vi.mock('../store/supabase', () => {
  class SessionUnavailableError extends Error {}
  return {
    SessionUnavailableError,
    getFreshAccessToken: async ({ forceRefresh = false }: { forceRefresh?: boolean } = {}) => {
      if (!forceRefresh) return auth.token;
      auth.renewals += 1;
      if (auth.unreachable) throw new SessionUnavailableError('unreachable');
      return auth.renewed;
    },
  };
});

beforeEach(() => {
  resetServiceCircuits();
  auth.token = 'user-access-token';
  auth.renewed = 'renewed-access-token';
  auth.renewals = 0;
  auth.unreachable = false;
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Runs a call to completion, letting its backoff waits pass instantly. */
async function settle<T>(call: Promise<T>): Promise<T> {
  const result = call.then(value => ({ value }), (error: unknown) => ({ error }));
  await vi.runAllTimersAsync();
  const outcome = await result;
  if ('error' in outcome) throw outcome.error;
  return outcome.value;
}

it('sends the signed-in user token and parses the response through its contract', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json({ enabled: true, reminderEnabled: false, reminderMinutes: 15 }));

  const preferences = await callService('https://svc.test/', 'PUT', '/api/prayer/v1/preferences', preferencesSchema,
    { enabled: true, reminderEnabled: false, reminderMinutes: 15 });

  expect(preferences).toEqual({ enabled: true, reminderEnabled: false, reminderMinutes: 15 });
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe('https://svc.test/api/prayer/v1/preferences');
  expect(init).toMatchObject({
    method: 'PUT',
    headers: { Authorization: 'Bearer user-access-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: true, reminderEnabled: false, reminderMinutes: 15 }),
  });
  expect(init?.signal).toBeInstanceOf(AbortSignal);
});

it('names a write with its idempotency key', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));

  await callService('https://svc.test', 'DELETE', '/api/prayer/v1/outcomes/1', null, undefined,
    { idempotencyKey: 'prayer-outcome:delete:1' });

  expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ 'Idempotency-Key': 'prayer-outcome:delete:1' });
});

it('sends no idempotency key when none is given', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json({ enabled: true, reminderEnabled: false, reminderMinutes: 15 }));

  await callService('https://svc.test', 'GET', '/api/prayer/v1/preferences', preferencesSchema);

  expect(fetchMock.mock.calls[0][1]?.headers).not.toHaveProperty('Idempotency-Key');
});

it('never calls a service without a signed-in user', async () => {
  auth.token = null;
  const fetchMock = vi.spyOn(globalThis, 'fetch');

  await expect(callService('https://svc.test', 'GET', '/x', preferencesSchema))
    .rejects.toMatchObject({ code: 'not_signed_in' });
  expect(fetchMock).not.toHaveBeenCalled();
});

it('surfaces the service error code and message', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json({ code: 'outcome_exists', message: 'Dhuhr is already recorded.' }, { status: 409 }));

  const error = await callService('https://svc.test', 'POST', '/x', preferencesSchema, {}).catch(e => e);

  expect(error).toBeInstanceOf(ServiceError);
  expect(error).toMatchObject({ status: 409, code: 'outcome_exists', message: 'Dhuhr is already recorded.' });
});

it('rejects a response that breaks the contract instead of using it', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ enabled: 'yes' }));

  await expect(callService('https://svc.test', 'GET', '/api/prayer/v1/preferences', preferencesSchema))
    .rejects.toMatchObject({ code: 'contract_violation' });
});

it('reports unreachable services and timeouts once a write without a key has been tried once', async () => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'));

  await expect(callService('https://svc.test', 'POST', '/x', null)).rejects.toMatchObject({ code: 'network' });
  await expect(callService('https://svc.test', 'POST', '/x', null)).rejects.toMatchObject({ code: 'timeout' });
});

it('retries a read that failed transiently, with growing jittered waits', async () => {
  vi.useFakeTimers();
  const waits: number[] = [];
  const realSetTimeout = globalThis.setTimeout;
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((handler: () => void, ms?: number) => {
    waits.push(ms ?? 0);
    return realSetTimeout(handler, ms);
  }) as typeof setTimeout);
  vi.spyOn(Math, 'random').mockReturnValue(1);
  const fetchMock = vi.spyOn(globalThis, 'fetch')
    .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockResolvedValueOnce(Response.json({ code: 'database_unavailable', message: 'Down.' }, { status: 503 }))
    .mockResolvedValueOnce(Response.json({ enabled: true, reminderEnabled: false, reminderMinutes: 15 }));

  await expect(settle(callService('https://svc.test', 'GET', '/p', preferencesSchema)))
    .resolves.toMatchObject({ enabled: true });
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(waits.filter(ms => ms >= 500)).toEqual([500, 1000]);
});

it('retries a keyed write, never a write without a key, and never a client error', async () => {
  vi.useFakeTimers();
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    Response.json({ code: 'write_timeout', message: 'Not confirmed.' }, { status: 503 }));

  await expect(settle(callService('https://svc.test', 'PUT', '/a', null, {}, { idempotencyKey: 'k' })))
    .rejects.toMatchObject({ status: 503 });
  expect(fetchMock).toHaveBeenCalledTimes(4);

  resetServiceCircuits();
  fetchMock.mockClear();
  await expect(settle(callService('https://svc.test', 'POST', '/b', null, {}))).rejects.toMatchObject({ status: 503 });
  expect(fetchMock).toHaveBeenCalledTimes(1);

  fetchMock.mockClear();
  fetchMock.mockImplementation(async () => Response.json({ code: 'invalid_request', message: 'Bad.' }, { status: 400 }));
  await expect(settle(callService('https://svc.test', 'GET', '/c', null))).rejects.toMatchObject({ status: 400 });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('waits at least as long as the service asks with Retry-After', async () => {
  vi.useFakeTimers();
  const waits: number[] = [];
  const realSetTimeout = globalThis.setTimeout;
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((handler: () => void, ms?: number) => {
    waits.push(ms ?? 0);
    return realSetTimeout(handler, ms);
  }) as typeof setTimeout);
  vi.spyOn(Math, 'random').mockReturnValue(0);
  vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(Response.json({ code: 'rate_limited', message: 'Slow down.' },
      { status: 429, headers: { 'Retry-After': '3' } }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));

  await settle(callService('https://svc.test', 'GET', '/r', null));
  expect(waits).toContain(3000);
});

it('stops calling a failing service for a while instead of hammering it', async () => {
  vi.useFakeTimers();
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    Response.json({ code: 'database_unavailable', message: 'Down.' }, { status: 503 }));

  // Four attempts for the first read, then one more failure opens the circuit.
  await expect(settle(callService('https://svc.test', 'GET', '/d', null))).rejects.toMatchObject({ status: 503 });
  await expect(settle(callService('https://svc.test', 'GET', '/d', null))).rejects.toMatchObject({ status: 503 });
  const callsWhenOpened = fetchMock.mock.calls.length;
  await expect(settle(callService('https://svc.test', 'GET', '/d', null)))
    .rejects.toMatchObject({ status: 503, code: 'service_unavailable' });
  expect(fetchMock.mock.calls.length).toBe(callsWhenOpened);

  // After the cool-down one call is let through again.
  fetchMock.mockImplementation(async () => new Response(null, { status: 204 }));
  vi.advanceTimersByTime(30_000);
  await settle(callService('https://svc.test', 'GET', '/d', null));
  expect(fetchMock.mock.calls.length).toBe(callsWhenOpened + 1);
});

it('renews the session once and retries when a token is rejected, keeping the idempotency key', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(new Response(null, { status: 401 }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));

  await callService('https://svc.test', 'DELETE', '/x', null, undefined, { idempotencyKey: 'delete-1' });

  expect(auth.renewals).toBe(1);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[1][1]?.headers).toMatchObject({
    Authorization: 'Bearer renewed-access-token',
    'Idempotency-Key': 'delete-1',
  });
});

it('reports a rejected renewed token as unauthorized after one retry, without looping', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json(
    { code: 'invalid_token', message: 'Rejected.' }, { status: 401 }));

  await expect(callService('https://svc.test', 'GET', '/x', null)).rejects.toMatchObject({ status: 401 });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('treats an unreachable auth server as a transient failure, not a sign-out', async () => {
  vi.useFakeTimers();
  auth.unreachable = true;
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 401 }));

  await expect(settle(callService('https://svc.test', 'GET', '/x', null)))
    .rejects.toMatchObject({ status: 0, code: 'session_unavailable' });
});
