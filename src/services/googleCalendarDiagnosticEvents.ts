import type { CalendarAuthProvider } from '../types/domain';
import { LIMITS } from '../config/constants';

const GOOGLE_CALENDAR_DIAGNOSTICS_KEY = 'helm:google-calendar-diagnostics';

export type GoogleCalendarDiagnosticOperation =
  | 'sync_trigger'
  | 'sync_account'
  | 'server_status_refresh'
  | 'credential_status'
  | 'access_token_mint'
  | 'gis_script'
  | 'gis_code_flow'
  | 'oauth_code_exchange'
  | 'profile_bootstrap'
  | 'calendar_list_fetch'
  | 'calendar_event_fetch'
  | 'ownership_check'
  | 'manual_probe'
  | 'connect'
  | 'reconnect'
  | 'disconnect';

export type GoogleCalendarDiagnosticPhase = 'start' | 'success' | 'failure' | 'blocked' | 'info';

export type GoogleCalendarDiagnosticOutcome =
  | 'success'
  | 'failure'
  | 'blocked'
  | 'needs_reconnect'
  | 'revoked'
  | 'ownership_mismatch'
  | 'temporary_unavailable'
  | 'info';

export type GoogleCalendarDiagnosticTriggerSource =
  | 'auto'
  | 'manual'
  | 'debug'
  | 'user_action'
  | 'system';

export interface GoogleCalendarBackendReadiness {
  functionReachable: boolean;
  oauthConfigured: boolean;
  originAllowed: boolean;
  signedIn: boolean;
}

export interface GoogleCalendarDiagnosticEvent {
  id: string;
  timestamp: string;
  operation: GoogleCalendarDiagnosticOperation;
  phase: GoogleCalendarDiagnosticPhase;
  outcome: GoogleCalendarDiagnosticOutcome;
  triggerSource?: GoogleCalendarDiagnosticTriggerSource;
  accountId?: string;
  email?: string;
  resolvedAuthProvider?: CalendarAuthProvider;
  credentialSource?: string;
  message: string;
  code?: string;
  httpStatus?: number;
  requestId?: string;
  readiness?: GoogleCalendarBackendReadiness;
  primaryCalendarEmail?: string;
  calendarId?: string;
  calendarCount?: number;
  eventCount?: number;
  preservedSourceCount?: number;
  preservedEventCount?: number;
  skippedDestructiveRemovals?: boolean;
}

export interface GoogleCalendarDiagnosticSummary {
  latestFailure: GoogleCalendarDiagnosticEvent | null;
  latestSuccess: GoogleCalendarDiagnosticEvent | null;
  latestServerStatus: GoogleCalendarDiagnosticEvent | null;
  latestEvents: GoogleCalendarDiagnosticEvent[];
}

type DiagnosticListener = (events: GoogleCalendarDiagnosticEvent[]) => void;

const listeners = new Set<DiagnosticListener>();

function createDiagnosticEventId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `gcal-diag-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readStoredEvents(): GoogleCalendarDiagnosticEvent[] {
  if (typeof localStorage === 'undefined') {
    return [];
  }

  const raw = localStorage.getItem(GOOGLE_CALENDAR_DIAGNOSTICS_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((value): value is GoogleCalendarDiagnosticEvent => {
      return Boolean(
        value
        && typeof value === 'object'
        && typeof value.id === 'string'
        && typeof value.timestamp === 'string'
        && typeof value.operation === 'string'
        && typeof value.phase === 'string'
        && typeof value.outcome === 'string'
        && typeof value.message === 'string',
      );
    });
  } catch {
    return [];
  }
}

function writeStoredEvents(events: GoogleCalendarDiagnosticEvent[]): void {
  if (typeof localStorage === 'undefined') {
    return;
  }

  localStorage.setItem(GOOGLE_CALENDAR_DIAGNOSTICS_KEY, JSON.stringify(events));
}

function notifyListeners(events: GoogleCalendarDiagnosticEvent[]): void {
  for (const listener of listeners) {
    listener(events);
  }
}

export function listGoogleCalendarDiagnosticEvents(): GoogleCalendarDiagnosticEvent[] {
  return readStoredEvents()
    .slice()
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp));
}

export function appendGoogleCalendarDiagnosticEvent(
  event: Omit<GoogleCalendarDiagnosticEvent, 'id' | 'timestamp'> & { id?: string; timestamp?: string },
): GoogleCalendarDiagnosticEvent {
  const nextEvent: GoogleCalendarDiagnosticEvent = {
    id: event.id || createDiagnosticEventId(),
    timestamp: event.timestamp || new Date().toISOString(),
    ...event,
  };
  const events = readStoredEvents();
  const nextEvents = [...events, nextEvent].slice(-LIMITS.GOOGLE_CALENDAR_DIAGNOSTIC_EVENTS);
  writeStoredEvents(nextEvents);
  notifyListeners(listGoogleCalendarDiagnosticEvents());
  return nextEvent;
}

export function clearGoogleCalendarDiagnosticEvents(): void {
  writeStoredEvents([]);
  notifyListeners([]);
}

export function subscribeGoogleCalendarDiagnosticEvents(listener: DiagnosticListener): () => void {
  listeners.add(listener);
  listener(listGoogleCalendarDiagnosticEvents());
  return () => {
    listeners.delete(listener);
  };
}

export function getGoogleCalendarDiagnosticSummary(
  events: GoogleCalendarDiagnosticEvent[] = listGoogleCalendarDiagnosticEvents(),
): GoogleCalendarDiagnosticSummary {
  const latestFailure = events.find(event => (
    event.outcome !== 'success' && event.outcome !== 'info'
  )) || null;
  const latestSuccess = events.find(event => event.outcome === 'success') || null;
  const latestServerStatus = events.find(event => event.operation === 'server_status_refresh') || null;

  return {
    latestFailure,
    latestSuccess,
    latestServerStatus,
    latestEvents: events.slice(0, 25),
  };
}

export function buildGoogleCalendarDiagnosticsExport(payload: Record<string, unknown>): string {
  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    ...payload,
  }, null, 2);
}
