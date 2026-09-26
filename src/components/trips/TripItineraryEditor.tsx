import { useState } from 'react';
import {
  buildItineraryFields,
  buildItineraryFormDraft,
  isItineraryFormComplete,
  nextItinerarySortOrder,
  type ItineraryFormDraft,
} from '../../services/tripModel';
import { useTripContext } from '../../store/contexts/TripContext';
import type { Trip, TripItineraryItem, TripLeg } from '../../types/domain';

/** Add or edit one plan on a destination day. */
export default function TripItineraryEditor({ trip, legs, itinerary, leg, date, item, onClose }: {
  trip: Trip;
  legs: TripLeg[];
  itinerary: TripItineraryItem[];
  leg: TripLeg;
  date: string;
  item?: TripItineraryItem;
  onClose: () => void;
}) {
  const { addTripItineraryItem, updateTripItineraryItem } = useTripContext();
  const [form, setForm] = useState<ItineraryFormDraft>(() => buildItineraryFormDraft(leg.id, date, item));
  const update = (updates: Partial<ItineraryFormDraft>) => setForm(prev => ({ ...prev, ...updates }));
  const complete = isItineraryFormComplete(form);

  function save(): void {
    if (!complete) return;
    const fields = buildItineraryFields(form);
    if (item) {
      updateTripItineraryItem(item.id, fields);
    } else {
      addTripItineraryItem({
        ...fields,
        tripId: trip.id,
        sortOrder: nextItinerarySortOrder(itinerary, form.legId, form.date, null),
      });
    }
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={event => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={item ? 'Edit itinerary item' : 'Add itinerary item'}>
        <h2>{item ? 'Edit Plan' : 'Add Plan'}</h2>
        <div className="form-group">
          <label htmlFor="itinerary-leg">Destination</label>
          <select id="itinerary-leg" className="form-select" value={form.legId} onChange={event => update({ legId: event.target.value })}>
            {legs.map(option => (
              <option key={option.id} value={option.id}>{option.city}, {option.country}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label htmlFor="itinerary-date">Date</label>
          <input id="itinerary-date" className="form-input" type="date" value={form.date} onChange={event => update({ date: event.target.value })} />
        </div>
        <div className="form-group">
          <label htmlFor="itinerary-title">Title</label>
          <input id="itinerary-title" className="form-input" value={form.title} onChange={event => update({ title: event.target.value })} autoFocus />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="form-group">
            <label htmlFor="itinerary-start-time">Start Time</label>
            <input id="itinerary-start-time" className="form-input" type="time" value={form.startTime} onChange={event => update({ startTime: event.target.value })} />
          </div>
          <div className="form-group">
            <label htmlFor="itinerary-end-time">End Time</label>
            <input id="itinerary-end-time" className="form-input" type="time" value={form.endTime} onChange={event => update({ endTime: event.target.value })} />
          </div>
        </div>
        <div className="form-group">
          <label htmlFor="itinerary-location">Location</label>
          <input id="itinerary-location" className="form-input" value={form.location} onChange={event => update({ location: event.target.value })} />
        </div>
        <div className="form-group">
          <label htmlFor="itinerary-notes">Notes</label>
          <textarea id="itinerary-notes" className="form-input" value={form.notes} onChange={event => update({ notes: event.target.value })} />
        </div>
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={!complete}>Save Plan</button>
        </div>
      </div>
    </div>
  );
}
