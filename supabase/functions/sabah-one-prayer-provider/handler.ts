import { timingSafeEqual } from 'node:crypto';

/** A private, data-only network relay; it never receives or uses account credentials. */
export function createPrayerProviderHandler(token: string, upstreamFetch: typeof fetch = fetch) {
  const encoder = new TextEncoder();
  return async (request: Request): Promise<Response> => {
    if (!token) return Response.json({ code: 'provider_not_configured' }, { status: 503 });
    const supplied = encoder.encode(request.headers.get('authorization') || '');
    const expected = encoder.encode(`Bearer ${token}`);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      return Response.json({ code: 'unauthorized' }, { status: 401 });
    }
    if (request.method !== 'GET') return new Response(null, { status: 405 });
    const url = new URL(request.url);
    const date = url.pathname.match(/\/timingsByCity\/(\d{2}-\d{2}-\d{4})$/u)?.[1];
    if (!date) return new Response(null, { status: 404 });
    const city = url.searchParams.get('city');
    const country = url.searchParams.get('country');
    const method = url.searchParams.get('method');
    if (!city || !country || !method || !/^\d{1,2}$/u.test(method)) {
      return Response.json({ code: 'invalid_location' }, { status: 400 });
    }
    const upstream = new URL(`https://api.aladhan.com/v1/timingsByCity/${date}`);
    upstream.search = new URLSearchParams({ city, country, method }).toString();
    try {
      const response = await upstreamFetch(upstream, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(5_000),
        redirect: 'error',
      });
      return new Response(response.body, {
        status: response.status,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    } catch {
      return Response.json({ code: 'schedule_provider_unavailable' }, { status: 502 });
    }
  };
}
