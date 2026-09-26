/**
 * Display text for Trips: dates, ranges, status labels, and the titles and
 * route lines a booking shows when its own fields are left blank.
 */
import type { TripBooking, TripStatus } from '../types/domain';
import type { BookingSeed, BookingSeedableLeg, StayBookingDraft, TransportBookingDraft } from './tripModel';

export function formatDate(value: string): string {
  if (!value) return 'Not set';
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatDateTime(value: string): string {
  if (!value) return 'Not set';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatTripRange(startDate: string, endDate: string): string {
  if (!startDate && !endDate) return 'Dates not set';
  if (!startDate || startDate === endDate) return formatDate(startDate || endDate);
  return `${formatDate(startDate)} - ${formatDate(endDate)}`;
}

/** The time tag on an itinerary item: `09:00 - 10:30`, `09:00`, or `Flexible`. */
export function formatItineraryTimeLabel(startTime?: string, endTime?: string): string {
  if (!startTime) return 'Flexible';
  return endTime ? `${startTime} - ${endTime}` : startTime;
}

export function toTitleCase(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function getTripStatusLabel(status: TripStatus): string {
  switch (status) {
    case 'planning': return 'Planning';
    case 'booked': return 'Booked';
    case 'in_trip': return 'In Trip';
    case 'completed': return 'Completed';
    case 'archived': return 'Archived';
  }
}

export function getDestinationLabel(seed: BookingSeed): string {
  if (!seed.city && !seed.country) return '';
  if (!seed.city) return seed.country || '';
  if (!seed.country) return seed.city;
  return `${seed.city}, ${seed.country}`;
}

export function getLegLabel(leg?: BookingSeedableLeg): string {
  if (!leg) return 'Not tied to one destination';
  return `${leg.city}, ${leg.country}`;
}

export function buildTransportDisplayTitle(booking: Pick<TransportBookingDraft, 'title' | 'mode' | 'toLabel'>, seed: BookingSeed = {}): string {
  if (booking.title.trim() && booking.title.trim() !== 'Transport booking') return booking.title.trim();
  const destination = booking.toLabel.trim() || getDestinationLabel(seed);
  if (destination) return `${toTitleCase(booking.mode)} to ${destination.split(',')[0]}`;
  return 'Transport booking';
}

export function buildStayDisplayTitle(booking: Pick<StayBookingDraft, 'title' | 'propertyName' | 'city'>, seed: BookingSeed = {}): string {
  if (booking.title.trim() && booking.title.trim() !== 'Stay booking') return booking.title.trim();
  if (booking.propertyName.trim() && booking.propertyName.trim() !== 'Accommodation') return booking.propertyName.trim();
  const city = booking.city.trim() || seed.city || '';
  if (city) return `Stay in ${city}`;
  return 'Stay booking';
}

export function getBookingDisplayTitle(booking: TripBooking, seed: BookingSeed = {}): string {
  if (booking.kind === 'transport') {
    return buildTransportDisplayTitle(booking, seed);
  }
  return buildStayDisplayTitle(booking, seed);
}

export function getBookingRouteLabel(booking: TripBooking, seed: BookingSeed = {}): string {
  if (booking.kind === 'transport') {
    const destination = booking.toLabel.trim() || getDestinationLabel(seed) || 'Destination TBD';
    const origin = booking.fromLabel.trim() || 'Origin TBD';
    return `${origin} -> ${destination}`;
  }
  const location = getDestinationLabel({ city: booking.city, country: booking.country }) || getDestinationLabel(seed) || 'Destination TBD';
  return `${booking.propertyName.trim() || 'Accommodation'} · ${location}`;
}

export function getBookingTimelineLabel(booking: TripBooking): string {
  if (booking.kind === 'transport') {
    return `${formatDateTime(booking.departAt)} -> ${formatDateTime(booking.arriveAt)}`;
  }
  return `${formatDate(booking.checkInDate)} -> ${formatDate(booking.checkOutDate)}`;
}
