import { useCallback, useMemo } from 'react';
import type { TripLeg } from '../../types/domain';
import {
  buildBookingPayload,
  buildRouteDraftBookingSeed,
  buildRouteLegInputs,
  buildTripBasicsPayload,
  type LegFormDraft,
  type WizardDraftState,
} from '../../services/tripModel';
import { useTripContext } from '../contexts/TripContext';

export interface TripWorkflows {
  /**
   * Create a trip, its route legs, and its initial bookings from a finished Plan Trip draft, in one
   * save. Bookings must already be materialized and valid; they name the draft legs. Returns the new
   * trip id. The service dates the trip from its legs.
   */
  createTripFromPlan: (draft: WizardDraftState) => string;
  /** Add or edit one leg; the service refits the trip's dates to its legs. */
  saveLeg: (input: { tripId: string; orderedLegs: TripLeg[]; editingLegId: string | null; form: LegFormDraft }) => void;
  /** Swap a leg with its neighbour in route order. Does nothing at either end. */
  moveLeg: (orderedLegs: TripLeg[], legId: string, direction: -1 | 1) => void;
  /** Remove a leg; the service removes its plans and bookings, renumbers the rest and refits the dates. */
  removeLeg: (input: { tripId: string; orderedLegs: TripLeg[]; legId: string }) => void;
}

/** Multi-record Trip writes, expressed once so the planner UI only says what the person asked for. */
export function useTripWorkflows(): TripWorkflows {
  const { createTripPlan, addTripLeg, updateTripLeg, moveTripLeg, removeTripLeg } = useTripContext();

  const createTripFromPlan = useCallback((draft: WizardDraftState): string => {
    const legs = buildRouteLegInputs(draft.routeDrafts).map(leg => ({
      id: leg.draftId, country: leg.country, city: leg.city, startDate: leg.startDate, endDate: leg.endDate,
    }));
    const bookings = draft.wizardBookings.map(booking => ({
      ...buildBookingPayload(booking, '', buildRouteDraftBookingSeed(draft.routeDrafts, booking.legId)),
      id: booking.id,
      legId: booking.legId,
    }));
    return createTripPlan({ ...buildTripBasicsPayload(draft), startDate: '', endDate: '' }, legs, bookings);
  }, [createTripPlan]);

  const saveLeg = useCallback<TripWorkflows['saveLeg']>(({ tripId, orderedLegs, editingLegId, form }) => {
    const fields = {
      country: form.country.trim(),
      city: form.city.trim(),
      startDate: form.startDate,
      endDate: form.endDate,
    };
    if (editingLegId) {
      updateTripLeg(editingLegId, fields);
    } else {
      addTripLeg({ ...fields, tripId, sortOrder: orderedLegs.length });
    }
  }, [addTripLeg, updateTripLeg]);

  const moveLeg = useCallback<TripWorkflows['moveLeg']>((orderedLegs, legId, direction) => {
    const index = orderedLegs.findIndex(leg => leg.id === legId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= orderedLegs.length) return;
    moveTripLeg(legId, direction);
  }, [moveTripLeg]);

  const removeLeg = useCallback<TripWorkflows['removeLeg']>(({ legId }) => {
    removeTripLeg(legId);
  }, [removeTripLeg]);

  return useMemo(
    () => ({ createTripFromPlan, saveLeg, moveLeg, removeLeg }),
    [createTripFromPlan, saveLeg, moveLeg, removeLeg],
  );
}
