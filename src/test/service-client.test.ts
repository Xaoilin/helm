import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { callService, ServiceError } from '../services/backend/serviceClient';
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
  auth.token = 'user-access-token';
  auth.renewed = 'renewed-access-token';
  auth.renewals = 0;
  auth.unreachable = false;
});
afterEach(() => vi.restoreAllMocks());

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

it('reports unreachable services and timeouts', async () => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'));

  await expect(callService('https://svc.test', 'GET', '/x', null)).rejects.toMatchObject({ code: 'network' });
  await expect(callService('https://svc.test', 'GET', '/x', null)).rejects.toMatchObject({ code: 'timeout' });
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
  auth.unreachable = true;
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 401 }));

  await expect(callService('https://svc.test', 'GET', '/x', null))
    .rejects.toMatchObject({ status: 0, code: 'session_unavailable' });
});
