import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildStayDraft, buildTransportDraft, createEmptyWizardDraft, type WizardDraftState } from '../services/tripModel';
import { TripProvider, useTripContext } from '../store/contexts/TripContext';
import { useTripWorkflows } from '../store/workflows/useTripWorkflows';
import { makeServiceTrips, makeTrip, makeTripBundle, makeTripLeg } from './tripFixtures';

const api = vi.hoisted(() => ({
  getTrips: vi.fn(),
  createTripPlan: vi.fn(),
  saveTrip: vi.fn(),
  saveTripLeg: vi.fn(),
  moveTripLeg: vi.fn(),
  deleteTripLeg: vi.fn(),
}));

vi.mock('../services/backend/lifeServiceApi', async importOriginal => ({
  ...(await importOriginal<typeof import('../services/backend/lifeServiceApi')>()),
  ...api,
  isLifeServiceEnabled: () => true,
}));

const wrapper = ({ children }: { children: ReactNode }) => <TripProvider>{children}</TripProvider>;

async function renderWorkflows() {
  const rendered = renderHook(() => ({ workflows: useTripWorkflows(), trips: useTripContext() }), { wrapper });
  await waitFor(() => expect(rendered.result.current.trips.loaded).toBe(true));
  return rendered.result;
}

describe('useTripWorkflows', () => {
  beforeEach(() => {
    Object.values(api).forEach(mock => mock.mockReset());
    api.getTrips.mockResolvedValue(makeServiceTrips([makeTrip()], {
      legs: [
        makeTripLeg({ id: 'a', sortOrder: 0 }),
        makeTripLeg({ id: 'b', sortOrder: 1, startDate: '2026-10-04', endDate: '2026-10-06' }),
      ],
    }));
  });

  it('creates the trip, its route in order and its bookings in one save, with bookings naming draft legs', async () => {
    const result = await renderWorkflows();
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
    let confirm: (value: unknown) => void = () => undefined;
    api.createTripPlan.mockReturnValue(new Promise(resolve => { confirm = resolve; }));

    let tripId = '';
    act(() => { tripId = result.current.workflows.createTripFromPlan(draft); });

    expect(api.createTripPlan).toHaveBeenCalledTimes(1);
    const [sentId, trip, legs, bookings] = api.createTripPlan.mock.calls[0];
    expect(sentId).toBe(tripId);
    expect(trip).toEqual({
      name: 'Iberia', summary: '', notes: '', status: 'planning',
      budgetCurrency: 'EUR', budgetTotal: 90000, startDate: '', endDate: '',
    });
    expect(legs).toEqual([
      { id: 'draft-madrid', country: 'Spain', city: 'Madrid', startDate: '2026-10-01', endDate: '2026-10-03' },
      { id: 'draft-lisbon', country: 'Portugal', city: 'Lisbon', startDate: '2026-10-04', endDate: '2026-10-06' },
    ]);
    expect(bookings).toHaveLength(2);
    expect(bookings[0]).toMatchObject({ kind: 'stay', tripId, legId: 'draft-lisbon', title: 'Casa', city: 'Lisbon' });
    expect(bookings[1]).toMatchObject({ kind: 'transport', tripId, legId: undefined, departAt: '2026-10-01T09:00' });
    expect(bookings[0].id).toBe(draft.wizardBookings[0].id);

    // Shown at once, then replaced by the service's copy, which dates the trip from its legs.
    expect(result.current.trips.trips[0]).toMatchObject({ id: tripId, name: 'Iberia' });
    expect(result.current.trips.tripLegs.filter(leg => leg.tripId === tripId).map(leg => [leg.id, leg.sortOrder]))
      .toEqual([['draft-madrid', 0], ['draft-lisbon', 1]]);
    const saved = makeTrip({ id: tripId, name: 'Iberia', startDate: '2026-10-01', endDate: '2026-10-06' });
    await act(async () => { confirm(makeTripBundle(saved, { legs: [makeTripLeg({ id: 'draft-madrid', tripId })] })); });
    expect(result.current.trips.trips.find(entry => entry.id === tripId)).toMatchObject({ startDate: '2026-10-01', endDate: '2026-10-06' });
    expect(result.current.trips.tripLegs.filter(leg => leg.tripId === tripId).map(leg => leg.id)).toEqual(['draft-madrid']);
  });

  it('adds a new leg at the end of the route and shows the dates the service refits', async () => {
    api.saveTripLeg.mockImplementation(async (id: string) => makeTripBundle(
      makeTrip({ endDate: '2026-10-09' }),
      { legs: [makeTripLeg({ id: 'a' }), makeTripLeg({ id: id, city: 'Lisbon', sortOrder: 1, startDate: '2026-10-07', endDate: '2026-10-09' })] },
    ));
    const result = await renderWorkflows();
    const legs = result.current.trips.tripLegs;

    await act(async () => {
      result.current.workflows.saveLeg({ tripId: 'trip-1', orderedLegs: legs, editingLegId: null, form: { country: ' Portugal ', city: ' Lisbon ', startDate: '2026-10-07', endDate: '2026-10-09' } });
    });

    expect(api.saveTripLeg).toHaveBeenCalledTimes(1);
    expect(api.saveTripLeg.mock.calls[0][1]).toEqual({ tripId: 'trip-1', country: 'Portugal', city: 'Lisbon', startDate: '2026-10-07', endDate: '2026-10-09' });
    expect(api.saveTrip).not.toHaveBeenCalled();
    expect(result.current.trips.trips[0]).toMatchObject({ endDate: '2026-10-09' });
    expect(result.current.trips.tripLegs.map(leg => leg.city)).toEqual(['Madrid', 'Lisbon']);
  });

  it('edits an existing leg by its id and leaves the trip dates to the service', async () => {
    api.saveTripLeg.mockResolvedValue(makeTripBundle(makeTrip({ startDate: '2026-09-28' }), { legs: [makeTripLeg({ id: 'a', city: 'Seville' })] }));
    const result = await renderWorkflows();

    await act(async () => {
      result.current.workflows.saveLeg({ tripId: 'trip-1', orderedLegs: result.current.trips.tripLegs, editingLegId: 'a', form: { country: 'Spain', city: 'Seville', startDate: '2026-09-28', endDate: '2026-10-03' } });
    });

    expect(api.saveTripLeg).toHaveBeenCalledWith('a', { tripId: 'trip-1', country: 'Spain', city: 'Seville', startDate: '2026-09-28', endDate: '2026-10-03' });
    expect(api.saveTrip).not.toHaveBeenCalled();
    expect(result.current.trips.trips[0]).toMatchObject({ startDate: '2026-09-28' });
  });

  it('moves a leg through the service and ignores moves past the ends', async () => {
    api.moveTripLeg.mockResolvedValue(makeTripBundle(makeTrip(), {
      legs: [makeTripLeg({ id: 'b', sortOrder: 0 }), makeTripLeg({ id: 'a', sortOrder: 1 })],
    }));
    const result = await renderWorkflows();
    const legs = result.current.trips.tripLegs;

    await act(async () => {
      result.current.workflows.moveLeg(legs, 'b', -1);
      result.current.workflows.moveLeg(legs, 'a', -1);
      result.current.workflows.moveLeg(legs, 'b', 1);
    });

    expect(api.moveTripLeg.mock.calls).toEqual([['b', -1]]);
    expect(result.current.trips.tripLegs.map(leg => [leg.id, leg.sortOrder])).toEqual([['b', 0], ['a', 1]]);
  });

  it('removes a leg through the service and shows the renumbered route it answers with', async () => {
    let confirm: (value: unknown) => void = () => undefined;
    api.deleteTripLeg.mockReturnValue(new Promise(resolve => { confirm = resolve; }));
    const result = await renderWorkflows();

    act(() => { result.current.workflows.removeLeg({ tripId: 'trip-1', orderedLegs: result.current.trips.tripLegs, legId: 'a' }); });

    expect(api.deleteTripLeg).toHaveBeenCalledWith('a');
    expect(result.current.trips.tripLegs.map(leg => leg.id)).toEqual(['b']);
    await act(async () => {
      confirm(makeTripBundle(makeTrip({ startDate: '2026-10-04' }), { legs: [makeTripLeg({ id: 'b', sortOrder: 0, startDate: '2026-10-04' })] }));
    });
    expect(result.current.trips.tripLegs.map(leg => [leg.id, leg.sortOrder])).toEqual([['b', 0]]);
    expect(result.current.trips.trips[0]).toMatchObject({ startDate: '2026-10-04' });
    expect(api.saveTrip).not.toHaveBeenCalled();
  });

  it('reports a refused save and reloads the trips the service holds', async () => {
    api.deleteTripLeg.mockRejectedValue(new Error('Leg not found'));
    const result = await renderWorkflows();

    await act(async () => {
      result.current.workflows.removeLeg({ tripId: 'trip-1', orderedLegs: result.current.trips.tripLegs, legId: 'a' });
    });

    await waitFor(() => expect(result.current.trips.error).toBe('Your last change was not saved: Leg not found'));
    expect(api.getTrips).toHaveBeenCalledTimes(2);
    expect(result.current.trips.tripLegs.map(leg => leg.id)).toEqual(['a', 'b']);
  });
});
