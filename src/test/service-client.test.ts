import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { callService, ServiceError } from '../services/backend/serviceClient';
import { preferencesSchema } from '../services/backend/contracts';

const auth = vi.hoisted(() => ({ token: 'user-access-token' as string | null }));
vi.mock('../store/supabase', () => ({ getCurrentAccessToken: () => auth.token }));

beforeEach(() => { auth.token = 'user-access-token'; });
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
