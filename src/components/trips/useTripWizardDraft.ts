import { useState } from 'react';
import {
  applyBookingDraftUpdate,
  buildBookingDraft,
  buildRouteDraftBookingSeed,
  canAdvanceWizardStep,
  createEmptyLegDraft,
  createEmptyWizardDraft,
  findWizardBookingValidationMessage,
  nextWizardStep,
  prepareWizardBookings,
  previousWizardStep,
  serializeWizardDraft,
  type BookingDraft,
  type BookingKind,
  type LegDraft,
  type TripBasicsDraft,
  type WizardDraftState,
  type WizardStep,
} from '../../services/tripModel';

/**
 * Form state for the Plan Trip wizard: one draft object, the current step,
 * and the validation message. Booking edits reseed from the current route.
 */
export function useTripWizardDraft(today: string) {
  const [draft, setDraft] = useState<WizardDraftState>(createEmptyWizardDraft);
  const [initialSnapshot] = useState(() => serializeWizardDraft(createEmptyWizardDraft()));
  const [step, setStep] = useState<WizardStep>('basics');
  const [feedback, setFeedback] = useState<string | null>(null);

  function updateBasics(updates: Partial<TripBasicsDraft>): void {
    setDraft(prev => ({ ...prev, ...updates }));
  }

  function updateRoute(update: (routeDrafts: LegDraft[]) => LegDraft[]): void {
    setDraft(prev => ({ ...prev, routeDrafts: update(prev.routeDrafts) }));
  }

  function updateBookings(update: (bookings: BookingDraft[], routeDrafts: LegDraft[]) => BookingDraft[]): void {
    setFeedback(null);
    setDraft(prev => ({ ...prev, wizardBookings: update(prev.wizardBookings, prev.routeDrafts) }));
  }

  return {
    draft,
    step,
    feedback,
    isDirty: serializeWizardDraft(draft) !== initialSnapshot,
    canAdvance: canAdvanceWizardStep(step, draft),
    updateBasics,
    updateRouteDraft: (id: string, updates: Partial<LegDraft>) => updateRoute(legs => legs.map(leg => leg.id === id ? { ...leg, ...updates } : leg)),
    addRouteDraft: () => updateRoute(legs => [...legs, createEmptyLegDraft()]),
    removeRouteDraft: (id: string) => updateRoute(legs => legs.filter(leg => leg.id !== id)),
    addBooking: (kind: BookingKind) => updateBookings((bookings, routeDrafts) => [
      ...bookings,
      buildBookingDraft(kind, buildRouteDraftBookingSeed(routeDrafts, routeDrafts[0]?.id), today),
    ]),
    updateBooking: (id: string, updates: Partial<BookingDraft>) => updateBookings((bookings, routeDrafts) => bookings.map(booking => (
      booking.id === id
        ? applyBookingDraftUpdate(booking, updates, legId => buildRouteDraftBookingSeed(routeDrafts, legId), today)
        : booking
    ))),
    removeBooking: (id: string) => updateBookings(bookings => bookings.filter(booking => booking.id !== id)),
    goBack: () => {
      setFeedback(null);
      setStep(previousWizardStep);
    },
    goNext: () => {
      if (!canAdvanceWizardStep(step, draft)) return;
      setFeedback(null);
      setStep(nextWizardStep);
    },
    /**
     * Fill blank booking fields from their destinations and validate them.
     * Returns the draft to save, or null after showing the first problem.
     */
    prepareForSave: (): WizardDraftState | null => {
      const prepared = { ...draft, wizardBookings: prepareWizardBookings(draft, today) };
      setDraft(prepared);
      const message = findWizardBookingValidationMessage(prepared.wizardBookings);
      setFeedback(message);
      return message ? null : prepared;
    },
  };
}
