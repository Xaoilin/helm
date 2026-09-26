import { useCallback, useMemo } from 'react';
import type { TripLeg } from '../../types/domain';
import {
  buildBookingPayload,
  buildRouteDraftBookingSeed,
  buildRouteLegInputs,
  buildTripBasicsPayload,
  deriveRangeAfterLegSave,
  deriveTripRange,
  planLegRemoval,
  planLegSwap,
  type LegFormDraft,
  type WizardDraftState,
} from '../../services/tripModel';
import { useTripContext } from '../contexts/TripContext';

export interface TripWorkflows {
  /**
   * Create a trip, its route legs, and its initial bookings from a finished
   * Plan Trip draft. Bookings must already be materialized and valid. Draft
   * leg ids are remapped to the created leg ids. Returns the new trip id.
   */
  createTripFromPlan: (draft: WizardDraftState) => string;
  /** Add or edit one leg, then refit the trip range to its legs. */
  saveLeg: (input: { tripId: string; orderedLegs: TripLeg[]; editingLegId: string | null; form: LegFormDraft }) => void;
  /** Swap a leg with its neighbour in route order. Does nothing at either end. */
  moveLeg: (orderedLegs: TripLeg[], legId: string, direction: -1 | 1) => void;
  /** Remove a leg (the store cascades its plans and bookings), renumber the rest, and refit the trip range. */
  removeLeg: (input: { tripId: string; orderedLegs: TripLeg[]; legId: string }) => void;
}

/** Multi-record Trip writes, expressed once so the planner UI only says what the person asked for. */
export function useTripWorkflows(): TripWorkflows {
  const { addTrip, updateTrip, addTripLeg, updateTripLeg, removeTripLeg, addTripBooking } = useTripContext();

  const createTripFromPlan = useCallback((draft: WizardDraftState): string => {
    const legInputs = buildRouteLegInputs(draft.routeDrafts);
    const tripId = addTrip({
      ...buildTripBasicsPayload(draft),
      ...deriveTripRange(legInputs),
    });

    const legIdByDraftId = new Map<string, string>();
    legInputs.forEach(({ draftId, ...leg }) => {
      legIdByDraftId.set(draftId, addTripLeg({ ...leg, tripId }));
    });

    draft.wizardBookings.forEach(booking => {
      addTripBooking({
        ...buildBookingPayload(booking, tripId, buildRouteDraftBookingSeed(draft.routeDrafts, booking.legId)),
        legId: booking.legId ? legIdByDraftId.get(booking.legId) : undefined,
      });
    });

    return tripId;
  }, [addTrip, addTripLeg, addTripBooking]);

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
    updateTrip(tripId, deriveRangeAfterLegSave(orderedLegs, editingLegId, form));
  }, [addTripLeg, updateTripLeg, updateTrip]);

  const moveLeg = useCallback<TripWorkflows['moveLeg']>((orderedLegs, legId, direction) => {
    planLegSwap(orderedLegs, legId, direction)?.forEach(({ id, sortOrder }) => updateTripLeg(id, { sortOrder }));
  }, [updateTripLeg]);

  const removeLeg = useCallback<TripWorkflows['removeLeg']>(({ tripId, orderedLegs, legId }) => {
    removeTripLeg(legId);
    const { reindexed, range } = planLegRemoval(orderedLegs, legId);
    reindexed.forEach(leg => updateTripLeg(leg.id, { sortOrder: leg.sortOrder }));
    updateTrip(tripId, range);
  }, [removeTripLeg, updateTripLeg, updateTrip]);

  return useMemo(
    () => ({ createTripFromPlan, saveLeg, moveLeg, removeLeg }),
    [createTripFromPlan, saveLeg, moveLeg, removeLeg],
  );
}
