import { useState } from 'react';
import { buildLegFormDraft, isLegFormComplete, type LegFormDraft } from '../../services/tripModel';
import { useTripWorkflows } from '../../store/workflows/useTripWorkflows';
import type { Trip, TripLeg } from '../../types/domain';

/** Add or edit one destination leg; saving refits the trip's dates to its route. */
export default function TripLegEditor({ trip, orderedLegs, leg, onClose }: {
  trip: Trip;
  orderedLegs: TripLeg[];
  leg?: TripLeg;
  onClose: () => void;
}) {
  const { saveLeg } = useTripWorkflows();
  const [form, setForm] = useState<LegFormDraft>(() => buildLegFormDraft(leg));
  const update = (updates: Partial<LegFormDraft>) => setForm(prev => ({ ...prev, ...updates }));
  const complete = isLegFormComplete(form);

  function save(): void {
    if (!complete) return;
    saveLeg({ tripId: trip.id, orderedLegs, editingLegId: leg?.id || null, form });
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={event => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={leg ? 'Edit destination' : 'Add destination'}>
        <h2>{leg ? 'Edit Destination' : 'Add Destination'}</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="form-group">
            <label htmlFor="leg-country">Country</label>
            <input id="leg-country" className="form-input" value={form.country} onChange={event => update({ country: event.target.value })} autoFocus />
          </div>
          <div className="form-group">
            <label htmlFor="leg-city">City</label>
            <input id="leg-city" className="form-input" value={form.city} onChange={event => update({ city: event.target.value })} />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="form-group">
            <label htmlFor="leg-start">Start Date</label>
            <input id="leg-start" className="form-input" type="date" value={form.startDate} onChange={event => update({ startDate: event.target.value })} />
          </div>
          <div className="form-group">
            <label htmlFor="leg-end">End Date</label>
            <input id="leg-end" className="form-input" type="date" value={form.endDate} onChange={event => update({ endDate: event.target.value })} />
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={!complete}>Save Destination</button>
        </div>
      </div>
    </div>
  );
}
