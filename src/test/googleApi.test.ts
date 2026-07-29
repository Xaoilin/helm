// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchCalendarList,
  fetchEvents,
  createEvent,
  updateEvent,
  deleteEvent,
  GoogleApiError,
  localEventToGooglePayload,
} from '../services/googleCalendarApi';
import { googleCalendarBreaker } from '../services/serviceBreakers';

// Mock global fetch
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

function mockResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  };
}

describe('Google Calendar API', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    googleCalendarBreaker.reset();
  });

  describe('fetchCalendarList', () => {
    it('should return parsed calendar entries', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({
        items: [
          { id: 'cal1', summary: 'Work', accessRole: 'owner', primary: true },
          { id: 'cal2', summary: 'Holidays', accessRole: 'reader' },
        ],
      }));

      const result = await fetchCalendarList('test-token');
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('cal1');
      expect(result[0].summary).toBe('Work');
      expect(result[0].primary).toBe(true);
    });

    it('should send Authorization header', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ items: [] }));
      await fetchCalendarList('my-token-123');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('calendarList'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer my-token-123',
          }),
        }),
      );
    });

    it('should return empty array when no items', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({}));
      const result = await fetchCalendarList('token');
      expect(result).toEqual([]);
    });

    it('should throw GoogleApiError on 401', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: () => Promise.resolve('{"error":"invalid_token"}'),
      });

      try {
        await fetchCalendarList('bad-token');
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(GoogleApiError);
        expect((err as GoogleApiError).isAuthError).toBe(true);
      }
    });
  });

  describe('fetchEvents', () => {
    it('should fetch events with correct parameters', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({
        items: [
          { id: 'ev1', summary: 'Standup', start: { dateTime: '2026-03-30T10:00:00Z' }, end: { dateTime: '2026-03-30T10:30:00Z' } },
        ],
      }));

      const result = await fetchEvents('token', 'cal1', '2026-03-01T00:00:00Z', '2026-04-01T00:00:00Z');
      expect(result).toHaveLength(1);
      expect(result[0].summary).toBe('Standup');

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain('singleEvents=true');
      expect(calledUrl).toContain('orderBy=startTime');
    });

    it('should handle pagination', async () => {
      mockFetch
        .mockResolvedValueOnce(mockResponse({
          items: [{ id: 'ev1', summary: 'A', start: { dateTime: '2026-03-30T10:00:00Z' }, end: { dateTime: '2026-03-30T11:00:00Z' } }],
          nextPageToken: 'page2',
        }))
        .mockResolvedValueOnce(mockResponse({
          items: [{ id: 'ev2', summary: 'B', start: { dateTime: '2026-03-31T10:00:00Z' }, end: { dateTime: '2026-03-31T11:00:00Z' } }],
        }));

      const result = await fetchEvents('token', 'cal1', '2026-03-01T00:00:00Z', '2026-04-01T00:00:00Z');
      expect(result).toHaveLength(2);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should filter out cancelled events', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({
        items: [
          { id: 'ev1', summary: 'Active', status: 'confirmed', start: { dateTime: '2026-03-30T10:00:00Z' }, end: { dateTime: '2026-03-30T11:00:00Z' } },
          { id: 'ev2', summary: 'Cancelled', status: 'cancelled', start: { dateTime: '2026-03-30T12:00:00Z' }, end: { dateTime: '2026-03-30T13:00:00Z' } },
        ],
      }));

      const result = await fetchEvents('token', 'cal1', '2026-03-01T00:00:00Z', '2026-04-01T00:00:00Z');
      expect(result).toHaveLength(1);
      expect(result[0].summary).toBe('Active');
    });

    it('should throw on 403 (forbidden)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: () => Promise.resolve('{"error":"forbidden"}'),
      });

      await expect(fetchEvents('token', 'cal1', '', '')).rejects.toThrow(GoogleApiError);
    });
  });

  describe('createEvent', () => {
    it('should POST event and return result', async () => {
      const created = { id: 'new-ev', summary: 'New meeting' };
      mockFetch.mockResolvedValueOnce(mockResponse(created));

      const payload = { summary: 'New meeting', start: { dateTime: '2026-03-30T10:00:00Z' }, end: { dateTime: '2026-03-30T11:00:00Z' } };
      const result = await createEvent('token', 'cal1', payload);
      expect(result.id).toBe('new-ev');
      expect(mockFetch.mock.calls[0][1].method).toBe('POST');
    });
  });

  describe('updateEvent', () => {
    it('should PATCH event', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ id: 'ev1', summary: 'Updated' }));

      const payload = { summary: 'Updated', start: { dateTime: '2026-03-30T10:00:00Z' }, end: { dateTime: '2026-03-30T11:00:00Z' } };
      const result = await updateEvent('token', 'cal1', 'ev1', payload);
      expect(result.summary).toBe('Updated');
      expect(mockFetch.mock.calls[0][1].method).toBe('PATCH');
    });
  });

  describe('deleteEvent', () => {
    it('should DELETE event', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 204, json: () => Promise.resolve(undefined), text: () => Promise.resolve('') });

      await deleteEvent('token', 'cal1', 'ev1');
      expect(mockFetch.mock.calls[0][1].method).toBe('DELETE');
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain('ev1');
    });
  });

  describe('localEventToGooglePayload', () => {
    it('should handle timed events with timezone', () => {
      const payload = localEventToGooglePayload({
        title: 'Call',
        description: 'Team call',
        start: '2026-03-30T14:00:00.000Z',
        end: '2026-03-30T15:00:00.000Z',
        allDay: false,
        location: 'Zoom',
      });
      expect(payload.summary).toBe('Call');
      expect(payload.description).toBe('Team call');
      expect(payload.location).toBe('Zoom');
      expect(payload.start.dateTime).toBeTruthy();
      expect(payload.start.timeZone).toBeTruthy();
      expect(payload.start.date).toBeUndefined();
    });

    it('should handle all-day events with date-only fields', () => {
      const payload = localEventToGooglePayload({
        title: 'Holiday',
        description: '',
        start: '2026-04-03T00:00:00.000Z',
        end: '2026-04-03T23:59:59.000Z',
        allDay: true,
      });
      expect(payload.start.date).toBeTruthy();
      expect(payload.start.dateTime).toBeUndefined();
      expect(payload.end.date).toBeTruthy();
      expect(payload.description).toBeUndefined(); // empty strings omitted
    });

    it('should encode calendar IDs with special characters', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ items: [] }));
      await fetchEvents('token', 'user@example.com', '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z');
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain(encodeURIComponent('user@example.com'));
    });
  });

  describe('GoogleApiError', () => {
    it('should classify 429 as rate limit', () => {
      const err = new GoogleApiError(429, '{}', 'Too many requests');
      expect(err.isRateLimit).toBe(true);
      expect(err.isAuthError).toBe(false);
      expect(err.isForbidden).toBe(false);
    });

    it('should preserve status and body', () => {
      const err = new GoogleApiError(500, '{"error":"internal"}', 'Server error');
      expect(err.status).toBe(500);
      expect(err.body).toBe('{"error":"internal"}');
      expect(err.message).toBe('Server error');
    });
  });

  describe('circuit breaker classification', () => {
    it('does not open the breaker after repeated 401 auth failures', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          text: () => Promise.resolve('{"error":"invalid_token"}'),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          text: () => Promise.resolve('{"error":"invalid_token"}'),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          text: () => Promise.resolve('{"error":"invalid_token"}'),
        })
        .mockResolvedValueOnce(mockResponse({ items: [] }));

      await expect(fetchCalendarList('bad-token-1')).rejects.toThrow(GoogleApiError);
      await expect(fetchCalendarList('bad-token-2')).rejects.toThrow(GoogleApiError);
      await expect(fetchCalendarList('bad-token-3')).rejects.toThrow(GoogleApiError);

      await expect(fetchCalendarList('good-token')).resolves.toEqual([]);
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    it('opens the breaker on repeated transient service failures', async () => {
      vi.useFakeTimers();
      try {
        for (let i = 0; i < 9; i++) {
          mockFetch.mockResolvedValueOnce({
            ok: false,
            status: 503,
            statusText: 'Unavailable',
            text: () => Promise.resolve('{"error":"unavailable"}'),
          });
        }

        for (const token of ['token-1', 'token-2', 'token-3']) {
          const rejection = expect(fetchCalendarList(token)).rejects.toThrow(GoogleApiError);
          await vi.runAllTimersAsync();
          await rejection;
        }
        await expect(fetchCalendarList('token-4')).rejects.toThrow('Circuit breaker open');
        expect(mockFetch).toHaveBeenCalledTimes(9);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
