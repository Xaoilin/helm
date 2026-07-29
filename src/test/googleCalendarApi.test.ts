// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  googleEventToLocal,
  localEventToGooglePayload,
  GoogleApiError,
} from '../services/googleCalendarApi';

describe('googleCalendarApi', () => {
  describe('GoogleApiError', () => {
    it('should detect auth errors (401)', () => {
      const err = new GoogleApiError(401, '{}', 'Unauthorized');
      expect(err.isAuthError).toBe(true);
      expect(err.isForbidden).toBe(false);
      expect(err.isRateLimit).toBe(false);
    });

    it('should detect forbidden errors (403)', () => {
      const err = new GoogleApiError(403, '{}', 'Forbidden');
      expect(err.isAuthError).toBe(false);
      expect(err.isForbidden).toBe(true);
    });

    it('should detect rate limit errors (429)', () => {
      const err = new GoogleApiError(429, '{}', 'Rate limited');
      expect(err.isRateLimit).toBe(true);
    });

    it('should not flag 500 as auth/forbidden/ratelimit', () => {
      const err = new GoogleApiError(500, '{}', 'Server error');
      expect(err.isAuthError).toBe(false);
      expect(err.isForbidden).toBe(false);
      expect(err.isRateLimit).toBe(false);
    });
  });

  describe('googleEventToLocal', () => {
    it('should map a timed Google event to local format', () => {
      const ge = {
        id: 'gev1',
        summary: 'Standup',
        description: 'Daily standup',
        location: 'Zoom',
        start: { dateTime: '2026-03-30T10:00:00+01:00' },
        end: { dateTime: '2026-03-30T10:30:00+01:00' },
      };
      const result = googleEventToLocal(ge, 'src1', 'cal1');
      expect(result.title).toBe('Standup');
      expect(result.description).toBe('Daily standup');
      expect(result.location).toBe('Zoom');
      expect(result.allDay).toBe(false);
      expect(result.sourceId).toBe('src1');
      expect(result.googleEventId).toBe('gev1');
      expect(result.googleCalendarId).toBe('cal1');
      // Should be valid ISO dates
      expect(new Date(result.start).toISOString()).toBe(result.start);
      expect(new Date(result.end).toISOString()).toBe(result.end);
    });

    it('should map an all-day Google event', () => {
      const ge = {
        id: 'gev2',
        summary: 'Holiday',
        start: { date: '2026-04-03' },
        end: { date: '2026-04-04' },
      };
      const result = googleEventToLocal(ge, 'src1', 'cal1');
      expect(result.title).toBe('Holiday');
      expect(result.allDay).toBe(true);
      expect(result.description).toBe('');
    });

    it('should handle missing summary gracefully', () => {
      const ge = {
        id: 'gev3',
        start: { dateTime: '2026-03-30T10:00:00Z' },
        end: { dateTime: '2026-03-30T11:00:00Z' },
      };
      const result = googleEventToLocal(ge, 'src1', 'cal1');
      expect(result.title).toBe('(No title)');
    });
  });

  describe('localEventToGooglePayload', () => {
    it('should convert a timed local event to Google payload', () => {
      const event = {
        title: 'Meeting',
        description: 'Team sync',
        start: '2026-03-30T10:00:00.000Z',
        end: '2026-03-30T11:00:00.000Z',
        allDay: false,
        location: 'Office',
      };
      const payload = localEventToGooglePayload(event);
      expect(payload.summary).toBe('Meeting');
      expect(payload.description).toBe('Team sync');
      expect(payload.location).toBe('Office');
      expect(payload.start.dateTime).toBeTruthy();
      expect(payload.start.date).toBeUndefined();
      expect(payload.end.dateTime).toBeTruthy();
    });

    it('should convert an all-day event to Google payload with date fields', () => {
      const event = {
        title: 'Vacation',
        description: '',
        start: '2026-04-01T00:00:00.000Z',
        end: '2026-04-01T23:59:59.000Z',
        allDay: true,
      };
      const payload = localEventToGooglePayload(event);
      expect(payload.start.date).toBeTruthy();
      expect(payload.start.dateTime).toBeUndefined();
      expect(payload.end.date).toBeTruthy();
      expect(payload.end.dateTime).toBeUndefined();
    });

    it('should use the local calendar date for all-day exclusive ends', () => {
      const event = {
        title: 'Local day',
        description: '',
        start: '2026-04-01T00:00:00.000+01:00',
        end: '2026-04-01T23:59:59.000+01:00',
        allDay: true,
      };

      const payload = localEventToGooglePayload(event);

      expect(payload.start.date).toBe('2026-04-01');
      expect(payload.end.date).toBe('2026-04-02');
    });

    it('should omit empty description and location', () => {
      const event = {
        title: 'Quick call',
        description: '',
        start: '2026-03-30T14:00:00.000Z',
        end: '2026-03-30T14:30:00.000Z',
        allDay: false,
      };
      const payload = localEventToGooglePayload(event);
      expect(payload.description).toBeUndefined();
      expect(payload.location).toBeUndefined();
    });
  });
});
