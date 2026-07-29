import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, act, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProvider } from './surfaceTestHarness';
import TripsSurface from '../surfaces/TripsSurface';

vi.mock('../hooks/useGoogleSync', () => {
  const value = {
    syncState: 'idle',
    lastSyncTime: null,
    syncError: null,
    triggerSync: vi.fn().mockResolvedValue(undefined),
    accountSyncStates: {},
    diagnostics: { accounts: {} },
    credentialStatuses: {},
    refreshCredentialStatuses: vi.fn().mockResolvedValue(undefined),
    serverRuntimeStatus: null,
  };

  return {
    GoogleSyncProvider: ({ children }: { children: unknown }) => children,
    useGoogleSync: () => value,
  };
});

describe('TripsSurface', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('shows the empty state CTA', async () => {
    await act(async () => { renderWithProvider(<TripsSurface />); });
    expect(screen.getByRole('heading', { name: 'Plan your first trip' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Plan your first trip' })).toBeInTheDocument();
  });

  it('creates a trip from the guided wizard and derives the trip date range', async () => {
    await act(async () => { renderWithProvider(<TripsSurface />); });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Plan your first trip' }));
    });

    fireEvent.change(screen.getByLabelText('Trip Name'), { target: { value: 'Euro Sprint' } });
    fireEvent.change(screen.getByLabelText('Short Summary'), { target: { value: 'Two fast city stops.' } });
    fireEvent.change(screen.getByLabelText('Budget Currency'), { target: { value: 'usd' } });
    fireEvent.change(screen.getByLabelText('Trip Budget'), { target: { value: '1500' } });

    await act(async () => {
      fireEvent.click(screen.getByText('Next'));
    });

    const countryInputs = screen.getAllByPlaceholderText('Country');
    const cityInputs = screen.getAllByPlaceholderText('City');
    const routeDateInputs = Array.from(document.querySelectorAll('.trip-wizard-modal input[type="date"]')) as HTMLInputElement[];

    fireEvent.change(countryInputs[0], { target: { value: 'France' } });
    fireEvent.change(cityInputs[0], { target: { value: 'Paris' } });
    fireEvent.change(routeDateInputs[0], { target: { value: '2026-07-01' } });
    fireEvent.change(routeDateInputs[1], { target: { value: '2026-07-03' } });

    await act(async () => {
      fireEvent.click(screen.getByText('+ Add Destination'));
    });

    const nextCountryInputs = screen.getAllByPlaceholderText('Country');
    const nextCityInputs = screen.getAllByPlaceholderText('City');
    const nextRouteDateInputs = Array.from(document.querySelectorAll('.trip-wizard-modal input[type="date"]')) as HTMLInputElement[];

    fireEvent.change(nextCountryInputs[1], { target: { value: 'Italy' } });
    fireEvent.change(nextCityInputs[1], { target: { value: 'Rome' } });
    fireEvent.change(nextRouteDateInputs[2], { target: { value: '2026-07-04' } });
    fireEvent.change(nextRouteDateInputs[3], { target: { value: '2026-07-06' } });

    await act(async () => {
      fireEvent.click(screen.getByText('Next'));
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Next'));
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Create Trip'));
    });

    await waitFor(() => {
      const trips = JSON.parse(localStorage.getItem('helm:trips') || '[]');
      expect(trips).toHaveLength(1);
      expect(trips[0]).toMatchObject({
        name: 'Euro Sprint',
        startDate: '2026-07-01',
        endDate: '2026-07-06',
        budgetCurrency: 'USD',
        budgetTotal: 150000,
      });
    });

    expect((await screen.findAllByText('Euro Sprint')).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Paris, France/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Rome, Italy/).length).toBeGreaterThan(0);
  });

  it('creates wizard bookings with destination defaults and fallback values', async () => {
    await act(async () => { renderWithProvider(<TripsSurface />); });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Plan your first trip' }));
    });

    fireEvent.change(screen.getByLabelText('Trip Name'), { target: { value: 'Italy Escape' } });

    await act(async () => {
      fireEvent.click(screen.getByText('Next'));
    });

    const countryInputs = screen.getAllByPlaceholderText('Country');
    const cityInputs = screen.getAllByPlaceholderText('City');
    const routeDateInputs = Array.from(document.querySelectorAll('.trip-wizard-modal input[type="date"]')) as HTMLInputElement[];

    fireEvent.change(countryInputs[0], { target: { value: 'France' } });
    fireEvent.change(cityInputs[0], { target: { value: 'Paris' } });
    fireEvent.change(routeDateInputs[0], { target: { value: '2026-07-01' } });
    fireEvent.change(routeDateInputs[1], { target: { value: '2026-07-03' } });

    await act(async () => {
      fireEvent.click(screen.getByText('+ Add Destination'));
    });

    const nextCountryInputs = screen.getAllByPlaceholderText('Country');
    const nextCityInputs = screen.getAllByPlaceholderText('City');
    const nextRouteDateInputs = Array.from(document.querySelectorAll('.trip-wizard-modal input[type="date"]')) as HTMLInputElement[];

    fireEvent.change(nextCountryInputs[1], { target: { value: 'Italy' } });
    fireEvent.change(nextCityInputs[1], { target: { value: 'Rome' } });
    fireEvent.change(nextRouteDateInputs[2], { target: { value: '2026-07-04' } });
    fireEvent.change(nextRouteDateInputs[3], { target: { value: '2026-07-06' } });

    await act(async () => {
      fireEvent.click(screen.getByText('Next'));
    });

    await act(async () => {
      fireEvent.click(screen.getByText('+ Stay'));
    });

    const destinationSelect = screen.getByLabelText('Destination');
    fireEvent.change(destinationSelect, { target: { value: (destinationSelect as HTMLSelectElement).options[2].value } });

    expect(screen.getAllByText('Rome, Italy').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Check In')).toHaveValue('2026-07-04');
    expect(screen.getByLabelText('Check Out')).toHaveValue('2026-07-06');
    expect(screen.getByLabelText('Payment Status')).toHaveValue('planned');

    await act(async () => {
      fireEvent.click(screen.getByText('Next'));
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Create Trip'));
    });

    await waitFor(() => {
      const bookings = JSON.parse(localStorage.getItem('helm:tripBookings') || '[]');
      expect(bookings).toHaveLength(1);
      expect(bookings[0]).toMatchObject({
        kind: 'stay',
        title: 'Stay in Rome',
        propertyName: 'Accommodation',
        city: 'Rome',
        country: 'Italy',
        checkInDate: '2026-07-04',
        checkOutDate: '2026-07-06',
        budgetStatus: 'planned',
        budgetDate: '2026-07-04',
      });
    });
  });

  it('renders all trip days in order and sorts itinerary items by time', async () => {
    localStorage.setItem('helm:trips', JSON.stringify([{
      id: 'trip-1',
      name: 'Summer Route',
      summary: 'Paris then Rome',
      notes: '',
      status: 'planning',
      startDate: '2026-07-01',
      endDate: '2026-07-03',
      createdAt: '2026-04-16T08:00:00.000Z',
      updatedAt: '2026-04-16T08:00:00.000Z',
    }]));
    localStorage.setItem('helm:tripLegs', JSON.stringify([
      {
        id: 'leg-1',
        tripId: 'trip-1',
        country: 'France',
        city: 'Paris',
        startDate: '2026-07-01',
        endDate: '2026-07-02',
        sortOrder: 0,
        createdAt: '2026-04-16T08:00:00.000Z',
        updatedAt: '2026-04-16T08:00:00.000Z',
      },
      {
        id: 'leg-2',
        tripId: 'trip-1',
        country: 'Italy',
        city: 'Rome',
        startDate: '2026-07-03',
        endDate: '2026-07-03',
        sortOrder: 1,
        createdAt: '2026-04-16T08:00:00.000Z',
        updatedAt: '2026-04-16T08:00:00.000Z',
      },
    ]));
    localStorage.setItem('helm:tripItineraryItems', JSON.stringify([
      {
        id: 'item-2',
        tripId: 'trip-1',
        legId: 'leg-1',
        date: '2026-07-01',
        title: 'Museum visit',
        startTime: '11:00',
        notes: '',
        sortOrder: 1,
        createdAt: '2026-04-16T08:00:00.000Z',
        updatedAt: '2026-04-16T08:00:00.000Z',
      },
      {
        id: 'item-1',
        tripId: 'trip-1',
        legId: 'leg-1',
        date: '2026-07-01',
        title: 'Morning coffee',
        startTime: '08:00',
        notes: '',
        sortOrder: 0,
        createdAt: '2026-04-16T08:00:00.000Z',
        updatedAt: '2026-04-16T08:00:00.000Z',
      },
    ]));

    await act(async () => { renderWithProvider(<TripsSurface />); });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Timeline' }));
    });

    expect(screen.getAllByText('+ Add Plan')).toHaveLength(3);
    const timelineSection = screen.getByText('Morning coffee').closest('.card');
    expect(timelineSection).not.toBeNull();
    expect(timelineSection?.textContent?.indexOf('Morning coffee')).toBeLessThan(timelineSection?.textContent?.indexOf('Museum visit') ?? 0);
    expect(screen.getByText('2 days in this destination.')).toBeInTheDocument();
    expect(screen.getByText('1 day in this destination.')).toBeInTheDocument();
  });

  it('creates, edits, deletes, and sorts bookings', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    localStorage.setItem('helm:trips', JSON.stringify([{
      id: 'trip-1',
      name: 'Italy Week',
      summary: '',
      notes: '',
      status: 'planning',
      startDate: '2026-08-01',
      endDate: '2026-08-08',
      createdAt: '2026-04-16T08:00:00.000Z',
      updatedAt: '2026-04-16T08:00:00.000Z',
    }]));
    localStorage.setItem('helm:tripLegs', JSON.stringify([{
      id: 'leg-1',
      tripId: 'trip-1',
      country: 'Italy',
      city: 'Rome',
      startDate: '2026-08-01',
      endDate: '2026-08-08',
      sortOrder: 0,
      createdAt: '2026-04-16T08:00:00.000Z',
      updatedAt: '2026-04-16T08:00:00.000Z',
    }]));
    localStorage.setItem('helm:tripBookings', JSON.stringify([{
      id: 'booking-old',
      tripId: 'trip-1',
      legId: 'leg-1',
      kind: 'transport',
      mode: 'ferry',
      title: 'Old ferry',
      fromLabel: 'Naples',
      toLabel: 'Palermo',
      departAt: '2020-07-20T09:00',
      arriveAt: '2020-07-20T13:00',
      notes: '',
      createdAt: '2026-04-16T08:00:00.000Z',
      updatedAt: '2026-04-16T08:00:00.000Z',
    }]));

    await act(async () => { renderWithProvider(<TripsSurface />); });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Bookings' }));
    });

    await act(async () => {
      fireEvent.click(screen.getByText('+ Transport'));
    });

    expect(screen.getByLabelText('Destination')).toHaveValue('leg-1');
    fireEvent.change(screen.getByLabelText('Cost'), { target: { value: '125.50' } });
    fireEvent.change(screen.getByLabelText('Payment Status'), { target: { value: 'paid' } });
    fireEvent.change(screen.getByLabelText('Depart'), { target: { value: '2026-08-02T09:00' } });
    fireEvent.change(screen.getByLabelText('Arrive'), { target: { value: '2026-08-02T11:30' } });

    await act(async () => {
      fireEvent.click(screen.getByText('Create Booking'));
    });

    await act(async () => {
      fireEvent.click(screen.getByText('+ Stay'));
    });

    fireEvent.change(screen.getByLabelText('Property'), { target: { value: 'Hotel Roma' } });
    fireEvent.change(screen.getByLabelText('Cost'), { target: { value: '480' } });
    fireEvent.change(screen.getByLabelText('Check In'), { target: { value: '2026-08-02' } });
    fireEvent.change(screen.getByLabelText('Check Out'), { target: { value: '2026-08-05' } });

    await act(async () => {
      fireEvent.click(screen.getByText('Create Booking'));
    });

    const transportCard = screen.getByText('Transport').closest('.card') as HTMLElement;
    expect(transportCard.textContent?.indexOf('Flight to Rome')).toBeLessThan(transportCard.textContent?.indexOf('Old ferry') ?? 0);

    await act(async () => {
      fireEvent.click(within(transportCard).getAllByText('Edit')[0]);
    });

    await act(async () => {
      fireEvent.click(screen.getByText('More details'));
    });

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Flight to Rome - Updated' } });

    await act(async () => {
      fireEvent.click(screen.getByText('Save Booking'));
    });

    expect(screen.getByText('Flight to Rome - Updated')).toBeInTheDocument();

    const stayCard = screen.getByText('Stay').closest('.card') as HTMLElement;
    await act(async () => {
      fireEvent.click(within(stayCard as HTMLElement).getByText('Delete'));
    });

    expect(screen.queryByText('Hotel Roma')).not.toBeInTheDocument();
  });

  it('derives linked budget rows from bookings without creating duplicate manual entries', async () => {
    localStorage.setItem('helm:trips', JSON.stringify([{
      id: 'trip-linked-budget',
      name: 'Linked Budget Trip',
      summary: '',
      notes: '',
      status: 'planning',
      startDate: '2026-08-01',
      endDate: '2026-08-05',
      budgetCurrency: 'GBP',
      budgetTotal: 100000,
      createdAt: '2026-04-16T08:00:00.000Z',
      updatedAt: '2026-04-16T08:00:00.000Z',
    }]));
    localStorage.setItem('helm:tripLegs', JSON.stringify([{
      id: 'leg-linked',
      tripId: 'trip-linked-budget',
      country: 'Italy',
      city: 'Rome',
      startDate: '2026-08-01',
      endDate: '2026-08-05',
      sortOrder: 0,
      createdAt: '2026-04-16T08:00:00.000Z',
      updatedAt: '2026-04-16T08:00:00.000Z',
    }]));

    await act(async () => { renderWithProvider(<TripsSurface />); });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Bookings' }));
    });

    await act(async () => {
      fireEvent.click(screen.getByText('+ Transport'));
    });

    fireEvent.change(screen.getByLabelText('Cost'), { target: { value: '120.50' } });
    fireEvent.change(screen.getByLabelText('Payment Status'), { target: { value: 'paid' } });
    fireEvent.change(screen.getByLabelText('Depart'), { target: { value: '2026-08-02T09:00' } });
    fireEvent.change(screen.getByLabelText('Arrive'), { target: { value: '2026-08-02T11:30' } });

    await act(async () => {
      fireEvent.click(screen.getByText('Create Booking'));
    });

    await act(async () => {
      fireEvent.click(screen.getByText('+ Stay'));
    });

    fireEvent.change(screen.getByLabelText('Property'), { target: { value: 'Hotel Roma' } });
    fireEvent.change(screen.getByLabelText('Check In'), { target: { value: '2026-08-02' } });
    fireEvent.change(screen.getByLabelText('Check Out'), { target: { value: '2026-08-05' } });

    await act(async () => {
      fireEvent.click(screen.getByText('Create Booking'));
    });

    await waitFor(() => {
      const bookings = JSON.parse(localStorage.getItem('helm:tripBookings') || '[]');
      expect(bookings).toHaveLength(2);

      const flight = bookings.find((booking: { title: string }) => booking.title === 'Flight to Rome');
      const stay = bookings.find((booking: { title: string }) => booking.title === 'Hotel Roma');

      expect(flight).toMatchObject({
        budgetAmount: 12050,
        budgetStatus: 'paid',
        budgetDate: '2026-08-02',
      });
      expect(stay?.budgetAmount).toBeUndefined();
      expect(stay?.budgetStatus).toBe('planned');
      expect(stay?.budgetDate).toBe('2026-08-02');
      expect(JSON.parse(localStorage.getItem('helm:tripBudgetEntries') || '[]')).toEqual([]);
    });

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Budget' })[0]);
    });

    expect(screen.getByText('Flight to Rome')).toBeInTheDocument();
    expect(screen.getByText('Hotel Roma')).toBeInTheDocument();
    expect(screen.getAllByText('Booking').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Needs cost').length).toBeGreaterThan(0);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Overview' }));
    });

    expect(screen.getByText('Bookings that already show up in Budget but still need a cost.')).toBeInTheDocument();
  });

  it('creates a booking with sensible default times when date fields are left blank', async () => {
    localStorage.setItem('helm:trips', JSON.stringify([{
      id: 'trip-booking-defaults',
      name: 'Default Times Trip',
      summary: '',
      notes: '',
      status: 'planning',
      startDate: '2026-08-01',
      endDate: '2026-08-03',
      createdAt: '2026-04-16T08:00:00.000Z',
      updatedAt: '2026-04-16T08:00:00.000Z',
    }]));

    await act(async () => { renderWithProvider(<TripsSurface />); });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Bookings' }));
    });

    await act(async () => {
      fireEvent.click(screen.getByText('+ Transport'));
    });

    expect(screen.getByLabelText('Depart')).toHaveValue('2026-08-01T09:00');
    expect(screen.getByLabelText('Arrive')).toHaveValue('2026-08-01T11:00');

    fireEvent.change(screen.getByLabelText('Depart'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Arrive'), { target: { value: '' } });

    await act(async () => {
      fireEvent.click(screen.getByText('Create Booking'));
    });

    await waitFor(() => {
      const bookings = JSON.parse(localStorage.getItem('helm:tripBookings') || '[]');
      expect(bookings).toHaveLength(1);
      expect(bookings[0]).toMatchObject({
        kind: 'transport',
        title: 'Transport booking',
        departAt: '2026-08-01T09:00',
        arriveAt: '2026-08-01T11:00',
      });
    });

    expect(screen.getByText('Transport booking')).toBeInTheDocument();
  });

  it('shows booking validation feedback for contradictory transport times', async () => {
    localStorage.setItem('helm:trips', JSON.stringify([{
      id: 'trip-booking-validation',
      name: 'Validation Trip',
      summary: '',
      notes: '',
      status: 'planning',
      startDate: '2026-08-01',
      endDate: '2026-08-03',
      createdAt: '2026-04-16T08:00:00.000Z',
      updatedAt: '2026-04-16T08:00:00.000Z',
    }]));

    await act(async () => { renderWithProvider(<TripsSurface />); });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Bookings' }));
    });

    await act(async () => {
      fireEvent.click(screen.getByText('+ Transport'));
    });

    fireEvent.change(screen.getByLabelText('Arrive'), { target: { value: '2026-08-01T08:30' } });

    await act(async () => {
      fireEvent.click(screen.getByText('Create Booking'));
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Arrival needs to be after the departure time.');
    expect(screen.getByText('Add Booking')).toBeInTheDocument();
    expect(screen.queryByText('Transport booking')).not.toBeInTheDocument();
  });

  it('saves and manages trip budget settings and items from the budget tab', async () => {
    localStorage.setItem('helm:trips', JSON.stringify([{
      id: 'trip-budget',
      name: 'Budget Trip',
      summary: '',
      notes: '',
      status: 'planning',
      startDate: '2026-09-10',
      endDate: '2026-09-15',
      budgetCurrency: 'GBP',
      budgetTotal: 150000,
      createdAt: '2026-04-16T08:00:00.000Z',
      updatedAt: '2026-04-16T08:00:00.000Z',
    }]));

    await act(async () => { renderWithProvider(<TripsSurface />); });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Budget' }));
    });

    fireEvent.change(screen.getByLabelText('Currency'), { target: { value: 'usd' } });
    fireEvent.change(screen.getByLabelText('Total Budget'), { target: { value: '1800' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save Budget' }));
    });

    await waitFor(() => {
      const trips = JSON.parse(localStorage.getItem('helm:trips') || '[]');
      expect(trips).toEqual([
        expect.objectContaining({
          id: 'trip-budget',
          budgetCurrency: 'USD',
          budgetTotal: 180000,
        }),
      ]);
    });

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Airport train' } });
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '22.50' } });
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Round trip into the city.' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add Budget Item' }));
    });

    await waitFor(() => {
      const entries = JSON.parse(localStorage.getItem('helm:tripBudgetEntries') || '[]');
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        tripId: 'trip-budget',
        title: 'Airport train',
        category: 'transport',
        amount: 2250,
        status: 'planned',
        date: '2026-09-10',
        notes: 'Round trip into the city.',
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Mark Paid' }));
    });

    await waitFor(() => {
      const entries = JSON.parse(localStorage.getItem('helm:tripBudgetEntries') || '[]');
      expect(entries[0]).toMatchObject({
        title: 'Airport train',
        status: 'paid',
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    });

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Airport express' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save Budget Item' }));
    });

    await waitFor(() => {
      const entries = JSON.parse(localStorage.getItem('helm:tripBudgetEntries') || '[]');
      expect(entries[0]).toMatchObject({
        title: 'Airport express',
        status: 'paid',
      });
    });

    expect(screen.getByText('Airport express')).toBeInTheDocument();
  });

  it('cascades trip deletion to legs, itinerary items, bookings, and budget items only for that trip', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    localStorage.setItem('helm:trips', JSON.stringify([
      {
        id: 'trip-delete',
        name: 'Delete Me',
        summary: '',
        notes: '',
        status: 'planning',
        startDate: '2026-07-01',
        endDate: '2026-07-02',
        createdAt: '2026-04-16T08:00:00.000Z',
        updatedAt: '2026-04-16T08:00:00.000Z',
      },
      {
        id: 'trip-keep',
        name: 'Keep Me',
        summary: '',
        notes: '',
        status: 'planning',
        startDate: '2026-08-01',
        endDate: '2026-08-02',
        createdAt: '2026-04-16T08:00:00.000Z',
        updatedAt: '2026-04-16T08:00:00.000Z',
      },
    ]));
    localStorage.setItem('helm:tripLegs', JSON.stringify([
      {
        id: 'leg-delete',
        tripId: 'trip-delete',
        country: 'France',
        city: 'Paris',
        startDate: '2026-07-01',
        endDate: '2026-07-02',
        sortOrder: 0,
        createdAt: '2026-04-16T08:00:00.000Z',
        updatedAt: '2026-04-16T08:00:00.000Z',
      },
      {
        id: 'leg-keep',
        tripId: 'trip-keep',
        country: 'Italy',
        city: 'Rome',
        startDate: '2026-08-01',
        endDate: '2026-08-02',
        sortOrder: 0,
        createdAt: '2026-04-16T08:00:00.000Z',
        updatedAt: '2026-04-16T08:00:00.000Z',
      },
    ]));
    localStorage.setItem('helm:tripItineraryItems', JSON.stringify([
      {
        id: 'item-delete',
        tripId: 'trip-delete',
        legId: 'leg-delete',
        date: '2026-07-01',
        title: 'Delete item',
        notes: '',
        sortOrder: 0,
        createdAt: '2026-04-16T08:00:00.000Z',
        updatedAt: '2026-04-16T08:00:00.000Z',
      },
      {
        id: 'item-keep',
        tripId: 'trip-keep',
        legId: 'leg-keep',
        date: '2026-08-01',
        title: 'Keep item',
        notes: '',
        sortOrder: 0,
        createdAt: '2026-04-16T08:00:00.000Z',
        updatedAt: '2026-04-16T08:00:00.000Z',
      },
    ]));
    localStorage.setItem('helm:tripBookings', JSON.stringify([
      {
        id: 'booking-delete',
        tripId: 'trip-delete',
        legId: 'leg-delete',
        kind: 'stay',
        title: 'Delete stay',
        propertyName: 'Delete hotel',
        city: 'Paris',
        country: 'France',
        checkInDate: '2026-07-01',
        checkOutDate: '2026-07-02',
        notes: '',
        createdAt: '2026-04-16T08:00:00.000Z',
        updatedAt: '2026-04-16T08:00:00.000Z',
      },
      {
        id: 'booking-keep',
        tripId: 'trip-keep',
        legId: 'leg-keep',
        kind: 'stay',
        title: 'Keep stay',
        propertyName: 'Keep hotel',
        city: 'Rome',
        country: 'Italy',
        checkInDate: '2026-08-01',
        checkOutDate: '2026-08-02',
        notes: '',
        createdAt: '2026-04-16T08:00:00.000Z',
        updatedAt: '2026-04-16T08:00:00.000Z',
      },
    ]));
    localStorage.setItem('helm:tripBudgetEntries', JSON.stringify([
      {
        id: 'budget-delete',
        tripId: 'trip-delete',
        title: 'Delete transport',
        category: 'transport',
        amount: 12000,
        status: 'planned',
        date: '2026-07-01',
        notes: '',
        createdAt: '2026-04-16T08:00:00.000Z',
        updatedAt: '2026-04-16T08:00:00.000Z',
      },
      {
        id: 'budget-keep',
        tripId: 'trip-keep',
        title: 'Keep food',
        category: 'food',
        amount: 4500,
        status: 'paid',
        date: '2026-08-01',
        notes: '',
        createdAt: '2026-04-16T08:00:00.000Z',
        updatedAt: '2026-04-16T08:00:00.000Z',
      },
    ]));

    await act(async () => { renderWithProvider(<TripsSurface />); });

    await act(async () => {
      fireEvent.click(screen.getByText('Delete'));
    });

    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem('helm:trips') || '[]')).toEqual([
        expect.objectContaining({ id: 'trip-keep' }),
      ]);
      expect(JSON.parse(localStorage.getItem('helm:tripLegs') || '[]')).toEqual([
        expect.objectContaining({ id: 'leg-keep' }),
      ]);
      expect(JSON.parse(localStorage.getItem('helm:tripItineraryItems') || '[]')).toEqual([
        expect.objectContaining({ id: 'item-keep' }),
      ]);
      expect(JSON.parse(localStorage.getItem('helm:tripBookings') || '[]')).toEqual([
        expect.objectContaining({ id: 'booking-keep' }),
      ]);
      expect(JSON.parse(localStorage.getItem('helm:tripBudgetEntries') || '[]')).toEqual([
        expect.objectContaining({ id: 'budget-keep' }),
      ]);
    });
  });

  it('imports trip plans into calendar when a source exists', async () => {
    localStorage.setItem('helm:trips', JSON.stringify([{
      id: 'trip-1',
      name: 'City Break',
      summary: '',
      notes: '',
      status: 'planning',
      startDate: '2026-09-01',
      endDate: '2026-09-01',
      createdAt: '2026-04-16T08:00:00.000Z',
      updatedAt: '2026-04-16T08:00:00.000Z',
    }]));
    localStorage.setItem('helm:tripLegs', JSON.stringify([{
      id: 'leg-1',
      tripId: 'trip-1',
      country: 'Spain',
      city: 'Madrid',
      startDate: '2026-09-01',
      endDate: '2026-09-01',
      sortOrder: 0,
      createdAt: '2026-04-16T08:00:00.000Z',
      updatedAt: '2026-04-16T08:00:00.000Z',
    }]));
    localStorage.setItem('helm:tripItineraryItems', JSON.stringify([{
      id: 'item-1',
      tripId: 'trip-1',
      legId: 'leg-1',
      date: '2026-09-01',
      title: 'Museum visit',
      startTime: '10:00',
      endTime: '12:00',
      notes: 'Buy tickets first.',
      sortOrder: 0,
      createdAt: '2026-04-16T08:00:00.000Z',
      updatedAt: '2026-04-16T08:00:00.000Z',
    }]));
    localStorage.setItem('helm:calendarAccounts', JSON.stringify([{
      id: 'acc-1',
      name: 'Personal',
      email: 'alisa@example.com',
      provider: 'local',
      isPrimary: true,
      connected: true,
      mocked: false,
    }]));
    localStorage.setItem('helm:calendarSources', JSON.stringify([{
      id: 'src-1',
      accountId: 'acc-1',
      name: 'Personal',
      color: '#4285f4',
      visible: true,
    }]));

    await act(async () => { renderWithProvider(<TripsSurface />); });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Timeline' }));
    });

    await act(async () => {
      fireEvent.click(screen.getAllByText('Add to Calendar')[0]);
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Add Event'));
    });

    await waitFor(() => {
      const events = JSON.parse(localStorage.getItem('helm:calendarEvents') || '[]');
      expect(events[0]).toMatchObject({
        sourceId: 'src-1',
        title: 'Museum visit',
      });
    });
  });

  it('shows a truthful inline notice when no calendar source exists', async () => {
    localStorage.setItem('helm:trips', JSON.stringify([{
      id: 'trip-1',
      name: 'Solo Day',
      summary: '',
      notes: '',
      status: 'planning',
      startDate: '2026-10-01',
      endDate: '2026-10-01',
      createdAt: '2026-04-16T08:00:00.000Z',
      updatedAt: '2026-04-16T08:00:00.000Z',
    }]));
    localStorage.setItem('helm:tripLegs', JSON.stringify([{
      id: 'leg-1',
      tripId: 'trip-1',
      country: 'Portugal',
      city: 'Lisbon',
      startDate: '2026-10-01',
      endDate: '2026-10-01',
      sortOrder: 0,
      createdAt: '2026-04-16T08:00:00.000Z',
      updatedAt: '2026-04-16T08:00:00.000Z',
    }]));
    localStorage.setItem('helm:tripItineraryItems', JSON.stringify([{
      id: 'item-1',
      tripId: 'trip-1',
      legId: 'leg-1',
      date: '2026-10-01',
      title: 'River walk',
      notes: '',
      sortOrder: 0,
      createdAt: '2026-04-16T08:00:00.000Z',
      updatedAt: '2026-04-16T08:00:00.000Z',
    }]));

    await act(async () => { renderWithProvider(<TripsSurface />); });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Timeline' }));
    });

    await act(async () => {
      fireEvent.click(screen.getAllByText('Add to Calendar')[0]);
    });

    expect(screen.getByText('Add a calendar source first, then you can import trip items into Calendar.')).toBeInTheDocument();
    expect(screen.getByText('Open Calendar')).toBeInTheDocument();
  });

  it('loads persisted trips, itinerary items, and bookings from storage', async () => {
    localStorage.setItem('helm:trips', JSON.stringify([{
      id: 'trip-1',
      name: 'Loaded Trip',
      summary: 'From storage',
      notes: 'Packed and ready.',
      status: 'booked',
      startDate: '2026-11-01',
      endDate: '2026-11-03',
      budgetCurrency: 'EUR',
      budgetTotal: 60000,
      createdAt: '2026-04-16T08:00:00.000Z',
      updatedAt: '2026-04-16T08:00:00.000Z',
    }]));
    localStorage.setItem('helm:tripLegs', JSON.stringify([{
      id: 'leg-1',
      tripId: 'trip-1',
      country: 'Germany',
      city: 'Berlin',
      startDate: '2026-11-01',
      endDate: '2026-11-03',
      sortOrder: 0,
      createdAt: '2026-04-16T08:00:00.000Z',
      updatedAt: '2026-04-16T08:00:00.000Z',
    }]));
    localStorage.setItem('helm:tripBookings', JSON.stringify([{
      id: 'booking-1',
      tripId: 'trip-1',
      legId: 'leg-1',
      kind: 'stay',
      title: 'Berlin stay',
      propertyName: 'Hotel Mitte',
      city: 'Berlin',
      country: 'Germany',
      checkInDate: '2026-11-01',
      checkOutDate: '2026-11-03',
      notes: '',
      createdAt: '2026-04-16T08:00:00.000Z',
      updatedAt: '2026-04-16T08:00:00.000Z',
    }]));
    localStorage.setItem('helm:tripItineraryItems', JSON.stringify([{
      id: 'item-1',
      tripId: 'trip-1',
      legId: 'leg-1',
      date: '2026-11-02',
      title: 'Gallery day',
      notes: '',
      sortOrder: 0,
      createdAt: '2026-04-16T08:00:00.000Z',
      updatedAt: '2026-04-16T08:00:00.000Z',
    }]));
    localStorage.setItem('helm:tripBudgetEntries', JSON.stringify([{
      id: 'budget-1',
      tripId: 'trip-1',
      title: 'Museum tickets',
      category: 'events',
      amount: 3200,
      status: 'planned',
      date: '2026-11-02',
      notes: 'Book ahead.',
      createdAt: '2026-04-16T08:00:00.000Z',
      updatedAt: '2026-04-16T08:00:00.000Z',
    }]));

    await act(async () => { renderWithProvider(<TripsSurface />); });

    expect(screen.getAllByText('Loaded Trip').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Berlin, Germany/).length).toBeGreaterThan(0);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Bookings' }));
    });
    expect(screen.getByText('Berlin stay')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Timeline' }));
    });
    expect(screen.getByText('Gallery day')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Budget' })[0]);
    });
    expect(screen.getByText('Berlin stay')).toBeInTheDocument();
    expect(screen.getAllByText('Needs cost').length).toBeGreaterThan(0);
    expect(screen.getByText('Museum tickets')).toBeInTheDocument();
  });
});
