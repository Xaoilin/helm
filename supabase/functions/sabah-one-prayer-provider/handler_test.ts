import assert from 'node:assert/strict';
import { createPrayerProviderHandler } from './handler.ts';

const path = 'https://project.supabase.co/functions/v1/provider/timingsByCity/25-10-2026?city=London&country=United%20Kingdom&method=0';
const token = 'synthetic-product-specific-token';
function request(url = path, authorization = `Bearer ${token}`, method = 'GET') {
  return new Request(url, { method, headers: { Authorization: authorization } });
}

Deno.test('requires configuration and the product-specific bearer before any upstream call', async () => {
  let calls = 0;
  const upstream: typeof fetch = async () => { calls++; return new Response('{}'); };
  assert.equal((await createPrayerProviderHandler('', upstream)(request())).status, 503);
  const handle = createPrayerProviderHandler(token, upstream);
  assert.equal((await handle(request(path, ''))).status, 401);
  assert.equal((await handle(request(path, 'Bearer another-product-token'))).status, 401);
  assert.equal(calls, 0);
});

Deno.test('only forwards the existing GET timings-by-city contract', async () => {
  let calls = 0;
  const upstream: typeof fetch = async () => { calls++; return new Response('{}'); };
  const handle = createPrayerProviderHandler(token, upstream);
  assert.equal((await handle(request(path, `Bearer ${token}`, 'POST'))).status, 405);
  assert.equal((await handle(request('https://project.test/arbitrary'))).status, 404);
  assert.equal((await handle(request(path.replace('&method=0', '')))).status, 400);
  assert.equal(calls, 0);
});

Deno.test('preserves provider JSON without forwarding the private relay credential', async () => {
  const payload = JSON.stringify({ code: 200, data: { timings: { Fajr: '05:12' } } });
  const upstream: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://api.aladhan.com');
    assert.equal(url.pathname, '/v1/timingsByCity/25-10-2026');
    assert.equal(url.searchParams.get('country'), 'United Kingdom');
    assert.equal(url.searchParams.get('method'), '0');
    assert.equal(new Headers(init?.headers).get('authorization'), null);
    assert.equal(init?.redirect, 'error');
    return new Response(payload, { status: 200 });
  };
  const response = await createPrayerProviderHandler(token, upstream)(request());
  assert.equal(response.status, 200);
  assert.equal(await response.text(), payload);
});

Deno.test('preserves provider errors and reports an unavailable connection truthfully', async () => {
  const limited: typeof fetch = async () => new Response('{}', { status: 429 });
  assert.equal((await createPrayerProviderHandler(token, limited)(request())).status, 429);
  const failed: typeof fetch = async () => { throw new Error('synthetic network failure'); };
  const response = await createPrayerProviderHandler(token, failed)(request());
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { code: 'schedule_provider_unavailable' });
});
