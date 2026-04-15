import { beforeEach, describe, expect, it } from 'vitest';
import {
  appendGoogleCalendarDiagnosticEvent,
  buildGoogleCalendarDiagnosticsExport,
  clearGoogleCalendarDiagnosticEvents,
  getGoogleCalendarDiagnosticSummary,
  listGoogleCalendarDiagnosticEvents,
} from '../services/googleCalendarDiagnosticEvents';

describe('googleCalendarDiagnosticEvents', () => {
  beforeEach(() => {
    localStorage.clear();
    clearGoogleCalendarDiagnosticEvents();
  });

  it('persists a local-only timeline and returns latest events first', () => {
    appendGoogleCalendarDiagnosticEvent({
      operation: 'sync_trigger',
      phase: 'start',
      outcome: 'info',
      message: 'First event',
      timestamp: '2026-04-15T08:00:00.000Z',
    });
    appendGoogleCalendarDiagnosticEvent({
      operation: 'server_status_refresh',
      phase: 'failure',
      outcome: 'failure',
      message: 'Second event',
      timestamp: '2026-04-15T09:00:00.000Z',
    });

    const events = listGoogleCalendarDiagnosticEvents();
    expect(events).toHaveLength(2);
    expect(events[0].message).toBe('Second event');
    expect(events[1].message).toBe('First event');
  });

  it('keeps the diagnostics ring buffer capped', () => {
    for (let index = 0; index < 280; index += 1) {
      appendGoogleCalendarDiagnosticEvent({
        operation: 'sync_account',
        phase: 'start',
        outcome: 'info',
        message: `event-${index}`,
        timestamp: `2026-04-15T08:${String(index % 60).padStart(2, '0')}:00.000Z`,
      });
    }

    const events = listGoogleCalendarDiagnosticEvents();
    expect(events).toHaveLength(250);
    expect(events.some(event => event.message === 'event-0')).toBe(false);
    expect(events.some(event => event.message === 'event-279')).toBe(true);
  });

  it('builds a redacted export payload without inventing raw secrets', () => {
    appendGoogleCalendarDiagnosticEvent({
      operation: 'manual_probe',
      phase: 'failure',
      outcome: 'needs_reconnect',
      message: 'Reconnect this account.',
      code: 'needs_reconnect',
    });

    const exported = buildGoogleCalendarDiagnosticsExport({
      timelineEvents: listGoogleCalendarDiagnosticEvents(),
      serverRuntimeStatus: {
        lastError: 'Reconnect this account.',
      },
    });

    expect(exported).toContain('"timelineEvents"');
    expect(exported).toContain('"needs_reconnect"');
    expect(exported).not.toContain('accessToken');
    expect(exported).not.toContain('refreshToken');
  });

  it('derives latest success and failure summaries from the timeline', () => {
    appendGoogleCalendarDiagnosticEvent({
      operation: 'sync_trigger',
      phase: 'success',
      outcome: 'success',
      message: 'Sync completed.',
      timestamp: '2026-04-15T08:00:00.000Z',
    });
    appendGoogleCalendarDiagnosticEvent({
      operation: 'server_status_refresh',
      phase: 'failure',
      outcome: 'failure',
      message: 'Hosted backend failed.',
      timestamp: '2026-04-15T09:00:00.000Z',
    });

    const summary = getGoogleCalendarDiagnosticSummary();
    expect(summary.latestFailure?.message).toBe('Hosted backend failed.');
    expect(summary.latestSuccess?.message).toBe('Sync completed.');
  });
});
