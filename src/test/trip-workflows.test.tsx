import { describe, expect, it } from 'vitest';
import { buildStayDraft, buildTransportDraft, createEmptyWizardDraft, type WizardDraftState } from '../services/tripModel';
import { TripCtx } from '../store/contexts/TripContext';
import { useTripWorkflows } from '../store/workflows/useTripWorkflows';
import { provide, renderHookWithContexts } from './renderWithContexts';
import { fakeTripContext, makeTripLeg } from './tripFixtures';

function renderWorkflows() {
  const trips = fakeTripContext();
  const { result } = renderHookWithContexts(() => useTripWorkflows(), [provide(TripCtx, trips)]);
  return { trips, workflows: result.current };
}

describe('useTripWorkflows', () => {
  it('creates the trip, then its legs in route order, then bookings on the created leg ids', () => {
    const { trips, workflows } = renderWorkflows();
    const draft: WizardDraftState = {
      ...createEmptyWizardDraft(),
      tripName: ' Iberia ',
      tripBudgetCurrency: 'eur',
      tripBudgetTotal: '900',
      routeDrafts: [
        { id: 'draft-madrid', country: 'Spain', city: 'Madrid', startDate: '2026-10-01', endDate: '2026-10-03' },
        { id: 'draft-lisbon', country: 'Portugal', city: 'Lisbon', startDate: '2026-10-04', endDate: '2026-10-06' },
      ],
      wizardBookings: [
        { ...buildStayDraft({ legId: 'draft-lisbon', city: 'Lisbon', country: 'Portugal', startDate: '2026-10-04', endDate: '2026-10-06' }, '2026-09-26'), propertyName: 'Casa' },
        { ...buildTransportDraft({ startDate: '2026-10-01' }, '2026-09-26'), legId: undefined, mode: 'train' },
      ],
    };

    const tripId = workflows.createTripFromPlan(draft);

    expect(tripId).toBe('trip-new');
    expect(trips.addTrip).toHaveBeenCalledTimes(1);
    expect(trips.addTrip).toHaveBeenCalledWith({
      name: 'Iberia', summary: '', notes: '', status: 'planning',
      budgetCurrency: 'EUR', budgetTotal: 90000,
      startDate: '2026-10-01', endDate: '2026-10-06',
    });
    expect(trips.addTripLeg.mock.calls).toEqual([
      [{ tripId: 'trip-new', country: 'Spain', city: 'Madrid', startDate: '2026-10-01', endDate: '2026-10-03', sortOrder: 0 }],
      [{ tripId: 'trip-new', country: 'Portugal', city: 'Lisbon', startDate: '2026-10-04', endDate: '2026-10-06', sortOrder: 1 }],
    ]);
    expect(trips.addTripBooking).toHaveBeenCalledTimes(2);
    expect(trips.addTripBooking.mock.calls[0][0]).toMatchObject({ kind: 'stay', tripId: 'trip-new', legId: 'leg-created-2', title: 'Casa', city: 'Lisbon' });
    expect(trips.addTripBooking.mock.calls[1][0]).toMatchObject({ kind: 'transport', tripId: 'trip-new', legId: undefined, departAt: '2026-10-01T09:00' });
    expect(trips.addTrip.mock.invocationCallOrder[0]).toBeLessThan(trips.addTripLeg.mock.invocationCallOrder[0]);
    expect(trips.addTripLeg.mock.invocationCallOrder[1]).toBeLessThan(trips.addTripBooking.mock.invocationCallOrder[0]);
  });

  it('adds a new leg at the end of the route and refits the trip range', () => {
    const { trips, workflows } = renderWorkflows();
    const legs = [makeTripLeg()];

    workflows.saveLeg({ tripId: 'trip-1', orderedLegs: legs, editingLegId: null, form: { country: ' Portugal ', city: ' Lisbon ', startDate: '2026-10-04', endDate: '2026-10-06' } });

    expect(trips.addTripLeg).toHaveBeenCalledWith({ tripId: 'trip-1', country: 'Portugal', city: 'Lisbon', startDate: '2026-10-04', endDate: '2026-10-06', sortOrder: 1 });
    expect(trips.updateTripLeg).not.toHaveBeenCalled();
    expect(trips.updateTrip).toHaveBeenCalledWith('trip-1', { startDate: '2026-10-01', endDate: '2026-10-06' });
  });

  it('edits an existing leg and refits the trip range', () => {
    const { trips, workflows } = renderWorkflows();
    const legs = [makeTripLeg(), makeTripLeg({ id: 'leg-2', startDate: '2026-10-04', endDate: '2026-10-06', sortOrder: 1 })];

    workflows.saveLeg({ tripId: 'trip-1', orderedLegs: legs, editingLegId: 'leg-1', form: { country: 'Spain', city: 'Seville', startDate: '2026-09-28', endDate: '2026-10-03' } });

    expect(trips.updateTripLeg).toHaveBeenCalledWith('leg-1', { country: 'Spain', city: 'Seville', startDate: '2026-09-28', endDate: '2026-10-03' });
    expect(trips.addTripLeg).not.toHaveBeenCalled();
    expect(trips.updateTrip).toHaveBeenCalledWith('trip-1', { startDate: '2026-09-28', endDate: '2026-10-06' });
  });

  it('swaps a leg with its neighbour and ignores moves past the ends', () => {
    const { trips, workflows } = renderWorkflows();
    const legs = [makeTripLeg({ id: 'a', sortOrder: 0 }), makeTripLeg({ id: 'b', sortOrder: 1 })];

    workflows.moveLeg(legs, 'b', -1);
    workflows.moveLeg(legs, 'a', -1);

    expect(trips.updateTripLeg.mock.calls).toEqual([['b', { sortOrder: 0 }], ['a', { sortOrder: 1 }]]);
  });

  it('removes a leg, renumbers the rest, and refits the trip range', () => {
    const { trips, workflows } = renderWorkflows();
    const legs = [
      makeTripLeg({ id: 'a', sortOrder: 0 }),
      makeTripLeg({ id: 'b', sortOrder: 1, startDate: '2026-10-04', endDate: '2026-10-05' }),
      makeTripLeg({ id: 'c', sortOrder: 2, startDate: '2026-10-06', endDate: '2026-10-09' }),
    ];

    workflows.removeLeg({ tripId: 'trip-1', orderedLegs: legs, legId: 'a' });

    expect(trips.removeTripLeg).toHaveBeenCalledWith('a');
    expect(trips.updateTripLeg.mock.calls).toEqual([['b', { sortOrder: 0 }], ['c', { sortOrder: 1 }]]);
    expect(trips.updateTrip).toHaveBeenCalledWith('trip-1', { startDate: '2026-10-04', endDate: '2026-10-09' });
  });
});
