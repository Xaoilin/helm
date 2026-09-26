import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TripBookingEditor from '../components/trips/TripBookingEditor';
import TripPlanWizard from '../components/trips/TripPlanWizard';
import { TripCtx } from '../store/contexts/TripContext';
import { provide, renderWithContexts } from './renderWithContexts';
import { fakeTripContext, makeTransportBooking, makeTrip, makeTripLeg } from './tripFixtures';

describe('TripBookingEditor', () => {
  it('seeds a new stay from the first leg and saves it on the trip', () => {
    const trips = fakeTripContext();
    const onClose = vi.fn();
    renderWithContexts(
      <TripBookingEditor trip={makeTrip()} legs={[makeTripLeg()]} kind="stay" today="2026-09-26" onClose={onClose} />,
      [provide(TripCtx, trips)],
    );

    expect(screen.getByLabelText('Check In')).toHaveValue('2026-10-01');
    expect(screen.getByLabelText('Check Out')).toHaveValue('2026-10-03');
    fireEvent.change(screen.getByLabelText('Property'), { target: { value: 'Hotel Sol' } });
    fireEvent.change(screen.getByLabelText('Cost'), { target: { value: '480' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Booking' }));

    expect(trips.addTripBooking).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'stay', tripId: 'trip-1', legId: 'leg-1', propertyName: 'Hotel Sol', city: 'Madrid', budgetAmount: 48000,
    }));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows a validation error and does not save an arrival before departure', () => {
    const trips = fakeTripContext();
    const onClose = vi.fn();
    const booking = makeTransportBooking({ legId: 'leg-1' });
    renderWithContexts(
      <TripBookingEditor trip={makeTrip()} legs={[makeTripLeg()]} kind="transport" booking={booking} today="2026-09-26" onClose={onClose} />,
      [provide(TripCtx, trips)],
    );

    expect(screen.getByLabelText('Booking Type')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Arrive'), { target: { value: '2026-10-04T08:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Booking' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Arrival needs to be after the departure time.');
    expect(trips.updateTripBooking).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('TripPlanWizard', () => {
  it('creates the trip with its route through the Trip store and reports the new trip', () => {
    const trips = fakeTripContext();
    const onCreated = vi.fn();
    renderWithContexts(<TripPlanWizard today="2026-09-26" onClose={vi.fn()} onCreated={onCreated} />, [provide(TripCtx, trips)]);

    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Trip Name' }), { target: { value: 'Summer route' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.change(screen.getByPlaceholderText('Country'), { target: { value: 'Spain' } });
    fireEvent.change(screen.getByPlaceholderText('City'), { target: { value: 'Madrid' } });
    const dates = screen.getByRole('dialog', { name: 'Plan trip' }).querySelectorAll('input[type="date"]');
    fireEvent.change(dates[0], { target: { value: '2026-10-01' } });
    fireEvent.change(dates[1], { target: { value: '2026-10-05' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Stay' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('1 booking ready to save.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create Trip' }));

    expect(trips.createTripPlan).toHaveBeenCalledTimes(1);
    const [trip, legs, bookings] = vi.mocked(trips.createTripPlan).mock.calls[0];
    expect(trip).toMatchObject({ name: 'Summer route', startDate: '', endDate: '' });
    expect(legs).toEqual([expect.objectContaining({ country: 'Spain', city: 'Madrid', startDate: '2026-10-01', endDate: '2026-10-05' })]);
    expect(bookings).toEqual([expect.objectContaining({ kind: 'stay', legId: legs[0].id, checkInDate: '2026-10-01', checkOutDate: '2026-10-05' })]);
    expect(trips.addTrip).not.toHaveBeenCalled();
    expect(trips.addTripLeg).not.toHaveBeenCalled();
    expect(trips.addTripBooking).not.toHaveBeenCalled();
    expect(onCreated).toHaveBeenCalledWith('trip-new');
  });
});
