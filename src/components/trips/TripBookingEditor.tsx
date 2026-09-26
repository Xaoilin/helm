import { useState } from 'react';
import {
  applyBookingDraftUpdate,
  buildBookingDraft,
  buildBookingPayload,
  buildTripBookingSeed,
  getBookingValidationMessage,
  mapBookingToDraft,
  materializeBookingDraft,
  type BookingDraft,
  type BookingKind,
} from '../../services/tripModel';
import { useTripContext } from '../../store/contexts/TripContext';
import type { Trip, TripBooking, TripLeg } from '../../types/domain';
import BookingFormFields from './BookingFormFields';

/** Add or edit one transport or stay booking on the selected trip. */
export default function TripBookingEditor({ trip, legs, kind, booking, legId, today, onClose }: {
  trip: Trip;
  legs: TripLeg[];
  kind: BookingKind;
  booking?: TripBooking;
  legId?: string;
  today: string;
  onClose: () => void;
}) {
  const { addTripBooking, updateTripBooking } = useTripContext();
  const seedFor = (seedLegId?: string) => buildTripBookingSeed(trip, legs, seedLegId);
  const [draft, setDraft] = useState<BookingDraft>(() => {
    const seed = seedFor(booking ? booking.legId : (legId || legs[0]?.id));
    return booking ? materializeBookingDraft(mapBookingToDraft(booking), seed, today) : buildBookingDraft(kind, seed, today);
  });
  const [feedback, setFeedback] = useState<string | null>(null);

  function replaceDraft(nextDraft: BookingDraft): void {
    setFeedback(null);
    setDraft(nextDraft);
  }

  function updateDraft(updates: Partial<BookingDraft>): void {
    setFeedback(null);
    setDraft(previous => applyBookingDraftUpdate(previous, updates, seedFor, today));
  }

  function save(): void {
    const seed = seedFor(draft.legId);
    const prepared = materializeBookingDraft(draft, seed, today);
    setDraft(prepared);
    const validationMessage = getBookingValidationMessage(prepared);
    if (validationMessage) {
      setFeedback(validationMessage);
      return;
    }

    try {
      const payload = buildBookingPayload(prepared, trip.id, seed);
      if (booking) {
        updateTripBooking(booking.id, payload);
      } else {
        addTripBooking(payload);
      }
      setFeedback(null);
      onClose();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Booking could not be saved. Please try again.');
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal trip-booking-modal" onClick={event => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={booking ? 'Edit booking' : 'Add booking'}>
        <h2>{booking ? 'Edit Booking' : 'Add Booking'}</h2>
        <div className="form-group">
          <label htmlFor="booking-kind">Booking Type</label>
          <select
            id="booking-kind"
            className="form-select"
            value={draft.kind}
            onChange={event => replaceDraft(buildBookingDraft(event.target.value === 'transport' ? 'transport' : 'stay', seedFor(draft.legId), today))}
            disabled={Boolean(booking)}
          >
            <option value="transport">Transport</option>
            <option value="stay">Stay</option>
          </select>
        </div>
        <BookingFormFields
          draft={draft}
          onChange={updateDraft}
          legs={legs}
          idPrefix="booking"
          autoFocus
        />
        {feedback && (
          <div className="info-box error" role="alert" aria-live="polite" style={{ marginBottom: 0 }}>
            {feedback}
          </div>
        )}
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>
            {booking ? 'Save Booking' : 'Create Booking'}
          </button>
        </div>
      </div>
    </div>
  );
}
