import { APP_RELEASE_VERSION } from '../config/release';
import type { CalendarAuthProvider } from '../types/domain';
import { LIMITS } from '../config/constants';
import { logWarn } from './logger';

const GOOGLE_CALENDAR_DIAGNOSTICS_KEY = 'helm:google-calendar-diagnostics';
const GOOGLE_CALENDAR_DIAGNOSTICS_EXPORT_PREFIX = 'helm-google-calendar-diagnostics';

interface SaveFilePickerWritable {
  write(data: Blob | string): Promise<void>;
  close(): Promise<void>;
}

interface SaveFilePickerHandle {
  createWritable(): Promise<SaveFilePickerWritable>;
}

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: Array<{
    description?: string;
    accept: Record<string, string[]>;
  }>;
}

type BrowserWindowWithSavePicker = Window & typeof globalThis & {
  showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<SaveFilePickerHandle>;
};

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
  removedSourceCount?: number;
  removedEventCount?: number;
  skippedDestructiveRemovals?: boolean;
}

export interface GoogleCalendarDiagnosticSummary {
  latestFailure: GoogleCalendarDiagnosticEvent | null;
  latestSuccess: GoogleCalendarDiagnosticEvent | null;
  latestServerStatus: GoogleCalendarDiagnosticEvent | null;
  latestEvents: GoogleCalendarDiagnosticEvent[];
}

export type GoogleCalendarDiagnosticsExportMethod = 'download' | 'save_picker' | 'cancelled';

export interface GoogleCalendarDiagnosticsExportArtifact {
  fileName: string;
  payload: string;
  method: GoogleCalendarDiagnosticsExportMethod;
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

function coerceDate(value: Date | string): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function padNumber(value: number): string {
  return String(value).padStart(2, '0');
}

function formatFilenameTimestamp(value: Date | string): string {
  const date = coerceDate(value) || new Date();
  return [
    date.getUTCFullYear(),
    padNumber(date.getUTCMonth() + 1),
    padNumber(date.getUTCDate()),
  ].join('-') + `-${padNumber(date.getUTCHours())}${padNumber(date.getUTCMinutes())}${padNumber(date.getUTCSeconds())}`;
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

export function buildGoogleCalendarDiagnosticsExport(
  payload: Record<string, unknown>,
  exportedAt: Date | string = new Date(),
): string {
  return JSON.stringify({
    exportType: 'google-calendar-diagnostics',
    release: APP_RELEASE_VERSION,
    exportedAt: (coerceDate(exportedAt) || new Date()).toISOString(),
    ...payload,
  }, null, 2);
}

export function buildGoogleCalendarDiagnosticsExportFilename(
  exportedAt: Date | string = new Date(),
): string {
  return `${GOOGLE_CALENDAR_DIAGNOSTICS_EXPORT_PREFIX}-${APP_RELEASE_VERSION.replace(/^v/, '')}-${formatFilenameTimestamp(exportedAt)}.json`;
}

export async function downloadGoogleCalendarDiagnosticsExport(
  payload: Record<string, unknown>,
  exportedAt: Date | string = new Date(),
): Promise<GoogleCalendarDiagnosticsExportArtifact> {
  const normalizedExportedAt = coerceDate(exportedAt) || new Date();
  const exportPayload = buildGoogleCalendarDiagnosticsExport(payload, normalizedExportedAt);
  const fileName = buildGoogleCalendarDiagnosticsExportFilename(normalizedExportedAt);
  const blob = new Blob([exportPayload], { type: 'application/json;charset=utf-8' });
  const savePicker = (window as BrowserWindowWithSavePicker).showSaveFilePicker;

  if (savePicker) {
    try {
      const handle = await savePicker({
        suggestedName: fileName,
        types: [{
          description: 'HELM Google Calendar diagnostics report',
          accept: {
            'application/json': ['.json'],
          },
        }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return {
        fileName,
        payload: exportPayload,
        method: 'save_picker',
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return {
          fileName,
          payload: exportPayload,
          method: 'cancelled',
        };
      }
      logWarn('GoogleCalendarDiagnosticsExport', 'showSaveFilePicker failed, falling back to browser download.');
    }
  }

  const blobUrl = URL.createObjectURL(blob);
  const downloadLink = document.createElement('a');
  downloadLink.href = blobUrl;
  downloadLink.download = fileName;
  downloadLink.rel = 'noopener';
  downloadLink.style.display = 'none';

  document.body.appendChild(downloadLink);
  downloadLink.click();
  downloadLink.remove();

  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 0);

  return {
    fileName,
    payload: exportPayload,
    method: 'download',
  };
}
