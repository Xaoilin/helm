import { useDialog } from '../../hooks/useDialog';
import { formatBudgetMoney, normalizeCurrencyCode, resolveBudgetCurrency, resolveTripBudgetInput } from '../../services/tripBudget';
import { formatTripRange, getTripStatusLabel } from '../../services/tripDisplay';
import { TRIP_STATUS_OPTIONS, WIZARD_STEPS } from '../../services/tripModel';
import { useTripWorkflows } from '../../store/workflows/useTripWorkflows';
import type { TripStatus } from '../../types/domain';
import BookingFormFields from './BookingFormFields';
import { useTripWizardDraft } from './useTripWizardDraft';

/** The Plan Trip wizard: basics, route, optional bookings, then review and create. */
export default function TripPlanWizard({ today, onClose, onCreated }: {
  today: string;
  onClose: () => void;
  onCreated: (tripId: string) => void;
}) {
  const { createTripFromPlan } = useTripWorkflows();
  const {
    draft,
    step,
    feedback,
    isDirty,
    canAdvance,
    updateBasics,
    updateRouteDraft,
    addRouteDraft,
    removeRouteDraft,
    addBooking,
    updateBooking,
    removeBooking,
    goBack,
    goNext,
    prepareForSave,
  } = useTripWizardDraft(today);
  const { dialogRef, requestClose } = useDialog({ open: true, onClose, dirty: isDirty });

  const { budgetTotal } = resolveTripBudgetInput(draft.tripBudgetCurrency, draft.tripBudgetTotal);
  const reviewBudget = budgetTotal > 0
    ? `${formatBudgetMoney(budgetTotal, draft.tripBudgetCurrency)} in ${resolveBudgetCurrency(draft.tripBudgetCurrency)}`
    : 'No trip budget set yet. You can add one now or later in the Budget tab.';

  function save(): void {
    const prepared = prepareForSave();
    if (!prepared) return;
    onCreated(createTripFromPlan(prepared));
  }

  return (
    <div className="modal-overlay" onClick={requestClose}>
      <div
        ref={dialogRef}
        className="modal trip-wizard-modal"
        onClick={event => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-label="Plan trip"
      >
        <h2>Plan Trip</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {WIZARD_STEPS.map(stepName => (
            <span key={stepName} className={`tag ${step === stepName ? 'tag-primary' : 'tag-disconnected'}`}>{stepName}</span>
          ))}
        </div>

        {step === 'basics' && (
          <div style={{ display: 'grid', gap: 12 }}>
            <div className="form-group">
              <label htmlFor="trip-name">Trip Name</label>
              <input id="trip-name" className="form-input" value={draft.tripName} onChange={event => updateBasics({ tripName: event.target.value })} placeholder="Summer Europe route" />
            </div>
            <div className="form-group">
              <label htmlFor="trip-summary">Short Summary</label>
              <textarea id="trip-summary" className="form-input" value={draft.tripSummary} onChange={event => updateBasics({ tripSummary: event.target.value })} placeholder="What kind of trip is this?" />
            </div>
            <div className="form-group">
              <label htmlFor="trip-notes">Notes</label>
              <textarea id="trip-notes" className="form-input" value={draft.tripNotes} onChange={event => updateBasics({ tripNotes: event.target.value })} placeholder="Priorities, reminders, companion notes, or context." />
            </div>
            <div className="form-group">
              <label htmlFor="trip-status">Status</label>
              <select id="trip-status" className="form-select" value={draft.tripStatus} onChange={event => updateBasics({ tripStatus: event.target.value as TripStatus })}>
                {TRIP_STATUS_OPTIONS.map(status => (
                  <option key={status} value={status}>{getTripStatusLabel(status)}</option>
                ))}
              </select>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 12 }}>
              <div className="form-group">
                <label htmlFor="trip-budget-currency-wizard">Budget Currency</label>
                <input
                  id="trip-budget-currency-wizard"
                  className="form-input"
                  maxLength={3}
                  value={draft.tripBudgetCurrency}
                  onChange={event => updateBasics({ tripBudgetCurrency: normalizeCurrencyCode(event.target.value) })}
                />
              </div>
              <div className="form-group">
                <label htmlFor="trip-budget-total-wizard">Trip Budget</label>
                <input
                  id="trip-budget-total-wizard"
                  className="form-input"
                  inputMode="decimal"
                  placeholder="2500"
                  value={draft.tripBudgetTotal}
                  onChange={event => updateBasics({ tripBudgetTotal: event.target.value })}
                />
              </div>
            </div>
          </div>
        )}

        {step === 'route' && (
          <div style={{ display: 'grid', gap: 12 }}>
            {draft.routeDrafts.map((leg, index) => (
              <div key={leg.id} className="card" style={{ padding: 14, display: 'grid', gap: 10, background: '#141926' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                  <div style={{ fontWeight: 700 }}>Destination {index + 1}</div>
                  {draft.routeDrafts.length > 1 && <button className="btn btn-danger btn-sm" onClick={() => removeRouteDraft(leg.id)}>Remove</button>}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <input className="form-input" value={leg.country} onChange={event => updateRouteDraft(leg.id, { country: event.target.value })} placeholder="Country" />
                  <input className="form-input" value={leg.city} onChange={event => updateRouteDraft(leg.id, { city: event.target.value })} placeholder="City" />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <input className="form-input" type="date" value={leg.startDate} onChange={event => updateRouteDraft(leg.id, { startDate: event.target.value })} />
                  <input className="form-input" type="date" value={leg.endDate} onChange={event => updateRouteDraft(leg.id, { endDate: event.target.value })} />
                </div>
              </div>
            ))}
            <button className="btn btn-secondary" onClick={addRouteDraft}>+ Add Destination</button>
          </div>
        )}

        {step === 'bookings' && (
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ fontSize: 13, color: '#8b8fa3' }}>Optional: add any bookings you already know. These will already show up in the Budget tab when the trip is created.</div>
            <div className="actions-row" style={{ margin: 0, flexWrap: 'wrap' }}>
              <button className="btn btn-secondary" onClick={() => addBooking('transport')}>+ Transport</button>
              <button className="btn btn-primary" onClick={() => addBooking('stay')}>+ Stay</button>
            </div>
            {draft.wizardBookings.map(booking => (
              <div key={booking.id} className="card" style={{ padding: 14, display: 'grid', gap: 10, background: '#141926' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                  <div style={{ fontWeight: 700 }}>{booking.kind === 'transport' ? 'Transport Booking' : 'Stay Booking'}</div>
                  <button className="btn btn-danger btn-sm" onClick={() => removeBooking(booking.id)}>Remove</button>
                </div>
                <BookingFormFields
                  draft={booking}
                  onChange={updates => updateBooking(booking.id, updates)}
                  legs={draft.routeDrafts}
                  idPrefix={`wizard-booking-${booking.id}`}
                />
              </div>
            ))}
          </div>
        )}

        {step === 'review' && (
          <div style={{ display: 'grid', gap: 14 }}>
            <div className="info-box" style={{ marginBottom: 0 }}>
              <strong>{draft.tripName || 'Untitled trip'}</strong><br />
              {draft.tripSummary || 'No summary yet.'}
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Route</div>
              <div style={{ display: 'grid', gap: 8 }}>
                {draft.routeDrafts.map((leg, index) => (
                  <div key={leg.id} style={{ padding: 12, borderRadius: 12, background: '#141926', border: '1px solid #23283c' }}>
                    {index + 1}. {leg.city}, {leg.country} · {formatTripRange(leg.startDate, leg.endDate)}
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Initial bookings</div>
              <div style={{ fontSize: 13, color: '#8b8fa3' }}>{draft.wizardBookings.length === 0 ? 'No initial bookings. You can add them later.' : `${draft.wizardBookings.length} booking${draft.wizardBookings.length === 1 ? '' : 's'} ready to save.`}</div>
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Budget</div>
              <div style={{ fontSize: 13, color: '#8b8fa3' }}>
                {reviewBudget}
              </div>
            </div>
          </div>
        )}

        {feedback && (
          <div className="info-box error" role="alert" aria-live="polite" style={{ marginBottom: 0 }}>
            {feedback}
          </div>
        )}

        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={step === 'basics' ? requestClose : goBack}>
            {step === 'basics' ? 'Cancel' : 'Back'}
          </button>
          {step !== 'review' ? (
            <button className="btn btn-primary" onClick={goNext} disabled={!canAdvance}>
              Next
            </button>
          ) : (
            <button className="btn btn-primary" onClick={save} disabled={!canAdvance}>Create Trip</button>
          )}
        </div>
      </div>
    </div>
  );
}
