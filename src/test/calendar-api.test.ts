import { afterEach, expect, it, vi } from 'vitest';

vi.mock('../config', () => ({ CALENDAR_BACKEND_URL: 'https://calendar.example.test/' }));

afterEach(() => {
  vi.unstubAllGlobals();
});

it('pings the Calendar liveness endpoint and reports the service as connected', async () => {
  vi.resetModules();
  const { checkCalendarBackendHealth } = await import('../services/calendarApi');
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ status: 'UP', service: 'calendar-service' }));
  vi.stubGlobal('fetch', fetchMock);

  expect(await checkCalendarBackendHealth()).toEqual({ status: 'connected' });
  expect(fetchMock).toHaveBeenCalledWith(
    'https://calendar.example.test/api/calendar/health',
    expect.objectContaining({ method: 'GET', headers: { Accept: 'application/json' } }),
  );
});

it('reports an unavailable Calendar liveness endpoint', async () => {
  vi.resetModules();
  const { checkCalendarBackendHealth } = await import('../services/calendarApi');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));

  expect(await checkCalendarBackendHealth()).toEqual({ status: 'unavailable', detail: 'HTTP 503.' });
});

it('pings the Calendar database endpoint once per page load', async () => {
  vi.resetModules();
  const { checkCalendarDatabaseHealth } = await import('../services/calendarApi');
  const fetchMock = vi.fn().mockResolvedValue(Response.json({
    status: 'UP',
    service: 'calendar-service',
    database: 'UP',
  }));
  vi.stubGlobal('fetch', fetchMock);

  const results = await Promise.all([checkCalendarDatabaseHealth(), checkCalendarDatabaseHealth()]);

  expect(results).toEqual([{ status: 'connected' }, { status: 'connected' }]);
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(fetchMock).toHaveBeenCalledWith(
    'https://calendar.example.test/api/calendar/health/database',
    expect.objectContaining({ method: 'GET', headers: { Accept: 'application/json' } }),
  );
});

it('reports a failed Calendar database health response', async () => {
  vi.resetModules();
  const { checkCalendarDatabaseHealth } = await import('../services/calendarApi');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));

  expect(await checkCalendarDatabaseHealth()).toEqual({ status: 'unavailable', detail: 'HTTP 503.' });
});
