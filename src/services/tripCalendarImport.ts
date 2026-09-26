/**
 * Turning a trip plan or booking into a Calendar event: which source to
 * suggest, the event text, and the event bounds.
 */
import type { CalendarAccount, CalendarSource, TripBooking, TripItineraryItem, TripLeg } from '../types/domain';
import { normalizeCalendarDate } from './calendarEventDates';
import { getBookingDisplayTitle, getBookingRouteLabel } from './tripDisplay';
import type { BookingSeed } from './tripModel';

export interface CalendarImportTarget {
  title: string;
  start: string;
  end: string;
  description: string;
  allDay: boolean;
  location?: string;
}

export function pickDefaultCalendarSource(accounts: CalendarAccount[], sources: CalendarSource[]): CalendarSource | null {
  const primaryAccount = accounts.find(account => account.isPrimary);
  const visibleSource = sources.find(source => source.visible && source.accountId === primaryAccount?.id);
  return visibleSource || sources.find(source => source.visible) || sources[0] || null;
}

export function buildItineraryCalendarTarget(item: TripItineraryItem, leg: TripLeg | undefined): CalendarImportTarget {
  return {
    title: item.title,
    start: item.startTime ? `${item.date}T${item.startTime}` : `${item.date}T09:00`,
    end: item.endTime ? `${item.date}T${item.endTime}` : `${item.date}T10:00`,
    allDay: !item.startTime && !item.endTime,
    location: item.location,
    description: [
      leg ? `${leg.city}, ${leg.country}` : null,
      item.notes || null,
    ].filter(Boolean).join('\n\n'),
  };
}

export function buildBookingCalendarTarget(booking: TripBooking, seed: BookingSeed): CalendarImportTarget {
  const providerLines = [
    booking.provider ? `Provider: ${booking.provider}` : null,
    booking.confirmationCode ? `Confirmation: ${booking.confirmationCode}` : null,
  ];
  if (booking.kind === 'transport') {
    return {
      title: getBookingDisplayTitle(booking, seed),
      start: booking.departAt,
      end: booking.arriveAt,
      allDay: false,
      description: [getBookingRouteLabel(booking, seed), ...providerLines, booking.notes || null].filter(Boolean).join('\n'),
    };
  }
  return {
    title: getBookingDisplayTitle(booking, seed),
    start: `${booking.checkInDate}T00:00`,
    end: `${booking.checkOutDate}T23:59`,
    allDay: true,
    location: booking.address,
    description: [
      booking.propertyName,
      booking.city || null,
      booking.country || null,
      ...providerLines,
      booking.notes || null,
    ].filter(Boolean).join('\n'),
  };
}

/**
 * Calendar event bounds: all-day targets become calendar date keys, timed
 * targets become ISO instants from their device-local wall time. Null when
 * either bound is unreadable.
 */
export function resolveCalendarImportRange(target: CalendarImportTarget): { start: string; end: string } | null {
  const toBound = (value: string): string | null => {
    if (target.allDay) return normalizeCalendarDate(value.slice(0, 10));
    const instant = new Date(value);
    return Number.isNaN(instant.getTime()) ? null : instant.toISOString();
  };
  const start = toBound(target.start);
  const end = toBound(target.end);
  return start && end ? { start, end } : null;
}
