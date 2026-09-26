/**
 * Typed calls to the calendar service (`/api/calendar/v1`), the system of record for calendar
 * accounts, calendars (sources) and events. It mirrors Google Calendar and writes changes to Google
 * first, so the browser never holds a Google credential.
 */
import { CALENDAR_BACKEND_URL } from '../../config';
import { API_TIMEOUT } from '../../config/constants';
import { newWriteKey } from './idempotencyKeys';
import { callService } from './serviceClient';
import {
  calendarAccountSchema,
  calendarEventListSchema,
  calendarEventSchema,
  calendarSchema,
  calendarSourceSchema,
  calendarSyncSchema,
  type ServiceCalendar,
  type ServiceCalendarAccount,
  type ServiceCalendarEvent,
  type ServiceCalendarSource,
  type ServiceCalendarSync,
} from './contracts';

const BASE = '/api/calendar/v1';
const WRITE = { timeoutMs: API_TIMEOUT.CALENDAR_WRITE } as const;

export function isCalendarServiceEnabled(): boolean {
  return Boolean(CALENDAR_BACKEND_URL.trim());
}

/** Every account and calendar, and the events overlapping the dates `from`..`to` (YYYY-MM-DD). */
export function getCalendar(from: string, to: string): Promise<ServiceCalendar> {
  return callService(CALENDAR_BACKEND_URL, 'GET', `${BASE}/calendar?${new URLSearchParams({ from, to })}`, calendarSchema);
}

export function listCalendarEvents(from: string, to: string): Promise<ServiceCalendarEvent[]> {
  return callService(CALENDAR_BACKEND_URL, 'GET', `${BASE}/events?${new URLSearchParams({ from, to })}`,
    calendarEventListSchema);
}

/** Mirrors Google now; per-account problems come back in the result, never as an error. */
export function syncCalendar(accountId?: string): Promise<ServiceCalendarSync> {
  const query = accountId ? `?${new URLSearchParams({ accountId })}` : '';
  return callService(CALENDAR_BACKEND_URL, 'POST', `${BASE}/sync${query}`, calendarSyncSchema, undefined,
    { timeoutMs: API_TIMEOUT.CALENDAR_SYNC });
}

export interface LocalAccountRequest {
  name: string;
  email?: string;
  paletteIndex?: number;
}

export function createLocalAccount(request: LocalAccountRequest): Promise<ServiceCalendarAccount> {
  return callService(CALENDAR_BACKEND_URL, 'POST', `${BASE}/accounts`, calendarAccountSchema, request,
    { idempotencyKey: newWriteKey(), ...WRITE });
}

/** Connects (or reconnects) a Google account from a consent-popup authorization code, then syncs it. */
export function connectGoogleAccount(
  code: string,
  redirectUri: string,
  expectedEmail?: string,
): Promise<ServiceCalendarAccount> {
  return callService(CALENDAR_BACKEND_URL, 'POST', `${BASE}/accounts/google`, calendarAccountSchema,
    { code, redirectUri, ...(expectedEmail ? { expectedEmail } : {}) }, { timeoutMs: API_TIMEOUT.CALENDAR_SYNC });
}

export interface AccountChanges {
  name?: string;
  primary?: boolean;
  paletteIndex?: number;
}

export function updateAccount(id: string, changes: AccountChanges): Promise<ServiceCalendarAccount> {
  return callService(CALENDAR_BACKEND_URL, 'PATCH', `${BASE}/accounts/${encodeURIComponent(id)}`,
    calendarAccountSchema, changes, { idempotencyKey: newWriteKey(), ...WRITE });
}

/** Deletes an account with its calendars and events; a Google account's credential is revoked. */
export function deleteAccount(id: string): Promise<void> {
  return callService(CALENDAR_BACKEND_URL, 'DELETE', `${BASE}/accounts/${encodeURIComponent(id)}`, null, undefined,
    { idempotencyKey: `calendar-account:delete:${id}`, ...WRITE });
}

export interface LocalSourceRequest {
  accountId: string;
  name: string;
  color: string;
  visible?: boolean;
}

export function createLocalSource(request: LocalSourceRequest): Promise<ServiceCalendarSource> {
  return callService(CALENDAR_BACKEND_URL, 'POST', `${BASE}/sources`, calendarSourceSchema, request,
    { idempotencyKey: newWriteKey(), ...WRITE });
}

export interface SourceChanges {
  name?: string;
  color?: string;
  visible?: boolean;
  accountId?: string;
}

export function updateSource(id: string, changes: SourceChanges): Promise<ServiceCalendarSource> {
  return callService(CALENDAR_BACKEND_URL, 'PATCH', `${BASE}/sources/${encodeURIComponent(id)}`,
    calendarSourceSchema, changes, { idempotencyKey: newWriteKey(), ...WRITE });
}

export function deleteSource(id: string): Promise<void> {
  return callService(CALENDAR_BACKEND_URL, 'DELETE', `${BASE}/sources/${encodeURIComponent(id)}`, null, undefined,
    { idempotencyKey: `calendar-source:delete:${id}`, ...WRITE });
}

/** `start`/`end` are ISO instants, or inclusive YYYY-MM-DD dates for all-day events. */
export interface EventRequest {
  sourceId: string;
  title: string;
  description: string;
  location?: string;
  allDay: boolean;
  start: string;
  end: string;
  /** The app's IANA time zone, which Google shows timed events in. */
  timeZone?: string;
}

export function createEvent(request: EventRequest): Promise<ServiceCalendarEvent> {
  return callService(CALENDAR_BACKEND_URL, 'POST', `${BASE}/events`, calendarEventSchema, request,
    { idempotencyKey: newWriteKey(), ...WRITE });
}

export function updateEvent(id: string, request: EventRequest): Promise<ServiceCalendarEvent> {
  return callService(CALENDAR_BACKEND_URL, 'PUT', `${BASE}/events/${encodeURIComponent(id)}`, calendarEventSchema,
    request, { idempotencyKey: newWriteKey(), ...WRITE });
}

export function deleteEvent(id: string): Promise<void> {
  return callService(CALENDAR_BACKEND_URL, 'DELETE', `${BASE}/events/${encodeURIComponent(id)}`, null, undefined,
    { idempotencyKey: `calendar-event:delete:${id}`, ...WRITE });
}
