import { useState } from 'react';
import TripBookingEditor from '../components/trips/TripBookingEditor';
import TripBookingsTab from '../components/trips/TripBookingsTab';
import TripBudgetPanel from '../components/trips/TripBudgetPanel';
import TripCalendarImportModal from '../components/trips/TripCalendarImportModal';
import TripDetailHeader, { type TripsTab } from '../components/trips/TripDetailHeader';
import TripEditModal from '../components/trips/TripEditModal';
import TripItineraryEditor from '../components/trips/TripItineraryEditor';
import TripLegEditor from '../components/trips/TripLegEditor';
import TripOverviewTab from '../components/trips/TripOverviewTab';
import TripPlanWizard from '../components/trips/TripPlanWizard';
import TripRail from '../components/trips/TripRail';
import TripTimelineTab from '../components/trips/TripTimelineTab';
import { useTripCalendarImport } from '../components/trips/useTripCalendarImport';
import { useTripPlannerView } from '../components/trips/useTripPlannerView';
import { TRIP_BUDGET } from '../config/constants';
import { toLocalDateStr } from '../services/localDate';
import type { BookingKind } from '../services/tripModel';
import { useShell } from '../store/ShellContext';
import { useTripContext } from '../store/contexts/TripContext';
import type { TripBooking, TripItineraryItem, TripLeg } from '../types/domain';

/** The one editor dialog open over the planner, if any. */
type OpenEditor =
  | { type: 'wizard' }
  | { type: 'trip' }
  | { type: 'leg'; leg?: TripLeg }
  | { type: 'plan'; leg: TripLeg; date: string; item?: TripItineraryItem }
  | { type: 'booking'; kind: BookingKind; booking?: TripBooking; legId?: string };

export default function TripsSurface() {
  const shell = useShell();
  const { trips, removeTrip } = useTripContext();
  // Trip dates are device-local date-input values, so "today" is the device-local date.
  const now = new Date();
  const todayStr = toLocalDateStr(now);

  const [activeTab, setActiveTab] = useState<TripsTab>('overview');
  const [requestedTripId, setRequestedTripId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [editor, setEditor] = useState<OpenEditor | null>(null);
  const calendarImport = useTripCalendarImport();
  const view = useTripPlannerView({ requestedTripId, searchQuery, today: todayStr, nowMs: now.getTime() });
  const { selectedTrip, legs, bookings, seedFor } = view;
  const currency = selectedTrip?.budgetCurrency || TRIP_BUDGET.DEFAULT_CURRENCY;
  const closeEditor = () => setEditor(null);

  function selectTrip(tripId: string): void {
    setRequestedTripId(tripId);
    setActiveTab('overview');
  }

  function editBookingById(bookingId: string): void {
    const booking = bookings.find(item => item.id === bookingId);
    if (booking) setEditor({ type: 'booking', kind: booking.kind, booking });
  }

  function renderActiveTab() {
    if (!selectedTrip) return null;
    switch (activeTab) {
      case 'overview':
        return (
          <TripOverviewTab
            trip={selectedTrip}
            legs={legs}
            bookingCount={bookings.length}
            planCount={view.itinerary.length}
            nextBooking={view.nextBooking}
            seedFor={seedFor}
            currency={currency}
            budgetTotals={view.budgetTotals}
            ledgerCount={view.budgetLedger.length}
          />
        );
      case 'timeline':
        return (
          <TripTimelineTab
            trip={selectedTrip}
            legs={legs}
            itineraryByDay={view.itineraryByDay}
            bookingsByDay={view.bookingsByDay}
            seedFor={seedFor}
            currency={currency}
            today={todayStr}
            onOpenLegEditor={leg => setEditor({ type: 'leg', leg })}
            onOpenPlanEditor={(leg, date, item) => setEditor({ type: 'plan', leg, date, item })}
            onAddToCalendar={calendarImport.open}
          />
        );
      case 'bookings':
        return (
          <TripBookingsTab
            bookings={bookings}
            seedFor={seedFor}
            currency={currency}
            nowMs={now.getTime()}
            onCreate={kind => setEditor({ type: 'booking', kind })}
            onEdit={(kind, booking) => setEditor({ type: 'booking', kind, booking })}
            onShowBudget={() => setActiveTab('budget')}
            onAddToCalendar={calendarImport.open}
          />
        );
      case 'budget':
        return (
          <TripBudgetPanel
            key={selectedTrip.id}
            trip={selectedTrip}
            entries={view.budgetLedger}
            totals={view.budgetTotals}
            todayStr={todayStr}
            onEditBooking={editBookingById}
          />
        );
    }
  }

  function renderEditor() {
    if (!editor) return null;
    if (editor.type === 'wizard') {
      return (
        <TripPlanWizard
          today={todayStr}
          onClose={closeEditor}
          onCreated={tripId => {
            selectTrip(tripId);
            closeEditor();
          }}
        />
      );
    }
    if (!selectedTrip) return null;
    switch (editor.type) {
      case 'trip':
        return <TripEditModal trip={selectedTrip} onClose={closeEditor} />;
      case 'leg':
        return <TripLegEditor trip={selectedTrip} orderedLegs={legs} leg={editor.leg} onClose={closeEditor} />;
      case 'plan':
        return <TripItineraryEditor trip={selectedTrip} legs={legs} itinerary={view.itinerary} leg={editor.leg} date={editor.date} item={editor.item} onClose={closeEditor} />;
      case 'booking':
        return <TripBookingEditor trip={selectedTrip} legs={legs} kind={editor.kind} booking={editor.booking} legId={editor.legId} today={todayStr} onClose={closeEditor} />;
    }
  }

  return (
    <>
      <div className="surface-header">
        <div>
          <h1>Trips</h1>
          <div className="subtitle">
            {trips.length === 0
              ? 'Plan multi-country travel without leaving Sabah One'
              : `${trips.length} trip${trips.length === 1 ? '' : 's'} tracked locally`}
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => setEditor({ type: 'wizard' })}>+ Plan Trip</button>
      </div>

      <div className="surface-body">
        {trips.length === 0 ? (
          <div className="empty-state" role="status">
            <div className="empty-icon">&#9992;&#65039;</div>
            <h3>Plan your first trip</h3>
            <p>Create a travel timeline with destinations, bookings, and day plans saved to your Sabah One account.</p>
            <button className="btn btn-primary" onClick={() => setEditor({ type: 'wizard' })}>Plan your first trip</button>
          </div>
        ) : (
          <div className="trips-layout">
            <TripRail
              trips={view.filteredTrips}
              legsByTrip={view.legsByTrip}
              selectedTripId={view.selectedTripId}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              onSelect={selectTrip}
            />

            <section style={{ display: 'grid', gap: 16, minWidth: 0 }}>
              {selectedTrip ? (
                <>
                  <TripDetailHeader
                    trip={selectedTrip}
                    destinationCount={legs.length}
                    bookingCount={bookings.length}
                    activeTab={activeTab}
                    onTabChange={setActiveTab}
                    onEdit={() => setEditor({ type: 'trip' })}
                    onDelete={() => {
                      if (window.confirm(`Delete trip "${selectedTrip.name}"?`)) {
                        removeTrip(selectedTrip.id);
                        setRequestedTripId(null);
                      }
                    }}
                  />

                  {calendarImport.notice && (
                    <div className="info-box warning" style={{ marginBottom: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                        <span>{calendarImport.notice}</span>
                        <button className="btn btn-secondary btn-sm" onClick={() => shell.navigate('calendar')}>Open Calendar</button>
                      </div>
                    </div>
                  )}

                  {renderActiveTab()}
                </>
              ) : (
                <div className="card" style={{ padding: 20, color: '#8b8fa3' }}>
                  Pick a trip from the rail or create a new one to open the planner.
                </div>
              )}
            </section>
          </div>
        )}
      </div>

      {renderEditor()}
      <TripCalendarImportModal calendarImport={calendarImport} />
    </>
  );
}
