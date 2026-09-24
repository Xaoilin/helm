import { PRAYER_BACKEND_URL } from '../config';
import { API_TIMEOUT } from '../config/constants';

export type PrayerBackendHealthCheck =
  | { status: 'not_configured' }
  | { status: 'connected' }
  | { status: 'unavailable'; detail: string };

type HealthPayload = { status?: unknown };

/** Checks only the public Spring Boot health endpoint; it sends no user data or credentials. */
export async function checkPrayerBackendHealth(): Promise<PrayerBackendHealthCheck> {
  const baseUrl = PRAYER_BACKEND_URL.trim().replace(/\/+$/, '');
  if (!baseUrl) return { status: 'not_configured' };

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/prayer/health`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(API_TIMEOUT.PRAYER_BACKEND_HEALTH),
    });
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
    return {
      status: 'unavailable',
      detail: timedOut ? 'Request timed out.' : 'Request failed; check service availability and browser access.',
    };
  }

  if (!response.ok) return { status: 'unavailable', detail: `HTTP ${response.status}.` };

  let payload: HealthPayload;
  try {
    payload = await response.json() as HealthPayload;
  } catch {
    return { status: 'unavailable', detail: 'The health endpoint returned invalid JSON.' };
  }

  if (payload?.status !== 'UP') {
    return { status: 'unavailable', detail: 'The health endpoint did not report UP.' };
  }

  return { status: 'connected' };
}
