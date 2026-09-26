import { describe, expect, it } from 'vitest';
import {
  buildBookingCalendarTarget,
  buildItineraryCalendarTarget,
  pickDefaultCalendarSource,
  resolveCalendarImportRange,
} from '../services/tripCalendarImport';
import { makeCalendarAccount, makeCalendarSource } from './fixtures';
import { makeItineraryItem, makeStayBooking, makeTransportBooking, makeTripLeg } from './tripFixtures';

describe('trip calendar import', () => {
  it('prefers a visible source on the primary account, then any visible source', () => {
    const accounts = [makeCalendarAccount({ id: 'other', isPrimary: false }), makeCalendarAccount({ id: 'primary', isPrimary: true })];
    const hidden = makeCalendarSource({ id: 'hidden', accountId: 'primary', visible: false });
    const otherVisible = makeCalendarSource({ id: 'other-visible', accountId: 'other', visible: true });
    const primaryVisible = makeCalendarSource({ id: 'primary-visible', accountId: 'primary', visible: true });

    expect(pickDefaultCalendarSource(accounts, [hidden, otherVisible, primaryVisible])?.id).toBe('primary-visible');
    expect(pickDefaultCalendarSource(accounts, [hidden, otherVisible])?.id).toBe('other-visible');
    expect(pickDefaultCalendarSource(accounts, [hidden])?.id).toBe('hidden');
    expect(pickDefaultCalendarSource(accounts, [])).toBeNull();
  });

  it('makes an untimed plan an all-day event and a timed plan a timed event', () => {
    const leg = makeTripLeg();
    expect(buildItineraryCalendarTarget(makeItineraryItem({ notes: 'Book ahead' }), leg)).toMatchObject({
      allDay: true, start: '2026-10-01T09:00', end: '2026-10-01T10:00', description: 'Madrid, Spain\n\nBook ahead',
    });
    expect(buildItineraryCalendarTarget(makeItineraryItem({ startTime: '14:00' }), undefined)).toMatchObject({
      allDay: false, start: '2026-10-01T14:00', end: '2026-10-01T10:00', description: '',
    });
  });

  it('describes bookings with their route and provider details', () => {
    expect(buildBookingCalendarTarget(makeTransportBooking({ provider: 'CP', confirmationCode: 'X1' }), {})).toMatchObject({
      title: 'Train to Lisbon', allDay: false, description: 'Madrid -> Lisbon\nProvider: CP\nConfirmation: X1',
    });
    expect(buildBookingCalendarTarget(makeStayBooking({ address: '1 Calle' }), {})).toMatchObject({
      allDay: true, start: '2026-10-01T00:00', end: '2026-10-03T23:59', location: '1 Calle', description: 'Hotel Sol\nMadrid\nSpain',
    });
  });

  it('resolves all-day bounds to date keys and timed bounds to instants', () => {
    expect(resolveCalendarImportRange({ title: 'Stay', description: '', allDay: true, start: '2026-10-01T00:00', end: '2026-10-03T23:59' }))
      .toEqual({ start: '2026-10-01', end: '2026-10-03' });
    expect(resolveCalendarImportRange({ title: 'Train', description: '', allDay: false, start: '2026-10-04T09:00', end: '2026-10-04T15:00' }))
      .toEqual({ start: '2026-10-04T09:00:00.000Z', end: '2026-10-04T15:00:00.000Z' });
  });

  it('refuses unreadable bounds instead of throwing', () => {
    expect(resolveCalendarImportRange({ title: 'Train', description: '', allDay: false, start: '', end: '2026-10-04T15:00' })).toBeNull();
    expect(resolveCalendarImportRange({ title: 'Stay', description: '', allDay: true, start: 'soon', end: '2026-10-03' })).toBeNull();
  });
});
