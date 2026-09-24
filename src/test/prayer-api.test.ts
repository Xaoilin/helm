import { afterEach, expect, it, vi } from 'vitest';
import { checkPrayerBackendHealth } from '../services/prayerApi';

vi.mock('../config', () => ({ PRAYER_BACKEND_URL: 'https://prayer.example.test/' }));

afterEach(() => vi.restoreAllMocks());

it('makes a bounded, credential-free GET to the prayer health endpoint', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ status: 'UP', service: 'prayer-service' }));

  expect(await checkPrayerBackendHealth()).toEqual({ status: 'connected' });
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(fetchMock.mock.calls[0][0]).toBe('https://prayer.example.test/api/prayer/health');
  expect(fetchMock.mock.calls[0][1]).toMatchObject({
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  expect(fetchMock.mock.calls[0][1]).not.toHaveProperty('credentials');
  expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
});

it('reports HTTP errors with status detail', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 503 }));

  expect(await checkPrayerBackendHealth()).toEqual({ status: 'unavailable', detail: 'HTTP 503.' });
});

it('rejects successful responses that do not identify an UP service', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ status: 'DOWN' }));

  expect(await checkPrayerBackendHealth()).toEqual({ status: 'unavailable', detail: 'The health endpoint did not report UP.' });
});

it('returns a useful diagnostic when the request fails', async () => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));

  expect(await checkPrayerBackendHealth()).toEqual({
    status: 'unavailable',
    detail: 'Request failed; check service availability and browser access.',
  });
});
