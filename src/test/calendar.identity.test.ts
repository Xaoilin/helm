import { describe, expect, it } from 'vitest';
import {
  buildGoogleEventCacheId,
  buildGoogleSourceCacheId,
  canApplyLocalCalendarMutation,
  isEventInsideCalendarFetchWindow,
  isProviderBackedCalendarSource,
} from '../services/calendarProviderSync';
import { makeCalendarAccount, makeCalendarEvent, makeCalendarSource } from './fixtures';

describe('calendar account/source/event identity', () => {
  it('proves provider cache identities encode each account, source, and provider id component', () => {
    expect(buildGoogleSourceCacheId('account/1', 'primary calendar')).toBe(
      'google-source:account%2F1:primary%20calendar',
    );
    expect(buildGoogleEventCacheId('source:1', 'event/42')).toBe(
      'google-event:source%3A1:event%2F42',
    );
    expect(buildGoogleSourceCacheId('account/1', 'calendar-a')).not.toBe(
      buildGoogleSourceCacheId('account/2', 'calendar-a'),
    );
  });

  it('proves a source is provider-backed through either its explicit id or its active account', () => {
    const googleAccount = makeCalendarAccount({
      id: 'account-google',
      provider: 'google',
      connected: true,
      mocked: false,
    });
    const localAccount = makeCalendarAccount({ id: 'account-local', provider: 'local' });
    const explicitProviderSource = makeCalendarSource({
      accountId: localAccount.id,
      googleCalendarId: 'google-primary',
    });
    const accountBackedSource = makeCalendarSource({ accountId: googleAccount.id });
    const localSource = makeCalendarSource({ accountId: localAccount.id });

    expect(isProviderBackedCalendarSource(explicitProviderSource, [localAccount])).toBe(true);
    expect(isProviderBackedCalendarSource(accountBackedSource, [googleAccount])).toBe(true);
    expect(isProviderBackedCalendarSource(localSource, [localAccount])).toBe(false);
    expect(canApplyLocalCalendarMutation(accountBackedSource, [googleAccount])).toBe(false);
    expect(canApplyLocalCalendarMutation(localSource, [localAccount])).toBe(true);
  });

  it('proves fetch-window boundaries use real event instants and retain overlapping events', () => {
    const event = makeCalendarEvent({
      start: '2026-08-29T10:00:00.000Z',
      end: '2026-08-29T11:00:00.000Z',
    });

    expect(isEventInsideCalendarFetchWindow(
      event,
      '2026-08-29T11:00:00.000Z',
      '2026-08-29T12:00:00.000Z',
    )).toBe(true);
    expect(isEventInsideCalendarFetchWindow(
      event,
      '2026-08-29T11:00:00.001Z',
      '2026-08-29T12:00:00.000Z',
    )).toBe(false);
    expect(isEventInsideCalendarFetchWindow(
      makeCalendarEvent({ start: 'not-an-instant' }),
      '2026-08-29T00:00:00.000Z',
      '2026-08-30T00:00:00.000Z',
    )).toBe(false);
  });
});
