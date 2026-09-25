import { CALENDAR_BACKEND_URL } from '../config';
import { API_TIMEOUT } from '../config/constants';

export type CalendarBackendHealthCheck =
  | { status: 'not_configured' }
  | { status: 'connected' }
  | { status: 'unavailable'; detail: string };

type HealthPayload = { status?: unknown };
type DatabaseHealthPayload = { status?: unknown; database?: unknown };

let calendarDatabaseHealthRequest: Promise<CalendarBackendHealthCheck> | undefined;

/** Checks the public Calendar Spring Boot liveness endpoint without user data or credentials. */
export async function checkCalendarBackendHealth(): Promise<CalendarBackendHealthCheck> {
  const baseUrl = CALENDAR_BACKEND_URL.trim().replace(/\/+$/, '');
  if (!baseUrl) return { status: 'not_configured' };

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/calendar/health`, {
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

/** Performs at most one Calendar database probe per page load, including React StrictMode remounts. */
export function checkCalendarDatabaseHealth(): Promise<CalendarBackendHealthCheck> {
  calendarDatabaseHealthRequest ??= requestCalendarDatabaseHealth();
  return calendarDatabaseHealthRequest;
}

async function requestCalendarDatabaseHealth(): Promise<CalendarBackendHealthCheck> {
  const baseUrl = CALENDAR_BACKEND_URL.trim().replace(/\/+$/, '');
  if (!baseUrl) return { status: 'not_configured' };

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/calendar/health/database`, {
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

  let payload: DatabaseHealthPayload;
  try {
    payload = await response.json() as DatabaseHealthPayload;
  } catch {
    return { status: 'unavailable', detail: 'The database health endpoint returned invalid JSON.' };
  }

  if (payload?.status !== 'UP' || payload?.database !== 'UP') {
    return { status: 'unavailable', detail: 'The database health endpoint did not report UP.' };
  }

  return { status: 'connected' };
}
