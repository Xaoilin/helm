// Google Calendar REST API v3 wrapper
// No SDK dependency — uses native fetch

import { API_TIMEOUT } from '../config/constants';
import { getZonedDate, shiftIsoDate, validateIanaTimeZone } from './timeZone';
import { googleCalendarBreaker } from './serviceBreakers';
import { withRetry } from './retry';

const BASE_URL = 'https://www.googleapis.com/calendar/v3';

export class GoogleApiError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string, message: string) {
    super(message);
    this.name = 'GoogleApiError';
    this.status = status;
    this.body = body;
  }
  get isAuthError(): boolean { return this.status === 401; }
  get isForbidden(): boolean { return this.status === 403; }
  get isRateLimit(): boolean { return this.status === 429; }
  get isTransientServiceError(): boolean { return this.status >= 500 || this.status === 429; }
}

export function shouldGoogleCalendarBreakerRecordFailure(error: unknown): boolean {
  if (error instanceof GoogleApiError) {
    return error.isTransientServiceError;
  }

  if (error instanceof TypeError) {
    return true;
  }

  if (error instanceof DOMException && error.name === 'AbortError') {
    return false;
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return message.includes('network')
      || message.includes('failed to fetch')
      || message.includes('503')
      || message.includes('502')
      || message.includes('504')
      || message.includes('429');
  }

  return false;
}

async function apiCall<T>(accessToken: string, url: string, options: RequestInit = {}): Promise<T> {
  return googleCalendarBreaker.call(() => withRetry(async () => {
    const response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(API_TIMEOUT.GOOGLE_CALENDAR),
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new GoogleApiError(
        response.status,
        body,
        `Google API ${response.status}: ${response.statusText}`,
      );
    }

    if (response.status === 204) return undefined as T;
    return response.json();
  }, { name: 'GoogleCalendar', maxRetries: 2, initialDelayMs: 1000 }), {
    shouldRecordFailure: shouldGoogleCalendarBreakerRecordFailure,
  });
}

// ── Calendar List ──

export interface GoogleCalendarListEntry {
  id: string;
  summary: string;
  description?: string;
  backgroundColor?: string;
  foregroundColor?: string;
  primary?: boolean;
  accessRole: string;
  selected?: boolean;
}

interface CalendarListResponse {
  items: GoogleCalendarListEntry[];
  nextPageToken?: string;
}

export async function fetchCalendarList(accessToken: string): Promise<GoogleCalendarListEntry[]> {
  const data = await apiCall<CalendarListResponse>(
    accessToken,
    `${BASE_URL}/users/me/calendarList?minAccessRole=reader`,
  );
  return data.items || [];
}

// ── Events ──

export interface GoogleEventDateTime {
  dateTime?: string;
  date?: string;
  timeZone?: string;
}

export interface GoogleCalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  start: GoogleEventDateTime;
  end: GoogleEventDateTime;
  status?: string;
  htmlLink?: string;
  updated?: string;
  created?: string;
}

interface EventsListResponse {
  items: GoogleCalendarEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

export async function fetchEvents(
  accessToken: string,
  calendarId: string,
  timeMin: string,
  timeMax: string,
): Promise<GoogleCalendarEvent[]> {
  const allEvents: GoogleCalendarEvent[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      singleEvents: 'true',
      orderBy: 'startTime',
      timeMin,
      timeMax,
      maxResults: '250',
    });
    if (pageToken) params.set('pageToken', pageToken);

    const data = await apiCall<EventsListResponse>(
      accessToken,
      `${BASE_URL}/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
    );
    allEvents.push(...(data.items || []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  // Filter out cancelled events
  return allEvents.filter(e => e.status !== 'cancelled');
}

// ── Event CRUD ──

export interface GoogleEventPayload {
  summary: string;
  description?: string;
  location?: string;
  start: GoogleEventDateTime;
  end: GoogleEventDateTime;
}

export async function createEvent(
  accessToken: string,
  calendarId: string,
  event: GoogleEventPayload,
): Promise<GoogleCalendarEvent> {
  return apiCall<GoogleCalendarEvent>(
    accessToken,
    `${BASE_URL}/calendars/${encodeURIComponent(calendarId)}/events`,
    { method: 'POST', body: JSON.stringify(event) },
  );
}

export async function updateEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  event: GoogleEventPayload,
): Promise<GoogleCalendarEvent> {
  return apiCall<GoogleCalendarEvent>(
    accessToken,
    `${BASE_URL}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: 'PATCH', body: JSON.stringify(event) },
  );
}

export async function deleteEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
): Promise<void> {
  return apiCall<void>(
    accessToken,
    `${BASE_URL}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: 'DELETE' },
  );
}

// ── Helpers ──

/** Convert a Google event to our CalendarEvent shape. */
export function googleEventToLocal(
  ge: GoogleCalendarEvent,
  sourceId: string,
  googleCalendarId: string,
): {
  title: string;
  description: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  sourceId: string;
  googleEventId: string;
  googleCalendarId: string;
} {
  const allDay = !ge.start.dateTime;
  const start = allDay
    ? new Date(ge.start.date + 'T00:00:00').toISOString()
    : new Date(ge.start.dateTime!).toISOString();
  const end = allDay
    ? new Date(ge.end.date + 'T23:59:59').toISOString()
    : new Date(ge.end.dateTime!).toISOString();

  return {
    title: ge.summary || '(No title)',
    description: ge.description || '',
    start,
    end,
    allDay,
    location: ge.location,
    sourceId,
    googleEventId: ge.id,
    googleCalendarId,
  };
}

/** Convert a local CalendarEvent to Google API payload. */
export function localEventToGooglePayload(event: {
  title: string;
  description: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
}, timeZone: string): GoogleEventPayload {
  const tz = validateIanaTimeZone(timeZone);
  if (!tz) throw new Error('A valid app time zone is required for Google Calendar writes.');

  if (event.allDay) {
    const startDate = getZonedDate(new Date(event.start), tz);
    const eventEndDate = getZonedDate(new Date(event.end), tz);
    const endDate = eventEndDate ? shiftIsoDate(eventEndDate, 1) : null;
    if (!startDate || !endDate) {
      throw new Error('The all-day event dates are invalid.');
    }
    // Google all-day end is exclusive, so add a day
    return {
      summary: event.title,
      description: event.description || undefined,
      location: event.location,
      start: { date: startDate },
      end: { date: endDate },
    };
  }

  return {
    summary: event.title,
    description: event.description || undefined,
    location: event.location,
    start: { dateTime: event.start, timeZone: tz },
    end: { dateTime: event.end, timeZone: tz },
  };
}
