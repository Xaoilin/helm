import { useState } from 'react';
import { normalizeCurrencyCode } from '../../services/tripBudget';
import { getTripStatusLabel } from '../../services/tripDisplay';
import { buildTripBasicsPayload, mapTripToBasicsDraft, TRIP_STATUS_OPTIONS, type TripBasicsDraft } from '../../services/tripModel';
import { useTripContext } from '../../store/contexts/TripContext';
import type { Trip, TripStatus } from '../../types/domain';

export default function TripEditModal({ trip, onClose }: { trip: Trip; onClose: () => void }) {
  const { updateTrip } = useTripContext();
  const [draft, setDraft] = useState<TripBasicsDraft>(() => mapTripToBasicsDraft(trip));
  const update = (updates: Partial<TripBasicsDraft>) => setDraft(prev => ({ ...prev, ...updates }));

  function save(): void {
    if (!draft.tripName.trim()) return;
    updateTrip(trip.id, buildTripBasicsPayload(draft));
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={event => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Edit trip">
        <h2>Edit Trip</h2>
        <div className="form-group">
          <label htmlFor="edit-trip-name">Trip Name</label>
          <input id="edit-trip-name" className="form-input" value={draft.tripName} onChange={event => update({ tripName: event.target.value })} autoFocus />
        </div>
        <div className="form-group">
          <label htmlFor="edit-trip-summary">Summary</label>
          <textarea id="edit-trip-summary" className="form-input" value={draft.tripSummary} onChange={event => update({ tripSummary: event.target.value })} />
        </div>
        <div className="form-group">
          <label htmlFor="edit-trip-notes">Notes</label>
          <textarea id="edit-trip-notes" className="form-input" value={draft.tripNotes} onChange={event => update({ tripNotes: event.target.value })} />
        </div>
        <div className="form-group">
          <label htmlFor="edit-trip-status">Status</label>
          <select id="edit-trip-status" className="form-select" value={draft.tripStatus} onChange={event => update({ tripStatus: event.target.value as TripStatus })}>
            {TRIP_STATUS_OPTIONS.map(status => (
              <option key={status} value={status}>{getTripStatusLabel(status)}</option>
            ))}
          </select>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 12 }}>
          <div className="form-group">
            <label htmlFor="edit-trip-budget-currency">Budget Currency</label>
            <input
              id="edit-trip-budget-currency"
              className="form-input"
              maxLength={3}
              value={draft.tripBudgetCurrency}
              onChange={event => update({ tripBudgetCurrency: normalizeCurrencyCode(event.target.value) })}
            />
          </div>
          <div className="form-group">
            <label htmlFor="edit-trip-budget-total">Trip Budget</label>
            <input
              id="edit-trip-budget-total"
              className="form-input"
              inputMode="decimal"
              placeholder="2500"
              value={draft.tripBudgetTotal}
              onChange={event => update({ tripBudgetTotal: event.target.value })}
            />
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={!draft.tripName.trim()}>Save Trip</button>
        </div>
      </div>
    </div>
  );
}
